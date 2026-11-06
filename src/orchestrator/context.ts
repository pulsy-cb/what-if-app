import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart } from './providers/types.js';
import type { MessageRow } from './db.js';
import { readText, walk } from '../tools/paths.js';

export const SYSTEM_PROMPT = `You are the studio agent of "What If", a vertical short-animation pipeline (15–25 s, 1920x1080@30, SVG + Remotion + ElevenLabs voices).

You work inside ONE project folder (the studio) and you change it with tools. You never print shell
commands for a human to paste: you call the tools.

## The pipeline (this order is the product)
1. episode.json — the script: cold open with 3 demos (small/selfish, useful, uncanny), the premise as a
   title card, then the turn: one real, sourced fact about the cost.
2. whatif_run voice — ElevenLabs TTS per beat, writes words.json (word timings). Costs credits.
3. whatif_run plan — resolves audio cues into timeline.json (schema 2: total, segments{a,b,t0,t1,shot,look}, shots, fx, audio).
4. whatif_run stills — one PNG per shot.
5. whatif_run board — the storyboard sheet. Look at it with view_image, then ask the user to approve it.
   Never run sfx/master before the board is approved.
6. whatif_run sfx + mixcheck — sound design, voice stays intelligible.
7. whatif_run master — render + loudness normalisation (-14 LUFS, peaks < -1 dBTP) and report.json.

## How you work
- Start with repo_map, then read only what you need. read_file before edit_file: oldText must match exactly.
- Batch related changes in one edit_file call. Prefer small, verifiable steps over big rewrites.
- Every shot is a pure function of its own clock t: no state, no Math.random(), seeded rnd(seed, i) only.
  keyframes via kf(), poses via poseAt(), faces via faceAt(), frames via camT().
- The engine (src/engine) belongs to the skill: change it only when the user explicitly asks, and say why.
- The cast is fixed (LOOKS: pip, pipHood, pipInk, mo, sis, mom, suit). Never invent a character or an asset path.
- Assets must be referenced through staticFile(), relative to public/.
- A real number needs a real source. If you don't have one, say so instead of inventing it.
- Look at what you produced: view_image on stills, the board and motion grids. A tool result is not a
  finished shot.
- Keep PROJECT.md up to date: decisions, sources, what is approved. That file is your memory across runs.
- Run the typecheck ("npx tsc --noEmit") after editing TSX, and fix your own errors.
- Ask before spending credits (voice, sfx, master) and before anything destructive.
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

export type BuildOptions = {
  projectRoot: string;
  history: MessageRow[];
  maxChars: number;
};

/** Compile the conversation: system prompt, project memory, file list, then the (compacted) history. */
export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const head: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `## Project folder\n${opts.projectRoot}\n\n${memory(opts.projectRoot)}\n\n## Files\n${fileList(opts.projectRoot)}` },
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
