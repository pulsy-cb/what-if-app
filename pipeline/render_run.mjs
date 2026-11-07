#!/usr/bin/env node
/**
 * Programmatic Remotion renderer (stills + video) used by pipeline/modal_render.py.
 *
 * Runs with cwd = the studio sources, next to a node_modules (the Modal image symlinks it in).
 * Emits machine-readable lines on stdout:
 *   PROGRESS_JSON:{"done":n,"total":m,"message":"..."}   during the work
 *   RESULT_JSON:{...}                                     once, at the end
 *
 * Modes:
 *   stills  one PNG per timeline shot -> <out-dir>/board/<shot-id>.png
 *   video   h264/yuv420p aac, jpeg frames. The audio comes from the composition itself (engine/episode.tsx
 *           renders <Audio> from timeline.audio), because master.py normalises the muxed track.
 *   bundle  only bundle and report the serve url + the composition list
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const studioDir = process.cwd();
const require = createRequire(path.join(studioDir, 'package.json'));
const { bundle } = require('@remotion/bundler');
const { renderStill, renderMedia, selectComposition } = require('@remotion/renderer');

const mono = () => Number(process.hrtime.bigint()) / 1e9;
const emit = (obj) => process.stdout.write(`PROGRESS_JSON:${JSON.stringify(obj)}\n`);
const result = (obj) => process.stdout.write(`RESULT_JSON:${JSON.stringify(obj)}\n`);

function parseArgs(argv) {
  const o = {
    mode: 'stills',
    slug: '',
    outDir: '',
    entryPoint: 'src/index.ts',
    publicDir: 'public',
    output: '',
    frames: '',
    shots: '',
    stillsDir: '',
    scale: 1,
    concurrency: 4,
    crf: 18,
    pixelFormat: 'yuv420p',
    timeoutMs: 120000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--mode') o.mode = next();
    else if (a === '--slug') o.slug = next();
    else if (a === '--out-dir') o.outDir = next();
    else if (a === '--entry-point') o.entryPoint = next();
    else if (a === '--public-dir') o.publicDir = next();
    else if (a === '--output') o.output = next();
    else if (a === '--frames') o.frames = next();
    else if (a === '--shots') o.shots = next();
    else if (a === '--stills-dir') o.stillsDir = next();
    else if (a === '--scale') o.scale = Number(next());
    else if (a === '--concurrency') o.concurrency = Number(next());
    else if (a === '--crf') o.crf = Number(next());
    else if (a === '--pixel-format') o.pixelFormat = next();
    else if (a === '--timeout-ms') o.timeoutMs = Number(next());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.slug) throw new Error('--slug is required');
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const epPath = path.resolve(studioDir, 'src/episodes', opts.slug, 'episode.json');
const tlPath = path.resolve(studioDir, 'src/episodes', opts.slug, 'timeline.json');
if (!fs.existsSync(epPath)) throw new Error(`no episode.json at ${epPath}`);
const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
const tl = fs.existsSync(tlPath) ? JSON.parse(fs.readFileSync(tlPath, 'utf8')) : {};
const outDir = path.resolve(opts.outDir || path.join(studioDir, 'out', opts.slug));
fs.mkdirSync(outDir, { recursive: true });

/** "0-59" / "12" / "0-59,120-150" -> a Remotion frameRange (or undefined for the whole video). */
function parseFrames(spec, total) {
  if (!spec) return undefined;
  const [a, b] = String(spec).split(/[,;]/)[0].split(/[-:]/).map((n) => Number(n.trim()));
  if (!Number.isFinite(a)) return undefined;
  const start = Math.max(0, Math.min(total - 1, a));
  const end = Number.isFinite(b) ? Math.max(start, Math.min(total - 1, b)) : start;
  return [start, end];
}

const timings = {};
const t0 = mono();

emit({ done: 0, total: 1, stage: 'bundle', message: `Bundling ${opts.slug}...` });
const tBundle = mono();
const serveUrl = await bundle({
  entryPoint: path.resolve(studioDir, opts.entryPoint),
  publicDir: path.resolve(studioDir, opts.publicDir),
  onProgress: (p) => emit({ done: p, total: 100, stage: 'bundle', message: `Bundling ${p}%` }),
});
timings.bundle = Number((mono() - tBundle).toFixed(3));
emit({ done: 1, total: 1, stage: 'bundle', message: `Bundle ready in ${timings.bundle}s` });

const base = {
  serveUrl,
  chromiumOptions: {}, // no --gl flag: the engine is pure SVG/DOM, and Remotion's own default works

  timeoutInMilliseconds: opts.timeoutMs,
  browserExecutable: null,
  onBrowserLog: null,
};

if (opts.mode === 'bundle') {
  const { getCompositions } = require('@remotion/renderer');
  const comps = await getCompositions(serveUrl, {});
  result({ ok: true, mode: 'bundle', timings, compositions: comps.map((c) => ({ id: c.id, fps: c.fps, width: c.width, height: c.height, durationInFrames: c.durationInFrames })) });
  process.exit(0);
}

if (opts.mode === 'stills') {
  const compId = `${ep.id}Board`;
  const composition = await selectComposition({ ...base, id: compId });
  const shots = Array.isArray(tl.shots) && tl.shots.length ? tl.shots : [{ id: 'one' }];
  const onlySet = new Set(
    String(opts.shots || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const dir = path.resolve(opts.stillsDir || path.join(outDir, 'board'));
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  emit({ done: 0, total: shots.length + 1, stage: 'stills', message: `${shots.length} storyboard stills` });
  for (let i = 0; i < shots.length; i++) {
    const id = String(shots[i].id || `shot-${i + 1}`);
    if (onlySet.size > 0 && !onlySet.has(id)) continue;
    const file = path.join(dir, `${id}.png`);
    await renderStill({ ...base, composition, frame: i, output: file, overwrite: true, scale: opts.scale });
    files.push({ id, path: file, bytes: fs.statSync(file).size });
    emit({ done: i + 1, total: shots.length + 1, stage: 'stills', message: `still ${id} (${i + 1}/${shots.length})` });
  }
  result({ ok: true, mode: 'stills', dir, stills: files, timings: { ...timings, total: Number((mono() - t0).toFixed(3)) } });
  process.exit(0);
}

if (opts.mode === 'video') {
  const composition = await selectComposition({ ...base, id: ep.id });
  const total = Number(tl.total || composition.durationInFrames);
  const range = parseFrames(opts.frames, total);
  const output = path.resolve(opts.output || path.join(outDir, `${opts.slug}-silent.mp4`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const resolved = {
    ...composition,
    durationInFrames: total,
    width: Number(tl.width || composition.width),
    height: Number(tl.height || composition.height),
    fps: Number(tl.fps || composition.fps),
  };
  const tRender = mono();
  let lastPct = -1;
  await renderMedia({
    ...base,
    composition: resolved,
    codec: 'h264',
    crf: opts.crf,
    pixelFormat: opts.pixelFormat,
    imageFormat: 'jpeg',
    jpegQuality: 92,
    outputLocation: output,
    overwrite: true,
    // the voice/sfx/music are <Audio> inside the composition: master.py takes this track as-is
    enforceAudioTrack: true,
    audioCodec: 'aac',
    audioBitrate: '320k',
    concurrency: opts.concurrency,
    ...(opts.scale && opts.scale !== 1 ? { scale: opts.scale } : {}),
    ...(range ? { frameRange: range } : {}),
    onProgress: ({ renderedFrames, encodedFrames, stitchStage }) => {
      const pct = Math.min(100, Math.round((100 * Number(renderedFrames || 0)) / Math.max(1, total)));
      if (pct !== lastPct) {
        lastPct = pct;
        emit({ done: Number(renderedFrames || 0), total, stage: 'render', message: `${pct}% (${renderedFrames}/${total} frames, ${encodedFrames || 0} encoded, ${stitchStage || ''})` });
      }
    },
  });
  timings.render = Number((mono() - tRender).toFixed(3));
  result({
    ok: true,
    mode: 'video',
    output,
    bytes: fs.statSync(output).size,
    frames: total,
    frameRange: range || null,
    scale: opts.scale,
    fps: resolved.fps,
    width: resolved.width,
    height: resolved.height,
    timings: { ...timings, total: Number((mono() - t0).toFixed(3)) },
  });
  process.exit(0);
}

throw new Error(`unknown mode ${opts.mode}`);
