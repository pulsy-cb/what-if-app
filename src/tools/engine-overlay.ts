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
type PatchGroup = { file: string; marker: string; ops: Op[] };

const PATCHES: PatchGroup[] = [
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
    marker: "export * from './views';",
    ops: [{ kind: 'after', anchor: "export * from './rig';\n", insert: "export * from './views';\n" }],
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
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
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
      report.skipped.push({ file: g.file, reason: 'file not found' });
      continue;
    }
    const src = fs.readFileSync(target, 'utf8');
    if (src.includes(g.marker)) {
      report.identical.push(g.file);
      continue;
    }
    const res = applyGroup(src, g);
    if ('error' in res) {
      report.skipped.push({ file: g.file, reason: `${res.error} (this engine copy differs): nothing in this file was changed` });
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
