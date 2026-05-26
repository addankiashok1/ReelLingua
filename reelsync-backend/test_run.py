"""
ReelSync AI — Phase 1 CLI Entrypoint

Usage:
    python test_run.py

You will be prompted for:
    1. Path to your local input video (MP4 recommended, ~60s vertical)
    2. Target language code (e.g. 'hi' for Hindi, 'te' for Telugu, 'es' for Spanish)
"""

import os
import sys

SUPPORTED_LANGS = {
    "ar": "Arabic",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "hi": "Hindi",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ru": "Russian",
    "te": "Telugu",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "zh": "Chinese",
}


def prompt_video_path() -> str:
    while True:
        raw = input("\nEnter path to input video (MP4): ").strip().strip('"').strip("'")
        if not raw:
            print("  Path cannot be empty.")
            continue
        if not os.path.isfile(raw):
            print(f"  File not found: {raw}")
            continue
        return raw


def prompt_target_lang() -> str:
    print("\nSupported target languages:")
    for code, name in sorted(SUPPORTED_LANGS.items(), key=lambda x: x[1]):
        print(f"  {code:4s} → {name}")

    while True:
        code = input("\nEnter target language code (e.g. 'hi', 'te'): ").strip().lower()
        if not code:
            print("  Language code cannot be empty.")
            continue
        if code not in SUPPORTED_LANGS:
            print(
                f"  '{code}' is not in the supported list above, "
                "but will be sent to ElevenLabs anyway. Continue? [y/N]: ",
                end="",
            )
            if input().strip().lower() != "y":
                continue
        return code


def main() -> None:
    print("=" * 58)
    print("  ReelSync AI — Phase 1  |  Auto-Dub + Caption Burner")
    print("=" * 58)

    video_path = prompt_video_path()
    target_lang = prompt_target_lang()

    print(f"\nStarting pipeline for '{os.path.basename(video_path)}' → {target_lang}")
    print("This may take several minutes. ElevenLabs is processing your video...\n")

    try:
        from core.pipeline import ReelPipeline

        pipeline = ReelPipeline()
        output_path = pipeline.run(
            input_video_path=video_path,
            target_lang=target_lang,
        )
        print("\n" + "=" * 58)
        print("  Done! Output video saved to:")
        print(f"  {output_path}")
        print("=" * 58)

    except EnvironmentError as exc:
        print(f"\n[CONFIG ERROR] {exc}")
        print("Fix your .env file and retry.")
        sys.exit(1)

    except FileNotFoundError as exc:
        print(f"\n[FILE ERROR] {exc}")
        sys.exit(1)

    except RuntimeError as exc:
        print(f"\n[PIPELINE ERROR] {exc}")
        sys.exit(1)

    except KeyboardInterrupt:
        print("\nAborted by user.")
        sys.exit(0)


if __name__ == "__main__":
    main()
