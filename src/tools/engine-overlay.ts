import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The engine comes from the external skill and every project keeps its own (diverging) copy. This applies the
 * improvements the app owns (engine-overlay/) on top of a project's src/engine: files are added or replaced, small
 * edits are idempotent text patches located by an anchor. A patch whose anchor is missing changes nothing and says so.
 */
const OVERLAY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine-overlay');

/** One edit inside a patch group: insert after an anchor, or replace an exact text a known number of times. */
type Op =
  | { kind: 'after'; anchor: string; insert: string }
  | { kind: 'replace'; find: string; replace: string; count: number };

/**
 * Edits to one file, applied all together or not at all: if any anchor is missing (the engine copy differs), nothing
 * in the group is written and the reason is reported. `marker` is text that is present once the group has been applied.
 */
type PatchGroup = { file: string; marker: string; ops: Op[]; optional?: boolean };

const PATCHES: PatchGroup[] = [
  {
    // an older engine draws every shot in a 1920 x 1080 viewBox: a 9:16 episode would fill only the top of its frame
    file: 'src/engine/episode.tsx',
    marker: 'IS_PORTRAIT',
    ops: [
      {
        kind: 'after',
        anchor: "from 'remotion';\n",
        insert:
          "import { STUDIO } from '../studio.config';\n\n" +
          "// World space is always centred at (960, 540). A 9:16 frame shows 900 x 1600 of it, framing the room's back wall.\n" +
          'const IS_PORTRAIT = STUDIO.height > STUDIO.width;\n' +
          'const VB = IS_PORTRAIT ? { x: 510, y: -260, w: 900, h: 1600 } : { x: 0, y: 0, w: 1920, h: 1080 };\n' +
          'const VIEW_BOX = `${VB.x} ${VB.y} ${VB.w} ${VB.h}`;\n',
      },
      { kind: 'replace', find: '<svg width={1920} height={1080} viewBox="0 0 1920 1080"', replace: '<svg width={STUDIO.width} height={STUDIO.height} viewBox={VIEW_BOX}', count: 3 },
      { kind: 'replace', find: '<rect width="1920" height="1080" fill="url(#epVig)" />', replace: '<rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#epVig)" />', count: 1 },
      { kind: 'replace', find: '<rect width="1920" height="1080" filter="url(#epGrain)" />', replace: '<rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} filter="url(#epGrain)" />', count: 1 },
    ],
  },
  {
    // a tall 9:16 frame reaches below the room's near plane: keep the floor darkening there (no light band)
    file: 'src/engine/furnish.tsx',
    marker: 'below the near plane (only a tall 9:16 frame reaches it)',
    ops: [
      {
        kind: 'after',
        anchor: "      <polygon points={Q([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]])} fill={`url(#${id}F)`} />\n",
        insert:
          "      {/* below the near plane (only a tall 9:16 frame reaches it) the floor keeps the same darkening, no light band */}\n" +
          "      <rect x={-1500} y={r.P(0, 1, 1).y} width={5000} height={2200} fill={`url(#${id}F)`} />\n",
      },
    ],
  },
  {
    // views of the character: profile, three-quarter and back heads (views.tsx), a back jacket, and a body width that
    // comes back to full when the character turns away (yaw 2). Front view is untouched.
    file: 'src/engine/rig.tsx',
    marker: '<ViewHead pose={pose}',
    ops: [
      { kind: 'after', anchor: "import React from 'react';\n", insert: "import { ViewHead, ViewTorso, foldYaw } from './views';\n" },
      { kind: 'replace', find: '          {torso}\n', replace: '          <ViewTorso pose={pose} L={L} torso={torso} />\n', count: 1 },
      {
        kind: 'replace',
        find: '          {head}\n          {children}\n',
        replace: '          <ViewHead pose={pose} L={L} head={head} headGear={headGear} />\n          {children}\n',
        count: 1,
      },
      {
        kind: 'replace',
        find: 'export const turnWidth = (yaw: number) => 1 - 0.4 * Math.min(1, Math.abs(yaw));',
        replace: 'export const turnWidth = (yaw: number) => 1 - 0.4 * Math.min(1, foldYaw(yaw));',
        count: 1,
      },
      {
        kind: 'replace',
        find: 'export const limbSpread = (yaw: number) => 1 - 0.85 * Math.min(1, Math.abs(yaw));',
        replace: 'export const limbSpread = (yaw: number) => 1 - 0.85 * Math.min(1, foldYaw(yaw));',
        count: 1,
      },
      { kind: 'replace', find: 'pose.yaw * 6', replace: 'Math.sign(pose.yaw) * foldYaw(pose.yaw) * 6', count: 4 },
    ],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './pieces';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './pieces';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './stage';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './stage';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './person';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './person';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './cast';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './cast';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './actions';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './actions';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './rooms';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './rooms';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './shot';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './shot';\n" }],
  },
  {
    // built-in narrative episode looks (memory, tension, revelation, nightmare, rewind) work out of the box when timeline segments set `look`
    file: 'src/engine/episode.tsx',
    marker: 'EPISODE_LOOKS',
    ops: [
      { kind: 'after', anchor: "import { SetDefs } from './light';\n", insert: "import { EPISODE_LOOKS } from './accents';\n" },
      {
        kind: 'replace',
        find: 'const def = run ? looks[run.look] : undefined;',
        replace: 'const def = run ? (looks[run.look] ?? EPISODE_LOOKS[run.look]) : undefined;',
        count: 1,
      },
    ],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './accents';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './accents';\n" }],
  },
  {
    // narration subtitles drawn over the whole episode from timeline.json `subtitles` (written by pipeline/sfx_run.py)
    file: 'src/engine/episode.tsx',
    marker: '<Subtitles tl={tl} f={f} />',
    ops: [
      { kind: 'after', anchor: "from 'remotion';\n", insert: "import { Subtitles } from './subtitles';\n" },
      {
        kind: 'replace',
        find: '      {A.voice ? <Audio',
        replace: '      <Subtitles tl={tl} f={f} />\n      {A.voice ? <Audio',
        count: 1,
      },
    ],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './subtitles';",
    ops: [{ kind: 'after', anchor: "export * from './furnish';\n", insert: "export * from './subtitles';\n" }],
  },
  {
    file: 'src/engine/index.ts',
    marker: "export * from './views';",
    ops: [{ kind: 'after', anchor: "export * from './rig';\n", insert: "export * from './views';\n" }],
  },
  {
    // lighten the heavy 55% black vignette and eliminate the 6% white haze grain in Grade so episodes stay crisp and vivid
    file: 'src/engine/episode.tsx',
    marker: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.015 0',
    optional: true,
    ops: [
      {
        kind: 'replace',
        find: '<stop offset="100%" stopColor="#000" stopOpacity={0.55} />',
        replace: '<stop offset="100%" stopColor="#000" stopOpacity={0.2} />',
        count: 1,
      },
      {
        kind: 'replace',
        find: 'values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0"',
        replace: 'values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.015 0"',
        count: 1,
      },
    ],
  },
  {
    // support short scene-cut dip-to-dark fade transitions in timeline fx (`kind: 'fade'`, default 6 frames centered on `e.f`)
    file: 'src/engine/episode.tsx',
    marker: "kind: 'flash' | 'shake' | 'fade'",
    optional: true,
    ops: [
      {
        kind: 'replace',
        find: "export type Fx = { f: number; kind: 'flash' | 'shake'; color?: string; o?: number; len?: number; amp?: number };",
        replace: "export type Fx = { f: number; kind: 'flash' | 'shake' | 'fade'; color?: string; o?: number; len?: number; amp?: number };",
        count: 1,
      },
      {
        kind: 'replace',
        find: '        x += Math.sin(f * 2.9) * k;\n        y += Math.cos(f * 3.7) * k * 0.7;\n      }\n    }\n  }',
        replace:
          '        x += Math.sin(f * 2.9) * k;\n' +
          '        y += Math.cos(f * 3.7) * k * 0.7;\n' +
          '      }\n' +
          "    } else if (e.kind === 'fade') {\n" +
          '      const len = Math.max(2, e.len ?? 6);\n' +
          '      const half = len / 2;\n' +
          '      const d = Math.abs(f - e.f);\n' +
          '      if (d < half) {\n' +
          '        const o = (e.o ?? 0.92) * (1 - d / half);\n' +
          "        if (!flash || o > flash.o) flash = { color: e.color ?? '#0E0C1E', o };\n" +
          '      }\n' +
          '    }\n' +
          '  }',
        count: 1,
      },
    ],
  },
];

/** The edited text, or the reason the group cannot be applied to this engine copy. */
function applyGroup(src: string, g: PatchGroup): { out: string } | { error: string } {
  let out = src;
  for (const op of g.ops) {
    if (op.kind === 'after') {
      if (out.split(op.anchor).length !== 2) return { error: `anchor not found exactly once: ${JSON.stringify(op.anchor.trim().slice(0, 60))}` };
      out = out.replace(op.anchor, op.anchor + op.insert);
    } else {
      const n = out.split(op.find).length - 1;
      if (n !== op.count) return { error: `expected ${op.count} x ${JSON.stringify(op.find.trim().slice(0, 50))}, found ${n}` };
      out = out.split(op.find).join(op.replace);
    }
  }
  return { out };
}

export type OverlayReport = {
  added: string[];
  replaced: string[];
  identical: string[];
  patched: string[];
  skipped: { file: string; reason: string }[];
};

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  // hidden files (.DS_Store from macOS) are not part of the engine
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs, base) : [path.relative(base, abs).split(path.sep).join('/')];
  });
}

/** Apply (or, with dryRun, only report) the overlay on a project. Safe to run twice: the second run changes nothing. */
export function applyEngineOverlay(projectRoot: string, opts: { dryRun?: boolean; overlayDir?: string } = {}): OverlayReport {
  const overlay = opts.overlayDir ?? OVERLAY_DIR;
  const report: OverlayReport = { added: [], replaced: [], identical: [], patched: [], skipped: [] };
  if (!fs.existsSync(path.join(projectRoot, 'src', 'engine'))) {
    report.skipped.push({ file: 'src/engine', reason: 'the project has no engine to overlay' });
    return report;
  }

  for (const rel of listFiles(path.join(overlay, 'files'))) {
    const from = path.join(overlay, 'files', rel);
    const to = path.join(projectRoot, rel);
    if (!fs.existsSync(to)) report.added.push(rel);
    else if (fs.readFileSync(from).equals(fs.readFileSync(to))) {
      report.identical.push(rel);
      continue;
    } else report.replaced.push(rel);
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }

  for (const g of PATCHES) {
    const target = path.join(projectRoot, g.file);
    if (!fs.existsSync(target)) {
      if (!g.optional) report.skipped.push({ file: g.file, reason: 'file not found' });
      continue;
    }
    const src = fs.readFileSync(target, 'utf8');
    if (src.includes(g.marker)) {
      report.identical.push(g.file);
      continue;
    }
    const res = applyGroup(src, g);
    if ('error' in res) {
      if (!g.optional) report.skipped.push({ file: g.file, reason: `${res.error} (this engine copy differs): nothing in this file was changed` });
      continue;
    }
    if (!report.patched.includes(g.file)) report.patched.push(g.file);
    if (!opts.dryRun) fs.writeFileSync(target, res.out, 'utf8');
  }
  return report;
}

export function overlaySummary(r: OverlayReport, applied: boolean): string {
  const verb = applied ? '' : 'would be ';
  const parts = [
    r.added.length ? `${verb}added: ${r.added.join(', ')}` : '',
    r.replaced.length ? `${verb}replaced: ${r.replaced.join(', ')}` : '',
    r.patched.length ? `${verb}patched: ${r.patched.join(', ')}` : '',
    r.skipped.length ? `skipped: ${r.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}` : '',
  ].filter(Boolean);
  return parts.length ? `engine overlay: ${parts.join(' | ')}` : 'engine overlay: already up to date';
}
