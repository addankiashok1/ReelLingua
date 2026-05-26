"""
core/pipeline.py
-----------------
Contains two pipeline interfaces:

  run_background_job()   — async function called by FastAPI BackgroundTasks.
                           Orchestrates ElevenLabs + MoviePy and writes live
                           status updates to the local PostgreSQL `render_jobs`
                           table via SQLAlchemy async sessions.

  ReelPipeline           — original synchronous CLI class, preserved for
                           test_run.py local usage. Unchanged from Phase 1.
"""

import asyncio
import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import update

import config
from core.ai_client import AIOrchestrator
from core.video_processor import VideoEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger(__name__)

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
OUTPUT_DIR = os.path.join(config.STORAGE_DIR, "outputs")


# ─────────────────────────────────────────────────────────────────────────────
# Async background job — called by routers/videos.py BackgroundTasks
# ─────────────────────────────────────────────────────────────────────────────

async def run_background_job(
    job_id: str,
    project_id: str,
    user_id: str,
    video_local_path: str,
    target_lang: str,
) -> None:
    """
    Full render pipeline for one job. Runs as an async FastAPI background task.

    Heavy blocking work (ElevenLabs HTTP calls, MoviePy video encoding) is
    offloaded to the default thread-pool executor via asyncio.to_thread() so
    the event loop stays responsive to incoming API requests throughout.

    DB writes (status transitions) are purely async and never block the loop.

    Status transitions written to render_jobs:
        PENDING  →  PROCESSING  (immediately on entry)
        PROCESSING → COMPLETED  (after output file is saved)
        PROCESSING → FAILED     (on any unhandled exception)
    """
    # Late import breaks the circular dependency chain at module load time
    from database import AsyncSessionLocal
    from models.db_models import RenderJob, User

    job_temp_dir = os.path.join(config.TEMP_DIR, job_id)
    os.makedirs(job_temp_dir, exist_ok=True)

    logger.info(
        f"[pipeline] START job={job_id} project={project_id} "
        f"user={user_id} lang={target_lang}"
    )

    async def set_status(new_status: str, **fields) -> None:
        """Writes a partial update to the render_jobs row."""
        payload = {
            "status": new_status,
            "updated_at": datetime.utcnow(),
            **fields,
        }
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(RenderJob)
                    .where(RenderJob.id == uuid.UUID(job_id))
                    .values(**payload)
                )

    try:
        # ── 1. Mark PROCESSING ───────────────────────────────────────────────
        await set_status("PROCESSING")
        logger.info(f"[pipeline] job={job_id} → PROCESSING")

        # ── 2. ElevenLabs dubbing (blocking HTTP + polling — runs in thread) ─
        ai = AIOrchestrator()
        dubbed_audio_path, subtitles_data = await asyncio.to_thread(
            ai.generate_dubbed_audio,
            video_local_path,
            target_lang,
            job_temp_dir,
        )
        logger.info(
            f"[pipeline] job={job_id} dubbing done "
            f"({len(subtitles_data)} subtitle cues)"
        )

        # ── 3. MoviePy + Pillow caption burn (CPU-bound — runs in thread) ────
        output_path = os.path.join(job_temp_dir, f"output_{job_id}.mp4")
        engine = VideoEngine()
        final_local_path: str = await asyncio.to_thread(
            _burn_video,
            engine,
            video_local_path,
            dubbed_audio_path,
            subtitles_data,
            output_path,
            target_lang,
        )
        logger.info(f"[pipeline] job={job_id} render done → {final_local_path}")

        # ── 4. Archive output to permanent local storage ──────────────────────
        archived_path = _archive_output(user_id, job_id, final_local_path)
        logger.info(f"[pipeline] job={job_id} archived → {archived_path}")

        # ── 5. Mark COMPLETED ────────────────────────────────────────────────
        await set_status("COMPLETED", output_video_path=archived_path)
        logger.info(f"[pipeline] job={job_id} → COMPLETED")

        # ── 6. Atomic credit deduction ───────────────────────────────────────
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        update(User)
                        .where(User.id == uuid.UUID(user_id))
                        .where(User.credit_minutes >= 1)   # guard against going negative
                        .values(credit_minutes=User.credit_minutes - 1)
                    )
            logger.info(f"[pipeline] job={job_id} 1 credit deducted for user={user_id}")
        except Exception as credit_exc:
            # Non-fatal: output is saved; warn and continue
            logger.warning(
                f"[pipeline] job={job_id} credit deduction failed: {credit_exc}"
            )

    except Exception as exc:
        error_detail = str(exc)[:500]
        logger.exception(f"[pipeline] job={job_id} FAILED: {error_detail}")
        try:
            await set_status("FAILED", error_message=error_detail)
        except Exception as db_exc:
            logger.error(
                f"[pipeline] job={job_id} could not persist FAILED state: {db_exc}"
            )

    finally:
        shutil.rmtree(job_temp_dir, ignore_errors=True)
        logger.info(f"[pipeline] job={job_id} temp dir cleaned up")


# ─── Thread-pool helpers (called via asyncio.to_thread) ──────────────────────

def _burn_video(
    engine: VideoEngine,
    original_video_path: str,
    dubbed_audio_path: str,
    subtitles_data: list,
    output_path: str,
    target_lang: str,
) -> str:
    """Thin wrapper so asyncio.to_thread can call burn_assets positionally."""
    return engine.burn_assets(
        original_video_path=original_video_path,
        dubbed_audio_path=dubbed_audio_path,
        subtitles_data=subtitles_data,
        output_path=output_path,
        target_lang=target_lang,
    )


def _archive_output(user_id: str, job_id: str, local_path: str) -> str:
    """Moves the finished MP4 from the temp dir to permanent local storage."""
    user_output_dir = os.path.join(OUTPUT_DIR, user_id)
    os.makedirs(user_output_dir, exist_ok=True)
    dest = os.path.join(user_output_dir, f"{job_id}.mp4")
    shutil.move(local_path, dest)
    return dest


# ─────────────────────────────────────────────────────────────────────────────
# Original CLI pipeline — preserved unchanged for test_run.py
# ─────────────────────────────────────────────────────────────────────────────

class ReelPipeline:
    def __init__(self):
        self.ai = AIOrchestrator()
        self.engine = VideoEngine()
        self._job_temp_dir: str | None = None

    def run(self, input_video_path: str, target_lang: str) -> str:
        input_video_path = self._validate_input(input_video_path)
        self._job_temp_dir = self._create_job_temp_dir(input_video_path, target_lang)

        logger.info(
            f"Pipeline started | input={input_video_path} | lang={target_lang} "
            f"| temp={self._job_temp_dir}"
        )

        try:
            dubbed_audio_path, subtitles_data = self.ai.generate_dubbed_audio(
                video_path=input_video_path,
                target_lang=target_lang,
                output_dir=self._job_temp_dir,
            )

            output_filename = self._build_output_filename(input_video_path, target_lang)
            output_path = os.path.join(config.TEMP_DIR, output_filename)

            final_path = self.engine.burn_assets(
                original_video_path=input_video_path,
                dubbed_audio_path=dubbed_audio_path,
                subtitles_data=subtitles_data,
                output_path=output_path,
                target_lang=target_lang,
            )

            logger.info(f"Pipeline complete. Output: {final_path}")
            return final_path

        except Exception:
            logger.exception("Pipeline failed.")
            raise

        finally:
            self._cleanup_job_temp_dir()

    def _validate_input(self, path: str) -> str:
        resolved = str(Path(path).resolve())
        if not os.path.isfile(resolved):
            raise FileNotFoundError(f"Input video not found: {resolved}")
        ext = Path(resolved).suffix.lower()
        if ext not in SUPPORTED_VIDEO_EXTENSIONS:
            raise ValueError(
                f"Unsupported file type '{ext}'. "
                f"Supported: {', '.join(SUPPORTED_VIDEO_EXTENSIONS)}"
            )
        return resolved

    def _create_job_temp_dir(self, input_video_path: str, target_lang: str) -> str:
        stem = Path(input_video_path).stem
        job_dir = os.path.join(config.TEMP_DIR, f"{stem}_{target_lang}_working")
        os.makedirs(job_dir, exist_ok=True)
        return job_dir

    def _build_output_filename(self, input_video_path: str, target_lang: str) -> str:
        stem = Path(input_video_path).stem
        return f"{stem}_dubbed_{target_lang}.mp4"

    def _cleanup_job_temp_dir(self) -> None:
        if self._job_temp_dir and os.path.isdir(self._job_temp_dir):
            try:
                shutil.rmtree(self._job_temp_dir)
                logger.info(f"Cleaned up temp dir: {self._job_temp_dir}")
            except Exception as exc:
                logger.warning(f"Could not remove temp dir: {exc}")
