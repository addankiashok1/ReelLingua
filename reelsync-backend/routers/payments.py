import base64
import hashlib
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models.db_models import User

logger = logging.getLogger(__name__)
router = APIRouter()

# Credits awarded per PhonePe payment state.
# Extend this dict when you add tiered pricing (e.g. "plan_60": 60).
_CREDITS_BY_TRANSACTION_PREFIX: dict[str, int] = {}
_DEFAULT_CREDIT_GRANT = 15


def _compute_phonepe_checksum(base64_payload: str) -> str:
    """
    PhonePe S2S checksum:
        SHA256(base64_payload + PHONEPE_SALT_KEY) + "###" + PHONEPE_SALT_INDEX
    """
    raw = base64_payload + settings.phonepe_salt_key
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{digest}###{settings.phonepe_salt_index}"


@router.post(
    "/phonepe-callback",
    status_code=status.HTTP_200_OK,
    summary="PhonePe S2S payment callback",
    include_in_schema=False,  # hide from public Swagger; internal webhook only
)
async def phonepe_callback(
    request: Request,
    x_verify: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    PhonePe calls this endpoint after every payment attempt.

    Security flow:
    1. Read the raw form field `response` (Base64-encoded JSON).
    2. Recompute our checksum and compare against X-VERIFY header.
    3. If mismatch → 401 (blocks spoofed callbacks).
    4. Decode payload, check state == "COMPLETED".
    5. Credit the user identified by merchantTransactionId.
    """
    # ── Read raw body ────────────────────────────────────────────────────────
    form = await request.form()
    base64_payload: str = form.get("response", "")

    if not base64_payload:
        # PhonePe sometimes sends JSON body instead of form data
        try:
            body = await request.json()
            base64_payload = body.get("response", "")
        except Exception:
            pass

    if not base64_payload:
        logger.warning("[phonepe-callback] Empty payload received")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing response payload.",
        )

    # ── Signature verification ───────────────────────────────────────────────
    expected = _compute_phonepe_checksum(base64_payload)
    if not x_verify or x_verify != expected:
        logger.warning(
            "[phonepe-callback] Checksum mismatch. "
            f"received={x_verify!r} expected={expected!r}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Checksum verification failed.",
        )

    # ── Decode payload ───────────────────────────────────────────────────────
    try:
        decoded = base64.b64decode(base64_payload).decode("utf-8")
        outer = json.loads(decoded)
        # PhonePe wraps the real payload one level deep under "data"
        inner = outer.get("data", outer)
        state: str = inner.get("state", "")
        merchant_txn_id: str = inner.get("merchantTransactionId", "")
    except Exception as exc:
        logger.error(f"[phonepe-callback] Payload decode error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed payload.",
        )

    logger.info(
        f"[phonepe-callback] txn={merchant_txn_id} state={state}"
    )

    # ── Only act on successful payments ─────────────────────────────────────
    if state != "COMPLETED":
        # Return 200 so PhonePe stops retrying; we just don't credit.
        return {"status": "ignored", "state": state}

    # ── Resolve user from merchantTransactionId ──────────────────────────────
    # Convention: merchantTransactionId = "<user_id>_<timestamp>" or just "<user_id>"
    user_id_str = merchant_txn_id.split("_")[0]

    try:
        import uuid
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        logger.error(
            f"[phonepe-callback] Cannot parse user UUID from txn={merchant_txn_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="merchantTransactionId does not encode a valid user UUID.",
        )

    user: Optional[User] = await db.get(User, user_uuid)
    if not user:
        logger.error(f"[phonepe-callback] No user found for id={user_uuid}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # ── Credit the user ──────────────────────────────────────────────────────
    credits = _DEFAULT_CREDIT_GRANT
    user.credit_minutes += credits
    await db.commit()

    logger.info(
        f"[phonepe-callback] Credited user={user_uuid} +{credits} min "
        f"→ total={user.credit_minutes}"
    )

    return {"status": "OK", "credited": credits}
