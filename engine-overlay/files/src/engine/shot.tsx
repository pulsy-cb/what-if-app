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
    const baseYaw = (p: PersonSpec): number | undefined => p.yaw ?? (p.on ? pl.seatYaw?.(p.on) : undefined);
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
    const cameraFor = (c: CamSpec, on: number) => {
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
            let yawRun = yawToward(i, p.look, flipYaw(baseYaw(p))) ?? 0;
            const stageBeats: StageBeat[] = beats.map((b) => {
              if (b.yaw !== undefined || b.look !== undefined) yawRun = yawToward(i, b.look, flipYaw(b.yaw) ?? yawRun) ?? yawRun;
              return { at: b.at, act: b.act, yaw: b.yaw !== undefined || b.look !== undefined ? yawRun : undefined, reach: targetOf(b.reach) };
            });
            const reach = targetOf(p.reach);
            return (
              <Staged key={`p${i}`} at={whereOf(p, i)} look={who} yaw={yawToward(i, p.look, flipYaw(baseYaw(p)))} act={act} from={from} dur={dur} stance={stance ?? (on ? 'sit' : undefined)}
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

// ---------------------------------------------------------------------------------------------------------------
// A phone insert, described instead of drawn: the screen fills the frame (16:9 and 9:16), messages arrive on their
// word, a banner drops in, a thumb types. Half the channel's stories turn on a phone; before this the agent drew the
// screen by hand, in the wrong frame (telephone-salon, 2026-11-10).

export type PhoneMsg = { at: number; text: string; from?: 'them' | 'me' };
export type PhoneSpec = {
  /** the contact at the top of the chat, or who the banner is from */ name: string;
  /** 'chat' (default): a conversation; 'lock': the lock screen with its banners */ screen?: 'chat' | 'lock';
  /** bubbles, each appearing at its frame (the shot's own clock) */ messages?: PhoneMsg[];
  /** a banner sliding in from the top at frame `at` */ notify?: { at: number; text: string; from?: string };
  /** the thumb types `text` into the input bar from frame `at` over `dur` frames */ typing?: { at: number; text: string; dur?: number };
  /** battery percent in the status bar; 10 or less shows red */ battery?: number;
  /** clock in the status bar */ time?: string;
  /** the room behind the phone, blurred */ back?: Placed;
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
    const skin = spec.skin === null ? null : spec.skin ?? '#E9BE9A';
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
