import logging
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy.editor import (
    AudioFileClip,
    CompositeVideoClip,
    ImageClip,
    VideoFileClip,
    concatenate_videoclips,
)

logger = logging.getLogger(__name__)

CAPTION_FONTSIZE = 58
CAPTION_COLOR = (255, 255, 255, 255)
CAPTION_STROKE_COLOR = (0, 0, 0, 255)
CAPTION_STROKE_WIDTH = 3
CAPTION_Y_RATIO = 0.70

_FONTS_DIR = r"C:\Windows\Fonts"

# Per-language font preference list — ordered best-to-fallback.
# NirmalaUI covers most Indic scripts on Windows 8+.
# Font entry: filename and optional TTC collection index (None = not a TTC)
_FontEntry = tuple[str, int | None]

# Per-language font preference list — ordered best-to-fallback.
# Nirmala.ttc index 1 = bold weight; covers all major Indic scripts on Windows 8+.
_LANG_FONTS: dict[str, list[_FontEntry]] = {
    "hi": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0), ("mangal.ttf", None)],
    "te": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0), ("gautamib.ttf", None), ("gautami.ttf", None)],
    "ta": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0), ("Latha.ttf", None)],
    "kn": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0)],
    "ml": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0)],
    "bn": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0), ("Vrinda.ttf", None)],
    "gu": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0)],
    "pa": [("Nirmala.ttc", 1), ("Nirmala.ttc", 0)],
    "ar": [("arial.ttf", None), ("tahoma.ttf", None)],
    "zh": [("msyh.ttc", 0),    ("simsun.ttc", 0)],
    "ja": [("meiryo.ttc", 0),  ("msmincho.ttc", 0)],
    "ko": [("malgun.ttf", None)],
    "ru": [("arialbd.ttf", None), ("arial.ttf", None)],
    "uk": [("arialbd.ttf", None), ("arial.ttf", None)],
}

_LATIN_FONTS: list[_FontEntry] = [
    ("arialbd.ttf", None), ("arial.ttf", None),
    ("calibrib.ttf", None), ("verdanab.ttf", None), ("verdana.ttf", None),
]


def _load_font(size: int, lang: str = "") -> ImageFont.FreeTypeFont:
    candidates: list[_FontEntry] = list(_LANG_FONTS.get(lang, [])) + _LATIN_FONTS
    for filename, ttc_index in candidates:
        path = os.path.join(_FONTS_DIR, filename)
        if not os.path.isfile(path):
            continue
        try:
            if ttc_index is not None:
                font = ImageFont.truetype(path, size, index=ttc_index)
            else:
                font = ImageFont.truetype(path, size)
            logger.debug(f"Font loaded: {filename} (index={ttc_index})")
            return font
        except Exception:
            continue
    logger.warning("No usable TrueType font found — using PIL default bitmap font.")
    return ImageFont.load_default()


def _wrap_text(
    text: str,
    font: ImageFont.FreeTypeFont,
    draw: ImageDraw.ImageDraw,
    max_px: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []

    for word in words:
        candidate = " ".join(current + [word])
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_px:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]

    if current:
        lines.append(" ".join(current))

    return lines or [text]


def _render_subtitle_image(
    text: str, video_w: int, video_h: int, lang: str
) -> np.ndarray:
    img = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _load_font(CAPTION_FONTSIZE, lang)

    max_text_w = int(video_w * 0.88)
    lines = _wrap_text(text, font, draw, max_text_w)

    line_spacing = 10
    line_h = CAPTION_FONTSIZE + line_spacing
    block_h = len(lines) * line_h
    y = int(video_h * CAPTION_Y_RATIO) - block_h // 2

    sw = CAPTION_STROKE_WIDTH
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (video_w - text_w) // 2

        for dx in range(-sw, sw + 1):
            for dy in range(-sw, sw + 1):
                if dx != 0 or dy != 0:
                    draw.text(
                        (x + dx, y + dy),
                        line,
                        font=font,
                        fill=CAPTION_STROKE_COLOR,
                    )

        draw.text((x, y), line, font=font, fill=CAPTION_COLOR)
        y += line_h

    return np.array(img)


class VideoEngine:
    def burn_assets(
        self,
        original_video_path: str,
        dubbed_audio_path: str,
        subtitles_data: list[dict],
        output_path: str,
        target_lang: str = "",
    ) -> str:
        logger.info(f"Loading video: {original_video_path}")
        video = VideoFileClip(original_video_path)

        logger.info(f"Loading dubbed audio: {dubbed_audio_path}")
        audio = AudioFileClip(dubbed_audio_path)

        video = self._reconcile_duration(video, audio)
        video_with_audio = video.without_audio().set_audio(audio)

        subtitle_clips = self._build_subtitle_clips(
            subtitles_data, video.w, video.h, target_lang
        )

        if subtitle_clips:
            logger.info(f"Compositing {len(subtitle_clips)} subtitle overlay(s)...")
            final = CompositeVideoClip([video_with_audio] + subtitle_clips)
        else:
            logger.warning("No subtitles rendered — outputting audio-swap only.")
            final = video_with_audio

        logger.info(f"Writing output: {output_path}")
        final.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=output_path + ".temp_audio.m4a",
            remove_temp=True,
            logger=None,
        )

        video.close()
        audio.close()
        final.close()

        return os.path.abspath(output_path)

    def _reconcile_duration(
        self, video: VideoFileClip, audio: AudioFileClip
    ) -> VideoFileClip:
        video_dur = video.duration
        audio_dur = audio.duration

        if abs(audio_dur - video_dur) < 0.05:
            return video

        if audio_dur > video_dur:
            overhang = audio_dur - video_dur
            logger.info(
                f"Dubbed audio is {overhang:.2f}s longer — extending video by holding last frame."
            )
            hold = ImageClip(video.get_frame(video_dur - 0.02)).set_duration(overhang)
            return concatenate_videoclips([video, hold])

        logger.info(
            f"Trimming video by {video_dur - audio_dur:.2f}s to match audio length."
        )
        return video.subclip(0, audio_dur)

    def _build_subtitle_clips(
        self,
        subtitles_data: list[dict],
        video_w: int,
        video_h: int,
        lang: str,
    ) -> list[ImageClip]:
        clips: list[ImageClip] = []

        for sub in subtitles_data:
            text = sub["text"].strip()
            duration = sub["end"] - sub["start"]
            if not text or duration <= 0:
                continue

            try:
                frame = _render_subtitle_image(text, video_w, video_h, lang)
                clip = (
                    ImageClip(frame, ismask=False)
                    .set_start(sub["start"])
                    .set_duration(duration)
                )
                clips.append(clip)
            except Exception as exc:
                logger.warning(
                    f"Skipping subtitle at {sub['start']:.2f}s — render error: {exc}"
                )

        return clips
