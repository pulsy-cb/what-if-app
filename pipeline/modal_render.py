"""Render the storyboard stills and the episode on Modal (Remotion runs there, not in this container).

    python3 pipeline/modal_render.py <slug> --mode stills            # -> out/<slug>/board/<shot>.png
    python3 pipeline/modal_render.py <slug> --mode video             # -> out/<slug>/<slug>-raw.mp4
    python3 pipeline/modal_render.py <slug> --mode check             # bundle + list the compositions

The container that runs this app needs no Chromium and no node_modules per project: we zip the studio
sources (src/, public/, the manifests), send them to a Modal function whose image already has node,
Chromium and the studio's node_modules (`npm ci` baked once from package.json/package-lock.json), and
write the bytes it returns into the project.

Same shape as whatif-code-studio's bench worker, without the telemetry: `enforceAudioTrack: true`
(Remotion mixes the composition's `<Audio>` stems from `timeline.json`, and `master.py` normalises
the final audio to -14 LUFS), jpeg frames at quality 92, h264/yuv420p, crf 18, bounded concurrency.

Env: MODAL_TOKEN_ID / MODAL_TOKEN_SECRET (or ~/.modal.toml), WHATIF_MODAL_APP (default whatif-app-render),
WHATIF_MODAL_VCPU (8), WHATIF_MODAL_MEMORY_MIB (12288).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import zipfile
from io import BytesIO


def load_token_env() -> str | None:
    """Modal reads ~/.modal.toml itself, but a read-only mount with a single active profile is not
    always honoured. Copying the credentials into the environment always wins, so do it first."""
    if os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET"):
        return "environment"
    candidates = [os.environ.get("MODAL_CONFIG_PATH"), str(pathlib.Path.home() / ".modal.toml")]
    # HOME can be stale after the entrypoint drops privileges: look in the usual homes too
    candidates += ["/home/node/.modal.toml", "/root/.modal.toml", os.path.expanduser("~/.modal.toml")]
    path = next((pathlib.Path(c) for c in candidates if c and pathlib.Path(c).is_file()), None)
    if path is None:
        return None
    try:
        import tomllib

        data = tomllib.loads(path.read_text())
    except Exception:
        return None
    sections = {k: v for k, v in data.items() if isinstance(v, dict) and v.get("token_id") and v.get("token_secret")}
    wanted = os.environ.get("MODAL_PROFILE")
    chosen = sections.get(wanted) if wanted else None
    if chosen is None:
        chosen = next((v for v in sections.values() if v.get("active") is True), None)
    if chosen is None and sections:
        chosen = next(iter(sections.values()))
    if chosen is None:
        return None
    os.environ["MODAL_TOKEN_ID"] = str(chosen["token_id"])
    os.environ["MODAL_TOKEN_SECRET"] = str(chosen["token_secret"])
    return f"{path}"


TOKEN_SOURCE = load_token_env()

import modal  # noqa: E402  (must come after the token is in the environment)

HERE = pathlib.Path(__file__).resolve().parent
SKIP_DIRS = {"node_modules", "out", ".git", ".whatif", "dist", "__pycache__"}
SKIP_FILES = {".DS_Store"}
NODE_VERSION = "v24.14.0"
FONTS = {
    "BricolageGrotesque-latin.woff2": "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9H6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiawA1Xp.woff2",
    "FragmentMono-400-latin.woff2": "https://fonts.gstatic.com/s/fragmentmono/v6/4iCr6K5wfMRRjxp0DA6-2CLnB4NHhg.woff2",
    "Kalam-400-latin.woff2": "https://fonts.gstatic.com/s/kalam/v18/YA9dr0Wd4kDdMthROCc.woff2",
    "Kalam-700-latin.woff2": "https://fonts.gstatic.com/s/kalam/v18/YA9Qr0Wd4kDdMtDqHTLMkiQ.woff2",
}

# Chromium's runtime libraries, as used by the working whatif-code-studio Modal image.
CHROMIUM_LIBS = (
    "ca-certificates", "curl", "xz-utils", "ffmpeg", "fontconfig",
    "fonts-liberation", "fonts-noto-core", "fonts-dejavu-core",
    "libnss3", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2",
    "libxkbcommon0", "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2",
    "libgbm1", "libasound2", "libpango-1.0-0", "libcairo2", "libx11-xcb1",
    "libxcb-dri3-0", "libxshmfence1", "libglu1-mesa",
)


def emit(**payload) -> None:
    print("PROGRESS_JSON:" + json.dumps(payload, ensure_ascii=False), flush=True)


def result(**payload) -> None:
    print("RESULT_JSON:" + json.dumps(payload, ensure_ascii=False), flush=True)


# ------------------------------------------------------------------ sources
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def zip_sources(project: pathlib.Path, exclude_audio: bool = True) -> bytes:
    """Everything Remotion needs to bundle, minus node_modules, produced files, and bulky local audio stems."""
    buf = BytesIO()
    total = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for base in ("src", "public"):
            root = project / base
            if not root.is_dir():
                continue
            for p in sorted(root.rglob("*")):
                if p.is_dir() or any(part in SKIP_DIRS for part in p.parts):
                    continue
                if p.name in SKIP_FILES or p.suffix == ".log":
                    continue
                if exclude_audio and base == "public" and p.suffix.lower() in AUDIO_EXTS:
                    continue
                zf.write(p, p.relative_to(project).as_posix())
                total += p.stat().st_size
        for name in ("package.json", "package-lock.json", "remotion.config.ts", "tsconfig.json"):
            p = project / name
            if p.is_file():
                zf.write(p, name)
                total += p.stat().st_size
    print(f"[modal] sources: {len(buf.getvalue()) / 1e6:.2f} MB compressed ({total / 1e6:.2f} MB raw)", flush=True)
    return buf.getvalue()


def build_image(project: pathlib.Path) -> modal.Image:
    """Node + Chromium + the studio's node_modules, cached by Modal on the manifests' content."""
    fonts = ["mkdir -p /usr/local/share/fonts/remotion-google-fonts"]
    for name, url in FONTS.items():
        fonts.append(f"curl -fsSL '{url}' -o '/usr/local/share/fonts/remotion-google-fonts/{name}'")
    fonts.append("fc-cache -f >/dev/null 2>&1 || true")
    pkg = project / "package.json"
    lock = project / "package-lock.json"
    img = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install(*CHROMIUM_LIBS)
        .run_commands(
            f"curl -fsSL https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1",
            "node --version",
            "mkdir -p /opt/studio/scripts",
            *fonts,
        )
        .add_local_file(str(pkg), "/opt/studio/package.json", copy=True)
    )
    if lock.is_file():
        img = img.add_local_file(str(lock), "/opt/studio/package-lock.json", copy=True)
    install = "npm ci --no-audit --no-fund" if lock.is_file() else "npm install --no-audit --no-fund"
    return img.run_commands(f"cd /opt/studio && {install} && npx remotion browser ensure").add_local_file(
        str(HERE / "render_run.mjs"), "/opt/studio/scripts/render_run.mjs", copy=True
    )


def make_app(project: pathlib.Path):
    """Modal functions have their image fixed at decoration time, so build them per project."""
    app = modal.App(os.environ.get("WHATIF_MODAL_APP", "whatif-app-render"))
    image = build_image(project)

    @app.function(
        image=image,
        cpu=float(os.environ.get("WHATIF_MODAL_VCPU", "8")),
        memory=int(os.environ.get("WHATIF_MODAL_MEMORY_MIB", "12288")),
        timeout=2400,
        max_containers=int(os.environ.get("WHATIF_MODAL_MAX_CONTAINERS", "12")),
        scaledown_window=300,
        retries=0,
        serialized=True,  # the function lives in a closure: it carries its own image
    )
    def render(
        sources_zip: bytes,
        slug: str,
        mode: str = "stills",
        scale: float = 1.0,
        frames: str = "",
        shots_filter: str = "",
        concurrency: int = 6,
        crf: int = 18,
        typecheck: bool = False,
        timeout_ms: int = 120000,
        strip_audio: bool = True,
    ) -> dict:
        import hashlib, shutil, subprocess, tempfile, zipfile as zf_mod
        from pathlib import Path

        t0 = time.perf_counter()
        out: dict = {"ok": False, "mode": mode, "video": None, "stills": {}, "log": "", "timings": {}}
        work = Path(tempfile.mkdtemp(prefix="whatif_render_"))
        try:
            t = time.perf_counter()
            with zf_mod.ZipFile(BytesIO(sources_zip)) as z:
                z.extractall(work)
            (work / "node_modules").symlink_to("/opt/studio/node_modules")
            out["timings"]["unzip"] = round(time.perf_counter() - t, 3)
            out["sources_sha256"] = hashlib.sha256(sources_zip).hexdigest()[:16]
            out["sources_bytes"] = len(sources_zip)

            runner_path = "/opt/studio/scripts/render_run.mjs"
            if strip_audio:
                tl_file = work / "src" / "episodes" / slug / "timeline.json"
                if tl_file.is_file():
                    try:
                        tl_obj = json.loads(tl_file.read_text(encoding="utf-8"))
                        tl_obj["audio"] = {}
                        tl_file.write_text(json.dumps(tl_obj, ensure_ascii=False), encoding="utf-8")
                    except Exception:
                        pass
                try:
                    runner_src = Path(runner_path).read_text(encoding="utf-8")
                    runner_src = runner_src.replace(
                        "enforceAudioTrack: true,\n    audioCodec: 'aac',\n    audioBitrate: '320k',",
                        "muted: true,",
                    )
                    local_runner = work / "_render_run_muted.mjs"
                    local_runner.write_text(runner_src, encoding="utf-8")
                    runner_path = str(local_runner)
                except Exception:
                    pass

            logs: list[str] = []

            def run(cmd: list[str], label: str) -> int:
                t = time.perf_counter()
                proc = subprocess.run(cmd, cwd=str(work), capture_output=True, text=True, encoding="utf-8", errors="replace")
                out["timings"][label] = round(time.perf_counter() - t, 3)
                tail = (proc.stdout or "") + (proc.stderr or "")
                logs.append(f"$ {' '.join(cmd)}\n{tail[-6000:]}")
                return proc.returncode

            if typecheck:
                rc = run(["npx", "tsc", "--noEmit"], "typecheck")
                out["typecheck_ok"] = rc == 0
                out["typecheck_log"] = logs[-1][-4000:]
                if rc != 0 and mode == "check":
                    out["log"] = "\n".join(logs)
                    return out

            out_dir = work / "out" / slug
            out_dir.mkdir(parents=True, exist_ok=True)
            cmd = [
                "node", runner_path,
                "--mode", mode, "--slug", slug, "--out-dir", str(out_dir),
                "--scale", str(scale), "--concurrency", str(concurrency),
                "--crf", str(crf), "--timeout-ms", str(timeout_ms),
            ]
            if frames:
                cmd += ["--frames", frames]
            if shots_filter:
                cmd += ["--shots", shots_filter]
            t = time.perf_counter()
            proc = subprocess.run(cmd, cwd=str(work), capture_output=True, text=True, encoding="utf-8", errors="replace")
            out["timings"]["node"] = round(time.perf_counter() - t, 3)
            stdout_lines = (proc.stdout or "").splitlines()
            non_prog = [ln for ln in stdout_lines if not ln.startswith("PROGRESS_JSON:")]
            last_prog = [ln for ln in stdout_lines if ln.startswith("PROGRESS_JSON:")][-4:]
            logs.append(
                "$ render_run.mjs\n"
                + "\n".join(last_prog + non_prog[-30:])
                + ("\n" + (proc.stderr or "")[-6000:] if proc.stderr else "")
            )
            payload = None
            for line in stdout_lines:
                if line.startswith("RESULT_JSON:"):
                    try:
                        payload = json.loads(line[len("RESULT_JSON:"):])
                    except json.JSONDecodeError:
                        pass
                elif line.startswith("PROGRESS_JSON:"):
                    print(line, flush=True)
            if proc.returncode != 0 or not payload or not payload.get("ok"):
                out["log"] = "\n".join(logs)[-12000:]
                out["returncode"] = proc.returncode
                return out

            out["ok"] = True
            out["node_result"] = {k: v for k, v in payload.items() if k not in ("stills",)}
            if mode == "video":
                # render_run.mjs writes <slug>-silent.mp4 (the audio is muxed later by master.py)
                for cand in (out_dir / f"{slug}-raw.mp4", out_dir / f"{slug}-silent.mp4", *sorted(out_dir.glob("*.mp4"))):
                    if cand.is_file():
                        out["video"] = cand.read_bytes()
                        out["video_name"] = cand.name
                        out["video_bytes"] = len(out["video"])
                        break
            elif mode == "stills":
                board = out_dir / "board"
                if board.is_dir():
                    out["stills"] = {p.stem: p.read_bytes() for p in sorted(board.glob("*.png"))}
            out["log"] = "\n".join(logs)[-8000:]
            out["timings"]["remote_total"] = round(time.perf_counter() - t0, 3)
            return out
        finally:
            shutil.rmtree(work, ignore_errors=True)

    return app, render


def mux_local_audio(project: pathlib.Path, slug: str, silent_video: pathlib.Path, target: pathlib.Path) -> None:
    """Mix local voice/sfx/music stems from timeline.json with their exact gains and mux onto silent_video."""
    import subprocess

    tl_path = project / "src" / "episodes" / slug / "timeline.json"
    audio_cfg: dict = {}
    if tl_path.is_file():
        try:
            audio_cfg = json.loads(tl_path.read_text(encoding="utf-8")).get("audio") or {}
        except Exception:
            audio_cfg = {}

    stems: list[tuple[pathlib.Path, float]] = []
    for key in ("voice", "sfx", "music"):
        rel = audio_cfg.get(key)
        if not rel:
            continue
        p = project / "public" / str(rel)
        if p.is_file():
            vol = float(audio_cfg.get(f"{key}Vol", 1.0))
            stems.append((p, vol))

    target.parent.mkdir(parents=True, exist_ok=True)
    if not stems:
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(silent_video),
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest", str(target),
        ]
        subprocess.run(cmd, check=True)
        return

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(silent_video)]
    filter_parts: list[str] = []
    mix_inputs: list[str] = []
    for idx, (sp, vol) in enumerate(stems, start=1):
        cmd += ["-i", str(sp)]
        filter_parts.append(f"[{idx}:a]aresample=48000,volume={vol:.6f}[a{idx}]")
        mix_inputs.append(f"[a{idx}]")
    if len(stems) == 1:
        filter_complex = f"{filter_parts[0]};[a1]apad[aout]"
    else:
        filter_complex = (
            ";".join(filter_parts)
            + f";{''.join(mix_inputs)}amix=inputs={len(stems)}:duration=longest:dropout_transition=0:normalize=0,apad[aout]"
        )
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
        "-shortest", str(target),
    ]
    subprocess.run(cmd, check=True)


# ------------------------------------------------------------------ CLI
def main(argv: list[str]) -> int:
    import hashlib, shutil, subprocess, tempfile

    if not argv or argv[0].startswith("-"):
        sys.stderr.write("usage: modal_render.py <slug> --mode stills|video|check [--scale 0.5] [--typecheck]\n")
        return 2
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("slug")
    ap.add_argument("shots", nargs="*", help="optional shot IDs to render in stills mode (e.g. S2 S8)")
    ap.add_argument("--mode", default="stills")
    ap.add_argument("--project", default=".")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--frames", default="")
    ap.add_argument("--concurrency", type=int, default=0)
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--typecheck", action="store_true")
    ap.add_argument("--shots", dest="shots_opt", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_intermixed_args(argv)
    all_shots = [s for s in [*(args.shots or []), *(args.shots_opt.split(",") if args.shots_opt else [])] if s.strip()]
    concurrency = args.concurrency if args.concurrency > 0 else (int(os.environ.get("WHATIF_MODAL_CONCURRENCY", "6")) if args.mode == "video" else 4)

    project = pathlib.Path(args.project).resolve()
    if not (project / "src" / "episodes" / args.slug / "episode.json").is_file():
        result(ok=False, error=f"no src/episodes/{args.slug}/episode.json in {project}")
        return 2
    if not os.environ.get("MODAL_TOKEN_ID") and not (pathlib.Path.home() / ".modal.toml").is_file():
        result(ok=False, error="no Modal credentials: set MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or mount ~/.modal.toml")
        return 2

    emit(done=0, total=4, stage="zip", message="zipping the sources (excluding bulky audio stems)")
    payload = zip_sources(project, exclude_audio=True)
    emit(done=1, total=4, stage="upload", message=f"{len(payload) / 1e6:.2f} MB -> Modal")

    out_dir = project / "out" / args.slug
    t0 = time.perf_counter()

    # Parallel chunked rendering for full-episode video renders
    if args.mode == "video" and not args.frames:
        tl_path = project / "src" / "episodes" / args.slug / "timeline.json"
        total_frames = 0
        if tl_path.is_file():
            try:
                total_frames = int(json.loads(tl_path.read_text(encoding="utf-8")).get("total") or 0)
            except Exception:
                total_frames = 0
        chunk_target = int(os.environ.get("WHATIF_MODAL_CHUNK_FRAMES", "1200"))
        max_chunks = int(os.environ.get("WHATIF_MODAL_MAX_CHUNKS", "24"))
        if total_frames > chunk_target:
            n_chunks = min(max_chunks, max(2, (total_frames + chunk_target - 1) // chunk_target))
            base_sz = total_frames // n_chunks
            rem = total_frames % n_chunks
            chunks: list[tuple[int, int]] = []
            cur = 0
            for i in range(n_chunks):
                sz = base_sz + (1 if i < rem else 0)
                chunks.append((cur, cur + sz - 1))
                cur += sz
        elif total_frames > 0:
            chunks = [(0, total_frames - 1)]
        else:
            chunks = []

        if len(chunks) > 1:
            cache_sig = hashlib.sha256(payload + f"|{args.scale}|{args.crf}".encode()).hexdigest()[:12]
            chunk_dir = out_dir / ".chunks"
            chunk_dir.mkdir(parents=True, exist_ok=True)
            chunk_paths: list[pathlib.Path] = []
            pending: list[tuple[int, int, int, pathlib.Path]] = []
            for idx, (a, b) in enumerate(chunks):
                cp = chunk_dir / f"chunk_{idx:03d}_{a}_{b}_{cache_sig}.mp4"
                chunk_paths.append(cp)
                if not (cp.is_file() and cp.stat().st_size > 1024):
                    pending.append((idx, a, b, cp))

            print(
                f"[modal] video {total_frames} frames split into {len(chunks)} chunk(s) "
                f"({len(chunks) - len(pending)} cached, {len(pending)} to render on Modal, concurrency={concurrency})",
                flush=True,
            )
            if pending:
                app, render = make_app(project)
                with modal.enable_output():
                    with app.run():
                        emit(
                            done=2,
                            total=4,
                            stage="remote",
                            message=f"Modal rendering {len(pending)}/{len(chunks)} chunk(s) in parallel",
                        )
                        spawned = [
                            (
                                idx,
                                a,
                                b,
                                cp,
                                render.spawn(
                                    payload,
                                    args.slug,
                                    mode="video",
                                    scale=args.scale,
                                    frames=f"{a}-{b}",
                                    shots_filter=",".join(all_shots),
                                    concurrency=concurrency,
                                    crf=args.crf,
                                    typecheck=False,
                                    strip_audio=True,
                                ),
                            )
                            for (idx, a, b, cp) in pending
                        ]
                        done_count = len(chunks) - len(pending)
                        for idx, a, b, cp, call in spawned:
                            res = call.get(timeout=2400)
                            if not res.get("ok") or not res.get("video"):
                                # Retry once on transient worker failure
                                retry_call = render.spawn(
                                    payload,
                                    args.slug,
                                    mode="video",
                                    scale=args.scale,
                                    frames=f"{a}-{b}",
                                    shots_filter=",".join(all_shots),
                                    concurrency=concurrency,
                                    crf=args.crf,
                                    typecheck=False,
                                    strip_audio=True,
                                )
                                res = retry_call.get(timeout=2400)
                            if not res.get("ok") or not res.get("video"):
                                elapsed = round(time.perf_counter() - t0, 1)
                                result(
                                    ok=False,
                                    mode="video",
                                    error=f"Modal chunk {idx + 1}/{len(chunks)} ({a}-{b}) failed",
                                    returncode=res.get("returncode"),
                                    log=(res.get("log") or "")[-6000:],
                                    elapsedSec=elapsed,
                                )
                                return 1
                            cp.write_bytes(res["video"])
                            done_count += 1
                            emit(
                                done=done_count,
                                total=len(chunks),
                                stage="remote",
                                message=f"chunk {done_count}/{len(chunks)} ready (frames {a}-{b})",
                            )

            emit(done=3, total=4, stage="mux", message="stitching video chunks and mixing local audio stems")
            tmp_concat = pathlib.Path(tempfile.mkdtemp(prefix="whatif_concat_"))
            try:
                concat_list = tmp_concat / "concat.txt"
                concat_list.write_text(
                    "\n".join(f"file '{cp.resolve().as_posix()}'" for cp in chunk_paths) + "\n",
                    encoding="utf-8",
                )
                silent_joined = tmp_concat / "silent_joined.mp4"
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-v", "error",
                        "-f", "concat", "-safe", "0", "-i", str(concat_list),
                        "-map", "0:v:0", "-c:v", "copy", str(silent_joined),
                    ],
                    check=True,
                )
                target = pathlib.Path(args.out) if args.out else out_dir / f"{args.slug}-raw.mp4"
                mux_local_audio(project, args.slug, silent_joined, target)
            finally:
                shutil.rmtree(tmp_concat, ignore_errors=True)
            shutil.rmtree(chunk_dir, ignore_errors=True)

            elapsed = round(time.perf_counter() - t0, 1)
            emit(done=4, total=4, stage="done", message=f"1 file(s) written ({target})")
            result(
                ok=True,
                mode="video",
                slug=args.slug,
                files=[str(target)],
                chunks=len(chunks),
                totalFrames=total_frames,
                elapsedSec=elapsed,
            )
            return 0

    app, render = make_app(project)
    with modal.enable_output():
        with app.run():
            emit(done=2, total=4, stage="remote", message="Modal is rendering (bundle + frames)")
            call = render.spawn(
                payload,
                args.slug,
                mode=args.mode,
                scale=args.scale,
                frames=args.frames,
                shots_filter=",".join(all_shots),
                concurrency=concurrency,
                crf=args.crf,
                typecheck=args.typecheck,
                strip_audio=True,
            )
            res = call.get(timeout=2400)
    elapsed = round(time.perf_counter() - t0, 1)

    if not res.get("ok"):
        result(ok=False, mode=args.mode, error="Modal render failed", returncode=res.get("returncode"), log=(res.get("log") or "")[-6000:], elapsedSec=elapsed)
        return 1

    written: list[str] = []
    if args.mode == "video" and res.get("video"):
        target = pathlib.Path(args.out) if args.out else out_dir / f"{args.slug}-raw.mp4"
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_vid = pathlib.Path(tempfile.mkdtemp(prefix="whatif_single_"))
        try:
            silent_mp4 = tmp_vid / "silent.mp4"
            silent_mp4.write_bytes(res["video"])
            if not args.frames:
                mux_local_audio(project, args.slug, silent_mp4, target)
            else:
                target.write_bytes(res["video"])
        finally:
            shutil.rmtree(tmp_vid, ignore_errors=True)
        written.append(str(target))
    elif args.mode == "stills" and res.get("stills"):
        board = out_dir / "board"
        board.mkdir(parents=True, exist_ok=True)
        for name, data in res["stills"].items():
            (board / f"{name}.png").write_bytes(data)
            written.append(str(board / f"{name}.png"))

    emit(done=4, total=4, stage="done", message=f"{len(written)} file(s) written")
    node = res.get("node_result") or {}
    result(
        ok=True,
        mode=args.mode,
        slug=args.slug,
        files=written,
        elapsedSec=elapsed,
        remoteTimings=res.get("timings"),
        bundleSec=(node.get("timings") or {}).get("bundle"),
        renderSec=(node.get("timings") or {}).get("render"),
        compositions=node.get("compositions"),
        typecheckOk=res.get("typecheck_ok"),
        log=(res.get("log") or "")[-1500:] if args.mode == "check" else None,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:  # keep the failure machine-readable for the orchestrator
        result(ok=False, error=f"{type(exc).__name__}: {exc}")
        sys.exit(1)
