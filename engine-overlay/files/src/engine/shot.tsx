import React from 'react';
import { STUDIO } from '../studio.config';
import { Stage, Staged, StageItem, Duo } from './stage';
import type { StageBeat } from './stage';
import type { DuoAction, Place } from './stage';
import type { Placed } from './rooms';
import { mirrorSpot, mirrorYaw } from './rooms';
import type { PersonLook } from './person';
import { bodyOf } from './person';
import type { ActName, OwnActionSpec, Stance } from './actions';
import { actionName, ownStance, stanceOfAction } from './actions';
export { defineAction } from './actions';
import { faceAt } from './rig';
import type { Expr } from './rig';
import { HeadVfx, HookTitle, ShockBurst, StampCard, ValueTag } from './accents';
import { held, heldBottom, HELD_LEVEL } from './objects';
import type { Carry } from './stage';
import { animalHead, worn, wornOnTorso } from './worn';
import type { AnimalSpec, WornSpec } from './worn';
export { worn, animalHead, WORN_NAMES, ANIMAL_KINDS } from './worn';
import type { HeldName, HeldOpts } from './objects';
export { held, HELD_NAMES } from './objects';
export type { Carry } from './stage';
import type { BurstSpec, HookTitleSpec, PersonVfxSpec, StampSpec, ValueTagSpec } from './accents';

// A shot described instead of drawn. `shot({ ... })` gives the component a timeline expects: the place, who is there,
// what they do, how it is framed. The camera follows from the person it is on, in 16:9 and in 9:16. Every field has a
// way out: a literal camera, a literal position, `extra` for your own SVG, or a hand-written shot beside this one.

type ShotProps = { t: number; len: number; f?: number };
/** 'deep': two depths in one frame, the nearest person large in the lower half and the others small behind */
export type CamSize = 'establishing' | 'wide' | 'medium' | 'close' | 'deep';
export type CamSpec = CamSize | { x: number; y: number; zoom: number };

type Timed<T> = T | ((t: number, len: number) => T);
export type FaceExpr = Expr | 'sad' | 'angry' | 'scared' | 'surprised' | 'smile' | 'calm';
/** one expression, or [frame, expression] pairs: [[0, 'neutral'], [20, 'shock']] */
export type FaceSpecT = FaceExpr | [number, FaceExpr][];
/** where a hand goes: another person (index in people), a piece by id, or a floor point with a height v (0 ceiling, 1 floor) */
export type ReachTarget = number | string | { u: number; w: number; v?: number };
/** part: where on a person the hand goes (default chest) */
export type ReachSpec = { to: ReachTarget; side?: 'L' | 'R'; part?: 'head' | 'chest' | 'hand' };
/** from frame `at`, this person does something else. Frames are the shot's own clock (0..len): use the word frames given for the shot. */
export type PersonBeat = { at: number; act?: ActName | OwnActionSpec; face?: FaceExpr; yaw?: number; look?: number; reach?: ReachSpec | null };
/** from frame `at`, the camera changes: another size, another person, or a shake (an impact) */
export type CamBeat = { at: number; cam?: CamSpec; on?: number; shake?: number; angle?: 'low' | 'high' | 'level' };
export type PersonSpec = {
  who: PersonLook;
  /** turn toward this person (index in people) */ look?: number;
  /** a hand goes to someone or something, from the start */ reach?: ReachSpec;
  /** what changes during the shot, at given frames */ beats?: PersonBeat[];
  /** on the floor; a function of (t, len) to move someone */ at?: Timed<Place>;
  /** walks from `at` to this floor point during the shot (from frame `from`, over `dur` frames; default the whole shot).
   * Sets act 'walk' and the direction by itself. Without it, act: 'walk' steps on the spot. */
  walkTo?: { u: number; w: number };
  /** a thing in the hand: 'phone' | 'handset' | 'bag' | 'paper' | 'crumpled' | 'cup' | 'keys' | 'book' | 'pen' | 'folder' | 'box' | 'tray' | 'plate' | 'bottle',
   * or { what, color, scale, side }. Sets act 'hold' when no act is given.
   * `level: true` keeps it level whatever the arm does (tray, plate and bottle are level by themselves).
   * `release` makes it leave the hand: { at: 52, to: 'table' } puts it on a piece, { at: 21, to: { u, w }, how: 'throw' }
   * throws it to a floor point (v: 0 floor … 1 head height), { at: 30, how: 'drop' } lets it fall at the feet. */
  hold?: HeldName | ({ what?: HeldName; /** your own drawing, carried by the hand, around (0, 10) in hand units */ node?: React.ReactNode; side?: 'L' | 'R'; level?: boolean; release?: ReleaseSpec } & HeldOpts);
  /** worn things: 'crown' | 'eye-mask' | 'face-mask' | 'sunglasses' | 'cat-ears' | 'headphones' | 'collar' | 'tie' | 'scarf' | 'medal'… or { what, color } */
  wear?: WornSpec[];
  /** an animal that stands and talks: ears, muzzle, whiskers, mane on this person's head. 'cat' | 'dog' | 'lion' | 'bear' | 'rabbit' | 'wolf' | 'fox' | 'pig' | 'mouse', or { kind, fur, inner } */
  animal?: AnimalSpec;
  /** or on a piece of furniture: seats the person there */ on?: string;
  seat?: number;
  yaw?: number;
  /** a name from the list, one made with defineAction('name', { … }), or the values themselves: { loop, dur, armR: { a, b }, tilt… } */
  act?: ActName | OwnActionSpec;
  from?: number;
  dur?: number;
  stance?: Stance;
  face?: FaceSpecT;
  /** any pose field; a function of (t, len) for keyframes. Overrides `act` */ pose?: Timed<Record<string, unknown>>;
  rimId?: string;
  /** head-attached 2D reaction micro-VFX (focus rings, shock rays, sweat drop, dizzy stars, sparkle, thought icon) */
  vfx?: PersonVfxSpec[];
  headGear?: React.ReactNode;
  torsoGear?: React.ReactNode;
  handLProp?: React.ReactNode;
  handRProp?: React.ReactNode;
};
type DuoPerson = { who: PersonLook; at: { u: number; w: number }; face?: FaceSpecT; pose?: Timed<Record<string, unknown>>; rimId?: string };
export type DuoSpec = { a: DuoPerson; b: DuoPerson; action: DuoAction; from?: number; dur?: number; prop?: React.ReactNode };
export type ShotSpec = {
  place: Placed;
  /** how close: establishing, wide, medium, close; or a literal camera */ cam?: CamSpec;
  /** which person the camera is on: index in `people`, default the first */ on?: number;
  /** slow move during the shot; default a gentle push-in */ move?: 'push' | 'pull' | 'still';
  /** depth kept sharp; the rest softens. Close-ups do it on their own (soft background), medium shots a little */ focus?: number;
  /** 'sharp' keeps the room sharp in a close-up (to read a board, a screen) */ background?: 'soft' | 'sharp';
  /** 'reverse': the reverse angle. The camera looks at the opposite wall, people keep their places and are seen from the
   * other side (a face becomes a back). Alternate it with the normal view in a dialogue: shot / reverse shot. */
  view?: 'front' | 'reverse';
  /** 'low': the camera looks up, the person looms and the ceiling shows; 'high': it looks down, the person shrinks over the floor */
  angle?: 'low' | 'high';
  /** camera changes during the shot: a punch-in on the key word, a switch to the other person, a shake */ beats?: CamBeat[];
  people?: PersonSpec[];
  duo?: DuoSpec;
  /** objects that sit ON a piece of the place (a cake on the table, a phone on the desk): drawn with their origin on the piece's top, y up is negative. A hand-placed translate() in `extra` floats when the camera or place changes. */
  props?: { on: string; node: React.ReactNode; dx?: number; dy?: number; scale?: number }[];
  /** your own SVG in the world BEHIND the people, on the room (a door that opens, a poster, a light): someone walking in passes in front of it */
  behind?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
  /** your own SVG in the world, in front of the room and sorted last */ extra?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
  /** screen-space diegetic time/place/chapter stamp (16:9 & 9:16 safe, never zoomed by the camera) */
  stamp?: StampSpec;
  /** screen-space animated number/price/verdict pill (16:9 & 9:16 safe) */
  tag?: ValueTagSpec;
  /** screen-space radial impact lines on a twist or reveal */
  burst?: BurstSpec;
  /** opening hook / premise title card in screen space */
  title?: HookTitleSpec;
  /** custom screen-space SVG overlay rendered above the camera (16:9 & 9:16 viewBox coordinates) */
  overlay?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
};

const PORTRAIT = STUDIO.height > STUDIO.width;
const FRAME = PORTRAIT ? { w: 900, h: 1600 } : { w: 1920, h: 1080 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease01 = (v: number) => { const k = clamp(v, 0, 1); return k * k * (3 - 2 * k); };
const BODY = 378;
/** how far to the side a hand goes from the middle of the body, at scale 1 (shoulder 42 + arm 120, less the bend) */
const ARM_REACH = 135;

/** The camera for a person: zoom from how much of them shows, off-centre so they look into the frame. */
export const frameOn = (size: CamSize, p: { x: number; y: number; scale: number }, yaw = 0): { x: number; y: number; zoom: number } => {
  // a tall frame at zoom 0.85 was one third ceiling and one third empty floor (prof, 2026-11-12): go in until the room fills the height
  if (size === 'establishing') return PORTRAIT ? { x: 900, y: 500, zoom: 1.4 } : { x: 900, y: 500, zoom: 0.85 };
  const s = p.scale;
  if (size === 'deep') size = 'medium';
  const fit: Record<Exclude<CamSize, 'establishing' | 'deep'>, { height: number; width: number; share: number; chest: number }> = {
    wide: { height: 378 * s, width: 620 * s, share: PORTRAIT ? 0.46 : 0.62, chest: 0.52 },
    // headroom: buns, afros and a push-in of 5 % took the crown to the edge (the-er, la-promesse, 2026-11-11)
    medium: { height: 250 * s, width: 400 * s, share: PORTRAIT ? 0.5 : 0.68, chest: 0.74 },
    close: { height: 190 * s, width: 280 * s, share: PORTRAIT ? 0.44 : 0.66, chest: 0.87 },
  };
  const c = fit[size];
  const zoom = clamp(Math.min((FRAME.h * c.share) / c.height, FRAME.w / c.width), 0.6, 4.5);
  const look = yaw > 0.15 ? 1 : yaw < -0.15 ? -1 : 0;
  const lookRoom = (FRAME.w / zoom) * (size === 'close' ? 0.1 : 0.14);
  return { x: p.x + look * lookRoom, y: p.y - 378 * s * c.chest + (PORTRAIT ? 40 / zoom : 0), zoom };
};

const camT = (cx: number, cy: number, z: number) => `translate(960 540) scale(${z}) translate(${-cx} ${-cy})`;

const legsOf = (p: { who: PersonLook }) => bodyOf((p.who as { cast?: { body?: never } }).cast?.body);

const Stool: React.FC<{ x: number; y: number; scale: number; height: number; color: { top: string; front: string }; metal: string }> = ({ x, y, scale: s, height, color, metal }) => {
  const top = y - height * s;
  return (
    <g>
      <path d={`M ${x - 30 * s} ${top} L ${x - 38 * s} ${y} M ${x + 30 * s} ${top} L ${x + 38 * s} ${y}`} stroke={metal} strokeWidth={7 * s} />
      <rect x={x - 46 * s} y={top - 6 * s} width={92 * s} height={16 * s} rx={5 * s} fill={color.front} />
      <rect x={x - 46 * s} y={top - 10 * s} width={92 * s} height={8 * s} rx={4 * s} fill={color.top} />
    </g>
  );
};

const EXPR_MAP: Record<string, Expr> = {
  sad: 'worried',
  angry: 'worried',
  scared: 'shock',
  surprised: 'shock',
  smile: 'happy',
  calm: 'neutral',
};
const normExpr = (e: FaceExpr): Expr => EXPR_MAP[e] ?? (e as Expr);
const timed = <T,>(v: Timed<T> | undefined, t: number, len: number): T | undefined => (typeof v === 'function' ? (v as (t: number, len: number) => T)(t, len) : v);
const poseOf = (p: { face?: FaceSpecT; pose?: Timed<Record<string, unknown>> }, t: number, len: number): Record<string, unknown> => {
  const keys: [number, Expr][] | undefined =
    p.face === undefined ? undefined : typeof p.face === 'string' ? [[0, normExpr(p.face)]] : p.face.map(([f, e]) => [f, normExpr(e)]);
  const face = keys ? faceAt(t, keys) : {};
  return { ...face, ...timed(p.pose, t, len) };
};

/** When and where a held thing leaves the hand. `to`: a piece id, a floor point (v: height, 0 floor … 1 head) or a person index. */
export type ReleaseSpec = { at: number; to?: string | { u: number; w: number; v?: number } | number; how?: 'put' | 'throw' | 'drop'; dur?: number; /** nudge where it rests */ dx?: number; dy?: number };

/** `hold` as written by many hands: a name, { what }, the same under kind / name / object / item, a drawing, or { node }. */
const holdOf = (h: unknown): ({ what?: string; node?: React.ReactNode; side?: 'L' | 'R'; level?: boolean; release?: ReleaseSpec } & HeldOpts) | undefined => {
  if (h === undefined || h === null || h === false) return undefined;
  if (typeof h === 'string') return { what: h };
  if (React.isValidElement(h)) return { node: h };
  const o = h as Record<string, unknown>;
  const what = o.what ?? o.kind ?? o.name ?? o.object ?? o.item ?? o.type;
  if (o.node !== undefined) return { ...(o as object), node: o.node as React.ReactNode };
  if (typeof what !== 'string') throw new Error(`hold needs the object's name: hold: 'phone', hold: { what: 'phone', color, side }, or your own drawing hold: { node: <g>…</g> }. Got ${JSON.stringify(Object.keys(o))}`);
  return { ...(o as object), what };
};

const sortBeats = <T extends { at: number },>(b: T[] | undefined): T[] => [...(b ?? [])].sort((x, y) => x.at - y.at);

/** Turn a description into a shot. */
export const shot = (spec: ShotSpec): React.FC<ShotProps> => {
  const pl0 = spec.place as unknown as { items?: unknown; ground?: unknown } | string | undefined;
  if (!pl0 || typeof pl0 === 'string' || typeof pl0.items !== 'function' || !pl0.ground) {
    throw new Error(`shot({ place }) needs what place('name') returns, got ${typeof pl0 === 'string' ? `the string "${pl0}"` : pl0 === undefined ? 'nothing (undefined: is the place defined above this shot, and exported from shared.tsx?)' : 'something else'}. Write const ROOM = place('classroom') once in shared.tsx and pass place: ROOM.`);
  }
  const ShotComp: React.FC<ShotProps> = ({ t, len }) => {
    const reverse = spec.view === 'reverse';
    const pl = reverse ? spec.place.reverse : spec.place;
    const flipYaw = (y: number | undefined) => (y === undefined || !reverse ? y : mirrorYaw(y));
    const flipAt = <T extends Place>(at: T): Place => (reverse && 'u' in at ? mirrorSpot(at as { u: number; w: number }) : at);
    const people = spec.people ?? [];
    // how far along a walkTo this person is, 0..1
    const walkK = (p: PersonSpec, at: number = t): number => {
      const f0 = p.from ?? 0;
      return clamp((at - f0) / Math.max(1, p.dur ?? len - f0), 0, 1);
    };
    // A hand that reaches for a piece from too far stops in mid-air: half of the defects left by the reviewer were a
    // hand that touches nothing (8 projects, 2026-11-13). The person stands within arm's length of what they reach for.
    const stepIn = (p: PersonSpec, at: Place): Place | null => {
      if (p.walkTo || !('u' in at)) return null;
      const r = p.reach ?? sortBeats(p.beats).find((b) => b.reach)?.reach;
      if (!r || typeof r.to === 'number') return null;
      const here = flipAt(at) as { u: number; w: number };
      const g = pl.ground.project(here.u, here.w);
      const to = typeof r.to === 'string' ? pl.pointOf(r.to) : (() => { const s = flipAt({ u: r.to.u, w: r.to.w }) as { u: number; w: number }; return pl.ground.project(s.u, s.w); })();
      const dx = to.x - g.x;
      if (Math.abs(dx) <= ARM_REACH * g.scale) return null;
      return { x: to.x - Math.sign(dx) * ARM_REACH * 0.85 * g.scale, y: g.y, scale: g.scale, w: here.w } as Place;
    };
    const whereOf = (p: PersonSpec, idx = 0, when: number = t): Place => {
      if (p.on) return flipAt(pl.seat(p.on, p.seat ?? 0));
      const at = timed(p.at, when, len) ?? { u: people.length <= 1 ? 0.5 : 0.34 + idx * 0.28, w: 0.45 };
      const near = stepIn(p, at);
      if (near) return near;
      if (p.walkTo && 'u' in at) {
        const k = walkK(p, when);
        return flipAt({ u: at.u + (p.walkTo.u - at.u) * k, w: at.w + (p.walkTo.w - at.w) * k });
      }
      return flipAt(at);
    };
    const spotOfPerson = (i: number) => {
      const where = whereOf(people[i]!, i);
      return 'u' in where ? pl.ground.project(where.u, where.w) : { x: where.x, y: where.y, scale: where.scale ?? 1 };
    };
    // where a hand goes, in the world
    const targetOf = (r: ReachSpec | null | undefined): { to: { x: number; y: number }; side?: 'L' | 'R' } | null | undefined => {
      if (r === undefined || r === null) return r;
      const to = r.to;
      if (typeof to === 'number') {
        if (!people[to]) throw new Error(`reach.to ${to}: there is no person ${to} in this shot (people has ${people.length})`);
        const g = spotOfPerson(to);
        const h = r.part === 'head' ? 0.86 : r.part === 'hand' ? 0.45 : 0.62;
        return { to: { x: g.x, y: g.y - BODY * g.scale * h }, side: r.side };
      }
      if (typeof to === 'string') return { to: pl.pointOf(to), side: r.side };
      const spot = flipAt({ u: to.u, w: to.w }) as { u: number; w: number };
      const g = pl.ground.project(spot.u, spot.w);
      return { to: { x: g.x, y: g.y - BODY * g.scale * (1 - (to.v ?? 0.8)) * 0.9 }, side: r.side };
    };
    // turning toward someone keeps the strength of the turn and picks its side
    const yawToward = (i: number, j: number | undefined, yaw: number | undefined): number | undefined => {
      if (j === undefined || !people[j] || j === i) return yaw;
      const dx = spotOfPerson(j).x - spotOfPerson(i).x;
      return Math.sign(dx || 1) * Math.max(Math.abs(yaw ?? 0), 0.5);
    };
    const baseYaw = (p: PersonSpec): number | undefined => {
      if (p.yaw !== undefined) return p.yaw;
      if (p.walkTo && !p.on && walkK(p) < 1) {
        const a = timed(p.at, t, len);
        const du = p.walkTo.u - (a && 'u' in a ? a.u : 0.5);
        // across the room: a profile; toward or away from the camera: nearly front or back
        return Math.abs(du) > 0.04 ? Math.sign(du) * 0.85 : 0;
      }
      // reaching for a piece with no yaw given: face it
      const r = p.reach ?? sortBeats(p.beats).find((b) => b.reach)?.reach;
      if (!p.on && r && typeof r.to === 'string') {
        const a = timed(p.at, t, len);
        if (a && 'u' in a) { const here = flipAt(a) as { u: number; w: number }; return Math.sign(pl.pointOf(r.to).x - pl.ground.project(here.u, here.w).x || 1) * 0.85; }
      }
      return p.on ? pl.seatYaw?.(p.on) : undefined;
    };
    const yawAt = (i: number): number => {
      const p = people[i]!;
      let y = yawToward(i, p.look, flipYaw(baseYaw(p))) ?? 0;
      for (const b of sortBeats(p.beats)) if (b.at <= t && (b.yaw !== undefined || b.look !== undefined)) y = yawToward(i, b.look, flipYaw(b.yaw) ?? y) ?? y;
      return y;
    };
    const personFramePoint = (i: number) => {
      const subject = people[i]!;
      const g = spotOfPerson(i);
      const b = legsOf(subject);
      const sitting = subject.on !== undefined || subject.stance === 'sit';
      return { x: g.x, y: g.y + (sitting ? b.thigh * g.scale * 0.85 : 0), scale: g.scale * ((b.thigh + b.shin) / 140) };
    };
    const focusOn = (i: number) => {
      if (i === -2 && people.length >= 2) {
        const pts = people.slice(0, 3).map((_, k) => personFramePoint(k));
        const xs = pts.map((p) => p.x);
        return {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
          scale: pts.reduce((s, p) => s + p.scale, 0) / pts.length,
        };
      }
      if (people[i]) return personFramePoint(i);
      if (spec.duo) {
        const da = flipAt(spec.duo.a.at) as { u: number; w: number };
        const db = flipAt(spec.duo.b.at) as { u: number; w: number };
        const a = pl.ground.project(da.u, da.w);
        const b = pl.ground.project(db.u, db.w);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, scale: (a.scale + b.scale) / 2 };
      }
      return pl.ground.project(0.5, 0.45);
    };
    // two depths: from the top of the farthest head to the waist of the nearest person, who fills the lower half
    const deepCam = (): { x: number; y: number; zoom: number } | null => {
      if (people.length < 2) return null;
      const g = people.map((_, i) => spotOfPerson(i));
      const near = g.reduce((a, b) => (b.scale > a.scale ? b : a));
      const top = Math.min(...g.map((p) => p.y - 410 * p.scale));
      const bottom = near.y - BODY * near.scale * 0.34;
      // the others whole, the nearest person only to the middle of the body: an over-the-shoulder frame may cut them at the edge
      const half = (p: { scale: number }) => (p === near ? 40 : 120) * p.scale;
      const x0 = Math.min(...g.map((p) => p.x - half(p)));
      const x1 = Math.max(...g.map((p) => p.x + half(p)));
      // go in a little past the width: the nearest person is cut by the edge, as over a shoulder, and the frame fills
      const zoom = clamp(Math.min(FRAME.h / ((bottom - top) * 1.04), (FRAME.w / ((x1 - x0) * 1.04)) * 1.12), 0.6, 4.5);
      const halfW = FRAME.w / (2 * zoom);
      // the people behind stay whole in the frame
      const far = g.filter((p) => p !== near);
      const fx0 = Math.min(...far.map((p) => p.x - 95 * p.scale));
      const fx1 = Math.max(...far.map((p) => p.x + 95 * p.scale));
      const lo = fx1 - halfW;
      const hi = fx0 + halfW;
      const x = lo <= hi ? clamp((x0 + x1) / 2, lo, hi) : (fx0 + fx1) / 2;
      // spare height (the width still limits the zoom): most of it goes down the nearest body, none to a bare ceiling
      const spare = Math.max(0, FRAME.h / zoom - (bottom - top));
      return { x, y: (top + bottom) / 2 + spare * 0.2, zoom };
    };
    const cameraFor = (c: CamSpec, on: number) => {
      if (c === 'deep') { const d = deepCam(); if (d) return d; }
      const groupWide = c === 'wide' && on === 0 && spec.on === undefined && people.length >= 2;
      const sized = typeof c === 'string' ? frameOn(c, focusOn(groupWide ? -2 : on), !groupWide && people[on] ? yawAt(on) : 0) : c;
      // a tall frame must not reach below the room's near floor edge, where nothing is drawn
      return typeof c === 'string' && c !== 'establishing' ? { ...sized, y: Math.min(sized.y, pl.ground.project(0.5, 1).y - FRAME.h / (2 * sized.zoom)) } : sized;
    };
    // the camera's moments: the start, then each camera beat; a change is a quick 5-frame move
    let camNow = { cam: spec.cam ?? ('wide' as CamSpec), on: spec.duo ? -1 : spec.on ?? 0 };
    let camPrev: typeof camNow | null = null;
    let camAt = 0;
    let shake = 0;
    let angle: 'low' | 'high' | 'level' = spec.angle ?? 'level';
    for (const b of sortBeats(spec.beats)) {
      if (b.at > t) break;
      if (b.angle) angle = b.angle;
      if (b.cam !== undefined || b.on !== undefined) {
        camPrev = camNow;
        camNow = { cam: b.cam ?? camNow.cam, on: b.on ?? camNow.on };
        camAt = b.at;
      }
      if (b.shake) shake = b.shake * Math.max(0, 1 - (t - b.at) / 10);
    }
    const target = cameraFor(camNow.cam, camNow.on);
    const blend = camPrev ? ease01((t - camAt) / 5) : 1;
    const from = camPrev ? cameraFor(camPrev.cam, camPrev.on) : target;
    const base = { x: from.x + (target.x - from.x) * blend, y: from.y + (target.y - from.y) * blend, zoom: from.zoom + (target.zoom - from.zoom) * blend };
    const k = len > 0 ? clamp(t / len, 0, 1) : 0;
    const move = spec.move ?? 'push';
    const zoom = base.zoom * (move === 'push' ? 1 + 0.05 * k : move === 'pull' ? 1.05 - 0.05 * k : 1);
    // a close-up separates the face from the room: the room goes soft, people at another depth too
    const size = typeof camNow.cam === 'string' ? camNow.cam : null;
    const soft = spec.background !== 'sharp' && spec.focus === undefined && (size === 'close' || size === 'medium') && people[camNow.on];
    const focus = spec.focus ?? (soft ? ('u' in whereOf(people[camNow.on]!, camNow.on) ? (whereOf(people[camNow.on]!, camNow.on) as { w: number }).w : undefined) : undefined);
    const shellFilter = soft ? (size === 'close' ? 'url(#blur6)' : 'url(#blur3)') : undefined;
    // an angle in a flat drawing: stretch the world about the subject's feet and move the frame toward ceiling or floor
    const feet = people[camNow.on] ? spotOfPerson(camNow.on).y : base.y;
    const tall = angle === 'low' ? 1.08 : angle === 'high' ? 0.93 : 1;
    const lift = angle === 'low' ? -0.1 : angle === 'high' ? 0.1 : 0;
    const viewH = FRAME.h / zoom;
    const angleT = tall === 1 ? undefined : `translate(0 ${feet}) scale(1 ${tall}) translate(0 ${-feet})`;
    const behindNode = spec.behind ? (typeof spec.behind === 'function' ? spec.behind(t, len) : spec.behind) : null;
    const extraNode = spec.extra ? (typeof spec.extra === 'function' ? spec.extra(t, len) : spec.extra) : null;
    const pieceLike = (Array.isArray(extraNode) ? extraNode : [extraNode]).find((n) => n && typeof n === 'object' && !Array.isArray(n) && !('$$typeof' in (n as object)) && typeof (n as { p?: unknown }).p === 'string');
    if (pieceLike) {
      throw new Error(`extra takes SVG, but got a piece description {p: "${(pieceLike as { p: string }).p}", ...}. A piece of furniture or decor goes in the place: place('name', { add: [{ p: "${(pieceLike as { p: string }).p}", id: "...", at: { u, w } }] }), and shot({ place }) uses that. For an object that sits on a piece use shot({ props: [{ on: "<piece id>", node: <g>...</g> }] }).`);
    }
    const jolt = shake ? { x: Math.sin(t * 2.7) * shake, y: Math.cos(t * 3.1) * shake * 0.6 } : { x: 0, y: 0 };
    return (
      <g>
      <g transform={camT(base.x + jolt.x / zoom, base.y + lift * viewH + jolt.y / zoom, zoom)}>
      <g transform={angleT}>
        <Stage ground={pl.ground} t={t} focus={focus}>
          <g filter={shellFilter}>
            <pl.Shell t={t} />
          </g>
          {pl.items(t)}
          {behindNode ? <StageItem depth={0.001}>{behindNode}</StageItem> : null}
          {people.flatMap((p, pi) => {
            // seated on the floor plan with no piece under them: a stool, so nobody sits on thin air (the-er, 2026-11-11)
            if (!p.on && p.stance === 'sit') {
              const at = whereOf(p, pi);
              if (!('u' in at)) return [];
              const g = pl.ground.project((at as { u: number; w: number }).u, (at as { u: number; w: number }).w);
              const b = legsOf(p);
              return [<StageItem key={`sit-${pi}`} depth={(at as { w: number }).w - 0.001}><Stool x={g.x} y={g.y} scale={g.scale} height={b.shin + 0.2 * b.thigh} color={pl.tokens.wood} metal={pl.tokens.metal} /></StageItem>];
            }
            if (!p.on || !pl.wantsStool(p.on)) return [];
            const s = flipAt(pl.seat(p.on, p.seat ?? 0)) as { u: number; w: number };
            const g = pl.ground.project(s.u, s.w);
            const b = legsOf(p);
            return [<StageItem key={`stool-${p.on}-${p.seat ?? 0}`} depth={s.w - 0.001}><Stool x={g.x} y={g.y} scale={g.scale} height={b.shin + 0.2 * b.thigh} color={pl.tokens.wood} metal={pl.tokens.metal} /></StageItem>];
          })}
          {people.map((p, i) => {
            const { who, on, from, dur, stance, rimId, vfx } = p;
            // worn things and an animal's head join whatever the shot drew itself in headGear / torsoGear
            const yawNow = yawAt(i);
            const wornList = (p.wear ?? []).map((x) => (typeof x === 'string' ? { what: x } : x));
            const headWorn = wornList.filter((x) => !wornOnTorso(x.what));
            const torsoWorn = wornList.filter((x) => wornOnTorso(x.what));
            const headGear = p.headGear || p.animal || headWorn.length ? (
              <g>{p.animal ? animalHead(p.animal, yawNow) : null}{headWorn.map((x, k) => <g key={k}>{worn(x.what, { ...x, yaw: yawNow })}</g>)}{p.headGear}</g>
            ) : undefined;
            const torsoGear = p.torsoGear || torsoWorn.length ? <g>{torsoWorn.map((x, k) => <g key={k}>{worn(x.what, x)}</g>)}{p.torsoGear}</g> : undefined;
            const holdSpec = holdOf(p.hold);
            const heldNode = holdSpec ? (holdSpec.node ?? held(holdSpec.what as string, holdSpec)) : undefined;
            // a thing that stays level or leaves the hand is carried by Staged, which knows the arm at every frame
            const rel = holdSpec?.release;
            const level = holdSpec ? holdSpec.level ?? (holdSpec.what !== undefined && HELD_LEVEL.includes(holdSpec.what)) : false;
            let carry: Carry | undefined;
            if (holdSpec && (level || rel)) {
              carry = { node: heldNode, side: holdSpec.side, level, bottom: heldBottom(holdSpec.what) * (holdSpec.scale ?? 1) };
              if (rel) {
                if (typeof rel.at !== 'number') throw new Error(`hold.release needs the frame the thing leaves the hand: release: { at: 52, to: 'table' }. Got ${JSON.stringify(rel)}`);
                const w0 = whereOf(p, i, rel.at);
                const spot = 'u' in w0 ? pl.ground.project(w0.u, w0.w) : { x: w0.x, y: w0.y, scale: w0.scale ?? 1 };
                let to: { x: number; y: number };
                if (rel.to === undefined) to = { x: spot.x + (yawNow < 0 ? -1 : 1) * 46 * spot.scale, y: spot.y };
                else if (typeof rel.to === 'string') to = pl.pointOf(rel.to);
                else if (typeof rel.to === 'number') {
                  if (!people[rel.to]) throw new Error(`hold.release.to ${rel.to}: there is no person ${rel.to} in this shot (people has ${people.length})`);
                  const g = spotOfPerson(rel.to);
                  to = { x: g.x, y: g.y - BODY * g.scale * 0.45 };
                } else {
                  const s2 = flipAt({ u: rel.to.u, w: rel.to.w }) as { u: number; w: number };
                  const g = pl.ground.project(s2.u, s2.w);
                  to = { x: g.x, y: g.y - BODY * g.scale * (rel.to.v ?? 0) * 0.9 };
                }
                carry.release = { at: rel.at, how: rel.how ?? (rel.to === undefined ? 'drop' : 'put'), dur: rel.dur, to: { x: to.x + (rel.dx ?? 0), y: to.y + (rel.dy ?? 0) }, spot };
              }
            }
            const handLProp = p.handLProp ?? (!carry && holdSpec?.side === 'L' ? heldNode : undefined);
            const handRProp = p.handRProp ?? (!carry && holdSpec && holdSpec.side !== 'L' ? heldNode : undefined);
            const moving = !!p.walkTo && !on && walkK(p) < 1;
            const WALKS = ['walk', 'run', 'sneak'];
            // a walk ends where it goes: no stepping on the spot after the arrival
            const pAct = actionName(p.act);
            const act: ActName | undefined = p.walkTo && !on
              ? (moving ? (pAct && WALKS.includes(pAct) ? pAct : 'walk') : (pAct && !WALKS.includes(pAct) ? pAct : holdSpec ? 'hold' : 'idle'))
              : pAct ?? (holdSpec ? 'hold' : undefined);
            const beats = sortBeats(p.beats);
            // faces given in beats join the face keyframes
            const baseFace: [number, FaceExpr][] = p.face === undefined ? [] : typeof p.face === 'string' ? [[0, p.face]] : p.face;
            const faces = [...baseFace, ...beats.filter((b) => b.face).map((b): [number, FaceExpr] => [b.at, b.face!])].sort((a, b) => a[0] - b[0]);
            let yawRun = yawToward(i, p.look, flipYaw(baseYaw(p))) ?? 0;
            const stageBeats: StageBeat[] = beats.map((b) => {
              if (b.yaw !== undefined || b.look !== undefined) yawRun = yawToward(i, b.look, flipYaw(b.yaw) ?? yawRun) ?? yawRun;
              return { at: b.at, act: actionName(b.act), yaw: b.yaw !== undefined || b.look !== undefined ? yawRun : undefined, reach: targetOf(b.reach) };
            });
            // the arm stops carrying once the thing is gone, unless the shot says what the person does next
            if (rel && !pAct && !beats.some((b) => b.act && b.at >= rel.at)) stageBeats.push({ at: rel.at + 4, act: 'idle' });
            const reach = targetOf(p.reach);
            const combinedHead = vfx?.length ? (
              <g>
                {headGear}
                <HeadVfx items={vfx} t={t} />
              </g>
            ) : (
              headGear
            );
            return (
              <Staged key={`p${i}`} at={whereOf(p, i)} look={who} yaw={yawToward(i, p.look, flipYaw(baseYaw(p)))} act={act} from={p.walkTo ? undefined : from} dur={p.walkTo ? undefined : dur} stance={stance ?? stanceOfAction(act) ?? ownStance(act) ?? (on ? 'sit' : undefined)}
                pose={poseOf({ face: faces.length ? faces : undefined, pose: p.pose }, t, len) as never} beats={stageBeats} reach={reach ?? undefined}
                rimId={rimId} headGear={combinedHead} torsoGear={torsoGear} handLProp={handLProp} handRProp={handRProp} carry={carry} />
            );
          })}
          {spec.duo ? <Duo a={{ at: flipAt(spec.duo.a.at) as { u: number; w: number }, look: spec.duo.a.who, rimId: spec.duo.a.rimId, pose: poseOf(spec.duo.a, t, len) as never }} b={{ at: flipAt(spec.duo.b.at) as { u: number; w: number }, look: spec.duo.b.who, rimId: spec.duo.b.rimId, pose: poseOf(spec.duo.b, t, len) as never }} action={spec.duo.action} from={spec.duo.from} dur={spec.duo.dur} prop={spec.duo.prop} /> : null}
          {(spec.props ?? []).map((pr, i) => {
            const at = pl.pointOf(pr.on);
            return <g key={`prop-${i}`} transform={`translate(${at.x + (pr.dx ?? 0)} ${at.y + (pr.dy ?? 0)}) scale(${pr.scale ?? 1})`}>{pr.node}</g>;
          })}
          {extraNode ? <g>{extraNode}</g> : null}
        </Stage>
      </g>
      </g>
      {/* screen space: the title, stamp, tag and overlay must not follow the camera (prof, 2026-11-11: title off-centre and cut in 9:16) */}
      {spec.burst ? <ShockBurst {...spec.burst} t={t} /> : null}
      {spec.stamp ? <StampCard {...spec.stamp} t={t} /> : null}
      {spec.tag ? <ValueTag {...spec.tag} t={t} /> : null}
      {spec.title ? <HookTitle {...spec.title} t={t} /> : null}
      {spec.overlay ? <g>{typeof spec.overlay === 'function' ? spec.overlay(t, len) : spec.overlay}</g> : null}
      </g>
    );
  };
  return ShotComp;
};

/** JSX component form of `shot(...)`, so `<Shot place={...} cam="wide" people={[...]} t={t} len={len} />` also works. */
export const Shot: React.FC<ShotSpec & { t?: number; len?: number; f?: number }> = (props) =>
  shot(props)({ t: props.t ?? 0, len: props.len ?? 90, f: props.f ?? props.t ?? 0 });

// ---------------------------------------------------------------------------------------------------------------
// A phone insert, described instead of drawn: the screen fills the frame (16:9 and 9:16), messages arrive on their
// word, a banner drops in, a thumb types. Half the channel's stories turn on a phone; before this the agent drew the
// screen by hand, in the wrong frame (telephone-salon, 2026-11-10).

export type PhoneMsg = { at: number; text: string; from?: 'them' | 'me' };
export type PhoneSpec = {
  /** the contact at the top of the chat, or who the banner is from */ name: string;
  /** 'chat' (default): a conversation; 'lock': the lock screen with its banners; 'photo': a picture fills the screen */ screen?: 'chat' | 'lock' | 'photo';
  /** what the picture shows (screen: 'photo'): people from the cast as busts, an outfit laid flat, or your own drawing
   * in a 100 x 100 box. `caption` is the line under it, `posted` a "published" tick appearing at a frame. */
  photo?: { people?: { skin?: string; hair?: string; jacket?: string }[]; outfit?: { top: string; bottom?: string; shoes?: string }; node?: React.ReactNode; caption?: string; back?: string; posted?: { at: number; text?: string } };
  /** bubbles, each appearing at its frame (the shot's own clock) */ messages?: PhoneMsg[];
  /** a banner sliding in from the top at frame `at` */ notify?: { at: number; text: string; from?: string };
  /** the thumb types `text` into the input bar from frame `at` over `dur` frames */ typing?: { at: number; text: string; dur?: number };
  /** battery percent in the status bar; 10 or less shows red */ battery?: number;
  /** clock in the status bar */ time?: string;
  /** the room behind the phone, blurred */ back?: Placed;
  /** optional character (`cast(...)`) whose hand skin colour is inherited automatically */ who?: { skin?: string };
  /** hand skin colour; null hides the hand */ skin?: string | null;
  /** case colour */ case?: string;
  /** chat accent (my bubbles) */ accent?: string;
  /** the camera pushes on the screen (default true) */ push?: boolean;
};

const wrapText = (text: string, max: number): string[] => {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
};

const PhoneScreenUI: React.FC<{ spec: PhoneSpec; t: number; W: number; H: number }> = ({ spec, t, W, H }) => {
  const accent = spec.accent ?? '#3E7BFA';
  const font = 'system-ui, -apple-system, Segoe UI, sans-serif';
  const fs = W * 0.052;
  const pad = W * 0.06;
  const low = (spec.battery ?? 64) <= 10;
  const status = (
    <g>
      <text x={pad} y={H * 0.045} fontSize={fs * 0.82} fontWeight={600} fill="#F4F6FA" fontFamily={font}>{spec.time ?? '21:47'}</text>
      <g transform={`translate(${W - pad - fs * 2.6} ${H * 0.045 - fs * 0.7})`}>
        <rect width={fs * 1.9} height={fs * 0.85} rx={fs * 0.2} fill="none" stroke={low ? '#FF5A5A' : '#F4F6FA'} strokeWidth={2.5} />
        <rect x={3} y={3} width={Math.max(2, (fs * 1.9 - 6) * clamp((spec.battery ?? 64) / 100, 0, 1))} height={fs * 0.85 - 6} rx={2} fill={low ? '#FF5A5A' : '#F4F6FA'} />
        <rect x={fs * 1.9 + 1} y={fs * 0.25} width={4} height={fs * 0.35} fill={low ? '#FF5A5A' : '#F4F6FA'} />
      </g>
      {spec.battery !== undefined ? (
        <text x={W - pad - fs * 2.9} y={H * 0.045} textAnchor="end" fontSize={fs * 0.78} fontWeight={600} fill={low ? '#FF5A5A' : '#F4F6FA'} fontFamily={font}>{`${spec.battery} %`}</text>
      ) : null}
    </g>
  );
  const bannerTop = spec.screen === 'lock' ? H * 0.28 : H * 0.065;
  const banner = spec.notify
    ? (() => {
        const k = ease01((t - spec.notify.at) / 7);
        if (k <= 0) return null;
        const lines = wrapText(spec.notify.text, 26).slice(0, 3);
        const bh = fs * (2.6 + lines.length * 1.25);
        return (
          <g transform={`translate(${pad * 0.6} ${bannerTop - (1 - k) * (bh + H * 0.08)})`} opacity={k}>
            <rect width={W - pad * 1.2} height={bh} rx={fs * 0.9} fill="#F7F4EE" opacity={0.97} />
            <rect x={fs * 0.6} y={fs * 0.6} width={fs * 1.5} height={fs * 1.5} rx={fs * 0.4} fill="#35C759" />
            <text x={fs * 2.5} y={fs * 1.6} fontSize={fs * 0.9} fontWeight={700} fill="#1C1C22" fontFamily={font}>{spec.notify.from ?? spec.name}</text>
            {lines.map((l, i) => (
              <text key={i} x={fs * 0.7} y={fs * (3.2 + i * 1.25)} fontSize={fs * 0.95} fill="#2A2A33" fontFamily={font}>{l}</text>
            ))}
          </g>
        );
      })()
    : null;
  if (spec.screen === 'lock') {
    return (
      <g>
        <rect width={W} height={H} fill="#1B2440" />
        <rect width={W} height={H} fill="url(#phoneLockGlow)" />
        {status}
        <text x={W / 2} y={H * 0.21} textAnchor="middle" fontSize={fs * 4.2} fontWeight={300} fill="#F4F6FA" fontFamily={font}>{spec.time ?? '21:47'}</text>
        {banner}
      </g>
    );
  }
  if (spec.screen === 'photo') {
    const ph = spec.photo ?? {};
    const top = H * 0.1;
    const side = W - pad * 1.2;
    const u = side / 100;
    const busts = (ph.people ?? []).slice(0, 4);
    const posted = ph.posted && t >= ph.posted.at ? ease01((t - ph.posted.at) / 6) : 0;
    return (
      <g>
        <rect width={W} height={H} fill="#10141C" />
        {status}
        <text x={pad} y={top - fs * 0.5} fontSize={fs * 1.05} fontWeight={700} fill="#F4F6FA" fontFamily={font}>{spec.name}</text>
        <svg x={pad * 0.6} y={top} width={side} height={side} viewBox="0 0 100 100">
          <rect width={100} height={100} rx={5} fill={ph.back ?? '#7FA6C9'} />
          <rect y={66} width={100} height={34} fill="#00000022" />
          {busts.map((b, i) => {
            const n = busts.length;
            const cx = n === 1 ? 50 : 50 + (i - (n - 1) / 2) * Math.min(34, 76 / n);
            const r = n <= 2 ? 15 : 11;
            const cy = 48 + (i % 2) * 3;
            return (
              <g key={i}>
                <path d={`M ${cx - r * 1.9} 100 Q ${cx - r * 1.9} ${cy + r * 1.5} ${cx} ${cy + r * 1.3} Q ${cx + r * 1.9} ${cy + r * 1.5} ${cx + r * 1.9} 100 Z`} fill={b.jacket ?? '#4E6FA8'} stroke="#1F1B2E" strokeWidth={1.4} />
                <rect x={cx - r * 0.3} y={cy + r * 0.7} width={r * 0.6} height={r * 0.8} fill={b.skin ?? '#E9BE9A'} />
                <circle cx={cx} cy={cy} r={r} fill={b.skin ?? '#E9BE9A'} stroke="#1F1B2E" strokeWidth={1.4} />
                <path d={`M ${cx - r * 1.05} ${cy + r * 0.1} Q ${cx - r * 1.15} ${cy - r * 1.25} ${cx} ${cy - r * 1.18} Q ${cx + r * 1.15} ${cy - r * 1.25} ${cx + r * 1.05} ${cy + r * 0.1} Q ${cx} ${cy - r * 0.75} ${cx - r * 1.05} ${cy + r * 0.1} Z`} fill={b.hair ?? '#3A2A20'} stroke="#1F1B2E" strokeWidth={1.2} />
                <path d={`M ${cx - r * 0.35} ${cy + r * 0.35} Q ${cx} ${cy + r * 0.7} ${cx + r * 0.35} ${cy + r * 0.35}`} fill="none" stroke="#1F1B2E" strokeWidth={1.3} strokeLinecap="round" />
                <circle cx={cx - r * 0.38} cy={cy - r * 0.05} r={r * 0.09} fill="#1F1B2E" />
                <circle cx={cx + r * 0.38} cy={cy - r * 0.05} r={r * 0.09} fill="#1F1B2E" />
              </g>
            );
          })}
          {ph.outfit ? (
            <g stroke="#1F1B2E" strokeWidth={1.4} strokeLinejoin="round">
              <path d="M 30 16 L 42 10 Q 50 16 58 10 L 70 16 L 80 30 L 70 36 L 66 30 L 66 54 L 34 54 L 34 30 L 30 36 L 20 30 Z" fill={ph.outfit.top} />
              <path d="M 35 58 L 65 58 L 68 92 L 54 92 L 50 68 L 46 92 L 32 92 Z" fill={ph.outfit.bottom ?? '#2F3A52'} />
              {ph.outfit.shoes ? <path d="M 12 86 L 24 86 Q 28 92 24 94 L 10 94 Z M 76 86 L 88 86 Q 92 92 88 94 L 74 94 Z" fill={ph.outfit.shoes} /> : null}
            </g>
          ) : null}
          {ph.node}
        </svg>
        {wrapText(ph.caption ?? '', 24).slice(0, 3).map((l, i) => (
          <text key={i} x={pad} y={top + side + fs * (1.7 + i * 1.3)} fontSize={fs} fill="#F4F6FA" fontFamily={font}>{l}</text>
        ))}
        {posted ? (
          <g opacity={posted} transform={`translate(${W / 2} ${H * 0.74})`}>
            <rect x={-W * 0.36} y={-fs * 1.1} width={W * 0.72} height={fs * 2.2} rx={fs * 1.1} fill="#35C759" />
            <text y={fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#FFF" fontFamily={font}>{`✓ ${ph.posted!.text ?? 'Photo publiée'}`}</text>
          </g>
        ) : null}
        {banner}
      </g>
    );
  }
  // chat: header, bubbles stacked from the top and scrolled so the newest stays above the input bar
  const headerH = H * 0.13;
  const inputH = H * 0.095;
  const shown = (spec.messages ?? []).filter((m) => t >= m.at);
  const lineH = fs * 1.3;
  const blocks = shown.map((m) => {
    const lines = wrapText(m.text, 20);
    return { m, lines, h: lines.length * lineH + fs * 1.1 };
  });
  const gap = fs * 0.55;
  const total = blocks.reduce((s, b) => s + b.h + gap, 0);
  const room = H - headerH - inputH - fs * 1.8;
  let y = headerH + fs * 0.6 - Math.max(0, total - room);
  const typed = spec.typing ? spec.typing.text.slice(0, Math.floor(spec.typing.text.length * clamp((t - spec.typing.at) / (spec.typing.dur ?? 30), 0, 1))) : '';
  return (
    <g>
      <defs>
        <clipPath id="phoneChatClip">
          <rect x={0} y={headerH} width={W} height={H - headerH - inputH} />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill="#10141C" />
      <g clipPath="url(#phoneChatClip)">
        {blocks.map(({ m, lines, h }, i) => {
          const mine = m.from === 'me';
          const k = ease01((t - m.at) / 6);
          const bw = Math.min(W * 0.8, Math.max(fs * 2.6, Math.max(...lines.map((l) => l.length)) * fs * 0.58 + fs * 1.5));
          const x = mine ? W - pad * 0.7 - bw : pad * 0.7;
          const top = y;
          y += h + gap;
          return (
            <g key={i} transform={`translate(${x + (mine ? bw : 0)} ${top + h}) scale(${0.6 + 0.4 * k}) translate(${-(x + (mine ? bw : 0))} ${-(top + h)})`} opacity={k}>
              <rect x={x} y={top} width={bw} height={h} rx={fs * 0.8} fill={mine ? accent : '#2A303C'} />
              {lines.map((l, j) => (
                <text key={j} x={x + fs * 0.7} y={top + fs * 1.25 + j * lineH} fontSize={fs} fill="#F4F6FA" fontFamily={font}>{l}</text>
              ))}
            </g>
          );
        })}
      </g>
      <rect width={W} height={headerH} fill="#1A202B" />
      {status}
      <circle cx={pad + fs * 1.1} cy={headerH * 0.68} r={fs * 1.1} fill="#C77D9A" />
      <text x={pad + fs * 1.1} y={headerH * 0.68 + fs * 0.4} textAnchor="middle" fontSize={fs * 1.1} fontWeight={700} fill="#FFF" fontFamily={font}>{spec.name.slice(0, 1).toUpperCase()}</text>
      <text x={pad + fs * 2.7} y={headerH * 0.66} fontSize={fs * 1.05} fontWeight={700} fill="#F4F6FA" fontFamily={font}>{spec.name}</text>
      <text x={pad + fs * 2.7} y={headerH * 0.66 + fs * 1.05} fontSize={fs * 0.75} fill="#7FD68F" fontFamily={font}>en ligne</text>
      <rect y={H - inputH} width={W} height={inputH} fill="#1A202B" />
      <rect x={pad * 0.6} y={H - inputH + inputH * 0.2} width={W - pad * 1.2} height={inputH * 0.6} rx={inputH * 0.3} fill="#2A303C" />
      <text x={pad * 0.6 + fs * 0.8} y={H - inputH / 2 + fs * 0.35} fontSize={fs * 0.95} fill={typed ? '#F4F6FA' : '#7C8494'} fontFamily={font}>
        {typed || 'Message'}{spec.typing && t >= spec.typing.at && Math.floor(t / 8) % 2 === 0 ? '|' : ''}
      </text>
      {banner}
    </g>
  );
};

/** A full-frame phone insert: `export const S5 = phoneShot({ name: 'Camille', messages: [{ at: 36, text: 'Tu me manques' }] })`. */
export const phoneShot = (spec: PhoneSpec): React.FC<ShotProps> => {
  const Back = spec.back ? shot({ place: spec.back, cam: 'wide', move: 'still' }) : null;
  const PhoneComp: React.FC<ShotProps> = ({ t, len }) => {
    const k = len > 0 ? clamp(t / len, 0, 1) : 0;
    const zoom = spec.push === false ? 1 : 1 + 0.06 * k;
    // the phone fills most of the frame height; a little sway so the shot breathes
    const H = FRAME.h * (PORTRAIT ? 0.8 : 0.86);
    const W = H * 0.5;
    const cx = 960 + Math.sin(t / 23) * 4;
    const cy = 540 + Math.cos(t / 29) * 3 + (PORTRAIT ? 30 : 10);
    const tilt = -4 + Math.sin(t / 37) * 0.8;
    const bezel = W * 0.04;
    const skin = spec.skin === null ? null : spec.skin ?? spec.who?.skin ?? '#E9BE9A';
    const typingNow = spec.typing && t >= spec.typing.at && t <= spec.typing.at + (spec.typing.dur ?? 30);
    const tap = typingNow ? Math.abs(Math.sin(t * 0.9)) * 10 : 0;
    return (
      <g>
        {Back ? (
          <g filter="url(#blur6)" opacity={0.85}>
            <Back t={t} len={len} f={t} />
          </g>
        ) : (
          <rect x={-2000} y={-2000} width={6000} height={6000} fill="#2A2730" />
        )}
        <rect x={-2000} y={-2000} width={6000} height={6000} fill="#000" opacity={0.35} />
        <defs>
          <radialGradient id="phoneLockGlow" cx="0.5" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#5A4E9A" stopOpacity={0.9} />
            <stop offset="1" stopColor="#1B2440" stopOpacity={0} />
          </radialGradient>
        </defs>
        <g transform={`translate(960 540) scale(${zoom}) translate(-960 -540) rotate(${tilt} ${cx} ${cy})`}>
          <rect x={cx - W / 2 + 14} y={cy - H / 2 + 22} width={W} height={H} rx={W * 0.12} fill="#000" opacity={0.35} />
          <rect x={cx - W / 2} y={cy - H / 2} width={W} height={H} rx={W * 0.12} fill={spec.case ?? '#1F2430'} />
          <svg x={cx - W / 2 + bezel} y={cy - H / 2 + bezel} width={W - bezel * 2} height={H - bezel * 2} viewBox={`0 0 ${W - bezel * 2} ${H - bezel * 2}`}>
            <rect width={W - bezel * 2} height={H - bezel * 2} rx={W * 0.09} fill="#10141C" />
            <PhoneScreenUI spec={spec} t={t} W={W - bezel * 2} H={H - bezel * 2} />
          </svg>
          <rect x={cx - W * 0.12} y={cy - H / 2 + bezel * 1.6} width={W * 0.24} height={bezel * 1.1} rx={bezel * 0.55} fill="#05070A" />
          {skin ? (
            <g>
              {/* the hand holding it: fingers on the left edge, the thumb over the bottom input bar */}
              {[0.18, 0.3, 0.42].map((v, i) => (
                <rect key={i} x={cx - W / 2 - W * 0.07} y={cy - H / 2 + H * (0.45 + v * 0.6)} width={W * 0.12} height={H * 0.06} rx={H * 0.03} fill={skin} />
              ))}
              <path d={`M ${cx - W * 0.28} ${cy + H * 0.66} Q ${cx - W * 0.08} ${cy + H * 0.38} ${cx + W * 0.62} ${cy + H * 0.43} L ${cx + W * 0.7} ${cy + H * 0.74} Z`} fill={skin} />
              <ellipse cx={cx + W * 0.16} cy={cy + H * 0.42 - tap} rx={W * 0.12} ry={W * 0.068} fill={skin} transform={`rotate(-26 ${cx + W * 0.16} ${cy + H * 0.42 - tap})`} />
            </g>
          ) : null}
        </g>
      </g>
    );
  };
  return PhoneComp;
};
