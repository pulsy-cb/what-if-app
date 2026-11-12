import fs from 'node:fs';
import path from 'node:path';
import { shotWordFrames } from '../orchestrator/context.js';
import type { Tool } from './types.js';

/**
 * The words of each shot with the frame each is said at, plus the shot's size and its line. The agent used to
 * open words.json / timeline.json with python and pipes, and the shell refused it 62 times in 16 projects
 * (2026-11-10/11): this is the allowed way to read them.
 */
export const shotWords: Tool = {
  name: 'shot_words',
  description:
    'Read what is said in the shots and when: for each shot its size, its length in frames and every word with the frame it is said at (word@frame, the shot\'s own clock), to place beats. Pass `ids` for some shots, or none for all of them. Use this instead of reading words.json or timeline.json.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      ids: { type: 'array', items: { type: 'string' }, description: 'shot ids such as ["S3","S4"]; default all (first 40 words each)' },
    },
    required: ['episode'],
    additionalProperties: false,
  },
  async run(input: { episode: string; ids?: string[] }, ctx) {
    const slug = String(input.episode ?? '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new Error('episode must be a slug such as "my-episode"');
    const dir = path.join(ctx.projectRoot, 'src', 'episodes', slug);
    if (!fs.existsSync(dir)) throw new Error(`src/episodes/${slug} does not exist`);
    const ids = input.ids?.length ? input.ids.map((i) => String(i).toUpperCase()) : undefined;
    const rows = shotWordFrames(ctx.projectRoot, slug, ids, ids ? 200 : 40);
    if (!rows.length) throw new Error(`no words for ${slug}${ids ? ` ${ids.join(', ')}` : ''}: run voice then plan first (words.json and timeline.json must exist)`);
    let sizes = new Map<string, string>();
    try {
      const ep = JSON.parse(fs.readFileSync(path.join(dir, 'episode.json'), 'utf8'));
      sizes = new Map((ep.shots ?? []).map((s: any) => [String(s.id), String(s.size ?? '')]));
    } catch {
      /* no episode.json */
    }
    const text = rows.map((r) => {
      const id = r.split(' ')[0]!;
      const size = sizes.get(id);
      return size ? r.replace(id, `${id} [${size}]`) : r;
    });
    return { ok: true, summary: text.join('\n') };
  },
};
