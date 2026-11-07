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
        "room_tone": ["room", "ambient", "tone", "indoor", "study"],
        "class_murmur": ["class", "school", "murmur", "whisper"],
        "roof_wind": ["wind", "roof", "breeze", "city", "outdoor"],
        "title_boom": ["title", "boom", "impact", "whoosh"],
        "paper_land": ["paper", "sheet", "page", "card", "cut", "rustle"],
        "select_draw": ["draw", "write", "pen", "line", "select", "chalk"],
        "copy_click": ["click", "tap", "button"],
        "paste_pop": ["paste", "appear", "twist", "fold", "glue"],
        "counter_tick": ["tick", "count", "number", "calc"],
        "power_hum": ["hum", "drone", "loop", "energy"],
        "drone_hit": ["dark", "turn", "ominous", "sting", "hit"],
        "switch_off": ["switch", "off", "end", "stop"],
        "sparkle": ["sparkle", "magic", "chime", "shine"],
        "pop": ["pop", "bubble"],
    }
    for lib_name, words_list in synonyms.items():
        if any(w in lower for w in words_list):
            cands = sorted(lib_dir.glob(f"{lib_name}-*.mp3"))
            if cands:
                return cands[0]
    cands = sorted(lib_dir.glob("pop-*.mp3"))
    return cands[0] if cands else None


def onset(x: np.ndarray, mode: str) -> int:
    a = np.abs(x)
    win = max(1, int(0.01 * SR))
    sm = np.convolve(a, np.ones(win) / win, mode="same")
    if not len(sm) or float(sm.max()) <= 0:
        return 0
    return int(np.argmax(sm)) if mode == "peak" else int(np.argmax(sm > 0.2 * sm.max()))


def put(buf: np.ndarray, frame: int, x: np.ndarray, gain: float, fps: int, align: str = "onset", cut: int | None = None) -> None:
    i = int(frame / fps * SR) - onset(x, align)
    if i < 0:
        x = x[-i:]
        i = 0
    if cut is not None:
        n = max(0, int(cut / fps * SR) - i)
        x = x[:n].copy()
        f = min(len(x), int(0.08 * SR))
        if f > 0:
            x[-f:] *= np.linspace(1, 0, f)
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
        min(3, max(0, len(shots) // 2)),
    )
    default_snd = build_default_sound(shots, title_idx) if shots else {}
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
                    evs.append([str(k), str(k), 0.28])
            snd["events"] = evs if evs else default_snd.get("events", [])
            for k, v in (default_snd.get("clips") or {}).items():
                snd["clips"].setdefault(k, v)
        if not snd.get("music") and default_snd.get("music"):
            snd["clips"].setdefault("music", LIBRARY_CLIPS["music"])
            snd["music"] = default_snd["music"]
        save_json(ep_path, ep)

    # First try the skill's sfx.py if an ElevenLabs key is configured and valid
    skill_dir = os.environ.get("WHATIF_SKILL_DIR") or str((studio.parent.parent.parent / "what-if-animation").resolve())
    skill_sfx = Path(skill_dir) / "scripts" / "sfx.py"
    if skill_sfx.is_file() and os.environ.get("ELEVENLABS_API_KEY"):
        proc = subprocess.run([sys.executable, str(skill_sfx), *argv], cwd=str(studio), capture_output=True, text=True)
        if proc.returncode == 0:
            if proc.stdout:
                print(proc.stdout.rstrip())
            print(f"RESULT_JSON:{json.dumps({'ok': True, 'mode': 'elevenlabs', 'slug': slug})}")
            return 0
        print(f"[sfx] ElevenLabs sfx.py exited with {proc.returncode}; falling back to local library/sfx cache")

    # Local fallback mixer using cached library/sfx MP3s
    S = ep["sound"]
    fps = int(tl.get("fps") or 30)
    segments = tl.get("segments") or []
    shot_ids = [str(s.get("id")) for s in (tl.get("shots") or [])]
    dur = float(tl.get("total") or 480) / fps + 0.4
    cue_fn = lambda c: resolve_cue(c, words, fps, segments, shot_ids)

    clips: dict[str, np.ndarray] = {}
    resolved_files: dict[str, str] = {}
    for name, spec in (S.get("clips") or {}).items():
        prompt = str(spec[0]) if isinstance(spec, list) and spec else str(name)
        secs = float(spec[1]) if isinstance(spec, list) and len(spec) > 1 else 1.0
        p = find_library_clip(lib_dir, name, prompt, secs)
        if p is None:
            continue
        x = decode(p)
        m = float(np.abs(x).max()) if len(x) else 0.0
        clips[name] = x / max(1e-9, m)
        resolved_files[name] = p.name

    print(f"[sfx] resolved {len(clips)}/{len(S.get('clips') or {})} clips from library/sfx: {', '.join(sorted(clips))}")
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
    if isinstance(M, dict):
        m_clip_name = str(M.get("clip") or "music")
        if m_clip_name not in clips:
            p = find_library_clip(lib_dir, "music", LIBRARY_CLIPS["music"][0], LIBRARY_CLIPS["music"][1])
            if p is not None:
                x = decode(p)
                clips[m_clip_name] = x / max(1e-9, float(np.abs(x).max()))
        if m_clip_name in clips:
            has_music = True
            m = clips[m_clip_name]
            m0 = int(cue_fn(M["from"]) / fps * SR) if M.get("from") else 0
            # Tile smoothly if the episode is longer than the cached 17s music loop
            pos = m0
            while pos < len(music) and len(m) > 0:
                take = min(len(music) - pos, len(m))
                music[pos : pos + take] = m[:take]
                pos += take
            if M.get("until"):
                end = min(len(music), int(cue_fn(M["until"]) / fps * SR))
                if end > m0:
                    f = min(end, int(0.06 * SR))
                    if f > 0:
                        music[end - f : end] *= np.linspace(1, 0, f)
                    music[end:] = 0

    pub = studio / "public" / slug
    pub.mkdir(parents=True, exist_ok=True)
    write_wav(pub / "sfx.wav", sfx, 0.98)
    if has_music:
        write_wav(pub / "music.wav", music, 0.98)

    voice_file = next((pub / f"voice.{ext}" for ext in ("wav", "mp3") if (pub / f"voice.{ext}").is_file()), None)
    L = {"sfx_lu": -1.5, "music_lu": -9.5}
    L.update(S.get("levels") or {})
    v_lufs, _ = loudness(voice_file) if voice_file else (-16.0, -1.0)
    if not np.isfinite(v_lufs):
        v_lufs = -16.0
    s_lufs, _ = loudness(pub / "sfx.wav")
    if not np.isfinite(s_lufs):
        s_lufs = -24.0
    m_lufs, _ = loudness(pub / "music.wav") if has_music else (float("-inf"), 0.0)
    if has_music and not np.isfinite(m_lufs):
        m_lufs = -20.0

    gain_db: dict[str, float] = {"voice": 0.0, "sfx": v_lufs + float(L["sfx_lu"]) - s_lufs}
    if has_music:
        gain_db["music"] = v_lufs + float(L["music_lu"]) - m_lufs
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
    tl["audio"] = audio
    save_json(tl_path, tl)

    print(f"[sfx] voice {v_lufs:.1f} LUFS, sfx {s_lufs:.1f} LUFS, music {m_lufs:.1f} LUFS -> volumes {vols}")
    print(
        "RESULT_JSON:"
        + json.dumps(
            {
                "ok": True,
                "mode": "library_cache",
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
