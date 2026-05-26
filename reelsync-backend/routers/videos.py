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

from config import STORAGE_DIR
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
INPUT_DIR = os.path.join(STORAGE_DIR, "inputs")
OUTPUT_DIR = os.path.join(STORAGE_DIR, "outputs")


# ─── GET /history ─────────────────────────────────────────────────────────────

@router.get(
    "/history",
    response_model=List[ProjectHistoryItem],
    summary="List all video projects for the authenticated user",
)
async def get_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all projects owned by the current user, newest first.
    Enforces row-level isolation via Project.user_id == current_user.id.
    A user can never retrieve another user's project rows regardless of
    whether they know the project_id.
    """
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
            output_video_path=latest_job.output_video_path if latest_job else None,
        ))

    return history


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

    user_id = str(current_user.id)
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

    if current_user.credit_minutes < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits ({current_user.credit_minutes} remaining). "
                "Upgrade your plan to continue."
            ),
        )

    job = RenderJob(
        id=uuid.uuid4(),
        project_id=project.id,
        target_language=body.target_language,
        status="PENDING",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        f"[process] job_id={job.id} project_id={project_id} "
        f"user_id={current_user.id} lang={body.target_language}"
    )

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(project.id),
        user_id=str(current_user.id),
        video_local_path=project.original_video_path,
        target_lang=body.target_language,
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(project.id),
        target_language=body.target_language,
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
