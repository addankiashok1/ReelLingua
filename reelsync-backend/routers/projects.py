"""
routers/projects.py
--------------------
Workspace Project Folders — clean CRUD + inner scene management.

  POST   /api/projects                         Create a project folder (name only)
  GET    /api/projects                         List all project folders for the user
  PUT    /api/projects/{project_id}            Rename a project folder
  DELETE /api/projects/{project_id}            Delete folder + cascade all scenes

  GET    /api/projects/{project_id}/videos     Project detail + all render jobs
  POST   /api/projects/{project_id}/scenes     Upload video + queue a render scene
"""

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
    ProcessResponse,
    ProjectDetailResponse,
    SceneItem,
    WorkspaceProjectCreate,
    WorkspaceProjectRename,
    WorkspaceProjectResponse,
)
from routers.auth import get_current_user

ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska", "video/avi"}
INPUT_DIR = os.path.join(STORAGE_DIR, "inputs")

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Internal helper ─────────────────────────────────────────────────────────

def _project_response(project: Project) -> WorkspaceProjectResponse:
    return WorkspaceProjectResponse(
        project_id=str(project.id),
        name=project.title,
        created_at=str(project.created_at),
    )


# ─── POST /projects ───────────────────────────────────────────────────────────

@router.post(
    "/projects",
    response_model=WorkspaceProjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project folder",
)
async def create_project(
    body: WorkspaceProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = Project(
        id=uuid.uuid4(),
        user_id=current_user.id,
        title=body.name,
        is_workspace=True,
        original_video_path=None,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    logger.info(f"[projects] created id={project.id} user={current_user.id}")
    return _project_response(project)


# ─── GET /projects ────────────────────────────────────────────────────────────

@router.get(
    "/projects",
    response_model=List[WorkspaceProjectResponse],
    summary="List all project folders for the authenticated user",
)
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .where(Project.is_workspace == True)  # noqa: E712
        .order_by(Project.created_at.desc())
    )
    return [_project_response(p) for p in result.scalars().all()]


# ─── PUT /projects/{project_id} ──────────────────────────────────────────────

@router.put(
    "/projects/{project_id}",
    response_model=WorkspaceProjectResponse,
    summary="Rename a project folder",
)
async def rename_project(
    project_id: str,
    body: WorkspaceProjectRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    project: Optional[Project] = await db.get(Project, pid)
    if not project or project.user_id != current_user.id or not project.is_workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    project.title = body.name
    await db.commit()
    await db.refresh(project)
    logger.info(f"[projects] renamed id={project.id} name={body.name} user={current_user.id}")
    return _project_response(project)


# ─── DELETE /projects/{project_id} ───────────────────────────────────────────

@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project folder and all its scenes",
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    project: Optional[Project] = await db.get(Project, pid)
    if not project or project.user_id != current_user.id or not project.is_workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    # Best-effort file cleanup before the DB cascade
    jobs_result = await db.execute(
        select(RenderJob).where(RenderJob.project_id == pid)
    )
    for job in jobs_result.scalars().all():
        for path in [job.input_video_path, job.output_video_path]:
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass

    await db.delete(project)  # ON DELETE CASCADE removes render_jobs rows
    await db.commit()
    logger.info(f"[projects] deleted id={project_id} user={current_user.id}")


# ─── GET /projects/{project_id}/videos ───────────────────────────────────────

@router.get(
    "/projects/{project_id}/videos",
    response_model=ProjectDetailResponse,
    summary="Get a project and all its render jobs (scenes)",
)
async def get_project_scenes(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    project: Optional[Project] = await db.get(Project, pid)
    if not project or project.user_id != current_user.id or not project.is_workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    result = await db.execute(
        select(RenderJob)
        .where(RenderJob.project_id == pid)
        .order_by(RenderJob.created_at.desc())
    )
    jobs: List[RenderJob] = result.scalars().all()

    scenes = [
        SceneItem(
            job_id=str(j.id),
            project_id=str(j.project_id),
            scene_name=j.scene_name,
            target_voice_lang=j.target_language,
            target_subtitle_lang=j.subtitle_language,
            source_language=j.source_language,
            status=j.status,
            progress_percentage=j.progress_percentage,
            output_video_path=j.output_video_path,
            error_message=j.error_message,
            created_at=str(j.created_at),
            updated_at=str(j.updated_at),
        )
        for j in jobs
    ]

    return ProjectDetailResponse(
        project_id=str(project.id),
        name=project.title,
        folder_id=str(project.folder_id) if project.folder_id else None,
        target_voice_lang=project.target_voice_lang,
        target_subtitle_lang=project.target_subtitle_lang,
        created_at=str(project.created_at),
        scenes=scenes,
    )


# ─── POST /projects/{project_id}/scenes ──────────────────────────────────────

@router.post(
    "/projects/{project_id}/scenes",
    response_model=ProcessResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a video and queue a new render scene",
)
async def add_scene(
    project_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="MP4 video file"),
    scene_name: Optional[str] = Form(None),
    target_language: str = Form(...),
    source_language: str = Form("auto"),
    subtitle_language: str = Form("en"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    project: Optional[Project] = await db.get(Project, pid)
    if not project or project.user_id != current_user.id or not project.is_workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type '{file.content_type}'.",
        )

    plan = (current_user.subscription_plan or "free").lower()
    if plan != "free" and current_user.credit_minutes < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits ({current_user.credit_minutes} remaining).",
        )

    user_input_dir = os.path.join(INPUT_DIR, str(current_user.id))
    os.makedirs(user_input_dir, exist_ok=True)

    file_uid = uuid.uuid4().hex
    safe_name = (file.filename or "upload.mp4").replace(" ", "_")
    local_path = os.path.join(user_input_dir, f"{file_uid}_{safe_name}")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    with open(local_path, "wb") as fh:
        fh.write(contents)

    logger.info(f"[add_scene] saved {len(contents):,} bytes → {local_path}")

    clean_scene_name = (scene_name or "").strip() or None
    job = RenderJob(
        id=uuid.uuid4(),
        project_id=project.id,
        scene_name=clean_scene_name,
        target_language=target_language,
        subtitle_language=subtitle_language,
        source_language=source_language,
        input_video_path=local_path,
        status="PENDING",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        f"[add_scene] job={job.id} project={project.id} user={current_user.id} "
        f"voice={target_language} subtitle={subtitle_language}"
    )

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(project.id),
        user_id=str(current_user.id),
        video_local_path=local_path,
        target_lang=target_language,
        subtitle_lang=subtitle_language,
        source_lang=source_language,
        scene_name=clean_scene_name or "",
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(project.id),
        target_language=target_language,
        status="PENDING",
        message=f"Scene queued. Poll GET /api/videos/jobs/{job.id} for live status.",
    )
