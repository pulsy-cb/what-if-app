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
    "restaurant": [
        "restaurant", "resto", "serveur", "serveuse", "menu", "addition", "table", "ravioli",
        "raviolis", "tupperware", "soda", "verre", "plat", "date", "patron", "cheque", "pourboire",
        "commande", "commander", "boisson", "entree", "dessert", "bistrot",
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
    "rooftop": ["toit", "ciel", "soleil", "nuage", "horizon", "immeuble", "etoile", "lune", "terrasse"],
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

# Words after which a cut is forbidden (determiners, prepositions, clitics, auxiliaries that bind to the next word)
NO_CUT_AFTER = {
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "au", "aux",
    "ce", "cet", "cette", "ces", "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses", "nos", "vos", "leurs",
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "se", "s", "ne", "n", "y", "en",
    "a", "dans", "par", "pour", "en", "vers", "avec", "de", "sans", "sous", "sur", "chez", "entre",
    "et", "ou", "mais", "donc", "or", "ni", "car", "que", "qu", "qui", "dont", "ou", "si", "comme",
    "plus", "moins", "tres", "trop", "tout", "toute", "tous", "toutes", "meme", "autre", "autres",
    "demi", "semi", "non", "pas", "peu", "bien",
    "ai", "as", "ont", "avais", "avait", "avaient", "suis", "es", "est", "sommes", "etes", "sont",
    "etais", "etait", "etaient", "vais", "vas", "va", "allais", "allait", "allaient", "peux", "peut",
    "pouvais", "pouvait", "voulais", "voulait", "dois", "doit", "devait", "commence", "essayait", "essaye",
}

# Multi-word conjunctions that must never be split across two shots ("même | si", "pendant | que", "parce | que")
COMPOUND_CONNECTORS = {
    ("meme", "si"), ("parce", "que"), ("parce", "qu"), ("pendant", "que"), ("pendant", "qu"),
    ("alors", "que"), ("alors", "qu"), ("tandis", "que"), ("avant", "que"), ("avant", "de"),
    ("apres", "que"), ("apres", "avoir"), ("sans", "que"), ("bien", "que"), ("pour", "que"),
    ("afin", "que"), ("afin", "de"), ("des", "que"), ("jusqu", "a"), ("au", "lieu"),
}

# Semantic vocabulary for shot framing (replaces blind % len(SIZES) cycling)
SPEECH_REACTION_WORDS = {
    "dit", "demande", "demander", "repondu", "repond", "souri", "sourire", "pleurait", "pleurer", "pleure",
    "hurlait", "hurler", "hurle", "crie", "crier", "appele", "visage", "yeux", "regard", "regarde",
    "bouche", "larmes", "pardon", "desolee", "desole", "merci", "aide", "attends", "voyons", "pourquoi",
    "quoi", "comment", "chuchote", "soupire", "ri", "rire", "rougi", "blanchi", "grimace", "silence",
}

OBJECT_PROP_WORDS = {
    "bouteille", "fiole", "flacon", "poudre", "telephone", "portable", "ecran", "message", "texto",
    "cle", "cles", "serrure", "billet", "carte", "lettre", "note", "addition", "facture", "ticket",
    "plat", "assiette", "bol", "verre", "tasse", "sac", "boite", "tupperware", "bague", "alliance",
    "montre", "bouton", "fil", "cable", "couteau", "ciseaux", "stylo", "feuille", "photo", "etiquette",
    "ceinture", "doritos", "chips", "portefeuille", "monnaie", "enveloppe", "pilule", "comprime",
    "dossier", "ordonnance", "bracelet", "seringue", "moniteur", "scanner", "radio", "medicament",
    "virement", "compte", "euro", "euros", "dollar", "dollars", "reveil", "horloge", "poignee",
    "verrou", "tiroir", "valise", "cadeau", "carnet", "journal", "contrat", "signature", "sms",
    "notification", "clavier", "souris", "manette", "casque", "micro", "cafe", "sang", "cicatrice",
    "mains", "doigts", "poche",
}

WIDE_ACTION_WORDS = {
    "approchee", "approche", "bondi", "saute", "leve", "levee", "assis", "assise", "entre", "entree",
    "sorti", "sortie", "couru", "marche", "tire", "pousse", "arrache", "ensemble", "toutes", "canape",
    "salon", "piece", "rue", "porte", "couloir", "escalier", "tous", "devant", "autour",
}

DRAMATIC_LOW_HIGH_WORDS = {
    "hurlait", "geant", "monstre", "coince", "coincee", "piege", "impossible", "terreur", "panique",
    "etire", "dechire", "comprimait", "ecrase", "soudain", "explose", "effondre", "domine",
    "choc", "fige", "figee", "glace", "glacee", "tremble", "tremblait", "mensonge", "trahi",
    "urgence", "urgences", "critique", "danger", "alarme", "arrestation", " hurle", "crie",
}

MEMORY_LOOK_WORDS = {
    "souviens", "souvenir", "souvenirs", "epoque", "enfance", "autrefois", "jadis", "rappelle",
    "rappelais", "annees", "auparavant",
}

TIME_PLACE_STAMP_PHRASES = (
    "plus tard", "plus tot", "lendemain", "la veille", "heures du matin", "heures du soir",
    "ans plus", "mois plus", "semaines plus", "jours plus", "salle d", "aux urgences",
    "a l hopital", "au commissariat", "au tribunal",
)

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
    "big_step": ["a cartoon exaggerated careful tiptoe step, light airy whoosh", 0.7],
    "ding": ["a correct answer ding, bright bell chime", 0.8],
    "buzzer": ["a game show wrong answer buzzer, short", 0.8],
    "shades": ["cool sunglasses sliding on with a swoosh and a bright metallic glint", 0.9],
    "clink": ["a ceramic coffee mug knocked by a hand on a wooden desk, short clink and scrape", 0.7],
    "shatter": ["a ceramic coffee mug smashing on a wooden floor, shards scattering and liquid splash", 1.3],
    "crack": ["glass cracking sharply, the crack spreading across a pane", 1.1],
    "fall_whoosh": ["a small object falling fast through the air, short soft whoosh", 0.6],
    "clock_back": ["a clock ticking very fast then spinning backwards, mechanical ratchet whirr", 1.6],
    "gasp": ["a short surprised intake of breath gasp", 0.6],
    "laugh": ["a small classroom of kids bursting out laughing", 1.6],
    "dizzy": ["cartoon dizzy birds tweeting in a circle after a bonk", 1.4],
    "catch": ["a hand catching a ceramic mug mid-air, soft slap and thud", 0.5],
    "land": ["a heavy body landing flat on a wooden floor, cartoon thud", 0.6],
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


def strip_tts_tags(text: str) -> str:
    s = re.sub(r"\[[^\]]*\]", " ", text or "")
    s = re.sub(r"<[^>]*>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def beat_starts_in_words(ep: dict, words: list[dict]) -> tuple[dict[int, str], dict[int, str]]:
    """Map word indices where each script beat starts -> beat label, and every word index -> beat set (if specified)."""
    out: dict[int, str] = {}
    beat_sets: dict[int, str] = {}
    starts: list[tuple[int, str, str]] = []
    cursor = 0
    for b in ep.get("script") or []:
        if not isinstance(b, dict):
            continue
        btext = strip_tts_tags(str(b.get("text") or "").strip())
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
    "restaurant": "restaurant",
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


def clean_french_spacing(text: str) -> str:
    """Fix spurious spaces around hyphens in French inversions ('a- t- elle' -> 'a-t-elle', 'ai- je' -> 'ai-je')."""
    s = re.sub(r"\b([A-Za-zÀ-ÖØ-öø-ÿ]+)-\s+t-\s+(il|elle|on|ils|elles)\b", r"\1-t-\2", text, flags=re.IGNORECASE)
    s = re.sub(
        r"\b([A-Za-zÀ-ÖØ-öø-ÿ]+)-\s+(je|tu|il|elle|on|nous|vous|ils|elles|ce|la|le|les|moi|toi|lui|leur|y|en)\b",
        r"\1-\2",
        s,
        flags=re.IGNORECASE,
    )
    return s


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
        score += 42.0
    elif any(c in prev_p for c in ":;—"):
        score += 26.0
    elif "," in prev_p:
        score += 16.0

    # Never cut right after a determiner, preposition, auxiliary, or inside "bout à bout" / "même si" / "pendant que"
    if prev_w in NO_CUT_AFTER or prev_p.endswith("-"):
        score -= 48.0
    if (prev_w, curr_w) in COMPOUND_CONNECTORS:
        score -= 60.0
    if idx + 1 < len(words) and curr_w == "a" and bare_ascii(str(words[idx + 1].get("w", ""))) == prev_w:
        score -= 45.0  # e.g. "bout | à bout"
    if curr_w in {"et", "mais", "puis", "alors", "quand", "un", "une", "le", "la", "les", "tu", "il", "elle", "on"} and prev_w not in NO_CUT_AFTER:
        score += 5.0
    return score


def choose_cuts(words: list[dict], k: int, beat_map: dict[int, str]) -> list[int]:
    """Global dynamic programming to partition `words` into `k` shots aligned on clause boundaries,
    with a faster cold-open hook in the opening 25% (up to 35 s) and tighter cuts on dramatic beats."""
    n = len(words)
    if k <= 1 or n < 4:
        return [0]
    k = min(k, n // 2)
    t_origin = float(words[0].get("s", 0))
    total_s = max(1.0, float(words[-1].get("e", 0)) - t_origin)
    ideal_dur = total_s / k
    hook_end = t_origin + (min(35.0, total_s * 0.25) if total_s >= 40.0 else 0.0)
    min_dur = 1.65 if total_s > 32.0 else 1.15
    max_dur = max(2.8, ideal_dur * 1.6)

    b_scores = [boundary_score(words, i, beat_map) for i in range(n)]
    dramatic_prefix = [0] * (n + 1)
    for idx_w, w in enumerate(words):
        dramatic_prefix[idx_w + 1] = dramatic_prefix[idx_w] + (
            1 if bare_ascii(str(w.get("w") or "")) in DRAMATIC_LOW_HIGH_WORDS else 0
        )

    def seg_score(i: int, j: int) -> float:
        if j - i < 2:
            return -1e6
        t0 = float(words[i].get("s", 0))
        t1 = float(words[j - 1].get("e", 0))
        dur = max(0.1, t1 - t0)
        in_hook = hook_end > t_origin and t0 < hook_end
        has_drama = (dramatic_prefix[j] - dramatic_prefix[i]) > 0
        local_ideal = ideal_dur * (0.74 if in_hook else (0.86 if has_drama else 1.06 if hook_end > t_origin else 1.0))
        local_min = 1.3 if in_hook else min_dur
        local_max = max(2.6, local_ideal * 1.55)
        pen = abs(dur - local_ideal) * 14.0
        if dur < local_min:
            pen += (local_min - dur) * 95.0
        elif dur > local_max:
            pen += (dur - local_max) * 55.0
        return (b_scores[i] if i > 0 else 0.0) - pen

    # dp[s][j]: best score for partitioning words[0:j] into `s` segments
    dp = [[-1e9] * (n + 1) for _ in range(k + 1)]
    parent = [[0] * (n + 1) for _ in range(k + 1)]
    for j in range(2, n + 1):
        dp[1][j] = seg_score(0, j)

    # A shot far longer than max_dur never wins, so only look back a few max_dur from each end: this keeps a 16-minute
    # episode (200+ shots, 2 700 words) to seconds instead of an O(k n^2) search that runs for many minutes.
    reach = max_dur * 4.0
    first = [0] * (n + 1)
    lo = 0
    for j in range(1, n + 1):
        end_t = float(words[j - 1].get("e", 0))
        while lo < j - 2 and end_t - float(words[lo].get("s", 0)) > reach:
            lo += 1
        first[j] = lo

    for s in range(2, k + 1):
        for j in range(2 * s, n + 1):
            best_v = -1e9
            best_i = 2 * (s - 1)
            for i in range(max(2 * (s - 1), first[j]), j - 1):
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


def infer_shot_size(
    chunk: list[dict],
    idx: int,
    total_shots: int,
    is_title: bool,
    room: str,
    prev_size: str,
    insert_count: int,
    since_insert: int = 99,
) -> str:
    """Choose camera framing from the narrative semantics of the clause (never blind % len cycling)."""
    if is_title:
        return "title, wide"
    if room == DIAGRAM:
        return "schematic"
    if idx == 0:
        return "wide"

    tokens = {bare_ascii(str(w.get("w") or "")) for w in chunk if bare_ascii(str(w.get("w") or ""))}
    raw_join = " ".join(str(w.get("w") or "") for w in chunk)
    puncts = "".join(str(w.get("p") or str(w.get("w") or "")) for w in chunk)
    has_question_or_exclaim = "?" in puncts or "!" in puncts
    speech_hits = len(tokens & SPEECH_REACTION_WORDS) + (2 if has_question_or_exclaim else 0)
    prop_hits = len(tokens & OBJECT_PROP_WORDS)
    has_concrete_number = bool(re.search(r"\b\d+(?:[.,]\d+)?\b|[€$%]", raw_join))
    wide_hits = len(tokens & WIDE_ACTION_WORDS)
    dramatic_hits = len(tokens & DRAMATIC_LOW_HIGH_WORDS)

    max_inserts = max(2, round(total_shots * 0.2))
    min_insert_gap = 3 if total_shots <= 20 else 4
    # 1. Insert: whenever a physical prop/phone/document or concrete number/time is mentioned (even if narrated with speech verbs),
    # spaced naturally so ~15-20% of shots break out into macro object/phone/tabletop inserts!
    if (
        (prop_hits > 0 or (has_concrete_number and prop_hits + speech_hits <= 2))
        and dramatic_hits < 2
        and prev_size != "insert"
        and since_insert >= min_insert_gap
        and insert_count < max_inserts
    ):
        return "insert"

    # 2. Dramatic angle: when strong physical/emotional tension words appear, and never back-to-back
    if dramatic_hits > 0 and "angle" not in prev_size:
        return "medium, low angle" if (idx % 2 == 0) else "medium, high angle"

    # 3. Close-up: spoken lines, questions/exclamations, facial reactions
    if speech_hits > 0 and prev_size != "close":
        return "close"

    # 4. Wide shot: physical movement, group action, room entry/exit
    if wide_hits > 0 and prev_size != "wide":
        return "wide"

    # 5. Natural cinematic alternation (wide -> medium -> close -> medium) without ever repeating the exact same framing twice
    fallback_order = ["medium", "close", "wide", "medium"]
    cand = fallback_order[idx % len(fallback_order)]
    if cand == prev_size:
        cand = "medium" if prev_size != "medium" else ("close" if speech_hits >= wide_hits else "wide")
    return cand


def infer_clause_accent(
    chunk: list[dict],
    idx: int,
    total_shots: int,
    is_title: bool,
    size: str,
    has_non_todo_title: bool,
) -> tuple[str, str, int]:
    """Return (accent_hint, look_name, drama_score) for a shot's clause."""
    tokens = {bare_ascii(str(w.get("w") or "")) for w in chunk if bare_ascii(str(w.get("w") or ""))}
    clause_ascii = " ".join(bare_ascii(str(w.get("w") or "")) for w in chunk)
    raw_join = " ".join(str(w.get("w") or "") for w in chunk)
    puncts = "".join(str(w.get("p") or str(w.get("w") or "")) for w in chunk)

    dramatic_hits = len(tokens & DRAMATIC_LOW_HIGH_WORDS)
    exclaim = 1 if "!" in puncts else 0
    question = 1 if "?" in puncts else 0
    drama_score = dramatic_hits * 3 + exclaim * 2 + question

    is_time_place = any(p in clause_ascii for p in TIME_PLACE_STAMP_PHRASES) or bool(
        re.search(r"\b\d{1,2}\s*h(?:\s*\d{2})?\b", raw_join.lower())
    )
    is_memory = bool(tokens & MEMORY_LOOK_WORDS) or "plus tot" in clause_ascii or "quand j etais" in clause_ascii
    has_amount = bool(re.search(r"\b\d{2,}\b|[€$%]", raw_join))

    look = ""
    if is_memory and 0 < idx < total_shots - 1:
        look = "memory"
    elif dramatic_hits >= 2 or (dramatic_hits >= 1 and exclaim):
        look = "tension"

    accent = ""
    if is_title:
        accent = "title-card"
    elif idx == 0 and has_non_todo_title:
        accent = "hook-title"
    elif is_time_place:
        accent = "stamp"
    elif has_amount:
        accent = "tag"
    elif dramatic_hits >= 1 and size != "insert":
        accent = "vfx:shock" if exclaim or "choc" in tokens or "soudain" in tokens else "vfx:sweat"
    elif question and "close" in size:
        accent = "vfx:focus"

    return accent, look, drama_score


def _ambience_clip_for_set(set_name: str) -> str:
    s = str(set_name or "").lower()
    if s in {"outdoor", "rooftop", "street", "park", "garden", "schoolyard"}:
        return "roof_wind"
    return "room_tone"


def build_default_sound(
    shots: list[dict],
    title_idx: int,
    edit: list[dict] | None = None,
    fx_list: list[dict] | None = None,
) -> dict:
    """Build a natural, non-repetitive sound design (continuous location ambiences + semantic foley, NO looped music bed)."""
    used_clips = {"room_tone", "title_boom", "drone_hit", "switch_off"}
    events: list[list] = []
    last_id = shots[-1]["id"]

    # 1. Continuous location-matched ambience beds (crossfade-tiled by sfx_run.py until each `until` cue)
    i = 0
    while i < len(shots):
        amb = _ambience_clip_for_set(shots[i].get("set", ""))
        j = i + 1
        while j < len(shots) and _ambience_clip_for_set(shots[j].get("set", "")) == amb:
            j += 1
        start_cue = shots[i]["id"]
        end_cue = shots[j]["id"] if j < len(shots) else "end"
        used_clips.add(amb)
        events.append([start_cue, amb, 0.13, "onset", end_cue])
        if any(str(shots[m].get("set", "")) == "classroom" for m in range(i, j)):
            c_start = next(shots[m]["id"] for m in range(i, j) if str(shots[m].get("set", "")) == "classroom")
            used_clips.add("class_murmur")
            events.append([c_start, "class_murmur", 0.11, "onset", end_cue])
        i = j

    look_by_shot = {str(e.get("shot")): str(e.get("look") or "") for e in (edit or []) if isinstance(e, dict)}
    fx_shots = {str(f.get("at")) for f in (fx_list or []) if isinstance(f, dict) and f.get("at")}

    # 2. Semantic foley & dramatic accents (no mechanical copy_click/paste_pop loop on ordinary dialogue shots)
    prev_look = ""
    for idx, s in enumerate(shots):
        sid = s["id"]
        size = str(s.get("size") or "").lower()
        accent = str(s.get("accent") or "").lower()
        note_tokens = {bare_ascii(w) for w in re.findall(r"[\w'-]+", str(s.get("note") or ""))}
        cur_look = look_by_shot.get(sid, "")

        if idx == title_idx or accent == "hook-title":
            events.append([sid, "title_boom", 0.52, "peak"])
        elif idx == len(shots) - 1:
            events.append([sid, "drone_hit", 0.34])
            events.append([f"{sid}+18", "switch_off", 0.25])
        elif cur_look == "memory" and prev_look != "memory":
            used_clips.add("clock_back")
            events.append([sid, "clock_back", 0.22])
        elif sid in fx_shots:
            used_clips.update(["drone_hit", "gasp"])
            events.append([sid, "drone_hit", 0.28])
            if "vfx:shock" in accent:
                events.append([f"{sid}+4", "gasp", 0.22])
        elif s.get("set") == DIAGRAM:
            used_clips.update(["counter_tick", "power_hum"])
            events.append([f"{sid}+2", "counter_tick", 0.18])
            events.append([f"{sid}+6", "power_hum", 0.12, "onset", shots[min(idx + 1, len(shots) - 1)]["id"]])
        elif "insert" in size:
            if note_tokens & {"telephone", "portable", "message", "texto", "sms", "notification", "ecran"}:
                used_clips.add("pop")
                events.append([f"{sid}+4", "pop", 0.22])
            elif note_tokens & {"facture", "dossier", "lettre", "enveloppe", "billet", "carte", "feuille", "contrat", "ordonnance"}:
                used_clips.add("paper_land")
                events.append([f"{sid}+3", "paper_land", 0.24])
            elif note_tokens & {"verre", "tasse", "cafe", "bouteille", "cle", "cles", "bague", "alliance", "pilule"}:
                used_clips.add("clink")
                events.append([f"{sid}+4", "clink", 0.24])
            else:
                used_clips.add("paper_land")
                events.append([f"{sid}+3", "paper_land", 0.18])
        elif accent == "tag":
            used_clips.add("counter_tick")
            events.append([f"{sid}+4", "counter_tick", 0.18])
        elif accent == "stamp":
            used_clips.add("pop")
            events.append([f"{sid}+2", "pop", 0.16])
        elif accent == "vfx:shock":
            used_clips.add("gasp")
            events.append([f"{sid}+4", "gasp", 0.22])
        elif accent == "vfx:focus":
            used_clips.add("sparkle")
            events.append([f"{sid}+5", "sparkle", 0.18])
        elif note_tokens & {"marche", "entre", "sorti", "escalier", "couloir", "approche", "couru"}:
            used_clips.add("step")
            events.append([f"{sid}+4", "step", 0.2])

        prev_look = cur_look

    return {
        "clips": {k: LIBRARY_CLIPS[k] for k in sorted(used_clips) if k in LIBRARY_CLIPS},
        "events": events,
        "repeats": [],
        "levels": {"sfx_lu": -4.5, "music_lu": -11.0},
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

    # Dynamic 3-gear pace: fast cold-open hook (~1.8-2.2 s/shot) + brisk narrative rhythm (~2.2 s for shorts/9:16, ~3.1 s for long 16:9 instead of 4.5 s).
    vertical = str(ep.get("aspect", "")).strip() == "9:16"
    if args.shots:
        k = args.shots
    elif seconds <= 36:
        k = max(9, min(20, round(seconds / 1.8), len(words) // 3))
    elif seconds <= 150 or vertical:
        k = max(12, min(round(seconds / 2.2), len(words) // 3))
    else:
        k = max(48, min(round(seconds / 3.1), len(words) // 4))

    keys = title_words(ep)
    beat_map, beat_sets = beat_starts_in_words(ep, words)
    primary_set, secondary_set = infer_story_sets(ep, words, root, args.slug)
    bounds = choose_cuts(words, k, beat_map)
    sci_list = ep.get("science") or []
    has_science = bool(sci_list) and not any("todo" in str(s).lower() for s in sci_list)

    shots: list[dict] = []
    edit: list[dict] = []
    previous_set = ""
    run = 0
    title_idx = -1
    has_source_video = bool((ep.get("source") or {}).get("videoId"))

    # Find which chunk best matches the premise / title card (beat 2 or "et si..." phrase in the opening third)
    best_title_score = 0
    max_title_pos = max(3, len(bounds) // 3)
    for i in range(len(bounds)):
        if i < 1 or i > max_title_pos:
            continue
        start = bounds[i]
        end = bounds[i + 1] if i + 1 < len(bounds) else len(words)
        chunk = words[start:end]
        b_label = next((beat_map[idx] for idx in range(start, end) if idx in beat_map), "")
        chunk_ascii = " ".join(bare_ascii(str(w["w"])) for w in chunk)
        overlap = len({bare_ascii(str(w["w"])) for w in chunk} & keys)
        is_whatif_phrase = "et si " in f"{chunk_ascii} " or "what if " in f"{chunk_ascii} "
        t_score = (
            (15 if ("2" in b_label or "premise" in b_label.lower() or "title" in b_label.lower()) else 0)
            + (25 if is_whatif_phrase else 0)
            + overlap * 3
        )
        if t_score > best_title_score:
            best_title_score = t_score
            title_idx = i
    # For standalone 7-beat What If episodes, ensure a title card exists near the start; for narrative :8005 stories,
    # never force a random title card in the middle of the story unless there is an explicit What If premise!
    if has_source_video and best_title_score < 18:
        title_idx = -1
    elif not has_source_video and title_idx < 0 and len(bounds) >= 4:
        title_idx = min(3, len(bounds) - 2)

    raw_title = ep.get("title") or []
    title_str = " ".join(raw_title) if isinstance(raw_title, list) else str(raw_title)
    has_non_todo_title = bool(title_str.strip()) and "todo" not in title_str.lower() and "… ?" not in title_str

    wi_prev = 0
    prev_size = ""
    insert_count = 0
    since_insert = 99
    look_counts: dict[str, int] = {"memory": 0, "tension": 0}
    max_look_each = max(2, len(bounds) // 10)
    drama_candidates: list[tuple[int, int]] = []  # (drama_score, shot_idx)

    for i in range(len(bounds)):
        start = bounds[i]
        end = bounds[i + 1] if i + 1 < len(bounds) else len(words)
        chunk = words[start:end]
        if not chunk:
            continue
        text = [str(w["w"]).strip() for w in chunk]
        span = max(18, round(float(chunk[-1].get("e", 0)) * FPS) - round(float(chunk[0].get("s", 0)) * FPS))
        label = clean_french_spacing(" ".join(text[:12]))
        b_label = next((beat_map[idx] for idx in range(start, end) if idx in beat_map), "")
        explicit_beat_set = next((beat_sets[idx] for idx in range(start, end) if idx in beat_sets), "")

        is_title = i == title_idx
        is_turn = has_science and ("4" in b_label or "turn" in b_label.lower() or "cost" in b_label.lower())
        has_digits = has_science and any(re.search(r"\d", t) for t in text)
        if is_title:
            room = explicit_beat_set or (primary_set if primary_set != DIAGRAM else "rooftop")
        elif is_turn or (has_digits and i > max(0, title_idx) and previous_set != DIAGRAM):
            room = DIAGRAM
        elif explicit_beat_set:
            room = explicit_beat_set
        else:
            has_explicit_default = bool(str(ep.get("defaultSet") or ep.get("set") or "").strip())
            min_hits = 2 if has_explicit_default else 1
            hits = {
                room_name: sum(1 for t in text if bare_ascii(t) in {bare_ascii(k) for k in words_of})
                for room_name, words_of in KEYWORDS.items()
            }
            ranked = sorted(hits.items(), key=lambda kv: -kv[1])
            best = next((name for name, score in ranked if score >= min_hits and (name != DIAGRAM or (has_science and run < 2))), "")
            if best:
                room = best
            elif previous_set and previous_set != DIAGRAM and (has_explicit_default or run < 3):
                room = previous_set
            else:
                # Stay faithful to the story's world (primary_set / secondary_set) — never teleport into classroom/kitchen
                room = secondary_set if (previous_set == primary_set and run >= 3 and not has_explicit_default) else primary_set
        run = run + 1 if room == previous_set else 1
        previous_set = room

        size = infer_shot_size(chunk, i, len(bounds), is_title, room, prev_size, insert_count, since_insert)
        prev_size = size
        if size == "insert":
            insert_count += 1
            since_insert = 0
        else:
            since_insert += 1
        if is_title and not label.lower().startswith("title"):
            label = f"title card: {label}"

        accent_hint, look_name, drama_score = infer_clause_accent(
            chunk, i, len(bounds), is_title, size, has_non_todo_title and title_idx < 0
        )
        if drama_score >= 3 and 1 <= i < len(bounds) - 1:
            drama_candidates.append((drama_score, i))

        shot_entry: dict = {
            "id": f"S{i + 1}",
            "size": size,
            "set": room,
            "key": max(10, min(max(10, span - 4), round(span * 0.55))),
            "note": label,
            # the staging card: filled by the agent (stage_shots) before the shot is coded
            "stage": None,
        }
        if accent_hint:
            shot_entry["accent"] = accent_hint
        shots.append(shot_entry)

        if i == 0:
            edit_entry: dict = {"shot": shots[-1]["id"], "at": "f:0"}
            wi_prev = 1
        else:
            # Resolve the exact occurrence index (`word` or `word#nth`) starting from wi_prev, matching plan.py
            target_word = norm(str(chunk[0]["w"]))
            occ = 0
            for idx in range(wi_prev, start + 1):
                if norm(str(words[idx]["w"])) == target_word:
                    occ += 1
            cue = target_word if occ <= 1 else f"{target_word}#{occ}"
            edit_entry = {"shot": shots[-1]["id"], "at": cue}
            wi_prev = start + 1

        if look_name and look_counts.get(look_name, 0) < max_look_each:
            edit_entry["look"] = look_name
            look_counts[look_name] = look_counts.get(look_name, 0) + 1
        edit.append(edit_entry)

    ep["shots"] = shots
    ep["edit"] = edit
    last_id = shots[-1]["id"]
    fx_list: list[dict] = []
    if 0 <= title_idx < len(shots):
        fx_list.append({"at": shots[title_idx]["id"], "kind": "flash", "color": "#FFF3DC", "o": 0.45})

    # Place mid-episode dramatic fx (flash + shake) on up to 3 strongest twists, spaced across the story
    min_fx_gap = max(3, len(shots) // 5)
    picked_fx_indices: list[int] = []
    for _score, s_idx in sorted(drama_candidates, key=lambda kv: (-kv[0], kv[1])):
        if len(picked_fx_indices) >= 3:
            break
        if s_idx == title_idx or any(abs(s_idx - p) < min_fx_gap for p in picked_fx_indices):
            continue
        picked_fx_indices.append(s_idx)
    for s_idx in sorted(picked_fx_indices):
        sid = shots[s_idx]["id"]
        fx_list.append({"at": sid, "kind": "flash", "color": "#FFF3DC", "o": 0.32})
        fx_list.append({"at": sid, "kind": "shake", "len": 6, "amp": 7})

    fx_list.extend(
        [
            {"at": last_id, "kind": "flash", "color": "#FF3344", "o": 0.4},
            {"at": last_id, "kind": "shake", "len": 8, "amp": 10},
        ]
    )
    ep["fx"] = fx_list
    ep["sound"] = build_default_sound(shots, title_idx, edit, fx_list)

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
