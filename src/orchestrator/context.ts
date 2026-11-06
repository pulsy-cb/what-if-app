import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart } from './providers/types.js';
import type { MessageRow } from './db.js';
import { readText, walk } from '../tools/paths.js';
import { engineDigest } from './engine-digest.js';

export const SYSTEM_PROMPT = `You are the studio agent of "What If", a vertical short-animation pipeline (15–25 s, 1920x1080@30, SVG + Remotion).

You work inside ONE project folder (the studio) and you change it with tools. You never print shell
commands for a human to paste: you call the tools.

## The pipeline (this order is the product)
0. Source. Most of the time the user only gives you a video id from the local "nouveau" app (a YouTube
   video id, or a TikTok id). whatif_new { episode, video } scaffolds the project with that source, then
   whatif_run source runs the import: English transcript (Deepgram) -> 2 French *narration* proposals
   (via the local API) -> the chosen one is saved in out/<episode>/source.fr.md, and the proposal/TTS
   stay attached to that video id so the user can follow everything in the nouveau UI. Read that file,
   then write the 15–25 s episode script yourself: it is a condensation, not a translation.
   Budget: Fish locked at speakingRate 1 reads ~3.4 French words/second, so 15-25 s means **50-60 words
   total**, not 30 (too short) and not 80 (too long). whatif_run voice reports the measured duration and
   words count: if it lands outside 15-25 s, rewrite and stream voice again (the take is cached by text).
1. episode.json — the script: cold open with 3 demos (small/selfish, useful, uncanny), the premise as a
   title card, then the turn: one real, sourced fact about the cost.
2. whatif_run voice — Fish Audio (free tier, model s2.1-pro-free) through the local TTS API, on the same
   video id. It writes public/<episode>/voice.wav and src/episodes/<episode>/words.json: the script's
   words with the *measured* times (Fish gives no timestamps, so the take is transcribed and realigned).
   ElevenLabs is only for the SFX — never for the voice.
3. whatif_run plan — turns episode.json.edit into timeline.json (schema 2: total, segments{a,b,t0,t1,shot,look},
   shots, fx, audio). Each edit entry is {"shot": "S2", "at": "<cue>"} and a cue is one of:
     f:120          an absolute frame            s:4.2      seconds
     S1+2 / S1#2+2  2 frames after shot S1 (or after its 2nd segment; S1-4 is before it)
     franchir / franchir+3 / le#2-2   a *word of the script as measured in words.json*, optionally its
                    nth occurrence and an offset. There is **no "w:" prefix**: "w:franchir" is a bad cue
                    and plan.py fails with Cue word "w:franchir" (#1) not found. Cues must also be in
                    increasing order of time. Read src/episodes/<slug>/words.json to pick real words.
4. whatif_run stills — one PNG per shot, rendered on Modal.
5. whatif_run board — the storyboard sheet. Look at it with view_image and judge it yourself: if a shot
   is empty, off-model or unreadable, fix shots.tsx and run stills/board again.
6. whatif_run sfx + mixcheck — optional sound design (ElevenLabs credits). If sfx fails on an invalid
   or expired key, note it and carry on: the master works without it.
7. whatif_run render — renders the silent video on **Modal** (not locally). Then whatif_run master muxes
   the audio, normalises to -14 LUFS (peaks < -1 dBTP) and writes report.json.

## How you work
- **Run the pipeline end to end in one turn, unattended.** Nobody is watching for a question: go
  source -> script -> voice -> plan -> stills -> board -> render -> master and only then report
  (sfx / mixcheck / motiongrid are optional extras; a 401 from ElevenLabs is not a reason to stop).
  Stop early only for a fact you cannot invent (no video id, a missing API key, an explicit request from
  the user) — never to ask "shall I continue?" or "do you approve the board?".
- read_file before edit_file: oldText must match exactly (the block it returns is the one to copy).
- read_file returns the whole file in one call: never slice a file into 80-line windows, it burns steps.
- npm install in the studio needs its devDependencies (@types/react): whatif_run install does that. If
  tsc says "no interface JSX.IntrinsicElements", run whatif_run install once instead of debugging it.
- Batch related changes in one edit_file call. Prefer small, verifiable steps over big rewrites.
- The steps have one legal order and they enforce it: if a step answers "cannot run X yet", do the
  prerequisite it names (usually voice, then plan) and continue in the same turn — never end the turn
  with the pipeline half done, and never diagnose a stills/board render that ran on a placeholder timeline.
- Every shot is a pure function of its own clock t: no state, no Math.random(), seeded rnd(seed, i) only.
  keyframes via kf(), poses via poseAt(), faces via faceAt(), frames via camT().
- The engine (src/engine) belongs to the skill: change it only when the user explicitly asks, and say why.
- **Do not explore.** No repo_map tours, no ls /skill, no reading src/engine/*.tsx, /skill/references/* or
  another episode's shots: the cheat sheet and the generated export list above are enough, and every file
  you open costs a step you need for the pipeline. Open the engine only when a typecheck/render error names
  a line. Write shots.tsx straight from the export list.
- The cast is fixed (LOOKS: pip, pipHood, pipInk, mo, sis, mom, suit). Never invent a character or an asset path.
- Assets must be referenced through staticFile(), relative to public/.
- A real number needs a real source. If you don't have one, say so instead of inventing it.
- Look at what you produced: view_image on stills, the board and motion grids. A tool result is not a
  finished shot.
- Keep PROJECT.md up to date: the source video id, the decisions, the sources, what is done. That file
  is your memory across runs.
- Rendering and typechecking run on Modal (whatif_run render/stills); there is no Chromium in this
  container, so never try to render locally.
- Answer in the user's language (French if they write French). Be concrete and short: what you did, what it
  cost, what you need next.`;

function fileList(projectRoot: string, cap = 260): string {
  const files = walk(projectRoot, { maxFiles: cap });
  return files.join('\n');
}

function memory(projectRoot: string): string {
  const projectMd = readText(projectRoot, 'PROJECT.md', 40_000);
  const episodesDir = path.join(projectRoot, 'src', 'episodes');
  const episodes: string[] = [];
  if (fs.existsSync(episodesDir)) {
    for (const d of fs.readdirSync(episodesDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const ep = path.join(episodesDir, d.name, 'episode.json');
      if (!fs.existsSync(ep)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(ep, 'utf8'));
        episodes.push(`- ${d.name}: id=${json.id} title=${JSON.stringify(json.title)}`);
      } catch {
        episodes.push(`- ${d.name}: (episode.json unreadable)`);
      }
    }
  }
  return `${episodes.length ? `## Episodes\n${episodes.join('\n')}\n` : '## Episodes\n(none yet)\n'}${
    projectMd ? `\n## PROJECT.md\n${projectMd.slice(0, 6000)}` : '\n(no PROJECT.md yet)'
  }`;
}

const TOOL_BUDGET = 2_500;

function imagesFromPayload(payload: any, projectRoot: string, budget: { left: number }): ImagePart[] {
  const paths: string[] = Array.isArray(payload?.images) ? payload.images : [];
  const out: ImagePart[] = [];
  for (const rel of paths) {
    if (out.length >= 3 || budget.left <= 0) break;
    if (!/\.(png|jpe?g|webp)$/i.test(rel)) continue;
    try {
      const abs = path.join(projectRoot, rel);
      const st = fs.statSync(abs);
      if (st.size > budget.left || st.size > 4_000_000) continue;
      budget.left -= st.size;
      out.push({ mime: rel.toLowerCase().endsWith('.png') ? 'image/png' : rel.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(abs).toString('base64') });
    } catch {
      /* missing file: skip */
    }
  }
  return out;
}


/** A condensed map of the engine API, so a run does not spend 20 steps re-reading src/engine. */
const ENGINE_CHEAT = `## Engine cheat sheet (src/engine, stable: read the source only when a shot breaks)
import { Hero, LOOKS, basePose, poseAt, faceAt, camT, kf, rnd, ShotProps } from '../../engine';
import { Study, Kitchen, KITCHEN, stand, islandTop, Classroom, CLASSROOM, Rooftop, Stairwell, Bedroom, BEDROOM, Schematic } from '../../engine';

export const S1: React.FC<ShotProps> = ({ t, len }) => {           // one shot per timeline shot id
  const P = stand(KITCHEN, u, v);                                   // { x, y, scale } on a set's floor
  const pose = poseAt(t, [{ f: 0, p: { x: P.x, y: P.y, scale: P.scale, yaw: 0.4, look: 0.6 } }, { f: 40, p: { yaw: -0.3 } }]);
  const face = faceAt(t, [[0, 'neutral'], [30, 'shock']]);           // 'neutral'|'happy'|'smug'|'shock'|'worried'|'oops'|'cool'
  return (
    <g transform={camT(kf(t, [[0, 990], [len, 1000]]), 600, 1.9)}>  {/* camT(x, y, zoom) */}
      <Kitchen t={t} id="k1" />                                      {/* sets take t so nothing is frozen */}
      <Hero look={LOOKS.pipHood} pose={{ ...basePose, ...pose, ...face }} rimId="rim1" shadow={0} />
    </g>
  );
};
LOOKS: pip, pipHood, pipInk, mo, sis, mom, suit.  Sets: Study, Kitchen (KITCHEN, KitchenIsland, islandTop, stand),
Classroom (CLASSROOM), Rooftop, Stairwell, Bedroom (BEDROOM), Schematic.  Text: Marquee, and the ui.tsx primitives.
Rules: pure function of t (no state, no Math.random, seeded rnd(seed, i) only), assets through staticFile().`;


export type EpisodeStatus = { slug: string; words: number; seconds: string; done: string[]; todo: string[]; title: string };

/** Where the episode actually stands, recomputed every turn: cheaper than making the model re-read. */
export function episodeStatus(projectRoot: string): EpisodeStatus[] {
  const eps = path.join(projectRoot, 'src', 'episodes');
  let slugs: string[] = [];
  try {
    slugs = fs
      .readdirSync(eps, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: EpisodeStatus[] = [];
  for (const slug of slugs) {
    const src = path.join(eps, slug);
    let ep: any = {};
    try {
      ep = JSON.parse(fs.readFileSync(path.join(src, 'episode.json'), 'utf8'));
    } catch {
      continue;
    }
    const dir = path.join(projectRoot, 'out', slug);
    const has = (rel: string) => fs.existsSync(path.join(dir, rel));
    const words = (ep.script ?? []).reduce(
      (n: number, b: any) => n + String(b.text ?? '').split(/\s+/).filter(Boolean).length,
      0,
    );
    const steps: [string, boolean][] = [
      ['script', Array.isArray(ep.script) && ep.script.length > 0],
      ['words', fs.existsSync(path.join(src, 'words.json'))],
      ['timeline', fs.existsSync(path.join(src, 'timeline.json'))],
      ['voice', fs.existsSync(path.join(projectRoot, 'public', slug, 'voice.wav'))],
      ['stills', has('board')],
      ['board', has('storyboard.jpg')],
      ['render', has(`${slug}-raw.mp4`)],
      ['master', has(`${slug}-final.mp4`)],
    ];
    let seconds = '';
    try {
      const w = JSON.parse(fs.readFileSync(path.join(src, 'words.json'), 'utf8'));
      const last = Array.isArray(w) ? w[w.length - 1] : null;
      if (last?.e) seconds = `, voice ${Number(last.e).toFixed(1)}s`;
    } catch {
      /* no take yet */
    }
    out.push({
      slug,
      words,
      seconds,
      done: steps.filter(([, v]) => v).map(([k]) => k),
      todo: steps.filter(([, v]) => !v).map(([k]) => k),
      title: Array.isArray(ep.title) ? ep.title.join(' ') : String(ep.title ?? ''),
    });
  }
  return out;
}

function projectState(projectRoot: string): string {
  const status = episodeStatus(projectRoot);
  if (!status.length) return 'no episode yet';
  return status
    .map(
      (e) =>
        `- ${e.slug}: ${e.words} words${e.seconds} | done: ${e.done.join(' ') || '-'} | todo: ${e.todo.join(' ') || '-'}` +
        (e.title ? ` | title: ${e.title}` : ''),
    )
    .join('\n');
}

/** The steps an episode still owes, or [] when nothing is running. */
export function pipelineTodo(projectRoot: string): string[] {
  const status = episodeStatus(projectRoot);
  if (!status.length) return [];
  const started = status.find((e) => e.done.some((d) => d !== 'script')) ?? status[0]!;
  return started.todo.filter((t) => t !== 'script');
}

export type BuildOptions = {
  projectRoot: string;
  history: MessageRow[];
  maxChars: number;
};

/** Compile the conversation: system prompt, project memory, file list, then the (compacted) history. */
export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const head: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `## Project folder\n${opts.projectRoot}\n\n${memory(opts.projectRoot)}` },
    { role: 'system', content: `## Where the episode stands (live, recomputed each turn)\n${projectState(opts.projectRoot)}\n\nDo the next todo step; do not re-read files you already know unless a step fails.` },
    { role: 'system', content: ENGINE_CHEAT },
    { role: 'system', content: `## Every engine export and its props (generated from src/engine at the top of this turn)\n${engineDigest(opts.projectRoot)}\n\nThis listing is the contract: do not read src/engine/*.tsx again unless a typecheck or a render error names a specific line.` },
    { role: 'system', content: `## Files\n${fileList(opts.projectRoot)}` },
  ];
  const headChars = head.reduce((n, m) => n + m.content.length, 0);

  // Walk history backwards, keeping recent turns in full and older ones trimmed.
  const history = opts.history;
  const kept: ChatMessage[] = [];
  let used = headChars;
  let dropped = 0;
  const imageBudget = { left: 4_500_000 };

  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i]!;
    const payload = row.payload ? JSON.parse(row.payload) : null;
    const age = history.length - 1 - i;
    let content = row.content;
    if (row.role === 'tool' && age > 3) content = content.slice(0, TOOL_BUDGET);
    if (row.role === 'assistant' && age > 8) content = content.slice(0, 1_500);

    const msg = toChatMessage(row, payload, content, opts.projectRoot, imageBudget);
    const cost = ('content' in msg ? msg.content.length : 0) + 2_000; // images charged as a flat estimate
    if (used + cost > opts.maxChars && kept.length >= 4) {
      dropped = i + 1;
      break;
    }
    used += cost;
    kept.unshift(msg);
  }

  const out = [...head];
  if (dropped > 0) {
    out.push({
      role: 'system',
      content: `(${dropped} older messages were compacted to stay inside the context window. Re-read files if you need details; the .git history keeps checkpoints.)`,
    });
  }
  out.push(...kept);
  return out;
}

function toChatMessage(
  row: MessageRow,
  payload: any,
  content: string,
  projectRoot: string,
  imageBudget: { left: number },
): ChatMessage {
  if (row.role === 'tool') {
    return { role: 'tool', toolCallId: String(payload?.toolCallId ?? ''), name: String(payload?.name ?? 'tool'), content };
  }
  if (row.role === 'assistant') {
    return { role: 'assistant', content, toolCalls: payload?.toolCalls ?? undefined };
  }
  if (row.role === 'system') return { role: 'system', content };
  return { role: 'user', content, images: imagesFromPayload(payload, projectRoot, imageBudget) };
}

/** The text a tool result is stored as: what the model reads on the next turn. */
export function toolMessageContent(result: { ok: boolean; summary: string; artifacts?: { path: string; kind: string }[] }): string {
  const arts = (result.artifacts ?? []).filter((a) => a.kind !== 'text');
  const suffix = arts.length ? `\n[files: ${arts.map((a) => `${a.path} (${a.kind})`).join(', ')}]` : '';
  return `${result.ok ? 'ok' : 'ERROR'}\n${result.summary}${suffix}`.slice(0, 12_000);
}
