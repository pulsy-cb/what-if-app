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
    detect_text_language,
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


def decode_bytes(raw_audio: bytes) -> np.ndarray:
    """Decode encoded audio bytes in memory to mono float64 at 44.1 kHz before writing validated cache files."""
    import subprocess

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        input=raw_audio,
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


VALIDATED_CORRESPONDENCES = {"declared_text_and_asr"}
WORD_GUARANTEE_DECLARED_ASR = "declared_association_and_asr_only"
WORD_GUARANTEE_NOTE = (
    "Correspondence reflects declared text association and/or normalized ASR word alignment only; "
    "never an integral guarantee of all spoken words, homophones, inflection, or prosody."
)


def write_wav(path, x: np.ndarray) -> None:
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


TEMPO_MIN, TEMPO_MAX = 0.8, 1.5
# Every new narration is played 1.3 times faster (Pulsy, 2026-11-19: "1,3 partout"): 3.5 words/s becomes 4.5, the pace of
# the videos of the channel that hold their viewers best.
TEMPO_DEFAULT = 1.3


def voice_tempo(argv: Sequence[str], ep_voice: Dict[str, Any], has_take: bool = False) -> float:
    """How fast the finished take is played: --tempo, then episode.json voice.tempo; an episode voiced before the tempo
    existed stays at 1 (its shots are cut on those word times); a new one takes WHATIF_VOICE_TEMPO, then TEMPO_DEFAULT.

    ElevenLabs stops at speed 1.2 and that setting barely moves eleven_v4 (2026-11-19: 24.0 s at 1.15, 24.4 s at 1.2
    for the same 76 words), so a faster narration is made here, after the take, where it costs no credit.
    """
    import os

    raw = proj.arg(list(argv), "--tempo") or ep_voice.get("tempo") or (1.0 if has_take else os.environ.get("WHATIF_VOICE_TEMPO") or TEMPO_DEFAULT)
    try:
        tempo = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"voice tempo {raw!r} is not a number (expected {TEMPO_MIN} to {TEMPO_MAX}, 1 = unchanged)")
    if not (TEMPO_MIN <= tempo <= TEMPO_MAX):
        raise ValueError(f"voice tempo {tempo} is out of range (expected {TEMPO_MIN} to {TEMPO_MAX}, 1 = unchanged)")
    return tempo


def retime(y: np.ndarray, words: List[Dict[str, Any]], tempo: float) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
    """Play the take faster or slower at the same pitch (ffmpeg atempo); the word times follow the audio."""
    import subprocess

    if abs(tempo - 1.0) < 0.005 or not len(y):
        return y, words
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af", f"atempo={tempo:.4f}", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        input=y.astype("<f4").tobytes(),
        capture_output=True,
        check=True,
    ).stdout
    z = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    k = len(z) / len(y)  # the measured ratio, not 1 / tempo: the last word must still end inside the audio
    return z, [{**w, "s": round(w["s"] * k, 3), "e": round(w["e"] * k, 3)} for w in words]


def text_norm_sig(s: str) -> str:
    cleaned = re.sub(r"\s+", " ", proj.strip_tts_tags(s or "")).strip()
    return hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:12] if cleaned else ""


def text_raw_sig(s: str) -> str:
    cleaned = re.sub(r"\s+", " ", s or "").strip()
    return hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:12] if cleaned else ""


def edited_word_indices(baseline_text: str, current_norms: Sequence[str]) -> List[int]:
    base_norms = [norm(w["w"]) for w in proj.split_words(baseline_text) if norm(w["w"])]
    if not base_norms:
        return list(range(len(current_norms)))
    sm = difflib.SequenceMatcher(None, base_norms, list(current_norms), autojunk=False)
    changed: List[int] = []
    for tag, _i1, _i2, j1, j2 in sm.get_opcodes():
        if tag in ("replace", "insert"):
            changed.extend(range(j1, j2))
    return changed


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
        sys.stderr.write("usage: voice_fish.py <slug> [--force] [--require-exact] [--provider elevenlabs|fish] [--video ID] [--voice ID] [--model ID] [--rate 1.0] [--tempo 1.3]\n")
        return 2
    import os

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
    require_exact = (
        "--require-exact" in argv
        or os.environ.get("WHATIF_VOICE_REQUIRE_EXACT") == "1"
        or bool(ep_voice.get("requireExact"))
    )
    if ep_voice.get("speakingRate") in (None, 1, 1.0) and "speed" not in ep_voice:
        ep_voice["speakingRate"] = ELEVENLABS_SPEED
    V.update(ep_voice)
    # The tempo and requireExact flags stay out of V so changing them never alters the raw take signature.
    V.pop("tempo", None)
    V.pop("requireExact", None)
    try:
        tempo = voice_tempo(argv, ep_voice, has_take=(proj.pub_dir(slug) / "voice.wav").exists())
    except ValueError as e:
        proj.result(ok=False, error=str(e))
        return 2
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

    # Auto-detect language, narrator gender & voice from script phrasing (and source.fr.md fallback)
    # unless --voice was passed explicitly or episode.json voice.locked is true.
    title_str = " ".join(ep.get("title") or []) if isinstance(ep.get("title"), list) else str(ep.get("topic") or "")
    detected_lang = str(proj.arg(argv, "--lang") or "").strip().lower()
    if detected_lang not in ("fr", "en"):
        detected_lang = detect_text_language(f"{title_str}\n{text}")
    ep_lang = str(ep.get("lang") or source.get("lang") or detected_lang or "fr").strip().lower()
    if ep_lang not in ("fr", "en") or (not ep_voice.get("locked") and not proj.arg(argv, "--lang") and ep.get("lang") != detected_lang):
        ep_lang = detected_lang
    ep_dirty = False
    if ep.get("lang") != ep_lang:
        ep["lang"] = ep_lang
        ep_dirty = True

    voice_det: Optional[Dict[str, Any]] = None
    explicit_voice = bool(proj.arg(argv, "--voice"))
    if provider == "elevenlabs" and not explicit_voice and not ep_voice.get("locked"):
        voice_det = detect_narrator_voice(text, title_str)
        if voice_det["femaleScore"] == 0 and voice_det["maleScore"] == 0:
            src_md = proj.out_dir(slug) / "source.fr.md"
            if src_md.exists():
                voice_det = detect_narrator_voice(src_md.read_text(encoding="utf-8", errors="ignore"), title_str)
        has_explicit_ep_voice = bool(str(ep_voice.get("voiceId") or "").strip())
        if (
            voice_det["femaleScore"] > 0
            or voice_det["maleScore"] > 0
            or (not ep_voice.get("narratorGender") and not has_explicit_ep_voice)
        ):
            V["voiceId"] = voice_det["voiceId"]
            detected_pov = voice_det.get("pov", "first")
            if (
                ep_voice.get("voiceId") != voice_det["voiceId"]
                or ep_voice.get("narratorGender") != voice_det["gender"]
                or ep_voice.get("narratorPov") != detected_pov
                or ep_voice.get("lang") != ep_lang
            ):
                ep_voice["voiceId"] = voice_det["voiceId"]
                ep_voice["voiceName"] = voice_det["voiceName"]
                ep_voice["narratorGender"] = voice_det["gender"]
                ep_voice["narratorPov"] = detected_pov
                ep_voice["lang"] = ep_lang
                ep["voice"] = ep_voice
                ep_dirty = True
                print(
                    f"[voice] auto-selected {voice_det['voiceName']} (lang={ep_lang}, {voice_det['gender']}/{detected_pov}, {voice_det['voiceId']}) "
                    f"[F={voice_det['femaleScore']} M={voice_det['maleScore']}]",
                    flush=True,
                )
    if (ep.get("voice") or {}).get("tempo") != tempo:
        # always kept in the episode: a later run of this step must give the same audio and the same word times
        ep["voice"] = {**(ep.get("voice") or {}), "tempo": tempo}
        ep_dirty = True
    if ep_dirty:
        proj.save_json(proj.ep_dir(slug) / "episode.json", ep)

    script = proj.split_words(text)
    text_sig = text_norm_sig(text)
    raw_text_sig = text_raw_sig(text)
    baseline_texts: List[str] = []
    for cand_file in (proj.out_dir(slug) / "script.orig.md", proj.out_dir(slug) / "source.fr.md"):
        if cand_file.is_file():
            bt = cand_file.read_text(encoding="utf-8", errors="ignore").strip()
            if bt:
                baseline_texts.append(bt)
    src_json = proj.load_json(proj.out_dir(slug) / "source.json", {}) or {}
    if isinstance(src_json, dict) and str(src_json.get("text") or "").strip():
        baseline_texts.append(str(src_json["text"]).strip())
    baseline_norm_sigs = {text_norm_sig(bt) for bt in baseline_texts if text_norm_sig(bt)}
    baseline_raw_sigs = {text_raw_sig(bt) for bt in baseline_texts if text_raw_sig(bt)}
    card_data = proj.load_json(proj.out_dir(slug) / "script-card.json", {}) or {}
    check_data = proj.load_json(proj.out_dir(slug) / "script-check.json", {}) or {}
    card_fixed = card_data.get("verdict") == "fix" or check_data.get("verdict") == "fix"

    sig_payload = [text, V, video_id] + ([ep_lang] if ep_lang != "fr" else [])
    sig = hashlib.sha1(
        (proj.STUDIO.name + json_dumps(sig_payload)).encode("utf-8")
    ).hexdigest()[:12]

    raw_mp3 = proj.pub_dir(slug) / "voice_raw.mp3"
    raw_words_path = proj.out_dir(slug) / "words_raw.json"
    meta_path = proj.out_dir(slug) / "voice_meta.json"
    meta = proj.load_json(meta_path, {}) or {}
    nv = Nouveau()

    cache_has_files = (
        not force
        and meta.get("sig") == sig
        and raw_mp3.exists()
        and raw_words_path.exists()
    )
    cache_strict_valid = (
        cache_has_files
        and meta.get("exactMatch") is True
        and meta.get("asrValidated") is True
        and meta.get("asr") == "deepgram"
        and meta.get("alignmentCoverage") == 1.0
        and meta.get("correspondence") in VALIDATED_CORRESPONDENCES
        and meta.get("integralWordsGuaranteed") is False
    )
    use_local_cache = cache_strict_valid if require_exact else cache_has_files

    if not use_local_cache:
        if cache_has_files and require_exact:
            print(
                f"[voice] rejecting local cache under --require-exact "
                f"(exactMatch={meta.get('exactMatch')!r}, correspondence={meta.get('correspondence')!r}, asr={meta.get('asr')!r}): re-validating",
                flush=True,
            )
        t0 = time.time()
        reused_from_server = False
        text_association = "none"
        correspondence = "unverified"
        exact_match = False
        asr_validated = False
        word_guarantee = "unverified"
        asr_coverage: Optional[float] = None
        estimation_warning: Optional[str] = None
        res: Dict[str, Any] = {}
        audio_path = ""
        prefetched_audio: Optional[bytes] = None
        prefetched_asr: Optional[List[Dict[str, Any]]] = None
        skipped_server_audio: Optional[Dict[str, Any]] = None
        explicit_regen_authorized = bool(force or explicit_voice)

        spoken_diverged = bool(baseline_norm_sigs and any(bs != text_sig for bs in baseline_norm_sigs)) or bool(
            meta.get("text_sig") and meta.get("text_sig") != text_sig
        )
        raw_diverged = (
            spoken_diverged
            or card_fixed
            or bool(baseline_raw_sigs and any(rs != raw_text_sig for rs in baseline_raw_sigs))
        )
        initial_tts = source.get("existingTts") if isinstance(source.get("existingTts"), dict) else {}

        if not force:
            try:
                chk = nv.tts_check(str(video_id))
            except NouveauError as e:
                if require_exact:
                    reason = f"strict exact mode cannot verify :8005 audio state (tts/check unavailable: {e}); refusing unapproved regeneration"
                    proj.result(
                        ok=False,
                        error=reason,
                        videoId=video_id,
                        correspondence="unverified_server_unreachable",
                        textAssociation="none",
                        asrValidated=False,
                        exactMatch=False,
                        wordGuarantee="unverified",
                        integralWordsGuaranteed=False,
                        guaranteeNote=WORD_GUARANTEE_NOTE,
                    )
                    return 4
                chk = {}
            if chk.get("exists") and chk.get("file_exists") and chk.get("path"):
                raw_voice_tag = str(chk.get("voice") or "").strip()
                srv_prov, srv_vid = raw_voice_tag.split(":", 1) if ":" in raw_voice_tag else (raw_voice_tag, "")
                chk_path_str = str(chk["path"])
                chk_text = str(chk.get("text") or chk.get("script") or "").strip()
                chk_norm_sig = text_norm_sig(chk_text) if chk_text else ""
                chk_raw_sig = text_raw_sig(chk_text) if chk_text else ""
                same_as_initial_upload = raw_voice_tag == "upload" and bool(initial_tts) and (
                    (initial_tts.get("id") is not None and chk.get("id") == initial_tts.get("id"))
                    or (initial_tts.get("path") and str(initial_tts.get("path")) == chk_path_str)
                )
                same_as_meta_take = (
                    bool(meta.get("audioPath"))
                    and str(meta.get("audioPath")) == chk_path_str
                    and (not meta.get("ttsId") or not chk.get("id") or meta.get("ttsId") == chk.get("id"))
                )
                can_reuse = False

                if raw_voice_tag == "upload":
                    if explicit_voice:
                        skipped_server_audio = {
                            "status": "mismatch",
                            "reason": f"explicit --voice {V['voiceId']} requested instead of :8005 upload",
                            "voice": raw_voice_tag,
                            "path": chk_path_str,
                        }
                    elif chk_text:
                        has_cues = "[" in text and "]" in text
                        want_upload_match = (chk_raw_sig == raw_text_sig) if has_cues else (chk_norm_sig == text_sig)
                        if want_upload_match:
                            # Associated server text is ONLY a declared association: ASR validation is still mandatory below.
                            can_reuse = True
                            text_association = "server_declared_text"
                            correspondence = "declared_text_pending_asr"
                            exact_match = False
                        else:
                            skipped_server_audio = {
                                "status": "mismatch",
                                "reason": "uploaded audio declared text on :8005 differs from episode.json.script",
                                "voice": raw_voice_tag,
                                "path": chk_path_str,
                            }
                    elif spoken_diverged and (same_as_initial_upload or same_as_meta_take):
                        skipped_server_audio = {
                            "status": "mismatch",
                            "reason": "episode.json.script was modified after this :8005 upload was attached; refusing to align edited words onto old audio",
                            "voice": raw_voice_tag,
                            "path": chk_path_str,
                        }
                    elif raw_diverged and not spoken_diverged:
                        skipped_server_audio = {
                            "status": "unprovable",
                            "reason": "script acting tags/markup changed from baseline; ASR cannot prove uploaded audio without text matches updated cues",
                            "voice": raw_voice_tag,
                            "path": chk_path_str,
                        }
                    else:
                        # Estimate correspondence of the textless uploaded audio via word-level ASR (never treated as exact identity)
                        try:
                            cand_audio = nv.fetch(chk_path_str)
                            cand_tr = nv.tts_transcribe(str(video_id), cand_audio, lang=ep_lang)
                        except NouveauError as e:
                            skipped_server_audio = {
                                "status": "unprovable",
                                "reason": f"cannot validate :8005 uploaded audio against script (ASR transcription unavailable: {e})",
                                "voice": raw_voice_tag,
                                "path": chk_path_str,
                            }
                        else:
                            segs = cand_tr.get("transcript") or cand_tr.get("segments") or []
                            cand_asr = words_of(segs)
                            asr_norms = [norm(str(w["w"])) for w in cand_asr if norm(str(w["w"]))]
                            script_norms = [norm(w["w"]) for w in script if norm(w["w"])]
                            if not asr_norms or not script_norms:
                                skipped_server_audio = {
                                    "status": "unprovable",
                                    "reason": "cannot evaluate :8005 uploaded audio without word-level ASR timings",
                                    "voice": raw_voice_tag,
                                    "path": chk_path_str,
                                }
                            else:
                                sm = difflib.SequenceMatcher(None, script_norms, asr_norms, autojunk=False)
                                blocks_eq = [b for b in sm.get_matching_blocks() if b.size > 0]
                                matched = sum(b.size for b in blocks_eq)
                                coverage = matched / max(1, max(len(script_norms), len(asr_norms)))
                                len_ratio = len(asr_norms) / max(1, len(script_norms))
                                eq_script_idxs = {i for b in blocks_eq for i in range(b.a, b.a + b.size)}
                                head_win = min(3, len(script_norms))
                                tail_start = max(0, len(script_norms) - 3)
                                head_tail_ok = any(i in eq_script_idxs for i in range(head_win)) and any(
                                    i in eq_script_idxs for i in range(tail_start, len(script_norms))
                                )
                                edited_idxs = (
                                    edited_word_indices(baseline_texts[0], script_norms)
                                    if (spoken_diverged and baseline_texts)
                                    else []
                                )
                                edited_hit = (
                                    sum(1 for i in edited_idxs if i in eq_script_idxs) / len(edited_idxs)
                                    if edited_idxs
                                    else 1.0
                                )
                                if coverage < 0.90 or not (0.90 <= len_ratio <= 1.10) or edited_hit < 1.0 or not head_tail_ok:
                                    skipped_server_audio = {
                                        "status": "partial_asr" if coverage >= 0.40 else "mismatch",
                                        "reason": (
                                            f"partial or mismatched ASR does not validate uploaded audio against script "
                                            f"(coverage={coverage:.0%}, lenRatio={len_ratio:.2f}, editedWords={edited_hit:.0%}, headTail={head_tail_ok})"
                                        ),
                                        "voice": raw_voice_tag,
                                        "path": chk_path_str,
                                        "asrCoverage": round(coverage, 4),
                                    }
                                elif require_exact:
                                    skipped_server_audio = {
                                        "status": "unverified_estimate",
                                        "reason": f"strict correspondence required, but :8005 upload has no declared text association (ASR coverage={coverage:.1%} is only an acoustic estimate)",
                                        "voice": raw_voice_tag,
                                        "path": chk_path_str,
                                        "asrCoverage": round(coverage, 4),
                                    }
                                else:
                                    can_reuse = True
                                    prefetched_audio = cand_audio
                                    prefetched_asr = cand_asr
                                    text_association = "none"
                                    correspondence = "asr_partial_estimate" if coverage < 1.0 else "asr_estimated"
                                    exact_match = False
                                    asr_coverage = round(coverage, 4)
                                    estimation_warning = (
                                        f"correspondence estimated from ASR transcript only (coverage={coverage:.1%}, exactMatch=false, integralWordsGuaranteed=false), "
                                        f"without any declared server text association"
                                    )

                    # In strict mode (--require-exact), NEVER silently overwrite an uncertain/unvalidated :8005 upload with synthetic TTS
                    # unless regeneration was explicitly authorized (--force or --voice).
                    if not can_reuse and require_exact and not explicit_regen_authorized:
                        stop_reason = (
                            (skipped_server_audio or {}).get("reason")
                            or "strict exact mode cannot validate :8005 upload"
                        ) + " (stopping in strict mode rather than regenerating synthetic TTS without explicit --force or --voice)"
                        stop_corr = (
                            "asr_estimated"
                            if (skipped_server_audio or {}).get("status") == "unverified_estimate"
                            else "upload_asr_uncertain"
                        )
                        cov_val = (skipped_server_audio or {}).get("asrCoverage")
                        proj.result(
                            ok=False,
                            error=stop_reason,
                            videoId=video_id,
                            correspondence=stop_corr,
                            textAssociation="none",
                            asrValidated=False,
                            exactMatch=False,
                            wordGuarantee="unverified",
                            integralWordsGuaranteed=False,
                            guaranteeNote=WORD_GUARANTEE_NOTE,
                            **({"asrCoverage": cov_val} if cov_val is not None else {}),
                            skippedServerAudio=skipped_server_audio,
                        )
                        return 4
                else:
                    voice_ok = (
                        bool(srv_vid)
                        and srv_vid == str(V.get("voiceId") or "")
                        and (not srv_prov or srv_prov == provider)
                    )
                    if not voice_ok:
                        skipped_server_audio = {
                            "status": "mismatch",
                            "reason": f"target narrator voice is {provider}:{V['voiceId']} while :8005 has {raw_voice_tag or 'untagged'}",
                            "voice": raw_voice_tag,
                            "path": chk_path_str,
                        }
                    elif chk_text:
                        want_match = (chk_raw_sig == raw_text_sig) if provider == "elevenlabs" else (chk_norm_sig == text_sig)
                        if want_match:
                            # Declared server TTS text association alone does NOT prove spoken words: ASR must validate below.
                            can_reuse = True
                            text_association = "server_declared_text"
                            correspondence = "declared_text_pending_asr"
                            exact_match = False
                        else:
                            skipped_server_audio = {
                                "status": "mismatch",
                                "reason": "server TTS declared text differs from episode.json.script",
                                "voice": raw_voice_tag,
                                "path": chk_path_str,
                            }
                    else:
                        # Identical local source script (source.fr.md / script.orig.md) NEVER proves that an older textless
                        # server TTS audio on :8005 was generated from this text: block unverified server TTS reuse.
                        skipped_server_audio = {
                            "status": "unprovable",
                            "reason": "cannot prove :8005 TTS audio without associated text matches episode.json.script (identical local source baseline is not proof)",
                            "voice": raw_voice_tag,
                            "path": chk_path_str,
                        }

                if can_reuse:
                    audio_path = chk_path_str
                    res = {"id": chk.get("id"), "audioPath": audio_path, "reused": True}
                    if srv_prov in ("elevenlabs", "fish"):
                        provider = srv_prov
                        V["provider"] = srv_prov
                    if srv_vid:
                        V["voiceId"] = srv_vid
                    raw_model_tag = str(chk.get("model") or "")
                    if ":" in raw_model_tag:
                        _, srv_mid = raw_model_tag.split(":", 1)
                        if srv_mid:
                            V["modelId"] = srv_mid
                    reused_from_server = True
                    if text_association == "server_declared_text":
                        print(
                            f"[voice] reusing :8005 audio with matching declared text ({audio_path}, id={chk.get('id')}, voice={raw_voice_tag or V['voiceId']}); validating words via ASR",
                            flush=True,
                        )
                    else:
                        print(
                            f"[voice] WARNING: reusing :8005 uploaded audio by ASR ESTIMATE (not exact identity, coverage={(asr_coverage or 0.0):.1%}, path={audio_path})",
                            flush=True,
                        )
                else:
                    why = (skipped_server_audio or {}).get("reason") or f"target narrator voice is {V['voiceId']}"
                    tag_state = (skipped_server_audio or {}).get("status", "mismatch")
                    print(
                        f"[voice] ignoring existing :8005 TTS ({raw_voice_tag}, status={tag_state}): {why} — regenerating",
                        flush=True,
                    )

        if not reused_from_server:
            text_association = "tts_request"
            correspondence = "declared_text_pending_asr"
            exact_match = False
            label = "ElevenLabs" if provider == "elevenlabs" else "Fish Audio"
            print(f"[voice] {len(text)} chars -> {label} {V['modelId']} ({V['voiceId']}) for video {video_id}", flush=True)
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
                extra_err = f" (existing :8005 audio not reused: {skipped_server_audio['reason']})" if skipped_server_audio else ""
                proj.result(
                    ok=False,
                    error=f"TTS ({provider}) failed: {e}{extra_err}",
                    videoId=video_id,
                    provider=provider,
                    skippedServerAudio=skipped_server_audio,
                )
                return 3
            audio_path = str(res.get("audioPath") or "")
            if not audio_path:
                proj.result(ok=False, error="TTS returned no audioPath", response=res, skippedServerAudio=skipped_server_audio)
                return 3
        if prefetched_audio is not None:
            audio = prefetched_audio
        else:
            try:
                audio = nv.fetch(audio_path)
            except NouveauError as e:
                proj.result(ok=False, error=f"could not download {audio_path}: {e}")
                return 3
        x = decode_bytes(audio)
        duration = len(x) / SR

        # Transcribe the take via Deepgram on :8005, then validate against script words (neither TTS input nor server text alone proves spoken words).
        asr: List[Dict[str, Any]] = []
        asr_source = "deepgram"
        asr_err_detail: Optional[str] = None
        if prefetched_asr is not None:
            asr = prefetched_asr
        else:
            try:
                tr = nv.tts_transcribe(str(video_id), audio, lang=ep_lang)
                asr = words_of(tr.get("transcript") or tr.get("segments") or [])
            except NouveauError as e:
                asr_err_detail = str(e)
                print(f"[voice] TTS transcription unavailable ({e}); falling back to a proportional timeline", file=sys.stderr)
                asr_source = "proportional"

        script_norms = [norm(w["w"]) for w in script if norm(w["w"])]
        asr_norms = [norm(str(w["w"])) for w in asr if norm(str(w["w"]))]
        if not asr or not asr_norms:
            asr_source = "proportional"
            aligned_exact = 0
            asr_exact_seq = False
            alignment_coverage = 0.0
            print("[voice] no ASR words: spreading the script proportionally over the audio", file=sys.stderr)
        else:
            aligned_exact = sum(
                b.size
                for b in difflib.SequenceMatcher(
                    None,
                    script_norms,
                    asr_norms,
                    autojunk=False,
                ).get_matching_blocks()
            )
            asr_exact_seq = bool(script_norms and script_norms == asr_norms)
            if not asr_exact_seq:
                asr_source = "deepgram_partial"
            alignment_coverage = round(aligned_exact / max(1, max(len(script_norms), len(asr_norms))), 4)

        if text_association in ("server_declared_text", "tts_request"):
            if asr_source == "deepgram" and asr_exact_seq:
                correspondence = "declared_text_and_asr"
                asr_validated = True
                exact_match = True
                word_guarantee = WORD_GUARANTEE_DECLARED_ASR
            elif asr_source == "proportional":
                correspondence = "declared_text_unvalidated_no_asr"
                asr_validated = False
                exact_match = False
                word_guarantee = "declared_association_only_no_asr"
                estimation_warning = (
                    f"declared text association ({text_association}) could not be validated because word-level ASR was unavailable"
                    + (f" ({asr_err_detail})" if asr_err_detail else "")
                    + "; timings are proportional and spoken words are unverified"
                )
            else:
                correspondence = "declared_text_partial_asr"
                asr_validated = False
                exact_match = False
                word_guarantee = "declared_association_with_partial_asr"
                estimation_warning = (
                    f"declared text association ({text_association}) has partial/divergent ASR word alignment "
                    f"(coverage={alignment_coverage:.1%}, exactMatch=false, integralWordsGuaranteed=false)"
                )
        else:
            correspondence = "asr_estimated" if (asr_source == "deepgram" and asr_exact_seq) else "asr_partial_estimate"
            asr_validated = bool(asr_source == "deepgram" and asr_exact_seq)
            exact_match = False
            word_guarantee = "asr_estimate_only"
            if not estimation_warning:
                estimation_warning = (
                    f"correspondence estimated from ASR transcript only (coverage={alignment_coverage:.1%}, exactMatch=false, integralWordsGuaranteed=false), "
                    f"without any declared text association"
                )

        if require_exact and not exact_match:
            proj.result(
                ok=False,
                error=estimation_warning or "strict exact mode requires both declared text association and 100% normalized ASR word alignment",
                videoId=video_id,
                correspondence=correspondence,
                textAssociation=text_association,
                asr=asr_source,
                asrValidated=asr_validated,
                alignmentCoverage=alignment_coverage,
                exactMatch=False,
                wordGuarantee=word_guarantee,
                integralWordsGuaranteed=False,
                guaranteeNote=WORD_GUARANTEE_NOTE,
                **({"asrCoverage": asr_coverage} if asr_coverage is not None else {}),
                **({"skippedServerAudio": skipped_server_audio} if skipped_server_audio else {}),
            )
            return 4

        raw_mp3.write_bytes(audio)
        words = realign(script, asr, duration)
        proj.save_json(raw_words_path, words)
        meta_out: Dict[str, Any] = {
            "sig": sig,
            "text_sig": text_sig,
            "raw_text_sig": raw_text_sig,
            "lang": ep_lang,
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
            "asrValidated": asr_validated,
            "alignmentCoverage": alignment_coverage,
            "textAssociation": text_association,
            "correspondence": correspondence,
            "exactMatch": exact_match,
            "wordGuarantee": word_guarantee,
            "integralWordsGuaranteed": False,
            "guaranteeNote": WORD_GUARANTEE_NOTE,
            "words": len(words),
            "elapsedSec": round(time.time() - t0, 2),
        }
        if asr_coverage is not None:
            meta_out["asrCoverage"] = asr_coverage
        if estimation_warning:
            meta_out["estimationWarning"] = estimation_warning
        if skipped_server_audio:
            meta_out["skippedServerAudio"] = skipped_server_audio
        proj.save_json(meta_path, meta_out)
        costs = proj.load_json(proj.out_dir(slug) / "costs.json", []) or []
        costs.append(
            {
                "step": "voice",
                "credits": 0 if reused_from_server else (len(text) if provider == "elevenlabs" else 0),
                "note": (f"reused :8005 audio {audio_path} ({correspondence})" if reused_from_server else f"{provider}:{V['modelId']} {len(text)} chars, video {video_id} ({correspondence})")
                + ("" if asr_source == "deepgram" else f" ({asr_source} timings)"),
                "provider": provider,
                "model": V["modelId"],
                "voice": V["voiceId"],
                "chars": len(text),
                "reused": reused_from_server,
                "correspondence": correspondence,
                "exactMatch": exact_match,
                "wordGuarantee": word_guarantee,
                "integralWordsGuaranteed": False,
            }
        )
        proj.save_json(proj.out_dir(slug) / "costs.json", costs)
    else:
        print("[voice] text and voice unchanged: reusing the last take (no API call)")

    words = proj.load_json(raw_words_path)
    x = decode(raw_mp3)
    y, out, removed = tighten(words, x, ep.get("gaps") or {})
    print(f"[voice] tightened {removed:.2f} s of silence: {len(x) / SR:.2f} s -> {len(y) / SR:.2f} s")
    tight_s = len(y) / SR
    y, out = retime(y, out, tempo)
    if len(y) / SR != tight_s:
        rate = len(out) / (len(y) / SR) if len(y) else 0.0
        print(f"[voice] tempo {tempo:g}: {tight_s:.2f} s -> {len(y) / SR:.2f} s, {rate:.2f} words/s, same pitch")
    write_wav(proj.pub_dir(slug) / "voice.wav", y)
    proj.save_json(proj.ep_dir(slug) / "words.json", out)

    final_meta = proj.load_json(meta_path, {}) or {}
    final_validated = (
        final_meta.get("exactMatch") is True
        and final_meta.get("asrValidated") is True
        and final_meta.get("asr") == "deepgram"
        and final_meta.get("alignmentCoverage") == 1.0
        and final_meta.get("correspondence") in VALIDATED_CORRESPONDENCES
    )
    final_correspondence = (
        str(final_meta.get("correspondence"))
        if final_meta.get("correspondence") in VALIDATED_CORRESPONDENCES
        or str(final_meta.get("correspondence") or "")
        in (
            "declared_text_unvalidated_no_asr",
            "declared_text_partial_asr",
            "asr_estimated",
            "asr_partial_estimate",
        )
        else "legacy_unverified_cache"
    )
    final_word_guarantee = (
        WORD_GUARANTEE_DECLARED_ASR
        if final_validated
        else str(final_meta.get("wordGuarantee") or "unverified_legacy_cache")
    )
    proj.result(
        ok=True,
        slug=slug,
        lang=ep_lang,
        videoId=video_id,
        provider=provider,
        modelId=V["modelId"],
        voiceId=V["voiceId"],
        chars=len(text),
        words=len(out),
        duration=round(len(y) / SR, 3),
        tempo=tempo,
        correspondence=final_correspondence,
        textAssociation=final_meta.get("textAssociation", "unknown"),
        asrValidated=bool(final_meta.get("asrValidated") is True),
        exactMatch=final_validated,
        wordGuarantee=final_word_guarantee,
        integralWordsGuaranteed=False,
        guaranteeNote=WORD_GUARANTEE_NOTE,
        voiceWav=f"public/{slug}/voice.wav",
        wordsJson=f"src/episodes/{slug}/words.json",
        meta=final_meta,
        **({"asrCoverage": final_meta["asrCoverage"]} if "asrCoverage" in final_meta else {}),
        **({"estimationWarning": final_meta["estimationWarning"]} if final_meta.get("estimationWarning") else {}),
        **({"skippedServerAudio": final_meta["skippedServerAudio"]} if final_meta.get("skippedServerAudio") else {}),
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
