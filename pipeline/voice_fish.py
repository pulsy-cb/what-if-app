"""Step 2 for the nouveau route: the French voice, through the local TTS API (:8005, ElevenLabs v4 by default).

    python3 pipeline/voice_fish.py <slug> [--force] [--provider elevenlabs|fish] [--video <video_id>] [--voice <id>] [--model <id>] [--rate 1.0]

Reads  src/episodes/<slug>/episode.json  (script, voice, gaps, source.videoId)
Calls  POST /api/videos/<videoId>/tts/elevenlabs    -> the MP3 (default: ElevenLabs v4, Hugo/Léa), stored by nouveau under /downloads/tts/
   or  POST /api/videos/<videoId>/tts/fish          -> when provider is "fish"
       POST /api/videos/<videoId>/tts/transcribe    -> Deepgram word timings of that MP3
Writes public/<slug>/voice_raw.mp3, public/<slug>/voice.wav (pauses tightened),
       src/episodes/<slug>/words.json (script words + real times, used by plan.py), out/<slug>/words_raw.json,
       out/<slug>/voice_meta.json, and a costs.json line.
"""

from __future__ import annotations

import difflib
import hashlib
import re
import sys
import time
import unicodedata
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

import proj
from nouveau_client import (
    ELEVENLABS_MODEL,
    ELEVENLABS_MODELS,
    ELEVENLABS_SPEED,
    ELEVENLABS_VOICE,
    ELEVENLABS_VOICES,
    FISH_MODEL,
    FISH_VOICE,
    Nouveau,
    NouveauError,
    detect_narrator_voice,
    words_of,
)

SR = 44100
MIN_WORD = 0.06


# ---------------------------------------------------------------- text helpers
def bare(w: str) -> str:
    return re.sub(r"[^\w]", "", w)


def norm(w: str) -> str:
    s = unicodedata.normalize("NFKD", w.lower().replace("’", "'"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s) or w.lower().strip()


def decode(path) -> np.ndarray:
    """Any audio file to mono float64 at 44.1 kHz (ffmpeg, already in the image)."""
    import subprocess

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def write_wav(path, x: np.ndarray) -> None:
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


# ---------------------------------------------------------------- realignment
def realign(script: Sequence[Dict[str, str]], asr: Sequence[Dict[str, Any]], duration: float) -> List[Dict[str, Any]]:
    """Give every script word the time of its spoken counterpart.

    Equal blocks are matched exactly; words Fish said differently (numbers, names) or skipped get a
    proportional share of the gap between their spoken neighbours. Script text always wins.
    """
    a = [norm(w["w"]) for w in script]
    b = [norm(str(w["w"])) for w in asr]
    times: List[Optional[Tuple[float, float]]] = [None] * len(script)

    if not asr:
        total = sum(len(w["w"]) or 1 for w in script) or 1
        cursor = 0.0
        for i, w in enumerate(script):
            share = duration * (len(w["w"]) or 1) / total
            times[i] = (cursor, cursor + share)
            cursor += share
    else:
        sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
        cursor = 0.0

        def spread(lo: float, hi: float, idxs: Sequence[int]) -> None:
            if not idxs:
                return
            span = max(0.0, hi - lo)
            if span < len(idxs) * MIN_WORD:
                # not enough room for one minimum word each: share the slot evenly rather than overflow
                share = span / len(idxs)
                t = lo
                for i in idxs:
                    times[i] = (t, t + share)
                    t += share
                return
            weight = sum(len(script[i]["w"]) or 1 for i in idxs) or 1
            t = lo
            for i in idxs:
                share = span * (len(script[i]["w"]) or 1) / weight
                times[i] = (t, t + max(share, MIN_WORD))
                t += share

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    s = float(asr[j1 + k]["s"])
                    e = float(asr[j1 + k]["e"])
                    times[i1 + k] = (s, max(e, s + MIN_WORD))
                cursor = float(asr[j2 - 1]["e"])
            elif tag == "delete":  # words Fish did not say
                hi = float(asr[j1]["s"]) if j1 < len(asr) else duration
                spread(cursor, hi, list(range(i1, i2)))
            elif tag == "replace":
                lo = cursor
                hi = float(asr[j2]["s"]) if j2 < len(asr) else (float(asr[j2 - 1]["e"]) if j2 > j1 else duration)
                if j2 > j1:
                    hi = max(hi, float(asr[j2 - 1]["e"]))
                spread(lo, hi, list(range(i1, i2)))
                cursor = float(asr[j2 - 1]["e"]) if j2 > j1 else hi
            elif tag == "insert":  # words Fish added
                cursor = float(asr[j2 - 1]["e"]) if j2 > 0 else cursor

        # Any word still without a slot (leading/trailing mismatch) gets the remaining room.
        for i, w in enumerate(script):
            if times[i] is None:
                hi = duration
                for j in range(i + 1, len(script)):
                    if times[j] is not None:
                        hi = times[j][0]
                        break
                lo = 0.0
                for j in range(i - 1, -1, -1):
                    if times[j] is not None:
                        lo = times[j][1]
                        break
                times[i] = (lo, max(lo + MIN_WORD, min(hi, lo + 0.28)))

    out: List[Dict[str, Any]] = []
    prev = 0.0
    for i, w in enumerate(script):
        s, e = times[i] or (prev, prev + MIN_WORD)
        s = max(s, prev)
        e = max(e, s + MIN_WORD)
        out.append({"w": w["w"], "s": round(s, 3), "e": round(e, 3), "p": w.get("p", "")})
        prev = e

    # Never let a timing run past the audio (an ASR that stops early, or a mismatched tail).
    if out and duration > 0 and out[-1]["e"] > duration + 1e-3:
        k = duration / out[-1]["e"]
        for w in out:
            w["s"] = round(w["s"] * k, 3)
            w["e"] = round(w["e"] * k, 3)
    return out


# ---------------------------------------------------------------- pause tightening
def tighten(words: List[Dict[str, Any]], x: np.ndarray, gaps: Dict[str, Any]) -> Tuple[np.ndarray, List[Dict[str, Any]], float]:
    """Cut every silence longer than the genre allows (same rule as the skill's voice.py)."""
    G = {"word": 0.12, "comma": 0.2, "sentence": 0.3, "question": 0.45, "pairs": {}}
    G.update(gaps or {})
    cuts: List[Tuple[float, float]] = []
    for a_, b_ in zip(words, words[1:]):
        gap = b_["s"] - a_["e"]
        key = bare(a_["w"]) + "|" + bare(b_["w"])
        if key in G["pairs"]:
            keep = G["pairs"][key]
        elif "?" in a_["p"] or "!" in a_["p"]:
            keep = G["question"]
        elif any(ch in a_["p"] for ch in ".:;…"):
            keep = G["sentence"]
        elif any(ch in a_["p"] for ch in ",—-"):
            keep = G["comma"]
        else:
            keep = G["word"]
        if gap > keep:
            mid = (a_["e"] + b_["s"]) / 2
            rm = gap - keep
            cuts.append((mid - rm / 2, mid + rm / 2))

    parts: List[np.ndarray] = []
    last = 0.0
    for s, e in cuts:
        parts.append(x[int(last * SR) : int(s * SR)])
        last = e
    parts.append(x[int(last * SR) :])
    fade = int(0.004 * SR)
    for i, part in enumerate(parts):
        part = part.copy()
        if i > 0 and len(part) > fade:
            part[:fade] *= np.linspace(0, 1, fade)
        if i < len(parts) - 1 and len(part) > fade:
            part[-fade:] *= np.linspace(1, 0, fade)
        parts[i] = part
    y = np.concatenate(parts) if parts else x

    def shift(t: float) -> float:
        return t - sum(min(e, t) - s for s, e in cuts if t > s)

    out = [{"w": w["w"], "s": round(shift(w["s"]), 3), "e": round(shift(w["e"]), 3), "p": w.get("p", "")} for w in words]
    return y, out, sum(e - s for s, e in cuts)


# ---------------------------------------------------------------- main
def main(argv: List[str]) -> int:
    if not argv or argv[0].startswith("-"):
        sys.stderr.write("usage: voice_fish.py <slug> [--force] [--provider elevenlabs|fish] [--video ID] [--voice ID] [--model ID] [--rate 1.0]\n")
        return 2
    slug = argv[0]
    force = "--force" in argv
    ep = proj.load_episode(slug)
    source = ep.get("source") or {}
    video_id = proj.arg(argv, "--video") or source.get("videoId")
    if not video_id:
        proj.result(
            ok=False,
            error="no source video id: the TTS must be attached to a nouveau video (episode.json source.videoId, or --video)",
        )
        return 2

    V: Dict[str, Any] = {
        "provider": "elevenlabs",
        "voiceId": ELEVENLABS_VOICE,
        "modelId": ELEVENLABS_MODEL,
        "speakingRate": ELEVENLABS_SPEED,
        "stability": 0.5,
        "similarityBoost": 0.75,
        "style": 0.0,
        "useSpeakerBoost": True,
    }
    ep_voice = dict(ep.get("voice") or {})
    if ep_voice.get("speakingRate") in (None, 1, 1.0) and "speed" not in ep_voice:
        ep_voice["speakingRate"] = ELEVENLABS_SPEED
    V.update(ep_voice)
    if proj.arg(argv, "--provider"):
        V["provider"] = proj.arg(argv, "--provider")
    if proj.arg(argv, "--voice"):
        V["voiceId"] = proj.arg(argv, "--voice")
    if proj.arg(argv, "--model"):
        V["modelId"] = proj.arg(argv, "--model")
    if proj.arg(argv, "--rate") or proj.arg(argv, "--speed"):
        V["speakingRate"] = float(proj.arg(argv, "--rate") or proj.arg(argv, "--speed") or ELEVENLABS_SPEED)
    if proj.arg(argv, "--stability"):
        V["stability"] = float(proj.arg(argv, "--stability") or 0.5)
    if proj.arg(argv, "--similarity"):
        V["similarityBoost"] = float(proj.arg(argv, "--similarity") or 0.75)
    if proj.arg(argv, "--style"):
        V["style"] = float(proj.arg(argv, "--style") or 0.0)

    raw_provider = str(V.get("provider") or "elevenlabs").strip().lower()
    if raw_provider in ("", "elevenlabs", "eleven", "nouveau", "default"):
        provider = "elevenlabs"
    elif raw_provider == "fish":
        provider = "fish"
    else:
        proj.result(
            ok=False,
            error=f"voice.provider={V['provider']!r}: supported providers on :8005 are 'elevenlabs' (default) and 'fish'",
        )
        return 2

    if provider == "elevenlabs":
        raw_voice = str(V.get("voiceId") or "").strip()
        V["voiceId"] = ELEVENLABS_VOICES.get(raw_voice, ELEVENLABS_VOICES.get(raw_voice.lower(), ELEVENLABS_VOICE))
        raw_model = str(V.get("modelId") or "").strip()
        V["modelId"] = raw_model if raw_model in ELEVENLABS_MODELS else ELEVENLABS_MODEL
        V["provider"] = "elevenlabs"
    else:
        if not V.get("voiceId") or V.get("voiceId") in ELEVENLABS_VOICES.values():
            V["voiceId"] = FISH_VOICE
        if not V.get("modelId") or V.get("modelId") in ELEVENLABS_MODELS:
            V["modelId"] = FISH_MODEL
        V["provider"] = "fish"

    text = proj.flat_script(ep)
    if not text:
        proj.result(ok=False, error="episode.json has no script text")
        return 2

    # Auto-detect narrator gender & voice from script phrasing (and source.fr.md fallback)
    # unless --voice was passed explicitly or episode.json voice.locked is true.
    voice_det: Optional[Dict[str, Any]] = None
    if provider == "elevenlabs" and not proj.arg(argv, "--voice") and not ep_voice.get("locked"):
        title_str = " ".join(ep.get("title") or []) if isinstance(ep.get("title"), list) else str(ep.get("topic") or "")
        voice_det = detect_narrator_voice(text, title_str)
        if voice_det["femaleScore"] == 0 and voice_det["maleScore"] == 0:
            src_md = proj.out_dir(slug) / "source.fr.md"
            if src_md.exists():
                voice_det = detect_narrator_voice(src_md.read_text(encoding="utf-8", errors="ignore"), title_str)
        if voice_det["femaleScore"] > 0 or voice_det["maleScore"] > 0 or not ep_voice.get("narratorGender"):
            V["voiceId"] = voice_det["voiceId"]
            if ep_voice.get("voiceId") != voice_det["voiceId"] or ep_voice.get("narratorGender") != voice_det["gender"]:
                ep_voice["voiceId"] = voice_det["voiceId"]
                ep_voice["voiceName"] = voice_det["voiceName"]
                ep_voice["narratorGender"] = voice_det["gender"]
                ep["voice"] = ep_voice
                proj.save_json(proj.ep_dir(slug) / "episode.json", ep)
                print(
                    f"[voice] auto-selected {voice_det['voiceName']} ({voice_det['gender']}, {voice_det['voiceId']}) "
                    f"[F={voice_det['femaleScore']} M={voice_det['maleScore']}]",
                    flush=True,
                )

    script = proj.split_words(text)
    sig = hashlib.sha1(
        (proj.STUDIO.name + json_dumps([text, V, video_id])).encode("utf-8")
    ).hexdigest()[:12]

    raw_mp3 = proj.pub_dir(slug) / "voice_raw.mp3"
    raw_words_path = proj.out_dir(slug) / "words_raw.json"
    meta_path = proj.out_dir(slug) / "voice_meta.json"
    meta = proj.load_json(meta_path, {}) or {}
    nv = Nouveau()

    if force or meta.get("sig") != sig or not raw_mp3.exists() or not raw_words_path.exists():
        label = "ElevenLabs" if provider == "elevenlabs" else "Fish Audio"
        print(f"[voice] {len(text)} chars -> {label} {V['modelId']} ({V['voiceId']}) for video {video_id}", flush=True)
        t0 = time.time()
        try:
            if provider == "elevenlabs":
                res = nv.tts_elevenlabs(
                    str(video_id),
                    text,
                    voice_id=str(V["voiceId"]),
                    model_id=str(V["modelId"]),
                    speed=float(V.get("speakingRate") or V.get("speed") or ELEVENLABS_SPEED),
                    stability=float(V.get("stability") if V.get("stability") is not None else 0.5),
                    similarity_boost=float(V.get("similarityBoost") if V.get("similarityBoost") is not None else 0.75),
                    style=float(V.get("style") if V.get("style") is not None else 0.0),
                    use_speaker_boost=bool(V.get("useSpeakerBoost", True)),
                    proposal_id=source.get("proposalId"),
                )
            else:
                res = nv.tts_fish(
                    str(video_id),
                    proj.strip_tts_tags(text),
                    voice_id=str(V["voiceId"]),
                    model_id=str(V["modelId"]),
                    speaking_rate=float(V.get("speakingRate") or 1.0),
                    proposal_id=source.get("proposalId"),
                )
        except NouveauError as e:
            proj.result(ok=False, error=f"TTS ({provider}) failed: {e}", videoId=video_id, provider=provider)
            return 3
        audio_path = str(res.get("audioPath") or "")
        if not audio_path:
            proj.result(ok=False, error="TTS returned no audioPath", response=res)
            return 3
        try:
            audio = nv.fetch(audio_path)
        except NouveauError as e:
            proj.result(ok=False, error=f"could not download {audio_path}: {e}")
            return 3
        raw_mp3.write_bytes(audio)
        x = decode(raw_mp3)
        duration = len(x) / SR

        # Transcribe the take via Deepgram on :8005, then realign it on the script words.
        asr: List[Dict[str, Any]] = []
        asr_source = "deepgram"
        try:
            tr = nv.tts_transcribe(str(video_id), audio, lang=str(ep.get("lang") or "fr"))
            asr = words_of(tr.get("transcript") or tr.get("segments") or [])
        except NouveauError as e:
            print(f"[voice] TTS transcription unavailable ({e}); falling back to a proportional timeline", file=sys.stderr)
            asr_source = "proportional"
        if not asr:
            asr_source = "proportional"
            print("[voice] no ASR words: spreading the script proportionally over the audio", file=sys.stderr)

        words = realign(script, asr, duration)
        proj.save_json(raw_words_path, words)
        proj.save_json(
            meta_path,
            {
                "sig": sig,
                "chars": len(text),
                "provider": provider,
                "modelId": V["modelId"],
                "voiceId": V["voiceId"],
                "speakingRate": V.get("speakingRate"),
                "videoId": video_id,
                "audioPath": audio_path,
                "ttsId": res.get("id"),
                "durationRaw": round(duration, 3),
                "asr": asr_source,
                "words": len(words),
                "elapsedSec": round(time.time() - t0, 2),
            },
        )
        costs = proj.load_json(proj.out_dir(slug) / "costs.json", []) or []
        costs.append(
            {
                "step": "voice",
                "credits": len(text) if provider == "elevenlabs" else 0,
                "note": f"{provider}:{V['modelId']} {len(text)} chars, video {video_id}" + ("" if asr_source == "deepgram" else " (proportional timings)"),
                "provider": provider,
                "model": V["modelId"],
                "voice": V["voiceId"],
                "chars": len(text),
            }
        )
        proj.save_json(proj.out_dir(slug) / "costs.json", costs)
    else:
        print("[voice] text and voice unchanged: reusing the last take (no API call)")

    words = proj.load_json(raw_words_path)
    x = decode(raw_mp3)
    y, out, removed = tighten(words, x, ep.get("gaps") or {})
    write_wav(proj.pub_dir(slug) / "voice.wav", y)
    proj.save_json(proj.ep_dir(slug) / "words.json", out)

    print(f"[voice] tightened {removed:.2f} s of silence: {len(x) / SR:.2f} s -> {len(y) / SR:.2f} s")
    proj.result(
        ok=True,
        slug=slug,
        videoId=video_id,
        provider=provider,
        modelId=V["modelId"],
        voiceId=V["voiceId"],
        chars=len(text),
        words=len(out),
        duration=round(len(y) / SR, 3),
        voiceWav=f"public/{slug}/voice.wav",
        wordsJson=f"src/episodes/{slug}/words.json",
        meta=proj.load_json(meta_path, {}),
    )
    return 0


def json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, sort_keys=True, ensure_ascii=False)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except NouveauError as exc:
        proj.result(ok=False, error=str(exc), path=exc.path)
        sys.exit(7)
