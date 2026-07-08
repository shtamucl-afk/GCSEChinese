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
import sys

from openpyxl import load_workbook
import edge_tts

# Shared pipeline helpers (M8.3c-1)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_common import clean_text, parse_meta, validate_book_and_paths, LANGUAGES


def read_final_excel(input_path):
    """Read _final.xlsx. Returns (book_id, chapter_id, chapter_title, words list)."""
    wb = load_workbook(input_path)
    book_id, chapter_id, chapter_title = parse_meta(wb)
    validate_book_and_paths(book_id, chapter_id, input_path)

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

    return book_id, chapter_id, chapter_title, words


# ------------------------------------------------------------------
# Audio generation
# ------------------------------------------------------------------
async def generate_mp3(text, output_path, voice, rate):
    """Generate one MP3 file using edge-tts."""
    tts = edge_tts.Communicate(text, voice, rate=rate)
    await tts.save(output_path)


async def generate_chapter_audio(input_path):
    print(f"[INFO] Loading: {input_path}")
    if not os.path.exists(input_path):
        print(f"[ERROR] File not found: {input_path}")
        sys.exit(1)

    book_id, chapter_id, chapter_title, words = read_final_excel(input_path)
    print(f"[INFO] BookID:    {book_id}")
    print(f"[INFO] ChapterID: {chapter_id}")
    print(f"[INFO] Title:     {chapter_title}")
    print(f"[INFO] Words:     {len(words)}")
    print(f"[INFO] Languages: {list(LANGUAGES.keys())}")

    audio_dir = f"audio/book{book_id}/chapter{chapter_id}"
    os.makedirs(audio_dir, exist_ok=True)
    print(f"[INFO] Output folder: {audio_dir}/")
    print()

    # Count total MP3s to generate:
    # for each word: 1 isolated MP3 per language, plus 1 sentence MP3 per language if context exists
    n_langs = len(LANGUAGES)
    total = 0
    for w in words:
        total += n_langs  # isolated in each language
        if w["context"]:
            total += n_langs  # sentence in each language

    count = 0

    for i, w in enumerate(words, start=1):
        word = w["traditional"]
        context = w["context"]
        word_id = f"b{book_id}_ch{chapter_id}_w{i:03d}"

        for lang_name, lang_config in LANGUAGES.items():
            voice = lang_config["voice"]
            rate = lang_config["rate"]
            suffix = lang_config["suffix"]

            # Isolated word MP3
            count += 1
            iso_filename = f"{word_id}_{suffix}_isolated.mp3"
            iso_path = os.path.join(audio_dir, iso_filename)
            print(f"[{count}/{total}] {iso_filename} ({word}, {lang_name}) ... ",
                  end="", flush=True)
            try:
                await generate_mp3(word, iso_path, voice, rate)
                size = os.path.getsize(iso_path)
                print(f"OK ({size} bytes)")
            except Exception as e:
                print(f"FAILED: {e}")

            # Sentence MP3 (only if context exists)
            if context:
                count += 1
                sent_filename = f"{word_id}_{suffix}_sentence.mp3"
                sent_path = os.path.join(audio_dir, sent_filename)
                print(f"[{count}/{total}] {sent_filename} ({word}, {lang_name}) ... ",
                      end="", flush=True)
                try:
                    await generate_mp3(context, sent_path, voice, rate)
                    size = os.path.getsize(sent_path)
                    print(f"OK ({size} bytes)")
                except Exception as e:
                    print(f"FAILED: {e}")

        if not context:
            print(f"       (no sentence MP3 for {word} - no context)")

    print()
    print("=" * 60)
    print(f"[OK] Audio generation complete!")
    print(f"     Folder: {audio_dir}/")
    print(f"     Files created: {len(os.listdir(audio_dir))}")
    print(f"     Languages: {list(LANGUAGES.keys())}")
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