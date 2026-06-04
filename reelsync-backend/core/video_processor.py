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

# ── All subtitle metrics are derived from video dimensions ───────────────────
# Nothing is a hardcoded pixel value.  Every constant below is a RATIO so the
# rendered result looks identical whether the video is 360p, 1080p, 4K, or a
# vertical 9:16 Reels clip.
CAPTION_COLOR        = (255, 255, 255, 255)
CAPTION_STROKE_COLOR = (0, 0, 0, 255)
CAPTION_BOX_COLOR    = (0, 0, 0, 115)   # black ~45% opacity

# Ratios (all relative to video_h unless stated)
_FONT_RATIO          = 0.035   # font size  ≈ 3.5 % of height
_FONT_MIN            = 20      # px floor — legible on tiny clips
_FONT_MAX            = 48      # px ceiling — doesn't balloon on 4K

_STROKE_RATIO        = 0.05    # stroke     ≈ 5 % of font size   (min 1 px)
_LINE_SPACING_RATIO  = 0.15    # gap        ≈ 15% of font size   (min 3 px)
_BOTTOM_PAD_RATIO    = 0.025   # gap above bottom edge ≈ 2.5% of height
_BOX_PAD_RATIO       = 0.20    # box inset  ≈ 20% of font size   (min 4 px)
_TEXT_WIDTH_RATIO    = 0.78    # subtitle column ≈ 78% of video width


def _subtitle_metrics(video_w: int, video_h: int) -> dict:
    """
    Return every subtitle dimension scaled to the actual video resolution.
    Call once per subtitle image render so nothing is ever hard-coded.
    """
    font_size    = max(_FONT_MIN, min(int(video_h * _FONT_RATIO), _FONT_MAX))
    stroke_w     = max(1, int(font_size * _STROKE_RATIO))
    line_spacing = max(3, int(font_size * _LINE_SPACING_RATIO))
    bottom_pad   = max(10, int(video_h * _BOTTOM_PAD_RATIO))
    box_pad      = max(4,  int(font_size * _BOX_PAD_RATIO))
    max_text_w   = int(video_w * _TEXT_WIDTH_RATIO)
    return {
        "font_size":    font_size,
        "stroke_w":     stroke_w,
        "line_spacing": line_spacing,
        "line_h":       font_size + line_spacing,
        "bottom_pad":   bottom_pad,
        "box_pad":      box_pad,
        "max_text_w":   max_text_w,
    }

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
    m    = _subtitle_metrics(video_w, video_h)
    img  = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _load_font(m["font_size"], lang)

    lines   = _wrap_text(text, font, draw, m["max_text_w"])
    block_h = len(lines) * m["line_h"]

    # Widest rendered line — drives background box width
    line_widths = [draw.textbbox((0, 0), ln, font=font)[2] for ln in lines]
    max_line_w  = max(line_widths) if line_widths else m["max_text_w"]

    # Bottom-anchor: place the block flush to the lower safe area
    y0 = video_h - block_h - m["bottom_pad"]

    # Translucent background pill
    bp = m["box_pad"]
    draw.rectangle(
        [
            (video_w - max_line_w) // 2 - bp,
            y0 - bp,
            (video_w + max_line_w) // 2 + bp,
            y0 + block_h + bp,
        ],
        fill=CAPTION_BOX_COLOR,
    )

    # Render each line: stroke first, then white fill on top
    sw = m["stroke_w"]
    y  = y0
    for line in lines:
        bbox   = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (video_w - text_w) // 2

        for dx in range(-sw, sw + 1):
            for dy in range(-sw, sw + 1):
                if dx or dy:
                    draw.text((x + dx, y + dy), line, font=font, fill=CAPTION_STROKE_COLOR)

        draw.text((x, y), line, font=font, fill=CAPTION_COLOR)
        y += m["line_h"]

    return np.array(img)


# ── Free-tier watermark ───────────────────────────────────────────────────────
_WATERMARK_TEXT        = "REELSYNC FREE TRIAL"
_WATERMARK_OPACITY     = 60     # 0-255; 60 ≈ 24% — clearly visible without being distracting
_WATERMARK_ANGLE       = 30     # degrees counter-clockwise
_WATERMARK_FONT_RATIO  = 0.07   # 7% of the shorter video dimension


def _render_watermark_image(video_w: int, video_h: int) -> np.ndarray:
    """
    Diagonal semi-transparent watermark for free-tier output.

    Strategy
    --------
    1.  Measure the text at a size proportional to the video dimensions.
    2.  Render it white at ~15% opacity on an oversized transparent canvas
        (padding prevents rotation from clipping the corners).
    3.  Rotate the canvas 30° and paste it centred on the full video frame.
    4.  Return as RGBA numpy array — composited as a static ImageClip that
        spans the whole video duration via MoviePy.
    """
    base = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))

    font_size = max(18, int(min(video_w, video_h) * _WATERMARK_FONT_RATIO))
    font      = _load_font(font_size, "en")

    # Measure text on a throwaway draw so we know canvas size
    probe = ImageDraw.Draw(base)
    bbox  = probe.textbbox((0, 0), _WATERMARK_TEXT, font=font)
    tw    = bbox[2] - bbox[0]
    th    = bbox[3] - bbox[1]

    # Padded canvas — enough room for the text to rotate without clipping
    pad    = int(max(tw, th) * 0.65)
    canvas = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text(
        (pad, pad),
        _WATERMARK_TEXT,
        font=font,
        fill=(255, 255, 255, _WATERMARK_OPACITY),
    )

    # Rotate, then centre on the video frame
    rotated = canvas.rotate(_WATERMARK_ANGLE, expand=True, resample=Image.BICUBIC)
    x = (video_w - rotated.width)  // 2
    y = (video_h - rotated.height) // 2
    base.paste(rotated, (x, y), rotated)

    return np.array(base)


class VideoEngine:
    def burn_assets(
        self,
        original_video_path: str,
        dubbed_audio_path: str,
        subtitles_data: list[dict],
        output_path: str,
        target_lang: str = "",
        watermark: bool = False,
        output_height: int = 0,
    ) -> str:
        logger.info(f"Loading video: {original_video_path}")
        video = VideoFileClip(original_video_path)

        # Build the FFmpeg scale filter string for the encoding pass.
        # We intentionally do NOT resize the MoviePy clip here so that
        # subtitle text and watermarks composite at the source resolution
        # (sharpest possible glyphs).  The scale filter runs inside FFmpeg's
        # encoding pipeline — one decode→composite→encode pass, no double
        # transcoding.
        #
        # scale=-2:{h}  →  height is the user's requested value;
        #                   width is auto-calculated to preserve aspect ratio
        #                   and be divisible by 2 (H.264 requirement).
        #
        # A target height that is 0, None, or ≥ the source height means
        # "match source" — we skip the filter entirely so FFmpeg never upscales.
        native_h = video.h
        if output_height and 0 < output_height < native_h:
            _scale_filter = ["-vf", f"scale=-2:{output_height}"]
            logger.info(
                f"[video_processor] FFmpeg scale filter will downscale "
                f"{native_h}px → {output_height}px at encode time"
            )
        else:
            _scale_filter = []

        logger.info(f"Loading dubbed audio: {dubbed_audio_path}")
        audio = AudioFileClip(dubbed_audio_path)

        video = self._reconcile_duration(video, audio)
        video_with_audio = video.without_audio().set_audio(audio)

        subtitle_clips = self._build_subtitle_clips(
            subtitles_data, video.w, video.h, target_lang
        )

        # Build composite layer stack: base → subtitles → watermark (top)
        overlay_clips: list = subtitle_clips[:]

        if watermark:
            logger.info(
                f"[watermark] applying free-tier watermark "
                f"({video.w}x{video.h}, {video.duration:.1f}s)"
            )
            wm_frame = _render_watermark_image(video.w, video.h)
            # MoviePy does not auto-extract alpha from RGBA arrays — split manually.
            wm_rgb   = wm_frame[:, :, :3]
            wm_alpha = wm_frame[:, :, 3].astype(float) / 255.0
            wm_clip  = (
                ImageClip(wm_rgb, ismask=False)
                .set_mask(ImageClip(wm_alpha, ismask=True))
                .set_duration(video.duration)
            )
            overlay_clips.append(wm_clip)

        if overlay_clips:
            logger.info(
                f"Compositing: {len(subtitle_clips)} subtitle(s)"
                f"{' + watermark' if watermark else ''}"
            )
            final = CompositeVideoClip([video_with_audio] + overlay_clips)
        else:
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
