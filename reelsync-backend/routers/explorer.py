"""
routers/explorer.py
--------------------
Recursive file-explorer endpoints for the Projects workspace.

  GET    /api/projects/{project_id}/contents?folder_id=   Contents at any depth
  POST   /api/folders                                      Create a subfolder
  PUT    /api/folders/{folder_id}                          Rename a folder
  DELETE /api/folders/{folder_id}                          Delete folder + recursive cascade
  POST   /api/scenes                                       Upload video + queue render at any depth
  PUT    /api/scenes/{scene_id}                            Rename a scene
  DELETE /api/scenes/{scene_id}                            Delete scene + file cleanup
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
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import STORAGE_DIR, THUMBNAILS_DIR
from core.pipeline import run_background_job
from database import get_db
from models.db_models import ExplorerFolder, Project, RenderJob, SceneEditHistory, User
from models.schemas import (
    ExplorerContentsResponse,
    ExplorerFolderCreate,
    ExplorerFolderItem,
    ExplorerFolderRename,
    FolderMoveBody,
    ProcessResponse,
    SceneHistoryItem,
    SceneItem,
    SceneMoveBody,
    SceneReprocessBody,
    SceneRename,
)
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska", "video/avi"}
INPUT_DIR = os.path.join(STORAGE_DIR, "inputs")


# ─── Internal helpers ─────────────────────────────────────────────────────────

async def _get_workspace_project(
    project_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> Project:
    """Fetch a workspace project and verify ownership. Raises 404 on any failure."""
    project: Optional[Project] = await db.get(Project, project_id)
    if not project or project.user_id != current_user.id or not project.is_workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


async def _get_explorer_folder(
    folder_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> ExplorerFolder:
    """Fetch an ExplorerFolder and verify it belongs to a workspace project owned by the user."""
    folder: Optional[ExplorerFolder] = await db.get(ExplorerFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found.")
    await _get_workspace_project(folder.project_id, current_user, db)
    return folder


def _folder_item(f: ExplorerFolder) -> ExplorerFolderItem:
    return ExplorerFolderItem(
        folder_id=str(f.id),
        project_id=str(f.project_id),
        parent_id=str(f.parent_id) if f.parent_id else None,
        name=f.name,
        created_at=str(f.created_at),
    )


def _scene_item(j: RenderJob) -> SceneItem:
    # Derive the public thumbnail URL from the stored filesystem path.
    # thumbnail_path: {THUMBNAILS_DIR}/{user_id}/{job_id}.jpg
    # served at:      /thumbnails/{user_id}/{job_id}.jpg
    thumbnail_url: str | None = None
    if j.thumbnail_path and os.path.isfile(j.thumbnail_path):
        try:
            rel = os.path.relpath(j.thumbnail_path, THUMBNAILS_DIR)
            thumbnail_url = "/thumbnails/" + rel.replace(os.sep, "/")
        except ValueError:
            pass

    return SceneItem(
        job_id=str(j.id),
        project_id=str(j.project_id),
        folder_id=str(j.folder_id) if j.folder_id else None,
        scene_name=j.scene_name,
        target_voice_lang=j.target_language,
        target_subtitle_lang=j.subtitle_language,
        source_language=j.source_language,
        status=j.status,
        progress_percentage=j.progress_percentage,
        input_video_path=j.input_video_path,
        output_video_path=j.output_video_path,
        thumbnail_path=j.thumbnail_path,
        thumbnail_url=thumbnail_url,
        error_message=j.error_message,
        created_at=str(j.created_at),
        updated_at=str(j.updated_at),
    )


# ─── GET /projects/{project_id}/contents ─────────────────────────────────────

@router.get(
    "/projects/{project_id}/contents",
    response_model=ExplorerContentsResponse,
    summary="Return folders + scenes at a given directory depth",
)
async def get_contents(
    project_id: str,
    folder_id: Optional[str] = Query(default=None, description="Current folder UUID; omit for project root"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    project = await _get_workspace_project(pid, current_user, db)

    current_fid: Optional[uuid.UUID] = None
    if folder_id:
        try:
            current_fid = uuid.UUID(folder_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder_id.")
        # Verify the folder belongs to this project
        check: Optional[ExplorerFolder] = await db.get(ExplorerFolder, current_fid)
        if not check or check.project_id != pid:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found in this project.")

    # Folders at this level — exclude trashed folders
    folder_result = await db.execute(
        select(ExplorerFolder)
        .where(ExplorerFolder.project_id == pid)
        .where(ExplorerFolder.parent_id == current_fid)   # None → IS NULL
        .where(ExplorerFolder.trashed_at.is_(None))
        .order_by(ExplorerFolder.name.asc())
    )
    folders = folder_result.scalars().all()

    # Scenes (render_jobs) at this level — exclude trashed scenes
    scene_result = await db.execute(
        select(RenderJob)
        .where(RenderJob.project_id == pid)
        .where(RenderJob.folder_id == current_fid)        # None → IS NULL
        .where(RenderJob.trashed_at.is_(None))
        .order_by(RenderJob.created_at.desc())
    )
    scenes = scene_result.scalars().all()

    return ExplorerContentsResponse(
        project_id=str(project.id),
        project_name=project.title,
        current_folder_id=str(current_fid) if current_fid else None,
        folders=[_folder_item(f) for f in folders],
        scenes=[_scene_item(j) for j in scenes],
    )


# ─── POST /folders ────────────────────────────────────────────────────────────

@router.post(
    "/folders",
    response_model=ExplorerFolderItem,
    status_code=status.HTTP_201_CREATED,
    summary="Create a subfolder at any depth",
)
async def create_folder(
    body: ExplorerFolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pid = uuid.UUID(body.project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project_id.")

    await _get_workspace_project(pid, current_user, db)

    parent_fid: Optional[uuid.UUID] = None
    if body.parent_id:
        try:
            parent_fid = uuid.UUID(body.parent_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent_id.")
        parent: Optional[ExplorerFolder] = await db.get(ExplorerFolder, parent_fid)
        if not parent or parent.project_id != pid:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent folder not found.")

    folder = ExplorerFolder(
        id=uuid.uuid4(),
        project_id=pid,
        parent_id=parent_fid,
        name=body.name,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    logger.info(f"[explorer] folder created id={folder.id} parent={parent_fid} project={pid}")
    return _folder_item(folder)


# ─── PUT /folders/{folder_id} ────────────────────────────────────────────────

@router.put(
    "/folders/{folder_id}",
    response_model=ExplorerFolderItem,
    summary="Rename a folder",
)
async def rename_folder(
    folder_id: str,
    body: ExplorerFolderRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder_id.")

    folder = await _get_explorer_folder(fid, current_user, db)
    folder.name = body.name
    await db.commit()
    await db.refresh(folder)
    logger.info(f"[explorer] folder renamed id={fid} name={body.name}")
    return _folder_item(folder)


# ─── DELETE /folders/{folder_id} ─────────────────────────────────────────────

@router.delete(
    "/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a folder and all its nested subfolders + scenes",
)
async def delete_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder_id.")

    folder = await _get_explorer_folder(fid, current_user, db)

    # Collect all descendant scene file paths via recursive CTE for disk cleanup
    rows = await db.execute(
        text("""
            WITH RECURSIVE tree AS (
                SELECT id FROM explorer_folders WHERE id = :fid
                UNION ALL
                SELECT f.id FROM explorer_folders f JOIN tree t ON f.parent_id = t.id
            )
            SELECT rj.input_video_path, rj.output_video_path
            FROM render_jobs rj
            WHERE rj.folder_id IN (SELECT id FROM tree)
        """),
        {"fid": fid},
    )
    for row in rows.fetchall():
        for path in row:
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass

    await db.delete(folder)  # ON DELETE CASCADE propagates to children + render_jobs
    await db.commit()
    logger.info(f"[explorer] folder deleted id={folder_id}")


# ─── POST /scenes ─────────────────────────────────────────────────────────────

@router.post(
    "/scenes",
    response_model=ProcessResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a video and queue a render scene at any folder depth",
)
async def create_scene(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Video file (MP4, MOV, MKV, AVI)"),
    project_id: str = Form(...),
    folder_id: Optional[str] = Form(None),
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

    project = await _get_workspace_project(pid, current_user, db)

    current_fid: Optional[uuid.UUID] = None
    if folder_id:
        try:
            current_fid = uuid.UUID(folder_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder_id.")
        parent: Optional[ExplorerFolder] = await db.get(ExplorerFolder, current_fid)
        if not parent or parent.project_id != pid:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found.")

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

    # ── Save uploaded file ────────────────────────────────────────────────────
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

    logger.info(f"[explorer] saved {len(contents):,} bytes → {local_path}")

    # ── Create RenderJob ──────────────────────────────────────────────────────
    clean_name = (scene_name or "").strip() or None
    job = RenderJob(
        id=uuid.uuid4(),
        project_id=project.id,
        folder_id=current_fid,
        scene_name=clean_name,
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
        f"[explorer] scene queued job={job.id} project={pid} "
        f"folder={current_fid} voice={target_language}"
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
        scene_name=clean_name or "",
    )

    return ProcessResponse(
        job_id=str(job.id),
        project_id=str(project.id),
        target_language=target_language,
        status="PENDING",
        message=f"Scene queued. Poll GET /api/videos/jobs/{job.id} for live status.",
    )


# ─── PUT /scenes/{scene_id} ───────────────────────────────────────────────────

@router.put(
    "/scenes/{scene_id}",
    response_model=SceneItem,
    summary="Rename a scene",
)
async def rename_scene(
    scene_id: str,
    body: SceneRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scene_id.")

    job: Optional[RenderJob] = await db.get(RenderJob, sid)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found.")

    await _get_workspace_project(job.project_id, current_user, db)

    job.scene_name = body.scene_name
    await db.commit()
    await db.refresh(job)
    logger.info(f"[explorer] scene renamed id={sid} name={body.scene_name}")
    return _scene_item(job)


# ─── PATCH /folders/{folder_id}/move ─────────────────────────────────────────

@router.patch(
    "/folders/{folder_id}/move",
    response_model=ExplorerFolderItem,
    summary="Move a folder to another folder or to project root",
)
async def move_folder(
    folder_id: str,
    body: FolderMoveBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder_id.")

    folder = await _get_explorer_folder(fid, current_user, db)

    target_fid: Optional[uuid.UUID] = None
    if body.target_folder_id:
        try:
            target_fid = uuid.UUID(body.target_folder_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target_folder_id.")

        if target_fid == fid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot move a folder into itself.")

        target: Optional[ExplorerFolder] = await db.get(ExplorerFolder, target_fid)
        if not target or target.project_id != folder.project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target folder not found.")

        # Prevent moving into a descendant (circular reference)
        rows = await db.execute(
            text("""
                WITH RECURSIVE tree AS (
                    SELECT id FROM explorer_folders WHERE id = :fid
                    UNION ALL
                    SELECT f.id FROM explorer_folders f JOIN tree t ON f.parent_id = t.id
                )
                SELECT 1 FROM tree WHERE id = :target_fid
            """),
            {"fid": fid, "target_fid": target_fid},
        )
        if rows.fetchone():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot move a folder into its own descendant.")

    folder.parent_id = target_fid
    await db.commit()
    await db.refresh(folder)
    logger.info(f"[explorer] folder moved id={fid} → parent={target_fid}")
    return _folder_item(folder)


# ─── PATCH /scenes/{scene_id}/move ───────────────────────────────────────────

@router.patch(
    "/scenes/{scene_id}/move",
    response_model=SceneItem,
    summary="Move a scene to a folder or to project root",
)
async def move_scene(
    scene_id: str,
    body: SceneMoveBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scene_id.")

    job: Optional[RenderJob] = await db.get(RenderJob, sid)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found.")
    await _get_workspace_project(job.project_id, current_user, db)

    target_fid: Optional[uuid.UUID] = None
    if body.target_folder_id:
        try:
            target_fid = uuid.UUID(body.target_folder_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target_folder_id.")
        target: Optional[ExplorerFolder] = await db.get(ExplorerFolder, target_fid)
        if not target or target.project_id != job.project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target folder not found.")

    job.folder_id = target_fid
    await db.commit()
    await db.refresh(job)
    logger.info(f"[explorer] scene moved id={sid} → folder={target_fid}")
    return _scene_item(job)


# ─── DELETE /scenes/{scene_id} ────────────────────────────────────────────────

@router.delete(
    "/scenes/{scene_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scene and clean up its files",
)
async def delete_scene(
    scene_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scene_id.")

    job: Optional[RenderJob] = await db.get(RenderJob, sid)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found.")

    await _get_workspace_project(job.project_id, current_user, db)

    for path in [job.input_video_path, job.output_video_path]:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass

    await db.delete(job)
    await db.commit()
    logger.info(f"[explorer] scene deleted id={scene_id}")


# ─── POST /scenes/{scene_id}/reprocess ───────────────────────────────────────

@router.post(
    "/scenes/{scene_id}/reprocess",
    response_model=SceneItem,
    summary="Change language settings and re-queue a scene for processing",
)
async def reprocess_scene(
    scene_id: str,
    body: SceneReprocessBody,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scene_id.")

    job: Optional[RenderJob] = await db.get(RenderJob, sid)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found.")

    await _get_workspace_project(job.project_id, current_user, db)

    if not job.input_video_path or not os.path.isfile(job.input_video_path):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Original video file is no longer available for reprocessing.",
        )

    plan = (current_user.subscription_plan or "free").lower()
    if plan != "free" and current_user.credit_minutes < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits ({current_user.credit_minutes} remaining).",
        )

    # Save current settings + file paths to history before overwriting.
    # We deliberately keep the old output file on disk so users can still
    # play and download previous versions from the history rows.
    history_entry = SceneEditHistory(
        id=uuid.uuid4(),
        scene_id=job.id,
        target_voice_lang=job.target_language,
        target_subtitle_lang=job.subtitle_language,
        source_language=job.source_language,
        output_video_path=job.output_video_path,
        thumbnail_path=job.thumbnail_path,
    )
    db.add(history_entry)

    # Update job with new language settings and reset pipeline state
    job.target_language = body.target_voice_lang
    job.subtitle_language = body.target_subtitle_lang
    job.source_language = body.source_language
    job.status = "PENDING"
    job.progress_percentage = 0
    job.output_video_path = None
    job.thumbnail_path = None
    job.error_message = None

    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(
        run_background_job,
        job_id=str(job.id),
        project_id=str(job.project_id),
        user_id=str(current_user.id),
        video_local_path=job.input_video_path,
        target_lang=body.target_voice_lang,
        subtitle_lang=body.target_subtitle_lang or "en",
        source_lang=body.source_language,
        scene_name=job.scene_name or "",
    )

    logger.info(
        f"[explorer] scene reprocessed id={sid} "
        f"voice={body.target_voice_lang} subtitle={body.target_subtitle_lang}"
    )
    return _scene_item(job)


# ─── GET /scenes/{scene_id}/history ──────────────────────────────────────────

@router.get(
    "/scenes/{scene_id}/history",
    response_model=list[SceneHistoryItem],
    summary="Get the language-change history for a scene",
)
async def get_scene_history(
    scene_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scene_id.")

    job: Optional[RenderJob] = await db.get(RenderJob, sid)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found.")

    await _get_workspace_project(job.project_id, current_user, db)

    rows = await db.execute(
        select(SceneEditHistory)
        .where(SceneEditHistory.scene_id == sid)
        .order_by(SceneEditHistory.created_at.desc())
    )
    entries = rows.scalars().all()

    def _history_thumb_url(path: str | None) -> str | None:
        if not path or not os.path.isfile(path):
            return None
        try:
            rel = os.path.relpath(path, THUMBNAILS_DIR)
            return "/thumbnails/" + rel.replace(os.sep, "/")
        except ValueError:
            return None

    return [
        SceneHistoryItem(
            id=str(e.id),
            target_voice_lang=e.target_voice_lang,
            target_subtitle_lang=e.target_subtitle_lang,
            source_language=e.source_language,
            output_video_path=e.output_video_path,
            thumbnail_path=_history_thumb_url(e.thumbnail_path),
            created_at=str(e.created_at),
        )
        for e in entries
    ]
