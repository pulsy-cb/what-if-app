import React from 'react';
import type { Room } from './room';
import { basePose, LOOKS } from './rig';
import { Person, bodyOf, legDrop } from './person';
import type { Body, BodyId, PersonLook, PersonPose } from './person';
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

type Ctx = { ground?: Ground; focus?: number; fade: number };
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
  return typeof p.depth === 'number' ? p.depth : undefined;
};

/**
 * `ground`: how positions map to the screen. `focus`: the depth (w) that stays sharp; omit it to keep everything sharp.
 * `fade`: how much far things dim (0 for none).
 */
export const Stage: React.FC<{ ground?: Ground; focus?: number; fade?: number; children: React.ReactNode }> = ({ ground, focus, fade = 1, children }) => {
  let placed = false;
  const items = flatten(children).map((c, i) => {
    const d = declaredDepth(c);
    if (d !== undefined) placed = true;
    return { c, i, w: d ?? (placed ? Infinity : -Infinity) };
  });
  items.sort((a, b) => a.w - b.w || a.i - b.i);
  return (
    <StageCtx.Provider value={{ ground, focus, fade }}>
      {items.map((s, k) => (
        <React.Fragment key={k}>{s.c}</React.Fragment>
      ))}
    </StageCtx.Provider>
  );
};

/** Anything at a depth: furniture, a prop, your own SVG. It dims and softens like a character at that depth. */
export const StageItem: React.FC<{ depth: number; children: React.ReactNode }> = ({ depth, children }) => <AtDepth w={depth}>{children}</AtDepth>;

/**
 * A character on the stage. `body` sets the proportions and so the height ('adult', 'teen', or your own defineBody).
 * `seated` drops the hips to chair height with the thighs forward. `height` scales the whole person further if needed.
 * Everything else is the same as <Person>: the position comes from `at`, not from the pose.
 */
export const Staged: React.FC<{
  at: Place;
  look?: PersonLook;
  pose?: Partial<Pose>;
  body?: Body | BodyId;
  height?: number;
  seated?: boolean;
  rimId?: string;
  headGear?: React.ReactNode;
  torsoGear?: React.ReactNode;
  handLProp?: React.ReactNode;
  handRProp?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ at, look = LOOKS.pipHood as PersonLook, pose = {}, body, height = 1, seated = false, children, ...rest }) => {
  const { ground } = React.useContext(StageCtx);
  let spot: { x: number; y: number; scale: number };
  if ('u' in at) {
    if (!ground) throw new Error('<Staged at={{ u, w }}> needs <Stage ground={...}>; pass at={{ x, y, scale }} when there is no ground');
    spot = ground.project(at.u, at.w);
  } else {
    spot = { x: at.x, y: at.y, scale: at.scale ?? 1 };
  }
  const scale = spot.scale * height;
  const b = bodyOf(body ?? (look as { cast?: { body?: Body | BodyId } }).cast?.body);
  const y = spot.y - legDrop(b, seated) * scale;
  const seat: Partial<Pose> = seated ? { legL: { a: 78, b: -78 }, legR: { a: 74, b: -74 } } : {};
  return (
    <AtDepth w={at.w ?? 0.5}>
      <ellipse cx={spot.x} cy={spot.y + 4 * scale} rx={70 * scale} ry={13 * scale} fill="#000" opacity={0.28} />
      <Person look={look} body={b} shadow={0} {...rest} pose={{ ...basePose, ...seat, ...pose, x: spot.x, y, scale } as unknown as PersonPose}>
        {children}
      </Person>
    </AtDepth>
  );
};
