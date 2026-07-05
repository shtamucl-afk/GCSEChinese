"""
build_raw_template.py
---------------------
Creates the blank Raw Input template that Fiona downloads to author each chapter.

Run ONCE (or whenever you want to regenerate a fresh blank template).
Not part of the regular chapter authoring workflow.

Output: content-pipeline/templates/Raw_Input_template.xlsx
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.comments import Comment
import os


def create_raw_template():
    """
    Create the blank raw input template with the agreed structure:
    - Meta sheet: ChapterID + ChapterTitle
    - Content sheet: 3 columns (Passage | Vocabulary | English)
      All 3 columns are independent - Python concatenates then splits by '|'.
    """
    wb = Workbook()

    # ------------------------------------------------------------------
    # Sheet 1: Meta
    # ------------------------------------------------------------------
    meta = wb.active
    meta.title = "Meta"
    meta["A1"] = "Field"
    meta["B1"] = "Value"
    meta["A2"] = "ChapterID"
    meta["A3"] = "ChapterTitle"

    # Style header row
    for cell in [meta["A1"], meta["B1"]]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4A5568")
        cell.alignment = Alignment(horizontal="center")

    # Add hints as cell comments
    meta["A2"].comment = Comment(
        "Two-digit chapter number, e.g., 01, 02, ..., 20. Determines JSON filename and audio folder.",
        "System"
    )
    meta["A3"].comment = Comment(
        "Chapter title in Chinese or English. Shown in the app dashboard.",
        "System"
    )

    meta.column_dimensions["A"].width = 20
    meta.column_dimensions["B"].width = 60

    # ------------------------------------------------------------------
    # Sheet 2: Content
    # ------------------------------------------------------------------
    content = wb.create_sheet("Content")

    headers = ["Passage", "Vocabulary", "English"]
    for col_idx, header in enumerate(headers, start=1):
        cell = content.cell(row=1, column=col_idx, value=header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4A5568")
        cell.alignment = Alignment(horizontal="center")

    # Column widths
    content.column_dimensions["A"].width = 80
    content.column_dimensions["B"].width = 40
    content.column_dimensions["C"].width = 60

    # Row heights for readability
    content.row_dimensions[1].height = 25

    # Hints via comments
    content["A1"].comment = Comment(
        "PASSAGE column. Paste your Traditional Chinese passage(s) here. "
        "You can spread across multiple rows or all in one cell - Python joins them. "
        "Punctuation matters: sentences will be split by 。！？",
        "System"
    )
    content["B1"].comment = Comment(
        "VOCABULARY column. Traditional Chinese words separated by | (pipe). "
        "You can spread across multiple rows - Python concatenates. "
        "Example: 創建|相輔相成|思維",
        "System"
    )
    content["C1"].comment = Comment(
        "ENGLISH column. English meanings separated by | (pipe), in the SAME ORDER as Vocabulary. "
        "Total count in B and C must match after concatenation. "
        "Example: Establish|Complement each other|Mindset",
        "System"
    )

    # ------------------------------------------------------------------
    # Sheet 3: Instructions (for the human filling this in)
    # ------------------------------------------------------------------
    instr = wb.create_sheet("Instructions")

    instructions = [
        ("DFSNMGCSEChinese - Raw Input Template", True),
        ("", False),
        ("HOW TO FILL IN THIS TEMPLATE", True),
        ("", False),
        ("1. Save this file as: chapterXX_raw.xlsx (replace XX with chapter number)", False),
        ("   Example: chapter01_raw.xlsx", False),
        ("", False),
        ("2. Meta sheet: Fill in ChapterID (e.g., 01) and ChapterTitle", False),
        ("", False),
        ("3. Content sheet - three independent columns:", False),
        ("   Column A (Passage): Paste your Chinese passage(s). Multiple rows OK.", False),
        ("   Column B (Vocabulary): Chinese words separated by | (pipe). Multiple rows OK.", False),
        ("   Column C (English): English meanings separated by | (pipe), same order as B.", False),
        ("", False),
        ("4. IMPORTANT: The total count of items in B and C must match.", False),
        ("   Python will error clearly if counts don't align.", False),
        ("", False),
        ("5. Upload this file to your Codespace at:", False),
        ("   content-pipeline/inputs/chapterXX_raw.xlsx", False),
        ("", False),
        ("6. Run: python content-pipeline/generate_review.py --input inputs/chapterXX_raw.xlsx", False),
        ("", False),
        ("7. Download the generated chapterXX_review.xlsx, check the auto-generated pinyin", False),
        ("   and context sentences, correct any errors, save as chapterXX_final.xlsx", False),
        ("", False),
        ("8. Upload chapterXX_final.xlsx back to Codespace, then run publish script.", False),
        ("", False),
        ("DELIMITER RULE", True),
        ("Use | (pipe character) to separate items in Vocabulary and English columns.", False),
        ("Do NOT use commas - some English meanings naturally contain commas.", False),
        ("Example: park, garden|to like, prefer  <- would break if using comma delimiter", False),
        ("", False),
        ("MULTI-PRONUNCIATION CHARACTERS (多音字)", True),
        ("Some Traditional Chinese characters have multiple pronunciations that pypinyin", False),
        ("may guess incorrectly. Common examples:", False),
        ("  長: cháng (long) vs zhǎng (elder/grow) - e.g., 長方形 should be cháng fāng xíng", False),
        ("  行: xíng (walk) vs háng (row/profession) - e.g., 銀行 = yín háng", False),
        ("  樂: lè (happy) vs yuè (music) - e.g., 音樂 = yīn yuè", False),
        ("Fix these manually during the review step.", False),
    ]

    for row_idx, (text, is_bold) in enumerate(instructions, start=1):
        cell = instr.cell(row=row_idx, column=1, value=text)
        if is_bold:
            cell.font = Font(bold=True, size=12, color="2B6CB0")

    instr.column_dimensions["A"].width = 100

    return wb


def main():
    os.makedirs("content-pipeline/templates", exist_ok=True)
    wb = create_raw_template()
    output_path = "content-pipeline/templates/Raw_Input_template.xlsx"
    wb.save(output_path)
    print(f"[OK] Blank raw template created: {output_path}")
    print("\nNext steps:")
    print("  1. Download this file from Codespace to your PC.")
    print("  2. Fill it in with your chapter content.")
    print("  3. Save as chapterXX_raw.xlsx and upload to content-pipeline/inputs/")
    print("  4. Run generate_review.py to produce the review file.")


if __name__ == "__main__":
    main()