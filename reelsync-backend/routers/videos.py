"""
routers/videos.py
------------------
HTTP layer only.  Responsibilities:

  1. Validate incoming requests (ownership, credits, language codes).
  2. Persist Project and RenderJob rows to the database.
  3. Queue a background task that runs the full render pipeline.
  4. Return lightweight status/poll responses.

Subtitle translation is NOT done here.
──────────────────────────────────────
The router queues run_background_job() which runs *after* the HTTP response
is already sent.  Placing ElevenLabs I/O or translation network calls here
would block the event-loop thread for several minutes and defeat FastAPI's
async model entirely.

The cross-subtitle decoupling happens inside core/pipeline.py, immediately
after ElevenLabs returns the dubbed audio track, via a two-path translation
strategy (file-based → in-memory fallback) implemented in
core/subtitle_translator.py.  The router's only job is to pass
`subtitle_lang=body.target_subtitle_language` to the background task, which
it already does.
"""

import logging
import os
import subprocess
import uuid
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import PROFITABLE_TIERS, STORAGE_DIR
from core.pipeline import MAX_CONCURRENT_JOBS, _job_semaphore, run_background_job
from database import get_db
from models.db_models import Project, RenderJob, User
from models.schemas import (
    JobStatusResponse,
    ProcessResponse,
    ProjectHistoryItem,
    ProjectUploadResponse,
    VideoProcess,
)
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska", "video/avi"}
INPUT_DIR  = os.path.join(STORAGE_DIR, "inputs")
OUTPUT_DIR = os.path.join(STORAGE_DIR, "outputs")


def get_video_height(file_path: str) -> int:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=height",
                "-of", "json",
                file_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        data = __import__("json").loads(result.stdout)
        height = int(data["streams"][0]["height"])
        return height
    except Exception as exc:
        logger.warning(
            f"[videos] ffprobe failed to detect height for {file_path}: {exc}"
        )
        return 720


# ─── GET /history  (alias: /projects) ────────────────────────────────────────

async def _list_projects(
    db: AsyncSession,
    current_user: User,
) -> List[ProjectHistoryItem]:
    """Shared implementation for /history and /projects endpoints."""
    result = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .where(Project.is_workspace == False)  # noqa: E712 — exclude Projects workspace entries
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    history: List[ProjectHistoryItem] = []
    for project in projects:
        job_result = await db.execute(
            select(RenderJob)
            .where(RenderJob.project_id == project.id)
            .order_by(RenderJob.created_at.desc())
            .limit(1)
        )
        latest_job: Optional[RenderJob] = job_result.scalar_one_or_none()

        history.append(ProjectHistoryItem(
            project_id=str(project.id),
            title=project.title,
            created_at=str(project.created_at),
            latest_job_id=str(latest_job.id) if latest_job else None,
            latest_job_status=latest_job.status if latest_job else None,
            latest_job_language=latest_job.target_language if latest_job else None,
            latest_job_subtitle_language=latest_job.subtitle_language if latest_job else None,
            latest_job_source_language=latest_job.source_language if latest_job else None,
            latest_job_original_height=latest_job.original_height if latest_job else None,
            latest_job_output_height=latest_job.output_height if latest_job else None,
            latest_job_scene_name=latest_job.scene_name if latest_job else None,
            latest_job_created_at=str(latest_job.created_at) if latest_job else None,
            latest_job_updated_at=str(latest_job.updated_at) if latest_job else None,
            output_video_path=latest_job.output_video_path if latest_job else None,
            progress_percentage=latest_job.progress_percentage if latest_job else 0,
        ))

    return history


@router.get(
    "/history",
    response_model=List[ProjectHistoryItem],
    summary="List all video projects for the authenticated user",
)
async def get_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _list_projects(db, current_user)


@router.get(
    "/projects",
    response_model=List[ProjectHistoryItem],
    summary="List all video projects for the authenticated user (dashboard alias)",
)
async def get_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _list_projects(db, current_user)


# ─── DELETE /projects/{project_id} ───────────────────────────────────────────

@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete a project and all its render jobs",
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        proj_uuid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    result = await db.execute(
        select(Project)
        .where(Project.id == proj_uuid)
        .where(Project.user_id == current_user.id)
    )
    project: Optional[Project] = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found or does not belong to you.",
        )

    # Best-effort cleanup of files from disk (non-blocking on failure)
    for path in [project.original_video_path]:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass

    # Fetch and delete output files from all render jobs before cascade
    jobs_result = await db.execute(
        select(RenderJob).where(RenderJob.project_id == project.id)
    )
    for job in jobs_result.scalars().all():
        if job.output_video_path:
            try:
                os.remove(job.output_video_path)
            except OSError:
                pass

    await db.delete(project)  # cascades to render_jobs via FK
    await db.commit()

    logger.info(f"[delete_project] project_id={project_id} user_id={current_user.id}")
    # 204 No Content — no body


# ─── POST /upload ─────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=ProjectUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a raw video and create a project record",
)
async def upload_video(
    file: UploadFile = File(..., description="MP4 video file"),
    title: str = Form(..., min_length=1, max_length=255),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported media type '{file.content_type}'. "
                f"Accepted: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
            ),
        )

    user_id  = str(current_user.id)
    file_uid = uuid.uuid4().hex
    safe_name = (file.filename or "upload.mp4").replace(" ", "_")

    # User-isolated subfolder — prevents cross-account path collisions
    user_input_dir = os.path.join(INPUT_DIR, user_id)
    os.makedirs(user_input_dir, exist_ok=True)

    local_path = os.path.join(user_input_dir, f"{file_uid}_{safe_name}")

    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    with open(local_path, "wb") as fh:
        fh.write(contents)

    logger.info(f"[upload] saved {len(contents):,} bytes → {local_path}")

    project = Project(
        id=uuid.uuid4(),
        user_id=current_user.id,
        title=title.strip(),
        original_video_path=local_path,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    logger.info(f"[upload] project_id={project.id} user_id={user_id}")

    return ProjectUploadResponse(
        project_id=str(project.id),
        title=project.title,
        local_path=local_path,
        message="Upload successful. Use the project_id to start processing.",
    )


# ─── POST /process/{project_id} ───────────────────────────────────────────────

@router.post(
    "/process/{project_id}",
    response_model=ProcessResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue an AI dubbing + caption render job",
)
async def process_video(
    project_id: str,
    body: VideoProcess,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pre-flight checks (synchronous, < 1 ms each):
    ──────────────────────────────────────────────
    1.  Ownership: project must belong to the current user.
    2.  Credit gate: user must have ≥ 1 credit_minute (bypassed for free plan).

    What this endpoint does NOT do
    ───────────────────────────────
    - It does NOT call ElevenLabs.
    - It does NOT translate subtitles.
    - It does NOT render video.

    All of that runs inside run_background_job() *after* this endpoint has
    already returned HTTP 202.  Cross-subtitle translation is decoupled from
    the dubbing language entirely inside core/pipeline.py:

        ElevenLabs dubs in target_voice_language
            ↓
        SRT transcript is always in target_voice_language
            ↓
        If target_subtitle_language ≠ target_voice_language:
            Path A → translate SRT file via deep-translator
            Path B → translate parsed cues in-memory (fallback)
            actual_sub_lang is set to target_subtitle_language on success
            ↓
        _burn_video receives the translated cues + actual_sub_lang
        for correct font selection (Nirmala.ttc for Indic, Arial for Latin, …)

    Both language parameters are passed to the background task below
    as `target_lang` and `subtitle_lang` — that is the full extent of
    this router's cross-subtitle responsibility.

    Character-density guard (async, inside the background job):
    ────────────────────────────────────────────────────────────
    After ElevenLabs returns the transcript the pipeline checks
    incoming_char_count against the user's chars_balance.  On overflow
    the job is marked FAILED with error_code "DENSE_TEXT_LIMIT".
    No credit is deducted in that case.

    Ownership is enforced by filtering on project_id AND current_user.id.
    A valid project_id belonging to another user returns 404 — indistinguishable
    from a non-existent project, preventing enumeration attacks.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == uuid.UUID(project_id))
        .where(Project.user_id == current_user.id)
    )
    project: Optional[Project] = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found or does not belong to you.",
        )

    # ── Pre-flight credit check (bypassed for free plan during testing) ─────────
    plan = (current_user.subscription_plan or "free").lower()
    if plan != "free" and current_user.credit_minutes < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits ({current_user.credit_minutes} remaining). "
                "Top up your account to continue."
            ),
        )

    # ── Pre-flight char-balance awareness (informational, not blocking) ───────
    tier           = PROFITABLE_TIERS.get(plan, PROFITABLE_TIERS["free"])
    chars_remaining = current_user.chars_balance or 0
    chars_per_credit = tier["chars_per_credit_minute"]

    if chars_remaining < chars_per_credit * 0.25:
        logger.warning(
            f"[process] user={current_user.id} chars_remaining={chars_remaining} "
            f"is below 25% of a single credit limit ({chars_per_credit}). "
            "Dense-speech content will likely be blocked by the pipeline guard."
        )

    # ── Language parameters ───────────────────────────────────────────────────
    # target_voice_language    → ElevenLabs dubbing language (validates against 32 codes)
    # target_subtitle_language → subtitle burn language (validates against ~130 codes)
    # source_language          → "auto" (ElevenLabs detects) or explicit BCP-47 code
    #
    # All three are passed verbatim to the background task.  The pipeline handles
    # the decoupling; no language routing logic belongs here.
    voice_lang    = body.target_voice_language
    subtitle_lang = body.target_subtitle_language
    source_lang   = body.source_language  # "auto" or explicit code
    scene_name    = (body.scene_name or "").strip() or None  # None → use job_id as filename
    output_height = body.target_resolution_height or 0
    output_aspect_ratio = body.target_aspect_ratio or "original"
    watermark_text = body.watermark_text or "ReelSync AI"
    native_height = get_video_height(project.original_video_path)
    is_upscale_required = output_height > native_height

    # Always INSERT a brand-new job row with a fresh UUID and timestamp.
    # Re-processing a project never touches prior job records — history is preserved.
    job = RenderJob(
        id=uuid.uuid4(),
        project_id=project.id,
        scene_name=scene_name,
        target_language=voice_lang,
        subtitle_language=subtitle_lang,
        source_language=source_lang,
        original_height=native_height,
        output_height=output_height,
        status="PENDING",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        f"[process] new job_id={job.id} project_id={project_id} "
        f"user_id={current_user.id} voice_lang={voice_lang} "
        f"source_lang={source_lang} subtitle_lang={subtitle_lang} plan={plan} "
        f"chars_remaining={chars_remaining} "
        f"cross_subtitle={'yes' if voice_lang != subtitle_lang else 'no'}"
    )

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(project.id),
        user_id=str(current_user.id),
        video_local_path=project.original_video_path,
        target_lang=voice_lang,
        subtitle_lang=subtitle_lang,
        source_lang=source_lang,
        scene_name=scene_name or "",
        output_height=output_height,
        output_aspect_ratio=output_aspect_ratio,
        watermark_text=watermark_text,
        upscale_required=is_upscale_required,
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(project.id),
        target_language=voice_lang,
        status="PENDING",
        message=f"Render job queued. Poll GET /api/videos/jobs/{job.id} for live status.",
    )


# ─── GET /jobs/{job_id} ───────────────────────────────────────────────────────

@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    summary="Poll the live status of a render job",
)
async def get_job_status(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RenderJob).where(RenderJob.id == uuid.UUID(job_id))
    )
    job: Optional[RenderJob] = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Render job '{job_id}' not found.",
        )

    # Ownership verified through the parent project row
    proj_result = await db.execute(
        select(Project)
        .where(Project.id == job.project_id)
        .where(Project.user_id == current_user.id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this job.",
        )

    return JobStatusResponse(
        job_id=str(job.id),
        project_id=str(job.project_id),
        status=job.status,
        scene_name=job.scene_name,
        target_language=job.target_language,
        source_language=job.source_language,
        output_video_path=job.output_video_path,
        error_message=job.error_message,
        created_at=str(job.created_at),
        updated_at=str(job.updated_at),
        progress_percentage=job.progress_percentage or 0,
    )


# ─── POST /rework/{project_id} ───────────────────────────────────────────────

@router.post(
    "/rework/{project_id}",
    response_model=ProcessResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-process a video as a brand-new versioned project",
)
async def rework_video(
    project_id: str,
    body: VideoProcess,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Creates a brand-new Project that reuses the same uploaded video file.

    Title resolution
    ────────────────
    • If body.scene_name is provided → new project title = scene_name.
    • Otherwise → strip trailing " v<n>" from the original title, count all
      projects by this user that share the same base, and assign
      "{base} v{count + 1}" (so the first rework becomes "Movie v2", etc.).

    The original project and all its render-job history are never touched.
    """
    try:
        orig_uuid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    result = await db.execute(
        select(Project)
        .where(Project.id == orig_uuid)
        .where(Project.user_id == current_user.id)
    )
    original: Optional[Project] = result.scalar_one_or_none()
    if not original:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found or does not belong to you.",
        )

    # ── Credit check ──────────────────────────────────────────────────────────
    plan = (current_user.subscription_plan or "free").lower()
    if plan != "free" and current_user.credit_minutes < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits ({current_user.credit_minutes} remaining).",
        )

    # ── Determine new project title ───────────────────────────────────────────
    import re as _re
    custom_name = (body.scene_name or "").strip()
    if custom_name:
        new_title = custom_name
        scene_name = custom_name
    else:
        # Strip trailing " v<n>" to find the canonical base title
        base = _re.sub(r'\s+v\d+$', '', original.title.strip())
        # Count all projects by this user whose base title matches (includes original)
        siblings_result = await db.execute(
            select(Project.title).where(Project.user_id == current_user.id)
        )
        count = sum(
            1 for (t,) in siblings_result.all()
            if _re.sub(r'\s+v\d+$', '', t.strip()) == base
        )
        new_title = f"{base} v{count + 1}"
        scene_name = ""

    # ── Create new Project reusing the same video ─────────────────────────────
    new_project = Project(
        id=uuid.uuid4(),
        user_id=current_user.id,
        title=new_title,
        original_video_path=original.original_video_path,
    )
    db.add(new_project)
    await db.flush()

    voice_lang    = body.target_voice_language
    subtitle_lang = body.target_subtitle_language
    source_lang   = body.source_language
    output_height = body.target_resolution_height or 0
    output_aspect_ratio = body.target_aspect_ratio or "original"
    watermark_text = body.watermark_text or "ReelSync AI"
    native_height = get_video_height(original.original_video_path)
    is_upscale_required = output_height > native_height

    job = RenderJob(
        id=uuid.uuid4(),
        project_id=new_project.id,
        scene_name=scene_name or None,
        target_language=voice_lang,
        subtitle_language=subtitle_lang,
        source_language=source_lang,
        original_height=native_height,
        output_height=output_height,
        status="PENDING",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        f"[rework] new project_id={new_project.id} title='{new_title}' "
        f"from project_id={project_id} user_id={current_user.id} "
        f"voice_lang={voice_lang} subtitle_lang={subtitle_lang}"
    )

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(new_project.id),
        user_id=str(current_user.id),
        video_local_path=original.original_video_path,
        target_lang=voice_lang,
        subtitle_lang=subtitle_lang,
        source_lang=source_lang,
        scene_name=scene_name,
        output_height=output_height,
        output_aspect_ratio=output_aspect_ratio,
        watermark_text=watermark_text,
        upscale_required=is_upscale_required,
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(new_project.id),
        target_language=voice_lang,
        status="PENDING",
        new_project_title=new_title,
        message=f"New project '{new_title}' created. Poll GET /api/videos/jobs/{job.id} for status.",
    )


# ─── GET /queue ───────────────────────────────────────────────────────────────

@router.get(
    "/queue",
    summary="Return current concurrency slot usage",
)
async def get_queue_status():
    """
    Reports how many of the MAX_CONCURRENT_JOBS slots are currently occupied
    and how many are free.  Useful for health checks and the admin dashboard.
    """
    active = MAX_CONCURRENT_JOBS - _job_semaphore._value
    return {
        "max_concurrent_jobs": MAX_CONCURRENT_JOBS,
        "active_jobs":         active,
        "available_slots":     MAX_CONCURRENT_JOBS - active,
    }


# ─── GET /credits ─────────────────────────────────────────────────────────────

@router.get(
    "/credits",
    summary="Return the current user's remaining credit minutes",
)
async def get_credits(current_user: User = Depends(get_current_user)):
    return {
        "user_id": str(current_user.id),
        "credit_minutes": current_user.credit_minutes,
    }


# ─── GET /tier ────────────────────────────────────────────────────────────────

@router.get(
    "/tier",
    summary="Return the current user's subscription plan, char balance, and tier limits",
)
async def get_tier(current_user: User = Depends(get_current_user)):
    """
    Exposes everything the frontend needs to render the billing/usage section:

    - subscription_plan     — the user's current plan key (e.g. "free", "starter")
    - tier_label            — human-readable plan name
    - chars_per_credit      — max transcript chars allowed per 1-credit job on this plan
    - chars_balance         — the user's remaining character allowance
    - credit_minutes        — the user's remaining credit minutes
    - chars_utilization_pct — how much of the character budget has been used
                              relative to the total that would come with the
                              current credit_minutes balance
    """
    plan = current_user.subscription_plan or "free"
    tier = PROFITABLE_TIERS.get(plan, PROFITABLE_TIERS["free"])

    chars_per_credit  = tier["chars_per_credit_minute"]
    chars_balance     = current_user.chars_balance or 0
    credit_minutes    = current_user.credit_minutes
    chars_total_grant = chars_per_credit * credit_minutes

    utilization_pct = (
        round((1 - chars_balance / chars_total_grant) * 100, 1)
        if chars_total_grant > 0
        else 100.0
    )

    return {
        "user_id":               str(current_user.id),
        "subscription_plan":     plan,
        "tier_label":            tier["label"],
        "chars_per_credit":      chars_per_credit,
        "chars_balance":         chars_balance,
        "credit_minutes":        credit_minutes,
        "chars_total_grant":     chars_total_grant,
        "chars_utilization_pct": utilization_pct,
        "all_tiers":             PROFITABLE_TIERS,
    }
