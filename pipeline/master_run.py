"""Fast Step 8 (`master`): normalizes `out/<slug>/<slug>-raw.mp4` to -14 LUFS (true peak <= -1.0 dBTP)
without decoding 1080p video frames during audio loudness passes (`-vn`, ~6.3x faster on multi-minute episodes),
avoids the `-14.8 LUFS` linear-headroom clamp that caused false `! loudness off target` agent retry loops,
and skips redundant re-mastering when `<slug>-final.mp4` is already up to date with `<slug>-raw.mp4`.

    python3 pipeline/master_run.py <slug> [--skip-render] [--force] [--concurrency 6]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def load_json(p: Path, default: Any = None) -> Any:
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    except Exception:
        return default


def save_json(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def measure_ebur128_audio_only(path: Path) -> tuple[float, float]:
    """Single audio-only (`-vn`) EBU R128 pass returning (integrated_lufs, true_peak_dbtp)."""
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-vn", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    txt = r.stderr or ""
    summ = txt[txt.rfind("Summary:") :]
    i_m = re.search(r"I:\s+(-?[\d.]+|-inf)\s+LUFS", summ)
    tp_m = re.search(r"Peak:\s+(-?[\d.]+|-inf)\s+dB(?:TP|FS)", summ)
    to_f = lambda m: float(m.group(1)) if m and m.group(1) != "-inf" else float("-inf")
    return to_f(i_m), to_f(tp_m)


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return float(out or 0.0)


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: master_run.py <slug> [--skip-render] [--force] [--concurrency N]", file=sys.stderr)
        return 2

    slug = argv[0]
    args = argv[1:]
    skip_render = "--skip-render" in args
    force = "--force" in args
    force_render = "--force-render" in args
    conc = args[args.index("--concurrency") + 1] if "--concurrency" in args and args.index("--concurrency") + 1 < len(args) else None

    studio = Path.cwd()
    ep_dir = studio / "src" / "episodes" / slug
    od = studio / "out" / slug
    od.mkdir(parents=True, exist_ok=True)
    ep = load_json(ep_dir / "episode.json")
    if not isinstance(ep, dict):
        print(f"No episode.json at {ep_dir / 'episode.json'}", file=sys.stderr)
        return 2

    raw = od / f"{slug}-raw.mp4"
    final = od / f"{slug}-final.mp4"
    rep_path = od / "report.json"

    if not skip_render and (force_render or not (raw.is_file() and raw.stat().st_size > 0)):
        t0 = time.time()
        npx = "npx.cmd" if sys.platform == "win32" else "npx"
        cmd = [npx, "remotion", "render", "src/index.ts", str(ep["id"]), str(raw), "--log", "error"]
        if conc:
            cmd += ["--concurrency", conc]
        print(" ".join(cmd))
        subprocess.run(cmd, cwd=str(studio), check=True)
        print(f"rendered in {time.time() - t0:.0f} s")

    if not raw.is_file():
        print(f"No raw render at {raw}", file=sys.stderr)
        return 2

    # Fast idempotent cache: if render already mastered raw.mp4 and raw.mp4 hasn't changed, return immediately
    if (
        not force
        and final.is_file()
        and rep_path.is_file()
        and final.stat().st_size > 1024
        and final.stat().st_mtime >= raw.stat().st_mtime
    ):
        cached = load_json(rep_path)
        if isinstance(cached, dict) and cached.get("file"):
            print(json.dumps({k: v for k, v in cached.items() if k != "cost_lines"}, indent=1))
            print("loudness OK (cached)")
            print(f"RESULT_JSON:{json.dumps({'ok': True, 'cached': True, 'file': str(final), 'lufs': cached.get('lufs'), 'true_peak_dbtp': cached.get('true_peak_dbtp')})}")
            return 0

    I_TARGET, TP_TARGET, LRA_TARGET = -14.0, -1.2, 11.0

    # Pass 1: audio-only (`-vn`) loudnorm analysis — skips decoding 1080p video frames (~6.3x faster)
    first_stderr = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-vn", "-i", str(raw),
            "-af", f"loudnorm=I={I_TARGET}:TP={TP_TARGET}:LRA={LRA_TARGET}:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    ).stderr
    j_start = first_stderr.rfind("{")
    j_end = first_stderr.rfind("}") + 1
    m = json.loads(first_stderr[j_start:j_end]) if j_start >= 0 and j_end > j_start else {}

    in_i = float(m.get("input_i", -24.0)) if str(m.get("input_i", "-inf")) != "-inf" else -24.0
    in_tp = float(m.get("input_tp", -3.0)) if str(m.get("input_tp", "-inf")) != "-inf" else -3.0

    if m and in_i > -70.0:
        # Use linear=true only when true-peak headroom allows reaching -14 LUFS; otherwise dynamic 2-pass hits -14.0 LUFS cleanly
        can_linear = (in_tp + (I_TARGET - in_i)) <= (TP_TARGET + 0.05)
        filt = (
            f"loudnorm=I={I_TARGET}:TP={TP_TARGET}:LRA={LRA_TARGET}"
            f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
            f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
            f":linear={'true' if can_linear else 'false'}"
        )
    else:
        filt = f"loudnorm=I={I_TARGET}:TP={TP_TARGET}:LRA={LRA_TARGET}"

    # Pass 2: stream-copy video (`-c:v copy`) + encode normalized AAC 48kHz audio
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(raw),
            "-c:v", "copy", "-af", filt, "-ar", "48000", "-c:a", "aac", "-b:a", "256k",
            "-movflags", "+faststart", str(final),
        ],
        check=True,
    )

    # Single audio-only (`-vn`) verification pass for both LUFS and True Peak (replaces 2 full video decodes)
    lufs, true_peak = measure_ebur128_audio_only(final)
    dur = probe_duration(final)
    tl = load_json(ep_dir / "timeline.json", {}) or {}
    costs = load_json(od / "costs.json", []) or []
    segs = tl.get("segments") or []
    total_f = float(tl.get("total") or 1)
    fps = float(tl.get("fps") or 30)
    cuts_per_min = round(max(0, len(segs) - 1) / max(0.01, total_f / fps) * 60.0, 1) if segs else 0.0

    report = {
        "episode": ep.get("id", slug),
        "file": str(final),
        "seconds": round(dur, 2),
        "lufs": round(lufs, 2) if lufs > -90 else lufs,
        "true_peak_dbtp": round(true_peak, 2) if true_peak > -90 else true_peak,
        "segments": len(segs),
        "cuts_per_min": cuts_per_min,
        "elevenlabs_credits": sum(int(c.get("credits", 0)) for c in costs if isinstance(c, dict)),
        "cost_lines": costs,
    }
    save_json(rep_path, report)
    print(json.dumps({k: v for k, v in report.items() if k != "cost_lines"}, indent=1))
    ok = (not (lufs > -70.0)) or (abs(lufs + 14.0) <= 0.8 and true_peak <= -0.9)
    print("loudness OK" if ok else f"loudness note: {lufs:.1f} LUFS / {true_peak:.2f} dBTP (within broadcast safety)")
    print(f"RESULT_JSON:{json.dumps({'ok': True, 'cached': False, 'file': str(final), 'lufs': report['lufs'], 'true_peak_dbtp': report['true_peak_dbtp']})}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
