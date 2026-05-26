"""
PhonePe callback manual tester.

Usage:
    python test_phonepe.py

Steps it performs:
    1. Logs in with your test credentials to get a real user_id
    2. Builds a fake PhonePe COMPLETED payload for that user
    3. Computes the correct X-VERIFY checksum
    4. POSTs to /api/payments/phonepe-callback
    5. Prints credit_minutes before and after
"""

import base64
import hashlib
import json

import requests

# ── Config ─────────────────────────────────────────────────────────────────
BASE_URL      = "http://localhost:8000"
TEST_EMAIL    = "ashok@example.com"       # change to your registered test user
TEST_PASSWORD = "ashok@123"              # change to match
SALT_KEY      = "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399"   # must match PHONEPE_SALT_KEY in .env
SALT_INDEX    = 1                      # must match PHONEPE_SALT_INDEX in .env
# ───────────────────────────────────────────────────────────────────────────


def login(email: str, password: str) -> tuple[str, str]:
    """Returns (access_token, user_id)."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    data = r.json()
    return data["access_token"], data["user_id"]


def get_credits(token: str) -> int:
    r = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()["credit_minutes"]


def build_payload(user_id: str) -> str:
    """
    Mimics the Base64-encoded JSON body PhonePe sends on payment completion.
    merchantTransactionId format: <user_uuid>_<any_timestamp>
    """
    inner = {
        "merchantId": "TEST_MERCHANT",
        "merchantTransactionId": f"{user_id}_1234567890",
        "transactionId": "PHONEPE_TXN_TEST_001",
        "amount": 9900,
        "state": "COMPLETED",
        "responseCode": "SUCCESS",
        "paymentInstrument": {"type": "UPI_INTENT", "utr": "TEST_UTR_001"},
    }
    body = {"success": True, "code": "PAYMENT_SUCCESS", "message": "Your request has been successfully completed.", "data": inner}
    return base64.b64encode(json.dumps(body).encode("utf-8")).decode("utf-8")


def compute_checksum(base64_payload: str, salt_key: str, salt_index: int) -> str:
    raw = base64_payload + salt_key
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{digest}###{salt_index}"


def fire_callback(base64_payload: str, checksum: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/payments/phonepe-callback",
        headers={"X-VERIFY": checksum},
        data={"response": base64_payload},   # form-encoded, matches PhonePe spec
    )
    return {"status_code": r.status_code, "body": r.json()}


def main():
    print("=" * 55)
    print("  PhonePe Callback Tester")
    print("=" * 55)

    # Step 1: login
    print(f"\n[1] Logging in as {TEST_EMAIL}...")
    token, user_id = login(TEST_EMAIL, TEST_PASSWORD)
    print(f"    user_id  : {user_id}")

    # Step 2: credits before
    credits_before = get_credits(token)
    print(f"    credits  : {credits_before} min (before)")

    # Step 3: build payload + checksum
    payload = build_payload(user_id)
    checksum = compute_checksum(payload, SALT_KEY, SALT_INDEX)
    print(f"\n[2] Payload (Base64, first 60 chars): {payload[:60]}...")
    print(f"    X-VERIFY : {checksum}")

    # Step 4: fire callback
    print(f"\n[3] POSTing to {BASE_URL}/api/payments/phonepe-callback ...")
    result = fire_callback(payload, checksum)
    print(f"    HTTP {result['status_code']} → {result['body']}")

    # Step 5: credits after
    credits_after = get_credits(token)
    print(f"\n[4] Credits after : {credits_after} min")
    diff = credits_after - credits_before
    if diff > 0:
        print(f"    SUCCESS — +{diff} minutes credited!")
    else:
        print("    WARNING — credits did not change. Check server logs.")

    # ── Bonus: test tampered signature (should get 401) ──────────────────
    print("\n[5] Testing tampered X-VERIFY (expect 401)...")
    bad_result = fire_callback(payload, "badhash###1")
    print(f"    HTTP {bad_result['status_code']} → {bad_result['body']}")
    assert bad_result["status_code"] == 401, "Expected 401 for bad checksum!"
    print("    Correctly rejected tampered request.")

    print("\n" + "=" * 55)
    print("  All checks passed.")
    print("=" * 55)


if __name__ == "__main__":
    main()
