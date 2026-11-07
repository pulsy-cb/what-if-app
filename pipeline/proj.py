"""Shared plumbing for this app's own pipeline scripts (they run with cwd = the project root).

The studio layout is the skill's: src/episodes/<slug>/, public/<slug>/, out/<slug>/. We only add
out/<slug>/source.json and the _nouveau side of things; nothing here touches the engine.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any, Dict, List, Optional

STUDIO = pathlib.Path.cwd()
if not (STUDIO / "src" / "episodes").is_dir():
    raise SystemExit("Run this from the project folder (the one with src/episodes and package.json).")

WORD_CHARS = re.compile(r"[\w'’œŒ]")


def ep_dir(slug: str) -> pathlib.Path:
    return STUDIO / "src" / "episodes" / slug


def pub_dir(slug: str) -> pathlib.Path:
    d = STUDIO / "public" / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def out_dir(slug: str) -> pathlib.Path:
    d = STUDIO / "out" / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_json(path: Any, default: Any = None) -> Any:
    p = pathlib.Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save_json(path: Any, data: Any) -> None:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def load_episode(slug: str) -> Dict[str, Any]:
    p = ep_dir(slug) / "episode.json"
    if not p.exists():
        raise SystemExit(f"No episode.json at {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def flat_script(ep: Dict[str, Any]) -> str:
    return " ".join(str(b.get("text", "")).strip() for b in ep.get("script") or []).strip()


def result(**payload: Any) -> None:
    """One machine-readable line the orchestrator picks up (and hides from its own summary)."""
    print("RESULT_JSON:" + json.dumps(payload, ensure_ascii=False), flush=True)


def arg(argv: List[str], name: str, default: Optional[str] = None) -> Optional[str]:
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    for a in argv:
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return default


def strip_tts_tags(text: str) -> str:
    """Remove ElevenLabs v4 [...] voice directions and <...> prosody tags before word splitting."""
    s = re.sub(r"\[[^\]]*\]", " ", text or "")
    s = re.sub(r"<[^>]*>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def split_words(text: str) -> List[Dict[str, str]]:
    """Text -> [{w, p}] with the punctuation that follows each word (it drives the pause limits).

    Same rule as the skill's voice.py, so words.json stays compatible with plan.py.
    """
    text = strip_tts_tags(text)
    words: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for ch in text:
        if WORD_CHARS.match(ch):
            if cur is None:
                cur = {"w": "", "p": ""}
            cur["w"] += ch
        else:
            if cur is not None:
                words.append(cur)
                cur = None
            if words and not ch.isspace():
                words[-1]["p"] += ch
    if cur:
        words.append(cur)
    return words


if __name__ == "__main__":
    sys.exit("proj.py is a library; run source_import.py or voice_fish.py")
