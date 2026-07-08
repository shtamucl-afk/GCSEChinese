"""
generate_common.py
------------------
Shared helpers used by generate_review.py, generate_audio.py,
and generate_chapter.py.

Central location for:
  - parse_meta(): read BookID + ChapterID + ChapterTitle from Meta sheet
  - validate_book_and_paths(): 5-layer guard against mismatched inputs
  - clean_text(): standard whitespace stripping
  - BOOKS_INDEX_PATH constant
  - Language + voice + rate constants (M8.3c-1: bilingual)

Introduced in M8.3c-1 for multi-book + bilingual audio support.
"""

import json
import os
import re
import sys


BOOKS_INDEX_PATH = "data/books-index.json"


# ------------------------------------------------------------------
# Bilingual TTS configuration (M8.3c-1)
# ------------------------------------------------------------------
# Each language: (voice_id, rate, filename_suffix)
LANGUAGES = {
    "mandarin": {
        "voice": "zh-CN-XiaoxiaoNeural",
        "rate": "-10%",
        "suffix": "m",
    },
    "cantonese": {
        "voice": "zh-HK-WanLungNeural",
        "rate": "-10%",
        "suffix": "c",
    },
}


# ------------------------------------------------------------------
# Text helper
# ------------------------------------------------------------------
def clean_text(text):
    """Strip whitespace AND non-breaking spaces from a string."""
    if text is None:
        return ""
    return str(text).replace("\xa0", "").strip()


# ------------------------------------------------------------------
# Meta parsing
# ------------------------------------------------------------------
def parse_meta(wb):
    """Extract BookID, ChapterID, ChapterTitle from the Meta sheet.

    Returns (book_id, chapter_id, chapter_title) as strings.
    Errors and exits if Meta sheet is missing or BookID/ChapterID are absent.

    With text-formatted Meta!B2 and B3, IDs arrive as strings like
    "00", "01", ... The int/float safety net remains in case someone
    resaves the raw file and accidentally loses the '@' format.
    """
    if "Meta" not in wb.sheetnames:
        print("[ERROR] Workbook is missing the Meta sheet.")
        sys.exit(1)

    meta = wb["Meta"]
    book_id = None
    chapter_id = None
    chapter_title = None

    for row in meta.iter_rows(min_row=2, values_only=True):
        field = row[0]
        value = row[1] if len(row) > 1 else None
        if field == "BookID":
            if isinstance(value, (int, float)):
                book_id = f"{int(value):02d}"
            elif value is not None:
                book_id = clean_text(value).zfill(2)
        elif field == "ChapterID":
            if isinstance(value, (int, float)):
                chapter_id = f"{int(value):02d}"
            elif value is not None:
                chapter_id = clean_text(value).zfill(2)
        elif field == "ChapterTitle":
            chapter_title = clean_text(value)

    if not book_id:
        print("[ERROR] BookID is missing in Meta sheet.")
        print("        Add a BookID row to the Meta sheet with the two-digit book number.")
        sys.exit(1)

    if not chapter_id:
        print("[ERROR] ChapterID is missing in Meta sheet.")
        sys.exit(1)

    return book_id, chapter_id, chapter_title


# ------------------------------------------------------------------
# 5-layer validation
# ------------------------------------------------------------------
def validate_book_and_paths(book_id, chapter_id, input_path):
    """Run all path/registration guards. Errors and exits on any mismatch.

    Guard 1: books-index.json exists.
    Guard 2: BookID exists in books-index.json.
    Guard 3: Filename matches b{book}_ch{chapter}_(raw|final).xlsx pattern.
    Guard 4: Filename's book/chapter numbers match Meta.
    Guard 5: File is located in content-pipeline/inputs/book{book}/ folder.
    """

    # Guard 1: books-index exists
    if not os.path.exists(BOOKS_INDEX_PATH):
        print(f"[ERROR] {BOOKS_INDEX_PATH} not found.")
        print("        Create the books-index.json file first with at least one book entry.")
        sys.exit(1)

    # Guard 2: BookID registered
    with open(BOOKS_INDEX_PATH, "r", encoding="utf-8") as f:
        books_data = json.load(f)
    book_ids = [b["id"] for b in books_data.get("books", [])]
    if book_id not in book_ids:
        print(f"[ERROR] Book '{book_id}' not found in {BOOKS_INDEX_PATH}.")
        print(f"        Registered books: {book_ids}")
        print(f"        Create the book in books-index.json before running the pipeline.")
        sys.exit(1)

    # Guard 3 + 4: Filename format and content match
    basename = os.path.basename(input_path)
    m = re.match(r"^b(\d\d)_ch(\d\d)_(raw|final)\.xlsx$", basename, re.IGNORECASE)
    if not m:
        print(f"[ERROR] Filename '{basename}' does not match expected pattern.")
        print(f"        Expected: b{book_id}_ch{chapter_id}_raw.xlsx or b{book_id}_ch{chapter_id}_final.xlsx")
        sys.exit(1)

    fname_book, fname_chapter = m.group(1), m.group(2)
    if fname_book != book_id:
        print(f"[ERROR] Filename BookID '{fname_book}' does not match Meta BookID '{book_id}'.")
        sys.exit(1)
    if fname_chapter != chapter_id:
        print(f"[ERROR] Filename ChapterID '{fname_chapter}' does not match Meta ChapterID '{chapter_id}'.")
        sys.exit(1)

    # Guard 5: File location
    expected_folder = os.path.join("content-pipeline", "inputs", f"book{book_id}")
    actual_folder = os.path.dirname(os.path.abspath(input_path))
    expected_abs = os.path.abspath(expected_folder)
    if actual_folder != expected_abs:
        print(f"[ERROR] File is not in the expected folder.")
        print(f"        Expected folder: {expected_folder}/")
        print(f"        Actual folder:   {os.path.relpath(actual_folder)}/")
        sys.exit(1)