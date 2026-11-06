import fs from 'node:fs';
import path from 'node:path';
import { exec } from './exec.js';
import type { Artifact, Tool, ToolResult } from './types.js';
import { kindOf, mimeOf, relOf, safeJoin } from './paths.js';

const PY = process.platform === 'win32' ? 'python' : 'python3';

const EPISODE_STUB = (slug: string) => ({
  id: slug.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase()),
  slug,
  topic: '',
  title: ['WHAT IF YOU COULD', '…?'],
  accent: '',
  power: { word: '', rule: '', look: '' },
  script: [
    { beat: '1 cold open, demo 1 (small and selfish)', text: 'TODO' },
    { beat: '1 cold open, demo 2 (useful)', text: 'TODO' },
    { beat: '1 cold open, demo 3 (a little uncanny)', text: 'TODO' },
    { beat: '2 the premise (title card)', text: 'What if you could …?' },
    { beat: '4 the turn: the cost, one real fact', text: 'TODO — with one real, sourced number.' },
    { beat: '5-7 folded into a question', text: 'TODO?' },
  ],
  science: [{ claim: 'TODO', working: 'TODO — the arithmetic.', source: 'TODO' }],
  cast: ['pipHood'],
  shots: [{ id: 'S1', size: 'medium', set: 'kitchen', key: 12, note: 'placeholder: replace with the real shot' }],
  edit: [{ shot: 'S1', at: 'f:0' }],
  fx: [],
});

const SHOT_STUB = `import React from 'react';
import {
  Hero, LOOKS, basePose, poseAt, faceAt, camT, kf, ShotProps,
  Kitchen, KITCHEN, islandTop, stand, Cookie,
} from '../../engine';

// A placeholder shot. Each shot is a pure function of its own clock t: no state, no Math.random().
const PIP = LOOKS.pipHood;
const STAND = stand(KITCHEN, 0.42, 0.4);
const COOKIE = islandTop(0.6, 0.45);

export const S1: React.FC<ShotProps> = ({ t, len }) => {
  const pose = poseAt(t, [
    { f: 0, p: { x: STAND.x, y: STAND.y, scale: STAND.scale, yaw: 0.4, look: 0.6 } },
  ]);
  const face = faceAt(t, [[0, 'neutral']]);
  return (
    <g transform={camT(kf(t, [[0, 990], [len, 1000]]), 600, 1.9)}>
      <Kitchen t={t} id="k1" />
      <Cookie x={COOKIE.x} y={COOKIE.y} />
      <Hero look={PIP} pose={{ ...basePose, ...pose, ...face }} rimId="rim1" shadow={0} />
    </g>
  );
};
`;

const INDEX_STUB = `import { defineEpisode, Timeline } from '../../engine';
import timeline from './timeline.json';
import { S1 } from './shots';

// The episode: its timeline (written by scripts/plan.py) plus one component per shot.
export const __EXPORT__ = defineEpisode('__ID__', {
  timeline: timeline as Timeline,
  shots: { S1 },
});
`;

const TIMELINE_STUB = (slug: string) => ({
  slug,
  title: 'PLACEHOLDER',
  fps: 30,
  total: 300,
  segments: [{ shot: 'S1', a: 0, b: 300, t0: 0, t1: 300 }],
  shots: [{ id: 'S1', size: 'medium', key: 12, len: 300, first: 0 }],
  fx: [],
  audio: {},
});

function camel(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Snapshot mtimes so we can report what a step produced. */
function snapshot(root: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const sub of ['out', 'public']) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) stack.push(abs);
        else {
          try {
            out.set(relOf(root, abs), fs.statSync(abs).mtimeMs);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return out;
}

function diffArtifacts(root: string, before: Map<string, number>): Artifact[] {
  const after = snapshot(root);
  const changed: Artifact[] = [];
  for (const [rel, mtime] of after) {
    if (before.get(rel) === mtime) continue;
    const kind = kindOf(rel);
    if (kind === 'file') continue;
    changed.push({ kind, path: rel, mime: mimeOf(rel) });
  }
  return changed.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40);
}

const STEPS: Record<string, { py?: string; node?: string; timeoutMs?: number; desc: string }> = {
  install: { desc: 'npm install in the project studio', timeoutMs: 900_000 },
  voice: { py: 'voice.py', desc: 'ElevenLabs voice + word timings (costs credits)' },
  plan: { py: 'plan.py', desc: 'resolve cues into timeline.json' },
  stills: { node: 'stills.mjs', desc: 'render one still per shot' },
  board: { py: 'board.py', desc: 'build the storyboard sheet' },
  sfx: { py: 'sfx.py', desc: 'generate and place sound effects (costs credits)' },
  mixcheck: { py: 'mixcheck.py', desc: 'check the voice stays clear' },
  motiongrid: { py: 'motiongrid.py', desc: 'frame grids per shot' },
  master: { py: 'master.py', desc: 'render + master to -14 LUFS' },
};

const newProject: Tool = {
  name: 'whatif_new',
  description:
    'Scaffold the studio of a project (a copy of the skill studio, without node_modules) and one episode skeleton: episode.json, timeline.json, shots.tsx, index.tsx, registered in src/episodes/index.ts.',
  policy: 'ask',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string', description: 'Slug, e.g. "pause-everyone".' },
      force: { type: 'boolean', description: 'Scaffold into a non-empty folder.' },
    },
    required: ['episode'],
    additionalProperties: false,
  },
  validate: (input) => (/^[a-z0-9][a-z0-9-]*$/.test(String(input.episode ?? '')) ? null : 'episode must be a kebab-case slug'),
  async run(input: { episode: string; force?: boolean }, ctx): Promise<ToolResult> {
    if (!ctx.skillDir) throw new Error('WHATIF_SKILL_DIR is not set: point it at the what-if-animation skill folder');
    const studio = path.join(ctx.skillDir, 'studio');
    if (!fs.existsSync(studio)) throw new Error(`no studio/ in ${ctx.skillDir}`);

    if (fs.existsSync(ctx.projectRoot) && fs.readdirSync(ctx.projectRoot).length && !input.force) {
      throw new Error(`${ctx.projectRoot} is not empty (pass force: true to scaffold anyway)`);
    }
    fs.mkdirSync(ctx.projectRoot, { recursive: true });

    // 1. copy the studio once (engine, library, package.json); node_modules/out stay out
    fs.cpSync(studio, ctx.projectRoot, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(studio, src);
        if (!rel) return true;
        const top = rel.split(path.sep)[0]!;
        return top !== 'node_modules' && top !== 'out';
      },
    });
    // 2. the examples are not this project's episodes
    const episodesDir = path.join(ctx.projectRoot, 'src', 'episodes');
    for (const legacy of ['rewind', 'copy-paste']) {
      fs.rmSync(path.join(episodesDir, legacy), { recursive: true, force: true });
    }

    // 3. the episode skeleton
    const slug = input.episode;
    const dir = safeJoin(ctx.projectRoot, `src/episodes/${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    const ep = EPISODE_STUB(slug);
    fs.writeFileSync(path.join(dir, 'episode.json'), JSON.stringify(ep, null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TIMELINE_STUB(slug), null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'shots.tsx'), SHOT_STUB);
    fs.writeFileSync(
      path.join(dir, 'index.tsx'),
      INDEX_STUB.replace('__EXPORT__', camel(slug)).replace('__ID__', ep.id),
    );

    // 4. register it, dropping imports that point at deleted episode folders
    const registryFile = path.join(episodesDir, 'index.ts');
    const importLine = `import { ${camel(slug)} } from './${slug}';\n`;
    let src = fs.readFileSync(registryFile, 'utf8');
    const kept: string[] = [];
    src = src.replace(/^import \{ ([A-Za-z0-9_$]+) \} from '\.\/([\w.-]+)';\n/gm, (m, name: string, dir: string) => {
      if (fs.existsSync(path.join(episodesDir, dir))) {
        kept.push(name);
        return m;
      }
      return '';
    });
    if (!kept.includes(camel(slug))) {
      const lastImport = [...src.matchAll(/^import .*$/gm)].pop();
      if (lastImport?.index !== undefined) {
        const at = lastImport.index + lastImport[0].length + 1;
        src = src.slice(0, at) + importLine + src.slice(at);
      } else src = importLine + src;
      kept.push(camel(slug));
    }
    src = src.replace(/export const EPISODES = \[[^\]]*\]/, `export const EPISODES = [${kept.join(', ')}]`);
    fs.writeFileSync(registryFile, src);

    // 5. project memory the agent keeps up to date
    const memory = path.join(ctx.projectRoot, 'PROJECT.md');
    if (!fs.existsSync(memory)) {
      fs.writeFileSync(
        memory,
        `# Project\n\n- skill: ${ctx.skillDir}\n- episode: ${slug}\n- pipeline: voice -> plan -> stills -> board -> (approval) -> sfx -> master\n\n## Decisions\n\n- (the agent appends decisions here)\n`,
      );
    }
    return {
      ok: true,
      summary: `scaffolded ${ctx.projectRoot} with episode "${slug}" (id ${ep.id}). Next: fill src/episodes/${slug}/episode.json, then stream "voice" and "plan".`,
      data: { projectRoot: ctx.projectRoot, episode: slug, id: ep.id },
    };
  },
};

const runStep: Tool = {
  name: 'whatif_run',
  description:
    'Run one pipeline step on an episode, using the skill scripts (voice, plan, stills, board, sfx, mixcheck, motiongrid, master) or install/render. Returns new artifacts (board stills, sheets, videos) you can look at.',
  policy: 'ask',
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      step: { type: 'string', enum: ['install', 'voice', 'plan', 'stills', 'board', 'sfx', 'mixcheck', 'motiongrid', 'master', 'render'] },
      args: { type: 'array', items: { type: 'string' }, description: 'Extra argv, e.g. ["--dry"] or ["S2","S5"].' },
    },
    required: ['episode', 'step'],
    additionalProperties: false,
  },
  validate: (input) => {
    const step = String(input.step ?? '');
    if (step !== 'render' && !STEPS[step]) return `unknown step ${step}`;
    return null;
  },
  cost: (input) => (['voice', 'sfx', 'master'].includes(String(input.step)) ? 200 : 0),
  async run(input: { episode: string; step: string; args?: string[] }, ctx): Promise<ToolResult> {
    if (!ctx.skillDir) throw new Error('WHATIF_SKILL_DIR is not set');
    const scripts = path.join(ctx.skillDir, 'scripts');
    const extra = input.args ?? [];
    const slug = input.episode;
    const before = snapshot(ctx.projectRoot);

    let argv: string[];
    let timeoutMs = 600_000;
    if (input.step === 'install') {
      argv = ['npm', 'install'];
      timeoutMs = 900_000;
    } else if (input.step === 'render') {
      const epJson = safeJoin(ctx.projectRoot, `src/episodes/${slug}/episode.json`);
      if (!fs.existsSync(epJson)) throw new Error(`no episode.json for ${slug}`);
      const id = JSON.parse(fs.readFileSync(epJson, 'utf8')).id as string;
      argv = ['npx', 'remotion', 'render', 'src/index.ts', id, `out/${slug}/${slug}-raw.mp4`, '--log', 'error'];
      timeoutMs = 1_800_000;
    } else {
      const step = STEPS[input.step]!;
      if (step.py) argv = [PY, path.join(scripts, step.py), slug, ...extra];
      else if (step.node) argv = ['node', path.join(scripts, step.node), slug, ...extra];
      else throw new Error(`step ${input.step} has no command`);
      if (step.timeoutMs) timeoutMs = step.timeoutMs;
    }

    ctx.log(`whatif_run ${input.step} ${slug}: ${argv.join(' ')}`);
    const res = await exec(argv, { cwd: ctx.projectRoot, timeoutMs, signal: ctx.signal });
    const tail = (s: string) => s.split('\n').filter(Boolean).slice(-25).join('\n');
    const artifacts = diffArtifacts(ctx.projectRoot, before);
    const credits = /credits?[^0-9]{0,12}(\d+)/i.exec(res.stdout);
    return {
      ok: res.code === 0,
      summary: `$ ${argv.join(' ')}\nexit ${res.code}${res.timedOut ? ' (timeout)' : ''}\n${tail(res.stdout)}${res.stderr ? `\n[stderr]\n${tail(res.stderr)}` : ''}${artifacts.length ? `\n\n${artifacts.length} new file(s): ${artifacts.map((a) => a.path).join(', ')}` : ''}`,
      artifacts,
      credits: credits ? Number(credits[1]) : undefined,
      data: { step: input.step, code: res.code },
    };
  },
};

const status: Tool = {
  name: 'whatif_status',
  description: 'Where the episode stands: script, words, timeline, stills, board, sound, render, report.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: { episode: { type: 'string' } },
    required: ['episode'],
    additionalProperties: false,
  },
  async run(input: { episode: string }, ctx) {
    const dir = safeJoin(ctx.projectRoot, `src/episodes/${input.episode}`);
    const out = safeJoin(ctx.projectRoot, `out/${input.episode}`);
    const pub = safeJoin(ctx.projectRoot, `public/${input.episode}`);
    const has = (p: string) => fs.existsSync(p);
    const read = (p: string) => (has(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
    const ep = read(path.join(dir, 'episode.json'));
    const tl = read(path.join(dir, 'timeline.json'));
    const report = read(path.join(out, 'report.json'));
    const boardDir = path.join(out, 'board');
    const stills = has(boardDir) ? fs.readdirSync(boardDir).filter((f) => f.endsWith('.png')) : [];
    const steps = {
      script: Boolean(ep && !JSON.stringify(ep.script ?? '').includes('TODO')),
      words: has(path.join(dir, 'words.json')),
      timeline: Boolean(tl && (tl.segments?.length ?? 0) > 0 && (tl.shots?.length ?? 0) > 0),
      voice: has(path.join(pub, 'voice.wav')) || has(path.join(pub, 'voice.mp3')),
      stills: stills.length,
      board: has(path.join(out, 'storyboard.jpg')),
      sfx: has(path.join(pub, 'sfx.wav')),
      music: has(path.join(pub, 'music.wav')),
      render: has(path.join(out, `${input.episode}-raw.mp4`)),
      final: has(path.join(out, `${input.episode}-final.mp4`)),
      report: report ? { seconds: report.seconds ?? report.duration, lufs: report.lufs, credits: report.credits } : null,
    };
    const artifacts: Artifact[] = [];
    if (has(path.join(out, 'storyboard.jpg'))) artifacts.push({ kind: 'image', path: `out/${input.episode}/storyboard.jpg`, mime: 'image/jpeg' });
    for (const s of stills.slice(0, 6)) artifacts.push({ kind: 'image', path: `out/${input.episode}/board/${s}`, mime: 'image/png' });
    return {
      ok: true,
      summary: `${input.episode}: ${JSON.stringify(steps, null, 1)}`,
      data: steps,
      artifacts,
    };
  },
};

const syncEngine: Tool = {
  name: 'whatif_sync_engine',
  description:
    'Compare the project engine (src/engine, src/studio.config.ts) with the skill version and report what changed upstream: new files, files identical, files you modified locally. With apply=true, overwrite (a checkpoint is taken first). This is how an engine upgrade stays non-destructive.',
  policy: 'ask',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      apply: { type: 'boolean', description: 'Actually overwrite locally modified engine files (default false: dry run).' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Sub-paths to sync (default: src/engine).' },
    },
  },
  async run(input: { apply?: boolean; paths?: string[] }, ctx): Promise<ToolResult> {
    if (!ctx.skillDir) throw new Error('WHATIF_SKILL_DIR is not set');
    const skillStudio = path.join(ctx.skillDir, 'studio');
    const targets = input.paths?.length ? input.paths : ['src/engine'];
    const added: string[] = [];
    const identical: string[] = [];
    const modified: string[] = [];
    for (const target of targets) {
      const from = path.join(skillStudio, target);
      if (!fs.existsSync(from)) continue;
      const stack = [from];
      while (stack.length) {
        const dir = stack.pop()!;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) {
            stack.push(abs);
            continue;
          }
          const rel = path.relative(skillStudio, abs).split(path.sep).join('/');
          const mine = safeJoin(ctx.projectRoot, rel);
          if (!fs.existsSync(mine)) {
            added.push(rel);
            if (input.apply) {
              fs.mkdirSync(path.dirname(mine), { recursive: true });
              fs.copyFileSync(abs, mine);
            }
            continue;
          }
          const a = fs.readFileSync(abs);
          const b = fs.readFileSync(mine);
          if (a.equals(b)) identical.push(rel);
          else {
            modified.push(rel);
            if (input.apply) fs.copyFileSync(abs, mine);
          }
        }
      }
    }
    const verb = input.apply ? 'synced' : 'would sync';
    return {
      ok: true,
      summary: `${verb}: ${added.length} new, ${modified.length} locally modified, ${identical.length} up to date.${added.length ? `\nnew: ${added.slice(0, 20).join(', ')}` : ''}${modified.length ? `\n${input.apply ? 'overwritten' : 'to review'}: ${modified.slice(0, 20).join(', ')}` : ''}`,
      data: { added, modified, identical },
    };
  },
};

export const whatifTools: Tool[] = [newProject, runStep, status, syncEngine];
