"""Import a nouveau video id as the source of an episode: English transcript -> French narration.

    python3 pipeline/source_import.py <slug> --video <video_id>
    python3 pipeline/source_import.py <slug> --video <video_id> --pick hook --apply

The translation is produced by nouveau (POST /translate/generate with scriptMode=narration), so the
proposal, the TTS and the episode all stay attached to the same video id in the nouveau UI.

Nothing is sent to the LLM of this app: this script only drives the local API. The agent reads
out/<slug>/source.fr.md, then writes the 15-25 s episode script itself.
"""

from __future__ import annotations

import re
import sys
from typing import Any, Dict, List, Optional

import proj
from nouveau_client import FISH_MODEL, FISH_VOICE, Nouveau, NouveauError

MAX_BLOCK_WORDS = 22


def sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?…])\s+", text.replace("\n", " ").strip())
    return [p.strip() for p in parts if p.strip()]


def blocks(text: str, limit: int = MAX_BLOCK_WORDS) -> List[Dict[str, Any]]:
    """Pack sentences into script blocks of at most `limit` words (mechanical first pass)."""
    out: List[Dict[str, Any]] = []
    cur: List[str] = []
    for s in sentences(text):
        if cur and len(" ".join(cur + [s]).split()) > limit:
            out.append({"text": " ".join(cur)})
            cur = []
        cur.append(s)
    if cur:
        out.append({"text": " ".join(cur)})
    return out


def usable(proposals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """`source_transcript` is the English transcript reused as a proposal: never the French narration."""
    return [p for p in proposals if (p.get("prompt_type") or "") != "source_transcript"]


def pick(proposals: List[Dict[str, Any]], wanted: Optional[str]) -> Optional[Dict[str, Any]]:
    if not proposals:
        return None
    if not wanted:
        selected = [p for p in proposals if p.get("is_selected")]
        return selected[-1] if selected else None
    wanted = wanted.strip().lower()
    if wanted.isdigit():
        for p in proposals:
            if int(p.get("id") or 0) == int(wanted):
                return p
    for p in proposals:  # "classic" / "hook" live in prompt_type or title
        hay = f"{p.get('prompt_type') or ''} {p.get('title') or ''}".lower()
        if wanted in hay:
            return p
    return None


def main(argv: List[str]) -> int:
    if not argv or argv[0].startswith("-"):
        return int(bool(sys.stderr.write("usage: source_import.py <slug> --video <video_id> [--pick hook|classic|ID] [--apply]\n")))
    slug = argv[0]
    ep = proj.load_episode(slug)
    source = ep.get("source") or {}
    video_id = proj.arg(argv, "--video") or source.get("videoId")
    if not video_id:
        proj.result(ok=False, error="no video id: pass --video <video_id> or set source.videoId in episode.json")
        return 2

    want = proj.arg(argv, "--pick") or proj.arg(argv, "--proposal")
    script_mode = proj.arg(argv, "--script-mode", "narration") or "narration"
    model = proj.arg(argv, "--model")
    apply_script = "--apply" in argv
    want_generate = "--generate" in argv
    nv = Nouveau()

    try:
        info = nv.video(str(video_id))
    except NouveauError as e:
        proj.result(ok=False, error=f"video {video_id} unavailable: {e}", url=nv.base)
        return 3

    title = str(info.get("title") or info.get("name") or video_id)
    duration = info.get("duration_seconds") or info.get("duration")

    # 1. English transcript (deepgram) — only run when the video has none yet.
    check: Dict[str, Any] = {}
    try:
        check = nv.transcript_check(str(video_id), lang="en")
    except NouveauError as e:
        print(f"[source] transcript check failed ({e}); continuing", file=sys.stderr)
    transcript_state = "exists" if check.get("exists") else "missing"
    if transcript_state == "missing" or "--transcribe" in argv:
        try:
            nv.transcribe_video(str(video_id), lang="en", poll_sec=900)
            nv.save_transcript(str(video_id), lang="en")
            transcript_state = "transcribed"
        except NouveauError as e:
            proj.result(ok=False, error=f"transcription failed: {e}")
            return 4

    # 2. French narration proposals — reuse what nouveau already has unless asked to regenerate.
    proposals: List[Dict[str, Any]] = []
    try:
        proposals = list(nv.translations(str(video_id)).get("proposals") or [])
    except NouveauError as e:
        print(f"[source] could not list proposals ({e})", file=sys.stderr)
    if not usable(proposals):
        want_generate = True
    if want_generate or not proposals:
        print(f"[source] asking nouveau for 2 French narration proposals ({script_mode})", flush=True)
        try:
            fresh = list(nv.proposals(str(video_id), script_mode=script_mode, model=model).get("proposals") or [])
            proposals = fresh + [p for p in proposals if p not in fresh]
        except NouveauError as e:
            proj.result(ok=False, error=f"translation failed: {e}", videoId=video_id)
            return 5

    chosen = pick(usable(proposals) or proposals, want)
    if chosen is None and want:
        proj.result(
            ok=False,
            error=f"no proposal matching {want!r}",
            videoId=video_id,
            proposals=[{"id": p.get("id"), "prompt_type": p.get("prompt_type"), "title": p.get("title")} for p in proposals],
        )
        return 6

    payload: Dict[str, Any] = {
        "ok": True,
        "videoId": video_id,
        "title": title,
        "durationSeconds": duration,
        "transcript": transcript_state,
        "scriptMode": script_mode,
        "proposals": [
            {
                "id": p.get("id"),
                "prompt_type": p.get("prompt_type"),
                "title": p.get("title"),
                "words": len(str(p.get("translation") or "").split()),
                "excerpt": str(p.get("translation") or "")[:280],
            }
            for p in proposals
        ],
    }

    if chosen is not None:
        try:
            nv.select_proposal(str(video_id), chosen.get("id"))
        except NouveauError as e:
            print(f"[source] select failed ({e}); keeping text anyway", file=sys.stderr)
        text = str(chosen.get("translation") or "").strip()
        out = proj.out_dir(slug)
        (out / "source.fr.md").write_text(text + "\n", encoding="utf-8")
        source.update(
            {
                "provider": "nouveau",
                "videoId": video_id,
                "title": title,
                "url": info.get("url"),
                "durationSeconds": duration,
                "proposalId": chosen.get("id"),
                "promptType": chosen.get("prompt_type"),
                "model": chosen.get("model_name"),
                "chars": len(text),
                "words": len(text.split()),
                "updatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
            }
        )
        ep["source"] = source
        if apply_script:
            ep["script"] = blocks(text)
            source["appliedBlocks"] = len(ep["script"])
        proj.save_json(proj.ep_dir(slug) / "episode.json", ep)
        proj.save_json(out / "source.json", {**payload, "selected": source, "text": text})
        payload["scriptWords"] = source["words"]
        payload["applied"] = bool(apply_script)
        payload["blocks"] = len(ep.get("script") or [])
    else:
        proj.save_json(proj.out_dir(slug) / "source.json", payload)

    proj.result(**payload)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except NouveauError as exc:
        proj.result(ok=False, error=str(exc), url=exc.path)
        sys.exit(7)
