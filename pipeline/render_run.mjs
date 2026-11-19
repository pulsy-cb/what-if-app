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
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OPENING_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.svg']);

function fileSha256Hex32(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[k] = canonicalizeJson(value[k]);
    }
    return out;
  }
  return value;
}

function timelineSha256Hex32(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rest = {};
      for (const k of Object.keys(parsed).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (k === 'audio') continue;
        rest[k] = canonicalizeJson(parsed[k]);
      }
      return crypto.createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex').slice(0, 32);
    }
    return crypto.createHash('sha256').update(JSON.stringify(canonicalizeJson(parsed)), 'utf8').digest('hex').slice(0, 32);
  } catch {
    return fileSha256Hex32(filePath);
  }
}

function collectOpeningSourceFiles(rootDir, currentDir, skipRelPosix, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(currentDir, ent.name);
    if (ent.isDirectory()) {
      collectOpeningSourceFiles(rootDir, full, skipRelPosix, out);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!OPENING_SOURCE_EXTS.has(ext)) continue;
      const relPosix = path.relative(rootDir, full).split(path.sep).join('/');
      if (relPosix === skipRelPosix) continue;
      out.push(relPosix);
    }
  }
}

function computeOpeningInputSigs(projectRoot, slug) {
  const tlRel = `src/episodes/${slug}/timeline.json`;
  const tlPath = path.join(projectRoot, 'src', 'episodes', slug, 'timeline.json');
  const timelineSig = fs.existsSync(tlPath) && fs.statSync(tlPath).isFile() ? timelineSha256Hex32(tlPath) : null;

  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  if (!fs.existsSync(epDir) || !fs.statSync(epDir).isDirectory()) return { timelineSig, sourcesSig: null };
  const epFiles = [];
  collectOpeningSourceFiles(projectRoot, epDir, tlRel, epFiles);
  if (!epFiles.length) return { timelineSig, sourcesSig: null };

  const allFiles = [...epFiles];
  for (const extraRel of ['src/Root.tsx', 'src/studio.config.ts']) {
    const p = path.join(projectRoot, extraRel);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) allFiles.push(extraRel);
    } catch {
      /* ignore */
    }
  }
  const engineDir = path.join(projectRoot, 'src', 'engine');
  if (fs.existsSync(engineDir)) collectOpeningSourceFiles(projectRoot, engineDir, tlRel, allFiles);

  const uniqueSorted = [...new Set(allFiles)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const relPosix of uniqueSorted) {
    const fSha = fileSha256Hex32(path.join(projectRoot, ...relPosix.split('/')));
    if (!fSha) return { timelineSig, sourcesSig: null };
    h.update(`${relPosix}\0${fSha}\n`, 'utf8');
  }
  return { timelineSig, sourcesSig: h.digest('hex').slice(0, 32) };
}

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

function sameOpeningInputSigs(a, b) {
  return Boolean(a && b) && a.timelineSig === b.timelineSig && a.sourcesSig === b.sourcesSig;
}

const timings = {};
const t0 = mono();

// Snapshot cryptographic signatures BEFORE bundling so any source/timeline mutation during bundling or rendering is caught.
const preBundleSigs = computeOpeningInputSigs(studioDir, opts.slug);

emit({ done: 0, total: 1, stage: 'bundle', message: `Bundling ${opts.slug}...` });
const tBundle = mono();
const serveUrl = await bundle({
  entryPoint: path.resolve(studioDir, opts.entryPoint),
  publicDir: path.resolve(studioDir, opts.publicDir),
  onProgress: (p) => emit({ done: p, total: 100, stage: 'bundle', message: `Bundling ${p}%` }),
});
timings.bundle = Number((mono() - tBundle).toFixed(3));
const postBundleSigs = computeOpeningInputSigs(studioDir, opts.slug);
emit({ done: 1, total: 1, stage: 'bundle', message: `Bundle ready in ${timings.bundle}s` });

function resolveBrowserExecutable() {
  const fromEnv = process.env.REMOTION_CHROME_EXECUTABLE || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (fs.existsSync(path.join(studioDir, 'node_modules', '.remotion'))) return null;
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const base = {
  serveUrl,
  chromiumOptions: {}, // no --gl flag: the engine is pure SVG/DOM, and Remotion's own default works

  timeoutInMilliseconds: opts.timeoutMs,
  browserExecutable: resolveBrowserExecutable(),
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
  const rawComp = await selectComposition({ ...base, id: compId });
  const isPortrait = String(ep.aspect || tl.aspect || '').trim() === '9:16';
  const composition = {
    ...rawComp,
    width: isPortrait ? 1080 : Number(tl.width || rawComp.width),
    height: isPortrait ? 1920 : Number(tl.height || rawComp.height),
  };
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
    try {
      await renderStill({ ...base, composition, frame: i, output: file, overwrite: true, scale: opts.scale });
    } catch (err) {
      const msg = `CRASH rendering still ${id} (shot ${i + 1}/${shots.length}, frame ${i}, key=${shots[i]?.key ?? '?'}): ${err?.stack || err?.message || err}`;
      process.stderr.write(`${msg}\n`);
      result({ ok: false, mode: 'stills', failedShot: id, error: msg });
      process.exit(1);
    }
    files.push({ id, path: file, bytes: fs.statSync(file).size });
    emit({ done: i + 1, total: shots.length + 1, stage: 'stills', message: `still ${id} (${i + 1}/${shots.length})` });
  }

  // Render exact opening frames (0, 30, 60) from the main <Episode> composition so opening.jpg shows real frames, never recycled keyframes.
  const totalFrames = Math.max(1, Number(tl.total || 0));
  const openingTargets = [0, 30, 60].filter((fr) => fr < totalFrames);
  const openingDir = path.join(outDir, 'opening');
  const manifestPath = path.join(openingDir, 'manifest.json');

  if (!sameOpeningInputSigs(preBundleSigs, postBundleSigs)) {
    fs.rmSync(manifestPath, { force: true });
    const msg =
      `episode/engine sources or timeline.json mutated while bundling (preBundle=${JSON.stringify(preBundleSigs)} vs ` +
      `postBundle=${JSON.stringify(postBundleSigs)}); opening manifest refused/erased`;
    process.stderr.write(`${msg}\n`);
    result({ ok: false, mode: 'stills', reason: 'inputs_mutated_during_bundle', error: msg, preBundleSigs, postBundleSigs });
    process.exit(1);
  }

  let existingManifest = null;
  try {
    if (fs.existsSync(manifestPath)) existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    existingManifest = null;
  }
  const segs = Array.isArray(tl.segments) ? tl.segments : [];
  const openingShots = new Set([
    ...segs.filter((s) => Number(s?.a ?? 0) <= 60).map((s) => String(s.shot || '')),
    ...shots.filter((s) => Number(s?.first ?? 0) <= 60).map((s) => String(s.id || '')),
  ]);
  const manifestMatchesInputs = Boolean(
    existingManifest &&
      preBundleSigs.timelineSig &&
      preBundleSigs.sourcesSig &&
      existingManifest.timelineSig === preBundleSigs.timelineSig &&
      existingManifest.sourcesSig === preBundleSigs.sourcesSig &&
      openingTargets.every((fr) => {
        const entry = existingManifest.frames?.[String(fr)];
        const fn = `f${String(fr).padStart(4, '0')}.png`;
        const fp = path.join(openingDir, fn);
        return entry && entry.file === fn && fs.existsSync(fp) && fileSha256Hex32(fp) === entry.sha256;
      }),
  );
  const shouldRenderOpening =
    onlySet.size === 0 || !manifestMatchesInputs || [...onlySet].some((id) => openingShots.has(id));

  const openingFiles = [];
  const manifestFrames = {};
  if (shouldRenderOpening && openingTargets.length > 0) {
    fs.mkdirSync(openingDir, { recursive: true });
    // Erase any prior manifest before overwriting opening PNGs so an interrupted/mutated render never leaves a valid-looking manifest.
    fs.rmSync(manifestPath, { force: true });
    const rawMainComp = await selectComposition({ ...base, id: ep.id });
    const mainComp = {
      ...rawMainComp,
      durationInFrames: Math.max(totalFrames, Number(rawMainComp.durationInFrames || 1)),
      width: isPortrait ? 1080 : Number(tl.width || rawMainComp.width),
      height: isPortrait ? 1920 : Number(tl.height || rawMainComp.height),
      fps: Number(tl.fps || rawMainComp.fps),
    };
    for (const fr of openingTargets) {
      const name = `f${String(fr).padStart(4, '0')}.png`;
      const outFile = path.join(openingDir, name);
      try {
        await renderStill({ ...base, composition: mainComp, frame: fr, output: outFile, overwrite: true, scale: opts.scale });
        const bytes = fs.statSync(outFile).size;
        const sha256 = fileSha256Hex32(outFile);
        openingFiles.push({ frame: fr, path: outFile, bytes, sha256 });
        manifestFrames[String(fr)] = { file: name, sha256, bytes };
      } catch (err) {
        fs.rmSync(manifestPath, { force: true });
        const msg = `CRASH rendering opening frame ${fr}: ${err?.stack || err?.message || err}`;
        process.stderr.write(`${msg}\n`);
        result({ ok: false, mode: 'stills', failedFrame: fr, error: msg });
        process.exit(1);
      }
    }
  }

  // Re-verify cryptographic input signatures AFTER all stills & opening frames have rendered:
  // if any source or timeline changed during rendering, erase manifest.json and fail closed so old bundled images are NEVER bound to new sources.
  const postRenderSigs = computeOpeningInputSigs(studioDir, opts.slug);
  if (!sameOpeningInputSigs(preBundleSigs, postRenderSigs)) {
    fs.rmSync(manifestPath, { force: true });
    const msg =
      `episode/engine sources or timeline.json mutated during render (preBundle=${JSON.stringify(preBundleSigs)} vs ` +
      `postRender=${JSON.stringify(postRenderSigs)}); opening manifest refused/erased`;
    process.stderr.write(`${msg}\n`);
    result({ ok: false, mode: 'stills', reason: 'inputs_mutated_during_render', error: msg, preBundleSigs, postRenderSigs });
    process.exit(1);
  }

  if (shouldRenderOpening && openingTargets.length > 0) {
    const pngTampered = openingTargets.some((fr) => {
      const entry = manifestFrames[String(fr)];
      const fp = path.join(openingDir, `f${String(fr).padStart(4, '0')}.png`);
      return !entry?.sha256 || !fs.existsSync(fp) || fileSha256Hex32(fp) !== entry.sha256;
    });
    if (pngTampered) {
      fs.rmSync(manifestPath, { force: true });
      const msg = 'rendered opening PNG missing or modified before manifest commit; opening manifest refused/erased';
      process.stderr.write(`${msg}\n`);
      result({ ok: false, mode: 'stills', reason: 'opening_png_tampered_during_render', error: msg });
      process.exit(1);
    }
    if (preBundleSigs.timelineSig && preBundleSigs.sourcesSig) {
      const tmpManifest = `${manifestPath}.tmp.${process.pid}`;
      fs.writeFileSync(
        tmpManifest,
        JSON.stringify(
          {
            version: 1,
            slug: opts.slug,
            timelineSig: preBundleSigs.timelineSig,
            sourcesSig: preBundleSigs.sourcesSig,
            expectedFrames: openingTargets,
            frames: manifestFrames,
            renderedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
      );
      fs.renameSync(tmpManifest, manifestPath);
    } else {
      fs.rmSync(manifestPath, { force: true });
    }
  } else if (!preBundleSigs.timelineSig || !preBundleSigs.sourcesSig) {
    fs.rmSync(manifestPath, { force: true });
  }

  result({ ok: true, mode: 'stills', dir, stills: files, opening: openingFiles, timings: { ...timings, total: Number((mono() - t0).toFixed(3)) } });
  process.exit(0);
}

if (opts.mode === 'video') {
  const composition = await selectComposition({ ...base, id: ep.id });
  const total = Number(tl.total || composition.durationInFrames);
  const range = parseFrames(opts.frames, total);
  const output = path.resolve(opts.output || path.join(outDir, `${opts.slug}-silent.mp4`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const isPortrait = String(ep.aspect || tl.aspect || '').trim() === '9:16';
  const resolved = {
    ...composition,
    durationInFrames: total,
    width: isPortrait ? 1080 : Number(tl.width || composition.width),
    height: isPortrait ? 1920 : Number(tl.height || composition.height),
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
