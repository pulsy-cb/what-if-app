#!/usr/bin/env python3
"""Cut an episode's board stills into readable contact sheets.

The skill's storyboard.jpg is one tall strip: a 36-shot 9:16 episode gives a 2280x10410 image that a vision model
sees as thumbnails of about 100 px. This script groups out/<slug>/board/S*.png into sheets of 8 (9:16) or 9 (16:9)
shots, each cell captioned with the shot id, size and the first words of its note, so every sheet can be read at once.

Usage: python3 pipeline/board_sheets.py <project-root> <slug> [--per N]
Prints one sheet path per line (relative to the project root) and writes out/<slug>/sheets/sheet-NN.jpg.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (20, 17, 30)
INK = (240, 236, 228)
ACCENT = (244, 176, 96)
CAP_H = 58
GAP = 10


def natural_key(p: Path):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.stem)]


FONT_FILES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
]
HAS_UNICODE_FONT = False


def font(size: int):
    """A system font with accents when there is one; Pillow's built-in face has no accented letters."""
    global HAS_UNICODE_FONT
    for path in FONT_FILES:
        try:
            f = ImageFont.truetype(path, size)
            HAS_UNICODE_FONT = True
            return f
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1: fixed-size bitmap font
        return ImageFont.load_default()


def printable(text: str) -> str:
    if HAS_UNICODE_FONT:
        return text
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def ellipsize(draw: ImageDraw.ImageDraw, text: str, f, width: int) -> str:
    if draw.textlength(text, font=f) <= width:
        return text
    while text and draw.textlength(text + "...", font=f) > width:
        text = text[:-1]
    return text.rstrip() + "..."


def captions(project: Path, slug: str) -> dict:
    path = project / "src" / "episodes" / slug / "episode.json"
    try:
        ep = json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {}
    return {str(s.get("id")): s for s in ep.get("shots", []) if isinstance(s, dict)}


def build(project: Path, slug: str, per: int | None) -> list[Path]:
    board = project / "out" / slug / "board"
    stills = sorted(board.glob("S*.png"), key=natural_key)
    if not stills:
        return []
    first = Image.open(stills[0])
    portrait = first.height > first.width
    cols, rows = (4, 2) if portrait else (3, 3)
    per = per or cols * rows
    cell_w = 270 if portrait else 480
    cell_h = int(cell_w * first.height / first.width)
    caps = captions(project, slug)
    f_id, f_txt = font(22), font(16)

    out_dir = project / "out" / slug / "sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("sheet-*.jpg"):
        old.unlink()

    sheets = []
    for n, start in enumerate(range(0, len(stills), per), 1):
        group = stills[start : start + per]
        r = (len(group) + cols - 1) // cols
        w = cols * cell_w + (cols + 1) * GAP
        h = r * (cell_h + CAP_H) + (r + 1) * GAP
        sheet = Image.new("RGB", (w, h), BG)
        draw = ImageDraw.Draw(sheet)
        for i, still in enumerate(group):
            x = GAP + (i % cols) * (cell_w + GAP)
            y = GAP + (i // cols) * (cell_h + CAP_H + GAP)
            with Image.open(still) as im:
                sheet.paste(im.convert("RGB").resize((cell_w, cell_h), Image.LANCZOS), (x, y))
            info = caps.get(still.stem, {})
            size = str(info.get("size", "")).upper()
            draw.text((x, y + cell_h + 4), still.stem, font=f_id, fill=ACCENT)
            draw.text((x + 60, y + cell_h + 8), ellipsize(draw, printable(size), f_txt, cell_w - 60), font=f_txt, fill=INK)
            draw.text((x, y + cell_h + 32), ellipsize(draw, printable(str(info.get("note", ""))), f_txt, cell_w), font=f_txt, fill=(170, 164, 180))
        target = out_dir / f"sheet-{n:02d}.jpg"
        sheet.save(target, quality=88)
        sheets.append(target)
    return sheets


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("slug")
    ap.add_argument("--per", type=int)
    args = ap.parse_args()
    project = Path(args.project).resolve()
    sheets = build(project, args.slug, args.per)
    if not sheets:
        print(f"no stills in {project / 'out' / args.slug / 'board'}", file=sys.stderr)
        return 2
    for s in sheets:
        print(s.relative_to(project))
    return 0


if __name__ == "__main__":
    sys.exit(main())
