"""
generate_audio.py
-----------------
Generate MP3 audio files from a chapter's _final.xlsx using edge-tts.
Produces up to 2 MP3s per vocab word:
  - {word}_isolated.mp3 - just the word
  - {word}_sentence.mp3 - the context sentence

Voice: zh-TW-HsiaoChenNeural (Mandarin Taiwan, female neural)
Runs only in GitHub Codespaces (see Project Plan Section 11.8).

Usage:
    python content-pipeline/generate_audio.py --input inputs/chapter00_final.xlsx
"""

import argparse
import asyncio
import os
import sys
from openpyxl import load_workbook
import edge_tts

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-10%"  # 10% slower than default for better learner comprehension


def clean_text(text):
    if text is None:
        return ""
    return str(text).replace("\xa0", "").strip()


def parse_meta_from_review_header(wb, input_path):
    """Parse ChapterID from filename and title from Review sheet A1.
    
    _final.xlsx files are derived from _review.xlsx which only has a Review sheet.
    The A1 cell contains: "Chapter 00: Test Chapter - Title"
    """
    import re as _re
    chapter_id = None
    chapter_title = ""
    
    # 1. Infer chapter_id from filename: chapter00_final.xlsx -> "00"
    basename = os.path.basename(input_path)
    m = _re.search(r"chapter(\d+)", basename, _re.IGNORECASE)
    if m:
        chapter_id = m.group(1).zfill(2)
    
    # 2. Get title from Review sheet A1 (format: "Chapter 00: Title")
    if "Review" in wb.sheetnames:
        ws = wb["Review"]
        a1 = ws["A1"].value
        if a1:
            # Strip "Chapter XX:" prefix if present
            title_match = _re.match(r"^Chapter\s+\d+:\s*(.+)$", str(a1))
            if title_match:
                chapter_title = title_match.group(1).strip()
            else:
                chapter_title = str(a1).strip()
    
    # 3. Fallback: also check for Meta sheet (backwards compatibility)
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
    
    return chapter_id, chapter_title


def read_final_excel(input_path):
    """Read _final.xlsx. Returns (chapter_id, chapter_title, words list)."""
    wb = load_workbook(input_path)
    chapter_id, chapter_title = parse_meta_from_review_header(wb, input_path)
    
    # Find data sheet: prefer "Review", fall back to first non-Meta sheet
    ws = None
    if "Review" in wb.sheetnames:
        ws = wb["Review"]
    else:
        for name in wb.sheetnames:
            if name not in ("Meta", "Instructions"):
                ws = wb[name]
                break
    if ws is None:
        print("[ERROR] Could not find data sheet in workbook.")
        sys.exit(1)
    
    words = []
    # Data rows start at row 4 (title row 1, subtitle row 2, header row 3)
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row[0]: # has traditional character
            traditional = clean_text(row[0])
            context = clean_text(row[3]) if len(row) > 3 and row[3] else ""
            words.append({"traditional": traditional, "context": context})
    return chapter_id, chapter_title, words


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
    print(f"[INFO] Title: {chapter_title}")
    print(f"[INFO] Words: {len(words)}")
    
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
