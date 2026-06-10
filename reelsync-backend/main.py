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
from billing import APP_PLAN_TIMERS, LEGACY_BASE_MINUTES
from config import settings
from database import engine, get_db
from models.db_models import Base, ExplorerFolder, Folder, OTPVerification, PasswordResetOTP, PaymentTransaction, SceneEditHistory, User  # noqa: F401 — registers models with Base
from routers import auth, payments, user, videos
from routers import explorer, projects, trash
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
os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(auth.router,     prefix="/api/auth",     tags=["Authentication"])
app.include_router(videos.router,   prefix="/api/videos",   tags=["Videos"])
app.include_router(payments.router, prefix="/api/payments", tags=["Payments"])
app.include_router(user.router,     prefix="/api/user",     tags=["User"])
app.include_router(projects.router, prefix="/api",          tags=["Projects & Folders"])
app.include_router(explorer.router, prefix="/api",          tags=["Explorer"])
app.include_router(trash.router,    prefix="/api",          tags=["Trash"])

app.mount(
    "/profiles",
    StaticFiles(directory=os.path.join(config.STORAGE_DIR, "profiles")),
    name="profiles",
)

app.mount(
    "/thumbnails",
    StaticFiles(directory=config.THUMBNAILS_DIR),
    name="thumbnails",
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


# ─── Authenticated original-video stream ──────────────────────────────────────
# Mirrors /downloads/ but serves from local_storage/inputs/{user_id}/.
# The QC Comparison modal requests this endpoint so users can preview the
# original upload alongside the dubbed output without exposing every file
# via an open StaticFiles mount.

@app.get("/originals/{filename}", tags=["Downloads"])
async def stream_original_video(
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

    original_user: User | None = await db.get(User, user_uuid)
    if not original_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
        )

    # ── Path-traversal guard ──────────────────────────────────────────────────
    if os.sep in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename.",
        )

    # ── Serve only from the requesting user's own inputs directory ────────────
    file_path = os.path.join(config.STORAGE_DIR, "inputs", str(original_user.id), filename)

    if not os.path.isfile(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original file not found.",
        )

    logger.info(f"[originals] user={original_user.id} file={filename}")
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
            "seconds_balance INTEGER NOT NULL DEFAULT 0"
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
        # One-time backfill: convert legacy minute balances into exact
        # second-level balances while preserving any purchased top-up delta
        # above the old base allocation for each plan.
        free_allowed = APP_PLAN_TIMERS["FREE"]["allowed_seconds"]
        starter_allowed = APP_PLAN_TIMERS["STARTER"]["allowed_seconds"]
        creator_allowed = APP_PLAN_TIMERS["CREATOR"]["allowed_seconds"]
        pro_allowed = APP_PLAN_TIMERS["PRO"]["allowed_seconds"]
        free_legacy = LEGACY_BASE_MINUTES["FREE"]
        starter_legacy = LEGACY_BASE_MINUTES["STARTER"]
        creator_legacy = LEGACY_BASE_MINUTES["CREATOR"]
        pro_legacy = LEGACY_BASE_MINUTES["PRO"]
        await conn.execute(text(
            "UPDATE users "
            "SET seconds_balance = CASE lower(subscription_plan) "
            f"WHEN 'starter' THEN {starter_allowed} + GREATEST(credit_minutes - {starter_legacy}, 0) * 60 "
            f"WHEN 'creator' THEN {creator_allowed} + GREATEST(credit_minutes - {creator_legacy}, 0) * 60 "
            f"WHEN 'pro' THEN {pro_allowed} + GREATEST(credit_minutes - {pro_legacy}, 0) * 60 "
            f"ELSE {free_allowed} + GREATEST(credit_minutes - {free_legacy}, 0) * 60 "
            "END "
            "WHERE seconds_balance = 0 AND (credit_minutes > 0 OR chars_balance > 0)"
        ))
        await conn.execute(text(
            "UPDATE users "
            "SET credit_minutes = CAST(CEIL(seconds_balance / 60.0) AS INTEGER)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ALTER COLUMN seconds_balance SET DEFAULT 420"
        ))
        # ── Projects & Folders workspace migration ──────────────────────────
        # folders table (created by Base.metadata.create_all above if not present,
        # but we add an explicit index guard for existing deployments)
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_folders_user_id ON folders(user_id)"
        ))
        # Add folder_id FK to projects (nullable — existing rows keep NULL = root level)
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS "
            "folder_id UUID REFERENCES folders(id) ON DELETE SET NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_projects_folder_id ON projects(folder_id)"
        ))
        # Add per-project language defaults
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_voice_lang VARCHAR(10)"
        ))
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_subtitle_lang VARCHAR(10)"
        ))
        # Make original_video_path nullable (workspace projects exist before video upload)
        await conn.execute(text(
            "ALTER TABLE projects ALTER COLUMN original_video_path DROP NOT NULL"
        ))
        # render_jobs.source_language was added in a prior migration; guard it
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS source_language VARCHAR(10)"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS scene_name VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS input_video_path VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS "
            "is_workspace BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        # ── Explorer: recursive folder tree ────────────────────────────────────
        # explorer_folders is created by create_all above; guard indexes only
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_explorer_folders_project_id "
            "ON explorer_folders(project_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_explorer_folders_parent_id "
            "ON explorer_folders(parent_id)"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS "
            "folder_id UUID REFERENCES explorer_folders(id) ON DELETE CASCADE"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR"
        ))
        # ── Video resolution metadata ──────────────────────────────────────────
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS original_height INTEGER"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS output_height INTEGER"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_render_jobs_folder_id "
            "ON render_jobs(folder_id)"
        ))
        # ── Scene edit history ─────────────────────────────────────────────────
        await conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS scene_edit_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                scene_id UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
                target_voice_lang VARCHAR(10) NOT NULL,
                target_subtitle_lang VARCHAR(10),
                source_language VARCHAR(10),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_scene_edit_history_scene_id "
            "ON scene_edit_history(scene_id)"
        ))
        await conn.execute(text(
            "ALTER TABLE scene_edit_history ADD COLUMN IF NOT EXISTS output_video_path VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE scene_edit_history ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR"
        ))
        # ── Trash system ──────────────────────────────────────────────────────
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE explorer_folders ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ"
        ))
        # Partial indexes — only index rows that are actually in the trash to
        # keep the index small and the cleanup query fast.
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_projects_trashed_at "
            "ON projects(trashed_at) WHERE trashed_at IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_render_jobs_trashed_at "
            "ON render_jobs(trashed_at) WHERE trashed_at IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_explorer_folders_trashed_at "
            "ON explorer_folders(trashed_at) WHERE trashed_at IS NOT NULL"
        ))
    logging.getLogger(__name__).info("Database tables and columns verified.")


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "ReelSync AI", "version": "2.0.0"}


logger = logging.getLogger(__name__)
