import logging
import math
import os
import platform
import shutil
import subprocess
import tempfile
from typing import Optional

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


def _find_realesrgan_cli() -> Optional[str]:
    for tool in ("realesrgan-ncnn-vulkan", "realesrgan-ncnn-vulkan.exe"):
        path = shutil.which(tool)
        if path:
            return path
    return None


def _run_realesrgan_cli(input_path: str, output_path: str, scale: int) -> None:
    cli = _find_realesrgan_cli()
    if not cli:
        raise RuntimeError("Real-ESRGAN CLI not found on PATH.")

    command = [
        cli,
        "-i",
        input_path,
        "-o",
        output_path,
        "-s",
        str(scale),
    ]
    subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=3600,
    )


def _ffmpeg_scale(input_path: str, output_path: str, width: int, height: int) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-vf",
            f"scale={width}:{height}:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "18",
            "-c:a",
            "copy",
            output_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=3600,
    )


def _repair_video_for_moviepy(input_path: str) -> str:
    """
    Re-encode problematic uploads into a MoviePy-friendly MP4 container.

    Some user uploads open in ffmpeg but fail when MoviePy tries to read their
    first frame lazily. In that case we normalize the stream once and continue
    the render against the repaired asset.
    """
    fd, repaired_path = tempfile.mkstemp(suffix=".mp4", prefix="reelsync_moviepy_fix_")
    os.close(fd)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                repaired_path,
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3600,
        )
        return repaired_path
    except Exception:
        try:
            os.remove(repaired_path)
        except OSError:
            pass
        raise


def _open_video_clip_with_fallback(video_path: str) -> tuple[VideoFileClip, Optional[str]]:
    """
    Open a video for MoviePy and validate that at least one frame is readable.

    Returns:
        (clip, repaired_temp_path)
    """
    try:
        clip = VideoFileClip(video_path)
        clip.get_frame(0)
        return clip, None
    except Exception as exc:
        logger.warning(
            "[video_processor] MoviePy could not read source video '%s' directly (%s). "
            "Attempting ffmpeg normalization fallback.",
            video_path,
            exc,
        )
        try:
            clip.close()
        except Exception:
            pass
        repaired_path = _repair_video_for_moviepy(video_path)
        repaired_clip = VideoFileClip(repaired_path)
        repaired_clip.get_frame(0)
        logger.info(
            "[video_processor] Using normalized video fallback for MoviePy: %s",
            repaired_path,
        )
        return repaired_clip, repaired_path


def _escape_drawtext_text(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace(":", "\\:")
            .replace(",", "\\,")
            .replace("%", "\\%")
    )


def get_system_font() -> str:
    system = platform.system()
    if system == "Windows":
        windows_candidates = [
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/verdana.ttf",
        ]
        for path in windows_candidates:
            if os.path.exists(path):
                # FFmpeg on Windows accepts forward slashes and requires colon escaping.
                return path.replace("\\", "/").replace(":", "\\:")
        raise RuntimeError("No Windows font file found for FFmpeg drawtext watermark.")

    if system == "Darwin":
        mac_path = "/Library/Fonts/Arial.ttf"
        if os.path.exists(mac_path):
            return mac_path
        raise RuntimeError("No macOS font file found for FFmpeg drawtext watermark.")

    linux_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if os.path.exists(linux_path):
        return linux_path
    return "Arial"


def _build_watermark_drawtext_filter(watermark_text: str) -> str:
    text = _escape_drawtext_text(watermark_text)
    fontfile = get_system_font()
    return (
        f"drawtext=text='{text}':"
        f"fontfile='{fontfile}':"
        f"fontsize=h/14:fontcolor=white@0.12:shadowcolor=black@0.10:shadowx=2:shadowy=2:"
        f"x=(w-tw)/2:y=(h-th)/2:box=0"
    )


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
        output_aspect_ratio: str = "original",
        watermark_text: str = "ReelSync AI",
        upscale_required: bool = False,
    ) -> str:
        logger.info(f"Loading video: {original_video_path}")
        repaired_video_path: Optional[str] = None
        video, repaired_video_path = _open_video_clip_with_fallback(original_video_path)

        native_w = video.w
        native_h = video.h
        ffmpeg_params: list[str] = []
        intermediate_output_path = output_path
        target_w = native_w
        target_h = native_h
        processing_h = native_h

        if output_aspect_ratio == "original":
            if upscale_required and output_height and output_height > native_h:
                intermediate_output_path = output_path + ".intermediate.mp4"
                target_h = output_height
                target_w = int(round(native_w * target_h / native_h))
                target_w -= target_w % 2
                logger.info(
                    "[video_processor] AI upscale requested for original aspect ratio; "
                    "creating a native-resolution intermediate before super-resolution"
                )
            elif output_height and 0 < output_height < native_h:
                ffmpeg_params = ["-vf", f"scale=-2:{output_height}"]
                target_h = output_height
                target_w = int(round(native_w * target_h / native_h))
                target_w -= target_w % 2
                logger.info(
                    f"[video_processor] FFmpeg scale filter will downscale "
                    f"{native_h}px → {output_height}px at encode time"
                )
        else:
            ratio_w, ratio_h = (16, 9) if output_aspect_ratio == "16:9" else (9, 16)
            if output_height and output_height > 0:
                desired_h = output_height
            else:
                desired_h = native_h

            if upscale_required and desired_h > native_h:
                processing_h = native_h
            else:
                processing_h = min(desired_h, native_h)

            processing_w = int(round((processing_h * ratio_w) / ratio_h))
            processing_w -= processing_w % 2
            processing_h -= processing_h % 2

            if processing_w > native_w:
                processing_w = native_w - (native_w % 2)
                processing_h = int(round((processing_w * ratio_h) / ratio_w))
                processing_h -= processing_h % 2

            target_h = desired_h
            target_w = int(round((target_h * ratio_w) / ratio_h))
            target_w -= target_w % 2

            if processing_w > 0 and processing_h > 0 and (
                processing_w != native_w or processing_h != native_h
            ):
                ffmpeg_params = [
                    "-vf",
                    (
                        f"scale=w={processing_w}:h={processing_h}:force_original_aspect_ratio=decrease," +
                        f"pad=w={processing_w}:h={processing_h}:x=(ow-iw)/2:y=(oh-ih)/2:color=black"
                    ),
                ]
                logger.info(
                    f"[video_processor] FFmpeg aspect filter will encode to "
                    f"{processing_w}x{processing_h} ({output_aspect_ratio})"
                )

            if upscale_required and desired_h > native_h:
                intermediate_output_path = output_path + ".intermediate.mp4"
                logger.info(
                    "[video_processor] AI upscale requested for aspect ratio change; "
                    "creating a ratio-correct intermediate before super-resolution"
                )

        if watermark_text:
            watermark_filter = _build_watermark_drawtext_filter(watermark_text)
            if ffmpeg_params and ffmpeg_params[0] == "-vf":
                ffmpeg_params[1] = f"{ffmpeg_params[1]},{watermark_filter}"
            else:
                ffmpeg_params = ["-vf", watermark_filter]

        ffmpeg_params.extend(["-preset", "ultrafast", "-crf", "26"])

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

        logger.info(f"Writing output: {intermediate_output_path}")
        final.write_videofile(
            intermediate_output_path,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=intermediate_output_path + ".temp_audio.m4a",
            remove_temp=True,
            ffmpeg_params=ffmpeg_params,
            logger=None,
        )

        if upscale_required and intermediate_output_path != output_path:
            logger.info(
                f"[video_processor] Performing AI super-resolution to target {target_w}x{target_h}"
            )
            scale = max(2, min(4, math.ceil(target_h / float(processing_h or 1))))
            try:
                _run_realesrgan_cli(intermediate_output_path, output_path, scale=scale)
            except Exception as ai_exc:
                logger.warning(
                    f"AI upscaling failed ({ai_exc}); falling back to high-quality ffmpeg scaling"
                )
                _ffmpeg_scale(intermediate_output_path, output_path, target_w, target_h)
            finally:
                try:
                    os.remove(intermediate_output_path)
                except OSError:
                    pass
        else:
            if intermediate_output_path != output_path:
                shutil.move(intermediate_output_path, output_path)

        video.close()
        audio.close()
        final.close()
        if repaired_video_path:
            try:
                os.remove(repaired_video_path)
            except OSError:
                logger.warning(
                    "[video_processor] Could not remove temporary repaired video: %s",
                    repaired_video_path,
                )

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
            freeze_candidates = [
                max(video_dur - 0.02, 0),
                max(video_dur - 0.25, 0),
                max(video_dur - 0.5, 0),
                0,
            ]
            freeze_frame = None
            last_error: Exception | None = None
            for freeze_t in freeze_candidates:
                try:
                    freeze_frame = video.get_frame(freeze_t)
                    break
                except Exception as exc:
                    last_error = exc
            if freeze_frame is None:
                raise RuntimeError(
                    f"Could not extract a readable frame for video extension: {last_error}"
                ) from last_error
            hold = ImageClip(freeze_frame).set_duration(overhang)
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
