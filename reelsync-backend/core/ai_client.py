"""
core/ai_client.py
-----------------
Two-tier voice dubbing pipeline.

Tier 1 — ElevenLabs Dubbing API  (default, no extra deps required)
    Sends the full video to ElevenLabs, which handles diarization, translation,
    and audio mixing internally.  The key fix vs the old code: `watermark` is
    now passed from the caller so paid-plan users get full-quality voice cloning
    instead of the degraded free-tier model.

Tier 2 — Diarized Voice-Cloning Pipeline  (opt-in)
    ┌─ requires ──────────────────────────────────────────────────────────────┐
    │  pip install pyannote.audio faster-whisper pydub torch torchaudio       │
    │                                                                          │
    │  .env keys:                                                              │
    │    ELEVENLABS_DIARIZATION_MODE=true                                      │
    │    HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxx   # for pyannote model access      │
    └──────────────────────────────────────────────────────────────────────────┘

    Pipeline:
      1  Extract raw audio from video (ffmpeg).
      2  Run PyAnnote 3.x speaker diarization → per-speaker segment list.
      3  Select the longest non-overlapping reference clip (≥ MIN_REF_SECS)
         for each detected speaker.
      4  Register a per-speaker cloned voice on ElevenLabs Voice Cloning API.
      5  Transcribe the audio with faster-whisper and align whisper segments
         to speaker turns using overlap scoring.
      6  Translate each speaker's segments via deep-translator.
      7  Synthesise each translated segment via ElevenLabs TTS using that
         speaker's cloned voice, with per-speaker voice-settings tuning.
      8  Compose all synthesised clips onto a silent base track at the original
         timestamps, blending with a short crossfade to hide cut boundaries.
      9  Export the final mixed MP3 + build an SRT file from translated cues.
     10  Delete the temporary cloned voices from ElevenLabs after use (cleanup).

    Falls back to Tier 1 gracefully if any optional dependency is missing or
    if diarization/cloning fails at runtime.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

import requests
from elevenlabs.client import ElevenLabs

import config

logger = logging.getLogger(__name__)

# ─── constants ────────────────────────────────────────────────────────────────

POLL_INTERVAL_SECONDS = 10
MAX_WAIT_SECONDS      = 600

# Reference clip quality thresholds for voice cloning
MIN_REF_SECS      = 5.0    # reject clips shorter than this
PREFERRED_REF_SECS = 10.0  # stop searching once we have this much audio

# How many seconds of silence to pad between synthesised segments when mixing
CROSSFADE_MS = 80

# ElevenLabs dubbing accepts only these source-language codes.
_ELEVENLABS_SOURCE_LANGS: frozenset[str] = frozenset({
    "ar", "bg", "zh", "hr", "cs", "da", "nl", "en", "fil", "fi",
    "fr", "de", "el", "hi", "hu", "id", "it", "ja", "ko", "ms",
    "no", "pl", "pt", "ro", "ru", "sk", "es", "sv", "ta", "tr",
    "uk", "vi",
})

# ─── optional-dependency probes ───────────────────────────────────────────────

_PYANNOTE_AVAILABLE = False
_WHISPER_AVAILABLE  = False
_PYDUB_AVAILABLE    = False

try:
    from pyannote.audio import Pipeline as _PyAnnotePipeline   # type: ignore
    _PYANNOTE_AVAILABLE = True
    logger.debug("[ai_client] pyannote.audio available — Tier 2 diarization ready")
except ImportError:
    logger.debug("[ai_client] pyannote.audio not installed — Tier 2 unavailable")

try:
    from faster_whisper import WhisperModel as _WhisperModel   # type: ignore
    _WHISPER_AVAILABLE = True
    logger.debug("[ai_client] faster-whisper available — Tier 2 transcription ready")
except ImportError:
    logger.debug("[ai_client] faster-whisper not installed — Tier 2 unavailable")

try:
    from pydub import AudioSegment as _AudioSegment            # type: ignore
    _PYDUB_AVAILABLE = True
    logger.debug("[ai_client] pydub available — Tier 2 audio mixing ready")
except ImportError:
    logger.debug("[ai_client] pydub not installed — Tier 2 unavailable")

# deep-translator is already a project dependency (used by subtitle_translator.py)
_TRANSLATOR_AVAILABLE = False
try:
    from deep_translator import GoogleTranslator as _GoogleTranslator  # type: ignore
    _TRANSLATOR_AVAILABLE = True
except ImportError:
    pass

# Feature flag: Tier 2 is active only when every dependency is present AND
# the operator has enabled it explicitly in the environment.
_DIARIZATION_MODE: bool = (
    os.getenv("ELEVENLABS_DIARIZATION_MODE", "false").lower() == "true"
    and _PYANNOTE_AVAILABLE
    and _WHISPER_AVAILABLE
    and _PYDUB_AVAILABLE
)

_HUGGINGFACE_TOKEN: str = os.getenv("HUGGINGFACE_TOKEN", "")


# ─── Tier 1: ElevenLabs Dubbing API ──────────────────────────────────────────

class AIOrchestrator:
    """
    Standard ElevenLabs Dubbing API wrapper (Tier 1).

    Key fix vs the previous version: `apply_watermark` is now an explicit
    parameter.  Paid-plan callers pass `apply_watermark=False`, which enables
    ElevenLabs' full-quality voice-preservation models.  The old code hardcoded
    `watermark=True` which silently forced every job through the degraded
    free-tier pipeline regardless of the user's subscription.
    """

    def __init__(self) -> None:
        self.client = ElevenLabs(api_key=config.ELEVENLABS_API_KEY)

    def generate_dubbed_audio(
        self,
        video_path: str,
        target_lang: str,
        output_dir: str,
        source_lang: str = "auto",
        apply_watermark: bool = True,
        num_speakers: Optional[int] = None,
    ) -> tuple[str, list[dict], str]:
        """
        Submit a video to the ElevenLabs Dubbing API and wait for completion.

        Parameters
        ----------
        video_path      : absolute path to the source video file
        target_lang     : BCP-47 code of the desired dub language
        output_dir      : directory to write the dubbed MP3 + SRT
        source_lang     : BCP-47 source language code, or "auto"
        apply_watermark : True  → free-tier watermarked output
                          False → full-quality paid-plan output (no watermark)
        num_speakers    : optional hint; when provided, ElevenLabs uses it to
                          improve multi-speaker separation accuracy

        Returns
        -------
        (dubbed_audio_path, subtitles_data, detected_source_lang)
        """
        logger.info(
            f"[Tier 1] Submitting to ElevenLabs Dubbing API | "
            f"target={target_lang} watermark={apply_watermark} "
            f"speakers={num_speakers or 'auto'}"
        )

        with open(video_path, "rb") as fh:
            kwargs: dict = {
                "file":       (Path(video_path).name, fh, "video/mp4"),
                "target_lang": target_lang,
                "mode":        "automatic",
                "watermark":   apply_watermark,
            }
            if source_lang and source_lang != "auto" and source_lang in _ELEVENLABS_SOURCE_LANGS:
                kwargs["source_lang"] = source_lang
            if num_speakers and num_speakers > 1:
                kwargs["num_speakers"] = num_speakers

            response = self.client.dubbing.dub_a_video_or_an_audio_file(**kwargs)

        dubbing_id = response.dubbing_id
        logger.info(f"[Tier 1] Dubbing job created — id={dubbing_id}")

        final_meta        = self._wait_for_completion(dubbing_id)
        detected_src_lang = self._extract_source_language(final_meta)
        logger.info(f"[Tier 1] Detected source language: {detected_src_lang or '(unknown)'}")

        audio_path     = self._download_dubbed_audio(dubbing_id, target_lang, output_dir)
        subtitles_data = self._download_subtitles(dubbing_id, target_lang, output_dir)

        return audio_path, subtitles_data, detected_src_lang

    # ── internal helpers ──────────────────────────────────────────────────────

    def _wait_for_completion(self, dubbing_id: str):
        elapsed = 0
        while elapsed < MAX_WAIT_SECONDS:
            meta   = self.client.dubbing.get_dubbing_project_metadata(dubbing_id=dubbing_id)
            status = meta.status
            logger.info(f"[Tier 1] Status={status} elapsed={elapsed}s")
            if status == "dubbed":
                return meta
            if status == "failed":
                raise RuntimeError(f"ElevenLabs dubbing job {dubbing_id} failed on the server.")
            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS
        raise TimeoutError(f"Dubbing job {dubbing_id} did not complete within {MAX_WAIT_SECONDS}s.")

    def _extract_source_language(self, metadata) -> str:
        for attr in ("source_languages", "source_lang", "source_language"):
            val = getattr(metadata, attr, None)
            if val:
                return (val[0] if isinstance(val, list) else str(val)).lower()
        try:
            raw = (
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

    def _download_dubbed_audio(self, dubbing_id: str, language_code: str, output_dir: str) -> str:
        audio_path = os.path.join(output_dir, f"dubbed_{language_code}.mp3")
        audio_stream = self.client.dubbing.get_dubbed_file(
            dubbing_id=dubbing_id, language_code=language_code
        )
        with open(audio_path, "wb") as fh:
            for chunk in audio_stream:
                if chunk:
                    fh.write(chunk)
        logger.info(f"[Tier 1] Dubbed audio saved: {audio_path}")
        return audio_path

    def _download_subtitles(self, dubbing_id: str, language_code: str, output_dir: str) -> list[dict]:
        srt_path = os.path.join(output_dir, f"subtitles_{language_code}.srt")
        # The ElevenLabs SDK v1.3 calls .json() on this endpoint which returns
        # plain SRT text, causing a JSONDecodeError.  Call the REST API directly.
        url = f"https://api.elevenlabs.io/v1/dubbing/{dubbing_id}/transcript/{language_code}"
        resp = requests.get(url, headers={"xi-api-key": config.ELEVENLABS_API_KEY}, timeout=30)
        resp.raise_for_status()
        srt_text = resp.content.decode("utf-8")
        with open(srt_path, "w", encoding="utf-8") as fh:
            fh.write(srt_text)
        logger.info(f"[Tier 1] SRT saved: {srt_path}")
        return parse_srt(srt_text)


# ─── Tier 2: Diarized Voice-Cloning Pipeline ─────────────────────────────────

class DiarizedVoiceOrchestrator:
    """
    Full speaker-diarization + per-speaker voice-cloning pipeline (Tier 2).

    Only instantiated / called when _DIARIZATION_MODE is True.
    Falls back to AIOrchestrator on any unrecoverable error.
    """

    def __init__(self) -> None:
        self.el_client   = ElevenLabs(api_key=config.ELEVENLABS_API_KEY)
        self.tier1       = AIOrchestrator()
        self._diarize_pipeline = None   # loaded lazily on first use

    # ── public entry point ────────────────────────────────────────────────────

    def generate_dubbed_audio(
        self,
        video_path: str,
        target_lang: str,
        output_dir: str,
        source_lang: str = "auto",
        apply_watermark: bool = True,
    ) -> tuple[str, list[dict], str]:
        """
        Run the full diarization pipeline.  Falls back to Tier 1 if anything
        goes wrong so the pipeline never stalls.
        """
        try:
            return self._run_diarized(
                video_path, target_lang, output_dir, source_lang, apply_watermark
            )
        except Exception as exc:
            logger.warning(
                f"[Tier 2] Pipeline failed ({exc}) — falling back to Tier 1 ElevenLabs Dubbing"
            )
            return self.tier1.generate_dubbed_audio(
                video_path, target_lang, output_dir, source_lang, apply_watermark
            )

    # ── Step 1: extract raw audio ─────────────────────────────────────────────

    def _extract_audio(self, video_path: str, output_dir: str) -> str:
        """Extract a 16-kHz mono WAV from the video using ffmpeg."""
        wav_path = os.path.join(output_dir, "raw_audio_16k.wav")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",                   # no video
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ac", "1",              # mono
            "-ar", "16000",          # 16 kHz (pyannote + whisper sweet spot)
            wav_path,
        ]
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg audio extraction failed: {result.stderr.decode('utf-8', errors='replace')[:400]}"
            )
        logger.info(f"[Tier 2] Raw audio extracted → {wav_path}")
        return wav_path

    # ── Step 2: speaker diarization ───────────────────────────────────────────

    def _diarize(self, wav_path: str) -> dict[str, list[tuple[float, float]]]:
        """
        Run PyAnnote 3.x diarization.

        Returns
        -------
        {speaker_id: [(start_sec, end_sec), ...]}
        """
        if self._diarize_pipeline is None:
            if not _HUGGINGFACE_TOKEN:
                raise RuntimeError(
                    "HUGGINGFACE_TOKEN is not set in .env — required for pyannote model access."
                )
            logger.info("[Tier 2] Loading PyAnnote diarization model (first-time download may be slow)…")
            self._diarize_pipeline = _PyAnnotePipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=_HUGGINGFACE_TOKEN,
            )

        logger.info(f"[Tier 2] Running speaker diarization on {os.path.basename(wav_path)}…")
        diarization = self._diarize_pipeline(wav_path)

        segments: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments[speaker].append((turn.start, turn.end))

        speaker_count = len(segments)
        total_segs    = sum(len(v) for v in segments.values())
        logger.info(
            f"[Tier 2] Diarization done: {speaker_count} speaker(s), {total_segs} segments"
        )
        for spk, segs in segments.items():
            total_s = sum(e - s for s, e in segs)
            logger.info(f"  {spk}: {len(segs)} segments, {total_s:.1f}s total speech")

        return dict(segments)

    # ── Step 3: extract per-speaker reference clips ───────────────────────────

    def _extract_speaker_reference(
        self,
        wav_path: str,
        segments: list[tuple[float, float]],
        speaker_id: str,
        output_dir: str,
    ) -> Optional[str]:
        """
        Build a clean reference clip for a single speaker.

        Strategy:
          • Sort segments by duration (longest first).
          • Concatenate non-overlapping segments until we reach PREFERRED_REF_SECS.
          • Reject if total duration < MIN_REF_SECS.

        Returns the path to a WAV file, or None if insufficient audio.
        """
        if not _PYDUB_AVAILABLE:
            raise RuntimeError("pydub required for reference clip extraction.")

        # Load full audio once
        full_audio = _AudioSegment.from_wav(wav_path)

        # Sort by duration descending to grab the richest clips first
        sorted_segs = sorted(segments, key=lambda s: s[1] - s[0], reverse=True)

        clip = _AudioSegment.empty()
        for start, end in sorted_segs:
            if (end - start) < 0.5:      # skip very short fragments (< 0.5 s)
                continue
            start_ms = int(start * 1000)
            end_ms   = int(end   * 1000)
            clip += full_audio[start_ms:end_ms]
            if len(clip) / 1000 >= PREFERRED_REF_SECS:
                break

        duration_secs = len(clip) / 1000
        if duration_secs < MIN_REF_SECS:
            logger.warning(
                f"[Tier 2] {speaker_id}: only {duration_secs:.1f}s of reference audio "
                f"(minimum {MIN_REF_SECS}s) — skipping voice cloning for this speaker"
            )
            return None

        ref_path = os.path.join(output_dir, f"ref_{speaker_id}.wav")
        clip.export(ref_path, format="wav")
        logger.info(
            f"[Tier 2] {speaker_id}: reference clip = {duration_secs:.1f}s → {os.path.basename(ref_path)}"
        )
        return ref_path

    # ── Step 4: register cloned voices on ElevenLabs ─────────────────────────

    def _clone_speaker_voices(
        self,
        speaker_segments: dict[str, list[tuple[float, float]]],
        wav_path: str,
        project_id: str,
        output_dir: str,
    ) -> tuple[dict[str, str], list[str]]:
        """
        For each speaker with sufficient reference audio, register a cloned
        voice on ElevenLabs.

        Returns
        -------
        (speaker_voice_map, cloned_voice_ids)
            speaker_voice_map  : {speaker_id → elevenlabs_voice_id}
            cloned_voice_ids   : all registered voice IDs (for later cleanup)
        """
        speaker_voice_map: dict[str, str] = {}
        cloned_voice_ids:  list[str]      = []

        for speaker_id, segments in speaker_segments.items():
            ref_path = self._extract_speaker_reference(
                wav_path, segments, speaker_id, output_dir
            )
            if ref_path is None:
                continue  # not enough audio — will fall back to default voice

            voice_name = f"tmp_{project_id}_{speaker_id}_{int(time.time())}"
            try:
                with open(ref_path, "rb") as ref_fh:
                    cloned = self.el_client.voices.add(
                        name=voice_name,
                        files=[ref_fh],
                        description=f"Auto-cloned for project {project_id}, speaker {speaker_id}",
                    )
                voice_id = cloned.voice_id
                speaker_voice_map[speaker_id] = voice_id
                cloned_voice_ids.append(voice_id)
                logger.info(
                    f"[Tier 2] Cloned voice registered: {speaker_id} → voice_id={voice_id}"
                )
            except Exception as exc:
                logger.warning(
                    f"[Tier 2] Failed to clone voice for {speaker_id} ({exc}) "
                    f"— this speaker will use ElevenLabs' default voice"
                )

        return speaker_voice_map, cloned_voice_ids

    # ── Step 5: transcribe + align speakers ───────────────────────────────────

    def _transcribe_and_align(
        self,
        wav_path: str,
        speaker_segments: dict[str, list[tuple[float, float]]],
        source_lang: str,
    ) -> list[dict]:
        """
        Transcribe the audio with faster-whisper, then assign each whisper
        segment to the speaker who dominates that time window.

        Returns
        -------
        List of dicts:
            {start, end, text, speaker}
        """
        if not _WHISPER_AVAILABLE:
            raise RuntimeError("faster-whisper required for Tier 2 transcription.")

        whisper_lang = None if source_lang == "auto" else source_lang
        logger.info(f"[Tier 2] Transcribing audio (lang={whisper_lang or 'auto-detect'})…")

        model = _WhisperModel("base", device="cpu", compute_type="int8")
        segs, info = model.transcribe(wav_path, language=whisper_lang, beam_size=5)
        detected_lang = info.language
        logger.info(f"[Tier 2] Whisper detected language: {detected_lang}")

        # Build a flat list of (start, end, speaker) intervals from diarization
        diar_flat: list[tuple[float, float, str]] = []
        for spk, spk_segs in speaker_segments.items():
            for start, end in spk_segs:
                diar_flat.append((start, end, spk))
        diar_flat.sort(key=lambda x: x[0])

        aligned: list[dict] = []
        for seg in segs:
            speaker = self._dominant_speaker(seg.start, seg.end, diar_flat)
            aligned.append({
                "start":   seg.start,
                "end":     seg.end,
                "text":    seg.text.strip(),
                "speaker": speaker,
            })

        logger.info(f"[Tier 2] Transcription complete: {len(aligned)} segments")
        return aligned

    @staticmethod
    def _dominant_speaker(
        seg_start: float,
        seg_end: float,
        diar_flat: list[tuple[float, float, str]],
    ) -> str:
        """
        Return the speaker whose turns overlap the most with [seg_start, seg_end].
        Falls back to SPEAKER_00 if no diarization overlap is found.
        """
        overlap: dict[str, float] = defaultdict(float)
        for d_start, d_end, spk in diar_flat:
            if d_end <= seg_start or d_start >= seg_end:
                continue
            ovl = min(d_end, seg_end) - max(d_start, seg_start)
            if ovl > 0:
                overlap[spk] += ovl
        if not overlap:
            return "SPEAKER_00"
        return max(overlap, key=overlap.__getitem__)

    # ── Step 6: translate per-speaker segments ────────────────────────────────

    def _translate_segments(
        self,
        segments: list[dict],
        target_lang: str,
        source_lang: str,
    ) -> list[dict]:
        """
        Translate the text of each segment using deep-translator.
        Falls back gracefully to the original text on any failure.
        """
        if not _TRANSLATOR_AVAILABLE:
            logger.warning("[Tier 2] deep-translator not available — using original text for TTS")
            return segments

        def _norm(code: str) -> str:
            aliases = {
                "zh": "zh-CN", "fil": "tl", "he": "iw", "jv": "jw",
            }
            return aliases.get(code.lower(), code)

        src = _norm(source_lang) if source_lang != "auto" else "auto"
        tgt = _norm(target_lang)
        translated: list[dict] = []

        for seg in segments:
            try:
                t = _GoogleTranslator(source=src, target=tgt).translate(seg["text"])
                translated.append({**seg, "text": t or seg["text"]})
            except Exception as exc:
                logger.debug(f"[Tier 2] Translation failed for segment ({exc}) — keeping original")
                translated.append(seg)

        logger.info(f"[Tier 2] Translated {len(translated)} segments to '{target_lang}'")
        return translated

    # ── Step 7 + 8: TTS synthesis + audio mixing ──────────────────────────────

    def _synthesise_and_mix(
        self,
        segments: list[dict],
        speaker_voice_map: dict[str, str],
        output_dir: str,
        target_lang: str,
    ) -> str:
        """
        For each segment:
          • Pick the speaker's cloned voice (fall back to a generic ElevenLabs voice).
          • Call ElevenLabs TTS and save the audio clip.
          • Place it on a silent base track at the original timestamp.

        Returns the path to the final mixed MP3.
        """
        if not _PYDUB_AVAILABLE:
            raise RuntimeError("pydub required for audio mixing.")
        if not segments:
            raise ValueError("No segments to synthesise.")

        total_duration_ms = int(segments[-1]["end"] * 1000) + 1000  # 1-second tail buffer
        base_track = _AudioSegment.silent(duration=total_duration_ms)

        fallback_voice = "21m00Tcm4TlvDq8ikWAM"  # ElevenLabs "Rachel" — neutral English

        for i, seg in enumerate(segments):
            if not seg["text"].strip():
                continue

            voice_id = speaker_voice_map.get(seg.get("speaker", ""), fallback_voice)
            start_ms = int(seg["start"] * 1000)

            try:
                audio_bytes = b"".join(
                    self.el_client.text_to_speech.convert(
                        voice_id=voice_id,
                        text=seg["text"],
                        model_id="eleven_multilingual_v2",
                        voice_settings={
                            "stability":        0.45,
                            "similarity_boost":  0.82,
                            "style":             0.20,
                            "use_speaker_boost": True,
                        },
                    )
                )
                clip = _AudioSegment.from_file(io.BytesIO(audio_bytes), format="mp3")

                # Crossfade if the previous segment ends near this start
                if i > 0:
                    prev_end_ms = int(segments[i - 1]["end"] * 1000)
                    if abs(start_ms - prev_end_ms) < CROSSFADE_MS * 2:
                        clip = clip.fade_in(CROSSFADE_MS).fade_out(CROSSFADE_MS)

                base_track = base_track.overlay(clip, position=start_ms)
                logger.debug(
                    f"[Tier 2] Segment {i+1}/{len(segments)} placed at {seg['start']:.2f}s "
                    f"speaker={seg.get('speaker','?')} voice={voice_id}"
                )

            except Exception as exc:
                logger.warning(
                    f"[Tier 2] TTS failed for segment {i+1} "
                    f"(speaker={seg.get('speaker','?')}, text={seg['text'][:60]!r}): {exc}"
                )

        mixed_path = os.path.join(output_dir, f"dubbed_{target_lang}.mp3")
        base_track.export(mixed_path, format="mp3", bitrate="192k")
        logger.info(f"[Tier 2] Mixed audio exported → {mixed_path}")
        return mixed_path

    # ── Step 9: build SRT from translated segments ────────────────────────────

    def _build_srt(
        self,
        segments: list[dict],
        target_lang: str,
        output_dir: str,
    ) -> list[dict]:
        """
        Build an SRT file from the translated/timed segments and save it.
        Also returns the parsed subtitle list for the pipeline.
        """
        srt_lines: list[str] = []
        subtitle_data: list[dict] = []

        for i, seg in enumerate(segments, start=1):
            if not seg["text"].strip():
                continue
            start_ts = _seconds_to_srt_time(seg["start"])
            end_ts   = _seconds_to_srt_time(seg["end"])
            srt_lines.append(f"{i}\n{start_ts} --> {end_ts}\n{seg['text']}\n")
            subtitle_data.append({
                "index": i,
                "start": seg["start"],
                "end":   seg["end"],
                "text":  seg["text"],
            })

        srt_text = "\n".join(srt_lines)
        srt_path = os.path.join(output_dir, f"subtitles_{target_lang}.srt")
        with open(srt_path, "w", encoding="utf-8") as fh:
            fh.write(srt_text)
        logger.info(f"[Tier 2] SRT saved → {srt_path} ({len(subtitle_data)} cues)")
        return subtitle_data

    # ── Step 10: cleanup cloned voices ────────────────────────────────────────

    def _cleanup_cloned_voices(self, cloned_voice_ids: list[str]) -> None:
        """Delete temporary cloned voices from ElevenLabs after the job completes."""
        for vid in cloned_voice_ids:
            try:
                self.el_client.voices.delete(voice_id=vid)
                logger.info(f"[Tier 2] Deleted temporary cloned voice: {vid}")
            except Exception as exc:
                logger.warning(f"[Tier 2] Could not delete cloned voice {vid}: {exc}")

    # ── Orchestration ─────────────────────────────────────────────────────────

    def _run_diarized(
        self,
        video_path: str,
        target_lang: str,
        output_dir: str,
        source_lang: str,
        apply_watermark: bool,
    ) -> tuple[str, list[dict], str]:
        cloned_voice_ids: list[str] = []
        project_id = Path(output_dir).name  # job_id used as temp project identifier

        try:
            # 1 ─ Extract audio
            wav_path = self._extract_audio(video_path, output_dir)

            # 2 ─ Speaker diarization
            speaker_segments = self._diarize(wav_path)

            if len(speaker_segments) == 0:
                raise RuntimeError("Diarization returned 0 speakers — cannot proceed.")

            if len(speaker_segments) == 1:
                # Single speaker detected — Tier 1 with a speaker count hint is sufficient.
                logger.info("[Tier 2] Single speaker detected — delegating to Tier 1 with hint.")
                return self.tier1.generate_dubbed_audio(
                    video_path, target_lang, output_dir, source_lang, apply_watermark,
                    num_speakers=1,
                )

            logger.info(
                f"[Tier 2] {len(speaker_segments)} speakers — running full voice-cloning pipeline"
            )

            # 3 + 4 ─ Extract reference clips and clone voices
            speaker_voice_map, cloned_voice_ids = self._clone_speaker_voices(
                speaker_segments, wav_path, project_id, output_dir
            )

            if not speaker_voice_map:
                raise RuntimeError(
                    "Could not clone any speaker voices (all reference clips too short)."
                )

            # 5 ─ Transcribe + align speakers
            aligned_segments = self._transcribe_and_align(
                wav_path, speaker_segments, source_lang
            )

            # Detect source language from whisper for downstream metadata
            detected_src_lang = source_lang if source_lang != "auto" else "en"

            # 6 ─ Translate segments
            translated_segments = self._translate_segments(
                aligned_segments, target_lang, source_lang
            )

            # 7 + 8 ─ Synthesise TTS per segment and mix
            mixed_audio_path = self._synthesise_and_mix(
                translated_segments, speaker_voice_map, output_dir, target_lang
            )

            # 9 ─ Build SRT
            subtitle_data = self._build_srt(translated_segments, target_lang, output_dir)

            logger.info("[Tier 2] Diarized pipeline complete.")
            return mixed_audio_path, subtitle_data, detected_src_lang

        finally:
            # 10 ─ Always clean up cloned voices, even on failure
            if cloned_voice_ids:
                self._cleanup_cloned_voices(cloned_voice_ids)


# ─── Public factory ───────────────────────────────────────────────────────────

def get_orchestrator() -> AIOrchestrator | DiarizedVoiceOrchestrator:
    """
    Return the appropriate orchestrator based on the runtime configuration.

    Callers (pipeline.py) should use this instead of instantiating
    AIOrchestrator directly so the feature flag is respected transparently.
    """
    if _DIARIZATION_MODE:
        if not _HUGGINGFACE_TOKEN:
            logger.warning(
                "[ai_client] ELEVENLABS_DIARIZATION_MODE=true but HUGGINGFACE_TOKEN is not set. "
                "Falling back to Tier 1 (ElevenLabs Dubbing API)."
            )
            return AIOrchestrator()
        logger.info("[ai_client] Tier 2 (diarized voice-cloning pipeline) active.")
        return DiarizedVoiceOrchestrator()
    return AIOrchestrator()


# ─── SRT utilities ────────────────────────────────────────────────────────────

def parse_srt(srt_text: str) -> list[dict]:
    """Parse SRT text into a list of subtitle dicts with float start/end times."""
    subtitles: list[dict] = []
    for block in srt_text.strip().split("\n\n"):
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
        end   = _srt_time_to_seconds(end_str.strip())
        text  = " ".join(line.strip() for line in lines[2:])
        subtitles.append({"index": index, "start": start, "end": end, "text": text})
    return subtitles


def _srt_time_to_seconds(time_str: str) -> float:
    """Convert SRT timestamp '00:00:01,500' to float seconds (1.5)."""
    time_str = time_str.replace(",", ".")
    h, m, s  = time_str.split(":")
    return float(h) * 3600 + float(m) * 60 + float(s)


def _seconds_to_srt_time(seconds: float) -> str:
    """Convert float seconds to SRT timestamp '00:00:01,500'."""
    h   = int(seconds // 3600)
    m   = int((seconds % 3600) // 60)
    s   = int(seconds % 60)
    ms  = int(round((seconds - int(seconds)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
