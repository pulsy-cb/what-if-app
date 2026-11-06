"""Build a shot list for an episode from its own script and the words it measured.

The scaffold ships one placeholder shot, and left alone an agent renders a single 16 s shot with a
character who has nothing to do with the story. The reference episodes cut every 1-2 s (17 segments
for 560 frames), so here we cut the measured words into k chunks, give each one a size, a set and a
note taken from the words it covers, and let plan.py resolve real cues.

    python3 pipeline/shotlist.py <slug> [--shots N] [--project DIR]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FPS = 30
# distinct rooms, so the storyboard reads as a film and not as one place
SETS = ["study", "kitchen", "classroom", "stairwell", "rooftop", "bedroom"]
SIZES = ["wide", "medium", "close", "medium", "wide", "medium", "close", "wide", "close", "medium", "wide", "close"]
# a title card and the closing fact are diagrams, not rooms
DIAGRAM = "schematic"
# what a chunk talks about decides the room: a maths story in a kitchen is what "rien a voir" means
KEYWORDS = {
    "classroom": ["prof", "classe", "eleve", "tableau", "ecole", "ecrivent", "cours", "copie", "note", "interro"],
    "kitchen": ["cuisine", "table", "tasse", "cafe", "manger", "couteau", "assiette", "four"],
    "bedroom": ["chambre", "lit", "dormir", "reve", "nuit", "oreiller", "reveil"],
    "rooftop": ["toit", "ciel", "soleil", "nuage", "ville", "horizon"],
    "stairwell": ["escalier", "marche", "monte", "descend", "etage", "rampe"],
    "study": ["bureau", "feuille", "fiche", "crayon", "cahier", "stylo", "papier", "dessin"],
    "schematic": ["face", "bord", "geometrie", "theoreme", "nombre", "equation", "surface", "courbe", "angle"],
}


def norm(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower().replace("\u2019", "'"))


def load(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def title_words(ep: dict) -> set[str]:
    title = ep.get("title") or []
    text = " ".join(title) if isinstance(title, list) else str(title)
    return {norm(w) for w in re.findall(r"[\w'-]+", text) if len(norm(w)) > 3}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--project", default=".")
    ap.add_argument("--shots", type=int, default=0, help="force the number of shots")
    args = ap.parse_args()

    root = Path(args.project).resolve()
    ep_path = root / "src" / "episodes" / args.slug / "episode.json"
    words = load(root / "src" / "episodes" / args.slug / "words.json")
    ep = load(ep_path)
    if not isinstance(ep, dict):
        print(f"no episode.json at {ep_path}", file=sys.stderr)
        return 2
    if not isinstance(words, list) or len(words) < 8:
        print("no words.json: run voice first (the shot list is cut on the measured words)", file=sys.stderr)
        return 3

    words = [w for w in words if isinstance(w, dict) and norm(str(w.get("w", "")))]
    if len(words) < 8:
        print("words.json has no usable words", file=sys.stderr)
        return 3
    total_frames = round(float(words[-1].get("e", 0)) * FPS) or (len(words) * 12)
    seconds = total_frames / FPS

    # the reference cuts every 1.5-2 s; keep 6 shots minimum so a 15 s episode is never one static shot
    k = args.shots or max(6, min(12, round(seconds / 1.9)))

    keys = title_words(ep)
    bounds: list[int] = [round(i * len(words) / k) for i in range(k)]
    bounds[0] = 0

    shots: list[dict] = []
    edit: list[dict] = []
    used: set[str] = set()
    previous_set = ""
    run = 0  # how many shots in a row share the same room
    for i in range(k):
        start = bounds[i]
        end = bounds[i + 1] if i + 1 < k else len(words)
        chunk = words[start:end]
        if not chunk:
            continue
        text = [str(w["w"]).strip() for w in chunk]
        span = round(float(chunk[-1].get("e", 0)) * FPS) - round(float(chunk[0].get("s", 0)) * FPS)
        label = " ".join(text[:9])

        # the chunk that carries the title is the title card: a diagram, not a room
        is_title = bool(keys) and len({norm(t) for t in text} & keys) >= 2
        if is_title:
            room = DIAGRAM
        else:
            hits = {room_name: sum(1 for t in text if norm(t) in words_of)
                    for room_name, words_of in KEYWORDS.items()}
            hits["schematic"] += 1 if any(norm(t) in KEYWORDS["schematic"] for t in text) else 0
            ranked = sorted(hits.items(), key=lambda kv: -kv[1])
            # no clue in the words -> stay where we are (continuity), but never three shots of the
            # same room in a row: a storyboard of eight identical rooms is what we are fixing here
            best = next((name for name, score in ranked if score > 0 and name != previous_set), "")
            if best:
                room = best
            elif previous_set and previous_set != DIAGRAM and run < 2:
                room = previous_set
            else:
                # third shot in the same room: cut to the diagram (the concept), never to a random
                # kitchen: an unrelated room is exactly what "rien a voir" meant
                room = DIAGRAM if previous_set != DIAGRAM else "study"
        run = run + 1 if room == previous_set else 1
        used.add(room)
        previous_set = room

        size = "title, wide" if is_title else SIZES[i % len(SIZES)]
        shots.append(
            {
                "id": f"S{i + 1}",
                "size": size,
                "set": room,
                "key": max(4, min(28, round(span / 11))),
                "note": label,
            }
        )

        # the cue: the first word of the chunk that is unique and strictly after the previous cut
        cue = ""
        counts: dict[str, int] = {}
        for w in words:
            counts[norm(str(w["w"]))] = counts.get(norm(str(w["w"])), 0) + 1
        for w in chunk:
            token = norm(str(w["w"]))
            if counts.get(token) == 1:
                cue = token
                break
        if not cue:
            cue = f"f:{round(float(chunk[0].get('s', 0)) * FPS)}"
        edit.append({"shot": shots[-1]["id"], "at": "f:0" if i == 0 else cue})

    ep["shots"] = shots
    ep["edit"] = edit
    ep_path.write_text(json.dumps(ep, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"{len(shots)} shot(s) for {seconds:.1f}s ({seconds / max(1, len(shots)):.1f}s per cut)")
    for s, e in zip(shots, edit):
        print(f"  {s['id']:<4} {e['at']:<16} {s['size']:<12} {s['set']:<10} {s['note']}")
    print("RESULT_JSON:" + json.dumps({"ok": True, "shots": len(shots), "seconds": round(seconds, 2)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
