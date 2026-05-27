"""
core/subtitle_translator.py
----------------------------
Translates SRT subtitle files to any target language using deep-translator
(GoogleTranslator backend).  Pure text content is translated while all SRT
structural lines (block indices, HH:MM:SS,mmm --> HH:MM:SS,mmm timestamps)
are preserved byte-for-byte.

Public surface
--------------
  translate_srt_file(input_srt_path, target_lang_code, source_lang_code)
      -> (output_srt_path: str, effective_lang: str)

  translate_subtitles_data(subtitles_data, target_lang_code, source_lang_code)
      -> list[dict]   (same structure as ai_client.parse_srt output)

Both functions degrade gracefully: on any error they return the originals
unchanged so the pipeline is never blocked by a translation failure.
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional import — translation is disabled if the package is absent
# ---------------------------------------------------------------------------
_TRANSLATOR_AVAILABLE = False
try:
    from deep_translator import GoogleTranslator as _GoogleTranslator  # type: ignore
    _TRANSLATOR_AVAILABLE = True
except ImportError:
    logger.warning(
        "[subtitle_translator] deep-translator not installed — translation disabled. "
        "Run: pip install deep-translator"
    )

# GoogleTranslator silently truncates requests above 5 000 chars.
# Use 4 500 as a conservative per-batch cap.
_GOOGLE_CHAR_LIMIT = 4_500
_BATCH_LINE_LIMIT  = 60        # safety cap on lines-per-API-call

# Map codes that come from ElevenLabs / ISO 639 to the exact codes
# that deep-translator (GoogleTranslator) actually accepts.
_GOOGLE_LANG_ALIASES: dict[str, str] = {
    "zh":    "zh-CN",   # ElevenLabs uses bare zh; Google needs zh-CN
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
    "fil":   "tl",      # ElevenLabs: fil  →  Google: tl
    "he":    "iw",      # ISO 639: he  →  Google: iw
    "jv":    "jw",      # ISO 639: jv  →  Google: jw
    "pt-br": "pt",
    "pt-pt": "pt",
}


def _normalize_google_lang(code: str) -> str:
    """Return the exact code string that GoogleTranslator accepts."""
    if code == "auto":
        return "auto"
    return _GOOGLE_LANG_ALIASES.get(code.lower(), code)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def translate_srt_file(
    input_srt_path: str,
    target_lang_code: str,
    source_lang_code: str = "auto",
) -> tuple[str, str]:
    """
    Translate an SRT file and save the result next to the source file.

    Returns
    -------
    (output_srt_path, effective_lang_code)
        On any failure, returns (input_srt_path, source_lang_code) so the
        pipeline can continue with the original subtitles.
    """
    if not _TRANSLATOR_AVAILABLE:
        logger.warning("[subtitle_translator] deep-translator unavailable — skipping translation")
        return input_srt_path, source_lang_code

    output_path = str(
        Path(input_srt_path).parent / f"custom_subtitles_{target_lang_code}.srt"
    )

    try:
        with open(input_srt_path, encoding="utf-8") as fh:
            original_srt = fh.read()

        translated_srt = _translate_srt_content(original_srt, target_lang_code, source_lang_code)

        with open(output_path, "w", encoding="utf-8") as fh:
            fh.write(translated_srt)

        logger.info(
            f"[subtitle_translator] saved → {os.path.basename(output_path)} "
            f"(src={source_lang_code} → tgt={target_lang_code})"
        )
        return output_path, target_lang_code

    except Exception as exc:
        logger.warning(
            f"[subtitle_translator] translate_srt_file failed ({exc}) "
            f"— returning original SRT"
        )
        return input_srt_path, source_lang_code


def translate_subtitles_data(
    subtitles_data: list[dict],
    target_lang_code: str,
    source_lang_code: str = "auto",
) -> list[dict]:
    """
    Translate a parsed subtitles list in-memory without touching the filesystem.

    Each dict must have at least {"index", "start", "end", "text"}.
    Returns a new list with translated "text" values; all other fields are
    preserved.  On any failure, returns the original list unchanged.
    """
    if not _TRANSLATOR_AVAILABLE or not subtitles_data:
        return subtitles_data

    try:
        texts = [cue["text"] for cue in subtitles_data]
        translated = _batch_translate(texts, target_lang_code, source_lang_code)
        return [
            {**cue, "text": translated[i]}
            for i, cue in enumerate(subtitles_data)
        ]
    except Exception as exc:
        logger.warning(
            f"[subtitle_translator] translate_subtitles_data failed ({exc}) "
            f"— returning originals"
        )
        return subtitles_data


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------

def _translate_srt_content(srt_text: str, target_lang: str, source_lang: str = "auto") -> str:
    """
    Parse SRT into blocks, translate text-only lines, and reassemble.

    SRT block anatomy (blocks separated by a blank line):
        <index>
        <HH:MM:SS,mmm> --> <HH:MM:SS,mmm>
        <text line 1>
        [<text line N> ...]

    Only lines at position 2+ in each block are translated.
    """
    blocks = srt_text.strip().split("\n\n")

    # Pass 1 ─ collect every text line and remember its block origin
    text_lines: list[str] = []
    parsed: list[dict]    = []

    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 3:
            # Malformed or empty block — keep verbatim
            parsed.append({"verbatim": block.strip()})
            continue

        header    = lines[:2]      # index + timestamp
        text_only = lines[2:]      # one or more text lines
        span_start = len(text_lines)
        text_lines.extend(text_only)
        parsed.append({
            "header":    header,
            "text_span": (span_start, span_start + len(text_only)),
        })

    if not text_lines:
        return srt_text

    # Pass 2 ─ batch translate all collected text lines
    translated_lines = _batch_translate(text_lines, target_lang, source_lang)

    # Pass 3 ─ reassemble blocks
    output_blocks: list[str] = []
    for block in parsed:
        if "verbatim" in block:
            output_blocks.append(block["verbatim"])
        else:
            start, end = block["text_span"]
            body = block["header"] + translated_lines[start:end]
            output_blocks.append("\n".join(body))

    return "\n\n".join(output_blocks) + "\n"


def _batch_translate(
    lines: list[str],
    target_lang: str,
    source_lang: str = "auto",
) -> list[str]:
    """
    Translate lines in character-aware batches.

    Strategy
    --------
    1.  Group lines into batches that stay under _GOOGLE_CHAR_LIMIT characters
        and _BATCH_LINE_LIMIT lines.
    2.  Submit each batch with translate_batch().
    3.  On batch failure, retry each line individually.
    4.  If per-line retry also fails, silently keep the original.
    """
    result = list(lines)  # seed with originals so any failure leaves them intact

    pending_indices: list[int] = []
    pending_chars   = 0

    g_source = _normalize_google_lang(source_lang)
    g_target = _normalize_google_lang(target_lang)

    def _flush(indices: list[int]) -> None:
        if not indices:
            return
        texts = [lines[i] for i in indices]
        try:
            translator = _GoogleTranslator(source=g_source, target=g_target)
            batch_result = translator.translate_batch(texts)
            for idx, translated in zip(indices, batch_result):
                if translated:
                    result[idx] = translated
        except Exception as batch_exc:
            logger.warning(
                f"[subtitle_translator] batch ({len(indices)} lines) failed "
                f"({g_source} --> {batch_exc}) — retrying line-by-line"
            )
            for idx, text in zip(indices, texts):
                try:
                    t = _GoogleTranslator(source=g_source, target=g_target).translate(text)
                    if t:
                        result[idx] = t
                except Exception as line_exc:
                    logger.debug(
                        f"[subtitle_translator] line fallback failed: {line_exc} — keeping original"
                    )

    for i, line in enumerate(lines):
        line_len = len(line)
        if (
            pending_chars + line_len > _GOOGLE_CHAR_LIMIT
            or len(pending_indices) >= _BATCH_LINE_LIMIT
        ):
            _flush(pending_indices)
            pending_indices = []
            pending_chars   = 0

        pending_indices.append(i)
        pending_chars += line_len

    _flush(pending_indices)
    return result
