import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { layoutReport } from '../orchestrator/layout.js';
import { countScriptWords } from '../orchestrator/context.js';
import { fileURLToPath } from 'node:url';
import { exec } from './exec.js';
import { applyEngineOverlay, overlaySummary } from './engine-overlay.js';
import type { Artifact, Tool, ToolResult } from './types.js';
import { kindOf, mimeOf, relOf, safeJoin } from './paths.js';

/** Relative luminance of a #RRGGBB hex colour (0 = black, 1 = white). */
function hexLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const PY = process.platform === 'win32' ? 'python' : 'python3';
/** This app's own pipeline scripts (source import, voice, Modal render), next to the skill's. */
const PIPELINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline');

const EPISODE_STUB = (slug: string, aspect: '16:9' | '9:16' = '16:9') => ({
  id: slug.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase()),
  slug,
  aspect,
  topic: '',
  title: ['ET SI TU POUVAIS', '… ?'],
  accent: '',
  power: { word: '', rule: '', look: '' },
  script: [
    { beat: '1 cold open, demo 1 (small and selfish)', text: 'TODO' },
    { beat: '1 cold open, demo 2 (useful)', text: 'TODO' },
    { beat: '1 cold open, demo 3 (a little uncanny)', text: 'TODO' },
    { beat: '2 the premise (title card)', text: 'Et si tu pouvais … ?' },
    { beat: '4 the turn: the cost, one real fact', text: 'TODO — with one real, sourced number.' },
    { beat: '5-7 folded into a question', text: 'TODO?' },
  ],
  science: [{ claim: 'TODO', working: 'TODO — the arithmetic.', source: 'TODO' }],
  cast: ['pipHood'],
  // one placeholder shot, so plan.py can run before the voice exists; stills refuses to render it
  shots: [{ id: 'S1', size: 'medium', set: 'study', key: 12, note: 'placeholder: replace with the real shot' }],
  edit: [{ shot: 'S1', at: 'f:0' }],
  fx: [],
});

export function normalizeAspect(raw: unknown): '16:9' | '9:16' | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/\b(9\s*[:/]\s*16|1080\s*x\s*1920|portrait|vertical|shorts?|tiktok|reels)\b/.test(s)) {
    return '9:16';
  }
  if (/\b(16\s*[:/]\s*9|1920\s*x\s*1080|landscape|horizontal|paysage)\b/.test(s)) {
    return '16:9';
  }
  return null;
}

/**
 * Keep episode.json.aspect, PROJECT.md, and src/studio.config.ts (width/height/aspect) in lockstep
 * so 16:9 (1920x1080) and 9:16 (1080x1920) are always respected across Remotion, stills, board and master.
 */
export function syncStudioAspect(projectRoot: string, slug: string, explicit?: unknown): '16:9' | '9:16' {
  const epPath = path.join(projectRoot, 'src', 'episodes', slug, 'episode.json');
  const cfgPath = path.join(projectRoot, 'src', 'studio.config.ts');
  const projMdPath = path.join(projectRoot, 'PROJECT.md');

  let ep: Record<string, any> | null = null;
  try {
    ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
  } catch {
    ep = null;
  }

  let fromMd: '16:9' | '9:16' | null = null;
  try {
    const md = fs.readFileSync(projMdPath, 'utf8');
    const m = /^-\s*(?:aspect|orientation|format)\s*:\s*([^\r\n]+)/im.exec(md);
    if (m) fromMd = normalizeAspect(m[1]);
  } catch {
    /* ignore */
  }

  let fromCfg: '16:9' | '9:16' | null = null;
  try {
    const cfgRaw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = cfgRaw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    if (/aspect\s*:\s*['"]9:16['"]/.test(cfg) || (/width\s*:\s*1080\b/.test(cfg) && /height\s*:\s*1920\b/.test(cfg))) {
      fromCfg = '9:16';
    } else if (/aspect\s*:\s*['"]16:9['"]/.test(cfg)) {
      fromCfg = '16:9';
    }
  } catch {
    /* ignore */
  }

  const fromEp = normalizeAspect(ep?.aspect ?? ep?.format ?? ep?.orientation);
  // Explicit input, PROJECT.md, and episode.json always take precedence over the default studio.config.ts
  const aspect: '16:9' | '9:16' = normalizeAspect(explicit) ?? fromMd ?? fromEp ?? fromCfg ?? '16:9';

  if (ep) {
    let epChanged = false;
    if (ep.aspect !== aspect) {
      ep.aspect = aspect;
      epChanged = true;
    }
    if (ep.source?.videoId && Array.isArray(ep.science) && ep.science.some((s: any) => /\bTODO\b/i.test(JSON.stringify(s)))) {
      ep.science = ep.science.filter((s: any) => !/\bTODO\b/i.test(JSON.stringify(s)));
      epChanged = true;
    }
    if (epChanged) {
      try {
        fs.writeFileSync(epPath, JSON.stringify(ep, null, 1) + '\n');
      } catch {
        /* ignore */
      }
    }
  }

  if (fs.existsSync(cfgPath)) {
    const width = aspect === '9:16' ? 1080 : 1920;
    const height = aspect === '9:16' ? 1920 : 1080;
    try {
      let src = fs.readFileSync(cfgPath, 'utf8');
      const replaceBlock = (block: string) => {
        let b = block.replace(/width\s*:\s*\d+/g, `width: ${width}`).replace(/height\s*:\s*\d+/g, `height: ${height}`);
        if (/aspect\s*:/.test(b)) {
          b = b.replace(/aspect\s*:\s*['"][^'"]+['"]/g, `aspect: '${aspect}'`);
        } else {
          b = b.replace(/(height\s*:\s*\d+\s*,)/, `$1\n  aspect: '${aspect}' as '16:9' | '9:16',`);
        }
        return b;
      };
      if (/export\s+const\s+STUDIO\s*=\s*\{[\s\S]*?\};/.test(src)) {
        src = src.replace(/export\s+const\s+STUDIO\s*=\s*\{[\s\S]*?\};/, replaceBlock);
      } else {
        src = replaceBlock(src);
      }
      fs.writeFileSync(cfgPath, src);
    } catch {
      /* ignore */
    }
  }

  return aspect;
}

const SHOT_STUB = `import React from 'react';
import { ShotProps } from '../../engine';

// PLACEHOLDER. One component per shot id in timeline.json, each a pure function of its own clock t.
// This one draws a label, not a scene: write the real shot before anything is rendered.
export const S1: React.FC<ShotProps> = ({ len }) => (
  <g>
    <rect x={0} y={0} width={1920} height={1080} fill="#0B0816" />
    <text x={960} y={520} fill="#8B86A0" fontSize={38} fontFamily="monospace" textAnchor="middle">
      SHOT S1 — PLACEHOLDER
    </text>
    <text x={960} y={578} fill="#F6EFE3" fontSize={30} fontFamily="monospace" textAnchor="middle">
      write the real shots in shots.tsx ({Math.round(len / 30)}s)
    </text>
  </g>
);
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

/**
 * Pipeline steps. `own: true` runs a script shipped with this app (pipeline/) instead of the skill's
 * scripts/, both with cwd = the project root: the nouvelle chain (import + voice through :8005) and
 * the Modal renderer live here, everything else stays the skill's, untouched.
 */

/**
 * Validate the script, source translation fidelity (when imported from :8005), science backing (when standalone),
 * and language consistency in episode.json.
 */
export function episodeAudit(episode: any, slug: string): string | null {
  const script = Array.isArray(episode?.script) ? episode.script : [];
  const hasSourceVideo = Boolean(episode?.source?.videoId);
  const minBeats = hasSourceVideo ? 1 : 4;
  if (script.length < minBeats) {
    return `episode.json.script must contain at least ${minBeats} beat(s); found ${script.length}.`;
  }
  const fullText = script.map((b: any) => String(b?.text ?? '')).join(' ');
  if (/\bTODO\b/i.test(fullText)) {
    return `episode.json.script still contains "TODO": write the complete narration (or run whatif_run { step: "source", args: ["--pick", "hook", "--apply"] }) before running the pipeline.`;
  }

  const scriptWords = countScriptWords(script);
  const sourceWords = Number(episode?.source?.words ?? 0);
  if (hasSourceVideo && sourceWords >= 40 && scriptWords < Math.floor(sourceWords * 0.75)) {
    return (
      `episode.json.script (${scriptWords} words) shortened or rewrote the :8005 translation proposal (${sourceWords} words). ` +
      `Do NOT shorten or rewrite the server's translation proposal (projects can last several minutes): keep the full French narration from out/${slug}/source.fr.md ` +
      `by running whatif_run { episode: "${slug}", step: "source", args: ["--pick", "hook", "--apply"] }.`
    );
  }

  const science = Array.isArray(episode?.science) ? episode.science : [];
  const nonTodoScience = science.filter((s: any) => !/\bTODO\b/i.test(`${s?.claim ?? ''} ${s?.working ?? ''} ${s?.source ?? ''}`));
  if (!hasSourceVideo) {
    if (
      !nonTodoScience.length ||
      science.some(
        (s: any) =>
          !String(s?.claim ?? '').trim() ||
          !String(s?.working ?? '').trim() ||
          !String(s?.source ?? '').trim() ||
          /\bTODO\b/i.test(`${s?.claim ?? ''} ${s?.working ?? ''} ${s?.source ?? ''}`),
      )
    ) {
      return `episode.json.science must contain at least one real, worked-out fact with non-TODO "claim", "working" and "source".`;
    }
  }

  // Language consistency: if the narration is in French, the title and beat 2 must not keep "WHAT IF YOU COULD" in English
  const frHits = (fullText.match(/\b(tu|le|la|les|un|une|des|dans|sur|pour|avec|est|sont|mais|plus)\b/gi) ?? []).length;
  const isFrench = frHits >= 4;
  const titleStr = Array.isArray(episode?.title) ? episode.title.join(' ') : String(episode?.title ?? '');
  if (isFrench && /\bwhat\s+if\s+you\s+could\b/i.test(titleStr)) {
    return `episode.json.title mixes English ("WHAT IF YOU COULD") with a French episode ("${titleStr}"). Use a French title such as ["ET SI TU POUVAIS", "… ?"].`;
  }
  if (isFrench && /\bwhat\s+if\s+you\s+could\b/i.test(fullText)) {
    return `episode.json.script contains the English phrase "What if you could" inside a French narration (${slug}): write beat 2 in French ("Et si tu pouvais … ?") so the French TTS voice does not pronounce English with a broken accent.`;
  }
  return null;
}

/**
 * Static audit of shots.tsx + index.tsx against timeline.json:
 * - every timeline shot is exported in shots.tsx AND wired into defineEpisode in index.tsx,
 * - inhabited sets include <Hero> (and at least half of all shots show a character),
 * - every <Hero> is animated with poseAt (>= 2 keyframes) and faceAt,
 * - local clock `t` is used in FRAMES (0..len), never decimal seconds (t - 0.8) and never past `len`,
 * - camera zoom in camT stays within 0.8..3.2, and elements are centred around x=960 (not x=640).
 */
export function shotsAudit(projectRoot: string, slug: string, episode: any, timeline: any): string | null {
  const src = path.join(projectRoot, 'src', 'episodes', slug);
  const tlShots: { id: string; len: number; size?: string; key?: number }[] = Array.isArray(timeline?.shots) ? timeline.shots : [];
  const epShots: Record<string, any> = {};
  for (const s of Array.isArray(episode?.shots) ? episode.shots : []) {
    if (s?.id) epShots[String(s.id)] = s;
  }
  const wanted = [...new Set(tlShots.map((s) => String(s.id ?? '')).filter(Boolean))];
  if (!wanted.length) return `timeline.json has no shots: run whatif_run { step: "plan" } first`;

  let shotsSource = '';
  try {
    shotsSource = fs.readFileSync(path.join(src, 'shots.tsx'), 'utf8');
  } catch {
    return `src/episodes/${slug}/shots.tsx is missing: write one component per shot (${wanted.join(', ')})`;
  }
  const missing = wanted.filter((id) => !new RegExp(`export\\s+(const|function)\\s+${id}\\b`).test(shotsSource));
  if (missing.length) {
    return `shots.tsx does not export ${missing.join(', ')} yet (the timeline renders ${wanted.join(', ')}): export every shot and wire them in index.tsx.`;
  }

  let indexSource = '';
  try {
    indexSource = fs.readFileSync(path.join(src, 'index.tsx'), 'utf8');
  } catch {
    return `src/episodes/${slug}/index.tsx is missing`;
  }
  const missingInIndex = wanted.filter((id) => !new RegExp(`\\b${id}\\b`).test(indexSource));
  if (missingInIndex.length) {
    return `src/episodes/${slug}/index.tsx does not register ${missingInIndex.join(', ')} in defineEpisode(..., { shots: { ... } }): update index.tsx so every shot in timeline.json is rendered.`;
  }

  // Slice shots.tsx into individual exported shot bodies
  const exportPositions: { id: string; start: number }[] = [];
  const expRe = /export\s+(?:const|function)\s+([A-Za-z0-9_$]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = expRe.exec(shotsSource)) !== null) {
    exportPositions.push({ id: m[1]!, start: m.index });
  }
  const bodies: Record<string, string> = {};
  for (let i = 0; i < exportPositions.length; i++) {
    const cur = exportPositions[i]!;
    const nextStart = i + 1 < exportPositions.length ? exportPositions[i + 1]!.start : shotsSource.length;
    bodies[cur.id] = shotsSource.slice(cur.start, nextStart);
  }

  const errors: string[] = [];
  let heroShots = 0;
  const fullScriptText = `${slug} ${episode?.topic ?? ''} ${(episode?.script ?? []).map((b: any) => `${b?.text ?? ''} ${b?.set ?? ''}`).join(' ')}`;
  const isSchoolStory = /\b(prof|professeur|classe|ecole|école|eleve|élève|tableau|cours|examen|interro|college|collège|lycee|lycée|math|teacher|school|classroom)\b/i.test(
    fullScriptText,
  );
  const frHits = (fullScriptText.match(/\b(tu|le|la|les|un|une|des|dans|sur|pour|avec|est|sont|mais|plus|je|elle|il)\b/gi) ?? []).length;
  const isFrench = frHits >= 4;

  // Continuity check: DIRECTOR.md / bible.json <-> shots.tsx
  let bible: any = null;
  try {
    const biblePath = path.join(src, 'bible.json');
    if (fs.existsSync(biblePath)) {
      bible = JSON.parse(fs.readFileSync(biblePath, 'utf8'));
      for (const c of Array.isArray(bible?.cast) ? bible.cast : []) {
        const cname = typeof c === 'string' ? c : String(c?.id ?? c?.name ?? '');
        if (cname && !new RegExp(`\\b${cname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(shotsSource)) {
          errors.push(`bible.json declares cast member "${cname}" which is missing from shots.tsx`);
        }
      }
      for (const req of Array.isArray(bible?.requiredElements) ? bible.requiredElements : []) {
        const token = String(req ?? '').trim();
        if (token && !shotsSource.includes(token)) {
          errors.push(`bible.json requires "${token}" in shots.tsx, but it was not found`);
        }
      }
    }
  } catch {
    /* ignore malformed optional bible.json */
  }

  try {
    const directorPath = path.join(src, 'DIRECTOR.md');
    if (fs.existsSync(directorPath)) {
      const directorMd = fs.readFileSync(directorPath, 'utf8');
      const dirHex = [...new Set((directorMd.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()))];
      const shotsHex = new Set((shotsSource.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()));
      if (dirHex.length >= 3) {
        const matchedHex = dirHex.filter((h) => shotsHex.has(h));
        if (matchedHex.length === 0) {
          errors.push(
            `DIRECTOR.md specifies colour palette (${dirHex.slice(0, 5).join(', ')}) that is completely absent from shots.tsx: keep DIRECTOR.md and shots.tsx in sync (use the set/character colours from DIRECTOR.md, or update DIRECTOR.md to match the actual set).`,
          );
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Check custom character looks defined via makeLook({ ... }): distinct silhouettes/jackets and dark-on-dark contrast
  const lookDefs: { name: string; jacket?: string; extra?: string; skin?: string }[] = [];
  for (const lm of shotsSource.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*makeLook\s*\(\s*\{([\s\S]*?)\}/g)) {
    const name = lm[1]!;
    const props = lm[2]!;
    const jacket = /jacket\s*:\s*['"]([^'"]+)['"]/.exec(props)?.[1];
    const extra = /extra\s*:\s*['"]([^'"]+)['"]/.exec(props)?.[1];
    const skin = /skin\s*:\s*['"]([^'"]+)['"]/.exec(props)?.[1];
    lookDefs.push({ name, jacket, extra, skin });
    if (jacket) {
      const lum = hexLuminance(jacket);
      const skinLum = skin ? hexLuminance(skin) : 0.8;
      if (lum !== null && lum < 0.06 && skinLum !== null && skinLum < 0.12) {
        errors.push(
          `Character look "${name}" has both near-black jacket (${jacket}) and dark skin (${skin}) which vanish against dark walls (traps.md: "Dark limbs vanish on dark sets"): use a lighter skin/jacket or bright accent.`,
        );
      }
    }
  }
  if (lookDefs.length >= 2) {
    for (let i = 0; i < lookDefs.length; i++) {
      for (let j = i + 1; j < lookDefs.length; j++) {
        const a = lookDefs[i]!;
        const b = lookDefs[j]!;
        if (
          a.jacket &&
          b.jacket &&
          a.jacket.toLowerCase() === b.jacket.toLowerCase() &&
          (a.extra ?? '') === (b.extra ?? '')
        ) {
          errors.push(
            `Characters "${a.name}" and "${b.name}" have identical jacket (${a.jacket}) and hair/hat extra ("${a.extra ?? 'default'}"): give each character a distinct silhouette (extra) and colour palette.`,
          );
        }
      }
    }
  }

  for (let shotIdx = 0; shotIdx < tlShots.length; shotIdx++) {
    const sh = tlShots[shotIdx]!;
    const id = String(sh.id ?? '');
    const len = Number(sh.len ?? 60);
    const body = bodies[id] ?? '';
    if (!body) continue;

    const epShot = epShots[id] ?? {};
    const set = String(epShot.set ?? '').toLowerCase();
    const size = String(epShot.size ?? sh.size ?? '').toLowerCase();
    const note = String(epShot.note ?? '');
    const isTitle = size.includes('title') || /<TitleCard\b/.test(body);
    const isInsert = size.includes('insert') || size.includes('macro');
    // an establishing wide or an empty-room beat may hold no character: the line is about the place, not a person
    const isEstablishing = size.includes('establishing') || size.includes('empty') || size.includes('detail');
    const isSchematic = size.includes('schematic') || size.includes('diagram') || set === 'schematic' || /<Schematic\b/.test(body);
    const hasHero = /<(Hero|Actor|Staged|Person)\b/.test(body);
    if (hasHero) heroShots++;

    if (!isTitle && !isInsert && !isSchematic && !isEstablishing && !hasHero) {
      errors.push(`${id} (set "${set || 'custom'}", size "${size || 'medium'}") has no <Hero>: show a character (<Hero look={...} pose={...} />), or set this shot's "size" to "establishing" or "insert" in episode.json if the line is about a place or an object`);
    }
    if (!isSchoolStory && /<Classroom\b/.test(body)) {
      errors.push(
        `${id} renders <Classroom> (with "7 × 8" on a blackboard) in a story that has nothing to do with school! Build a custom set that matches the story (<CustomRoom>, <RoomShell>, <Box>, <Outdoor>, <Vehicle>, or custom SVG).`,
      );
    }

    // Forbid replacing a spoken line / emotional reaction with a bare <Schematic> diagram and no character
    const isDialogueOrReaction = /\b(souri|demandé|demande|dit-elle|dit-il|pleurait|hurlait|désolée|désolé|aide-moi|voyons)\b/i.test(note);
    if (isDialogueOrReaction && /<Schematic\b/.test(body) && !hasHero && set !== 'schematic') {
      errors.push(
        `${id} replaces a character dialogue/reaction ("${note.slice(0, 48)}") with an empty <Schematic> diagram and no <Hero>: show the speaking or reacting character (<Hero>) in the scene set!`,
      );
    }

    // Forbid mid-story <TitleCard> in narrative episodes (>= 8 shots) unless explicitly marked as title in the opening third
    if (/<TitleCard\b/.test(body) && tlShots.length >= 8 && shotIdx > Math.max(3, Math.floor(tlShots.length * 0.35)) && shotIdx < tlShots.length - 1 && !size.includes('title')) {
      errors.push(`${id} places a <TitleCard> in the middle of the story (shot ${shotIdx + 1}/${tlShots.length}): keep <TitleCard> for the opening premise only.`);
    }

    // Catch untranslated English titles/banners inside a French episode
    if (isFrench && /\b(YOU PUT ITCHING|WHAT IF YOU|MY BEST FRIEND|THE LAST GUY|I PUT ITCHING)\b/i.test(body)) {
      errors.push(`${id} contains untranslated English banner/title text in a French episode: write all on-screen labels and titles in French.`);
    }

    // Check that the shot actually uses its frame clock `t`
    const hasMotion =
      /\b(poseAt|faceAt|actPose|walkPose|talkAt|camPush|camPan|parallax|kf|DrawOn|CountUp|TitleCard|Arrow|PlantIcon|easeOut|clamp)\b/.test(body) ||
      /\bt\s*[*+-]/.test(body);
    if (!hasMotion) {
      errors.push(`${id} is static: animate with kf(t, ...), poseAt(t, ...), actPose('...', t), faceAt(t, ...) or DrawOn`);
    }

    // Catch the "t in seconds instead of frames" bug: e.g. `t - 0.8`, `t + 0.3`, `t - 1.1`
    const decOffset = body.match(/\bt\s*[+-]\s*0\.\d+|\(\s*t\s*[+-]\s*[012]\.\d+/);
    if (decOffset) {
      errors.push(`${id} uses "${decOffset[0]}" — clock \`t\` is in FRAMES at 30 fps (0..${len}), not seconds! Multiply seconds by 30 (e.g. t - 12, not t - 0.4)`);
    }

    // Catch keyframes scheduled past the shot's length `len` (e.g. faceAt(t, [[90, 'happy']]) or t={t - 90} in a 55-frame shot)
    const lateFrames: number[] = [];
    for (const fm of body.matchAll(/\{\s*f\s*:\s*(\d+(?:\.\d+)?)\s*,/g)) {
      const f = Number(fm[1]);
      if (f > len + 15) lateFrames.push(f);
    }
    for (const km of body.matchAll(/faceAt\s*\(\s*t\s*,\s*\[[^\]]*\[\s*(\d+(?:\.\d+)?)\s*,\s*'[a-z]+'/g)) {
      const f = Number(km[1]);
      if (f > len + 15) lateFrames.push(f);
    }
    for (const tm of body.matchAll(/\bt\s*=\s*\{\s*t\s*-\s*(\d+)\s*\}/g)) {
      const f = Number(tm[1]);
      if (f >= len - 4) lateFrames.push(f);
    }
    if (lateFrames.length) {
      errors.push(
        `${id} schedules animation at frame(s) ${lateFrames.slice(0, 4).join(', ')} but ${id} is only ${len} frames long (t runs 0..${len}): scale keyframes inside 0..${Math.max(10, len - 6)}`,
      );
    }

    // Catch absurd camera zoom in camT (direct number or kf) or camPush
    for (const cz of body.matchAll(
      /\bcamT\s*\([^;]*?,\s*kf\s*\(\s*t\s*,\s*\[\s*\[\s*[^,\]]+\s*,\s*(\d+(?:\.\d+)?)\s*\]\s*,\s*\[\s*[^,\]]+\s*,\s*(\d+(?:\.\d+)?)\s*\]\s*\]\s*\)\s*\)/g,
    )) {
      const z = Math.max(Number(cz[1]), Number(cz[2]));
      const zMin = Math.min(Number(cz[1]), Number(cz[2]));
      if (z > 4.5 || zMin < 0.6) {
        errors.push(`${id} animates camT zoom to ${z} (keep zoom in 0.6..4.5; extreme zoom shows an empty wall/window)`);
      }
    }
    for (const cd of body.matchAll(/\bcamT\s*\(\s*[^,]+,\s*[^,]+,\s*(\d+(?:\.\d+)?)\s*\)/g)) {
      const z = Number(cd[1]);
      if (z > 4.5 || z < 0.6) {
        errors.push(`${id} sets camT zoom to ${z} (keep zoom in 0.6..4.5; zoom ${z} shows an empty wall/window)`);
      }
    }

    // Catch stage positions off the ground: u is across the floor, w runs from the back wall (0) to the camera (1)
    for (const at of body.matchAll(/\bat=\{\{\s*u:\s*(-?\d*\.?\d+)\s*,\s*w:\s*(-?\d*\.?\d+)/g)) {
      const [u, w] = [Number(at[1]), Number(at[2])];
      if (u < -0.1 || u > 1.1 || w < 0 || w > 1) {
        errors.push(`${id} places something at u ${u}, w ${w}: u runs across the floor (0..1) and w from the back wall (0) to the camera (1)`);
      }
    }

    // Catch restaurant tablecloth / candle / plates used inside non-restaurant settings (classroom, bedroom, rooftop, stairwell, study)
    const defaultSet = String(bible?.defaultSet ?? '').toLowerCase();
    if (defaultSet && ['classroom', 'bedroom', 'rooftop', 'stairwell', 'study'].includes(defaultSet)) {
      if (/<DiningTable[^>]*\b(?:candle|plates|cloth\s*=\s*['"]#9E2A3B['"])/i.test(body)) {
        errors.push(
          `${id} uses restaurant props (candle / plates / red tablecloth cloth="#9E2A3B") on <DiningTable> inside a "${defaultSet}" episode: use a plain wooden desk/table (<DiningTable x={...} y={...} w={...} wood="#B98A55" /> without cloth, candle or plates).`,
        );
      }
    }

    // Catch elements drawn at x=640 (1280x720 centre) when the canvas is 1920x1080 (centre x=960)
    const x640 = (body.match(/\bx\s*[:=]\s*\{?\s*6[456]0\b/g) ?? []).length;
    const x960 = (body.match(/\bx\s*[:=]\s*\{?\s*(?:8[5-9]\d|9\d\d|10\d\d|11\d\d)\b/g) ?? []).length;
    if (x640 >= 2 && x960 === 0) {
      errors.push(`${id} centres its elements at x≈640–660 on a 1920x1080 canvas (leaving the right half empty): centre around x=960`);
    }
  }

  // Fast local in-memory SSR smoke test (catches runtime TypeErrors/ReferenceErrors in <0.3s before Modal)
  try {
    const nm = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(path.join(nm, 'typescript')) && fs.existsSync(path.join(nm, 'react-dom'))) {
      const req = createRequire(path.join(projectRoot, 'package.json'));
      const ts = req('typescript');
      const React = req('react');
      const ReactDOMServer = req('react-dom/server');
      const jsxRuntime = req('react/jsx-runtime');
      const cache: Record<string, { exports: any }> = {};
      const loadMod = (rel: string): any => {
        let full = path.join(projectRoot, rel);
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
          for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
            if (fs.existsSync(full + ext) && fs.statSync(full + ext).isFile()) {
              full = full + ext;
              break;
            }
          }
        }
        if (cache[full]) return cache[full]!.exports;
        if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
        const srcCode = fs.readFileSync(full, 'utf8');
        const transpiled = ts.transpileModule(srcCode, {
          compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        }).outputText;
        const mod = { exports: {} as any };
        cache[full] = mod;
        const localReq = (id: string) => {
          if (id === 'react') return React;
          if (id === 'react/jsx-runtime') return jsxRuntime;
          if (id === 'remotion') return { AbsoluteFill: 'div', Audio: 'audio', staticFile: (s: string) => s, useCurrentFrame: () => 0 };
          if (id.startsWith('@remotion/google-fonts')) return { loadFont: () => ({ fontFamily: 'sans-serif' }) };
          if (id.startsWith('.')) return loadMod(path.relative(projectRoot, path.resolve(path.dirname(full), id)));
          return req(id);
        };
        new Function('exports', 'require', 'module', transpiled)(mod.exports, localReq, mod);
        return mod.exports;
      };
      const exportedShots = loadMod(`src/episodes/${slug}/shots.tsx`);
      for (const sh of tlShots) {
        const id = String(sh.id ?? '');
        const Comp = exportedShots?.[id];
        if (typeof Comp !== 'function') continue;
        const len = Math.max(30, Number(sh.len ?? 90));
        const key = Math.min(len - 1, Math.max(0, Number(sh.key ?? 18)));
        for (const t of [0, key, len]) {
          try {
            ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { t, len, f: t }));
          } catch (err) {
            errors.push(`${id} crashes at runtime (t=${t}): ${(err as Error).message}`);
            break;
          }
        }
      }
    }
  } catch {
    /* ignore SSR harness load errors when node_modules is incomplete */
  }

  const minHeroShots = Math.max(2, Math.ceil(tlShots.length * 0.3));
  if (heroShots < minHeroShots) {
    errors.push(
      `Only ${heroShots}/${tlShots.length} shots include <Hero>: at least ${minHeroShots} shots must feature Pip/Mo/cast on screen so the episode is character-driven, not a slide deck.`,
    );
  }
  const totalPoseFaceCalls = (shotsSource.match(/\b(poseAt|faceAt|actPose|walkPose)\s*\(/g) ?? []).length;
  const minPoseFaceCalls = Math.max(4, Math.ceil(tlShots.length * 0.85));
  if (totalPoseFaceCalls < minPoseFaceCalls) {
    errors.push(
      `shots.tsx only has ${totalPoseFaceCalls} poseAt()/faceAt()/actPose() call(s) across ${tlShots.length} shots (need at least ${minPoseFaceCalls}): animate the characters' poses and expressions across the shots.`,
    );
  }

  if (errors.length) {
    return `shots.tsx failed the animation & composition check:\n- ${errors.slice(0, 10).join('\n- ')}`;
  }
  return null;
}

/**
 * The pipeline has one legal order, and an unattended agent drifts out of it: it will happily render
 * stills from the placeholder timeline before the voice exists, then spend a turn "diagnosing" a board
 * with one panel. So each step refuses to run until what it consumes exists, and says what to run next.
 */
function prerequisite(projectRoot: string, slug: string, step: string): string | null {
  const src = path.join(projectRoot, 'src', 'episodes', slug);
  let broken = '';
  const readJson = (file: string): any => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      broken = (err as Error).message;
      return null;
    }
  };
  const episodePath = path.join(src, 'episode.json');
  const episode = readJson(episodePath);
  if (!fs.existsSync(episodePath)) return `no src/episodes/${slug}/episode.json: scaffold the episode with whatif_new first`;
  if (!episode) return `src/episodes/${slug}/episode.json is not valid JSON (${broken}): repair it before running ${step}`;
  const scriptWords = countScriptWords(episode.script);
  const wordsFile = path.join(src, 'words.json');
  const words = readJson(wordsFile);
  const timeline = readJson(path.join(src, 'timeline.json'));
  const voiced = fs.existsSync(path.join(projectRoot, 'public', slug, 'voice.wav'));
  const staleTimeline = !timeline || Number(timeline.total ?? 0) <= 300 || String(timeline.title ?? '') === 'PLACEHOLDER';

  if (step === 'voice' || step === 'shotlist' || step === 'plan' || step === 'stills' || step === 'render') {
    if (!scriptWords) return `episode.json has no script yet: write the script first (${slug})`;
    const epErr = episodeAudit(episode, slug);
    if (epErr) return epErr;
  }
  if (step === 'shotlist' || step === 'plan') {
    if (!words?.length) return `src/episodes/${slug}/words.json is missing: run whatif_run { step: "voice" } first, it is what the plan times itself on`;
    if (!voiced) return `public/${slug}/voice.wav is missing: run whatif_run { step: "voice" } first`;
  }
  if (step === 'stills' || step === 'board' || step === 'motiongrid' || step === 'render') {
    const shots = (episode?.shots ?? []) as any[];
    if (shots.length && shots.every((sh) => /placeholder/i.test(String(sh.note ?? ''))))
      return `${shots.length} placeholder shot(s) only: the scaffold's generic single shot has nothing to do with the script. Run whatif_run { step: "shotlist" } to cut the words into shots, write DIRECTOR.md and shots.tsx, then stills`;
    if (staleTimeline)
      return `timeline.json is still the placeholder (${timeline?.segments?.length ?? 1} segment): run whatif_run { step: "voice" } then { step: "plan" } first, or every shot renders at 0.0 s`;
    const directorPath = path.join(src, 'DIRECTOR.md');
    const directorText = fs.existsSync(directorPath) ? fs.readFileSync(directorPath, 'utf8').trim() : '';
    if (directorText.length < 200) {
      return (
        `src/episodes/${slug}/DIRECTOR.md is missing or incomplete (${directorText.length} chars): before rendering stills or video, write a real Réalisation & Mise en Scène document in src/episodes/${slug}/DIRECTOR.md (>= 200 chars) covering:\n` +
        `1. Architecture des décors en profondeur (arrière-plan, plan moyen mobilier/table <DiningTable>/<Desk>, premier plan),\n` +
        `2. Casting & looks des personnages (makeLook),\n` +
        `3. Découpage plan par plan : cadrage (plans à deux avec tableSit quand deux personnages discutent à table), placement, et chorégraphie physique des bras/mains quand un personnage tient, prend ou pose un objet (handRProp, handWorld, reachPose, grabAt — jamais d'objet flottant loin des mains).`
      );
    }
    const auditErr = shotsAudit(projectRoot, slug, episode, timeline);
    if (auditErr) return auditErr;
  }
  if (step === 'sfx' || step === 'mixcheck' || step === 'render') {
    if (staleTimeline) return `timeline.json is still the placeholder: run voice then plan before ${step}`;
    if (!words?.length) return `words.json is missing: run whatif_run { step: "voice" } first`;
  }
  if (step === 'render') {
    if (!fs.existsSync(path.join(projectRoot, 'out', slug, 'storyboard.jpg'))) {
      return `out/${slug}/storyboard.jpg does not exist yet: run whatif_run { step: "stills" } and { step: "board" } and inspect the storyboard before rendering the full video`;
    }
  }
  if (step === 'master' && !fs.existsSync(path.join(projectRoot, 'out', slug, `${slug}-raw.mp4`))) {
    return `out/${slug}/${slug}-raw.mp4 does not exist: run whatif_run { step: "render" } first`;
  }
  return null;
}


const readJsonFile = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The edit anchors an episode declares (shot -> at). */
function episodeEdit(projectRoot: string, slug: string): any[] | null {
  return readJsonFile(path.join(projectRoot, 'src', 'episodes', slug, 'episode.json'))?.edit ?? null;
}

/** A spread of the measured words, so the agent can pick anchors that actually resolve (NO "w:" prefix!). */
function anchorHints(projectRoot: string, slug: string): string {
  const words = readJsonFile(path.join(projectRoot, 'src', 'episodes', slug, 'words.json'));
  if (!Array.isArray(words) || !words.length) return '(no words.json: run voice first)';
  const step = Math.max(1, Math.floor(words.length / 14));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    const w = String(words[i]?.w ?? '').replace(/[^\p{L}\p{N}'-]/gu, '');
    if (w) out.push(`"at": "${w}" (${Number(words[i]?.s ?? 0).toFixed(2)}s)`);
  }
  return out.join(', ');
}

const STEPS: Record<string, { py?: string; node?: string; own?: boolean; timeoutMs?: number; desc: string }> = {
  install: { desc: 'npm install in the project studio (with its devDependencies, needed by tsc)', timeoutMs: 900_000 },
  source: {
    py: 'source_import.py',
    own: true,
    timeoutMs: 1_200_000,
    desc: 'nouveau video id -> English transcript -> French narration proposals (needs a video id)',
  },
  voice: { py: 'voice_fish.py', own: true, timeoutMs: 900_000, desc: 'ElevenLabs TTS (default: eleven_v4, Hugo/Léa) or Fish Audio through :8005 + Deepgram word timings' },
  shotlist: {
    py: 'shotlist.py',
    own: true,
    desc: 'cut the measured words into 9-14 clause-aligned shots (>=27 cuts/min) + seed fx and sound in episode.json',
  },
  plan: { py: 'plan.py', desc: 'resolve cues into timeline.json' },
  stills: { py: 'modal_render.py', own: true, timeoutMs: 1_200_000, desc: 'storyboard stills on Modal' },
  board: { py: 'board.py', desc: 'build the storyboard sheet' },
  sfx: { py: 'sfx_run.py', own: true, timeoutMs: 900_000, desc: 'sound effects + music bed (ElevenLabs or cached studio library/sfx)' },
  mixcheck: { py: 'mixcheck.py', desc: 'check the voice stays clear' },
  motiongrid: { py: 'motiongrid.py', desc: 'frame grids per shot' },
  master: { py: 'master.py', timeoutMs: 1_800_000, desc: 'master to -14 LUFS (renders locally only if no Modal render exists)' },
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
      video: { type: 'string', description: 'nouveau video id to use as the source of the episode.' },
      aspect: { type: 'string', enum: ['16:9', '9:16'], description: 'Video orientation: "16:9" (1920x1080 landscape, default) or "9:16" (1080x1920 vertical Shorts/Reels/TikTok).' },
      force: { type: 'boolean', description: 'Scaffold into a non-empty folder.' },
    },
    required: ['episode'],
    additionalProperties: false,
  },
  validate: (input) => (/^[a-z0-9][a-z0-9-]*$/.test(String(input.episode ?? '')) ? null : 'episode must be a kebab-case slug'),
  async run(input: { episode: string; video?: string; aspect?: string; force?: boolean }, ctx): Promise<ToolResult> {
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
    // 2a. the improvements this app owns on top of the skill's engine (template classroom, wall pieces, 9:16 floor)
    const overlay = overlaySummary(applyEngineOverlay(ctx.projectRoot), true);

    // 2b. keep git checkpoints fast & small: ignore build/output and generated audio/video binaries,
    // and symlink node_modules from the skill studio when available so local tsc works out of the box without 250MB copies
    fs.writeFileSync(
      path.join(ctx.projectRoot, '.gitignore'),
      'node_modules/\nout/\npublic/*/*.wav\npublic/*/*.mp3\n*.mp4\n',
    );
    const projNodeModules = path.join(ctx.projectRoot, 'node_modules');
    if (!fs.existsSync(projNodeModules)) {
      const candidates = [path.join(studio, 'node_modules')];
      const projectsParent = path.dirname(ctx.projectRoot);
      try {
        for (const d of fs.readdirSync(projectsParent, { withFileTypes: true })) {
          if (d.isDirectory()) candidates.push(path.join(projectsParent, d.name, 'node_modules'));
        }
      } catch {
        /* ignore */
      }
      const existingNm = candidates.find((c) => fs.existsSync(path.join(c, '@types', 'react')));
      if (existingNm) {
        try {
          fs.symlinkSync(existingNm, projNodeModules, 'junction');
        } catch {
          /* ignore if symlink fails */
        }
      }
    }

    // 3. the episode skeleton
    const slug = input.episode;
    const aspect = normalizeAspect(input.aspect) ?? '16:9';
    const dir = safeJoin(ctx.projectRoot, `src/episodes/${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    const ep: Record<string, any> = EPISODE_STUB(slug, aspect);
    if (input.video) {
      ep.source = { provider: 'nouveau', videoId: input.video };
      // the voice goes through the local :8005 TTS API (ElevenLabs v4 at speed 1.15 by default, attached to the source video)
      ep.voice = { provider: 'elevenlabs', voiceId: '3Tp5mYhT9wrfnry9pzvV', modelId: 'eleven_v4', speakingRate: 1.15 };
    }
    fs.writeFileSync(path.join(dir, 'episode.json'), JSON.stringify(ep, null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TIMELINE_STUB(slug), null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'shots.tsx'), SHOT_STUB);
    fs.writeFileSync(
      path.join(dir, 'index.tsx'),
      INDEX_STUB.replace('__EXPORT__', camel(slug)).replace('__ID__', ep.id),
    );
    syncStudioAspect(ctx.projectRoot, slug, aspect);

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
        `# Project\n\n- skill: ${ctx.skillDir}\n- episode: ${slug}\n- aspect: ${aspect} (${aspect === '9:16' ? '1080x1920 vertical' : '1920x1080 landscape'})\n${input.video ? `- source video (nouveau): ${input.video}\n` : ''}- pipeline: source -> script -> voice -> plan -> stills -> board -> sfx -> render -> master (unattended)\n- voice: ElevenLabs TTS (default: eleven_v4, voice Hugo 3Tp5mYhT9wrfnry9pzvV or Léa KSyQzmsYhFbuOhqj1Xxv) through the local :8005 API\n- render: Modal (out/<slug>/<slug>-raw.mp4), then master.py --skip-render\n\n## Decisions\n\n- (the agent appends decisions here)\n`,
      );
    }
    return {
      ok: true,
      summary: `scaffolded ${ctx.projectRoot} with episode "${slug}" (id ${ep.id}, aspect ${aspect}). ${overlay}. Next: fill src/episodes/${slug}/episode.json, then stream "voice" and "plan".`,
      data: { projectRoot: ctx.projectRoot, episode: slug, id: ep.id, aspect },
    };
  },
};

const runStep: Tool = {
  name: 'whatif_run',
  description:
    'Run one pipeline step on an episode: source (import a nouveau video id), voice (ElevenLabs v4 TTS by default through the local :8005 API), shotlist (auto shot list from the measured words), plan, stills (Modal), board, sfx (ElevenLabs or cached studio library/sfx), mixcheck, motiongrid, master, render (Modal) or install. Returns the new artifacts (board stills, sheets, videos) you can look at.',
  policy: 'ask',
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      step: {
        type: 'string',
        enum: ['install', 'source', 'voice', 'shotlist', 'plan', 'stills', 'board', 'sfx', 'mixcheck', 'motiongrid', 'master', 'render'],
      },
      args: { type: 'array', items: { type: 'string' }, description: 'Extra argv, e.g. ["--pick","hook"] or ["S2","S5"].' },
    },
    required: ['episode', 'step'],
    additionalProperties: false,
  },
  validate: (input) => {
    const step = String(input.step ?? '');
    if (step !== 'render' && !STEPS[step]) return `unknown step ${step}`;
    return null;
  },
  cost: (input) => (String(input.step) === 'sfx' ? 200 : 0),
  async run(input: { episode: string; step: string; args?: string[] }, ctx): Promise<ToolResult> {
    if (!ctx.skillDir) throw new Error('WHATIF_SKILL_DIR is not set');
    const scripts = path.join(ctx.skillDir, 'scripts');
    const extra = input.args ?? [];
    const slug = input.episode;
    syncStudioAspect(ctx.projectRoot, slug);
    const blocked = prerequisite(ctx.projectRoot, slug, input.step);
    if (blocked) throw new Error(`cannot run ${input.step} yet — ${blocked}`);
    const before = snapshot(ctx.projectRoot);
    const renderMode = (process.env.WHATIF_RENDER ?? 'modal').toLowerCase();
    const rawMp4 = `out/${slug}/${slug}-raw.mp4`;
    const extraNotes: string[] = [];

    const forwardLine = (line: string) => {
      if (line.startsWith('RESULT_JSON:')) return;
      if (line.startsWith('PROGRESS_JSON:')) {
        try {
          const p = JSON.parse(line.slice('PROGRESS_JSON:'.length));
          const msg = p.stage ? `[${p.stage}] ${p.detail ?? p.status ?? JSON.stringify(p)}` : JSON.stringify(p);
          ctx.log(msg);
        } catch {
          ctx.log(line.slice('PROGRESS_JSON:'.length));
        }
        return;
      }
      ctx.log(line);
    };

    /** Run one more step in the same cwd (used for automatic shotlist/sfx/motiongrid chaining). */
    const stepOnce = async (name: string): Promise<{ code: number; text: string; result?: Record<string, unknown> }> => {
      const def = STEPS[name]!;
      const dir = def.own ? PIPELINE : scripts;
      const argv2 = def.py ? [PY, path.join(dir, def.py!), slug] : ['node', path.join(dir, def.node!), slug];
      ctx.log(`→ sub-step ${name} (${slug})…`);
      const r = await exec(argv2, { cwd: ctx.projectRoot, timeoutMs: def.timeoutMs ?? 600_000, signal: ctx.signal, onLine: forwardLine });
      const raw = r.stdout.split('\n').filter(Boolean);
      const line = raw.filter((l) => l.startsWith('RESULT_JSON:')).pop();
      let result: Record<string, unknown> | undefined;
      try {
        result = line ? (JSON.parse(line.slice('RESULT_JSON:'.length)) as Record<string, unknown>) : undefined;
      } catch {
        result = undefined;
      }
      return { code: r.code, text: raw.filter((l) => !l.startsWith('RESULT_JSON:')).slice(-18).join('\n'), result };
    };

    // Before planning, ensure the shot list has enough cuts (>=8 shots) and integer local `key` frames
    if (input.step === 'plan') {
      const epFile = path.join(ctx.projectRoot, 'src', 'episodes', slug, 'episode.json');
      const epData = readJsonFile(epFile);
      const shots = (epData?.shots ?? []) as any[];
      const coarse = shots.length < 8 || shots.every((sh) => /placeholder/i.test(String(sh.note ?? '')));
      if (coarse && fs.existsSync(path.join(ctx.projectRoot, 'src', 'episodes', slug, 'words.json'))) {
        const cut = await stepOnce('shotlist');
        extraNotes.push(`shot list built before planning (${shots.length || 1} -> ${String(cut.result?.shots ?? '?')} shots):\n${cut.text}`);
      } else if (epData && Array.isArray(epData.shots)) {
        let fixedKeys = false;
        for (const sh of epData.shots) {
          if (typeof sh.key !== 'number' || !Number.isInteger(sh.key) || sh.key < 6) {
            sh.key = 18;
            fixedKeys = true;
          }
        }
        if (fixedKeys) fs.writeFileSync(epFile, JSON.stringify(epData, null, 1) + '\n');
      }
    }

    // Before rendering the video, verify the storyboard passed layout checks and mix SFX + music if missing
    if (input.step === 'render') {
      const preLayout = await layoutReport(path.join(ctx.projectRoot, 'out', slug, 'board')).catch(() => '');
      if (preLayout.includes('\nEMPTY:')) {
        throw new Error(`cannot run render while storyboard stills fail layout checks:\n${preLayout}\nFix shots.tsx and re-run stills + board first.`);
      }
      if (!fs.existsSync(path.join(ctx.projectRoot, 'public', slug, 'sfx.wav'))) {
        const sfxRes = await stepOnce('sfx');
        extraNotes.push(`auto-mixed SFX & music bed before render:\n${sfxRes.text}`);
      }
    }

    let argv: string[];
    let timeoutMs = 600_000;
    if (input.step === 'install') {
      // --include=dev: the image runs with NODE_ENV=production, so a plain install skips @types/react
      // and every later `npx tsc --noEmit` fails with TS7026 (no JSX.IntrinsicElements).
      argv = ['npm', 'install', '--include=dev'];
      timeoutMs = 900_000;
    } else if (input.step === 'render') {
      const epJson = safeJoin(ctx.projectRoot, `src/episodes/${slug}/episode.json`);
      if (!fs.existsSync(epJson)) throw new Error(`no episode.json for ${slug}`);
      if (renderMode === 'local') {
        // escape hatch when Modal is unavailable: the exact command the skill's master.py runs
        const id = JSON.parse(fs.readFileSync(epJson, 'utf8')).id as string;
        argv = ['npx', 'remotion', 'render', 'src/index.ts', id, rawMp4, '--log', 'error', ...extra];
      } else {
        argv = [PY, path.join(PIPELINE, 'modal_render.py'), slug, '--mode', 'video', '--project', '.', ...extra];
      }
      timeoutMs = 1_800_000;
    } else if (
      input.step === 'master' &&
      renderMode !== 'local' &&
      fs.existsSync(safeJoin(ctx.projectRoot, rawMp4))
    ) {
      // the video came from Modal: master it instead of rendering it again locally
      argv = [PY, path.join(scripts, 'master.py'), slug, '--skip-render', ...extra.filter((a) => a !== '--skip-render')];
      timeoutMs = 1_800_000;
    } else {
      const step = STEPS[input.step]!;
      const dir = step.own ? PIPELINE : scripts;
      if (input.step === 'stills') {
        argv =
          renderMode === 'local'
            ? ['node', path.join(scripts, 'stills.mjs'), slug, ...extra]
            : [PY, path.join(PIPELINE, 'modal_render.py'), slug, '--mode', 'stills', '--project', '.', '--scale', '0.5', ...extra];
      } else if (step.py) argv = [PY, path.join(dir, step.py), slug, ...extra];
      else if (step.node) argv = ['node', path.join(dir, step.node), slug, ...extra];
      else throw new Error(`step ${input.step} has no command`);
      if (step.timeoutMs) timeoutMs = step.timeoutMs;
    }

    ctx.log(`whatif_run ${input.step} ${slug}: ${argv.join(' ')}`);
    const res = await exec(argv, { cwd: ctx.projectRoot, timeoutMs, signal: ctx.signal, onLine: forwardLine });
    const lines = res.stdout.split('\n').filter(Boolean);
    // our pipeline scripts report one machine-readable line; the rest is the human log
    let payload: Record<string, unknown> | undefined;
    const resultLine = lines.filter((l) => l.startsWith('RESULT_JSON:')).pop();
    if (resultLine) {
      try {
        payload = JSON.parse(resultLine.slice('RESULT_JSON:'.length)) as Record<string, unknown>;
      } catch {
        payload = undefined;
      }
    }
    const visible = lines.filter((l) => !l.startsWith('RESULT_JSON:') && !l.startsWith('PROGRESS_JSON:'));
    const tail = (s: string[]) => s.slice(-25).join('\n');
    const credits =
      typeof payload?.credits === 'number'
        ? payload.credits
        : typeof payload?.character_count === 'number'
          ? payload.character_count
          : undefined;
    let failed = payload ? payload.ok === false : res.code !== 0;

    // After rendering the video, automatically build the motion grids (`out/<slug>/motion/*.jpg`) so motion is inspected
    if (input.step === 'render' && !failed && fs.existsSync(safeJoin(ctx.projectRoot, rawMp4))) {
      const mg = await stepOnce('motiongrid');
      if (mg.code === 0) extraNotes.push(`motion grids generated in out/${slug}/motion/:\n${mg.text}`);
    }

    // The skill's storyboard.jpg is one tall strip (a 36-shot 9:16 episode is ~2280x10410): cut readable sheets of 8-9 shots
    // so the agent and the Reviewer can actually see each shot.
    if (input.step === 'board' && !failed) {
      const sheets = await exec([PY, path.join(PIPELINE, 'board_sheets.py'), ctx.projectRoot, slug], {
        cwd: ctx.projectRoot,
        timeoutMs: 120_000,
        signal: ctx.signal,
      }).catch(() => null);
      if (sheets && sheets.code === 0) {
        const made = sheets.stdout.split('\n').filter(Boolean);
        extraNotes.push(
          `contact sheets (8-9 shots each, readable): ${made.join(', ')}. view_image each sheet and run the board self-check of the director's guide on it; open a single still (out/${slug}/board/S<n>.png) for any shot that looks wrong.`,
        );
      } else {
        extraNotes.push(`contact sheets not built (${sheets ? sheets.stderr.split('\n').filter(Boolean).pop() : 'script did not run'}): the long storyboard.jpg is hard to read, view stills one by one.`);
      }
    }

    const artifacts = diffArtifacts(ctx.projectRoot, before);
    const layout = input.step === 'stills' || input.step === 'board' ? await layoutReport(path.join(ctx.projectRoot, 'out', slug, 'board')).catch(() => '') : '';
    let layoutFailure = '';
    if (layout.includes('\nEMPTY:')) {
      failed = true;
      const failedMatch = /FAILED_SHOTS:\s*([^\n]+)/.exec(layout);
      const failedArgs = failedMatch
        ? failedMatch[1]!
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const rerunHint = failedArgs.length
        ? `whatif_run { episode: "${slug}", step: "stills", args: ${JSON.stringify(failedArgs)} } then { episode: "${slug}", step: "board" }`
        : `whatif_run { episode: "${slug}", step: "stills" }`;
      layoutFailure = `One or more shots failed the layout/ink check (see EMPTY above): fix ONLY those shots in shots.tsx and re-render them with ${rerunHint}.`;
    }
    let planWarning = '';
    if (input.step === 'plan' && !failed) {
      const tl = readJsonFile(path.join(ctx.projectRoot, 'src', 'episodes', slug, 'timeline.json'));
      const wanted = new Set<string>(((episodeEdit(ctx.projectRoot, slug) ?? []) as any[]).map((e) => String(e.shot ?? '')));
      const segs = (tl?.segments ?? []) as any[];
      const got = segs.length;
      const fps = Number(tl?.fps ?? 30);
      const durSec = Number(tl?.total ?? 0) / fps;
      const cutsPerMin = durSec > 0 ? ((got - 1) / durSec) * 60 : 0;
      const longestSec = segs.reduce((m, s) => Math.max(m, (Number(s.b ?? 0) - Number(s.a ?? 0)) / fps), 0);
      if (wanted.size > 1 && got < wanted.size) {
        failed = true;
        planWarning =
          `PLAN COLLAPSED: ${got} segment(s) for ${wanted.size} shots. plan.py times each shot from an anchor in ` +
          `episode.json.edit, matched against the words it measured in words.json; anchors it cannot find are merged ` +
          `into the previous shot.\nAnchor candidates (substitute for the "at" values, one per shot):\n${anchorHints(ctx.projectRoot, slug)}`;
      } else {
        const minCutsPerMin = durSec > 30 ? 12 : 24;
        const maxShotSec = durSec > 30 ? 7.0 : 3.8;
        if (durSec >= 12 && (cutsPerMin < minCutsPerMin || longestSec > maxShotSec)) {
          failed = true;
          planWarning =
            `PACE TOO SLOW: ${got} segments over ${durSec.toFixed(1)}s (${cutsPerMin.toFixed(1)} cuts/min, longest shot ${longestSec.toFixed(1)}s). ` +
            `Run whatif_run { step: "shotlist" } to cut the measured words into clause-aligned shots, then run plan again.`;
        }
      }
    }
    const payloadWithoutLog = payload ? Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'log')) : undefined;
    const remoteLogTail = typeof payload?.log === 'string' && payload.log.trim() ? `\n\n[remote log]\n${payload.log.slice(-3500)}` : '';
    return {
      ok: !failed,
      summary: `$ ${argv.join(' ')}\nexit ${res.code}${res.timedOut ? ' (timeout)' : ''}\n${tail(visible)}${res.stderr ? `\n[stderr]\n${tail(res.stderr.split('\n').filter(Boolean))}` : ''}${
        payloadWithoutLog ? `\n\nresult: ${JSON.stringify(payloadWithoutLog).slice(0, 1200)}` : ''
      }${remoteLogTail}${artifacts.length ? `\n\n${artifacts.length} new file(s): ${artifacts.map((a) => a.path).join(', ')}` : ''}${
        layout ? `\n\n${layout}` : ''
      }${layoutFailure ? `\n\n${layoutFailure}` : ''}${extraNotes.length ? `\n\n${extraNotes.join('\n\n')}` : ''}${planWarning ? `\n\n${planWarning}` : ''}`,
      artifacts,
      credits,
      data: { step: input.step, code: res.code, result: payload },
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
      director: has(path.join(dir, 'DIRECTOR.md')),
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
    if (!ctx.skillDir) {
      // no skill mounted: only the app's own engine overlay can be applied
      const only = applyEngineOverlay(ctx.projectRoot, { dryRun: !input.apply });
      return { ok: true, summary: `no skill mounted (WHATIF_SKILL_DIR unset): ${overlaySummary(only, Boolean(input.apply))}`, data: { overlay: only } };
    }
    const skillStudio = path.join(ctx.skillDir, 'studio');
    const targets = input.paths?.length ? input.paths : ['src/engine', 'src/studio.config.ts'];
    const added: string[] = [];
    const identical: string[] = [];
    const modified: string[] = [];
    for (const target of targets) {
      const from = path.join(skillStudio, target);
      if (!fs.existsSync(from)) continue;
      if (fs.statSync(from).isFile()) {
        const rel = path.relative(skillStudio, from).split(path.sep).join('/');
        const mine = safeJoin(ctx.projectRoot, rel);
        if (!fs.existsSync(mine)) {
          added.push(rel);
          if (input.apply) {
            fs.mkdirSync(path.dirname(mine), { recursive: true });
            fs.copyFileSync(from, mine);
          }
        } else if (fs.readFileSync(from).equals(fs.readFileSync(mine))) {
          identical.push(rel);
        } else {
          modified.push(rel);
          if (input.apply) fs.copyFileSync(from, mine);
        }
        continue;
      }
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
    // the skill's copy was just written over the project's: put the app's improvements back on top
    const overlay = applyEngineOverlay(ctx.projectRoot, { dryRun: !input.apply });
    return {
      ok: true,
      summary: `${verb}: ${added.length} new, ${modified.length} locally modified, ${identical.length} up to date.${added.length ? `\nnew: ${added.slice(0, 20).join(', ')}` : ''}${modified.length ? `\n${input.apply ? 'overwritten' : 'to review'}: ${modified.slice(0, 20).join(', ')}` : ''}\n${overlaySummary(overlay, Boolean(input.apply))}`,
      data: { added, modified, identical, overlay },
    };
  },
};

export const whatifTools: Tool[] = [newProject, runStep, status, syncEngine];
