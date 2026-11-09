#!/usr/bin/env python3
"""Measure the visual variety of an episode from its sources (no render needed).

Usage: python3 scripts/measure-episode.py <project-dir> <slug> [--db data/app.db] [--json]

It counts patterns in shots.tsx and reads episode.json / timeline.json: a `<Hero` generated inside a loop counts
once, so read the numbers as a floor, not an exact census. Same script, same inputs -> same numbers.
"""
import argparse
import json
import re
import sqlite3
import statistics
import sys
from pathlib import Path

SHOT_RE = re.compile(r"(?=export\s+(?:const|function)\s+S\d+\b)")
EXPORT_RE = re.compile(r"export\s+(?:const|function)\s+(S\d+)\b")
CAMT_RE = re.compile(r"camT\(\s*[^,()]+,\s*[^,()]+,\s*(\d+(?:\.\d+)?)\s*\)")
CAMPUSH_RE = re.compile(r"camPush\(\s*t\s*,\s*len\s*,\s*[^,()]+,\s*[^,()]+,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)")
YAW_RE = re.compile(r"\byaw\s*:\s*(-?\d*\.?\d+)")
BLUR_RE = re.compile(r"<Foreground\b|url\(#blur(?:3|6|10|16)\)|\bblur16\b")
ORIENTED_HELPERS = ("tableSit(", "walkPose(", "carSit(", "bedSit(")


def shot_bodies(src: str) -> dict:
    out = {}
    for chunk in SHOT_RE.split(src):
        m = EXPORT_RE.match(chunk)
        if m:
            out[m.group(1)] = chunk
    return out


def measure(project: Path, slug: str) -> dict:
    ep_dir = project / "src" / "episodes" / slug
    src = (ep_dir / "shots.tsx").read_text(encoding="utf8")
    bodies = shot_bodies(src)
    ep = json.loads((ep_dir / "episode.json").read_text(encoding="utf8"))
    tl = json.loads((ep_dir / "timeline.json").read_text(encoding="utf8")) if (ep_dir / "timeline.json").exists() else {}

    heroes = {"0": 0, "1": 0, "2": 0, "3+": 0}
    oriented = blur = 0
    zooms = []
    yaws = []
    for body in bodies.values():
        n = len(re.findall(r"<Hero\b", body))
        heroes["3+" if n >= 3 else str(n)] += 1
        ys = [float(y) for y in YAW_RE.findall(body)]
        yaws += ys
        if any(abs(y) >= 0.3 for y in ys) or any(h in body for h in ORIENTED_HELPERS):
            oriented += 1
        if BLUR_RE.search(body):
            blur += 1
        zooms += [float(z) for z in CAMT_RE.findall(body)]
        for a, b in CAMPUSH_RE.findall(body):
            zooms += [float(a), float(b)]

    sets = {str(s.get("set", "")).strip().lower() for s in ep.get("shots", [])}
    sizes = {}
    for s in ep.get("shots", []):
        key = str(s.get("size", "")).split(",")[0].strip() or "?"
        sizes[key] = sizes.get(key, 0) + 1
    lens = [s.get("len", 0) for s in tl.get("shots", [])]
    return {
        "slug": slug,
        "shots": len(bodies),
        "heroes_per_shot": heroes,
        "shots_oriented_not_frontal": oriented,
        "yaw_values_written": len(yaws),
        "yaw_abs_ge_0_6": sum(abs(y) >= 0.6 for y in yaws),
        "shots_with_foreground_blur": blur,
        "distinct_sets_in_episode_json": len(sets),
        "sizes": sizes,
        "zoom_min": min(zooms) if zooms else None,
        "zoom_max": max(zooms) if zooms else None,
        "median_shot_seconds": round(statistics.median(lens) / 30, 2) if lens else None,
    }


def tool_errors(db_path: Path, project_id: str) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    rows = con.execute(
        "select m.content from messages m join threads t on t.id = m.thread_id where t.project_id = ? and m.role = 'tool'",
        (project_id,),
    ).fetchall()
    models = []
    try:
        models = [r[0] for r in con.execute("select distinct model from project_runs where project_id = ? and model is not null", (project_id,))]
    except sqlite3.OperationalError:
        pass
    errors = sum(1 for (c,) in rows if c.startswith("ERROR"))
    return {"tool_results": len(rows), "tool_errors": errors, "models_recorded": models}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("slug")
    ap.add_argument("--db")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    project = Path(args.project)
    try:
        result = measure(project, args.slug)
    except FileNotFoundError as e:
        print(f"missing file: {e.filename}", file=sys.stderr)
        return 2
    if args.db:
        result.update(tool_errors(Path(args.db), project.name))
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
    else:
        for k, v in result.items():
            print(f"{k:34} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
