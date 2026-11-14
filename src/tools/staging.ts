import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from './types.js';

/**
 * One staging card per shot, decided BEFORE the shot is coded. On `prof` (2026-11-12) the shot list only held a size
 * and a few words of the voice, DIRECTOR.md was global, and 30 shots came out as idle / explain / point with no
 * object on screen: nobody had decided what each picture shows. The card is that decision; the audit then checks the
 * code against it and the Reviewer judges the picture against it.
 */
export const VALID_STAGE_VIEWS = ['front', 'reverse', 'left', 'right', '3/4-left', '3/4-right'] as const;
export type StageView = (typeof VALID_STAGE_VIEWS)[number];
export const VALID_STAGE_CAMS = ['establishing', 'wide', 'medium', 'close', 'deep', 'ots', 'pov'] as const;
export type StageCam = (typeof VALID_STAGE_CAMS)[number];
export const VALID_STAGE_FOREGROUNDS = ['auto', 'plant', 'doorframe', 'lamp', 'chair', 'curtain', 'none'] as const;
export type StageForeground = (typeof VALID_STAGE_FOREGROUNDS)[number];

export type StageCard = {
  see: string;
  /** the one thing the eye goes to: a person, an object, a hand on a desk */
  subject?: string;
  people: { who: string; where: string; does: string }[];
  objects: string[];
  angle?: 'level' | 'low' | 'high';
  view?: StageView;
  cam?: StageCam;
  zone?: string;
  foreground?: StageForeground;
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
    if (NARRATOR.test(String(p?.who ?? '').toUpperCase())) out.push(`${id}.people[${i}]: the narrator is a voice, not someone in the picture: remove "${p.who}" from people (a first-person narrator is on screen under their own character name)`);
    else if (!/^[A-Z][A-Z0-9_]*$/.test(String(p?.who ?? ''))) out.push(`${id}.people[${i}].who must be the cast constant used in shared.tsx (PROF, MAYA…), got "${p?.who ?? ''}"`);
    if (String(p?.where ?? '').trim().length < 3) out.push(`${id}.people[${i}].where is missing: where in the room (a piece id such as d2, or "left, near the board")`);
    if (vagueAction(String(p?.does ?? ''))) out.push(`${id}.people[${i}].does "${p.does}" says nothing to draw: say HOW (which hand, toward what, holding what, leaning on what)`);
    else if (String(p?.does ?? '').trim().length < 8) out.push(`${id}.people[${i}].does is too vague: a concrete action ("turns the bag upside down over the desk"), not "idle" or "talks"`);
  }
  if (String(card.subject ?? '').trim().length < 3) out.push(`${id}.subject is missing: the ONE thing the eye goes to in this picture (a face, a bag being emptied, a hand on a desk)`);
  if (!Array.isArray(card.objects) || card.objects.some((o: unknown) => typeof o !== 'string' || !o.trim())) out.push(`${id}.objects must be an array of names (empty when nothing is held or shown)`);
  if (card.angle !== undefined && !['level', 'low', 'high'].includes(card.angle)) out.push(`${id}.angle must be "level", "low" or "high" (the engine has no other camera angle)`);
  if (card.view !== undefined && !VALID_STAGE_VIEWS.includes(card.view)) out.push(`${id}.view must be one of ${VALID_STAGE_VIEWS.join(', ')}`);
  if (card.cam !== undefined && !VALID_STAGE_CAMS.includes(card.cam)) out.push(`${id}.cam must be one of ${VALID_STAGE_CAMS.join(', ')}`);
  if (card.foreground !== undefined && !VALID_STAGE_FOREGROUNDS.includes(card.foreground)) out.push(`${id}.foreground must be one of ${VALID_STAGE_FOREGROUNDS.join(', ')}`);
  if (card.zone !== undefined && (typeof card.zone !== 'string' || !card.zone.trim())) out.push(`${id}.zone must be a non-empty piece id or room zone ('window', 'door', 'sofa', 'left', 'right')`);
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

/** The shots that still have no card, as one line (empty when every shot has one). */
export function missingCards(shots: any[]): string[] {
  const missing = shots.filter((s) => !s?.stage).map((s) => String(s.id));
  return missing.length ? [`${missing.length}/${shots.length} shots have no staging card (${missing.slice(0, 12).join(', ')}): call stage_shots { episode, cards: [...] } BEFORE coding them`] : [];
}

/** Is this shot written? The scaffold's placeholder file does not count. */
export function shotCoded(episodeDir: string, id: string): boolean {
  try {
    const src = fs.readFileSync(path.join(episodeDir, 'shots', `${id}.tsx`), 'utf8');
    return !/PLACEHOLDER/.test(src) && new RegExp(`export const ${id}\\b`).test(src);
  } catch {
    return false;
  }
}

/** Cards as a whole: none missing, no two neighbours alike, nobody doing the same thing all along. */
export function stagingProblems(shots: any[]): string[] {
  const out: string[] = [];
  const missing = missingCards(shots);
  if (missing.length) return missing;
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

// Only a thing someone holds or handles has to be drawn by the shot. The first runs put the furniture and the set in
// `objects` (barreaux, escaliers, chaise, télé: 150 refusals in 8 projects, 2026-11-13); those belong to the place.
const HANDLED = /\b(phone|telephone|portable|smartphone|handset|combine|bag|sac|cartable|paper|papier|feuille|lettre|letter|note|copie|crumpled|cup|tasse|mug|verre|glass|keys?|cles?|book|livre|cahier|pen|stylo|crayon|pencil|craie|chalk|folder|dossier|box|boite|carton|wallet|portefeuille|manette|controller|remote|telecommande|camera|billet|ticket|badge|card|carte|bottle|bouteille|tray|plateau|plate|assiette|knife|couteau|ring|bague|gift|cadeau|photo)s?\b/;
/** The objects of a card that a person holds or handles (the rest is set dressing). */
export const handledObjects = (objects: unknown): string[] => (Array.isArray(objects) ? objects.filter((o): o is string => typeof o === 'string' && HANDLED.test(norm(o))) : []);
const NARRATOR = /^(NARR|NARRATOR|NARRATEUR|NARRATRICE|VOIX|VOICE|VOIX_OFF)$/;

/**
 * An angle, reverse view, or camera move decided on the card / shotlist and forgotten in the code is written into the shot
 * instead of refused: `shot({` becomes `shot({ angle: 'high',`. Only modular shots made of one shot() call; returns the ids changed.
 */
export function applyCardAngles(episodeDir: string, shots: any[]): string[] {
  const done: string[] = [];
  for (const s of Array.isArray(shots) ? shots : []) {
    const file = path.join(episodeDir, 'shots', `${String(s?.id ?? '')}.tsx`);
    let src = '';
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if ((src.match(/\bshot\(\{/g) ?? []).length !== 1) continue;
    const fields: string[] = [];
    const angle = s?.stage?.angle;
    if ((angle === 'low' || angle === 'high') && !/\bangle\s*:/.test(src)) {
      fields.push(`angle: '${angle}'`);
    }
    const wantView = s?.stage?.view ?? s?.view;
    if (wantView && wantView !== 'front' && VALID_STAGE_VIEWS.includes(wantView) && s?.stage?.view !== 'front' && !/\bview\s*:/.test(src)) {
      fields.push(`view: '${wantView}'`);
    }
    const wantCam = s?.stage?.cam;
    if (wantCam && VALID_STAGE_CAMS.includes(wantCam) && !/\bcam\s*:/.test(src)) {
      fields.push(`cam: '${wantCam}'`);
    }
    const wantZone = typeof s?.stage?.zone === 'string' ? s.stage.zone.trim() : '';
    if (wantZone && /^[a-z0-9_-]{2,24}$/i.test(wantZone) && !/\bzone\s*:/.test(src)) {
      fields.push(`zone: '${wantZone}'`);
    }
    const wantFg = s?.stage?.foreground;
    if (wantFg && wantFg !== 'none' && VALID_STAGE_FOREGROUNDS.includes(wantFg) && !/\bforeground\s*:/.test(src)) {
      fields.push(`foreground: '${wantFg}'`);
    }
    const wantMove = s?.move;
    if ((wantMove === 'pull' || wantMove === 'pan' || wantMove === 'still' || wantMove === 'track' || wantMove === 'whip') && !/\bmove\s*:/.test(src)) {
      fields.push(`move: '${wantMove}'`);
    }
    if (!fields.length) continue;
    fs.writeFileSync(file, src.replace(/\bshot\(\{/, `shot({ ${fields.join(', ')},`));
    done.push(String(s.id));
  }
  return done;
}

const DRAWS_OBJECT = /\bhold\s*:|\bprops\s*:|hand[LR]Prop|\bextra\s*:|\bbehind\s*:|tabletopShot\s*\(|phoneShot\s*\(|\breach\s*:/;
const WALK_ACT = /\bact\s*[:=]\s*\{?\s*['"](walk|run|sneak)['"]/;
const REAL_MOVE = /\bwalkTo\s*:|\bat\s*[:=]\s*\{?\s*\(|walkPose\s*\(|\bkf\s*\(/;

/** Does the code of each shot do what its card says? Also catches a walk that goes nowhere. */
export function stagingCodeProblems(shots: any[], bodies: Record<string, string>, withCards: boolean, aspect: string = '16:9'): string[] {
  const out: string[] = [];
  // 9:16: two people side by side at the same depth leave the lower third empty (2 shots in 106 used depth, 2026-11-13)
  if (aspect === '9:16') {
    const two: string[] = [];
    const flat: string[] = [];
    for (const s of shots) {
      const body = bodies[String(s.id)] ?? '';
      if ((body.match(/\bwho\s*:/g) ?? []).length < 2 || !/\bshot\(\{/.test(body)) continue;
      two.push(String(s.id));
      const ws = [...body.matchAll(/\bw\s*:\s*(\d*\.?\d+)/g)].map((m) => Number(m[1]));
      const spread = ws.length >= 2 ? Math.max(...ws) - Math.min(...ws) : 0;
      if (!/cam\s*:\s*['"](deep|ots)['"]/.test(body) && spread < 0.25) flat.push(String(s.id));
    }
    if (two.length >= 4 && two.length - flat.length < Math.ceil(two.length / 3)) {
      out.push(`${two.length - flat.length}/${two.length} shots with two people or more use depth (need ${Math.ceil(two.length / 3)}): in 9:16 people side by side leave the lower third empty. On some of ${flat.slice(0, 8).join(', ')} use cam: 'deep' with one person near (w 0.85-0.95) and the other behind, about 0.2 in u apart`);
    }
  }
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
    const handled = handledObjects(card.objects);
    if (handled.length && !DRAWS_OBJECT.test(body)) {
      out.push(`${id}: the card shows ${handled.join(', ')} but the code draws no object: use hold: '<object>' on the person (or hold: { node: <g>…</g> } for your own drawing), props: [{ on: '<piece>', node: held('<object>') }], or tabletopShot / phoneShot`);
    }
    if ((card.angle === 'low' || card.angle === 'high') && !/\b(tabletopShot|phoneShot)\s*\(/.test(body) && !new RegExp(`angle\\s*:\\s*['"]${card.angle}['"]`).test(body)) {
      out.push(`${id}: the card asks for a ${card.angle} angle but the code has no angle: '${card.angle}'`);
    }
    if (card.view && card.view !== 'front' && !/\b(tabletopShot|phoneShot)\s*\(/.test(body)) {
      const escaped = card.view.replace('/', '\\/');
      if (!new RegExp(`\\bview\\s*:\\s*['"]${escaped}['"]`).test(body)) {
        out.push(
          card.view === 'reverse'
            ? `${id}: the card asks for a reverse angle (contrechamp) but the code has no view: 'reverse'`
            : `${id}: the card asks for view '${card.view}' but the code has no view: '${card.view}'`,
        );
      }
    }
    const acts = [...body.matchAll(/\bact\s*[:=]\s*\{?\s*['"]([\w-]+)['"]/g)].map((m) => m[1]);
    const inert = /\bshot\(\{/.test(body) && (card.people ?? []).length > 0 && acts.every((a) => a === 'idle') && !/\bact\s*:\s*(\{|[A-Z_]+\b)|\bhold\s*:|\breach\s*:|\bwalkTo\s*:|\bpose\s*:|\bduo\s*:/.test(body);
    if (inert) {
      const p0 = card.people[0]!;
      out.push(`${id}: the card says ${p0.who} "${p0.does}" but nobody does anything (idle): choose the action that shows it — lean, rummage, slam, give, read, point, shrug, facepalm, shout, push, pick-up, phone, type… — or make it: act: { dur: 16, armR: { a: [[0, 14], [1, 90]], b: 10 } }`);
    }
    if (card.moves && !REAL_MOVE.test(body)) out.push(`${id}: the card says someone moves across the room but nobody has walkTo: { u, w }`);
  }

  // Episode-wide anti-monotony checks (active on full staged episodes >= 8 shots):
  // 1) Never repeat the exact same POV (place + cam + view + angle + zone) 3 character shots in a row
  // 2) Require champ / contrechamp or alternate room perspective when >= 6 shots sit in one room with multi-person dialogue
  // 3) Cap any single camera move (`push`, `still`, etc.) at <= 70% of character shots when moves are declared
  if (withCards && shots.length >= 8) {
    type PovEntry = { id: string; isShot: boolean; place: string; cam: string; view: string; angle: string; zone: string; explicitMove: string; resolvedMove: string; whoCount: number; hasAltPerspective: boolean };
    const povs: PovEntry[] = shots.map((s) => {
      const id = String(s.id);
      const body = bodies[id] ?? '';
      const isShot = /\bshot\(\{/.test(body) && !/\b(phoneShot|tabletopShot)\s*\(/.test(body);
      const place = /\bplace\s*:\s*([A-Za-z0-9_]+)/.exec(body)?.[1] ?? '';
      const cam = /\bcam\s*:\s*['"]([\w-]+)['"]/.exec(body)?.[1] ?? (/\bcam\s*:\s*\{/.test(body) ? 'custom' : 'wide');
      const view = /\bview\s*:\s*['"](front|reverse|left|right|3\/4-left|3\/4-right)['"]/.exec(body)?.[1] ?? 'front';
      const angle = /\bangle\s*:\s*['"](low|high|level)['"]/.exec(body)?.[1] ?? 'level';
      const zone = /\bzone\s*:\s*['"]([\w-]+)['"]/.exec(body)?.[1] ?? '';
      const explicitMove = /\bmove\s*:\s*['"]([\w-]+)['"]/.exec(body)?.[1] ?? '';
      const resolvedMove = explicitMove || String(s?.move ?? 'push');
      const whoCount = (body.match(/\bwho\s*:/g) ?? []).length;
      const hasAltPerspective =
        /\bview\s*:\s*['"](reverse|left|right|3\/4-left|3\/4-right)['"]/.test(body) ||
        cam === 'ots' ||
        cam === 'pov';
      return { id, isShot, place, cam, view, angle, zone, explicitMove, resolvedMove, whoCount, hasAltPerspective };
    });

    let triadWarnings = 0;
    for (let i = 2; i < povs.length && triadWarnings < 2; i++) {
      const a = povs[i - 2]!;
      const b = povs[i - 1]!;
      const c = povs[i]!;
      if (
        a.isShot &&
        b.isShot &&
        c.isShot &&
        a.place &&
        a.cam !== 'custom' &&
        a.place === b.place &&
        b.place === c.place &&
        a.cam === b.cam &&
        b.cam === c.cam &&
        a.view === b.view &&
        b.view === c.view &&
        a.angle === b.angle &&
        b.angle === c.angle &&
        a.zone === b.zone &&
        b.zone === c.zone
      ) {
        out.push(
          `${a.id}, ${b.id}, ${c.id} repeat the exact same POV (${a.place}, cam '${a.cam}', view '${a.view}', angle '${a.angle}') three times in a row: break monotony with view: 'reverse' | '3/4-left' | '3/4-right', cam: 'ots' | 'close' | 'wide', zone, a low/high angle, or a phoneShot/tabletopShot/secondary place`,
        );
        triadWarnings++;
        i += 2;
      }
    }

    const byPlace = new Map<string, PovEntry[]>();
    for (const p of povs) {
      if (!p.isShot || !p.place) continue;
      byPlace.set(p.place, [...(byPlace.get(p.place) ?? []), p]);
    }
    const anyAlt = povs.some((p) => p.hasAltPerspective);
    if (!anyAlt) {
      for (const [plName, list] of byPlace) {
        const twoPlus = list.filter((p) => p.whoCount >= 2);
        if (list.length >= 6 && twoPlus.length >= 3) {
          const sample = list.slice(1, 7).map((p) => p.id).join(', ');
          out.push(
            `0/${list.length} shots in ${plName} use view: 'reverse' (contrechamp) or alternate perspectives ('3/4-left', 'left', cam: 'ots'): in a multi-person scene, add view: 'reverse' or cam: 'ots' on at least 2 reaction/counter-shots (e.g. among ${sample}) so the camera does not stare at the same wall all episode`,
          );
          break;
        }
      }
    }

    const shotEntries = povs.filter((p) => p.isShot);
    const hasMoveSignals = shotEntries.filter((p) => p.explicitMove !== '').length >= 6 || shots.some((s) => Boolean(s?.move));
    if (hasMoveSignals && shotEntries.length >= 8) {
      const moveCounts = new Map<string, number>();
      for (const p of shotEntries) moveCounts.set(p.resolvedMove, (moveCounts.get(p.resolvedMove) ?? 0) + 1);
      const topMove = [...moveCounts.entries()].sort((x, y) => y[1] - x[1])[0];
      if (topMove && topMove[1] > Math.ceil(shotEntries.length * 0.7)) {
        out.push(
          `move: '${topMove[0]}' is used in ${topMove[1]}/${shotEntries.length} character shots (> 70%): vary camera motion across 'push', 'pull', 'pan', 'track', 'whip', and 'still'`,
        );
      }
    }
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
      const vw = c.view ?? s.view;
      const rev = vw && vw !== 'front' ? `view: ${vw}` : '';
      const extra = [c.objects?.length ? `objects: ${c.objects.join(', ')}` : '', c.cam ? `cam: ${c.cam}` : '', c.zone ? `zone: ${c.zone}` : '', c.foreground && c.foreground !== 'none' ? `foreground: ${c.foreground}` : '', c.angle && c.angle !== 'level' ? `angle: ${c.angle}` : '', rev, c.moves ? 'someone crosses the room' : ''].filter(Boolean).join(' · ');
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
            objects: { type: 'array', items: { type: 'string' }, description: 'ONLY what a person holds or handles in this shot (phone, bag, letter). Furniture and set (chair, stairs, TV) go in `see`, not here' },
            angle: { type: 'string', enum: ['level', 'low', 'high'] },
            view: { type: 'string', enum: [...VALID_STAGE_VIEWS], description: "room perspective: 'front', 'reverse' (contrechamp), '3/4-left', '3/4-right', 'left', or 'right'" },
            cam: { type: 'string', enum: [...VALID_STAGE_CAMS], description: "optional shot framing override such as 'ots' (over-the-shoulder), 'pov' (first-person), or 'deep'" },
            zone: { type: 'string', description: "optional piece id or room sub-zone ('window', 'door', 'sofa', 'counter', 'left', 'right') to anchor framing" },
            foreground: { type: 'string', enum: [...VALID_STAGE_FOREGROUNDS], description: "optional blurred foreground silhouette with camera parallax ('auto', 'plant', 'doorframe', 'lamp', 'chair', 'curtain')" },
            moves: { type: 'boolean', description: 'true when someone walks across the room in this shot' },
            change: { type: 'string', description: 'what differs from the previous shot' },
          },
          required: ['id', 'see', 'subject', 'people', 'objects'],
        },
      },
      userAsked: { type: 'boolean', description: "true ONLY when the user's own message asks to change these shots after the board exists. Never to make a check pass." },
    },
    required: ['episode', 'cards'],
    additionalProperties: false,
  },
  async run(input: { episode: string; cards: any[]; userAsked?: boolean }, ctx) {
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
    // Once the board exists the card is the contract the code is checked against. The first real run with the check
    // (custom, 2026-11-13) rewrote 138 cards on 32 coded shots to make it pass, and fixed the code 10 times: a bottle
    // thrown at a wall ended as a card with nobody and nothing in it. So a coded shot keeps its card, unless the
    // Reviewer refused that shot (and then the card may not lose people or handled objects) or the user asked.
    const epDir = path.dirname(file);
    const boarded = fs.existsSync(path.join(ctx.projectRoot, 'out', slug, 'storyboard.jpg'));
    const refused = new Set<string>();
    try {
      const review = JSON.parse(fs.readFileSync(path.join(ctx.projectRoot, 'out', slug, 'review.json'), 'utf8'));
      if (review && !review.pass) for (const i of review.issues ?? []) if (i?.severity === 'error') for (const id of String(i.shot ?? '').toUpperCase().match(/\bS\d+\b/g) ?? []) refused.add(id);
    } catch {
      /* no review yet */
    }
    const frozen: string[] = [];
    const weakened: string[] = [];
    for (const c of Array.isArray(input.cards) ? input.cards : []) {
      const shot = byId.get(String(c?.id ?? '').toUpperCase());
      if (!shot) {
        unknown.push(String(c?.id ?? '?'));
        continue;
      }
      const { id: _id, ...card } = c;
      const sid = String(shot.id);
      if (boarded && shot.stage && !input.userAsked && JSON.stringify(shot.stage) !== JSON.stringify(card) && shotCoded(epDir, sid)) {
        if (!refused.has(sid.toUpperCase())) {
          frozen.push(sid);
          continue;
        }
        const fewer = (Array.isArray(card.people) ? card.people.length : 0) < (shot.stage.people ?? []).length || handledObjects(card.objects).length < handledObjects(shot.stage.objects).length;
        if (fewer) {
          weakened.push(sid);
          continue;
        }
      }
      shot.stage = card;
      written++;
    }
    for (const s of shots) if (!Object.prototype.hasOwnProperty.call(s, 'stage')) s.stage = null;
    fs.writeFileSync(file, `${JSON.stringify(ep, null, 2)}\n`);
    const left = shots.filter((s) => !s.stage).map((s) => String(s.id));
    // a batch is not a failure: the first run of gpt-6.1-terra read "ERROR" seven times while it was only half-way (2026-11-12)
    const problems = left.length ? shots.flatMap((s, i) => (s.stage ? stageCardProblems(s.stage, { id: String(s.id), size: s.size, note: s.note }, i === 0) : [])) : stagingProblems(shots);
    const head = `${written} card(s) saved${unknown.length ? `; unknown shot ids ignored: ${unknown.join(', ')}` : ''}.`;
    if (frozen.length || weakened.length) {
      const lines = [
        frozen.length ? `${frozen.join(', ')}: NOT changed. These shots are coded and on the board: the card is what the code must show. When a check says the code does not match the card, fix the CODE with edit_shot, not the card.` : '',
        weakened.length ? `${weakened.join(', ')}: NOT changed. The Reviewer refused these shots, so their card may be rewritten, but it may not lose a person or a handled object: put what is missing into the code with edit_shot.` : '',
      ].filter(Boolean);
      return { ok: false, summary: `${head}\n- ${lines.join('\n- ')}` };
    }
    if (problems.length) return { ok: false, summary: `${head}\nTo fix before coding:\n- ${problems.slice(0, 20).join('\n- ')}` };
    if (left.length) return { ok: true, summary: `${head} ${left.length}/${shots.length} shots still need a card: ${left.join(', ')}. Send them before coding.` };
    return { ok: true, summary: `${head} All ${shots.length} shots are staged. Now code each shot so it matches its card (people, objects, angle, walkTo).` };
  },
};
