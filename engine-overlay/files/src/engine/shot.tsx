import React from 'react';
import { STUDIO } from '../studio.config';
import { Stage, Staged, StageItem, Duo } from './stage';
import type { StageBeat } from './stage';
import type { DuoAction, Place } from './stage';
import type { Placed } from './rooms';
import { mirrorSpot, mirrorYaw } from './rooms';
import type { PersonLook } from './person';
import { bodyOf } from './person';
import type { ActName, Stance } from './actions';
import { faceAt } from './rig';
import type { Expr } from './rig';

// A shot described instead of drawn. `shot({ ... })` gives the component a timeline expects: the place, who is there,
// what they do, how it is framed. The camera follows from the person it is on, in 16:9 and in 9:16. Every field has a
// way out: a literal camera, a literal position, `extra` for your own SVG, or a hand-written shot beside this one.

type ShotProps = { t: number; len: number; f?: number };
export type CamSize = 'establishing' | 'wide' | 'medium' | 'close';
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
export type PersonBeat = { at: number; act?: ActName; face?: FaceExpr; yaw?: number; look?: number; reach?: ReachSpec | null };
/** from frame `at`, the camera changes: another size, another person, or a shake (an impact) */
export type CamBeat = { at: number; cam?: CamSpec; on?: number; shake?: number; angle?: 'low' | 'high' | 'level' };
export type PersonSpec = {
  who: PersonLook;
  /** turn toward this person (index in people) */ look?: number;
  /** a hand goes to someone or something, from the start */ reach?: ReachSpec;
  /** what changes during the shot, at given frames */ beats?: PersonBeat[];
  /** on the floor; a function of (t, len) to move someone */ at?: Timed<Place>;
  /** or on a piece of furniture: seats the person there */ on?: string;
  seat?: number;
  yaw?: number;
  act?: ActName;
  from?: number;
  dur?: number;
  stance?: Stance;
  face?: FaceSpecT;
  /** any pose field; a function of (t, len) for keyframes. Overrides `act` */ pose?: Timed<Record<string, unknown>>;
  rimId?: string;
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
  /** your own SVG in the world, in front of the room and sorted last */ extra?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
};

const PORTRAIT = STUDIO.height > STUDIO.width;
const FRAME = PORTRAIT ? { w: 900, h: 1600 } : { w: 1920, h: 1080 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease01 = (v: number) => { const k = clamp(v, 0, 1); return k * k * (3 - 2 * k); };
const BODY = 378;

/** The camera for a person: zoom from how much of them shows, off-centre so they look into the frame. */
export const frameOn = (size: CamSize, p: { x: number; y: number; scale: number }, yaw = 0): { x: number; y: number; zoom: number } => {
  if (size === 'establishing') return { x: 900, y: PORTRAIT ? 440 : 500, zoom: 0.85 };
  const s = p.scale;
  const fit: Record<Exclude<CamSize, 'establishing'>, { height: number; width: number; share: number; chest: number }> = {
    wide: { height: 378 * s, width: 620 * s, share: PORTRAIT ? 0.46 : 0.62, chest: 0.52 },
    medium: { height: 250 * s, width: 400 * s, share: PORTRAIT ? 0.52 : 0.72, chest: 0.78 },
    close: { height: 190 * s, width: 280 * s, share: PORTRAIT ? 0.46 : 0.72, chest: 0.92 },
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

const sortBeats = <T extends { at: number },>(b: T[] | undefined): T[] => [...(b ?? [])].sort((x, y) => x.at - y.at);

/** Turn a description into a shot. */
export const shot = (spec: ShotSpec): React.FC<ShotProps> => {
  const ShotComp: React.FC<ShotProps> = ({ t, len }) => {
    const reverse = spec.view === 'reverse';
    const pl = reverse ? spec.place.reverse : spec.place;
    const flipYaw = (y: number | undefined) => (y === undefined || !reverse ? y : mirrorYaw(y));
    const flipAt = <T extends Place>(at: T): Place => (reverse && 'u' in at ? mirrorSpot(at as { u: number; w: number }) : at);
    const people = spec.people ?? [];
    const whereOf = (p: PersonSpec, idx = 0): Place => {
      if (p.on) return flipAt(pl.seat(p.on, p.seat ?? 0));
      const at = timed(p.at, t, len);
      return flipAt(at ?? { u: people.length <= 1 ? 0.5 : 0.34 + idx * 0.28, w: 0.45 });
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
    const yawAt = (i: number): number => {
      const p = people[i]!;
      let y = yawToward(i, p.look, flipYaw(p.yaw)) ?? 0;
      for (const b of sortBeats(p.beats)) if (b.at <= t && (b.yaw !== undefined || b.look !== undefined)) y = yawToward(i, b.look, flipYaw(b.yaw) ?? y) ?? y;
      return y;
    };
    const focusOn = (i: number) => {
      const subject = people[i];
      if (subject) {
        const g = spotOfPerson(i);
        const b = legsOf(subject);
        const sitting = subject.on !== undefined || subject.stance === 'sit';
        return { x: g.x, y: g.y + (sitting ? b.thigh * g.scale * 0.85 : 0), scale: g.scale * ((b.thigh + b.shin) / 140) };
      }
      if (spec.duo) {
        const da = flipAt(spec.duo.a.at) as { u: number; w: number };
        const db = flipAt(spec.duo.b.at) as { u: number; w: number };
        const a = pl.ground.project(da.u, da.w);
        const b = pl.ground.project(db.u, db.w);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, scale: (a.scale + b.scale) / 2 };
      }
      return pl.ground.project(0.5, 0.45);
    };
    const cameraFor = (c: CamSpec, on: number) => {
      const sized = typeof c === 'string' ? frameOn(c, focusOn(on), people[on] ? yawAt(on) : 0) : c;
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
    const jolt = shake ? { x: Math.sin(t * 2.7) * shake, y: Math.cos(t * 3.1) * shake * 0.6 } : { x: 0, y: 0 };
    return (
      <g transform={camT(base.x + jolt.x / zoom, base.y + lift * viewH + jolt.y / zoom, zoom)}>
      <g transform={angleT}>
        <Stage ground={pl.ground} t={t} focus={focus}>
          <g filter={shellFilter}>
            <pl.Shell t={t} />
          </g>
          {pl.items(t)}
          {people.flatMap((p) => {
            if (!p.on || !pl.wantsStool(p.on)) return [];
            const s = flipAt(pl.seat(p.on, p.seat ?? 0)) as { u: number; w: number };
            const g = pl.ground.project(s.u, s.w);
            const b = legsOf(p);
            return [<StageItem key={`stool-${p.on}-${p.seat ?? 0}`} depth={s.w - 0.001}><Stool x={g.x} y={g.y} scale={g.scale} height={b.shin + 0.2 * b.thigh} color={pl.tokens.wood} metal={pl.tokens.metal} /></StageItem>];
          })}
          {people.map((p, i) => {
            const { who, on, act, from, dur, stance, rimId, headGear, torsoGear, handLProp, handRProp } = p;
            const beats = sortBeats(p.beats);
            // faces given in beats join the face keyframes
            const baseFace: [number, FaceExpr][] = p.face === undefined ? [] : typeof p.face === 'string' ? [[0, p.face]] : p.face;
            const faces = [...baseFace, ...beats.filter((b) => b.face).map((b): [number, FaceExpr] => [b.at, b.face!])].sort((a, b) => a[0] - b[0]);
            let yawRun = yawToward(i, p.look, flipYaw(p.yaw)) ?? 0;
            const stageBeats: StageBeat[] = beats.map((b) => {
              if (b.yaw !== undefined || b.look !== undefined) yawRun = yawToward(i, b.look, flipYaw(b.yaw) ?? yawRun) ?? yawRun;
              return { at: b.at, act: b.act, yaw: b.yaw !== undefined || b.look !== undefined ? yawRun : undefined, reach: targetOf(b.reach) };
            });
            const reach = targetOf(p.reach);
            return (
              <Staged key={`p${i}`} at={whereOf(p, i)} look={who} yaw={yawToward(i, p.look, flipYaw(p.yaw))} act={act} from={from} dur={dur} stance={stance ?? (on ? 'sit' : undefined)}
                pose={poseOf({ face: faces.length ? faces : undefined, pose: p.pose }, t, len) as never} beats={stageBeats} reach={reach ?? undefined}
                rimId={rimId} headGear={headGear} torsoGear={torsoGear} handLProp={handLProp} handRProp={handRProp} />
            );
          })}
          {spec.duo ? <Duo a={{ at: flipAt(spec.duo.a.at) as { u: number; w: number }, look: spec.duo.a.who, rimId: spec.duo.a.rimId, pose: poseOf(spec.duo.a, t, len) as never }} b={{ at: flipAt(spec.duo.b.at) as { u: number; w: number }, look: spec.duo.b.who, rimId: spec.duo.b.rimId, pose: poseOf(spec.duo.b, t, len) as never }} action={spec.duo.action} from={spec.duo.from} dur={spec.duo.dur} prop={spec.duo.prop} /> : null}
          {spec.extra ? <g>{typeof spec.extra === 'function' ? spec.extra(t, len) : spec.extra}</g> : null}
        </Stage>
      </g>
      </g>
    );
  };
  return ShotComp;
};

/** JSX component form of `shot(...)`, so `<Shot place={...} cam="wide" people={[...]} t={t} len={len} />` also works. */
export const Shot: React.FC<ShotSpec & { t?: number; len?: number; f?: number }> = (props) =>
  shot(props)({ t: props.t ?? 0, len: props.len ?? 90, f: props.f ?? props.t ?? 0 });
