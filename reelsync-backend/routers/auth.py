import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
import bcrypt
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models.db_models import User
from models.schemas import Token, UserCreate, UserLogin, UserOut

logger = logging.getLogger(__name__)
router = APIRouter()

_bearer = HTTPBearer()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

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
    """
    Pre-flight check executed before any bcrypt hashing.

    Runs a single OR query to detect email OR phone collisions in one
    round-trip. If either field is already taken, raises HTTP 409 with a
    message that names the exact conflicting field so the client can surface
    a precise error to the user.
    """
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


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/signup",
    response_model=Token,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def signup(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Registration flow with two-layer duplicate protection:

    Layer 1 — Pre-flight query (fast path):
        Checks email AND phone_number against the users table in a single
        OR query *before* bcrypt runs. Returns a field-specific 409 if
        either value is already taken, avoiding wasted CPU on hashing.

    Layer 2 — IntegrityError catch (race-condition safety net):
        If two identical requests slip through the pre-flight check within
        the same millisecond, the PostgreSQL UNIQUE constraints on email
        and phone_number will still reject the second write. The
        IntegrityError is caught, the session is rolled back cleanly, and
        a 409 is returned instead of a 500 crash.
    """
    # ── Layer 1: pre-flight duplicate check (before any hashing) ─────────────
    await _check_conflicts(db, body.email, body.phone_number)

    # ── Hash password (only reached if no duplicate was found) ────────────────
    hashed_pw = hash_password(body.password)

    new_user = User(
        id=uuid.uuid4(),
        email=body.email,
        phone_number=body.phone_number,
        hashed_password=hashed_pw,
        credit_minutes=3,
    )

    # ── Layer 2: DB-level uniqueness guard with safe rollback ─────────────────
    try:
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
    except IntegrityError as exc:
        await db.rollback()
        logger.warning(
            f"[signup] IntegrityError for email={body.email} "
            f"phone={body.phone_number}: {exc.orig}"
        )
        # Parse the constraint name from the DETAIL string when possible
        detail_lower = str(exc.orig).lower()
        if "phone_number" in detail_lower:
            conflict_field = "phone number"
        else:
            conflict_field = "email address"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Registration failed — an account with this {conflict_field} "
                "already exists. This may be a duplicate submission."
            ),
        )

    logger.info(f"[signup] user_id={new_user.id} email={new_user.email}")

    return Token(
        access_token=create_access_token(str(new_user.id), new_user.email),
        user_id=str(new_user.id),
        email=new_user.email,
    )


@router.post(
    "/login",
    response_model=Token,
    summary="Authenticate and obtain a JWT access token",
)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """
    Verifies email + bcrypt password, returns a signed JWT valid for 24 hours.
    Pass it as `Authorization: Bearer <token>` on all protected endpoints.

    Intentionally returns the same error message for both 'email not found'
    and 'wrong password' to prevent user enumeration.
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


@router.get(
    "/me",
    response_model=UserOut,
    summary="Return the authenticated user's profile",
)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        user_id=str(current_user.id),
        email=current_user.email,
        credit_minutes=current_user.credit_minutes,
        phone_number=current_user.phone_number,
    )
