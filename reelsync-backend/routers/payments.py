import base64
import hashlib
import json
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from billing import BILLING_TIERS
from config import PROFITABLE_TIERS, settings
from database import get_db
from models.db_models import PaymentTransaction, User
from models.schemas import InitiatePaymentRequest, SubscribeRequest
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── Package catalogue ────────────────────────────────────────────────────────
# Add tiers here; the frontend and webhook both read from this dict.

PACKAGES: dict[str, dict] = {
    "starter": {
        "label": "Starter Pack",
        "credits": 30,
        "amount_paise": 29900,  # ₹299.00
    },
    "creator": {
        "label": "Creator Pack",
        "credits": 120,
        "amount_paise": 99900,  # ₹999.00
    },
}

# PhonePe path component used in the initiate-request checksum (constant for all environments)
_PHONEPE_PAY_PATH = "/pg/v1/pay"


# ─── Checksum helpers ─────────────────────────────────────────────────────────

def _initiate_checksum(base64_payload: str) -> str:
    """
    Outbound request header:
        SHA256(base64_payload + "/pg/v1/pay" + SALT_KEY) + "###" + SALT_INDEX
    """
    raw = base64_payload + _PHONEPE_PAY_PATH + settings.phonepe_salt_key
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{digest}###{settings.phonepe_salt_index}"


def _webhook_checksum(base64_payload: str) -> str:
    """
    Inbound callback verification:
        SHA256(base64_payload + SALT_KEY) + "###" + SALT_INDEX
    No path component for callbacks — PhonePe's documented behaviour.
    """
    raw = base64_payload + settings.phonepe_salt_key
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{digest}###{settings.phonepe_salt_index}"


# ─── POST /initiate ───────────────────────────────────────────────────────────

@router.post(
    "/initiate",
    summary="Initiate a PhonePe payment and return the hosted checkout URL",
)
async def initiate_payment(
    body: InitiatePaymentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Flow:
    1. Validate the requested package.
    2. Persist a PENDING PaymentTransaction for idempotency + webhook lookup.
    3. Build the PhonePe PAY_PAGE payload, base64-encode it, compute the checksum.
    4. POST to the PhonePe API and extract the redirect URL.
    5. Return the redirect URL to the frontend.
    """
    package = PACKAGES.get(body.package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown package '{body.package_id}'. Valid: {sorted(PACKAGES)}",
        )

    # uuid4().hex = 32 lowercase hex chars — within PhonePe's 38-char limit
    merchant_txn_id = uuid.uuid4().hex

    # Persist PENDING record before calling PhonePe so we can correlate the webhook
    txn = PaymentTransaction(
        id=uuid.uuid4(),
        user_id=current_user.id,
        merchant_txn_id=merchant_txn_id,
        package_id=body.package_id,
        credits=package["credits"],
        amount_paise=package["amount_paise"],
        status="PENDING",
    )
    db.add(txn)
    await db.commit()

    logger.info(
        f"[payments/initiate] user={current_user.id} pkg={body.package_id} "
        f"txn={merchant_txn_id} amount=₹{package['amount_paise'] / 100:.0f}"
    )

    # ── Build PhonePe payload ─────────────────────────────────────────────────
    payload_dict = {
        "merchantId": settings.phonepe_merchant_id,
        "merchantTransactionId": merchant_txn_id,
        "merchantUserId": str(current_user.id),
        "amount": package["amount_paise"],
        "redirectUrl": (
            f"{settings.frontend_url}/dashboard/billing"
            f"?txn={merchant_txn_id}&status=pending"
        ),
        "redirectMode": "REDIRECT",
        "callbackUrl": f"{settings.base_url}/api/payments/webhook",
        "paymentInstrument": {"type": "PAY_PAGE"},
    }

    payload_json   = json.dumps(payload_dict, separators=(",", ":"))
    base64_payload = base64.b64encode(payload_json.encode("utf-8")).decode("utf-8")
    checksum       = _initiate_checksum(base64_payload)

    request_headers = {
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "accept": "application/json",
    }

    # ── Call PhonePe ──────────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.phonepe_api_url,
                headers=request_headers,
                json={"request": base64_payload},
            )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[payments/initiate] PhonePe HTTP {exc.response.status_code}: {exc.response.text}"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment gateway returned an error. Please try again.",
        )
    except httpx.RequestError as exc:
        logger.error(f"[payments/initiate] Network error contacting PhonePe: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach payment gateway. Please try again.",
        )

    # ── Extract redirect URL ──────────────────────────────────────────────────
    try:
        redirect_url: str = data["data"]["instrumentResponse"]["redirectInfo"]["url"]
    except (KeyError, TypeError):
        logger.error(f"[payments/initiate] Unexpected PhonePe response: {data}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected response from payment gateway.",
        )

    logger.info(f"[payments/initiate] checkout URL obtained for txn={merchant_txn_id}")
    return {
        "redirect_url": redirect_url,
        "merchant_txn_id": merchant_txn_id,
    }


# ─── POST /subscribe ──────────────────────────────────────────────────────────

@router.post(
    "/subscribe",
    summary="Subscribe to a plan — FREE switches immediately; paid plans initiate PhonePe",
)
async def subscribe(
    body: SubscribeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    FREE plan: directly updates subscription_plan in the DB, no payment.
    Paid plans: creates a PENDING PaymentTransaction and initiates a PhonePe
    PAY_PAGE redirect. The package_id is stored as "sub_<PLAN>" so the webhook
    can identify it as a subscription purchase and set subscription_plan after
    payment completes.
    """
    target_plan = body.target_plan  # uppercase, validated by schema
    tier = BILLING_TIERS[target_plan]

    # ── FREE: direct plan switch, no payment ─────────────────────────────────
    if target_plan == "FREE":
        current_user.subscription_plan = "free"
        db.add(current_user)
        await db.commit()
        logger.info(f"[payments/subscribe] user={current_user.id} → FREE (direct)")
        return {"status": "ok", "message": "Switched to Free plan."}

    # ── Paid plan: initiate PhonePe payment ───────────────────────────────────
    merchant_txn_id = uuid.uuid4().hex  # 32 hex chars, within PhonePe's 38-char limit
    package_id = f"sub_{target_plan}"   # "sub_STARTER", "sub_CREATOR", "sub_PRO"

    txn = PaymentTransaction(
        id=uuid.uuid4(),
        user_id=current_user.id,
        merchant_txn_id=merchant_txn_id,
        package_id=package_id,
        credits=tier["min_limit"],
        amount_paise=tier["amount_paise"],
        status="PENDING",
    )
    db.add(txn)
    await db.commit()

    logger.info(
        f"[payments/subscribe] user={current_user.id} plan={target_plan} "
        f"txn={merchant_txn_id} amount=₹{tier['amount_paise'] / 100:.0f}"
    )

    payload_dict = {
        "merchantId": settings.phonepe_merchant_id,
        "merchantTransactionId": merchant_txn_id,
        "merchantUserId": str(current_user.id),
        "amount": tier["amount_paise"],
        "redirectUrl": (
            f"{settings.frontend_url}/dashboard/billing"
            f"?txn={merchant_txn_id}&status=pending"
        ),
        "redirectMode": "REDIRECT",
        "callbackUrl": f"{settings.base_url}/api/payments/webhook",
        "paymentInstrument": {"type": "PAY_PAGE"},
    }

    payload_json   = json.dumps(payload_dict, separators=(",", ":"))
    base64_payload = base64.b64encode(payload_json.encode("utf-8")).decode("utf-8")
    checksum       = _initiate_checksum(base64_payload)

    request_headers = {
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.phonepe_api_url,
                headers=request_headers,
                json={"request": base64_payload},
            )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[payments/subscribe] PhonePe HTTP {exc.response.status_code}: {exc.response.text}"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment gateway returned an error. Please try again.",
        )
    except httpx.RequestError as exc:
        logger.error(f"[payments/subscribe] Network error contacting PhonePe: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach payment gateway. Please try again.",
        )

    try:
        payment_url: str = data["data"]["instrumentResponse"]["redirectInfo"]["url"]
    except (KeyError, TypeError):
        logger.error(f"[payments/subscribe] Unexpected PhonePe response: {data}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected response from payment gateway.",
        )

    logger.info(f"[payments/subscribe] checkout URL obtained for txn={merchant_txn_id}")
    return {"payment_url": payment_url, "merchant_txn_id": merchant_txn_id}


# ─── POST /webhook ────────────────────────────────────────────────────────────

@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    summary="PhonePe S2S payment webhook",
    include_in_schema=False,  # hide from public Swagger docs
)
async def phonepe_webhook(
    request: Request,
    x_verify: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    PhonePe calls this endpoint server-to-server after every payment attempt.

    Security flow:
    1.  Read the raw Base64 `response` field from form-data or JSON body.
    2.  Recompute SHA256 checksum and compare against the X-VERIFY header.
        Mismatch → 401, blocks spoofed callbacks.
    3.  Decode the Base64 payload, parse state and merchantTransactionId.
    4.  Ignore non-COMPLETED events (return 200 so PhonePe stops retrying).
    5.  Look up the PaymentTransaction record by merchantTransactionId.
    6.  Idempotency check: if already COMPLETED, return early.
    7.  Credit the user, mark transaction COMPLETED, commit atomically.
    """

    # ── 1. Read raw body ──────────────────────────────────────────────────────
    base64_payload = ""
    content_type   = request.headers.get("content-type", "")

    if "form" in content_type:
        form           = await request.form()
        base64_payload = str(form.get("response", ""))
    else:
        try:
            body           = await request.json()
            base64_payload = body.get("response", "")
        except Exception:
            pass

    if not base64_payload:
        logger.warning("[payments/webhook] Empty payload — ignoring")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing response payload.",
        )

    # ── 2. Signature verification ─────────────────────────────────────────────
    expected = _webhook_checksum(base64_payload)
    if not x_verify or x_verify != expected:
        logger.warning(
            "[payments/webhook] X-VERIFY mismatch — possible spoofed callback. "
            f"received={x_verify!r}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Checksum verification failed.",
        )

    # ── 3. Decode payload ─────────────────────────────────────────────────────
    try:
        decoded          = base64.b64decode(base64_payload).decode("utf-8")
        outer            = json.loads(decoded)
        inner            = outer.get("data", outer)
        state: str       = inner.get("state", "")
        merchant_txn_id: str = inner.get("merchantTransactionId", "")
    except Exception as exc:
        logger.error(f"[payments/webhook] Payload decode error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed payload.",
        )

    logger.info(f"[payments/webhook] txn={merchant_txn_id} state={state}")

    # ── 4. Ignore non-success events ──────────────────────────────────────────
    # Return 200 so PhonePe stops retrying; we record the failure path only on COMPLETED.
    if state != "COMPLETED":
        # Optionally mark the transaction as FAILED for PAYMENT_ERROR states
        if state in {"PAYMENT_ERROR", "PAYMENT_CANCELLED", "TIMED_OUT"}:
            result = await db.execute(
                select(PaymentTransaction).where(
                    PaymentTransaction.merchant_txn_id == merchant_txn_id
                )
            )
            txn: Optional[PaymentTransaction] = result.scalar_one_or_none()
            if txn and txn.status == "PENDING":
                txn.status = "FAILED"
                db.add(txn)
                await db.commit()
                logger.info(f"[payments/webhook] marked txn={merchant_txn_id} as FAILED ({state})")
        return {"status": "ignored", "state": state}

    # ── 5. Look up transaction ────────────────────────────────────────────────
    result = await db.execute(
        select(PaymentTransaction).where(
            PaymentTransaction.merchant_txn_id == merchant_txn_id
        )
    )
    txn: Optional[PaymentTransaction] = result.scalar_one_or_none()

    if not txn:
        logger.error(f"[payments/webhook] No PaymentTransaction found for txn={merchant_txn_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction record not found.",
        )

    # ── 6. Idempotency guard ──────────────────────────────────────────────────
    if txn.status == "COMPLETED":
        logger.info(f"[payments/webhook] txn={merchant_txn_id} already processed — skipping")
        return {"status": "already_credited"}

    # ── 7. Credit the user ────────────────────────────────────────────────────
    user: Optional[User] = await db.get(User, txn.user_id)
    if not user:
        logger.error(f"[payments/webhook] User {txn.user_id} not found for txn={merchant_txn_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if txn.package_id.startswith("sub_"):
        # Subscription plan purchase — grant plan's monthly allocation and update plan
        sub_plan_key = txn.package_id[4:]  # "STARTER", "CREATOR", "PRO"
        sub_tier = BILLING_TIERS.get(sub_plan_key)
        if sub_tier:
            credits_to_add = sub_tier["min_limit"]
            chars_to_add   = sub_tier["char_limit"]
            user.subscription_plan = sub_plan_key.lower()
        else:
            # Fallback: treat as a credit pack using the user's current plan rates
            current_plan = user.subscription_plan or "free"
            fallback_tier = PROFITABLE_TIERS.get(current_plan, PROFITABLE_TIERS["free"])
            credits_to_add = txn.credits
            chars_to_add   = fallback_tier["chars_per_credit_minute"] * txn.credits
    else:
        # One-time credit top-up pack — chars based on the user's current plan rate
        current_plan = user.subscription_plan or "free"
        pack_tier    = PROFITABLE_TIERS.get(current_plan, PROFITABLE_TIERS["free"])
        credits_to_add = txn.credits
        chars_to_add   = pack_tier["chars_per_credit_minute"] * txn.credits

    user.credit_minutes += credits_to_add
    user.chars_balance   = (user.chars_balance or 0) + chars_to_add
    txn.status = "COMPLETED"
    db.add(user)
    db.add(txn)
    await db.commit()

    logger.info(
        f"[payments/webhook] Credited user={user.id} +{credits_to_add} min "
        f"+{chars_to_add} chars (pkg={txn.package_id}, plan={user.subscription_plan}) "
        f"→ balance={user.credit_minutes} min / {user.chars_balance} chars"
    )
    return {"status": "OK", "credited": credits_to_add}
