"""
generate_chapter.py
-------------------
Orchestrator: reads _final.xlsx, produces chapter JSON + audio MP3s,
updates the master chapters index.

Rev 5 (M2.5 T3):
    - Reads Meta directly from the Meta sheet (always present after M2.5 T2).
    - Reads passages directly from the Content sheet, Column A.
      One passage per row. Internal \n (Alt+Enter) preserved verbatim.
    - Reads vocab data from the Review sheet.
    - Removes the old fallback that reconstructed passages from context
      sentences (no longer needed).
    - Fails fast with a clear error if Meta / Content / Review are missing.

Usage:
    python content-pipeline/generate_chapter.py --input inputs/chapter00_final.xlsx
    python content-pipeline/generate_chapter.py --input inputs/chapter00_final.xlsx --skip-audio
"""

import argparse
import asyncio
import json
import os
import sys

from openpyxl import load_workbook

# We still delegate audio generation to generate_audio.py.
# Meta / passage / vocab reading is self-contained in this script now.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_audio import generate_chapter_audio


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def clean_text(text):
    """Strip surrounding whitespace and non-breaking spaces.
    Preserves internal \n characters (Alt+Enter paragraph breaks)."""
    if text is None:
        return ""
    return str(text).replace("\xa0", "").strip()


def parse_meta(wb):
    """Extract ChapterID + ChapterTitle from the Meta sheet.

    With T1's text-formatted Meta!B2, ChapterID arrives as a string like
    "00", "01", ... — the int/float safety net remains in case someone
    resaves the file and accidentally loses the '@' format.
    """
    if "Meta" not in wb.sheetnames:
        print("[ERROR] Workbook is missing the Meta sheet.")
        sys.exit(1)

    meta = wb["Meta"]
    chapter_id = None
    chapter_title = None

    for row in meta.iter_rows(min_row=2, values_only=True):
        field = row[0]
        value = row[1] if len(row) > 1 else None
        if field == "ChapterID":
            if isinstance(value, (int, float)):
                chapter_id = f"{int(value):02d}"
            elif value is not None:
                chapter_id = clean_text(value).zfill(2)
        elif field == "ChapterTitle":
            chapter_title = clean_text(value)

    if not chapter_id:
        print("[ERROR] ChapterID is missing in Meta sheet.")
        sys.exit(1)
    return chapter_id, chapter_title


def read_passages(wb):
    """Read passages from the Content sheet, Column A.
    One passage per row. Internal \n (from Alt+Enter) preserved."""
    if "Content" not in wb.sheetnames:
        print("[ERROR] Workbook is missing the Content sheet.")
        sys.exit(1)

    content = wb["Content"]
    passages = []
    for row in content.iter_rows(min_row=2, values_only=True):
        cell = row[0] if row else None
        if cell is None:
            continue
        cleaned = clean_text(cell)
        if cleaned:
            passages.append(cleaned)
    return passages


def read_review_vocab(wb):
    """Read vocab rows from the Review sheet.
    Data rows start at row 4 (title r1, subtitle r2, header r3)."""
    if "Review" not in wb.sheetnames:
        print("[ERROR] Workbook is missing the Review sheet.")
        sys.exit(1)

    ws = wb["Review"]
    words = []
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row and row[0]:
            words.append({
                "traditional": clean_text(row[0]),
                "english": clean_text(row[1]) if len(row) > 1 and row[1] else "",
                "pinyin": clean_text(row[2]) if len(row) > 2 and row[2] else "",
                "context": clean_text(row[3]) if len(row) > 3 and row[3] else "",
            })
    return words


# ------------------------------------------------------------------
# Build JSON
# ------------------------------------------------------------------
def build_chapter_json(chapter_id, chapter_title, passages, words):
    """Build the chapter JSON in the schema our HTML app expects (rev 5).

    Schema:
    {
      "chapterId": "00",
      "chapterTitle": "...",
      "passages": [
        "Passage 1 paragraph 1\nPassage 1 paragraph 2",
        "Passage 2 text"
      ],
      "vocab": [
        {
          "id": "ch00_w001",
          "traditional": "...",
          "pinyin": "...",
          "english": "...",
          "contextSentence": "...",
          "audioIsolated": "audio/chapter00/xxx_isolated.mp3",
          "audioSentence": "audio/chapter00/xxx_sentence.mp3"
        }
      ]
    }
    """
    vocab = []
    for i, w in enumerate(words, start=1):
        word_id = f"ch{chapter_id}_w{i:03d}"
        entry = {
            "id": word_id,
            "traditional": w["traditional"],
            "english": w.get("english", ""),
            "pinyin": w.get("pinyin", ""),
            "contextSentence": w["context"],
            "audioIsolated": f"audio/chapter{chapter_id}/{w['traditional']}_isolated.mp3",
        }
        if w["context"]:
            entry["audioSentence"] = f"audio/chapter{chapter_id}/{w['traditional']}_sentence.mp3"
        vocab.append(entry)

    return {
        "chapterId": chapter_id,
        "chapterTitle": chapter_title,
        "passages": passages,
        "vocab": vocab,
    }


def update_chapters_index(chapter_id, chapter_title, word_count):
    """Add or update this chapter in data/chapters-index.json."""
    index_path = "data/chapters-index.json"
    os.makedirs("data", exist_ok=True)

    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    else:
        index = {"chapters": []}

    existing = None
    for ch in index["chapters"]:
        if ch["id"] == chapter_id:
            existing = ch
            break

    entry = {"id": chapter_id, "title": chapter_title, "wordCount": word_count}

    if existing:
        idx = index["chapters"].index(existing)
        index["chapters"][idx] = entry
        action = "Updated"
    else:
        index["chapters"].append(entry)
        index["chapters"].sort(key=lambda x: x["id"])
        action = "Added"

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    return action


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
async def main_async(input_path, skip_audio):
    print(f"[INFO] Processing: {input_path}")
    print()

    if not os.path.exists(input_path):
        print(f"[ERROR] File not found: {input_path}")
        sys.exit(1)

    wb = load_workbook(input_path)

    chapter_id, chapter_title = parse_meta(wb)
    passages = read_passages(wb)
    words = read_review_vocab(wb)

    print(f"[INFO] ChapterID:   {chapter_id}")
    print(f"[INFO] Title:       {chapter_title}")
    print(f"[INFO] Passages:    {len(passages)}")
    print(f"[INFO] Vocab words: {len(words)}")
    print()

    # ---- Build JSON ----
    print("[STEP 1] Building chapter JSON...")
    chapter_json = build_chapter_json(chapter_id, chapter_title, passages, words)
    json_path = f"data/chapter{chapter_id}.json"
    os.makedirs("data", exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(chapter_json, f, ensure_ascii=False, indent=2)
    print(f"         Written: {json_path}")

    # ---- Update chapters index ----
    print()
    print("[STEP 2] Updating chapters index...")
    action = update_chapters_index(chapter_id, chapter_title, len(words))
    print(f"         {action} chapter {chapter_id} in data/chapters-index.json")

    # ---- Generate audio ----
    if not skip_audio:
        print()
        print("[STEP 3] Generating audio (this takes ~30s for a small chapter)...")
        await generate_chapter_audio(input_path)
    else:
        print()
        print("[STEP 3] Skipped audio generation (--skip-audio flag)")

    # ---- Summary ----
    print()
    print("=" * 60)
    print(f"[OK] Chapter {chapter_id} published!")
    print()
    print("Files produced:")
    print(f"  - {json_path}")
    print(f"  - data/chapters-index.json (updated)")
    if not skip_audio:
        print(f"  - audio/chapter{chapter_id}/ (MP3s)")
    print()
    print("Next steps:")
    print(f"  1. Verify JSON: cat {json_path}")
    print(f"  2. Commit + push in Codespace")
    print(f"  3. Wait ~1 min for GitHub Pages to rebuild")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Publish a chapter: generate JSON + audio, update index."
    )
    parser.add_argument("--input", required=True, help="Path to chapterXX_final.xlsx")
    parser.add_argument(
        "--skip-audio",
        action="store_true",
        help="Skip audio generation (use when MP3s already exist and only JSON needs regenerating)",
    )
    args = parser.parse_args()

    input_path = args.input
    if not os.path.isabs(input_path):
        input_path = os.path.join("content-pipeline", input_path)

    asyncio.run(main_async(input_path, args.skip_audio))


if __name__ == "__main__":
    main()