import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

# ─── Subscription tier definitions ───────────────────────────────────────────
# Imported from billing.py (single source of truth). Lowercase keys map to the
# subscription_plan values stored in the DB ("free", "starter", "creator", "pro").
# Imported by: core/pipeline.py, routers/auth.py, routers/payments.py, routers/videos.py
from billing import FINAL_TIERS as _ft
PROFITABLE_TIERS: dict[str, dict] = {k.lower(): v for k, v in _ft.items()}
del _ft


class Settings(BaseSettings):
    # Phase 1 — ElevenLabs
    elevenlabs_api_key: str

    # Phase 2 — Local PostgreSQL
    database_url: str
    jwt_secret_key: str

    # Phase 2 — Supabase (optional; kept so existing .env files don't break)
    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None

    # Phase 3 — PhonePe payment gateway
    phonepe_merchant_id: str = ""
    phonepe_salt_key: str = ""
    phonepe_salt_index: int = 1
    # Sandbox: https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay
    # Production: https://api.phonepe.com/apis/hermes/pg/v1/pay
    phonepe_api_url: str = "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay"
    # Backend public origin (used as callbackUrl sent to PhonePe)
    base_url: str = "http://localhost:8000"
    # Frontend public origin (used as redirectUrl after payment)
    frontend_url: str = "http://localhost:3000"

    # Phase 4 — Gmail SMTP for OTP emails
    smtp_user: str = ""
    smtp_password: str = ""

    model_config = SettingsConfigDict(
        # Check reelsync-backend/.env first, fall back to repo root .env
        env_file=(
            os.path.join(os.path.dirname(__file__), ".env"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        ),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()

# Uppercase aliases preserve Phase 1 import style (config.ELEVENLABS_API_KEY)
ELEVENLABS_API_KEY: str = settings.elevenlabs_api_key
TEMP_DIR: str = os.path.join(os.path.dirname(__file__), "temp_outputs")
STORAGE_DIR: str = os.path.join(os.path.dirname(__file__), "local_storage")
THUMBNAILS_DIR: str = os.path.join(STORAGE_DIR, "thumbnails")

# Maximum number of render jobs that may execute concurrently.
# Each job ties up one ElevenLabs API call + one MoviePy thread, so keep this
# conservative relative to your CPU count and ElevenLabs rate limits.
# Override by setting MAX_CONCURRENT_JOBS in the environment or .env file.
MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))
