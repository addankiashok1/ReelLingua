import logging
import os
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import config
from config import settings
from database import engine, get_db
from models.db_models import Base, OTPVerification, PasswordResetOTP, PaymentTransaction, User  # noqa: F401 — registers models with Base
from routers import auth, payments, user, videos
from routers.auth import ALGORITHM

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

os.makedirs(config.TEMP_DIR, exist_ok=True)
os.makedirs(os.path.join(config.STORAGE_DIR, "inputs"), exist_ok=True)
os.makedirs(os.path.join(config.STORAGE_DIR, "outputs"), exist_ok=True)
os.makedirs(os.path.join(config.STORAGE_DIR, "profiles"), exist_ok=True)

app = FastAPI(
    title="ReelSync AI",
    version="2.0.0",
    description=(
        "AI-powered multilingual video dubbing and caption service. "
        "Upload an MP4, choose a target language, and receive a fully "
        "dubbed, captioned video — powered by ElevenLabs + MoviePy."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(auth.router,     prefix="/api/auth",     tags=["Authentication"])
app.include_router(videos.router,   prefix="/api/videos",   tags=["Videos"])
app.include_router(payments.router, prefix="/api/payments", tags=["Payments"])
app.include_router(user.router,     prefix="/api/user",     tags=["User"])

app.mount(
    "/profiles",
    StaticFiles(directory=os.path.join(config.STORAGE_DIR, "profiles")),
    name="profiles",
)


# ─── Authenticated video download ─────────────────────────────────────────────
# Replaces the open StaticFiles mount. Verifies the JWT token passed as a
# query parameter, then serves the file exclusively from the requesting user's
# own output directory. A user cannot access another user's output even if they
# know the exact filename.

@app.get("/downloads/{filename}", tags=["Downloads"])
async def download_video(
    filename: str,
    token: str = Query(..., description="JWT access token"),
    db: AsyncSession = Depends(get_db),
):
    # ── Validate JWT ─────────────────────────────────────────────────────────
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
        user_id_str: str = payload.get("sub", "")
        if not user_id_str:
            raise JWTError("Missing subject")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    # ── Resolve user ──────────────────────────────────────────────────────────
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token subject.",
        )

    user: User | None = await db.get(User, user_uuid)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
        )

    # ── Serve only from the user's own output directory ───────────────────────
    # Path traversal guard: reject any filename containing directory separators
    if os.sep in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename.",
        )

    file_path = os.path.join(config.STORAGE_DIR, "outputs", str(user.id), filename)

    if not os.path.isfile(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found.",
        )

    logger.info(f"[download] user={user.id} file={filename}")
    return FileResponse(
        file_path,
        media_type="video/mp4",
        filename=filename,
    )


@app.on_event("startup")
async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20) UNIQUE"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_phone_number ON users(phone_number)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url VARCHAR(500)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "subscription_plan VARCHAR(50) NOT NULL DEFAULT 'free'"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "chars_balance INTEGER NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS "
            "subtitle_language VARCHAR(10)"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS "
            "progress_percentage INTEGER NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs "
            "ALTER COLUMN status TYPE VARCHAR(30)"
        ))
        # One-time backfill: users created before the chars_balance column was
        # added received DEFAULT 0.  Restore their budget based on remaining
        # credit_minutes so the character-density guard doesn't block them.
        await conn.execute(text(
            "UPDATE users "
            "SET chars_balance = credit_minutes * 750 "
            "WHERE chars_balance = 0 AND credit_minutes > 0"
        ))
    logging.getLogger(__name__).info("Database tables and columns verified.")


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "ReelSync AI", "version": "2.0.0"}


logger = logging.getLogger(__name__)
