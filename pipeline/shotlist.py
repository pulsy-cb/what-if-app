"""Build a rhythmic, clause-aligned shot list and default sound/fx design from the measured words.

The reference episodes cut every 1.2–1.8 s (>= 27 cuts/min, 10–15 shots for a 16–22 s episode),
never in the middle of a noun phrase ("Les | autres", "bout | à bout"), and always include:
- rooms populated with characters (`study`, `kitchen`, `classroom`, `stairwell`, `rooftop`, `bedroom`),
- a `title, wide` shot on the premise beat,
- `schematic` diagram shots on the science/turn beat,
- `fx` flashes/shakes and a `sound` score seeded from the studio's cached `library/sfx/` clips.

    python3 pipeline/shotlist.py <slug> [--shots N] [--project DIR]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

FPS = 30
DIAGRAM = "schematic"
SIZES = [
    "wide",
    "medium",
    "close",
    "insert",
    "medium, low angle",
    "close",
    "wide",
    "medium",
    "close",
    "medium, high angle",
    "wide",
    "close",
    "medium",
    "wide",
]

KEYWORDS = {
    "classroom": [
        "prof", "professeur", "classe", "eleve", "eleves", "tableau", "ecole", "college", "lycee",
        "cours", "interro", "examen", "scolaire", "maitre", " Craie",
    ],
    "kitchen": [
        "cuisine", "cuisiner", "tasse", "cafe", "manger", "couteau", "assiette", "four", "frigo",
        "cookie", "biscuit", "pizza", "repas", "petit-dejeuner", "diner", "recette",
    ],
    "vehicle": [
        "voiture", "auto", "volant", "route", "conduire", "conduit", "conducteur", "passager",
        "siege", "bus", "train", "metro", "trajet", "embouteillage", "phare", "autoroute", "frein",
        "vitesse", "camion", "taxi", "habitacle", "pare-brise", "ceinture",
    ],
    "outdoor": [
        "rue", "trottoir", "parc", "arbre", "foret", "jardin", "marche", "marcher", "dehors",
        "plage", "montagne", "chemin", "route", "nature", "herbe", "banc", "passant", "ville",
    ],
    "bedroom": [
        "chambre", "lit", "dormir", "dors", "reve", "nuit", "oreiller", "reveil", "matin",
        "casque", "micro", "muet", "mute", "jeu", "jouer", "gamer", "vocal", "console", "manette",
        "stream", "discord", "appel",
    ],
    "rooftop": ["toit", "ciel", "soleil", "nuage", "horizon", "immeuble", "monde", "terre", "etoile", "lune"],
    "stairwell": ["escalier", "marche", "monte", "descend", "etage", "rampe", "couloir", "ascenseur"],
    "study": [
        "bureau", "feuille", "fiche", "crayon", "cahier", "stylo", "papier", "dessin", "bande",
        "bandes", "colle", "decoupe", "ordinateur", "ecran", "clavier", "dossier", "travail",
    ],
    "schematic": [
        "geometrie", "theoreme", "nombre", "equation", "surface", "courbe", "angle",
        "orientable", "energie", "joules", "physique", "formule", "calcul", "pourcent", "statistique",
    ],
}

# Words after which a cut is forbidden (determiners, prepositions, clitics that bind to the next word)
NO_CUT_AFTER = {
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "au", "aux",
    "ce", "cet", "cette", "ces", "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses", "nos", "vos", "leurs",
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "se", "s", "ne", "n", "y", "en",
    "a", "dans", "par", "pour", "en", "vers", "avec", "de", "sans", "sous", "sur", "chez", "entre",
    "et", "ou", "mais", "donc", "or", "ni", "car", "que", "qu", "qui", "dont", "ou", "si", "comme",
    "plus", "moins", "tres", "trop", "tout", "toute", "tous", "toutes", "meme", "autre", "autres",
    "demi", "semi", "non", "pas", "peu", "bien",
}

# Pre-cached clips in studio/library/sfx/ (exact prompt + duration so wi.py clip_path resolves offline)
LIBRARY_CLIPS: dict[str, list] = {
    "music": [
        "playful quirky cartoon background music, pizzicato strings, glockenspiel and soft bass, light and curious, 110 bpm, no vocals",
        17.0,
    ],
    "room_tone": ["quiet indoor room tone in the evening, faint distant city hum, no voices", 12.5],
    "class_murmur": ["a quiet classroom murmur, kids whispering, chairs shuffling", 2.0],
    "roof_wind": ["a gentle evening breeze on a city rooftop, distant traffic", 7.0],
    "pop": ["a cartoon speech bubble pop, short and bright", 0.5],
    "sparkle": ["a short bright magical sparkle twinkle, cartoon", 0.8],
    "paper_land": ["a thick stack of paper sheets dropped flat on a wooden desk, a soft slap and rustle", 0.7],
    "select_draw": [
        "a quick digital selection sound, a soft rising electronic shimmer as a box is drawn on screen, short",
        0.6,
    ],
    "copy_click": ["a crisp satisfying computer copy click with a tiny soft digital chime, short", 0.5],
    "paste_pop": ["a bright magical pop as an object appears out of thin air, a soft shimmering whoosh into a pop", 0.7],
    "title_boom": ["a cinematic whoosh rising into a deep boom impact", 1.6],
    "counter_tick": ["a fast mechanical counter ticking up rapidly, digits rolling over, getting faster", 1.6],
    "power_hum": ["a deep electrical power grid hum swelling louder, transformers buzzing, rising", 3.0],
    "drone_hit": ["a dark ominous low drone hit, deep cinematic horror sting", 2.6],
    "power_down": ["a whole city losing power, a deep electrical power-down whine dropping in pitch into silence", 2.5],
    "switch_off": ["a heavy electrical breaker switching off with a dull clunk", 0.5],
    "bulb_pop": ["a small light bulb popping out, a tiny glass tink and fizz", 0.5],
    "step": ["a single sneaker footstep on a wooden stair, close", 0.5],
    "ding": ["a correct answer ding, bright bell chime", 0.8],
    "shades": ["cool sunglasses sliding on with a swoosh and a bright metallic glint", 0.9],
}


def norm(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower().replace("\u2019", "'"))


def bare_ascii(w: str) -> str:
    s = unicodedata.normalize("NFKD", norm(w))
    return "".join(c for c in s if not unicodedata.combining(c)).strip("'")


def load(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def title_words(ep: dict) -> set[str]:
    title = ep.get("title") or []
    text = " ".join(title) if isinstance(title, list) else str(title)
    return {bare_ascii(w) for w in re.findall(r"[\w'-]+", text) if len(bare_ascii(w)) > 3}


def beat_starts_in_words(ep: dict, words: list[dict]) -> tuple[dict[int, str], dict[int, str]]:
    """Map word indices where each script beat starts -> beat label, and every word index -> beat set (if specified)."""
    out: dict[int, str] = {}
    beat_sets: dict[int, str] = {}
    starts: list[tuple[int, str, str]] = []
    cursor = 0
    for b in ep.get("script") or []:
        if not isinstance(b, dict):
            continue
        btext = str(b.get("text") or "").strip()
        blabel = str(b.get("beat") or "").strip()
        bset = str(b.get("set") or "").strip().lower()
        bwords = [bare_ascii(x) for x in re.findall(r"[\w'\u2019-]+", btext) if bare_ascii(x)]
        if not bwords:
            continue
        first = bwords[0]
        for idx in range(cursor, min(len(words), cursor + 18)):
            if bare_ascii(str(words[idx].get("w", ""))) == first:
                out[idx] = blabel
                starts.append((idx, blabel, bset))
                cursor = idx + max(1, len(bwords) - 2)
                break
    for s_i, (w_idx, _lbl, bset) in enumerate(starts):
        next_idx = starts[s_i + 1][0] if s_i + 1 < len(starts) else len(words)
        if bset:
            for k in range(w_idx, next_idx):
                beat_sets[k] = bset
    return out, beat_sets


COMPANION_SETS: dict[str, str] = {
    "bedroom": "study",
    "study": "bedroom",
    "vehicle": "outdoor",
    "outdoor": "rooftop",
    "rooftop": "outdoor",
    "kitchen": "study",
    "classroom": "stairwell",
    "stairwell": "outdoor",
}


def infer_story_sets(ep: dict, words: list[dict], root: Path, slug: str) -> tuple[str, str]:
    """Infer the coherent primary and secondary locations for this story (never forcing unrelated rooms like classroom)."""
    explicit = str(ep.get("defaultSet") or ep.get("set") or "").strip().lower()
    if explicit and explicit != DIAGRAM:
        return explicit, COMPANION_SETS.get(explicit, explicit)

    # Also check if any beat in episode.json.script explicitly declares a set
    for b in ep.get("script") or []:
        if isinstance(b, dict):
            bs = str(b.get("set") or "").strip().lower()
            if bs and bs != DIAGRAM:
                return bs, COMPANION_SETS.get(bs, bs)

    # Otherwise score all words in the episode script + topic + source.fr.md
    corpus_parts = [
        str(ep.get("topic") or ""),
        " ".join(str(b.get("text") or "") for b in (ep.get("script") or []) if isinstance(b, dict)),
    ]
    src_md = root / "out" / slug / "source.fr.md"
    if src_md.is_file():
        try:
            corpus_parts.append(src_md.read_text(encoding="utf-8")[:4000])
        except OSError:
            pass
    tokens = [bare_ascii(w) for w in re.findall(r"[\w'\u2019-]+", " ".join(corpus_parts)) if bare_ascii(w)]
    scores: dict[str, int] = {}
    for room_name, kw_list in KEYWORDS.items():
        if room_name == DIAGRAM:
            continue
        kw_set = {bare_ascii(k) for k in kw_list}
        scores[room_name] = sum(1 for tok in tokens if tok in kw_set)

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    primary = ranked[0][0] if ranked and ranked[0][1] > 0 else "study"
    second = (
        ranked[1][0]
        if len(ranked) > 1 and ranked[1][1] > 1 and ranked[1][0] not in {"classroom", "kitchen"}
        else COMPANION_SETS.get(primary, primary)
    )
    return primary, second


def boundary_score(words: list[dict], idx: int, beat_map: dict[int, str]) -> float:
    """Higher score = better place to start a new shot at word `idx` (cutting between idx-1 and idx)."""
    if idx <= 0 or idx >= len(words):
        return -1e9
    prev = words[idx - 1]
    curr = words[idx]
    prev_p = str(prev.get("p") or "")
    prev_w = bare_ascii(str(prev.get("w") or ""))
    curr_w = bare_ascii(str(curr.get("w") or ""))
    gap = max(0.0, float(curr.get("s", 0)) - float(prev.get("e", 0)))

    score = gap * 12.0
    if idx in beat_map:
        score += 50.0
    if any(c in prev_p for c in ".?!…"):
        score += 35.0
    elif any(c in prev_p for c in ":;—"):
        score += 24.0
    elif "," in prev_p:
        score += 15.0

    # Never cut right after a determiner, preposition, or inside "bout à bout" / "demi-tour"
    if prev_w in NO_CUT_AFTER or prev_p.endswith("-"):
        score -= 40.0
    if idx + 1 < len(words) and curr_w == "a" and bare_ascii(str(words[idx + 1].get("w", ""))) == prev_w:
        score -= 45.0  # e.g. "bout | à bout"
    if curr_w in {"et", "mais", "puis", "alors", "quand", "un", "une", "le", "la", "les", "tu", "il", "elle", "on"}:
        score += 4.0
    return score


def choose_cuts(words: list[dict], k: int, beat_map: dict[int, str]) -> list[int]:
    """Global dynamic programming to partition `words` into `k` shots aligned on clause boundaries."""
    n = len(words)
    if k <= 1 or n < 4:
        return [0]
    k = min(k, n // 2)
    total_s = max(1.0, float(words[-1].get("e", 0)) - float(words[0].get("s", 0)))
    ideal_dur = total_s / k

    b_scores = [boundary_score(words, i, beat_map) for i in range(n)]

    def seg_score(i: int, j: int) -> float:
        if j - i < 2:
            return -1e6
        t0 = float(words[i].get("s", 0))
        t1 = float(words[j - 1].get("e", 0))
        dur = max(0.1, t1 - t0)
        pen = abs(dur - ideal_dur) * 14.0
        if dur < 1.0:
            pen += (1.0 - dur) * 80.0
        elif dur > 2.7:
            pen += (dur - 2.7) * 55.0
        return (b_scores[i] if i > 0 else 0.0) - pen

    # dp[s][j]: best score for partitioning words[0:j] into `s` segments
    dp = [[-1e9] * (n + 1) for _ in range(k + 1)]
    parent = [[0] * (n + 1) for _ in range(k + 1)]
    for j in range(2, n + 1):
        dp[1][j] = seg_score(0, j)

    for s in range(2, k + 1):
        for j in range(2 * s, n + 1):
            best_v = -1e9
            best_i = 2 * (s - 1)
            for i in range(2 * (s - 1), j - 1):
                v = dp[s - 1][i] + seg_score(i, j)
                if v > best_v:
                    best_v = v
                    best_i = i
            dp[s][j] = best_v
            parent[s][j] = best_i

    cuts = [0] * k
    cur = n
    for s in range(k, 1, -1):
        cur = parent[s][cur]
        cuts[s - 1] = cur
    return cuts


def build_default_sound(shots: list[dict], title_idx: int) -> dict:
    """Build a complete sound design using pre-cached library/sfx clips."""
    used_clips = {"music", "room_tone", "pop", "sparkle", "title_boom", "drone_hit", "switch_off"}
    events: list[list] = []
    first_id = shots[0]["id"]
    last_id = shots[-1]["id"]
    title_id = shots[title_idx]["id"] if 0 <= title_idx < len(shots) else shots[min(3, len(shots) - 1)]["id"]

    # Ambience bed
    has_class = any(s["set"] == "classroom" for s in shots)
    has_roof = any(s["set"] == "rooftop" for s in shots)
    events.append([first_id, "room_tone", 0.12, "onset", last_id])
    if has_class:
        c_shot = next(s["id"] for s in shots if s["set"] == "classroom")
        used_clips.add("class_murmur")
        events.append([c_shot, "class_murmur", 0.16, "onset", title_id])
    if has_roof:
        r_shot = next(s["id"] for s in shots if s["set"] == "rooftop")
        used_clips.add("roof_wind")
        events.append([r_shot, "roof_wind", 0.16, "onset", last_id])

    # Per-shot action hits
    cycle = ["select_draw", "paper_land", "pop", "copy_click", "paste_pop", "sparkle", "ding"]
    for idx, s in enumerate(shots):
        sid = s["id"]
        if idx == title_idx:
            events.append([sid, "title_boom", 0.65, "peak"])
        elif idx == len(shots) - 1:
            events.append([sid, "drone_hit", 0.35])
            events.append([f"{sid}+18", "switch_off", 0.28])
        elif s["set"] == DIAGRAM:
            used_clips.update(["counter_tick", "power_hum"])
            events.append([f"{sid}+2", "counter_tick", 0.18])
            events.append([f"{sid}+6", "power_hum", 0.14, "onset", shots[min(idx + 1, len(shots) - 1)]["id"]])
        else:
            clip = cycle[idx % len(cycle)]
            used_clips.add(clip)
            events.append([f"{sid}+3", clip, 0.24])

    return {
        "clips": {k: LIBRARY_CLIPS[k] for k in sorted(used_clips) if k in LIBRARY_CLIPS},
        "events": events,
        "repeats": [],
        "music": {"clip": "music", "until": last_id},
        "levels": {"sfx_lu": -1.5, "music_lu": -9.5},
    }


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

    # Genre pace: >= 27 cuts/min -> 1 cut every ~1.5s, minimum 9 shots for a 15-25s episode
    k = args.shots or max(9, min(14, round(seconds / 1.5), len(words) // 3))

    keys = title_words(ep)
    beat_map, beat_sets = beat_starts_in_words(ep, words)
    primary_set, secondary_set = infer_story_sets(ep, words, root, args.slug)
    bounds = choose_cuts(words, k, beat_map)

    shots: list[dict] = []
    edit: list[dict] = []
    previous_set = ""
    run = 0
    title_idx = -1

    # Find which chunk best matches the premise / title card (beat 2 or title words)
    best_title_score = 0
    for i in range(len(bounds)):
        start = bounds[i]
        end = bounds[i + 1] if i + 1 < len(bounds) else len(words)
        chunk = words[start:end]
        b_label = next((beat_map[idx] for idx in range(start, end) if idx in beat_map), "")
        chunk_ascii = " ".join(bare_ascii(str(w["w"])) for w in chunk)
        overlap = len({bare_ascii(str(w["w"])) for w in chunk} & keys)
        is_whatif_phrase = "et si " in f"{chunk_ascii} " or "what if " in f"{chunk_ascii} "
        t_score = (
            (10 if ("2" in b_label or "premise" in b_label.lower() or "title" in b_label.lower()) else 0)
            + (20 if is_whatif_phrase else 0)
            + overlap * 3
        )
        if t_score > best_title_score and 1 <= i <= len(bounds) - 2:
            best_title_score = t_score
            title_idx = i
    if title_idx < 0 and len(bounds) >= 4:
        title_idx = min(len(bounds) - 3, max(2, len(bounds) // 2))

    # Vary camera framing within the same location so staying in one room/vehicle/exterior feels cinematic
    SAME_SET_SIZES = ["close", "insert", "medium, low angle", "wide", "close", "medium, high angle"]

    wi_prev = 0
    for i in range(len(bounds)):
        start = bounds[i]
        end = bounds[i + 1] if i + 1 < len(bounds) else len(words)
        chunk = words[start:end]
        if not chunk:
            continue
        text = [str(w["w"]).strip() for w in chunk]
        span = max(18, round(float(chunk[-1].get("e", 0)) * FPS) - round(float(chunk[0].get("s", 0)) * FPS))
        label = " ".join(text[:10])
        b_label = next((beat_map[idx] for idx in range(start, end) if idx in beat_map), "")
        explicit_beat_set = next((beat_sets[idx] for idx in range(start, end) if idx in beat_sets), "")

        is_title = i == title_idx
        is_turn = "4" in b_label or "turn" in b_label.lower() or "cost" in b_label.lower()
        has_digits = any(re.search(r"\d", t) for t in text)
        if is_title:
            room = explicit_beat_set or (primary_set if primary_set != DIAGRAM else "rooftop")
        elif is_turn or (has_digits and i > title_idx and previous_set != DIAGRAM):
            room = DIAGRAM
        elif explicit_beat_set:
            room = explicit_beat_set
        else:
            hits = {
                room_name: sum(1 for t in text if bare_ascii(t) in {bare_ascii(k) for k in words_of})
                for room_name, words_of in KEYWORDS.items()
            }
            ranked = sorted(hits.items(), key=lambda kv: -kv[1])
            best = next((name for name, score in ranked if score > 0 and (name != DIAGRAM or run < 2)), "")
            if best:
                room = best
            elif previous_set and previous_set != DIAGRAM and run < 3:
                room = previous_set
            else:
                # Stay faithful to the story's world (primary_set / secondary_set) — never teleport into classroom/kitchen
                room = secondary_set if (previous_set == primary_set and run >= 3) else primary_set
        run = run + 1 if room == previous_set else 1
        previous_set = room

        if is_title:
            size = "title, wide"
        elif room == DIAGRAM:
            size = "schematic"
        elif run > 1:
            size = SAME_SET_SIZES[(run - 1) % len(SAME_SET_SIZES)]
        else:
            size = SIZES[i % len(SIZES)]
        if is_title and not label.lower().startswith("title"):
            label = f"title card: {label}"

        shots.append(
            {
                "id": f"S{i + 1}",
                "size": size,
                "set": room,
                "key": max(10, min(max(10, span - 4), round(span * 0.55))),
                "note": label,
            }
        )

        if i == 0:
            edit.append({"shot": shots[-1]["id"], "at": "f:0"})
            wi_prev = 1
        else:
            # Resolve the exact occurrence index (`word` or `word#nth`) starting from wi_prev, matching plan.py
            target_word = norm(str(chunk[0]["w"]))
            occ = 0
            for idx in range(wi_prev, start + 1):
                if norm(str(words[idx]["w"])) == target_word:
                    occ += 1
            cue = target_word if occ <= 1 else f"{target_word}#{occ}"
            edit.append({"shot": shots[-1]["id"], "at": cue})
            wi_prev = start + 1

    ep["shots"] = shots
    ep["edit"] = edit
    title_id = shots[title_idx]["id"] if 0 <= title_idx < len(shots) else "S4"
    last_id = shots[-1]["id"]
    ep["fx"] = [
        {"at": title_id, "kind": "flash", "color": "#FFF3DC", "o": 0.45},
        {"at": last_id, "kind": "flash", "color": "#FF3344", "o": 0.4},
        {"at": last_id, "kind": "shake", "len": 8, "amp": 10},
    ]
    ep["sound"] = build_default_sound(shots, title_idx)

    ep_path.write_text(json.dumps(ep, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    cuts_per_min = max(0, len(shots) - 1) / max(1.0, seconds) * 60.0
    print(
        f"{len(shots)} shot(s) for {seconds:.1f}s ({seconds / max(1, len(shots)):.2f}s avg, {cuts_per_min:.0f} cuts/min)"
    )
    for s, e in zip(shots, edit):
        print(f"  {s['id']:<4} {e['at']:<18} {s['size']:<18} {s['set']:<10} (key f:{s['key']}) {s['note']}")
    print("RESULT_JSON:" + json.dumps({"ok": True, "shots": len(shots), "seconds": round(seconds, 2), "cutsPerMin": round(cuts_per_min, 1)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
