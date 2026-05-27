import logging
import os
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
from core.pipeline import run_background_job
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


# ─── GET /history  (alias: /projects) ────────────────────────────────────────

async def _list_projects(
    db: AsyncSession,
    current_user: User,
) -> List[ProjectHistoryItem]:
    """Shared implementation for /history and /projects endpoints."""
    result = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
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
    Pre-flight checks (synchronous, before the job is queued):
    ─────────────────────────────────────────────────────────
    1.  Ownership: project must belong to the current user (404 if not).
    2.  Credit gate: user must have at least 1 credit_minute (402 if not).

    Character-density guard (asynchronous, inside the background job):
    ──────────────────────────────────────────────────────────────────
    After ElevenLabs returns the subtitle transcript the pipeline computes
    incoming_char_count = Σ len(cue.text) and compares it against the user's
    chars_balance (see config.PROFITABLE_TIERS for per-plan limits).

    If the video is too word-dense for the remaining balance the job is
    marked FAILED immediately with:
        error_code: "DENSE_TEXT_LIMIT"
        message:    "This video contains too many spoken words…"
    No credit minute is deducted in that case.

    On success, both 1 credit_minute and the actual char count are deducted
    atomically from the user row.

    Ownership enforced by filtering on both project_id AND current_user.id.
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
    tier = PROFITABLE_TIERS.get(plan, PROFITABLE_TIERS["free"])
    chars_remaining = current_user.chars_balance or 0
    chars_per_credit = tier["chars_per_credit_minute"]

    if chars_remaining < chars_per_credit * 0.25:
        logger.warning(
            f"[process] user={current_user.id} chars_remaining={chars_remaining} "
            f"is below 25% of a single credit limit ({chars_per_credit}). "
            "Dense-speech content will likely be blocked by the pipeline guard."
        )

    # Cross-subtitle gate disabled for testing — all plans use requested value
    final_subtitle_lang = body.target_subtitle_language

    job = RenderJob(
        id=uuid.uuid4(),
        project_id=project.id,
        target_language=body.target_voice_language,
        subtitle_language=final_subtitle_lang,
        status="PENDING",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        f"[process] job_id={job.id} project_id={project_id} "
        f"user_id={current_user.id} voice_lang={body.target_voice_language} "
        f"subtitle_lang={final_subtitle_lang} plan={plan} "
        f"chars_remaining={chars_remaining}"
    )

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(project.id),
        user_id=str(current_user.id),
        video_local_path=project.original_video_path,
        target_lang=body.target_voice_language,
        subtitle_lang=final_subtitle_lang,
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(project.id),
        target_language=body.target_voice_language,
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
        target_language=job.target_language,
        output_video_path=job.output_video_path,
        error_message=job.error_message,
        created_at=str(job.created_at),
        updated_at=str(job.updated_at),
        progress_percentage=job.progress_percentage or 0,
    )


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

    - subscription_plan  — the user's current plan key (e.g. "free", "starter")
    - tier_label         — human-readable plan name
    - chars_per_credit   — max transcript chars allowed per 1-credit job on this plan
    - chars_balance      — the user's remaining character allowance
    - credit_minutes     — the user's remaining credit minutes
    - chars_utilization_pct — how much of the character budget has been used
                              relative to the total that would come with the
                              current credit_minutes balance
    """
    plan = current_user.subscription_plan or "free"
    tier = PROFITABLE_TIERS.get(plan, PROFITABLE_TIERS["free"])

    chars_per_credit  = tier["chars_per_credit_minute"]
    chars_balance     = current_user.chars_balance or 0
    credit_minutes    = current_user.credit_minutes
    chars_total_grant = chars_per_credit * credit_minutes  # what a full balance would be

    utilization_pct = (
        round((1 - chars_balance / chars_total_grant) * 100, 1)
        if chars_total_grant > 0
        else 100.0
    )

    return {
        "user_id":             str(current_user.id),
        "subscription_plan":   plan,
        "tier_label":          tier["label"],
        "chars_per_credit":    chars_per_credit,
        "chars_balance":       chars_balance,
        "credit_minutes":      credit_minutes,
        "chars_total_grant":   chars_total_grant,
        "chars_utilization_pct": utilization_pct,
        "all_tiers":           PROFITABLE_TIERS,
    }
