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
import os
import sys
from typing import Any, Dict, List, Optional

import proj
from nouveau_client import (
    ELEVENLABS_MODEL,
    ELEVENLABS_SPEED,
    ELEVENLABS_VOICE,
    FISH_MODEL,
    FISH_VOICE,
    Nouveau,
    NouveauError,
    detect_narrator_voice,
)

MAX_BLOCK_WORDS = 22


def clean_french_spacing(text: str) -> str:
    """Fix spurious spaces around hyphens in French subject-verb inversions ('a- t- elle' -> 'a-t-elle', 'ai- je' -> 'ai-je')."""
    s = re.sub(r"\b([A-Za-zÀ-ÖØ-öø-ÿ]+)-\s+t-\s+(il|elle|on|ils|elles)\b", r"\1-t-\2", text, flags=re.IGNORECASE)
    s = re.sub(
        r"\b([A-Za-zÀ-ÖØ-öø-ÿ]+)-\s+(je|tu|il|elle|on|nous|vous|ils|elles|ce|la|le|les|moi|toi|lui|leur|nous|vous|y|en)\b",
        r"\1-\2",
        s,
        flags=re.IGNORECASE,
    )
    return s


def sentences(text: str) -> List[str]:
    cleaned = clean_french_spacing(text)
    parts = re.split(r"(?<=[.!?…])\s+", cleaned.replace("\n", " ").strip())
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


def make_title_lines(raw_title: str) -> List[str]:
    """Turn a French proposal title into two short uppercase title-card lines."""
    clean = re.sub(r"\s+", " ", (raw_title or "").strip()).upper()
    words = clean.split()
    if not words:
        return ["HISTOIRE VRAIE", "…"]
    if len(words) <= 4:
        mid = max(1, len(words) // 2)
        return [" ".join(words[:mid]), " ".join(words[mid:]) or "…"]
    short = words[:7]
    mid = max(2, len(short) // 2)
    return [" ".join(short[:mid]), " ".join(short[mid:])]


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

    want = proj.arg(argv, "--pick") or proj.arg(argv, "--proposal") or "hook"
    script_mode = proj.arg(argv, "--script-mode", "elevenlabs") or "elevenlabs"
    # Try the requested model first, then fallback models on :8005 if a provider is temporarily out of quota
    primary_model = proj.arg(argv, "--model") or os.environ.get("WHATIF_NARRATION_MODEL") or "deepseek/deepseek-v4-flash-0731"
    fallback_models = [
        m
        for m in [primary_model, "deepseek/deepseek-v4-flash-0731", "agy/gemini-3.8-flash-medium", "gemma4:cloud"]
        if m
    ]
    model_candidates: List[str] = []
    for m in fallback_models:
        if m not in model_candidates:
            model_candidates.append(m)
    # By default, apply the chosen server translation proposal directly to episode.json.script so it is never shortened
    apply_script = "--no-apply" not in argv
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
        last_err: Optional[Exception] = None
        for cand_model in model_candidates:
            print(f"[source] asking nouveau for French narration proposals ({script_mode}, model={cand_model})", flush=True)
            try:
                fresh = list(nv.proposals(str(video_id), script_mode=script_mode, model=cand_model).get("proposals") or [])
                if fresh:
                    proposals = fresh + [p for p in proposals if p not in fresh]
                    last_err = None
                    break
            except NouveauError as e:
                last_err = e
                print(f"[source] translate/generate with {cand_model} failed ({e}); trying next model...", file=sys.stderr)
        if not proposals and last_err is not None:
            print(f"[source] all translation models failed ({last_err}); falling back to transcript", file=sys.stderr)
            try:
                segs = nv.transcript(str(video_id), lang="en")
                if isinstance(segs, dict):
                    segs = segs.get("transcript") or segs.get("segments") or []
                en_text = " ".join(
                    str(s.get("text") or "").strip()
                    for s in (segs or [])
                    if isinstance(s, dict) and str(s.get("text") or "").strip()
                )
                if en_text:
                    proposals = [
                        {
                            "id": None,
                            "prompt_type": "transcript_fallback",
                            "title": title,
                            "model_name": "deepgram-en",
                            "translation": en_text,
                        }
                    ]
            except Exception:
                pass
            if not proposals:
                proj.result(ok=False, error=f"translation failed: {last_err}", videoId=video_id)
                return 5

    pool = usable(proposals)
    chosen = pick(pool or proposals, want)
    fell_back = False
    if chosen is None and want:
        # nouveau may only have a plain translation for this video: a wanted *kind* is a preference,
        # not a requirement — an episode without a source is worse than a non-hooky one.
        chosen = (pool or proposals)[0] if (pool or proposals) else None
        fell_back = chosen is not None
    if chosen is None:
        proj.result(ok=False, error="no French proposal available", videoId=video_id,
                    proposals=[{"id": p.get("id"), "prompt_type": p.get("prompt_type"), "title": p.get("title")} for p in proposals])
        return 6

    payload: Dict[str, Any] = {
        "ok": True,
        "videoId": video_id,
        "title": title,
        "durationSeconds": duration,
        "transcript": transcript_state,
        "scriptMode": script_mode,
        "pickedFallback": fell_back,
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
        if chosen.get("id") is not None:
            try:
                nv.select_proposal(str(video_id), chosen.get("id"))
            except NouveauError as e:
                print(f"[source] select failed ({e}); keeping text anyway", file=sys.stderr)
        text = clean_french_spacing(str(chosen.get("translation") or "").strip())
        out = proj.out_dir(slug)
        (out / "source.fr.md").write_text(text + "\n", encoding="utf-8")
        voice_det = detect_narrator_voice(text, str(chosen.get("title") or title))
        existing_tts: Dict[str, Any] = {}
        try:
            tts_chk = nv.tts_check(str(video_id))
            if tts_chk.get("exists") and tts_chk.get("file_exists") and tts_chk.get("path"):
                existing_tts = tts_chk
                raw_v = str(tts_chk.get("voice") or "")
                if ":" in raw_v:
                    _, srv_vid = raw_v.split(":", 1)
                    if srv_vid == "KSyQzmsYhFbuOhqj1Xxv":
                        voice_det = {**voice_det, "gender": "female", "voiceId": srv_vid, "voiceName": "Léa"}
                    elif srv_vid == "3Tp5mYhT9wrfnry9pzvV":
                        voice_det = {**voice_det, "gender": "male", "voiceId": srv_vid, "voiceName": "Hugo"}
                print(
                    f"[source] existing TTS audio found on :8005 ({tts_chk.get('path')}, voice={tts_chk.get('voice')}, "
                    f"duration={tts_chk.get('duration_seconds')}s) — voice step will reuse it automatically",
                    flush=True,
                )
        except NouveauError:
            pass
        print(
            f"[source] narrator gender analysis -> {voice_det['gender']} ({voice_det['voiceName']} {voice_det['voiceId']}, "
            f"F={voice_det['femaleScore']} M={voice_det['maleScore']})",
            flush=True,
        )
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
                "narratorGender": voice_det["gender"],
                "recommendedVoiceId": voice_det["voiceId"],
                "recommendedVoiceName": voice_det["voiceName"],
                "existingTts": existing_tts or None,
                "updatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
            }
        )
        ep["source"] = source
        voice_cfg = dict(ep.get("voice") or {})
        if not voice_cfg.get("locked") and voice_cfg.get("provider", "elevenlabs") != "fish":
            ep["voice"] = {
                **voice_cfg,
                "provider": "elevenlabs",
                "voiceId": voice_det["voiceId"],
                "voiceName": voice_det["voiceName"],
                "narratorGender": voice_det["gender"],
                "modelId": voice_cfg.get("modelId") or ELEVENLABS_MODEL,
                "speakingRate": voice_cfg.get("speakingRate") or ELEVENLABS_SPEED,
            }
        elif not voice_cfg or (voice_cfg.get("provider") == "fish" and voice_cfg.get("voiceId") == FISH_VOICE):
            ep["voice"] = {
                "provider": "elevenlabs",
                "voiceId": voice_det["voiceId"],
                "voiceName": voice_det["voiceName"],
                "narratorGender": voice_det["gender"],
                "modelId": ELEVENLABS_MODEL,
                "speakingRate": ELEVENLABS_SPEED,
            }
        if apply_script:
            ep["script"] = blocks(text)
            source["appliedBlocks"] = len(ep["script"])
            chosen_title = str(chosen.get("title") or title).strip()
            if chosen_title:
                ep["topic"] = chosen_title
                cur_title = ep.get("title")
                if not cur_title or cur_title == ["ET SI TU POUVAIS", "… ?"]:
                    ep["title"] = make_title_lines(chosen_title)
            # Clear placeholder TODO science entries on imported narrative videos
            sci = ep.get("science")
            if isinstance(sci, list) and any("TODO" in str(s) for s in sci):
                ep["science"] = []
        proj.save_json(proj.ep_dir(slug) / "episode.json", ep)
        proj.save_json(out / "source.json", {**payload, "selected": source, "text": text, "narratorVoice": voice_det})
        payload["scriptWords"] = source["words"]
        payload["applied"] = bool(apply_script)
        payload["blocks"] = len(ep.get("script") or [])
        payload["narratorVoice"] = voice_det
        if existing_tts:
            payload["existingTts"] = existing_tts
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
