"""Resilient Step 7 (SFX + music bed): runs the skill's ElevenLabs generator when possible, and
transparently falls back to the studio's 40 cached `library/sfx/` clips when ElevenLabs is unavailable
or a custom prompt is not yet in cache. Always writes `public/<slug>/sfx.wav`, `public/<slug>/music.wav`,
and updates `src/episodes/<slug>/timeline.json` before `render`.

    python3 pipeline/sfx_run.py <slug> [--dry]
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path
from typing import Any

import numpy as np

from shotlist import LIBRARY_CLIPS, build_default_sound

SR = 44100


def load_json(p: Path, default: Any = None) -> Any:
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    except Exception:
        return default


def save_json(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def norm(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower().replace("\u2019", "'"))


CUE_RE = re.compile(r"^(?P<base>[^+\-#]+?)(?:#(?P<nth>\d+))?(?P<off>[+-]\d+)?$")


def resolve_cue(cue: Any, words: list[dict], fps: int, segments: list[dict], shot_ids: list[str]) -> int:
    s = str(cue).strip()
    if s.startswith("w:"):
        s = s[2:]
    if s.startswith("f:"):
        return max(0, int(round(float(s[2:]))))
    if s.startswith("s:"):
        return max(0, int(round(float(s[2:]) * fps)))
    m = CUE_RE.match(s)
    if not m:
        return 0
    base, nth, off = m["base"], int(m["nth"] or 1), int(m["off"] or 0)
    if base.lower() == "end" and segments:
        return max(0, int(segments[-1].get("b", 0)) + off)
    if base in shot_ids:
        segs = [seg for seg in segments if seg.get("shot") == base]
        if segs:
            idx = min(len(segs) - 1, max(0, nth - 1))
            return max(0, int(segs[idx]["a"]) + off)
    target = norm(base)
    seen = 0
    for w in words:
        if norm(str(w.get("w", ""))) == target:
            seen += 1
            if seen == nth:
                return max(0, int(round(float(w.get("s", 0)) * fps)) + off)
    return 0


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def write_wav(path: Path, x: np.ndarray, peak: float | None = None) -> None:
    if peak is not None and len(x):
        m = float(np.abs(x).max())
        if m > 1e-9:
            x = x / m * peak
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def loudness(path: Path) -> tuple[float, float]:
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    txt = r.stderr
    summ = txt[txt.rfind("Summary:") :]
    i = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summ)
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summ)
    f = lambda m: float(m.group(1)) if m and m.group(1) != "-inf" else float("-inf")
    return f(i), f(p)


def find_library_clip(lib_dir: Path, name: str, prompt: str, secs: float) -> Path | None:
    h = hashlib.sha1(f"{prompt}|{secs}".encode()).hexdigest()[:8]
    exact = lib_dir / f"{name}-{h}.mp3"
    if exact.is_file():
        return exact
    # Prefix match on clip name (e.g. "pop-*.mp3", "music-*.mp3")
    prefix_matches = sorted(lib_dir.glob(f"{name}-*.mp3"))
    if prefix_matches:
        return prefix_matches[0]
    # Keyword match against cached library names
    lower = f"{name} {prompt}".lower()
    synonyms = {
        "music": ["music", "bed", "loop", "bgm"],
        "room_tone": ["room", "ambient", "tone", "indoor", "study", "hospital", "corridor"],
        "class_murmur": ["class", "school", "murmur", "whisper", "crowd"],
        "roof_wind": ["wind", "roof", "breeze", "city", "outdoor", "street", "park"],
        "title_boom": ["title", "boom", "impact"],
        "fall_whoosh": ["whoosh", "swoosh", "fall", "swipe"],
        "paper_land": ["paper", "sheet", "page", "card", "cut", "rustle", "letter", "dossier", "envelope"],
        "select_draw": ["draw", "write", "pen", "line", "select", "chalk"],
        "copy_click": ["click", "tap", "button", "keyboard"],
        "paste_pop": ["paste", "appear", "twist", "fold", "glue"],
        "counter_tick": ["tick", "count", "number", "calc"],
        "clock_back": ["clock", "flashback", "memory", "time"],
        "power_hum": ["hum", "drone", "energy", "monitor"],
        "drone_hit": ["dark", "turn", "ominous", "sting", "hit", "tension"],
        "switch_off": ["switch", "off", "end", "stop", "door"],
        "clink": ["clink", "mug", "cup", "glass", "key", "ring", "coin"],
        "shatter": ["shatter", "smash", "break"],
        "crack": ["crack", "snap", "slap"],
        "gasp": ["gasp", "breath", "shock", "startle"],
        "laugh": ["laugh", "giggle"],
        "step": ["step", "footstep", "walk", "shoe"],
        "buzzer": ["buzzer", "wrong", "alarm", "error"],
        "ding": ["ding", "bell", "correct", "check"],
        "sparkle": ["sparkle", "magic", "chime", "shine"],
        "pop": ["pop", "bubble", "notify", "message"],
    }
    for lib_name, words_list in synonyms.items():
        if any(w in lower for w in words_list):
            cands = sorted(lib_dir.glob(f"{lib_name}-*.mp3"))
            if cands:
                return cands[0]
    cands = sorted(lib_dir.glob("pop-*.mp3"))
    return cands[0] if cands else None


def generate_missing_elevenlabs_clip(lib_dir: Path, name: str, prompt: str, secs: float, api_key: str) -> Path | None:
    """Generate a genuinely new custom SFX clip via ElevenLabs and cache it in `library/sfx/`."""
    h = hashlib.sha1(f"{prompt}|{secs}".encode()).hexdigest()[:8]
    out_path = lib_dir / f"{name}-{h}.mp3"
    if out_path.is_file():
        return out_path
    body = json.dumps(
        {"text": prompt, "duration_seconds": max(0.5, min(22.0, float(secs))), "prompt_influence": 0.45}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
        data=body,
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            audio_bytes = resp.read()
        if len(audio_bytes) > 256:
            lib_dir.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(audio_bytes)
            return out_path
    except Exception as exc:
        print(f"[sfx] ElevenLabs generation skipped for '{name}': {exc}", file=sys.stderr)
    return None


def onset(x: np.ndarray, mode: str) -> int:
    a = np.abs(x)
    win = max(1, int(0.01 * SR))
    sm = np.convolve(a, np.ones(win) / win, mode="same")
    if not len(sm) or float(sm.max()) <= 0:
        return 0
    return int(np.argmax(sm)) if mode == "peak" else int(np.argmax(sm > 0.2 * sm.max()))


def tile_crossfade(x: np.ndarray, target_len: int) -> np.ndarray:
    """Seamlessly tile an ambient clip across `target_len` samples using a smooth crossfade (no 12.5s drop-off!)."""
    if target_len <= 0 or len(x) == 0:
        return np.zeros(max(0, target_len))
    if len(x) >= target_len:
        return x[:target_len].copy()

    # Trim tiny edge fades (up to 0.12s) if clip is long enough so loop seams never dip in energy
    trim = min(int(0.12 * SR), len(x) // 10)
    core = x[trim : len(x) - trim].copy() if len(x) - 2 * trim >= int(0.8 * SR) else x.copy()
    xf = min(int(0.35 * SR), len(core) // 4)
    if xf < 64:
        reps = (target_len + len(core) - 1) // len(core)
        return np.tile(core, reps)[:target_len].copy()

    out = np.zeros(target_len)
    first_n = min(target_len, len(core))
    out[:first_n] = core[:first_n]
    pos = first_n
    theta = np.linspace(0.0, np.pi * 0.5, xf)
    fade_out = np.cos(theta)
    fade_in = np.sin(theta)
    while pos < target_len:
        ov_start = pos - xf
        out[ov_start:pos] = out[ov_start:pos] * fade_out + core[:xf] * fade_in
        rem_core = core[xf:]
        take = min(target_len - pos, len(rem_core))
        if take > 0:
            out[pos : pos + take] = rem_core[:take]
            pos += take
        else:
            break
    return out


def put(buf: np.ndarray, frame: int, x: np.ndarray, gain: float, fps: int, align: str = "onset", cut: int | None = None) -> None:
    is_ambient = cut is not None and len(x) >= int(1.8 * SR)
    i = int(frame / fps * SR) - (0 if is_ambient else onset(x, align))
    if i < 0:
        x = x[-i:]
        i = 0
    if cut is not None:
        n = max(0, min(len(buf) - i, int(cut / fps * SR) - i))
        if n <= 0:
            return
        if len(x) >= int(1.8 * SR) and n > len(x):
            x = tile_crossfade(x, n)
        else:
            x = x[:n].copy()
        fi = min(len(x) // 4, int(0.06 * SR)) if is_ambient else 0
        if fi > 0:
            x[:fi] *= np.linspace(0.0, 1.0, fi)
        fo = min(len(x), int(0.12 * SR if is_ambient else 0.08 * SR))
        if fo > 0:
            x[-fo:] *= np.linspace(1.0, 0.0, fo)
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: sfx_run.py <slug> [--dry]", file=sys.stderr)
        return 2
    slug = argv[0]
    dry = "--dry" in argv
    studio = Path.cwd()
    ep_path = studio / "src" / "episodes" / slug / "episode.json"
    tl_path = studio / "src" / "episodes" / slug / "timeline.json"
    words_path = studio / "src" / "episodes" / slug / "words.json"
    lib_dir = studio / "library" / "sfx"

    ep = load_json(ep_path)
    tl = load_json(tl_path)
    words = load_json(words_path, []) or []
    if not isinstance(ep, dict) or not isinstance(tl, dict):
        print(f"RESULT_JSON:{json.dumps({'ok': False, 'error': 'missing episode.json or timeline.json'})}")
        return 2

    shots = ep.get("shots") or tl.get("shots") or []
    title_idx = next(
        (i for i, s in enumerate(shots) if "title" in str(s.get("size", "")).lower() or "title" in str(s.get("note", "")).lower()),
        -1,
    )
    default_snd = build_default_sound(shots, title_idx, ep.get("edit") or [], ep.get("fx") or []) if shots else {}
    if not ep.get("sound") or not (ep.get("sound") or {}).get("clips"):
        ep["sound"] = default_snd
        save_json(ep_path, ep)
        print(f"[sfx] seeded default sound section in episode.json ({len(ep['sound'].get('clips', {}))} cached clips)")
    else:
        snd = ep["sound"]
        # If the agent wrote cues as clip keys (e.g. "S1", "S1+30") without `events`, synthesize `events`
        if not snd.get("events"):
            evs: list[list] = []
            shot_set = {str(s.get("id")) for s in shots}
            for k in snd.get("clips") or {}:
                base = str(k).split("+")[0].split("-")[0].split("#")[0]
                if base in shot_set or str(k).startswith(("f:", "s:")):
                    evs.append([str(k), str(k), 0.24])
            snd["events"] = evs if evs else default_snd.get("events", [])
            for k, v in (default_snd.get("clips") or {}).items():
                snd["clips"].setdefault(k, v)
        save_json(ep_path, ep)

    # Mix with our seamless crossfade-tiling & voice-first mixer (calling ElevenLabs ONLY for genuinely uncached custom clips)
    S = ep["sound"]
    fps = int(tl.get("fps") or 30)
    segments = tl.get("segments") or []
    shot_ids = [str(s.get("id")) for s in (tl.get("shots") or [])]
    dur = float(tl.get("total") or 480) / fps + 0.4
    cue_fn = lambda c: resolve_cue(c, words, fps, segments, shot_ids)
    api_key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    generated_count = 0

    clips: dict[str, np.ndarray] = {}
    resolved_files: dict[str, str] = {}
    for name, spec in (S.get("clips") or {}).items():
        prompt = str(spec[0]) if isinstance(spec, list) and spec else str(name)
        secs = float(spec[1]) if isinstance(spec, list) and len(spec) > 1 else 1.0
        h = hashlib.sha1(f"{prompt}|{secs}".encode()).hexdigest()[:8]
        exact = lib_dir / f"{name}-{h}.mp3"
        direct_prefix = sorted(lib_dir.glob(f"{name}-*.mp3"))
        p: Path | None = exact if exact.is_file() else (direct_prefix[0] if direct_prefix else None)
        if p is None and api_key and not dry:
            p = generate_missing_elevenlabs_clip(lib_dir, name, prompt, secs, api_key)
            if p is not None:
                generated_count += 1
        if p is None:
            p = find_library_clip(lib_dir, name, prompt, secs)
        if p is None:
            continue
        x = decode(p)
        m = float(np.abs(x).max()) if len(x) else 0.0
        clips[name] = x / max(1e-9, m)
        resolved_files[name] = p.name

    print(f"[sfx] resolved {len(clips)}/{len(S.get('clips') or {})} clips ({generated_count} new via ElevenLabs): {', '.join(sorted(clips))}")
    if dry:
        print(f"RESULT_JSON:{json.dumps({'ok': True, 'dry': True, 'clips': resolved_files})}")
        return 0

    sfx = np.zeros(int(dur * SR))
    for ev in S.get("events") or []:
        if not isinstance(ev, list) or len(ev) < 3:
            continue
        c, name, gain = ev[0], str(ev[1]), float(ev[2])
        if name not in clips:
            continue
        align = str(ev[3]) if len(ev) > 3 and ev[3] else "onset"
        until = cue_fn(ev[4]) if len(ev) > 4 and ev[4] else None
        put(sfx, cue_fn(c), clips[name], gain, fps, align, until)

    for r in S.get("repeats") or []:
        cname = str(r.get("clip") or "")
        if cname not in clips:
            continue
        base = clips[cname]
        g0, g1 = r.get("gain") or [0.2, 0.2]
        p0, p1 = r.get("pitch") or [1.0, 1.0]
        start = cue_fn(r.get("at", "f:0"))
        for i in range(int(r.get("n") or 1)):
            k = float(p0) + (float(p1) - float(p0)) * ((i * 37) % 11) / 10.0
            shifted = np.interp(np.arange(0, len(base), max(0.25, k)), np.arange(len(base)), base)
            gain = float(g0) + (float(g1) - float(g0)) * ((i * 53) % 7) / 6.0
            put(sfx, start + int(r.get("every") or 2) * i, shifted, gain, fps)

    music = np.zeros(int(dur * SR))
    M = S.get("music")
    has_music = False
    if isinstance(M, dict) and M.get("clip"):
        m_clip_name = str(M.get("clip"))
        if m_clip_name not in clips and "music" in LIBRARY_CLIPS:
            p = find_library_clip(lib_dir, m_clip_name, LIBRARY_CLIPS["music"][0], LIBRARY_CLIPS["music"][1])
            if p is not None:
                x = decode(p)
                clips[m_clip_name] = x / max(1e-9, float(np.abs(x).max()))
        if m_clip_name in clips:
            has_music = True
            m = clips[m_clip_name]
            m0 = int(cue_fn(M["from"]) / fps * SR) if M.get("from") else 0
            end = min(len(music), int(cue_fn(M["until"]) / fps * SR)) if M.get("until") else len(music)
            if end > m0:
                span = tile_crossfade(m, end - m0)
                fo = min(len(span), int(0.08 * SR))
                if fo > 0:
                    span[-fo:] *= np.linspace(1.0, 0.0, fo)
                music[m0:end] = span

    pub = studio / "public" / slug
    pub.mkdir(parents=True, exist_ok=True)
    write_wav(pub / "sfx.wav", sfx, 0.98)
    music_wav_path = pub / "music.wav"
    if has_music:
        write_wav(music_wav_path, music, 0.98)
    elif music_wav_path.is_file():
        music_wav_path.unlink()

    voice_file = next((pub / f"voice.{ext}" for ext in ("wav", "mp3") if (pub / f"voice.{ext}").is_file()), None)
    L = {"sfx_lu": -4.5, "music_lu": -11.0}
    L.update(S.get("levels") or {})
    v_lufs, _ = loudness(voice_file) if voice_file else (-16.0, -1.0)
    if not np.isfinite(v_lufs):
        v_lufs = -16.0
    s_lufs, _ = loudness(pub / "sfx.wav")
    if not np.isfinite(s_lufs):
        s_lufs = -28.0
    m_lufs, _ = loudness(music_wav_path) if has_music else (float("-inf"), 0.0)
    if has_music and not np.isfinite(m_lufs):
        m_lufs = -22.0

    # Keep the voice track dominant (>= sfx & music) even when SFX hits are sparse across a long narrative
    sfx_gain_db = min(-1.5, v_lufs + float(L["sfx_lu"]) - s_lufs)
    gain_db: dict[str, float] = {"voice": 0.0, "sfx": sfx_gain_db}
    if has_music:
        gain_db["music"] = min(-6.0, v_lufs + float(L["music_lu"]) - m_lufs)
    top = max(gain_db.values())
    vols = {k: round(min(1.0, 0.8 * 10 ** ((g - top) / 20.0)), 4) for k, g in gain_db.items()}

    audio = dict(tl.get("audio") or {})
    if voice_file:
        audio["voice"] = f"{slug}/{voice_file.name}"
    audio["sfx"] = f"{slug}/sfx.wav"
    audio["voiceVol"] = vols["voice"]
    audio["sfxVol"] = vols["sfx"]
    if has_music:
        audio["music"] = f"{slug}/music.wav"
        audio["musicVol"] = vols["music"]
    else:
        audio.pop("music", None)
        audio.pop("musicVol", None)
    tl["audio"] = audio
    save_json(tl_path, tl)

    print(f"[sfx] voice {v_lufs:.1f} LUFS, sfx {s_lufs:.1f} LUFS, music {m_lufs:.1f} LUFS -> volumes {vols}")
    print(
        "RESULT_JSON:"
        + json.dumps(
            {
                "ok": True,
                "mode": "elevenlabs_plus_cache" if generated_count > 0 else "library_cache",
                "slug": slug,
                "sfxWav": f"public/{slug}/sfx.wav",
                "musicWav": f"public/{slug}/music.wav" if has_music else None,
                "volumes": vols,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
