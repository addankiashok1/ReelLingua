from __future__ import annotations

import json
import logging
import os
import subprocess

logger = logging.getLogger(__name__)


def probe_video_height(file_path: str, fallback: int = 720) -> int:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=height",
                "-of", "json",
                file_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
            check=True,
        )
        data = json.loads(result.stdout)
        height = int(data["streams"][0]["height"])
        logger.info(f"[media_probe] height={height}px for {os.path.basename(file_path)}")
        return height
    except Exception as exc:
        logger.warning(
            f"[media_probe] failed to detect height for {os.path.basename(file_path)}: {exc}"
        )
        return fallback


def probe_video_duration_seconds(file_path: str) -> int:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                file_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
            check=True,
        )
        data = json.loads(result.stdout)
        raw_duration = float(data["format"]["duration"])
        duration_seconds = max(1, int(round(raw_duration)))
        logger.info(
            f"[media_probe] duration={duration_seconds}s for {os.path.basename(file_path)}"
        )
        return duration_seconds
    except Exception as exc:
        raise RuntimeError(
            f"Could not determine video duration for {os.path.basename(file_path)}: {exc}"
        ) from exc
