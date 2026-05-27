import logging
import os
import time
from pathlib import Path

import requests
from elevenlabs.client import ElevenLabs

import config

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 10
MAX_WAIT_SECONDS = 600


class AIOrchestrator:
    def __init__(self):
        self.client = ElevenLabs(api_key=config.ELEVENLABS_API_KEY)

    def generate_dubbed_audio(
        self,
        video_path: str,
        target_lang: str,
        output_dir: str,
        source_lang: str = "auto",
    ) -> tuple[str, list[dict], str]:
        """
        Submits video to ElevenLabs Dubbing API, waits for completion,
        then downloads the dubbed MP3 and SRT transcript.

        Returns
        -------
        (dubbed_audio_path, subtitles_data, detected_source_lang)
            detected_source_lang — BCP-47 code ElevenLabs detected, or "" if unknown.
        """
        logger.info("Submitting video to ElevenLabs Dubbing API...")

        with open(video_path, "rb") as f:
            kwargs: dict = {
                "file": (Path(video_path).name, f, "video/mp4"),
                "target_lang": target_lang,
                "mode": "automatic",
                "watermark": True,
            }
            if source_lang and source_lang != "auto":
                kwargs["source_lang"] = source_lang
            response = self.client.dubbing.dub_a_video_or_an_audio_file(**kwargs)

        dubbing_id = response.dubbing_id
        logger.info(f"Dubbing job created. ID: {dubbing_id}")

        final_metadata     = self._wait_for_completion(dubbing_id)
        detected_src_lang  = self._extract_source_language(final_metadata)
        logger.info(f"Detected source language: {detected_src_lang or '(unknown)'}")

        audio_path     = self._download_dubbed_audio(dubbing_id, target_lang, output_dir)
        subtitles_data = self._download_subtitles(dubbing_id, target_lang, output_dir)

        return audio_path, subtitles_data, detected_src_lang

    def _wait_for_completion(self, dubbing_id: str):
        """Polls until dubbed; returns the final metadata object."""
        elapsed = 0
        while elapsed < MAX_WAIT_SECONDS:
            metadata = self.client.dubbing.get_dubbing_project_metadata(
                dubbing_id=dubbing_id
            )
            status = metadata.status
            logger.info(f"Dubbing status: {status} (elapsed: {elapsed}s)")

            if status == "dubbed":
                logger.info("Dubbing complete.")
                return metadata
            if status == "failed":
                raise RuntimeError(
                    f"ElevenLabs dubbing job {dubbing_id} failed on the server."
                )

            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS

        raise TimeoutError(
            f"Dubbing job {dubbing_id} did not complete within {MAX_WAIT_SECONDS}s."
        )

    def _extract_source_language(self, metadata) -> str:
        """
        Reads the auto-detected source language from ElevenLabs metadata.
        The SDK type stubs may not expose every field, so we probe several
        attribute names and fall back to model_dump() for extra fields.
        """
        for attr in ("source_languages", "source_lang", "source_language"):
            val = getattr(metadata, attr, None)
            if val:
                return (val[0] if isinstance(val, list) else str(val)).lower()
        # Pydantic v2 model_dump / v1 dict() expose fields not in the type stubs
        try:
            raw: dict = (
                metadata.model_dump()
                if hasattr(metadata, "model_dump")
                else vars(metadata)
            )
            for key in ("source_languages", "source_lang", "source_language"):
                val = raw.get(key)
                if val:
                    return (val[0] if isinstance(val, list) else str(val)).lower()
        except Exception:
            pass
        return ""

    def _download_dubbed_audio(
        self, dubbing_id: str, language_code: str, output_dir: str
    ) -> str:
        logger.info("Downloading dubbed audio...")
        audio_path = os.path.join(output_dir, f"dubbed_{language_code}.mp3")

        audio_stream = self.client.dubbing.get_dubbed_file(
            dubbing_id=dubbing_id,
            language_code=language_code,
        )

        with open(audio_path, "wb") as f:
            for chunk in audio_stream:
                if chunk:
                    f.write(chunk)

        logger.info(f"Dubbed audio saved: {audio_path}")
        return audio_path

    def _download_subtitles(
        self, dubbing_id: str, language_code: str, output_dir: str
    ) -> list[dict]:
        logger.info("Downloading SRT subtitles...")
        srt_path = os.path.join(output_dir, f"subtitles_{language_code}.srt")

        # The SDK v1.3.0 forces .json() on this endpoint which returns plain SRT text,
        # causing a JSONDecodeError. Call the REST endpoint directly instead.
        url = f"https://api.elevenlabs.io/v1/dubbing/{dubbing_id}/transcript/{language_code}"
        response = requests.get(
            url,
            headers={"xi-api-key": config.ELEVENLABS_API_KEY},
            timeout=30,
        )
        response.raise_for_status()
        srt_text = response.content.decode("utf-8")

        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_text)

        logger.info(f"SRT saved: {srt_path}")
        return parse_srt(srt_text)


def parse_srt(srt_text: str) -> list[dict]:
    """Parse SRT text into a list of subtitle dicts with float start/end times."""
    subtitles = []
    blocks = srt_text.strip().split("\n\n")

    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue

        try:
            index = int(lines[0].strip())
        except ValueError:
            continue

        time_line = lines[1].strip()
        if " --> " not in time_line:
            continue

        start_str, end_str = time_line.split(" --> ")
        start = _srt_time_to_seconds(start_str.strip())
        end = _srt_time_to_seconds(end_str.strip())
        text = " ".join(line.strip() for line in lines[2:])

        subtitles.append({"index": index, "start": start, "end": end, "text": text})

    return subtitles


def _srt_time_to_seconds(time_str: str) -> float:
    """Convert SRT timestamp '00:00:01,500' to float seconds (1.5)."""
    time_str = time_str.replace(",", ".")
    parts = time_str.split(":")
    hours = float(parts[0])
    minutes = float(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds
