"""
generate_audio.py
-----------------
Generate MP3 audio files from a chapter's _final.xlsx using edge-tts.

Produces up to 2 MP3s per vocab word:
  - {word}_isolated.mp3   - just the word
  - {word}_sentence.mp3   - the context sentence

Voice: zh-CN-XiaoxiaoNeural
Rate:  -10% (slightly slower for learner comprehension)

Runs only in GitHub Codespaces (see Project Plan Section 11.8).

Rev 5 (M2.5 T4):
    - Reads ChapterID + ChapterTitle directly from the Meta sheet.
    - Filename-regex inference is retained only as a last-resort fallback
      (in case a resave accidentally strips the Meta sheet).
    - Reads vocab rows from the Review sheet as before.

Usage:
    python content-pipeline/generate_audio.py --input inputs/chapter00_final.xlsx
"""

import argparse
import asyncio
import os
import re
import sys

from openpyxl import load_workbook
import edge_tts


VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-10%"  # 10% slower than default for better learner comprehension


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def clean_text(text):
    if text is None:
        return ""
    return str(text).replace("\xa0", "").strip()


def parse_meta(wb, input_path):
    """Extract ChapterID + ChapterTitle.

    Primary source: the Meta sheet (always present after M2.5 T2).
    Fallback: infer ChapterID from filename (chapter00_final.xlsx -> "00").
    """
    chapter_id = None
    chapter_title = ""

    # ---- Primary path: Meta sheet ----
    if "Meta" in wb.sheetnames:
        meta = wb["Meta"]
        for row in meta.iter_rows(min_row=2, values_only=True):
            field = row[0]
            value = row[1] if len(row) > 1 else None
            if field == "ChapterID" and value is not None:
                if isinstance(value, (int, float)):
                    chapter_id = f"{int(value):02d}"
                else:
                    chapter_id = clean_text(value).zfill(2)
            elif field == "ChapterTitle" and value:
                chapter_title = clean_text(value)

    # ---- Fallback: infer chapter_id from filename ----
    if not chapter_id:
        basename = os.path.basename(input_path)
        m = re.search(r"chapter(\d+)", basename, re.IGNORECASE)
        if m:
            chapter_id = m.group(1).zfill(2)
            print(f"[WARN] ChapterID missing from Meta - inferred '{chapter_id}' from filename.")

    if not chapter_id:
        print("[ERROR] Could not determine ChapterID from Meta sheet or filename.")
        sys.exit(1)

    return chapter_id, chapter_title


def read_final_excel(input_path):
    """Read _final.xlsx. Returns (chapter_id, chapter_title, words list)."""
    wb = load_workbook(input_path)
    chapter_id, chapter_title = parse_meta(wb, input_path)

    # Vocab data still lives on the Review sheet
    if "Review" not in wb.sheetnames:
        print("[ERROR] Workbook is missing the Review sheet.")
        sys.exit(1)
    ws = wb["Review"]

    words = []
    # Data rows start at row 4 (title r1, subtitle r2, header r3)
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row and row[0]:  # has traditional character
            traditional = clean_text(row[0])
            context = clean_text(row[3]) if len(row) > 3 and row[3] else ""
            words.append({"traditional": traditional, "context": context})

    return chapter_id, chapter_title, words


# ------------------------------------------------------------------
# Audio generation
# ------------------------------------------------------------------
async def generate_mp3(text, output_path, voice=VOICE, rate=RATE):
    """Generate one MP3 file using edge-tts."""
    tts = edge_tts.Communicate(text, voice, rate=rate)
    await tts.save(output_path)


async def generate_chapter_audio(input_path):
    print(f"[INFO] Loading: {input_path}")
    if not os.path.exists(input_path):
        print(f"[ERROR] File not found: {input_path}")
        sys.exit(1)

    chapter_id, chapter_title, words = read_final_excel(input_path)
    print(f"[INFO] ChapterID: {chapter_id}")
    print(f"[INFO] Title:     {chapter_title}")
    print(f"[INFO] Words:     {len(words)}")

    audio_dir = f"audio/chapter{chapter_id}"
    os.makedirs(audio_dir, exist_ok=True)
    print(f"[INFO] Output folder: {audio_dir}/")
    print()

    # Count total MP3s to generate
    total = sum(2 if w["context"] else 1 for w in words)
    count = 0

    for w in words:
        word = w["traditional"]
        context = w["context"]

        # Isolated word MP3
        count += 1
        iso_path = os.path.join(audio_dir, f"{word}_isolated.mp3")
        print(f"[{count}/{total}] {word}_isolated.mp3 ... ", end="", flush=True)
        try:
            await generate_mp3(word, iso_path)
            size = os.path.getsize(iso_path)
            print(f"OK ({size} bytes)")
        except Exception as e:
            print(f"FAILED: {e}")

        # Sentence MP3 (only if context exists)
        if context:
            count += 1
            sent_path = os.path.join(audio_dir, f"{word}_sentence.mp3")
            print(f"[{count}/{total}] {word}_sentence.mp3 ... ", end="", flush=True)
            try:
                await generate_mp3(context, sent_path)
                size = os.path.getsize(sent_path)
                print(f"OK ({size} bytes)")
            except Exception as e:
                print(f"FAILED: {e}")
        else:
            print(f"       (skipping sentence MP3 - no context for {word})")

    print()
    print("=" * 60)
    print(f"[OK] Audio generation complete!")
    print(f"     Folder: {audio_dir}/")
    print(f"     Files created: {len(os.listdir(audio_dir))}")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Generate MP3 audio via edge-tts.")
    parser.add_argument("--input", required=True, help="Path to chapterXX_final.xlsx")
    args = parser.parse_args()

    input_path = args.input
    if not os.path.isabs(input_path):
        input_path = os.path.join("content-pipeline", input_path)

    asyncio.run(generate_chapter_audio(input_path))


if __name__ == "__main__":
    main()