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
import json
import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import update

import config
from config import PROFITABLE_TIERS
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

# Structured error payload stored in render_jobs.error_message when a job is
# blocked by the character-density guard. Frontend should parse this as JSON.
_DENSE_TEXT_ERROR = json.dumps({
    "error_code": "DENSE_TEXT_LIMIT",
    "message": (
        "This video contains too many spoken words for your remaining plan balance. "
        "Please shorten the script or upgrade your subscription plan to process "
        "word-dense content."
    ),
})


# ─────────────────────────────────────────────────────────────────────────────
# Async background job — called by routers/videos.py BackgroundTasks
# ─────────────────────────────────────────────────────────────────────────────

async def run_background_job(
    job_id: str,
    project_id: str,
    user_id: str,
    video_local_path: str,
    target_lang: str,
    subtitle_lang: str = "en",
) -> None:
    """
    Full render pipeline for one job. Runs as an async FastAPI background task.

    Pipeline stages
    ───────────────
    1.  Mark job PROCESSING in the DB.
    2.  Submit video to ElevenLabs Dubbing API; poll until complete; download
        the dubbed MP3 and SRT transcript (blocking I/O → thread-pool).
    2.5 CHARACTER DENSITY GUARD
        Compute incoming_char_count = Σ len(subtitle_cue.text).
        Fetch the user's current subscription_plan and chars_balance.
        If incoming_char_count > chars_balance → mark FAILED (DENSE_TEXT_LIMIT),
        skip all further processing, and do NOT deduct any credit.
    3.  MoviePy + Pillow caption burn (CPU-bound → thread-pool).
    4.  Archive finished MP4 to permanent local storage.
    5.  Mark job COMPLETED.
    6.  Atomic dual-deduction:
          UPDATE users
             SET credit_minutes  = credit_minutes  - 1,
                 chars_balance   = chars_balance   - :incoming_char_count
           WHERE id              = :user_id
             AND credit_minutes  >= 1
             AND chars_balance   >= :incoming_char_count;
        RETURNING id confirms the row was updated; a miss means a concurrent
        job consumed the balance in the window between the guard and commit.

    Status transitions written to render_jobs:
        PENDING  →  PROCESSING  (immediately on entry)
        PROCESSING → COMPLETED  (after output file is saved)
        PROCESSING → FAILED     (DENSE_TEXT_LIMIT or any unhandled exception)
    """
    # Late import breaks the circular dependency chain at module load time
    from database import AsyncSessionLocal
    from models.db_models import RenderJob, User

    job_temp_dir = os.path.join(config.TEMP_DIR, job_id)
    os.makedirs(job_temp_dir, exist_ok=True)

    # Populated at stage 2; used at stage 2.5 and stage 6.
    incoming_char_count: int = 0

    logger.info(
        f"[pipeline] START job={job_id} project={project_id} "
        f"user={user_id} lang={target_lang}"
    )

    # ── DB status helper ─────────────────────────────────────────────────────
    async def set_status(new_status: str, **fields) -> None:
        """Writes a partial update to the render_jobs row."""
        payload = {"status": new_status, "updated_at": datetime.utcnow(), **fields}
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(RenderJob)
                    .where(RenderJob.id == uuid.UUID(job_id))
                    .values(**payload)
                )

    try:
        # ── Milestone 1: STARTED (5%) ─────────────────────────────────────────
        await set_status("STARTED", progress_percentage=5)
        logger.info(f"[pipeline] job={job_id} → STARTED")

        # ── Milestone 2: EXTRACTED_AUDIO (20%) — submitting to ElevenLabs ────
        # Status is set before the blocking call so the UI immediately reflects
        # that audio extraction is underway while the thread is running.
        await set_status("EXTRACTED_AUDIO", progress_percentage=20)
        logger.info(f"[pipeline] job={job_id} → EXTRACTED_AUDIO  (submitting to ElevenLabs)")

        ai = AIOrchestrator()
        dubbed_audio_path, subtitles_data, actual_sub_lang = await asyncio.to_thread(
            ai.generate_dubbed_audio,
            video_local_path,
            target_lang,
            job_temp_dir,
            subtitle_lang,
        )

        # ── Milestone 3: CLONED_AUDIO (45%) — ElevenLabs returned ────────────
        await set_status("CLONED_AUDIO", progress_percentage=45)
        logger.info(
            f"[pipeline] job={job_id} → CLONED_AUDIO  "
            f"({len(subtitles_data)} subtitle cues)"
        )

        # ── Character density guard ───────────────────────────────────────────
        incoming_char_count = sum(len(cue["text"]) for cue in subtitles_data)

        async with AsyncSessionLocal() as session:
            user_check: Optional[User] = await session.get(User, uuid.UUID(user_id))
            if not user_check:
                raise RuntimeError(
                    f"[pipeline] User {user_id} disappeared during char check — aborting job."
                )
            plan: str            = user_check.subscription_plan or "free"
            chars_remaining: int = user_check.chars_balance or 0

        tier = PROFITABLE_TIERS.get(plan, PROFITABLE_TIERS["free"])

        logger.info(
            f"[pipeline] job={job_id} char check | "
            f"plan={plan} | tier_limit={tier['chars_per_credit_minute']} | "
            f"incoming={incoming_char_count} | remaining={chars_remaining}"
        )

        if plan != "free" and incoming_char_count > chars_remaining:
            await set_status("FAILED", progress_percentage=0, error_message=_DENSE_TEXT_ERROR)
            logger.warning(
                f"[pipeline] job={job_id} BLOCKED — DENSE_TEXT_LIMIT | "
                f"incoming={incoming_char_count} > remaining={chars_remaining} | plan={plan}"
            )
            return

        logger.info(
            f"[pipeline] job={job_id} char guard PASSED "
            f"({incoming_char_count} ≤ {chars_remaining})"
        )

        # ── Milestone 4: DUBBING_COMPLETED (65%) — guard passed ──────────────
        await set_status("DUBBING_COMPLETED", progress_percentage=65)
        logger.info(f"[pipeline] job={job_id} → DUBBING_COMPLETED")

        # ── Milestone 5: APPENDING_TO_VIDEO (80%) — starting MoviePy burn ────
        output_path = os.path.join(job_temp_dir, f"output_{job_id}.mp4")
        engine = VideoEngine()
        await set_status("APPENDING_TO_VIDEO", progress_percentage=80)
        logger.info(f"[pipeline] job={job_id} → APPENDING_TO_VIDEO")

        final_local_path: str = await asyncio.to_thread(
            _burn_video,
            engine,
            video_local_path,
            dubbed_audio_path,
            subtitles_data,
            output_path,
            target_lang,
            actual_sub_lang,
        )

        # ── Milestone 6: RENDERING_IN_PROGRESS (95%) — burn done, archiving ──
        await set_status("RENDERING_IN_PROGRESS", progress_percentage=95)
        logger.info(f"[pipeline] job={job_id} → RENDERING_IN_PROGRESS  render done → {final_local_path}")

        archived_path = _archive_output(user_id, job_id, final_local_path)
        logger.info(f"[pipeline] job={job_id} archived → {archived_path}")

        # ── Milestone 7: COMPLETED (100%) ────────────────────────────────────
        await set_status("COMPLETED", progress_percentage=100, output_video_path=archived_path)
        logger.info(f"[pipeline] job={job_id} → COMPLETED")

        # ── Stage 6: Atomic dual deduction (skipped for free plan testing) ──────
        if plan == "free":
            logger.info(f"[pipeline] job={job_id} skipping credit deduction — free plan testing mode")
            return
        # Deduct exactly 1 credit minute AND the actual transcript character
        # count in a single atomic UPDATE with WHERE guards on both columns.
        # The WHERE guards prevent going negative even under concurrent load
        # (e.g., two jobs finishing simultaneously for the same user).
        # If RETURNING yields None, the update conditions were unmet — log and
        # continue; the job is already COMPLETED so the user received the output.
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    result = await session.execute(
                        update(User)
                        .where(User.id == uuid.UUID(user_id))
                        .where(User.credit_minutes >= 1)
                        .where(User.chars_balance >= incoming_char_count)
                        .values(
                            credit_minutes=User.credit_minutes - 1,
                            chars_balance=User.chars_balance - incoming_char_count,
                        )
                        .returning(User.id)
                    )
                    updated_id = result.scalar_one_or_none()

            if updated_id:
                logger.info(
                    f"[pipeline] job={job_id} deducted → "
                    f"1 credit minute + {incoming_char_count} chars "
                    f"for user={user_id}"
                )
            else:
                logger.warning(
                    f"[pipeline] job={job_id} deduction skipped — "
                    f"WHERE guards unmet (concurrent balance change?). "
                    f"user={user_id} incoming_chars={incoming_char_count}"
                )

        except Exception as credit_exc:
            # Non-fatal: output is saved and job is COMPLETED.
            # Log for ops alerting but do not re-raise.
            logger.warning(
                f"[pipeline] job={job_id} deduction error (non-fatal): {credit_exc}"
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
    subtitle_lang: str = "",
) -> str:
    """Thin wrapper so asyncio.to_thread can call burn_assets positionally."""
    return engine.burn_assets(
        original_video_path=original_video_path,
        dubbed_audio_path=dubbed_audio_path,
        subtitles_data=subtitles_data,
        output_path=output_path,
        target_lang=subtitle_lang or target_lang,
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
