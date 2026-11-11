"""Fast Step 6 (`motiongrid`): extracts frame contact sheets per shot using a SINGLE fast-seek FFmpeg pass
per shot (`-ss` + `-to`) instead of spawning one full-video `select=eq(n,f)` FFmpeg decode per frame (`O(N^2)`).

    python3 pipeline/motiongrid_run.py <slug> [S3 S5 ...] [--video out/<slug>/<slug>-raw.mp4] [--step 4] [--range 120:180]
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: motiongrid_run.py <slug> [S1 S2 ...] [--video path] [--step 4] [--range a:b]", file=sys.stderr)
        return 2
    slug = argv[0]
    args = argv[1:]

    def opt(name: str, default: str | None = None) -> str | None:
        return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default

    studio = Path.cwd()
    ep_dir = studio / "src" / "episodes" / slug
    od = studio / "out" / slug
    video = Path(opt("--video") or (od / f"{slug}-raw.mp4"))
    if not video.is_file():
        print(f"No video at {video}", file=sys.stderr)
        return 2

    step = max(1, int(opt("--step") or "4"))
    tl = json.loads((ep_dir / "timeline.json").read_text(encoding="utf-8"))
    fps = float(tl.get("fps") or 30.0)
    out = od / "motion"
    out.mkdir(parents=True, exist_ok=True)

    skip = {opt("--video"), opt("--step"), opt("--range")}
    want = [a for a in args if not a.startswith("--") and a not in skip]

    jobs: list[tuple[str, list[tuple[int, int]]]] = []
    rng = opt("--range")
    if rng:
        a, b = map(int, rng.split(":"))
        jobs.append((f"range-{a}-{b}", [(a, b)]))
    else:
        # When called with no shot filter on a long episode, cap to at most 12 evenly spaced shots so it stays < 5s
        all_shots = [s for s in (tl.get("shots") or []) if not want or s.get("id") in want]
        if not want and len(all_shots) > 12:
            stride = max(1, len(all_shots) // 12)
            all_shots = all_shots[::stride][:12]
        for s in all_shots:
            sid = str(s["id"])
            segs = [(int(g["a"]), int(g["b"])) for g in (tl.get("segments") or []) if g.get("shot") == sid]
            if segs:
                jobs.append((sid, segs))

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
        capture_output=True,
        text=True,
    ).stdout.strip()
    vw, vh = (map(int, probe.split(",")[:2]) if "," in probe else (1920, 1080))
    W, H, cols = (270, 480, 6) if vh > vw else (480, 270, 6)

    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        font = ImageFont.load_default()

    tmp_root = Path(tempfile.mkdtemp(prefix="whatif_mg_"))
    written: list[str] = []
    try:
        for name, segs in jobs:
            frames_imgs: list[tuple[int, Image.Image]] = []
            for seg_idx, (a, b) in enumerate(segs):
                if b <= a:
                    continue
                seg_dir = tmp_root / f"{name}_{seg_idx}"
                seg_dir.mkdir(parents=True, exist_ok=True)
                t0 = max(0.0, a / fps)
                dur = max(0.05, (b - a) / fps)
                extract_fps = fps / step
                subprocess.run(
                    [
                        "ffmpeg", "-v", "error",
                        "-ss", f"{t0:.4f}", "-t", f"{dur:.4f}",
                        "-i", str(video),
                        "-an",
                        "-vf", f"fps={extract_fps:.6f},scale={W}:{H}",
                        str(seg_dir / "f_%04d.jpg"),
                    ],
                    check=True,
                )
                for idx, fp in enumerate(sorted(seg_dir.glob("f_*.jpg"))):
                    f_num = a + idx * step
                    frames_imgs.append((f_num, Image.open(fp).convert("RGB")))

            if not frames_imgs:
                continue
            rows = (len(frames_imgs) + cols - 1) // cols
            sheet = Image.new("RGB", (cols * W, rows * H))
            for i, (f_num, im) in enumerate(frames_imgs):
                dr = ImageDraw.Draw(im)
                dr.rectangle([0, 0, 68, 28], fill=(0, 0, 0))
                dr.text((5, 2), str(f_num), fill=(255, 255, 0), font=font)
                sheet.paste(im, ((i % cols) * W, (i // cols) * H))
            p = out / f"{name}.jpg"
            sheet.save(p, quality=85)
            written.append(str(p))
            print(p)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
        (out / "_f.png").unlink(missing_ok=True)

    print(f"RESULT_JSON:{json.dumps({'ok': True, 'files': written})}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
