import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../orchestrator/config.js';
import type { Db } from '../orchestrator/db.js';
import type { Bus } from '../orchestrator/bus.js';
import type { JsonSchema, ToolContext, ToolRegistry } from '../tools/index.js';
import { readText } from '../tools/paths.js';
import { extractShotIds, readEpisodeShots, sortShotIds } from '../tools/episode-source.js';
import { formatStageCards } from '../tools/staging.js';
import { detectEpisodeLanguage, directorSizeMismatches } from '../tools/whatif.js';
import { episodePin, shotWordFrames } from '../orchestrator/context.js';
import { engineDigest } from '../orchestrator/engine-digest.js';
import {
  MAX_STRIKES,
  type ReviewIssue,
  type ReviewReport,
  accentMetrics,
  deltaReviewerSystemPrompt,
  formatReviewFeedback,
  nextStrikes,
  refusedUnchanged,
  reviewerSystemPrompt,
  staticMetrics,
  summarizeShotsCode,
  timingMetrics,
  writeUnresolvedDefects,
} from '../orchestrator/reviewer.js';

export type McpToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type McpToolResponse = {
  ok: boolean;
  summary: string;
  data?: unknown;
  artifacts?: { kind: string; path: string; mime?: string }[];
  projectRoot?: string;
};

function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function readPreviousReview(outDir: string): ReviewReport | null {
  try {
    const raw = fs.readFileSync(path.join(outDir, 'review.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ReviewReport;
  } catch {
    /* none */
  }
  return null;
}

function episodeAspect(projectRoot: string, epRaw: string): string {
  try {
    const a = String(JSON.parse(epRaw)?.aspect ?? '');
    if (a === '9:16' || a === '16:9') return a;
  } catch {
    /* fall through */
  }
  const cfg = readText(path.join(projectRoot, 'src'), 'studio.config.ts', 50_000) ?? '';
  if (/aspect\s*:\s*['"]9:16['"]/.test(cfg) || (/width\s*:\s*1080\b/.test(cfg) && /height\s*:\s*1920\b/.test(cfg))) {
    return '9:16';
  }
  return '16:9';
}

export function listMcpTools(registry: ToolRegistry): McpToolSpec[] {
  const stageSchema = registry.get('stage_shots')?.schema ?? { type: 'object', properties: {} };
  const runSchema = registry.get('whatif_run')?.schema ?? { type: 'object', properties: {} };

  const withProjectProp = (schema: JsonSchema): JsonSchema => ({
    ...schema,
    properties: {
      project: {
        type: 'string',
        description: 'Project slug in data/projects/<project> (optional: defaults to episode slug).',
      },
      ...(schema.properties ?? {}),
    },
  });

  return [
    {
      name: 'whatif_create_project',
      description:
        'Create (or reuse) a What If Studio project in data/projects/<project> and scaffold src/episodes/<episode> with the latest 2D engine overlay (shot(), cast(), place(), 6 perspectives, OTS/POV, phoneShot, tabletopShot). Registers the project in the Studio database so it is also visible on http://localhost:3000.',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string', description: 'Episode slug (kebab-case, e.g. "the-promise" or "antiseche").' },
          project: { type: 'string', description: 'Optional project id (defaults to episode slug).' },
          video: { type: 'string', description: 'Optional source video ID from :8005 (e.g. "4v9iYHecGpU").' },
          aspect: { type: 'string', enum: ['9:16', '16:9'], description: 'Video orientation ("9:16" vertical Short or "16:9" landscape).' },
          force: { type: 'boolean', description: 'Overwrite existing episode scaffold if already present (default false).' },
        },
        required: ['episode'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_run',
      description:
        'Run a What If pipeline step inside the Studio environment (:8005 TTS/ASR + Modal cloud render + layout/code audits): source | voice | shotlist | plan | stills | board | sfx | render | master | install. Note: before step="render", the independent Reviewer subagent must audit the current board via whatif_review_pack + whatif_save_review.',
      inputSchema: withProjectProp(runSchema),
    },
    {
      name: 'whatif_episode_pin',
      description:
        'Read the live Continuity, Language & Casting Pin for an episode: language lock (fr/en), narrator voice & POV lock (Léa/Hugo, first/third), shared.tsx summary, all shot lengths/sizes/views/accents/looks, exported vs missing shots, and optionally the full 2D engine export digest.',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
          includeEngineDigest: { type: 'boolean', description: 'Include full src/engine TypeScript export & Pose signatures (set true once before coding shared.tsx).' },
        },
        required: ['episode'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_shot_words',
      description:
        'Read measured word@frame timings on each shot own clock (0..len at 30fps) so person beats and camera beats land on the exact spoken word.',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' }, description: 'Optional list of shot IDs (e.g. ["S1","S2"]); omit for all shots.' },
        },
        required: ['episode'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_stage_shots',
      description:
        'Save the mandatory staging cards of each shot BEFORE coding shots (subject, see, people, handled objects, angle, view, cam, zone, foreground, moves, change) and run anti-monotony & staging audits.',
      inputSchema: withProjectProp(stageSchema),
    },
    {
      name: 'whatif_edit_shot',
      description:
        'Write or replace a single shot S<N> in isolated modular file src/episodes/<episode>/shots/S<N>.tsx, auto-importing React + engine helpers + ../shared symbols, syncing the shots.tsx barrel & index.tsx, and running TypeScript checks.',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
          id: { type: 'string', description: 'Shot ID such as "S1", "S12".' },
          code: { type: 'string', description: 'Full TypeScript/JSX code for this shot ending with `export const S<N> = ...`.' },
        },
        required: ['episode', 'id', 'code'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_write_file',
      description:
        'Write or append a project-relative text file inside the episode workspace (e.g. "src/episodes/<slug>/DIRECTOR.md", "src/episodes/<slug>/shared.tsx", "src/episodes/<slug>/episode.json", or "PROJECT.md") with automatic shared.tsx export normalization and barrel sync.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug in data/projects/<project>.' },
          episode: { type: 'string', description: 'Episode slug (used as default project slug if project is omitted).' },
          path: { type: 'string', description: 'Project-relative file path (e.g. "src/episodes/my-ep/shared.tsx" or "PROJECT.md").' },
          content: { type: 'string' },
          append: { type: 'boolean' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_read_file',
      description: 'Read a project-relative text file from data/projects/<project> with line numbers.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          episode: { type: 'string' },
          path: { type: 'string', description: 'Project-relative path.' },
          start: { type: 'integer' },
          end: { type: 'integer' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_review_pack',
      description:
        'Prepare the complete Independent Reviewer audit dossier after `board`: detects Round 1 (Global 100% contact sheets) vs Round 2+ (Targeted High-Res Delta stills on flagged/modified shots), returns hostImagePaths to inspect visually, Reviewer criteria matched to episode language (FR/EN), script, DIRECTOR.md, staging cards, AST per-shot code summary, and automatic metrics.',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
          mode: { type: 'string', enum: ['auto', 'global', 'delta'] },
        },
        required: ['episode'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_save_review',
      description:
        'Record the Independent Reviewer subagent verdict into out/<episode>/review.json (updating per-shot strike counts, unblocking `render` when `pass: true` or after maxRounds/3-strikes with DEFAUTS-NON-CORRIGES.md, or keeping `blocking: true` while fixes are required).',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
          pass: { type: 'boolean' },
          summary: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                shot: { type: 'string' },
                severity: { type: 'string', enum: ['error', 'warn'] },
                problem: { type: 'string' },
                fix: { type: 'string' },
              },
              required: ['shot', 'severity', 'problem', 'fix'],
            },
          },
          round: { type: 'integer' },
          mode: { type: 'string', enum: ['global', 'delta'] },
          reviewerModel: { type: 'string' },
          maxRounds: { type: 'integer', description: 'Max blocking review rounds before shipping with DEFAUTS-NON-CORRIGES.md (default 2).' },
        },
        required: ['episode', 'pass', 'summary'],
        additionalProperties: false,
      },
    },
    {
      name: 'whatif_status',
      description: 'Check completion state of an episode (script, voice, words, timeline, director, stills, board, review, sfx, render, final, LUFS report).',
      inputSchema: {
        type: 'object',
        properties: {
          episode: { type: 'string' },
          project: { type: 'string' },
        },
        required: ['episode'],
        additionalProperties: false,
      },
    },
  ];
}

function resolveProjectForTool(
  db: Db,
  config: Config,
  rawArgs: Record<string, unknown>,
): { projectId: string; projectRoot: string } {
  const fromPath = typeof rawArgs.path === 'string' ? /^src\/episodes\/([^/]+)\//.exec(rawArgs.path.replace(/^\/+/, ''))?.[1] : undefined;
  const rawId = String(rawArgs.project ?? rawArgs.episode ?? fromPath ?? '').trim();
  if (!rawId) {
    throw new Error('Pass "episode" (or "project") so the Studio knows which project in data/projects/<slug> to target.');
  }
  const exact = db.getProject(rawId);
  if (exact) return { projectId: exact.id, projectRoot: exact.root };
  const slug = slugify(rawId);
  const bySlug = db.getProject(slug);
  if (bySlug) return { projectId: bySlug.id, projectRoot: bySlug.root };
  const candidateDir = path.join(config.projectsDir, slug);
  if (fs.existsSync(candidateDir)) {
    const created = db.createProject(slug, slug, candidateDir);
    return { projectId: created.id, projectRoot: created.root };
  }
  throw new Error(`Project "${slug}" does not exist yet: call whatif_create_project { episode: "${slug}" } first.`);
}

export async function callMcpTool(
  deps: { db: Db; bus: Bus; config: Config; registry: ToolRegistry },
  name: string,
  rawArgs: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<McpToolResponse> {
  const { db, bus, config, registry } = deps;
  const logs: string[] = [];

  if (name === 'whatif_create_project') {
    const episode = slugify(String(rawArgs.episode ?? ''));
    const projectId = slugify(String(rawArgs.project ?? episode));
    const aspect = rawArgs.aspect === '9:16' || rawArgs.aspect === '16:9' ? rawArgs.aspect : '9:16';
    const video = typeof rawArgs.video === 'string' && rawArgs.video.trim() ? rawArgs.video.trim() : undefined;
    const force = Boolean(rawArgs.force);

    let project = db.getProject(projectId);
    const root = project ? project.root : path.join(config.projectsDir, projectId);
    fs.mkdirSync(root, { recursive: true });

    const epJsonPath = path.join(root, 'src', 'episodes', episode, 'episode.json');
    let toolRes = { ok: true, summary: `Reusing existing episode scaffold at src/episodes/${episode}` };
    if (!fs.existsSync(epJsonPath) || force) {
      const r = await registry.run(
        'whatif_new',
        {
          episode,
          force: true,
          aspect,
          ...(video ? { video } : {}),
        },
        { projectId, projectRoot: root, dataRoot: config.dataRoot, skillDir: config.skillDir, log: (l) => logs.push(l), signal },
      );
      toolRes = { ok: r.ok, summary: r.summary };
      if (!r.ok) return { ok: false, summary: r.summary, projectRoot: root };
    }

    if (!project) {
      project = db.createProject(projectId, episode, root, { provider: 'agy', review_provider: 'agy' });
    }
    bus.emit('global', 'projects_changed', { id: projectId });

    return {
      ok: true,
      projectRoot: root,
      summary: [
        `Project "${projectId}" ready (episode="${episode}", aspect="${aspect}"${video ? `, video="${video}"` : ''}).`,
        `Project root: ${root}`,
        toolRes.summary,
      ].join('\n'),
      data: {
        projectId,
        episode,
        aspect,
        video: video ?? null,
        containerRoot: root,
        episodeDir: `src/episodes/${episode}`,
        outDir: `out/${episode}`,
      },
    };
  }

  const { projectId, projectRoot } = resolveProjectForTool(db, config, rawArgs);
  const ctx: ToolContext = {
    projectId,
    projectRoot,
    dataRoot: config.dataRoot,
    skillDir: config.skillDir,
    log: (line) => logs.push(line),
    signal,
  };

  if (name === 'whatif_run') {
    const episode = String(rawArgs.episode ?? projectId).trim();
    const step = String(rawArgs.step ?? '').trim();
    const rawStepArgs = Array.isArray(rawArgs.args) ? rawArgs.args.map((a) => String(a)) : [];
    const skipReview = rawStepArgs.includes('--skip-review');
    const cleanArgs = rawStepArgs.filter((a) => a !== '--skip-review');

    // Enforce independent Reviewer subagent check before cloud video render
    if (step === 'render' && !skipReview) {
      const outDir = path.join(projectRoot, 'out', episode);
      const boardPath = path.join(outDir, 'storyboard.jpg');
      const revPath = path.join(outDir, 'review.json');
      if (fs.existsSync(boardPath)) {
        const boardMtime = fs.statSync(boardPath).mtimeMs;
        const prevRev = readPreviousReview(outDir);
        const revMtime = fs.existsSync(revPath) ? fs.statSync(revPath).mtimeMs : 0;
        const needsSubagentReview =
          !prevRev ||
          (boardMtime > revMtime + 500 && Boolean(prevRev.blocking || prevRev.reopened));
        if (needsSubagentReview) {
          return {
            ok: false,
            projectRoot,
            summary:
              `STOP BEFORE RENDER: the current storyboard for "${episode}" has not been audited by the Independent Reviewer subagent yet.\n` +
              `1. Launch a read-only Reviewer subagent (define_subagent / invoke_subagent) so it inspects the board with fresh eyes,\n` +
              `2. Have it call whatif_review_pack({ episode: "${episode}" }), visually inspect hostImagePaths with read_file, and save its verdict via whatif_save_review({ episode: "${episode}", ... }),\n` +
              `3. Once review passes (or closes at final round), call whatif_run({ episode: "${episode}", step: "render" }).`,
          };
        }
      }
    }

    const res = await registry.run('whatif_run', { episode, step, ...(cleanArgs.length ? { args: cleanArgs } : {}) }, ctx);
    if (typeof res.credits === 'number' && res.credits > 0) {
      try {
        db.addCredits(projectId, 'mcp', step, res.credits);
      } catch {
        /* optional cost tracking */
      }
    }
    return {
      ok: res.ok,
      projectRoot,
      summary: res.summary,
      data: res.data,
      artifacts: res.artifacts,
    };
  }

  if (name === 'whatif_episode_pin') {
    const pin = episodePin(projectRoot);
    const digest = rawArgs.includeEngineDigest ? engineDigest(projectRoot) : '';
    const summary = [
      pin || `(no active episode pin found in ${projectRoot})`,
      digest ? `\n## Engine exports & Pose types (src/engine)\n${digest}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { ok: true, projectRoot, summary };
  }

  if (name === 'whatif_shot_words') {
    const episode = String(rawArgs.episode ?? projectId).trim();
    const ids = Array.isArray(rawArgs.ids) ? rawArgs.ids.map((x) => String(x)) : undefined;
    const res = await registry.run('shot_words', { episode, ...(ids ? { ids } : {}) }, ctx);
    return { ok: res.ok, projectRoot, summary: res.summary, data: res.data };
  }

  if (name === 'whatif_stage_shots') {
    const { project: _p, ...rest } = rawArgs;
    const res = await registry.run('stage_shots', rest, ctx);
    return { ok: res.ok, projectRoot, summary: res.summary, data: res.data };
  }

  if (name === 'whatif_edit_shot') {
    const { project: _p, ...rest } = rawArgs;
    const res = await registry.run('edit_shot', rest, ctx);
    return { ok: res.ok, projectRoot, summary: res.summary, data: res.data };
  }

  if (name === 'whatif_write_file') {
    const res = await registry.run(
      'write_file',
      {
        path: String(rawArgs.path ?? ''),
        content: String(rawArgs.content ?? ''),
        ...(typeof rawArgs.append === 'boolean' ? { append: rawArgs.append } : {}),
      },
      ctx,
    );
    return { ok: res.ok, projectRoot, summary: res.summary, data: res.data };
  }

  if (name === 'whatif_read_file') {
    const res = await registry.run(
      'read_file',
      {
        path: String(rawArgs.path ?? ''),
        ...(typeof rawArgs.start === 'number' ? { start: rawArgs.start } : {}),
        ...(typeof rawArgs.end === 'number' ? { end: rawArgs.end } : {}),
      },
      ctx,
    );
    return { ok: res.ok, projectRoot, summary: res.summary, data: res.data };
  }

  if (name === 'whatif_status') {
    const episode = String(rawArgs.episode ?? projectId).trim();
    const res = await registry.run('whatif_status', { episode }, ctx);
    const rev = readPreviousReview(path.join(projectRoot, 'out', episode));
    const reviewInfo = rev ? { pass: rev.pass, blocking: rev.blocking, round: rev.round, mode: rev.mode, issues: rev.issues?.length ?? 0 } : null;
    return {
      ok: res.ok,
      projectRoot,
      summary: `${res.summary}\nreview: ${JSON.stringify(reviewInfo)}`,
      data: { ...(typeof res.data === 'object' && res.data ? res.data : {}), review: reviewInfo },
    };
  }

  if (name === 'whatif_review_pack') {
    const slug = String(rawArgs.episode ?? projectId).trim();
    const epDir = path.join(projectRoot, 'src', 'episodes', slug);
    const outDir = path.join(projectRoot, 'out', slug);
    const stuck = refusedUnchanged(projectRoot, slug);
    if (stuck && stuck.length) {
      return {
        ok: false,
        projectRoot,
        summary: `No code changed on the refused shots (${stuck.join(', ')}) since the last review! Edit them with whatif_edit_shot, then re-run stills (${JSON.stringify(stuck)}) and board before re-running the Reviewer.`,
      };
    }

    const epRaw = readText(epDir, 'episode.json', 3_000_000) ?? '{}';
    const directorRaw = readText(epDir, 'DIRECTOR.md', 200_000) ?? '(aucun DIRECTOR.md)';
    const bibleRaw = readText(epDir, 'bible.json', 8_000) ?? '';
    let ep: any = {};
    try {
      ep = JSON.parse(epRaw);
    } catch {
      ep = {};
    }
    let timeline: any = null;
    try {
      timeline = JSON.parse(readText(epDir, 'timeline.json', 600_000) ?? 'null');
    } catch {
      timeline = null;
    }

    const epLang = detectEpisodeLanguage(ep);
    const langUpper = epLang.toUpperCase();
    const aspect = episodeAspect(projectRoot, epRaw);
    const epSrc = readEpisodeShots(epDir);
    const stagedShots = (Array.isArray(ep?.shots) ? ep.shots : []).filter((s: any) => s?.stage);

    const shotTimings = new Map<string, { len: number; key: number }>();
    for (const s of Array.isArray(timeline?.shots) ? timeline.shots : []) {
      if (s?.id) {
        const len = Number(s.len ?? 60);
        const key = Math.min(Math.max(0, Number(s.key ?? 18)), Math.max(0, len - 1));
        shotTimings.set(String(s.id).toUpperCase(), { len, key });
      }
    }

    const boardDir = path.join(outDir, 'board');
    const boardStillIds = fs.existsSync(boardDir)
      ? sortShotIds(
          fs
            .readdirSync(boardDir)
            .filter((n) => /^S\d+\.png$/i.test(n))
            .map((n) => n.replace(/\.png$/i, '').toUpperCase()),
        )
      : [];
    const sheetsDir = path.join(outDir, 'sheets');
    const sheetFiles = fs.existsSync(sheetsDir)
      ? fs
          .readdirSync(sheetsDir)
          .filter((n) => /^sheet-\d+\.jpe?g$/i.test(n))
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      : [];

    const prevReview = readPreviousReview(outDir);
    const prevErrors = prevReview?.ok && !prevReview.pass ? prevReview.issues.filter((i) => i.severity === 'error') : [];
    const prevRound = typeof prevReview?.round === 'number' ? prevReview.round : 0;
    const round = prevReview?.ok ? prevRound + 1 : 1;
    const prevCreatedMs = prevReview?.createdAt ? Date.parse(prevReview.createdAt) || 0 : 0;
    const flaggedShots = sortShotIds(prevErrors.flatMap((i) => extractShotIds(i.shot)));
    const modifiedShots: string[] = [];
    if (prevCreatedMs > 0) {
      for (const [id, mt] of epSrc.shotMtimesMs) {
        if (epSrc.isModular && mt > prevCreatedMs + 500) modifiedShots.push(id);
      }
      for (const id of boardStillIds) {
        try {
          if (fs.statSync(path.join(boardDir, `${id}.png`)).mtimeMs > prevCreatedMs + 500) modifiedShots.push(id);
        } catch {
          /* ignore */
        }
      }
    }
    const deltaTargetShots = sortShotIds([...flaggedShots, ...modifiedShots]);
    const requestedMode = String(rawArgs.mode ?? 'auto');
    const useDelta =
      requestedMode === 'delta' ||
      (requestedMode === 'auto' &&
        Boolean(
          prevReview?.ok &&
            deltaTargetShots.length > 0 &&
            ((!prevReview.pass && (prevReview.blocking || prevReview.reopened) && prevErrors.length > 0) || prevReview.pass),
        ));

    const scriptLines = (Array.isArray(ep?.script) ? ep.script : [])
      .map((b: any, i: number) => `${i + 1}. ${String(b?.text ?? '').trim()}`)
      .join('\n');
    const formatShotBreakdown = (filterIds?: Set<string>) =>
      (Array.isArray(ep?.shots) ? ep.shots : [])
        .filter((s: any) => !filterIds || filterIds.has(String(s?.id ?? '').toUpperCase()))
        .map((s: any) => {
          const id = String(s?.id ?? '').toUpperCase();
          const tm = shotTimings.get(id);
          const tmTag = tm ? `, len=${tm.len}f, vignette@t=${tm.key}f` : '';
          return `- ${s.id} [${s.size ?? 'medium'}, set=${s.set ?? 'custom'}${tmTag}]: "${s.note ?? ''}"`;
        })
        .join('\n');

    const cardsText = formatStageCards(stagedShots, useDelta && deltaTargetShots.length ? deltaTargetShots : undefined);
    const cardsBlock = cardsText ? `\n\n## Fiches de mise en scène\n${cardsText.slice(0, 16_000)}` : '';
    const sizeDrift = directorSizeMismatches(directorRaw, ep);
    const autoMetrics = [
      staticMetrics(epSrc),
      accentMetrics(epSrc),
      timingMetrics(timeline),
      sizeDrift.length ? `écarts de taille DIRECTOR.md ↔ episode.json (${sizeDrift.length}) : ${sizeDrift.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    let relativeImagePaths: string[] = [];
    let systemPrompt = '';
    let dossier = '';

    if (useDelta && deltaTargetShots.length > 0) {
      for (const id of deltaTargetShots) {
        const rel = `out/${slug}/board/${id}.png`;
        if (fs.existsSync(path.join(projectRoot, rel))) relativeImagePaths.push(rel);
      }
      if (!relativeImagePaths.length) {
        relativeImagePaths = sheetFiles.map((n) => `out/${slug}/sheets/${n}`);
      }
      const targetSet = new Set(deltaTargetShots);
      const prevIssuesList = prevErrors
        .map((iss) => `- [${iss.shot}] Problème signalé : ${iss.problem}\n  Correctif demandé : ${iss.fix}`)
        .join('\n');
      const wordMarks = shotWordFrames(projectRoot, slug, deltaTargetShots);
      systemPrompt = deltaReviewerSystemPrompt(epLang);
      dossier = [
        `# Contre-visite ciblée (Tour ${round}, mode=delta) de "${slug}" (orientation: ${aspect}, langue: ${langUpper})`,
        `Plans ciblés : ${deltaTargetShots.join(', ')}`,
        `## 1. Problèmes bloquants signalés au tour précédent\n${prevIssuesList}`,
        `## 2. Script complet (narration ${langUpper})\n${scriptLines.slice(0, 22_000)}`,
        `## 3. Découpage des plans ciblés\n${formatShotBreakdown(targetSet)}`,
        wordMarks.length ? `## 4. Repères mot@frame\n${wordMarks.join('\n')}` : '',
        bibleRaw ? `## 5. Bible\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 6. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 14_000)}${cardsBlock}`,
        `## 7. Code COMPLET non tronqué des plans ciblés\n${summarizeShotsCode(epSrc, { onlyShots: deltaTargetShots, shotTimings, perShotChars: 8_000 })}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    } else {
      relativeImagePaths = sheetFiles.length
        ? sheetFiles.map((n) => `out/${slug}/sheets/${n}`)
        : fs.existsSync(path.join(outDir, 'storyboard.jpg'))
          ? [`out/${slug}/storyboard.jpg`]
          : [];
      systemPrompt = reviewerSystemPrompt(epLang);
      dossier = [
        `# Audit indépendant (Tour ${round}, mode=global) de "${slug}" (orientation: ${aspect}, langue: ${langUpper}, defaultSet: ${JSON.stringify(ep?.defaultSet ?? '')})`,
        `## 1. Script complet (narration ${langUpper})\n${scriptLines.slice(0, 22_000)}`,
        `## 2. Découpage des plans (episode.json.shots)\n${formatShotBreakdown().slice(0, 22_000)}`,
        bibleRaw ? `## 3. Bible\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 4. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 14_000)}${cardsBlock}`,
        `## 5. Code des plans\n${summarizeShotsCode(epSrc, { shotTimings, perShotChars: 2_600 })}`,
        `## 6. Mesures automatiques\n${autoMetrics}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    const modeUsed = useDelta && deltaTargetShots.length > 0 ? 'delta' : 'global';
    return {
      ok: true,
      projectRoot,
      summary: [
        `Reviewer pack ready for "${slug}" (round=${round}, mode=${modeUsed}, lang=${epLang}, aspect=${aspect}, images=${relativeImagePaths.length}).`,
        `Inspect ALL images in hostImagePaths using read_file, apply the Reviewer rules below, then save the JSON verdict with whatif_save_review.`,
        `\n=== REVIEWER INSTRUCTIONS ===\n${systemPrompt}`,
        `\n=== EPISODE DOSSIER ===\n${dossier}`,
      ].join('\n'),
      data: {
        episode: slug,
        round,
        mode: modeUsed,
        lang: epLang,
        aspect,
        targetShots: useDelta ? deltaTargetShots : epSrc.exportedShotIds,
        relativeImagePaths,
      },
    };
  }

  if (name === 'whatif_save_review') {
    const slug = String(rawArgs.episode ?? projectId).trim();
    const outDir = path.join(projectRoot, 'out', slug);
    const prevReview = readPreviousReview(outDir);
    const prevRound = typeof prevReview?.round === 'number' ? prevReview.round : 0;
    const round = typeof rawArgs.round === 'number' && rawArgs.round > 0 ? rawArgs.round : prevRound + 1;
    const maxRounds = typeof rawArgs.maxRounds === 'number' && rawArgs.maxRounds > 0 ? rawArgs.maxRounds : config.reviewMaxRounds;
    const rawIssues = Array.isArray(rawArgs.issues) ? rawArgs.issues : [];
    const issues: ReviewIssue[] = rawIssues
      .filter((it: any) => it && (it.problem || it.fix))
      .map((it: any) => ({
        shot: String(it.shot ?? 'GLOBAL').trim(),
        severity: (String(it.severity ?? 'warn').toLowerCase() === 'error' ? 'error' : 'warn') as 'error' | 'warn',
        problem: String(it.problem ?? '').trim(),
        fix: String(it.fix ?? '').trim(),
      }));
    const hasError = issues.some((i) => i.severity === 'error');
    const pass = Boolean(rawArgs.pass) && !hasError;
    const model = String(rawArgs.reviewerModel ?? 'agy-subagent-reviewer');
    const mode = rawArgs.mode === 'delta' ? 'delta' : 'global';

    const report: ReviewReport = {
      ok: true,
      pass,
      model,
      episode: slug,
      summary: String(rawArgs.summary ?? '').trim() || (pass ? 'Réalisation cohérente.' : `${issues.length} problème(s) détecté(s).`),
      issues,
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      mode,
      round,
      sawImages: true,
    };

    const strikes = nextStrikes(prevReview?.ok && !prevReview.pass ? prevReview.strikes : undefined, report);
    report.strikes = strikes;
    const gaveUpOn = !report.pass ? Object.keys(strikes).filter((id) => strikes[id]! >= MAX_STRIKES) : [];
    if (gaveUpOn.length) report.gaveUpOn = gaveUpOn;
    const isFinal = round >= maxRounds || gaveUpOn.length > 0;
    report.blocking = !report.pass && !isFinal;
    if (isFinal && !report.pass) {
      const defectsFile = writeUnresolvedDefects(projectRoot, slug, report);
      if (defectsFile) report.defectsFile = defectsFile;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(report, null, 2) + '\n');

    const affectedShots = sortShotIds(issues.filter((i) => i.severity === 'error').flatMap((i) => extractShotIds(i.shot)));
    const wordMarks = affectedShots.length ? shotWordFrames(projectRoot, slug, affectedShots) : [];
    const feedback = formatReviewFeedback(report, slug, wordMarks);

    return {
      ok: true,
      projectRoot,
      summary: feedback,
      data: {
        pass: report.pass,
        blocking: report.blocking,
        round: report.round,
        mode: report.mode,
        strikes: report.strikes,
        gaveUpOn: report.gaveUpOn ?? [],
        defectsFile: report.defectsFile ?? null,
      },
    };
  }

  return {
    ok: false,
    summary: `Unknown MCP tool "${name}". Available: ${listMcpTools(registry).map((t) => t.name).join(', ')}`,
  };
}
