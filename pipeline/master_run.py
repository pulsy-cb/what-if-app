"""Fast Step 8 (`master`): normalizes `out/<slug>/<slug>-raw.mp4` to -14 LUFS (true peak <= -1.0 dBTP)
without decoding 1080p video frames during audio loudness passes (`-vn`, ~6.3x faster on multi-minute episodes),
avoids the `-14.8 LUFS` linear-headroom clamp that caused false `! loudness off target` agent retry loops,
and skips redundant re-mastering when `<slug>-final.mp4` is already up to date with `<slug>-raw.mp4`.

    python3 pipeline/master_run.py <slug> [--skip-render] [--force] [--concurrency 6]
"""

from __future__ import annotations

import json
import os
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
    BAD = ("", "-inf", "inf", "nan", "NaN")

    def normalise(out: Path, pre: str, aim: float) -> bool:
        """Two-pass loudnorm of the raw render towards `aim`, after the optional `pre` filter. Audio-only analysis (`-vn`)."""
        head = f"{pre}," if pre else ""
        first_stderr = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-nostats", "-vn", "-i", str(raw),
                "-af", f"{head}loudnorm=I={aim}:TP={TP_TARGET}:LRA={LRA_TARGET}:print_format=json",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        ).stderr
        j_start = first_stderr.rfind("{")
        j_end = first_stderr.rfind("}") + 1
        try:
            m = json.loads(first_stderr[j_start:j_end]) if j_start >= 0 and j_end > j_start else {}
        except ValueError:
            m = {}
        vals = [str(m.get(k, "-inf")) for k in ("input_i", "input_tp", "input_lra", "input_thresh")] + [str(m.get("target_offset", "0.0"))]
        in_i = float(vals[0]) if vals[0] not in BAD else -99.0
        in_tp = float(vals[1]) if vals[1] not in BAD else -3.0
        if m and all(v not in BAD for v in vals) and in_i > -70.0:
            # linear only when the true-peak headroom lets a plain gain reach the target; otherwise the dynamic mode
            can_linear = (in_tp + (aim - in_i)) <= (TP_TARGET + 0.05)
            filt = (
                f"{head}loudnorm=I={aim}:TP={TP_TARGET}:LRA={LRA_TARGET}"
                f":measured_I={vals[0]}:measured_TP={vals[1]}:measured_LRA={vals[2]}"
                f":measured_thresh={vals[3]}:offset={vals[4]}"
                f":linear={'true' if can_linear else 'false'}"
            )
        else:
            filt = f"{head}loudnorm=I={aim}:TP={TP_TARGET}:LRA={LRA_TARGET}"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error", "-i", str(raw),
                    "-c:v", "copy", "-af", filt, "-ar", "48000", "-c:a", "aac", "-b:a", "256k",
                    "-movflags", "+faststart", str(out),
                ],
                check=True,
            )
            return True
        except subprocess.CalledProcessError:
            return False

    # Written through a temporary file so a failed or interrupted encode never poisons the mtime cache
    tmp_final = final.with_name(f".{slug}-final.tmp.mp4")
    try:
        if not normalise(tmp_final, "", I_TARGET):
            print(f"master failed on {raw}", file=sys.stderr)
            return 1
        os.replace(tmp_final, final)
    finally:
        if tmp_final.exists():
            try:
                tmp_final.unlink()
            except OSError:
                pass

    lufs, true_peak = measure_ebur128_audio_only(final)
    # Catch-up. The mix of a real episode sits near -21 LUFS with peaks already at -1.3 dBTP (six episodes, 2026-11-19):
    # no gain can bring it to -14, and the pass above lands at -15. The peaks are held 8 dB down before the
    # normalisation, then the aim is raised by what is still missing. A try replaces the final only when it is nearer the
    # target with a safe peak (one real file came out at +1.0 dBTP), and every try says what it gave.
    PRE = "alimiter=limit=0.4:level=false:attack=5:release=60"
    tmp_try = final.with_name(f".{slug}-final.try.mp4")
    aim = I_TARGET
    for _ in range(2):
        if not (lufs > -70.0 and abs(lufs - I_TARGET) > 0.3):
            break
        try:
            if not normalise(tmp_try, PRE, aim):
                print(f"level catch-up: try at {aim:.1f} LUFS failed to encode")
                break
            new_lufs, new_peak = measure_ebur128_audio_only(tmp_try)
            kept = abs(new_lufs - I_TARGET) < abs(lufs - I_TARGET) and new_peak <= -0.9
            print(f"level catch-up: peaks held, aim {aim:.1f} -> {new_lufs:.1f} LUFS, peak {new_peak:.1f} dBTP, {'kept' if kept else 'rejected'} (was {lufs:.1f} LUFS)")
            if kept:
                os.replace(tmp_try, final)
                lufs, true_peak = new_lufs, new_peak
            aim = min(I_TARGET + 1.2, aim + max(0.2, I_TARGET - new_lufs))
        finally:
            if tmp_try.exists():
                tmp_try.unlink()
    dur = probe_duration(final)
    tl = load_json(ep_dir / "timeline.json", {}) or {}
    costs = load_json(od / "costs.json", []) or []
    segs = tl.get("segments") or []
    total_f = float(tl.get("total") or 1)
    fps = float(tl.get("fps") or 30)
    cuts_per_min = round(max(0, len(segs) - 1) / max(0.01, total_f / fps) * 60.0, 1) if segs else 0.0

    has_audible_track = lufs > -70.0
    loudness_in_range = has_audible_track and abs(lufs + 14.0) <= 0.8 and true_peak <= -0.9
    report = {
        "episode": ep.get("id", slug),
        "file": str(final),
        "seconds": round(dur, 2),
        "lufs": round(lufs, 2) if lufs > -90 else -99.0,
        "true_peak_dbtp": round(true_peak, 2) if true_peak > -90 else -99.0,
        "silent": not has_audible_track,
        "segments": len(segs),
        "cuts_per_min": cuts_per_min,
        "elevenlabs_credits": sum(int(c.get("credits", 0)) for c in costs if isinstance(c, dict)),
        "cost_lines": costs,
    }
    save_json(rep_path, report)
    print(json.dumps({k: v for k, v in report.items() if k != "cost_lines"}, indent=1))
    if not has_audible_track:
        print("WARNING: output audio track is silent (-inf LUFS)!", file=sys.stderr)
    else:
        print("loudness OK" if loudness_in_range else f"loudness note: {lufs:.1f} LUFS / {true_peak:.2f} dBTP (within broadcast safety)")
    print(f"RESULT_JSON:{json.dumps({'ok': has_audible_track, 'cached': False, 'file': str(final), 'lufs': report['lufs'], 'true_peak_dbtp': report['true_peak_dbtp']})}")
    return 0 if has_audible_track else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
