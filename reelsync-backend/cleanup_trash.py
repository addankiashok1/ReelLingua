#!/usr/bin/env python3
"""
cleanup_trash.py
----------------
Standalone async script that permanently deletes items that have been sitting
in the Trash for more than TRASH_RETENTION_DAYS (15) days.

Designed to run as a daily cron job:

    # Run every day at 02:00 server time
    0 2 * * * cd /path/to/reelsync-backend && python cleanup_trash.py >> /var/log/reelsync_trash.log 2>&1

Or as a Windows Task Scheduler action:
    Program : python
    Arguments: C:\\path\\to\\reelsync-backend\\cleanup_trash.py

Exit codes
----------
0 — completed successfully (even if nothing was deleted)
1 — fatal error (DB connection failure, etc.)

Environment
-----------
Reads the same .env file(s) as the main application via config.py so no
additional configuration is needed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# ── Bootstrap the path so this script can import project modules ──────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import config                           # noqa: E402  (project config)
from models.db_models import ExplorerFolder, Project, RenderJob  # noqa: E402

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cleanup_trash")

# ── Constants ─────────────────────────────────────────────────────────────────

TRASH_RETENTION_DAYS: int = int(os.getenv("TRASH_RETENTION_DAYS", "15"))

# ── DB session factory (independent of the main app's engine) ─────────────────

_engine = create_async_engine(
    config.settings.database_url,
    echo=False,
    pool_pre_ping=True,
)
_SessionLocal = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


# ── File cleanup helper ───────────────────────────────────────────────────────

def _remove_file(path: str | None) -> bool:
    """Delete a file from disk.  Returns True on success, False on any error."""
    if not path:
        return False
    try:
        os.remove(path)
        logger.debug(f"  deleted file: {path}")
        return True
    except FileNotFoundError:
        logger.debug(f"  file already gone: {path}")
        return False
    except OSError as exc:
        logger.warning(f"  could not delete file {path}: {exc}")
        return False


# ── Core cleanup logic ────────────────────────────────────────────────────────

async def run_cleanup() -> dict[str, int]:
    """
    1. Find all Projects and RenderJobs whose `trashed_at` is older than
       TRASH_RETENTION_DAYS.
    2. Delete their files from disk.
    3. Delete their rows from the database (DB cascade handles child rows for
       projects).

    Returns a summary dict: {"projects": N, "scenes": N, "files": N}
    """
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=TRASH_RETENTION_DAYS)
    logger.info(
        f"Trash cleanup started — cutoff={cutoff.strftime('%Y-%m-%d %H:%M:%S UTC')} "
        f"(items trashed before this timestamp will be permanently deleted)"
    )

    summary = {"projects": 0, "folders": 0, "scenes": 0, "files": 0}

    async with _SessionLocal() as session:
        async with session.begin():

            # ── Step 1: expired scenes (render_jobs) ──────────────────────────
            # Handle individually-trashed scenes first so we can clean up their
            # files before the project cascade might delete the rows.
            scene_result = await session.execute(
                select(RenderJob)
                .where(RenderJob.trashed_at.is_not(None))
                .where(RenderJob.trashed_at <= cutoff)
            )
            expired_scenes = scene_result.scalars().all()

            for job in expired_scenes:
                files_deleted = sum([
                    _remove_file(job.input_video_path),
                    _remove_file(job.output_video_path),
                    _remove_file(job.thumbnail_path),
                ])
                summary["files"] += files_deleted
                await session.delete(job)
                summary["scenes"] += 1
                logger.info(
                    f"  scene id={job.id} name={job.scene_name or '(unnamed)'!r} "
                    f"trashed={job.trashed_at.strftime('%Y-%m-%d')} "
                    f"→ permanently deleted ({files_deleted} file(s) removed)"
                )

            # ── Step 2: expired explorer folders ─────────────────────────────
            folder_result = await session.execute(
                select(ExplorerFolder)
                .where(ExplorerFolder.trashed_at.is_not(None))
                .where(ExplorerFolder.trashed_at <= cutoff)
            )
            for folder in folder_result.scalars().all():
                scenes_r = await session.execute(
                    select(RenderJob).where(RenderJob.folder_id == folder.id)
                )
                for job in scenes_r.scalars().all():
                    files_deleted = sum([
                        _remove_file(job.input_video_path),
                        _remove_file(job.output_video_path),
                        _remove_file(job.thumbnail_path),
                    ])
                    summary["files"] += files_deleted
                await session.delete(folder)
                summary["folders"] += 1
                logger.info(
                    f"  folder id={folder.id} name={folder.name!r} "
                    f"trashed={folder.trashed_at.strftime('%Y-%m-%d')} "
                    f"→ permanently deleted"
                )

            # ── Step 3: expired projects ──────────────────────────────────────
            # For each project, also clean up any child render_jobs whose files
            # weren't already deleted in step 1 (scenes that were NOT individually
            # trashed but belong to a trashed project).
            proj_result = await session.execute(
                select(Project)
                .where(Project.trashed_at.is_not(None))
                .where(Project.trashed_at <= cutoff)
            )
            expired_projects = proj_result.scalars().all()

            for project in expired_projects:
                # Collect all child scenes for file cleanup
                child_result = await session.execute(
                    select(RenderJob).where(RenderJob.project_id == project.id)
                )
                for job in child_result.scalars().all():
                    files_deleted = sum([
                        _remove_file(job.input_video_path),
                        _remove_file(job.output_video_path),
                        _remove_file(job.thumbnail_path),
                    ])
                    summary["files"] += files_deleted

                await session.delete(project)  # CASCADE removes child rows
                summary["projects"] += 1
                logger.info(
                    f"  project id={project.id} name={project.title!r} "
                    f"trashed={project.trashed_at.strftime('%Y-%m-%d')} "
                    f"→ permanently deleted"
                )

    logger.info(
        f"Trash cleanup complete — "
        f"{summary['projects']} project(s), "
        f"{summary['folders']} folder(s), "
        f"{summary['scenes']} scene(s), "
        f"{summary['files']} file(s) removed"
    )
    return summary


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> int:
    try:
        summary = await run_cleanup()
        if summary["projects"] == 0 and summary["scenes"] == 0:
            logger.info("Nothing to clean up.")
        return 0
    except Exception as exc:
        logger.exception(f"Fatal error during trash cleanup: {exc}")
        return 1
    finally:
        await _engine.dispose()


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
