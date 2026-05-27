import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from billing import BILLING_TIERS, plan_from_db
from config import PROFITABLE_TIERS, settings
from database import get_db
from models.db_models import OTPVerification, PasswordResetOTP, User
from models.schemas import (
    ForgotPasswordRequest,
    OTPVerify,
    ResetPasswordVerify,
    Token,
    UserCreate,
    UserLogin,
    UserOut,
)
from utils.email import send_otp_email, send_password_reset_email

logger = logging.getLogger(__name__)
router = APIRouter()

_bearer = HTTPBearer()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
OTP_EXPIRE_MINUTES = 5
OTP_MAX_ATTEMPTS = 5


# ─── Password helpers ─────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ─── JWT helpers ──────────────────────────────────────────────────────────────

def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": user_id, "email": email, "exp": expire},
        settings.jwt_secret_key,
        algorithm=ALGORITHM,
    )


# ─── Shared auth dependency ───────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise JWTError("No subject in token")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    user: Optional[User] = await db.get(User, uuid.UUID(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with this token no longer exists.",
        )

    return user


# ─── Duplicate detection helper ───────────────────────────────────────────────

async def _check_conflicts(
    db: AsyncSession,
    email: str,
    phone_number: Optional[str],
) -> None:
    conditions = [User.email == email]
    if phone_number:
        conditions.append(User.phone_number == phone_number)

    result = await db.execute(
        select(User.email, User.phone_number).where(or_(*conditions))
    )
    rows = result.all()

    for row_email, row_phone in rows:
        if row_email == email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email address is already registered.",
            )
        if phone_number and row_phone == phone_number:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this phone number is already registered.",
            )


# ─── POST /signup-request ─────────────────────────────────────────────────────

@router.post(
    "/signup-request",
    status_code=status.HTTP_200_OK,
    summary="Initiate signup — validates input and emails a 6-digit OTP",
)
async def signup_request(
    body: UserCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 1 of the two-step signup flow.

    Validates all input via the UserCreate schema (email format, domain
    blacklist, password length, phone normalization), checks for existing
    accounts, then stores a short-lived OTP record and fires the email in a
    BackgroundTask so the response returns immediately.

    Re-requesting for the same email atomically replaces the previous OTP
    record, invalidating any code that was already sent.
    """
    # Pre-flight: check existing accounts before any hashing
    await _check_conflicts(db, body.email, body.phone_number)

    otp_code = f"{secrets.randbelow(10 ** 6):06d}"
    hashed_pw = hash_password(body.password)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)

    # Atomic upsert: delete any stale OTP for this email then insert fresh one
    await db.execute(
        delete(OTPVerification).where(OTPVerification.email == body.email)
    )
    db.add(OTPVerification(
        id=uuid.uuid4(),
        email=body.email,
        otp_code=otp_code,
        hashed_password=hashed_pw,
        phone_number=body.phone_number,
        expires_at=expires_at,
    ))
    await db.commit()

    background_tasks.add_task(send_otp_email, body.email, otp_code)
    logger.info(f"[signup-request] OTP queued for {body.email}")

    return {"message": "Verification code sent. Check your email."}


# ─── POST /verify-otp ─────────────────────────────────────────────────────────

@router.post(
    "/verify-otp",
    response_model=Token,
    status_code=status.HTTP_201_CREATED,
    summary="Verify OTP and create the permanent user account",
)
async def verify_otp(body: OTPVerify, db: AsyncSession = Depends(get_db)):
    """
    Step 2 of the two-step signup flow.

    Looks up the OTP record by email, enforces expiry and attempt limits,
    then atomically deletes the OTP record and creates the permanent User
    row in a single transaction. Returns a JWT identical to /login so the
    client can proceed directly to the dashboard.

    Security properties:
    - Max 5 wrong attempts before the OTP record is invalidated.
    - 5-minute expiry window enforced server-side regardless of client state.
    - Race-condition guard via _check_conflicts before final write.
    - Distinct error messages for expired vs invalid so UX is clear,
      but both cases require a new signup-request (no information leak
      about whether the email was registered).
    """
    result = await db.execute(
        select(OTPVerification).where(OTPVerification.email == body.email)
    )
    record: Optional[OTPVerification] = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending verification found for this email. Please sign up again.",
        )

    # Normalise to UTC-aware before comparison
    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if expires < datetime.now(timezone.utc):
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please sign up again to receive a new code.",
        )

    if record.attempt_count >= OTP_MAX_ATTEMPTS:
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many incorrect attempts. Please sign up again.",
        )

    if record.otp_code != body.otp_code:
        record.attempt_count += 1
        await db.commit()
        remaining = OTP_MAX_ATTEMPTS - record.attempt_count
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Incorrect verification code. "
                f"{remaining} attempt{'s' if remaining != 1 else ''} remaining."
            ),
        )

    # OTP correct — final duplicate guard against race conditions
    await _check_conflicts(db, record.email, record.phone_number)

    _INITIAL_CREDITS = 3
    new_user = User(
        id=uuid.uuid4(),
        email=record.email,
        phone_number=record.phone_number,
        hashed_password=record.hashed_password,
        credit_minutes=_INITIAL_CREDITS,
        subscription_plan="free",
        chars_balance=PROFITABLE_TIERS["free"]["chars_per_credit_minute"] * _INITIAL_CREDITS,
    )

    try:
        db.add(new_user)
        await db.delete(record)
        await db.commit()
        await db.refresh(new_user)
    except IntegrityError as exc:
        await db.rollback()
        detail_lower = str(exc.orig).lower()
        conflict_field = "phone number" if "phone_number" in detail_lower else "email address"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An account with this {conflict_field} already exists.",
        )

    logger.info(f"[verify-otp] created user_id={new_user.id} email={new_user.email}")

    return Token(
        access_token=create_access_token(str(new_user.id), new_user.email),
        user_id=str(new_user.id),
        email=new_user.email,
    )


# ─── POST /login ──────────────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=Token,
    summary="Authenticate and obtain a JWT access token",
)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """
    Verifies email + bcrypt password, returns a signed JWT valid for 24 hours.
    Same error for 'not found' and 'wrong password' to prevent enumeration.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user: Optional[User] = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    logger.info(f"[login] user_id={user.id}")

    return Token(
        access_token=create_access_token(str(user.id), user.email),
        user_id=str(user.id),
        email=user.email,
    )


# ─── GET /me ──────────────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=UserOut,
    summary="Return the authenticated user's profile",
)
async def me(current_user: User = Depends(get_current_user)):
    plan_key = plan_from_db(current_user.subscription_plan)  # uppercase e.g. "FREE"
    tier = BILLING_TIERS.get(plan_key, BILLING_TIERS["FREE"])
    return UserOut(
        user_id=str(current_user.id),
        email=current_user.email,
        credit_minutes=current_user.credit_minutes,
        subscription_plan=current_user.subscription_plan or "free",
        credit_limit_minutes=tier["min_limit"],
        phone_number=current_user.phone_number,
        profile_picture_url=current_user.profile_picture_url,
    )


# ─── POST /forgot-password-request ───────────────────────────────────────────

@router.post(
    "/forgot-password-request",
    status_code=status.HTTP_200_OK,
    summary="Send a 6-digit password-reset OTP to the given email address",
)
async def forgot_password_request(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Always returns 200 regardless of whether the email is registered —
    this prevents account enumeration. The OTP is only sent when the
    email matches a real user.
    """
    _SAFE_RESPONSE = {"message": "If that email is registered, a reset code has been sent."}

    result = await db.execute(select(User).where(User.email == body.email))
    user: Optional[User] = result.scalar_one_or_none()

    if not user:
        logger.info(f"[forgot-password] no account for {body.email} — silent no-op")
        return _SAFE_RESPONSE

    otp_code = f"{secrets.randbelow(10 ** 6):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)

    # Atomic upsert: replace any existing reset OTP for this email
    await db.execute(
        delete(PasswordResetOTP).where(PasswordResetOTP.email == body.email)
    )
    db.add(PasswordResetOTP(
        id=uuid.uuid4(),
        email=body.email,
        otp_code=otp_code,
        expires_at=expires_at,
    ))
    await db.commit()

    background_tasks.add_task(send_password_reset_email, body.email, otp_code)
    logger.info(f"[forgot-password] reset OTP queued for {body.email}")
    return _SAFE_RESPONSE


# ─── POST /reset-password-verify ─────────────────────────────────────────────

@router.post(
    "/reset-password-verify",
    status_code=status.HTTP_200_OK,
    summary="Verify the reset OTP and update the user's password",
)
async def reset_password_verify(
    body: ResetPasswordVerify,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PasswordResetOTP).where(PasswordResetOTP.email == body.email)
    )
    record: Optional[PasswordResetOTP] = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending reset found for this email. Please request a new code.",
        )

    # Normalise to UTC-aware before comparison
    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if expires < datetime.now(timezone.utc):
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset code has expired. Please request a new one.",
        )

    if record.attempt_count >= OTP_MAX_ATTEMPTS:
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many incorrect attempts. Please request a new reset code.",
        )

    if record.otp_code != body.otp_code:
        record.attempt_count += 1
        await db.commit()
        remaining = OTP_MAX_ATTEMPTS - record.attempt_count
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Incorrect code. "
                f"{remaining} attempt{'s' if remaining != 1 else ''} remaining."
            ),
        )

    # OTP correct — update the user's password
    user_result = await db.execute(select(User).where(User.email == body.email))
    user: Optional[User] = user_result.scalar_one_or_none()
    if not user:
        # Guard against the extremely unlikely case of account deletion between
        # the forgot-password-request and verify calls.
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )

    user.hashed_password = hash_password(body.new_password)
    db.add(user)
    await db.delete(record)
    await db.commit()

    logger.info(f"[reset-password] password updated for user_id={user.id}")
    return {"message": "Password updated successfully."}
