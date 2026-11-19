#!/usr/bin/env python3
"""Cut an episode's board stills into readable contact sheets.

The skill's storyboard.jpg is one tall strip: a 36-shot 9:16 episode gives a 2280x10410 image that a vision model
sees as thumbnails of about 100 px. This script groups out/<slug>/board/S*.png into sheets of 8 (9:16) or 9 (16:9)
shots, each cell captioned with the shot id, size and the first words of its note, so every sheet can be read at once.

Usage: python3 pipeline/board_sheets.py <project-root> <slug> [--per N]
Prints one sheet path per line (relative to the project root) and writes out/<slug>/sheets/sheet-NN.jpg.
"""
import argparse
import hashlib
import json
import math
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


OPENING_FRAMES = (0, 30, 60)
OPENING_W = 360
OPENING_SOURCE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", ".svg"}


def file_sha256_hex32(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()[:32]
    except OSError:
        return None


def _canonicalize_json(value):
    if isinstance(value, list):
        return [_canonicalize_json(v) for v in value]
    if isinstance(value, dict):
        return {k: _canonicalize_json(value[k]) for k in sorted(value.keys())}
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


def timeline_sha256_hex32(p: Path) -> str | None:
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(parsed, dict):
            parsed = {k: v for k, v in parsed.items() if k != "audio"}
        canonical = json.dumps(_canonicalize_json(parsed), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]
    except (OSError, ValueError):
        return file_sha256_hex32(p)


def _collect_opening_source_files(root: Path, current: Path, skip_rel_posix: str, out: list[str]) -> None:
    try:
        entries = list(current.iterdir())
    except OSError:
        return
    for ent in entries:
        if ent.name.startswith(".") or ent.name == "node_modules":
            continue
        if ent.is_dir():
            _collect_opening_source_files(root, ent, skip_rel_posix, out)
        elif ent.is_file():
            if ent.suffix.lower() not in OPENING_SOURCE_EXTS:
                continue
            rel_posix = ent.relative_to(root).as_posix()
            if rel_posix == skip_rel_posix:
                continue
            out.append(rel_posix)


def compute_opening_input_sigs(project: Path, slug: str) -> tuple[str | None, str | None]:
    """Canonical SHA-256 signatures of timeline.json (excluding audio) and episode/engine sources (matching render_run.mjs & reviewer.ts)."""
    tl_rel = f"src/episodes/{slug}/timeline.json"
    tl_path = project / "src" / "episodes" / slug / "timeline.json"
    timeline_sig = timeline_sha256_hex32(tl_path) if tl_path.is_file() else None

    ep_dir = project / "src" / "episodes" / slug
    if not ep_dir.is_dir():
        return timeline_sig, None
    ep_files: list[str] = []
    _collect_opening_source_files(project, ep_dir, tl_rel, ep_files)
    if not ep_files:
        return timeline_sig, None

    all_files = list(ep_files)
    for extra_rel in ("src/Root.tsx", "src/studio.config.ts"):
        extra_path = project / extra_rel
        if extra_path.is_file():
            all_files.append(extra_rel)
    engine_dir = project / "src" / "engine"
    if engine_dir.is_dir():
        _collect_opening_source_files(project, engine_dir, tl_rel, all_files)

    h = hashlib.sha256()
    for rel_posix in sorted(set(all_files)):
        f_sha = file_sha256_hex32(project / rel_posix)
        if not f_sha:
            return timeline_sig, None
        h.update(f"{rel_posix}\0{f_sha}\n".encode("utf-8"))
    return timeline_sig, h.hexdigest()[:32]


def _covering_shot_id(tl_data: dict, frame: int) -> str:
    for seg in tl_data.get("segments") or []:
        if isinstance(seg, dict) and int(seg.get("a", 0)) <= frame < int(seg.get("b", 0)):
            return str(seg.get("shot") or "")
    tl_shots = [s for s in tl_data.get("shots", []) if isinstance(s, dict)]
    shot = next(
        (s for s in tl_shots if int(s.get("first", 0)) <= frame < int(s.get("first", 0)) + int(s.get("len", 0))),
        tl_shots[0] if tl_shots and frame == 0 else None,
    )
    return str((shot or {}).get("id") or ("S1" if frame == 0 else ""))


def opening_stills(
    project: Path,
    slug: str,
    timeline_sig: str | None = None,
    sources_sig: str | None = None,
) -> tuple[list[tuple[int, Path | None, str]], bool]:
    """Inspect opening captures at frames 0, 30 and 60 with source+timeline+file signature verification.

    - Status "exact" is granted ONLY when out/<slug>/opening/manifest.json matches current timelineSig + sourcesSig
      AND each frame PNG's SHA-256 matches the manifest (never relying on 2s mtime tolerances).
    - If manifest.json exists and signatures differ (sources or timeline modified without re-rendering, regardless of mtime),
      frames are marked "stale" and omitted.
    - If manifest.json is absent, captures are NEVER validated as "exact": they are marked "stale" if unchanged across a
      source/timeline change (or older than board stills), otherwise "unverified" (non-proven).
    """
    out = project / "out" / slug
    exact_dir = out / "opening"
    if timeline_sig is None and sources_sig is None:
        timeline_sig, sources_sig = compute_opening_input_sigs(project, slug)

    try:
        tl = json.loads((project / "src" / "episodes" / slug / "timeline.json").read_text(encoding="utf8"))
        if not isinstance(tl, dict):
            tl = {}
    except (OSError, ValueError):
        tl = {}
    total = int(tl.get("total") or 0)
    targets = [f for f in OPENING_FRAMES if total <= 0 or f < total] or [0]

    manifest_path = exact_dir / "manifest.json"
    manifest: dict | None = None
    has_manifest = manifest_path.is_file()
    if has_manifest:
        try:
            parsed = json.loads(manifest_path.read_text(encoding="utf8"))
            if isinstance(parsed, dict):
                manifest = parsed
        except (OSError, ValueError):
            manifest = None

    picked: list[tuple[int, Path | None, str]] = []
    if has_manifest:
        if (
            manifest is None
            or not timeline_sig
            or not sources_sig
            or manifest.get("timelineSig") != timeline_sig
            or manifest.get("sourcesSig") != sources_sig
        ):
            for f in targets:
                picked.append((f, None, "stale"))
            return picked, True

        frames_map = manifest.get("frames") if isinstance(manifest.get("frames"), dict) else {}
        for f in targets:
            entry = frames_map.get(str(f)) if isinstance(frames_map, dict) else None
            if not isinstance(entry, dict) or not entry.get("file") or not entry.get("sha256"):
                picked.append((f, None, "unknown"))
                continue
            cand = exact_dir / Path(str(entry["file"])).name
            if not cand.is_file():
                picked.append((f, None, "unknown"))
                continue
            if file_sha256_hex32(cand) != str(entry["sha256"]):
                picked.append((f, None, "stale"))
                continue
            picked.append((f, cand, "exact"))
        return picked, True

    prev_meta_path = out / "sheets" / "opening.json"
    prev_meta: dict = {}
    if prev_meta_path.is_file():
        try:
            pm = json.loads(prev_meta_path.read_text(encoding="utf8"))
            if isinstance(pm, dict):
                prev_meta = pm
        except (OSError, ValueError):
            prev_meta = {}
    prev_tl_sig = prev_meta.get("timelineSig")
    prev_src_sig = prev_meta.get("sourcesSig")
    prev_hashes = prev_meta.get("frameHashes") if isinstance(prev_meta.get("frameHashes"), dict) else {}
    inputs_changed_since_prev = bool(
        (prev_tl_sig or prev_src_sig) and (prev_tl_sig != timeline_sig or prev_src_sig != sources_sig)
    )

    for f in targets:
        found: Path | None = None
        for name in (f"f{f:04d}.png", f"f{f}.png"):
            cand = exact_dir / name
            if cand.is_file():
                found = cand
                break
        if found is None:
            picked.append((f, None, "unknown"))
            continue
        cur_hash = file_sha256_hex32(found)
        if not timeline_sig or not sources_sig:
            picked.append((f, None, "stale"))
            continue
        if inputs_changed_since_prev and cur_hash and prev_hashes.get(str(f)) == cur_hash:
            picked.append((f, None, "stale"))
            continue
        sid = _covering_shot_id(tl, f)
        still = out / "board" / f"{sid}.png"
        if sid and still.is_file():
            try:
                if still.stat().st_mtime > found.stat().st_mtime:
                    picked.append((f, None, "stale"))
                    continue
            except OSError:
                pass
        picked.append((f, found, "unverified"))
    return picked, False


def mean_luma(path: Path) -> float:
    with Image.open(path) as im:
        g = im.convert("L").resize((64, 64))
        px = list(g.get_flattened_data() if hasattr(g, "get_flattened_data") else g.getdata())
    return round(sum(px) / max(1, len(px)) / 255 * 100, 1)


def build_opening(project: Path, slug: str) -> Path | None:
    """Opening sheet: frames 0, 30, 60 side by side at phone width (360 px).

    Never substitutes keyframe thumbnails: missing/stale frames are marked INCONNU/OBSOLETE, unverified frames without a
    render manifest are marked NON VERIFIE (verified=False), and opening.json records timelineSig, sourcesSig, frameHashes,
    and sheetSha256 so downstream readers detect any post-build edit or deleted image immediately.
    """
    timeline_sig, sources_sig = compute_opening_input_sigs(project, slug)
    picked, has_manifest = opening_stills(project, slug, timeline_sig, sources_sig)
    sheets_dir = project / "out" / slug / "sheets"
    sheets_dir.mkdir(parents=True, exist_ok=True)
    target = sheets_dir / "opening.jpg"
    meta_file = sheets_dir / "opening.json"

    renderable_entries = [(f, p, st) for f, p, st in picked if p is not None and st in ("exact", "unverified")]
    exact_frames = [f for f, p, st in picked if p is not None and st == "exact"]
    unverified_frames = [f for f, p, st in picked if p is not None and st == "unverified"]
    stale_frames = [f for f, _p, st in picked if st == "stale"]
    missing_frames = [f for f, p, st in picked if p is None or st != "exact"]
    verified = bool(has_manifest and exact_frames and not missing_frames and timeline_sig and sources_sig)

    frames_meta = []
    frame_hashes: dict[str, str] = {}
    for f, p, st in picked:
        entry: dict = {"frame": f, "status": st}
        if p is not None and st in ("exact", "unverified"):
            f_sha = file_sha256_hex32(p)
            if f_sha:
                frame_hashes[str(f)] = f_sha
                entry["sha256"] = f_sha
            if f == 0:
                entry["luma"] = mean_luma(p)
        frames_meta.append(entry)

    sheet_sha: str | None = None
    if not renderable_entries:
        if target.exists():
            target.unlink()
    else:
        first_valid = renderable_entries[0][1]
        assert first_valid is not None
        with Image.open(first_valid) as im0:
            cell_h = int(OPENING_W * im0.height / im0.width)
        f_id = font(20)
        f_unk = font(22)
        w = len(picked) * OPENING_W + (len(picked) + 1) * GAP
        h = cell_h + CAP_H + 2 * GAP
        sheet = Image.new("RGB", (w, h), BG)
        draw = ImageDraw.Draw(sheet)
        for i, (frame, still, src) in enumerate(picked):
            x = GAP + i * (OPENING_W + GAP)
            if still is not None and src in ("exact", "unverified"):
                with Image.open(still) as im:
                    sheet.paste(im.convert("RGB").resize((OPENING_W, cell_h), Image.LANCZOS), (x, GAP))
                tag = " (NON VERIFIE)" if src == "unverified" else ""
                cap = f"f:{frame}{tag}" + (f"  luma {mean_luma(still)}%" if frame == 0 else "")
                draw.text((x, GAP + cell_h + 6), printable(cap), font=f_id, fill=ACCENT if src == "exact" else (210, 180, 140))
            else:
                label = "OBSOLETE" if src == "stale" else "INCONNU"
                draw.rectangle([x, GAP, x + OPENING_W - 1, GAP + cell_h - 1], fill=(32, 28, 46), outline=(120, 110, 145), width=2)
                draw.text((x + 24, GAP + cell_h // 2 - 26), printable(f"f:{frame} {label}"), font=f_unk, fill=(210, 196, 224))
                draw.text((x + 24, GAP + cell_h // 2 + 8), printable("(capture exacte absente)"), font=f_id, fill=(156, 148, 172))
                draw.text((x, GAP + cell_h + 6), printable(f"f:{frame} ({label})"), font=f_id, fill=(170, 164, 180))
        sheet.save(target, quality=88)
        sheet_sha = file_sha256_hex32(target)

    meta_file.write_text(
        json.dumps(
            {
                "version": 1,
                "provenance": "manifest" if has_manifest else "unverified",
                "timelineSig": timeline_sig,
                "sourcesSig": sources_sig,
                "sheetSha256": sheet_sha,
                "frameHashes": frame_hashes,
                "frames": frames_meta,
                "exactFrames": exact_frames,
                "unverifiedFrames": unverified_frames,
                "staleFrames": stale_frames,
                "missingFrames": missing_frames,
                "verified": verified,
                "complete": verified,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf8",
    )
    return target if sheet_sha else None


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
    opening = build_opening(project, args.slug)
    if opening:
        print(opening.relative_to(project))
    return 0


if __name__ == "__main__":
    sys.exit(main())
