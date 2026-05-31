"""
routers/trash.py
-----------------
Soft-delete Trash system for Projects, Explorer Folders, and Scenes.

Items moved to Trash have their `trashed_at` timestamp set.  They remain in
the database and on disk but are filtered out of all normal list/detail
endpoints.  After TRASH_RETENTION_DAYS (15) they are automatically pruned by
the cleanup_trash.py cron script.

Endpoints
---------
GET  /api/trash                                  List all trashed items for the user
GET  /api/trash/count                            Return trashed item count (sidebar badge)

POST /api/trash/projects/{project_id}            Move project to Trash
POST /api/trash/folders/{folder_id}              Move explorer folder to Trash
POST /api/trash/scenes/{job_id}                  Move scene (render job) to Trash

POST /api/trash/projects/{project_id}/restore    Restore project from Trash
POST /api/trash/folders/{folder_id}/restore      Restore folder from Trash
POST /api/trash/scenes/{job_id}/restore          Restore scene from Trash

DELETE /api/trash/projects/{project_id}          Permanently delete project
DELETE /api/trash/folders/{folder_id}            Permanently delete folder
DELETE /api/trash/scenes/{job_id}                Permanently delete scene

DELETE /api/trash/empty                          Permanently delete ALL trashed items
"""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import ExplorerFolder, Project, RenderJob, User
from models.schemas import TrashCountResponse, TrashItemResponse, TrashSummaryResponse
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

TRASH_RETENTION_DAYS = 15


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _expires_at(trashed_at: datetime) -> datetime:
    return trashed_at + timedelta(days=TRASH_RETENTION_DAYS)


def _days_remaining(trashed_at: datetime) -> int:
    ta = trashed_at.replace(tzinfo=timezone.utc) if trashed_at.tzinfo is None else trashed_at
    delta = _expires_at(ta) - datetime.now(tz=timezone.utc)
    return max(0, delta.days)


def _ta_iso(trashed_at: datetime) -> str:
    ta = trashed_at.replace(tzinfo=timezone.utc) if trashed_at.tzinfo is None else trashed_at
    return ta.isoformat()


def _project_trash_item(p: Project) -> TrashItemResponse:
    return TrashItemResponse(
        id=str(p.id),
        kind="project",
        name=p.title,
        trashed_at=_ta_iso(p.trashed_at),
        expires_at=_ta_iso(_expires_at(p.trashed_at)),
        days_remaining=_days_remaining(p.trashed_at),
        parent_name=None,
    )


def _folder_trash_item(f: ExplorerFolder, project_title: Optional[str]) -> TrashItemResponse:
    return TrashItemResponse(
        id=str(f.id),
        kind="folder",
        name=f.name,
        trashed_at=_ta_iso(f.trashed_at),
        expires_at=_ta_iso(_expires_at(f.trashed_at)),
        days_remaining=_days_remaining(f.trashed_at),
        parent_name=project_title,
    )


def _scene_trash_item(j: RenderJob, project_title: Optional[str]) -> TrashItemResponse:
    return TrashItemResponse(
        id=str(j.id),
        kind="scene",
        name=j.scene_name or f"Scene {str(j.id)[:8]}",
        trashed_at=_ta_iso(j.trashed_at),
        expires_at=_ta_iso(_expires_at(j.trashed_at)),
        days_remaining=_days_remaining(j.trashed_at),
        parent_name=project_title,
    )


async def _get_owned_project(
    project_id: str, user: User, db: AsyncSession
) -> Project:
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid project_id.")
    p: Optional[Project] = await db.get(Project, pid)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


async def _get_owned_folder(
    folder_id: str, user: User, db: AsyncSession
) -> tuple[ExplorerFolder, str | None]:
    """Returns (folder, project_title). Verifies ownership via the parent project."""
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid folder_id.")
    f: Optional[ExplorerFolder] = await db.get(ExplorerFolder, fid)
    if not f:
        raise HTTPException(status_code=404, detail="Folder not found.")
    p: Optional[Project] = await db.get(Project, f.project_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Folder not found.")
    return f, p.title


async def _get_owned_scene(
    job_id: str, user: User, db: AsyncSession
) -> tuple[RenderJob, str | None]:
    """Returns (render_job, project_title). Verifies ownership via the parent project."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job_id.")
    j: Optional[RenderJob] = await db.get(RenderJob, jid)
    if not j:
        raise HTTPException(status_code=404, detail="Scene not found.")
    p: Optional[Project] = await db.get(Project, j.project_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Scene not found.")
    return j, p.title


def _remove_files(*paths: Optional[str]) -> int:
    """Best-effort file deletion. Returns count of files actually removed."""
    removed = 0
    for path in paths:
        if path:
            try:
                os.remove(path)
                logger.debug(f"[trash] deleted file: {path}")
                removed += 1
            except OSError as exc:
                logger.warning(f"[trash] could not delete file {path}: {exc}")
    return removed


# ─── GET /api/trash ───────────────────────────────────────────────────────────

@router.get(
    "/trash",
    response_model=TrashSummaryResponse,
    summary="List all trashed items for the authenticated user",
)
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items: list[TrashItemResponse] = []

    # Trashed projects
    proj_r = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .where(Project.trashed_at.is_not(None))
        .order_by(Project.trashed_at.desc())
    )
    items.extend(_project_trash_item(p) for p in proj_r.scalars().all())

    # Trashed explorer folders (only those whose parent project is NOT trashed)
    folder_r = await db.execute(
        select(ExplorerFolder, Project.title)
        .join(Project, ExplorerFolder.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(ExplorerFolder.trashed_at.is_not(None))
        .where(Project.trashed_at.is_(None))
        .order_by(ExplorerFolder.trashed_at.desc())
    )
    items.extend(_folder_trash_item(f, title) for f, title in folder_r.all())

    # Trashed scenes (only those whose parent project AND folder are NOT trashed)
    scene_r = await db.execute(
        select(RenderJob, Project.title)
        .join(Project, RenderJob.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(RenderJob.trashed_at.is_not(None))
        .where(Project.trashed_at.is_(None))
        .order_by(RenderJob.trashed_at.desc())
    )
    items.extend(_scene_trash_item(j, title) for j, title in scene_r.all())

    items.sort(key=lambda x: x.trashed_at, reverse=True)
    return TrashSummaryResponse(items=items, count=len(items))


# ─── GET /api/trash/count ─────────────────────────────────────────────────────

@router.get(
    "/trash/count",
    response_model=TrashCountResponse,
    summary="Return the total count of trashed items (for the sidebar badge)",
)
async def trash_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    proj_r = await db.execute(
        select(Project.id)
        .where(Project.user_id == current_user.id)
        .where(Project.trashed_at.is_not(None))
    )
    folder_r = await db.execute(
        select(ExplorerFolder.id)
        .join(Project, ExplorerFolder.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(ExplorerFolder.trashed_at.is_not(None))
        .where(Project.trashed_at.is_(None))
    )
    scene_r = await db.execute(
        select(RenderJob.id)
        .join(Project, RenderJob.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(RenderJob.trashed_at.is_not(None))
        .where(Project.trashed_at.is_(None))
    )
    count = (
        len(proj_r.scalars().all())
        + len(folder_r.scalars().all())
        + len(scene_r.scalars().all())
    )
    return TrashCountResponse(count=count)


# ─── POST /api/trash/projects/{project_id} ───────────────────────────────────

@router.post(
    "/trash/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Move a project to the Trash",
)
async def trash_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = await _get_owned_project(project_id, current_user, db)
    if p.trashed_at:
        raise HTTPException(status_code=409, detail="Project is already in the Trash.")
    p.trashed_at = datetime.now(tz=timezone.utc)
    await db.commit()
    logger.info(f"[trash] project trashed id={project_id} user={current_user.id}")


# ─── POST /api/trash/folders/{folder_id} ─────────────────────────────────────

@router.post(
    "/trash/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Move an explorer folder to the Trash",
)
async def trash_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f, _ = await _get_owned_folder(folder_id, current_user, db)
    if f.trashed_at:
        raise HTTPException(status_code=409, detail="Folder is already in the Trash.")
    f.trashed_at = datetime.now(tz=timezone.utc)
    await db.commit()
    logger.info(f"[trash] folder trashed id={folder_id} user={current_user.id}")


# ─── POST /api/trash/scenes/{job_id} ─────────────────────────────────────────

@router.post(
    "/trash/scenes/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Move a scene (render job) to the Trash",
)
async def trash_scene(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    j, _ = await _get_owned_scene(job_id, current_user, db)
    if j.trashed_at:
        raise HTTPException(status_code=409, detail="Scene is already in the Trash.")
    j.trashed_at = datetime.now(tz=timezone.utc)
    await db.commit()
    logger.info(f"[trash] scene trashed id={job_id} user={current_user.id}")


# ─── POST /api/trash/projects/{project_id}/restore ───────────────────────────

@router.post(
    "/trash/projects/{project_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore a trashed project",
)
async def restore_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = await _get_owned_project(project_id, current_user, db)
    if not p.trashed_at:
        raise HTTPException(status_code=409, detail="Project is not in the Trash.")
    p.trashed_at = None
    await db.commit()
    logger.info(f"[trash] project restored id={project_id} user={current_user.id}")


# ─── POST /api/trash/folders/{folder_id}/restore ────────────────────────────

@router.post(
    "/trash/folders/{folder_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore a trashed explorer folder",
)
async def restore_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f, _ = await _get_owned_folder(folder_id, current_user, db)
    if not f.trashed_at:
        raise HTTPException(status_code=409, detail="Folder is not in the Trash.")
    f.trashed_at = None
    await db.commit()
    logger.info(f"[trash] folder restored id={folder_id} user={current_user.id}")


# ─── POST /api/trash/scenes/{job_id}/restore ────────────────────────────────

@router.post(
    "/trash/scenes/{job_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore a trashed scene",
)
async def restore_scene(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    j, _ = await _get_owned_scene(job_id, current_user, db)
    if not j.trashed_at:
        raise HTTPException(status_code=409, detail="Scene is not in the Trash.")
    j.trashed_at = None
    await db.commit()
    logger.info(f"[trash] scene restored id={job_id} user={current_user.id}")


# ─── DELETE /api/trash/projects/{project_id} ─────────────────────────────────

@router.delete(
    "/trash/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete a trashed project and all its scenes",
)
async def permanently_delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = await _get_owned_project(project_id, current_user, db)
    if not p.trashed_at:
        raise HTTPException(
            status_code=409,
            detail="Project must be in the Trash before permanent deletion."
        )
    jobs_r = await db.execute(select(RenderJob).where(RenderJob.project_id == p.id))
    for j in jobs_r.scalars().all():
        _remove_files(j.input_video_path, j.output_video_path, j.thumbnail_path)
    await db.delete(p)
    await db.commit()
    logger.info(f"[trash] project permanently deleted id={project_id} user={current_user.id}")


# ─── DELETE /api/trash/folders/{folder_id} ───────────────────────────────────

@router.delete(
    "/trash/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete a trashed explorer folder and its contents",
)
async def permanently_delete_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f, _ = await _get_owned_folder(folder_id, current_user, db)
    if not f.trashed_at:
        raise HTTPException(
            status_code=409,
            detail="Folder must be in the Trash before permanent deletion."
        )
    # Clean up scene files inside this folder (cascade removes DB rows)
    scenes_r = await db.execute(select(RenderJob).where(RenderJob.folder_id == f.id))
    for j in scenes_r.scalars().all():
        _remove_files(j.input_video_path, j.output_video_path, j.thumbnail_path)
    await db.delete(f)
    await db.commit()
    logger.info(f"[trash] folder permanently deleted id={folder_id} user={current_user.id}")


# ─── DELETE /api/trash/scenes/{job_id} ───────────────────────────────────────

@router.delete(
    "/trash/scenes/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete a trashed scene and its files",
)
async def permanently_delete_scene(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    j, _ = await _get_owned_scene(job_id, current_user, db)
    if not j.trashed_at:
        raise HTTPException(
            status_code=409,
            detail="Scene must be in the Trash before permanent deletion."
        )
    _remove_files(j.input_video_path, j.output_video_path, j.thumbnail_path)
    await db.delete(j)
    await db.commit()
    logger.info(f"[trash] scene permanently deleted id={job_id} user={current_user.id}")


# ─── DELETE /api/trash/empty ─────────────────────────────────────────────────

@router.delete(
    "/trash/empty",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete ALL trashed items for the authenticated user",
)
async def empty_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scene_r = await db.execute(
        select(RenderJob)
        .join(Project, RenderJob.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(RenderJob.trashed_at.is_not(None))
    )
    scene_count = 0
    for j in scene_r.scalars().all():
        _remove_files(j.input_video_path, j.output_video_path, j.thumbnail_path)
        await db.delete(j)
        scene_count += 1

    folder_r = await db.execute(
        select(ExplorerFolder)
        .join(Project, ExplorerFolder.project_id == Project.id)
        .where(Project.user_id == current_user.id)
        .where(ExplorerFolder.trashed_at.is_not(None))
    )
    folder_count = 0
    for f in folder_r.scalars().all():
        await db.delete(f)
        folder_count += 1

    proj_r = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .where(Project.trashed_at.is_not(None))
    )
    proj_count = 0
    for p in proj_r.scalars().all():
        remaining_r = await db.execute(select(RenderJob).where(RenderJob.project_id == p.id))
        for j in remaining_r.scalars().all():
            _remove_files(j.input_video_path, j.output_video_path, j.thumbnail_path)
        await db.delete(p)
        proj_count += 1

    await db.commit()
    logger.info(
        f"[trash] emptied trash user={current_user.id}: "
        f"{proj_count} projects + {folder_count} folders + {scene_count} scenes"
    )
