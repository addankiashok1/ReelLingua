"""
backfill_thumbnails.py
----------------------
One-time script: generates JPEG thumbnails for every COMPLETED render_job
that has an output_video_path but no thumbnail_path yet.

Run from the reelsync-backend directory:
    python backfill_thumbnails.py

Safe to re-run — skips jobs that already have a thumbnail_path or whose
output file no longer exists on disk.
"""

import asyncio
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import config  # noqa: E402  loads .env

import asyncpg  # noqa: E402

THUMBNAILS_DIR = config.THUMBNAILS_DIR


def extract_thumbnail(video_path: str, thumbnail_path: str) -> bool:
    for seek in ("00:00:01", "00:00:00"):
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", seek,
                    "-i", video_path,
                    "-vframes", "1",
                    "-q:v", "2",
                    "-update", "1",
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


async def main() -> None:
    db_url = config.settings.database_url
    # asyncpg expects postgresql:// not postgresql+asyncpg://
    conn_str = db_url.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(conn_str)

    rows = await conn.fetch("""
        SELECT rj.id, p.user_id, rj.output_video_path
        FROM render_jobs rj
        JOIN projects p ON p.id = rj.project_id
        WHERE rj.status = 'COMPLETED'
          AND rj.output_video_path IS NOT NULL
          AND (rj.thumbnail_path IS NULL OR rj.thumbnail_path = '')
    """)

    print(f"Found {len(rows)} completed jobs without thumbnails.")
    if not rows:
        print("Nothing to do.")
        await conn.close()
        return

    ok = fail = 0
    for row in rows:
        job_id    = str(row["id"])
        user_id   = str(row["user_id"])
        video_path = row["output_video_path"]

        if not os.path.isfile(video_path):
            print(f"  SKIP  {job_id[:8]}… — video file missing")
            fail += 1
            continue

        thumb_dir = os.path.join(THUMBNAILS_DIR, user_id)
        os.makedirs(thumb_dir, exist_ok=True)
        thumb_path = os.path.join(thumb_dir, f"{job_id}.jpg")

        success = await asyncio.to_thread(extract_thumbnail, video_path, thumb_path)
        if success:
            await conn.execute(
                "UPDATE render_jobs SET thumbnail_path = $1 WHERE id = $2",
                thumb_path, row["id"],
            )
            print(f"  OK    {job_id[:8]}... -> {os.path.basename(thumb_path)}")
            ok += 1
        else:
            print(f"  FAIL  {job_id[:8]}… — ffmpeg could not extract frame")
            fail += 1

    await conn.close()
    print(f"\nDone. {ok} thumbnails generated, {fail} skipped/failed.")


if __name__ == "__main__":
    asyncio.run(main())
