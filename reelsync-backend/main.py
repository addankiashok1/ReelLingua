import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import config
from database import engine
from models.db_models import Base
from routers import auth, payments, videos

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

# Ensure local working directories exist before the server accepts requests
os.makedirs(config.TEMP_DIR, exist_ok=True)
os.makedirs(os.path.join(config.STORAGE_DIR, "inputs"), exist_ok=True)
os.makedirs(os.path.join(config.STORAGE_DIR, "outputs"), exist_ok=True)

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

# Serve processed videos directly from local_storage/outputs/
# e.g. GET http://localhost:8000/downloads/processed_reel.mp4
_outputs_dir = os.path.join(config.STORAGE_DIR, "outputs")
app.mount("/downloads", StaticFiles(directory=_outputs_dir), name="downloads")


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
    logging.getLogger(__name__).info("Database tables and columns verified.")


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "ReelSync AI", "version": "2.0.0"}
