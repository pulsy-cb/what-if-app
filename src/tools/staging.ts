import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from './types.js';

/**
 * One staging card per shot, decided BEFORE the shot is coded. On `prof` (2026-11-12) the shot list only held a size
 * and a few words of the voice, DIRECTOR.md was global, and 30 shots came out as idle / explain / point with no
 * object on screen: nobody had decided what each picture shows. The card is that decision; the audit then checks the
 * code against it and the Reviewer judges the picture against it.
 */
export type StageCard = {
  see: string;
  /** the one thing the eye goes to: a person, an object, a hand on a desk */
  subject?: string;
  people: { who: string; where: string; does: string }[];
  objects: string[];
  angle?: 'level' | 'low' | 'high';
  moves?: boolean;
  change?: string;
};

const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// A verb that says nobody decided anything: "réagit", "regarde", "change d'expression". Alone or nearly, it is refused.
const VAGUE = /^(reagit|reagissent|regarde|ecoute|attend|reste|parle|discute|observe|change d expression|se tient|est la|est debout|est assise?|reacts?|looks?|listens?|stands?|waits?|talks?|watches|is there|idle)\b/;
export const vagueAction = (does: string): boolean => {
  const n = norm(does);
  return VAGUE.test(n) && n.split(' ').length <= 4;
};

/** A new-format episode: shotlist.py writes a `stage` key (null until filled) on every shot. */
export const usesStaging = (shots: any[]): boolean => Array.isArray(shots) && shots.some((s) => s && Object.prototype.hasOwnProperty.call(s, 'stage'));

/** What is wrong with one card; empty when it is usable. */
export function stageCardProblems(card: any, shot: { id: string; size?: string; note?: string }, first: boolean): string[] {
  const out: string[] = [];
  const id = shot.id;
  if (!card || typeof card !== 'object') return [`${id}: no staging card`];
  const see = String(card.see ?? '').trim();
  if (see.length < 50) out.push(`${id}.see is too short (${see.length} chars, 50 at least): one full sentence on what the viewer SEES (who, doing what, with what, where in the frame)`);
  else if (shot.note && norm(see) === norm(shot.note)) out.push(`${id}.see repeats the voice line: describe the picture, not what is said`);
  const people = Array.isArray(card.people) ? card.people : null;
  if (!people) out.push(`${id}.people must be an array (empty for an insert or an empty room)`);
  for (const [i, p] of (people ?? []).entries()) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(p?.who ?? ''))) out.push(`${id}.people[${i}].who must be the cast constant used in shared.tsx (PROF, MAYA…), got "${p?.who ?? ''}"`);
    if (String(p?.where ?? '').trim().length < 3) out.push(`${id}.people[${i}].where is missing: where in the room (a piece id such as d2, or "left, near the board")`);
    if (vagueAction(String(p?.does ?? ''))) out.push(`${id}.people[${i}].does "${p.does}" says nothing to draw: say HOW (which hand, toward what, holding what, leaning on what)`);
    else if (String(p?.does ?? '').trim().length < 8) out.push(`${id}.people[${i}].does is too vague: a concrete action ("turns the bag upside down over the desk"), not "idle" or "talks"`);
  }
  if (String(card.subject ?? '').trim().length < 3) out.push(`${id}.subject is missing: the ONE thing the eye goes to in this picture (a face, a bag being emptied, a hand on a desk)`);
  if (!Array.isArray(card.objects) || card.objects.some((o: unknown) => typeof o !== 'string' || !o.trim())) out.push(`${id}.objects must be an array of names (empty when nothing is held or shown)`);
  if (card.angle !== undefined && !['level', 'low', 'high'].includes(card.angle)) out.push(`${id}.angle must be "level", "low" or "high" (the engine has no other camera angle)`);
  if (card.moves !== undefined && typeof card.moves !== 'boolean') out.push(`${id}.moves must be true or false`);
  const size = String(shot.size ?? '').toLowerCase();
  const empty = !(people ?? []).length;
  if (empty && !/insert|establish|detail|macro/.test(size) && !(Array.isArray(card.objects) && card.objects.length)) {
    out.push(`${id} has no person and no object on a "${size || 'medium'}" shot: say who is there, or what object fills the frame`);
  }
  if (!first && String(card.change ?? '').trim().length < 10) out.push(`${id}.change is missing: what differs from the previous shot (who moved, new framing, new object)`);
  return out;
}

const signature = (c: StageCard): string => (c.people ?? []).map((p) => `${p.who}:${norm(p.does)}`).sort().join('|');

/** Cards as a whole: none missing, no two neighbours alike, nobody doing the same thing all along. */
export function stagingProblems(shots: any[]): string[] {
  const out: string[] = [];
  const missing = shots.filter((s) => !s?.stage).map((s) => String(s.id));
  if (missing.length) {
    out.push(`${missing.length}/${shots.length} shots have no staging card (${missing.slice(0, 12).join(', ')}): call stage_shots { episode, cards: [...] } BEFORE coding them`);
    return out;
  }
  shots.forEach((s, i) => out.push(...stageCardProblems(s.stage, { id: String(s.id), size: s.size, note: s.note }, i === 0)));
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1].stage as StageCard;
    const b = shots[i].stage as StageCard;
    const sameSee = norm(a.see) === norm(b.see);
    const samePeople = signature(a) !== '' && signature(a) === signature(b) && String(shots[i - 1].size) === String(shots[i].size);
    if (sameSee || samePeople) out.push(`${shots[i - 1].id} and ${shots[i].id} have the same card: two neighbouring shots must differ in action or in framing`);
  }
  const perWho = new Map<string, Map<string, string[]>>();
  for (const s of shots) {
    for (const p of (s.stage as StageCard).people ?? []) {
      const m = perWho.get(p.who) ?? new Map<string, string[]>();
      m.set(norm(p.does), [...(m.get(norm(p.does)) ?? []), String(s.id)]);
      perWho.set(p.who, m);
    }
  }
  for (const [who, m] of perWho) {
    const total = [...m.values()].reduce((n, v) => n + v.length, 0);
    for (const [does, ids] of m) {
      if (ids.length >= 4 && ids.length > total / 3) out.push(`${who} "${does}" in ${ids.length}/${total} shots (${ids.slice(0, 6).join(', ')}): vary what this person does`);
    }
  }
  return out;
}

const DRAWS_OBJECT = /\bhold\s*:|\bprops\s*:|hand[LR]Prop|\bextra\s*:|\bbehind\s*:|tabletopShot\s*\(|phoneShot\s*\(|\breach\s*:/;
const WALK_ACT = /\bact\s*[:=]\s*\{?\s*['"](walk|run|sneak)['"]/;
const REAL_MOVE = /\bwalkTo\s*:|\bat\s*[:=]\s*\{?\s*\(|walkPose\s*\(|\bkf\s*\(/;

/** Does the code of each shot do what its card says? Also catches a walk that goes nowhere. */
export function stagingCodeProblems(shots: any[], bodies: Record<string, string>, withCards: boolean): string[] {
  const out: string[] = [];
  for (const s of shots) {
    const id = String(s.id);
    const body = bodies[id] ?? '';
    if (!body) continue;
    if (WALK_ACT.test(body) && !REAL_MOVE.test(body)) {
      out.push(`${id} has act: 'walk' with a fixed place: the person steps on the spot. Give the destination: { who, at: { u, w }, walkTo: { u, w } } (shot() sets the walk and the direction)`);
    }
    const card = withCards ? (s.stage as StageCard | null) : null;
    if (!card) continue;
    for (const p of card.people ?? []) {
      if (!new RegExp(`\\b${p.who}\\b`).test(body)) out.push(`${id}: the card puts ${p.who} in the shot ("${p.does}") but the code never uses ${p.who}`);
    }
    if ((card.objects ?? []).length && !DRAWS_OBJECT.test(body)) {
      out.push(`${id}: the card shows ${card.objects.join(', ')} but the code draws no object: use hold: '<object>' on the person, props: [{ on: '<piece>', node: held('<object>') }], or tabletopShot / phoneShot`);
    }
    if ((card.angle === 'low' || card.angle === 'high') && !new RegExp(`angle\\s*:\\s*['"]${card.angle}['"]`).test(body)) {
      out.push(`${id}: the card asks for a ${card.angle} angle but the code has no angle: '${card.angle}'`);
    }
    if (card.moves && !REAL_MOVE.test(body)) out.push(`${id}: the card says someone moves across the room but nobody has walkTo: { u, w }`);
  }
  return out;
}

/** The cards as the Reviewer reads them: one block per shot. */
export function formatStageCards(shots: any[], ids?: string[]): string {
  return shots
    .filter((s) => s?.stage && (!ids || ids.includes(String(s.id))))
    .map((s) => {
      const c = s.stage as StageCard;
      const who = (c.people ?? []).map((p) => `${p.who} (${p.where}): ${p.does}`).join(' ; ') || 'nobody';
      const extra = [c.objects?.length ? `objects: ${c.objects.join(', ')}` : '', c.angle && c.angle !== 'level' ? `angle: ${c.angle}` : '', c.moves ? 'someone crosses the room' : ''].filter(Boolean).join(' · ');
      return `${s.id} [${s.size ?? ''}] ${c.see}${c.subject ? ` — sujet : ${c.subject}` : ''}\n   ${who}${extra ? `\n   ${extra}` : ''}`;
    })
    .join('\n');
}

export const stageShots: Tool = {
  name: 'stage_shots',
  description:
    'Write the staging card of each shot BEFORE coding it: what the viewer sees, who is where doing what, which objects, the angle, what changes from the previous shot. Saves into episode.json and answers what is missing or repeated. Call it with all the shots (or in batches of ~10), then code each shot to match its card.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'shot id, e.g. S14' },
            see: { type: 'string', description: 'one sentence: the picture, not the voice line' },
            subject: { type: 'string', description: 'the one thing the eye goes to' },
            people: {
              type: 'array',
              items: {
                type: 'object',
                properties: { who: { type: 'string', description: 'cast constant: PROF, MAYA…' }, where: { type: 'string' }, does: { type: 'string' } },
                required: ['who', 'where', 'does'],
              },
            },
            objects: { type: 'array', items: { type: 'string' } },
            angle: { type: 'string', enum: ['level', 'low', 'high'] },
            moves: { type: 'boolean', description: 'true when someone walks across the room in this shot' },
            change: { type: 'string', description: 'what differs from the previous shot' },
          },
          required: ['id', 'see', 'subject', 'people', 'objects'],
        },
      },
    },
    required: ['episode', 'cards'],
    additionalProperties: false,
  },
  async run(input: { episode: string; cards: any[] }, ctx) {
    const slug = String(input.episode ?? '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new Error('episode must be a slug such as "my-episode"');
    const file = path.join(ctx.projectRoot, 'src', 'episodes', slug, 'episode.json');
    if (!fs.existsSync(file)) throw new Error(`src/episodes/${slug}/episode.json does not exist: run the shotlist step first`);
    const ep = JSON.parse(fs.readFileSync(file, 'utf8'));
    const shots: any[] = Array.isArray(ep.shots) ? ep.shots : [];
    if (!shots.length) throw new Error('episode.json has no shots: run the shotlist step first');
    const byId = new Map(shots.map((s) => [String(s.id).toUpperCase(), s]));
    const unknown: string[] = [];
    let written = 0;
    for (const c of Array.isArray(input.cards) ? input.cards : []) {
      const shot = byId.get(String(c?.id ?? '').toUpperCase());
      if (!shot) {
        unknown.push(String(c?.id ?? '?'));
        continue;
      }
      const { id: _id, ...card } = c;
      shot.stage = card;
      written++;
    }
    for (const s of shots) if (!Object.prototype.hasOwnProperty.call(s, 'stage')) s.stage = null;
    fs.writeFileSync(file, `${JSON.stringify(ep, null, 2)}\n`);
    const left = shots.filter((s) => !s.stage).map((s) => String(s.id));
    // a batch is not a failure: the first run of gpt-6.1-terra read "ERROR" seven times while it was only half-way (2026-11-12)
    const problems = left.length ? shots.flatMap((s, i) => (s.stage ? stageCardProblems(s.stage, { id: String(s.id), size: s.size, note: s.note }, i === 0) : [])) : stagingProblems(shots);
    const head = `${written} card(s) saved${unknown.length ? `; unknown shot ids ignored: ${unknown.join(', ')}` : ''}.`;
    if (problems.length) return { ok: false, summary: `${head}\nTo fix before coding:\n- ${problems.slice(0, 20).join('\n- ')}` };
    if (left.length) return { ok: true, summary: `${head} ${left.length}/${shots.length} shots still need a card: ${left.join(', ')}. Send them before coding.` };
    return { ok: true, summary: `${head} All ${shots.length} shots are staged. Now code each shot so it matches its card (people, objects, angle, walkTo).` };
  },
};
