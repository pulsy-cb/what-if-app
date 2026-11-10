import React from 'react';
import { STUDIO } from '../studio.config';
import { Stage, Staged, StageItem, Duo } from './stage';
import type { DuoAction, Place } from './stage';
import type { Placed } from './rooms';
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
export type PersonSpec = {
  who: PersonLook;
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
  /** depth kept sharp; the rest softens */ focus?: number;
  people?: PersonSpec[];
  duo?: DuoSpec;
  /** your own SVG in the world, in front of the room and sorted last */ extra?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
};

const PORTRAIT = STUDIO.height > STUDIO.width;
const FRAME = PORTRAIT ? { w: 900, h: 1600 } : { w: 1920, h: 1080 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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

/** Turn a description into a shot. */
export const shot = (spec: ShotSpec): React.FC<ShotProps> => {
  const ShotComp: React.FC<ShotProps> = ({ t, len }) => {
    const pl = spec.place;
    const people = spec.people ?? [];
    const whereOf = (p: PersonSpec, idx = 0): Place => {
      if (p.on) return pl.seat(p.on, p.seat ?? 0);
      const at = timed(p.at, t, len);
      return at ?? { u: people.length <= 1 ? 0.5 : 0.34 + idx * 0.28, w: 0.45 };
    };
    const subjectIdx = spec.on ?? 0;
    const subject = spec.duo ? null : people[subjectIdx];
    const focusPoint = (() => {
      if (subject) {
        const where = whereOf(subject, subjectIdx);
        const g = 'u' in where ? pl.ground.project(where.u, where.w) : { x: where.x, y: where.y, scale: where.scale ?? 1 };
        const b = legsOf(subject);
        const sitting = subject.on !== undefined || subject.stance === 'sit';
        return { x: g.x, y: g.y + (sitting ? b.thigh * g.scale * 0.85 : 0), scale: g.scale * ((b.thigh + b.shin) / 140) };
      }
      if (spec.duo) {
        const a = pl.ground.project(spec.duo.a.at.u, spec.duo.a.at.w);
        const b = pl.ground.project(spec.duo.b.at.u, spec.duo.b.at.w);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, scale: (a.scale + b.scale) / 2 };
      }
      return pl.ground.project(0.5, 0.45);
    })();
    const c = spec.cam ?? 'wide';
    const sized = typeof c === 'string' ? frameOn(c, focusPoint, subject?.yaw ?? 0) : c;
    // a tall frame must not reach below the room's near floor edge, where nothing is drawn
    const base = typeof c === 'string' && c !== 'establishing' ? { ...sized, y: Math.min(sized.y, pl.ground.project(0.5, 1).y - FRAME.h / (2 * sized.zoom)) } : sized;
    const k = len > 0 ? clamp(t / len, 0, 1) : 0;
    const move = spec.move ?? 'push';
    const zoom = base.zoom * (move === 'push' ? 1 + 0.05 * k : move === 'pull' ? 1.05 - 0.05 * k : 1);
    return (
      <g transform={camT(base.x, base.y, zoom)}>
        <Stage ground={pl.ground} t={t} focus={spec.focus}>
          <pl.Shell t={t} />
          {pl.items(t)}
          {people.flatMap((p) => {
            if (!p.on || !pl.wantsStool(p.on)) return [];
            const s = pl.seat(p.on, p.seat ?? 0);
            const g = pl.ground.project(s.u, s.w);
            const b = legsOf(p);
            return [<StageItem key={`stool-${p.on}-${p.seat ?? 0}`} depth={s.w - 0.001}><Stool x={g.x} y={g.y} scale={g.scale} height={b.shin + 0.2 * b.thigh} color={pl.tokens.wood} metal={pl.tokens.metal} /></StageItem>];
          })}
          {people.map((p, i) => {
            const { who, on, yaw, act, from, dur, stance, rimId, headGear, torsoGear, handLProp, handRProp } = p;
            return (
              <Staged key={`p${i}`} at={whereOf(p, i)} look={who} yaw={yaw} act={act} from={from} dur={dur} stance={stance ?? (on ? 'sit' : undefined)} pose={poseOf(p, t, len) as never}
                rimId={rimId} headGear={headGear} torsoGear={torsoGear} handLProp={handLProp} handRProp={handRProp} />
            );
          })}
          {spec.duo ? <Duo a={{ at: spec.duo.a.at, look: spec.duo.a.who, rimId: spec.duo.a.rimId, pose: poseOf(spec.duo.a, t, len) as never }} b={{ at: spec.duo.b.at, look: spec.duo.b.who, rimId: spec.duo.b.rimId, pose: poseOf(spec.duo.b, t, len) as never }} action={spec.duo.action} from={spec.duo.from} dur={spec.duo.dur} prop={spec.duo.prop} /> : null}
          {spec.extra ? <g>{typeof spec.extra === 'function' ? spec.extra(t, len) : spec.extra}</g> : null}
        </Stage>
      </g>
    );
  };
  return ShotComp;
};

/** JSX component form of `shot(...)`, so `<Shot place={...} cam="wide" people={[...]} t={t} len={len} />` also works. */
export const Shot: React.FC<ShotSpec & { t?: number; len?: number; f?: number }> = (props) =>
  shot(props)({ t: props.t ?? 0, len: props.len ?? 90, f: props.f ?? props.t ?? 0 });
