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
from config import MAX_CONCURRENT_JOBS, PROFITABLE_TIERS
from core.ai_client import get_orchestrator, parse_srt
from core.subtitle_translator import translate_srt_file, translate_subtitles_data
from core.video_processor import VideoEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger(__name__)

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
OUTPUT_DIR = os.path.join(config.STORAGE_DIR, "outputs")

# Global concurrency gate — at most MAX_CONCURRENT_JOBS jobs may run the heavy
# pipeline stages (ElevenLabs I/O + MoviePy render) at the same time.
# Jobs that arrive while all slots are taken remain PENDING in the DB until a
# slot opens.  Python 3.10+ asyncio primitives don't bind to a loop at creation,
# so module-level instantiation is safe.
_job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

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
    source_lang: str = "auto",
    scene_name: str = "",
    output_height: int = 0,
    output_aspect_ratio: str = "original",
    watermark_text: str = "ReelSync AI",
    upscale_required: bool = False,
) -> None:
    """
    Full render pipeline for one job. Runs as an async FastAPI background task.

    Concurrency
    ───────────
    At most MAX_CONCURRENT_JOBS jobs execute the heavy stages simultaneously.
    Excess jobs remain PENDING in the DB and are picked up as slots open.

    Pipeline stages
    ───────────────
    1.  Acquire semaphore slot (job stays PENDING while waiting).
    2.  Mark job STARTED in the DB.
    3.  Submit video to ElevenLabs Dubbing API; poll until complete; download
        the dubbed MP3 and SRT transcript (blocking I/O → thread-pool).
    3.5 CHARACTER DENSITY GUARD
        Compute incoming_char_count = Σ len(subtitle_cue.text).
        Fetch the user's current subscription_plan and chars_balance.
        If incoming_char_count > chars_balance → mark FAILED (DENSE_TEXT_LIMIT),
        skip all further processing, and do NOT deduct any credit.
    4.  MoviePy + Pillow caption burn (CPU-bound → thread-pool).
    5.  Archive finished MP4 to permanent local storage.
    6.  Mark job COMPLETED.
    7.  Atomic dual-deduction:
          UPDATE users
             SET credit_minutes  = credit_minutes  - 1,
                 chars_balance   = chars_balance   - :incoming_char_count
           WHERE id              = :user_id
             AND credit_minutes  >= 1
             AND chars_balance   >= :incoming_char_count;
        RETURNING id confirms the row was updated; a miss means a concurrent
        job consumed the balance in the window between the guard and commit.

    Status transitions written to render_jobs:
        PENDING  →  STARTED     (on semaphore slot acquisition)
        STARTED  →  COMPLETED   (after output file is saved)
        STARTED  →  FAILED      (DENSE_TEXT_LIMIT or any unhandled exception)
    """
    # Late import breaks the circular dependency chain at module load time
    from database import AsyncSessionLocal
    from models.db_models import RenderJob, User

    # ── DB status helper — defined before semaphore so it's always in scope ──
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

    logger.info(
        f"[pipeline] QUEUED job={job_id} project={project_id} "
        f"user={user_id} lang={target_lang} "
        f"— waiting for processing slot ({MAX_CONCURRENT_JOBS} max concurrent)"
    )

    async with _job_semaphore:
        logger.info(f"[pipeline] START job={job_id} — slot acquired")

        job_temp_dir = os.path.join(config.TEMP_DIR, job_id)
        os.makedirs(job_temp_dir, exist_ok=True)

        # Populated after ElevenLabs returns; used by char guard and credit deduction.
        incoming_char_count: int = 0

        try:
            # ── Milestone 1: STARTED (5%) ─────────────────────────────────────────
            await set_status("STARTED", progress_percentage=5)
            logger.info(f"[pipeline] job={job_id} → STARTED")

            # ── Pre-flight: read subscription plan so apply_watermark is ready ─
            # The char-guard later does its own fresh read for chars_balance.
            async with AsyncSessionLocal() as _pre_session:
                _pre_user: Optional[User] = await _pre_session.get(User, uuid.UUID(user_id))
                if not _pre_user:
                    raise RuntimeError(f"[pipeline] User {user_id} not found — aborting job.")
                plan: str       = (_pre_user.subscription_plan or "free").lower()
                apply_watermark = (plan == "free")
            logger.info(
                f"[pipeline] job={job_id} plan={plan} apply_watermark={apply_watermark}"
            )

            # ── Milestone 2: EXTRACTED_AUDIO (20%) — submitting to ElevenLabs ────
            # Status is set before the blocking call so the UI immediately reflects
            # that audio extraction is underway while the thread is running.
            await set_status("EXTRACTED_AUDIO", progress_percentage=20)
            logger.info(f"[pipeline] job={job_id} → EXTRACTED_AUDIO  (submitting to ElevenLabs)")

            # --- TEMPORARY DISABLED FOR DEBUGGING ---
            # ai = get_orchestrator()
            # dubbed_audio_path, subtitles_data, detected_src_lang = await asyncio.to_thread(
            #     ai.generate_dubbed_audio,
            #     video_local_path,
            #     target_lang,
            #     job_temp_dir,
            #     source_lang,
            #     apply_watermark,
            # )
            # ------------------------------------------
            # MOCK BYPASS: Direct audio track pass-through from original uploaded file.
            # Use the original video file audio so the downstream render pipeline remains functional.
            dubbed_audio_path = video_local_path
            subtitles_data = []
            detected_src_lang = source_lang if source_lang != "auto" else None
            logger.warning("⚠️ ElevenLabs bypassed: using original audio track for rendering tests.")

            # ── Milestone 3: CLONED_AUDIO (45%) — ElevenLabs returned ────────────
            # Write detected source language back to the job row so the dashboard
            # shows the real original language instead of "auto".
            src_lang_update = {"source_language": detected_src_lang} if detected_src_lang else {}
            await set_status("CLONED_AUDIO", progress_percentage=45, **src_lang_update)
            logger.info(
                f"[pipeline] job={job_id} → CLONED_AUDIO  "
                f"({len(subtitles_data)} subtitle cues, audio_lang={target_lang}, "
                f"source_lang={detected_src_lang or 'unknown'})"
            )

            # ── Subtitle translation layer ────────────────────────────────────────
            # ElevenLabs always returns the SRT in target_lang (the dubbed language).
            # When the user requests a different subtitle language we translate now,
            # before the video burn, so any audio+subtitle language pair is supported.
            #
            # Two-path strategy (file → in-memory) ensures translation never silently
            # falls through to the wrong language:
            #
            #   Path A — file-based (preferred)
            #       Use the saved subtitles_{target_lang}.srt, translate it with
            #       deep-translator, write bypass_subtitles_{subtitle_lang}.srt, re-parse.
            #
            #   Path B — in-memory fallback
            #       If the SRT file is missing for any reason, translate the already-
            #       parsed subtitles_data list directly.  Same result, no filesystem
            #       dependency.
            #
            # Either path updates both subtitles_data AND actual_sub_lang so that:
            #   - The video engine burns the translated (target) text
            #   - Font selection uses the correct script for the subtitle language
            actual_sub_lang: str = target_lang

            if subtitle_lang and subtitle_lang != target_lang:
                await set_status("CLONED_AUDIO", progress_percentage=48)
                logger.info(
                    f"[pipeline] job={job_id} subtitle translation required: "
                    f"audio={target_lang} → subtitles={subtitle_lang}"
                )

                srt_path = os.path.join(job_temp_dir, f"subtitles_{target_lang}.srt")
                translation_succeeded = False

                # ── Path A: file-based translation ───────────────────────────
                if os.path.isfile(srt_path):
                    try:
                        bypass_path, resolved_lang = await asyncio.to_thread(
                            translate_srt_file,
                            srt_path,
                            subtitle_lang,
                            target_lang,
                        )
                        if bypass_path != srt_path:
                            with open(bypass_path, encoding="utf-8") as fh:
                                translated_cues = parse_srt(fh.read())
                            if translated_cues:
                                subtitles_data  = translated_cues
                                actual_sub_lang = resolved_lang
                                translation_succeeded = True
                                logger.info(
                                    f"[pipeline] job={job_id} Path-A translation done → "
                                    f"{len(subtitles_data)} cues in '{actual_sub_lang}' "
                                    f"(saved: {os.path.basename(bypass_path)})"
                                )
                            else:
                                logger.warning(
                                    f"[pipeline] job={job_id} Path-A parsed 0 cues "
                                    f"from translated SRT — trying Path-B"
                                )
                    except Exception as path_a_exc:
                        logger.warning(
                            f"[pipeline] job={job_id} Path-A failed ({path_a_exc}) "
                            f"— trying Path-B"
                        )
                else:
                    logger.warning(
                        f"[pipeline] job={job_id} SRT file not found at {srt_path} "
                        f"— skipping Path-A, using Path-B"
                    )

                # ── Path B: in-memory fallback ────────────────────────────────
                if not translation_succeeded:
                    try:
                        translated_cues = await asyncio.to_thread(
                            translate_subtitles_data,
                            subtitles_data,
                            subtitle_lang,
                            target_lang,
                        )
                        # translate_subtitles_data returns originals on failure;
                        # spot-check that at least one cue text actually changed.
                        changed = sum(
                            1 for orig, xlat in zip(subtitles_data, translated_cues)
                            if orig["text"] != xlat["text"]
                        )
                        if changed:
                            subtitles_data  = translated_cues
                            actual_sub_lang = subtitle_lang
                            translation_succeeded = True
                            logger.info(
                                f"[pipeline] job={job_id} Path-B translation done → "
                                f"{changed}/{len(subtitles_data)} cues changed, "
                                f"lang='{actual_sub_lang}'"
                            )
                        else:
                            logger.warning(
                                f"[pipeline] job={job_id} Path-B returned 0 changed cues "
                                f"— subtitle language stays '{actual_sub_lang}'"
                            )
                    except Exception as path_b_exc:
                        logger.error(
                            f"[pipeline] job={job_id} Path-B also failed ({path_b_exc}) "
                            f"— subtitles will be in audio language '{target_lang}'"
                        )

                if not translation_succeeded:
                    logger.warning(
                        f"[pipeline] job={job_id} SUBTITLE TRANSLATION FAILED — "
                        f"burning '{target_lang}' subtitles instead of '{subtitle_lang}'"
                    )

            # ── Character density guard ───────────────────────────────────────
            incoming_char_count = sum(len(cue["text"]) for cue in subtitles_data)

            async with AsyncSessionLocal() as session:
                user_check: Optional[User] = await session.get(User, uuid.UUID(user_id))
                if not user_check:
                    raise RuntimeError(
                        f"[pipeline] User {user_id} disappeared during char check — aborting job."
                    )
                # Re-read plan in case it changed during the long ElevenLabs call,
                # and get the freshest chars_balance for the density guard.
                plan              = (user_check.subscription_plan or "free").lower()
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

            # ── Milestone 4: DUBBING_COMPLETED (65%) — guard passed ──────────
            await set_status("DUBBING_COMPLETED", progress_percentage=65)
            logger.info(f"[pipeline] job={job_id} → DUBBING_COMPLETED")

            # ── Milestone 5: APPENDING_TO_VIDEO (80%) — starting MoviePy burn ─
            output_path = os.path.join(job_temp_dir, f"output_{job_id}.mp4")
            engine = VideoEngine()
            await set_status("APPENDING_TO_VIDEO", progress_percentage=80)
            logger.info(f"[pipeline] job={job_id} → APPENDING_TO_VIDEO")

            if apply_watermark:
                logger.info(f"[pipeline] job={job_id} free-tier — watermark will be applied")

            final_local_path: str = await asyncio.to_thread(
                _burn_video,
                engine,
                video_local_path,
                dubbed_audio_path,
                subtitles_data,
                output_path,
                target_lang,
                actual_sub_lang,
                apply_watermark,
                output_height,
                output_aspect_ratio,
                watermark_text,
                upscale_required,
            )

            # ── Milestone 6: RENDERING_IN_PROGRESS (95%) — burn done, archiving
            await set_status("RENDERING_IN_PROGRESS", progress_percentage=95)
            logger.info(f"[pipeline] job={job_id} → RENDERING_IN_PROGRESS  render done → {final_local_path}")

            archived_path = _archive_output(user_id, job_id, final_local_path, scene_name)
            logger.info(f"[pipeline] job={job_id} archived → {archived_path}")

            # ── Thumbnail extraction (non-fatal) ─────────────────────────────
            thumb_dir = os.path.join(config.THUMBNAILS_DIR, user_id)
            os.makedirs(thumb_dir, exist_ok=True)
            thumb_path = os.path.join(thumb_dir, f"{job_id}.jpg")
            thumb_ok = await asyncio.to_thread(_extract_thumbnail, archived_path, thumb_path)
            if thumb_ok:
                logger.info(f"[pipeline] job={job_id} thumbnail → {thumb_path}")
            else:
                logger.warning(f"[pipeline] job={job_id} thumbnail extraction failed (non-fatal)")
                thumb_path = None

            # ── Milestone 7: COMPLETED (100%) ────────────────────────────────
            completed_fields: dict = {"output_video_path": archived_path}
            if thumb_path:
                completed_fields["thumbnail_path"] = thumb_path
            await set_status("COMPLETED", progress_percentage=100, **completed_fields)
            logger.info(f"[pipeline] job={job_id} → COMPLETED")

            # ── Atomic dual deduction (skipped for free plan) ─────────────────
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
    watermark: bool = False,
    output_height: int = 0,
    output_aspect_ratio: str = "original",
    watermark_text: str = "ReelSync AI",
    upscale_required: bool = False,
) -> str:
    """Thin wrapper so asyncio.to_thread can call burn_assets positionally."""
    return engine.burn_assets(
        original_video_path=original_video_path,
        dubbed_audio_path=dubbed_audio_path,
        subtitles_data=subtitles_data,
        output_path=output_path,
        target_lang=subtitle_lang or target_lang,
        watermark=watermark,
        output_height=output_height,
        output_aspect_ratio=output_aspect_ratio,
        watermark_text=watermark_text,
        upscale_required=upscale_required,
    )


def _extract_thumbnail(video_path: str, thumbnail_path: str) -> bool:
    """Extract a JPEG thumbnail via ffmpeg. Tries at 1 s; falls back to 0 s for short clips."""
    import subprocess
    for seek in ("00:00:01", "00:00:00"):
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", seek,
                    "-i", video_path,
                    "-vframes", "1",
                    "-q:v", "2",
                    "-update", "1",   # write a single image, not a sequence
                    thumbnail_path,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
            )
            if result.returncode == 0 and os.path.isfile(thumbnail_path):
                return True
        except Exception:
            pass
    return False


def _archive_output(user_id: str, job_id: str, local_path: str, scene_name: str = "") -> str:
    """Moves the finished MP4 to permanent storage, named after the scene if provided."""
    import re
    user_output_dir = os.path.join(OUTPUT_DIR, user_id)
    os.makedirs(user_output_dir, exist_ok=True)
    if scene_name:
        safe = re.sub(r"[^\w\-]", "_", scene_name.strip())[:80].strip("_")
        filename = f"{safe}_{job_id[:8]}.mp4"
    else:
        filename = f"{job_id}.mp4"
    dest = os.path.join(user_output_dir, filename)
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
            dubbed_audio_path, subtitles_data, _ = self.ai.generate_dubbed_audio(
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
