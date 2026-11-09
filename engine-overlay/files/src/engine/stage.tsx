import React from 'react';
import type { Room } from './room';
import { basePose, LOOKS } from './rig';
import { Person, bodyOf, jointsOf, handOf, ikArmOf } from './person';
import type { Body, BodyId, PersonLook, PersonPose } from './person';
import { act as actOf, STANCES } from './actions';
import type { ActName, ActBits, Stance } from './actions';
import type { Pose } from './rig';

// A stage knows where the ground is. Things are placed by a ground position (u across, w toward the camera) and it
// works out where they land on screen, how big they are, what hides what, and how far away they feel.
// `<Stage>` sorts its direct children far to near, whatever order they are written in. Raw SVG still works inside it:
// a child with no depth written before the first placed element is background, one written after it is foreground.

const BODY_H = 378; // the rig's height at scale 1, head to soles

export type Ground = { project: (u: number, w: number) => { x: number; y: number; scale: number } };

/** The floor of a room, or of anything built with makeRoom (OUTDOOR too): a person is `k` of the back wall's height. */
export const roomGround = (r: Room, k = 0.62): Ground => ({
  project: (u, w) => {
    const p = r.P(u, 1, w);
    return { x: p.x, y: p.y, scale: (k * (r.back.y1 - r.back.y0) * r.s(w)) / BODY_H };
  },
});

/** A ground that is not a room (a rooftop deck, a stage seen side-on): from `far` (w = 0) to `near` (w = 1). */
export const planeGround = (g: { x0: number; x1: number; far: { y: number; scale: number }; near: { y: number; scale: number } }): Ground => ({
  project: (u, w) => ({
    x: g.x0 + (g.x1 - g.x0) * u,
    y: g.far.y + (g.near.y - g.far.y) * w,
    scale: g.far.scale + (g.near.scale - g.far.scale) * w,
  }),
});

/** Where something stands: on the ground (u, w), or at a literal floor point when the place fits no ground. */
export type Place = { u: number; w: number } | { x: number; y: number; scale?: number; w?: number };

type Ctx = { ground?: Ground; focus?: number; fade: number; t?: number };
const StageCtx = React.createContext<Ctx>({ fade: 1 });

/** Far things lose a little light and colour; things away from the focus go soft. */
const depthLook = (w: number, c: Ctx): { style?: React.CSSProperties; filter?: string } => {
  const k = Math.max(0, 1 - w) * c.fade;
  const style = k > 0.01 ? { filter: `brightness(${(1 - 0.28 * k).toFixed(3)}) saturate(${(1 - 0.35 * k).toFixed(3)})` } : undefined;
  let filter: string | undefined;
  if (c.focus !== undefined) {
    const d = Math.abs(w - c.focus);
    if (d > 0.45) filter = 'url(#blur6)';
    else if (d > 0.25) filter = 'url(#blur3)';
  }
  return { style, filter };
};

/** Two groups on purpose: a CSS `filter` in style would override the filter attribute on the same element. */
const AtDepth: React.FC<{ w: number; children: React.ReactNode }> = ({ w, children }) => {
  const d = depthLook(w, React.useContext(StageCtx));
  return (
    <g style={d.style}>
      <g filter={d.filter}>{children}</g>
    </g>
  );
};

const flatten = (n: React.ReactNode): React.ReactNode[] =>
  React.Children.toArray(n).flatMap((c) =>
    React.isValidElement(c) && c.type === React.Fragment ? flatten((c.props as { children?: React.ReactNode }).children) : [c],
  );

const declaredDepth = (el: React.ReactNode): number | undefined => {
  if (!React.isValidElement(el)) return undefined;
  // only `at` and `depth`: `w` is a width on most of the engine's components (WallFrame, DiningTable…)
  const p = el.props as { at?: { w?: number }; depth?: unknown };
  if (p.at) return p.at.w ?? 0.5;
  const duo = el.props as { a?: { at?: { w?: number } }; b?: { at?: { w?: number } } };
  if (duo.a?.at && duo.b?.at) return ((duo.a.at.w ?? 0.5) + (duo.b.at.w ?? 0.5)) / 2;
  return typeof p.depth === 'number' ? p.depth : undefined;
};

/**
 * `ground`: how positions map to the screen. `focus`: the depth (w) that stays sharp; omit it to keep everything sharp.
 * `fade`: how much far things dim (0 for none). `t`: the shot's clock, needed by `act` and <Duo>.
 */
export const Stage: React.FC<{ ground?: Ground; focus?: number; fade?: number; t?: number; children: React.ReactNode }> = ({ ground, focus, fade = 1, t, children }) => {
  let placed = false;
  const items = flatten(children).map((c, i) => {
    const d = declaredDepth(c);
    if (d !== undefined) placed = true;
    return { c, i, w: d ?? (placed ? Infinity : -Infinity) };
  });
  items.sort((a, b) => a.w - b.w || a.i - b.i);
  return (
    <StageCtx.Provider value={{ ground, focus, fade, t }}>
      {items.map((s, k) => (
        <React.Fragment key={k}>{s.c}</React.Fragment>
      ))}
    </StageCtx.Provider>
  );
};

/** Anything at a depth: furniture, a prop, your own SVG. It dims and softens like a character at that depth. */
export const StageItem: React.FC<{ depth: number; children: React.ReactNode }> = ({ depth, children }) => <AtDepth w={depth}>{children}</AtDepth>;

const spotOf = (at: Place, ground?: Ground): { x: number; y: number; scale: number } => {
  if ('u' in at) {
    if (!ground) throw new Error('at={{ u, w }} needs <Stage ground={...}>; pass at={{ x, y, scale }} when there is no ground');
    return ground.project(at.u, at.w);
  }
  return { x: at.x, y: at.y, scale: at.scale ?? 1 };
};

/** The lowest foot below the hips for this pose: whatever the legs do, the feet end up on the ground. */
const feetBelowHips = (pose: PersonPose, b: Body): number => {
  const j = jointsOf(pose, b);
  return Math.max(j.legL.end.y, j.legR.end.y);
};

const Shadow: React.FC<{ x: number; y: number; scale: number; lift?: number }> = ({ x, y, scale, lift = 0 }) => (
  <ellipse cx={x} cy={y + 4 * scale} rx={70 * scale} ry={13 * scale} fill="#000" opacity={0.28 * Math.max(0.3, 1 - lift / 120)} />
);

/**
 * A character on the stage. `body` sets the proportions and so the height ('adult', 'teen', or your own defineBody);
 * a cast() character brings its own. `stance` is the lower body ('sit', 'kneel', 'crouch'; `seated` is the same as 'sit').
 * `act` names a gesture or a clip (with `from` and `dur` for a clip) and needs <Stage t={t}>. `pose` overrides anything.
 * The feet stay on the ground by themselves. The position comes from `at`, not from the pose.
 */
export const Staged: React.FC<{
  at: Place;
  look?: PersonLook;
  pose?: Partial<Pose>;
  yaw?: number;
  body?: Body | BodyId;
  height?: number;
  seated?: boolean;
  stance?: Stance;
  act?: ActName;
  from?: number;
  dur?: number;
  rimId?: string;
  headGear?: React.ReactNode;
  torsoGear?: React.ReactNode;
  handLProp?: React.ReactNode;
  handRProp?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ at, look = LOOKS.pipHood as PersonLook, pose = {}, yaw, body, height = 1, seated = false, stance, act, from, dur, children, ...rest }) => {
  const { ground, t } = React.useContext(StageCtx);
  const spot = spotOf(at, ground);
  const b = bodyOf(body ?? (look as { cast?: { body?: Body | BodyId } }).cast?.body);
  const y0 = yaw ?? (pose as { yaw?: number }).yaw ?? 0;
  let bits: ActBits = {};
  if (act) {
    if (t === undefined) throw new Error(`act="${act}" needs the clock: write <Stage t={t} ...>`);
    bits = actOf(act, t, { from, dur, yaw: y0, amp: b.amp, tempo: b.tempo });
  }
  const { lift = 0, ...limbs } = bits;
  const scale = spot.scale * height;
  const full = { ...basePose, ...STANCES[seated ? 'sit' : stance ?? 'stand'], ...limbs, ...pose, yaw: y0, x: spot.x, y: 0, scale } as unknown as PersonPose;
  full.y = spot.y - (feetBelowHips(full, b) + lift) * scale;
  return (
    <AtDepth w={at.w ?? 0.5}>
      <Shadow x={spot.x} y={spot.y} scale={scale} lift={lift} />
      <Person look={look} body={b} shadow={0} {...rest} pose={full}>
        {children}
      </Person>
    </AtDepth>
  );
};

type DuoSide = { at: { u: number; w: number }; look?: PersonLook; body?: Body | BodyId; pose?: Partial<Pose>; rimId?: string };
export type DuoAction = 'handshake' | 'give' | 'hug' | 'push' | 'whisper';
const DUO_DUR: Record<DuoAction, number> = { handshake: 44, give: 42, hug: 54, push: 32, whisper: 48 };
const ramp = (p: number, a: number, b: number) => {
  const v = Math.max(0, Math.min(1, (p - a) / Math.max(1e-6, b - a)));
  return v * v * (3 - 2 * v);
};
const mix = (a: { x: number; y: number }, b: { x: number; y: number }, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/**
 * Two people doing something together: their hands find each other, whatever their bodies and positions. `a` and `b`
 * stand on the ground, facing each other unless their pose says otherwise. `prop` is the object passed by 'give'.
 * Needs <Stage t={t}>. The action starts at frame `from`.
 */
export const Duo: React.FC<{ a: DuoSide; b: DuoSide; action: DuoAction; from?: number; dur?: number; prop?: React.ReactNode }> = ({ a, b, action, from = 0, dur, prop }) => {
  const { ground, t } = React.useContext(StageCtx);
  if (t === undefined) throw new Error('<Duo> needs the clock: write <Stage t={t} ...>');
  const f = Math.max(0, t - from);
  const p = Math.min(1, f / (dur ?? DUO_DUR[action]));
  const setup = (s: DuoSide, other: DuoSide) => {
    const spot = spotOf(s.at, ground);
    const there = spotOf(other.at, ground);
    const dir: 1 | -1 = there.x >= spot.x ? 1 : -1;
    const bd = bodyOf(s.body ?? (s.look as { cast?: { body?: Body | BodyId } } | undefined)?.cast?.body);
    const pose = { ...basePose, yaw: dir * 0.7, ...s.pose, x: spot.x, y: 0, scale: spot.scale } as unknown as PersonPose;
    pose.y = spot.y - feetBelowHips(pose, bd) * spot.scale;
    const near: 'L' | 'R' = pose.yaw < 0 ? 'L' : 'R';
    return { s, spot, dir, bd, pose, near };
  };
  const A = setup(a, b);
  const B = setup(b, a);
  // too far apart to touch: each takes a step toward the other at the start of the action
  const reach = ({ handshake: 220, give: 240, hug: 86, push: 170, whisper: 155 } as const)[action] * ((A.spot.scale + B.spot.scale) / 2);
  const closer = (Math.max(0, Math.abs(B.pose.x - A.pose.x) - reach) / 2) * ramp(p, 0, 0.2);
  A.pose.x += A.dir * closer;
  B.pose.x += B.dir * closer;
  const chest = (X: typeof A) => ({ x: X.pose.x, y: X.pose.y + X.bd.shoulder.y * 0.72 * X.pose.scale });
  const meet = mix(chest(A), chest(B), 0.5);
  const armTo = (X: typeof A, target: { x: number; y: number }, k: number, side = X.near) => {
    const rest = handOf(X.pose, side, X.bd);
    const limb = ikArmOf(X.pose, mix(rest, target, k), side, X.bd);
    X.pose = { ...X.pose, ...(side === 'L' ? { armL: limb } : { armR: limb }) };
  };
  let propAt: { x: number; y: number } | null = null;
  if (action === 'handshake') {
    const k = ramp(p, 0, 0.25) * (1 - ramp(p, 0.85, 1));
    const shake = Math.sin(f * 0.9) * 8 * A.spot.scale * ramp(p, 0.2, 0.3) * (1 - ramp(p, 0.75, 0.85));
    const m = { x: meet.x, y: meet.y + shake };
    armTo(A, m, k);
    armTo(B, m, k);
    A.pose.expr = B.pose.expr = 'happy';
  } else if (action === 'give') {
    armTo(A, meet, ramp(p, 0, 0.4) * (1 - ramp(p, 0.65, 0.95)));
    armTo(B, meet, ramp(p, 0.28, 0.55) * (1 - ramp(p, 0.72, 1) * 0.55));
    propAt = handOf(p < 0.5 ? A.pose : B.pose, p < 0.5 ? A.near : B.near, p < 0.5 ? A.bd : B.bd);
  } else if (action === 'hug') {
    const k = ramp(p, 0, 0.3) * (1 - ramp(p, 0.85, 1));
    for (const [X, Y] of [[A, B], [B, A]] as const) {
      // past the other person's chest: the arms go round, the body drawn after covers them
      const shoulder = { x: Y.pose.x + X.dir * 34 * Y.pose.scale, y: Y.pose.y + Y.bd.shoulder.y * Y.pose.scale };
      armTo(X, shoulder, k, 'L');
      armTo(X, shoulder, k, 'R');
      X.pose = { ...X.pose, tilt: 7 * k * X.dir, expr: 'happy' };
    }
  } else if (action === 'push') {
    const strike = ramp(p, 0.22, 0.42) * (1 - ramp(p, 0.65, 1));
    armTo(A, chest(B), strike);
    A.pose = { ...A.pose, tilt: (-8 * ramp(p, 0, 0.22) * (1 - ramp(p, 0.22, 0.3)) + 12 * strike) * A.dir };
    const hit = ramp(p, 0.36, 0.8);
    B.pose = { ...B.pose, x: B.pose.x + A.dir * 90 * B.pose.scale * hit, tilt: -14 * B.dir * hit * (1 - ramp(p, 0.8, 1) * 0.6), expr: p > 0.34 ? 'shock' : B.pose.expr, armL: { a: 10 + 60 * hit, b: 12 + 28 * hit }, armR: { a: 10 + 60 * hit, b: 12 + 28 * hit } };
  } else {
    const k = ramp(p, 0, 0.25) * (1 - ramp(p, 0.85, 1));
    const headA = { x: A.pose.x + A.dir * 66 * A.pose.scale, y: A.pose.y + (A.bd.shoulder.y - 44) * A.pose.scale };
    A.pose = { ...A.pose, tilt: 11 * k * A.dir, talk: k * (Math.sin(f * 0.62) * 0.5 + 0.5) };
    armTo(A, headA, k);
    B.pose = { ...B.pose, tilt: 4 * k * B.dir, headTilt: 7 * k * B.dir, look: B.dir * 0.8 * k };
  }
  const order = [A, B].sort((x, y) => x.s.at.w - y.s.at.w);
  return (
    <g>
      {order.map((X, i) => (
        <AtDepth key={i} w={X.s.at.w}>
          <Shadow x={X.pose.x} y={X.spot.y} scale={X.pose.scale} />
          <Person look={X.s.look ?? (LOOKS.pipHood as PersonLook)} body={X.bd} shadow={0} rimId={X.s.rimId} pose={X.pose} />
        </AtDepth>
      ))}
      {propAt && prop ? <g transform={`translate(${propAt.x} ${propAt.y})`}>{prop}</g> : null}
    </g>
  );
};
