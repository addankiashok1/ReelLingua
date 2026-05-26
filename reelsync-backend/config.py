import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    phonepe_salt_key: str = ""
    phonepe_salt_index: int = 1

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
