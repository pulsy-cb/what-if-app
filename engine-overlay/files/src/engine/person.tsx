import React from 'react';
import { C, LOOKS, basePose } from './rig';
import { foldYaw, viewOf, ViewHead } from './views';
import { HairLayer } from './hair';
import { FaceParts } from './face-parts';
import { OutfitTorso, Skirt } from './wardrobe';
import type { Character } from './cast';

// A person: the rig redrawn from measurements instead of constants, so a body is data and the views of the body are
// handled in one place. An adult seen from the front is the same drawing as <Hero>. What differs from <Hero>:
//   - `body` chooses the proportions (BODIES, or your own with defineBody);
//   - arms reach forward in the direction the person faces when they are in profile, not out to their own side;
//   - a leg pointing toward or away from the camera (seated, from the front or from behind) is foreshortened.
// It takes the same pose as <Hero>, so poseAt, faceAt and actPose work unchanged. For hands and props use the versions
// that know the body: handOf, ikArmOf, reachOf, grabOf.

// The shapes read from the rig, declared here (not imported) so this file compiles against every engine copy.
type Limb = { a: number; b: number };
type HandKind = 'open' | 'point';
type Expr = 'neutral' | 'happy' | 'smug' | 'shock' | 'worried' | 'oops' | 'cool' | 'dizzy' | 'tired';
export type PersonLook = {
  skin: string; skinShade: string; hand: string; jacket: string; jacketShade: string; accent: string; limb: string; line: string;
  shoe: string; face: string; hair: string; extra?: string; accessory?: string;
};
type Look = PersonLook;
export type PersonPose = {
  x: number; y: number; scale: number; facing: 1 | -1; tilt: number; spin: number; headTilt: number; armL: Limb; armR: Limb; legL: Limb; legR: Limb;
  expr: string; blink: number; look: number; glasses: number; yaw: number; squash: number; handL: string; handR: string; sway: number;
  talk?: number; glint?: number; glintColor?: string;
};
type P = { x: number; y: number };
const HEAD = { x: 0, y: -176, r: 62 };

/** Proportions in the rig's units (hips at 0,0). Height, head to soles, follows from them: an adult is 378. */
export type Body = {
  /** head radius relative to an adult's */ head: number;
  /** torso width and height relative to an adult's */ chest: number; torso: number;
  /** extra depth of the belly in profile, in units */ belly: number;
  shoulder: P; hip: number; upperArm: number; foreArm: number; thigh: number; shin: number;
  /** width of the arms and of the legs */ arm: number; leg: number;
  /** how it moves, relative to an adult */ amp?: number; tempo?: number;
};
export type BodyId = 'adult' | 'teen';
export const BODIES: Record<BodyId, Body> = {
  adult: { head: 1, chest: 1, torso: 1, belly: 0, shoulder: { x: 42, y: -108 }, hip: 17, upperArm: 62, foreArm: 58, thigh: 72, shin: 68, arm: 11, leg: 12 },
  teen: { head: 0.98, chest: 0.88, torso: 0.93, belly: 0, shoulder: { x: 37, y: -100 }, hip: 15, upperArm: 58, foreArm: 54, thigh: 66, shin: 62, arm: 10, leg: 11, amp: 1.1, tempo: 1.08 },
};
/** Your own proportions from a base body: defineBody('adult', { chest: 1.25, belly: 16, arm: 14, leg: 15 }). */
export const defineBody = (base: BodyId, over: Partial<Body>): Body => ({ ...BODIES[base], ...over });
export const bodyOf = (b?: Body | BodyId): Body => (typeof b === 'string' ? BODIES[b] : b ?? BODIES.adult);
/** How far below the hips the soles are, standing or seated with the thighs forward. */
export const legDrop = (b: Body, seated: boolean): number => (seated ? b.thigh * 0.21 + b.shin : b.thigh + b.shin);

const normalizeLimb = (limb: Limb | undefined | null, isLeg: boolean): Limb => {
  if (!limb || typeof limb.a !== 'number' || typeof limb.b !== 'number') {
    return isLeg ? { a: 5, b: 0 } : { a: 10, b: -8 };
  }
  let { a, b } = limb;
  if (!isLeg) {
    if ((a < -14 && b < -4) || a < -28 || a + b < -95) {
      a = Math.abs(a);
      b = Math.abs(b);
    } else if (a >= 20 && b < -20) {
      b = Math.abs(b);
    }
    // Prevent stiff, hyper-extended stick arms when an arm is raised to gesture, point, or hold an object
    if (a > 26 && a < 132 && b > -12 && b < 28) {
      b = 28 + (a - 26) * 0.18;
    }
    a = Math.max(-25, Math.min(160, a));
    b = Math.max(-70, Math.min(125, b));
    if (a + b > 235) b = 235 - a;
    if (a + b < -80) b = -80 - a;
    return { a, b };
  }
  if (b > 12) b = -Math.abs(b);
  a = Math.max(-65, Math.min(95, a));
  b = Math.max(-110, Math.min(8, b));
  return { a, b };
};

const rad = (d: number) => (d * Math.PI) / 180;
const rot = (p: P, deg: number, c: P = { x: 0, y: 0 }): P => {
  const r = rad(deg);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const limbSpread = (yaw: number) => 1 - 0.85 * Math.min(1, foldYaw(yaw));
const turnWidth = (yaw: number) => 1 - 0.4 * Math.min(1, foldYaw(yaw));
const shoulderShift = (yaw: number) => Math.sign(yaw) * foldYaw(yaw) * 6;

/** The direction the person faces: from yaw as soon as they are turned, so yaw alone is enough (facing only matters face-on). */
const forward = (pose: PersonPose): 1 | -1 => (pose.yaw > 0 ? 1 : pose.yaw < 0 ? -1 : pose.facing);

/** Which way an arm's angle swings on screen: out to its own side face-on, forward in the facing direction in profile. */
const armDir = (s: 1 | -1, pose: PersonPose): number => {
  // reaches forward early: at three-quarter the far arm already swings forward instead of pointing into the screen
  const f = clamp01(foldYaw(pose.yaw) * 1.8);
  return s * (1 - f) + forward(pose) * f;
};
/** A leg that swings toward or away from the camera shortens on screen; a natural stance (small angles) is left alone. */
const legSwing = (a: number, pose: PersonPose): number => {
  const big = clamp01((Math.abs(a) - 25) / 35);
  return 1 + (foldYaw(pose.yaw) - 1) * big;
};

/** Joint positions in local space (before the hip translate and scale), for this body. */
export const jointsOf = (pose: PersonPose, b: Body = BODIES.adult) => {
  const arm = (s: 1 | -1, raw: Limb, root: P) => {
    const limb = normalizeLimb(raw, false);
    const dir = armDir(s, pose);
    const d1 = { x: dir * Math.sin(rad(limb.a)), y: Math.cos(rad(limb.a)) };
    const mid = { x: root.x + d1.x * b.upperArm, y: root.y + d1.y * b.upperArm };
    const a2 = limb.a + limb.b;
    const d2 = { x: dir * Math.sin(rad(a2)), y: Math.cos(rad(a2)) };
    return { root, mid, end: { x: mid.x + d2.x * b.foreArm, y: mid.y + d2.y * b.foreArm } };
  };
  const leg = (raw: Limb, root: P) => {
    const limb = normalizeLimb(raw, true);
    const k1 = legSwing(limb.a, pose);
    const d1 = { x: forward(pose) * Math.sin(rad(limb.a)) * k1, y: Math.cos(rad(limb.a)) };
    const mid = { x: root.x + d1.x * b.thigh, y: root.y + d1.y * b.thigh };
    const a2 = limb.a + limb.b;
    const k2 = legSwing(a2, pose);
    const d2 = { x: forward(pose) * Math.sin(rad(a2)) * k2, y: Math.cos(rad(a2)) };
    return { root, mid, end: { x: mid.x + d2.x * b.shin, y: mid.y + d2.y * b.shin } };
  };
  const torsoRot = (p: P) => rot(p, pose.tilt);
  const sp = limbSpread(pose.yaw);
  const shift = shoulderShift(pose.yaw);
  const armL = arm(-1, pose.armL, { x: -b.shoulder.x * sp + shift, y: b.shoulder.y });
  const armR = arm(1, pose.armR, { x: b.shoulder.x * sp + shift, y: b.shoulder.y });
  const legL = leg(pose.legL, { x: -b.hip * sp, y: 0 });
  const legR = leg(pose.legR, { x: b.hip * sp, y: 0 });
  const r = (o: { root: P; mid: P; end: P }) => ({ root: torsoRot(o.root), mid: torsoRot(o.mid), end: torsoRot(o.end) });
  return { armL: r(armL), armR: r(armR), legL, legR };
};

const toWorld = (pose: PersonPose, p: P): P => {
  const spun = rot(p, pose.spin, { x: 0, y: -90 });
  return { x: pose.x + spun.x * pose.scale, y: pose.y + spun.y * pose.scale };
};

/** World position of a hand, for this body: attach props here. */
export const handOf = (pose: PersonPose, side: 'R' | 'L' = 'R', body?: Body | BodyId): P => {
  const j = jointsOf(pose, bodyOf(body));
  return toWorld(pose, side === 'L' ? j.armL.end : j.armR.end);
};

/** The arm angles that bring a hand to a world point, for this body and view. */
export const ikArmOf = (pose: PersonPose, target: P, side: 'R' | 'L' = 'R', body?: Body | BodyId): Limb => {
  const b = bodyOf(body);
  const s: 1 | -1 = side === 'L' ? -1 : 1;
  const shLocal = rot({ x: s * b.shoulder.x * limbSpread(pose.yaw) + shoulderShift(pose.yaw), y: b.shoulder.y }, pose.tilt);
  const sh = toWorld(pose, shLocal);
  const sc = Math.max(0.2, pose.scale);
  // on screen the swing is scaled by armDir: undo that so the solve happens in the arm's own plane
  const raw = armDir(s, pose);
  const dir = Math.abs(raw) < 0.35 ? (raw < 0 ? -0.35 : 0.35) : raw;
  const dx = (target.x - sh.x) / sc / dir;
  const dy = (target.y - sh.y) / sc;
  const l1 = b.upperArm;
  const l2 = b.foreArm;
  const maxReach = (l1 + l2) * 0.92;
  const d = Math.max(26, Math.min(maxReach, Math.hypot(dx, dy)));
  const cosElbow = Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)));
  const elbow = Math.max(28, Math.min(115, 180 - (Math.acos(cosElbow) * 180) / Math.PI));
  const cosAlpha = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const alpha = (Math.acos(cosAlpha) * 180) / Math.PI;
  const targetAng = (Math.atan2(dx, dy) * 180) / Math.PI;
  return normalizeLimb({ a: targetAng - alpha - pose.tilt, b: elbow }, false);
};

/** Pose partial that brings the near or named hand to a world point. */
export const reachOf = (pose: PersonPose, target: P, side?: 'R' | 'L', body?: Body | BodyId): Partial<PersonPose> => {
  const effSide: 'R' | 'L' = side ?? (target.x < pose.x - 18 ? 'L' : target.x > pose.x + 18 ? 'R' : pose.facing < 0 ? 'L' : 'R');
  const limb = ikArmOf(pose, target, effSide, body);
  return effSide === 'L' ? { armL: limb } : { armR: limb };
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Pick an object up and move it: same as grabAt, for this body. */
export const grabOf = (
  t: number,
  pose: PersonPose,
  from: P,
  to: P,
  fPick = 10,
  fPlace = 28,
  side?: 'R' | 'L',
  bodyIn?: Body | BodyId,
): { arm: Limb; pose: Partial<PersonPose>; propPos: P; handPos: P; side: 'R' | 'L' } => {
  const midX = (from.x + to.x) * 0.5;
  const effSide: 'R' | 'L' =
    side ?? (midX < pose.x - 18 ? 'L' : midX > pose.x + 18 ? 'R' : (pose.facing < 0 ? 'L' : 'R'));
  const restTarget: P = {
    x: pose.x + (effSide === 'L' ? -65 : 65) * pose.scale,
    y: pose.y - 38 * pose.scale,
  };
  let handTarget: P;
  if (t < fPick) {
    const u = easeInOut(Math.max(0, Math.min(1, t / Math.max(1, fPick))));
    handTarget = { x: lerp(restTarget.x, from.x, u), y: lerp(restTarget.y, from.y, u) };
  } else if (t <= fPlace) {
    const u = easeInOut(Math.max(0, Math.min(1, (t - fPick) / Math.max(1, fPlace - fPick))));
    const lift = Math.sin(u * Math.PI) * 34 * pose.scale;
    handTarget = { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) - lift };
  } else {
    const u = easeInOut(Math.max(0, Math.min(1, (t - fPlace) / 14)));
    const settle = { x: to.x + (effSide === 'L' ? -28 : 28) * pose.scale, y: to.y - 14 * pose.scale };
    handTarget = { x: lerp(to.x, settle.x, u), y: lerp(to.y, settle.y, u) };
  }
  const arm = ikArmOf(pose, handTarget, effSide, bodyIn);
  const armPose = effSide === 'L' ? { armL: arm } : { armR: arm };
  const posed = { ...pose, ...armPose } as PersonPose;
  const handPos = handOf(posed, effSide, bodyIn);
  const propPos = t < fPick ? from : t <= fPlace ? handPos : to;
  return { arm, pose: armPose, propPos, handPos, side: effSide };
};

const Face: React.FC<{
  expr: string;
  blink: number;
  look: number;
  glasses: number;
  yaw?: number;
  ink?: string;
  glint?: number;
  glintColor?: string;
  talk?: number;
  eyeR?: [number, number];
  browW?: number;
}> = ({ expr, blink, look, glasses, yaw = 0, ink = C.ink, glint = 0, glintColor = '#8FF0FF', talk = 0, eyeR, browW = 5 }) => {
  const ex = look * 7;
  const ay = Math.min(1, Math.abs(yaw));
  const farHidden = ay > 0.72;
  const farSide = yaw > 0 ? -1 : 1; // facing screen-right hides the screen-left eye
  const eyeY = HEAD.y - 4;
  // heavy lids: half shut when smug or cool, more than half when tired (with dark rings under the eyes)
  const lid = expr === 'smug' || expr === 'cool' ? 0.45 : expr === 'tired' ? 0.58 : 0;
  const open = Math.max(0.08, 1 - Math.max(blink, lid));
  const eye = (cx: number) => {
    if (farHidden && Math.sign(cx) === farSide) return null;
    if (expr === 'happy') return <path d={`M ${cx - 10} ${eyeY + 3} Q ${cx} ${eyeY - 9} ${cx + 10} ${eyeY + 3}`} stroke={ink} strokeWidth={6} fill="none" strokeLinecap="round" />;
    if (expr === 'oops') return <path d={`M ${cx - 9} ${eyeY - 6} L ${cx + 4} ${eyeY} L ${cx - 9} ${eyeY + 6}`} transform={cx > 0 ? `translate(${2 * cx},0) scale(-1,1)` : undefined} stroke={ink} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    if (expr === 'dizzy') return <g stroke={ink} strokeWidth={5} strokeLinecap="round"><path d={`M ${cx - 7} ${eyeY - 7} L ${cx + 7} ${eyeY + 7} M ${cx + 7} ${eyeY - 7} L ${cx - 7} ${eyeY + 7}`} /></g>;
    // shut (a blink's middle frame, or asleep): the closed lid's curve, with the tired rings kept
    if (blink >= 0.95)
      return (
        <g>
          <path d={`M ${cx - 12} ${eyeY + 1} Q ${cx} ${eyeY + 8} ${cx + 12} ${eyeY + 1}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />
          {expr === 'tired' ? <path d={`M ${cx - 12} ${eyeY + 15} Q ${cx} ${eyeY + 22} ${cx + 12} ${eyeY + 15}`} stroke="#8C7AA6" strokeWidth={4.5} fill="none" strokeLinecap="round" opacity={0.85} /> : null}
        </g>
      );
    const big = expr === 'shock';
    const rx = big ? 11 : eyeR?.[0] ?? 7;
    const ry = (big ? 13 : eyeR?.[1] ?? 10) * open;
    return (
      <g>
        <ellipse cx={cx + ex} cy={eyeY + (lid ? 3 : 0)} rx={rx} ry={ry} fill={ink} />
        {big && open > 0.5 ? <circle cx={cx + ex + 3.5} cy={eyeY - 4} r={3.4} fill="#fff" /> : null}
        {lid ? <path d={expr === 'tired' ? `M ${cx - 13} ${eyeY - 1} Q ${cx} ${eyeY - 5} ${cx + 13} ${eyeY - 1}` : `M ${cx - 12} ${eyeY - 4} L ${cx + 12} ${eyeY - 2}`} stroke={ink} strokeWidth={4} strokeLinecap="round" fill="none" /> : null}
        {expr === 'tired' ? <path d={`M ${cx - 12} ${eyeY + 14} Q ${cx} ${eyeY + 21} ${cx + 12} ${eyeY + 14}`} stroke="#8C7AA6" strokeWidth={4.5} fill="none" strokeLinecap="round" opacity={0.85} /> : null}
      </g>
    );
  };
  const brows: Record<string, string> = {
    neutral: '',
    happy: '',
    smug: `M -34 ${eyeY - 22} L -12 ${eyeY - 20} M 12 ${eyeY - 26} L 34 ${eyeY - 30}`,
    shock: `M -32 ${eyeY - 28} Q -21 ${eyeY - 36} -10 ${eyeY - 29} M 10 ${eyeY - 29} Q 21 ${eyeY - 36} 32 ${eyeY - 28}`,
    worried: `M -32 ${eyeY - 18} L -12 ${eyeY - 26} M 12 ${eyeY - 26} L 32 ${eyeY - 18}`,
    oops: `M -32 ${eyeY - 20} L -12 ${eyeY - 16} M 12 ${eyeY - 16} L 32 ${eyeY - 20}`,
    cool: '',
    dizzy: '',
    tired: `M -33 ${eyeY - 17} Q -22 ${eyeY - 21} -11 ${eyeY - 19} M 11 ${eyeY - 19} Q 22 ${eyeY - 21} 33 ${eyeY - 17}`,
  };
  const mY = HEAD.y + 28;
  const mouthOpen = Math.max(0, Math.min(1, talk));
  const mouth: Record<string, React.ReactNode> = {
    neutral: <path d={`M -10 ${mY} Q 0 ${mY + 4} 10 ${mY}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    happy: <path d={`M -18 ${mY - 4} Q 0 ${mY + 20} 18 ${mY - 4} Z`} fill={ink} />,
    smug: <path d={`M -12 ${mY + 2} Q 4 ${mY + 8} 16 ${mY - 6}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    shock: <ellipse cx={0} cy={mY + 4} rx={10} ry={14} fill={ink} />,
    worried: <path d={`M -16 ${mY + 4} Q -8 ${mY - 4} 0 ${mY + 4} Q 8 ${mY + 12} 16 ${mY + 4}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    oops: <g><rect x={-18} y={mY - 6} width={36} height={16} rx={6} fill={ink} /><path d={`M -14 ${mY + 2} L 14 ${mY + 2}`} stroke="#fff" strokeWidth={3} /></g>,
    cool: <path d={`M -12 ${mY + 2} Q 4 ${mY + 8} 16 ${mY - 6}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    dizzy: <path d={`M -14 ${mY + 4} Q -7 ${mY - 4} 0 ${mY + 4} Q 7 ${mY + 12} 14 ${mY + 4}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    tired: <path d={`M -11 ${mY + 4} Q 0 ${mY} 11 ${mY + 4}`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
  };
  const talkingMouth =
    mouthOpen > 0.16 && expr !== 'oops' ? (
      <g>
        <ellipse cx={0} cy={mY + 2} rx={9 + mouthOpen * 6} ry={3 + mouthOpen * 10} fill={ink} />
        {mouthOpen > 0.42 ? <ellipse cx={0} cy={mY + 5 + mouthOpen * 3} rx={5 + mouthOpen * 3} ry={2.5 + mouthOpen * 2.5} fill="#E06A6A" /> : null}
      </g>
    ) : (
      mouth[expr]
    );
  return (
    <g transform={`translate(${yaw * 30} 0) scale(${1 - 0.28 * ay} 1)`}>
      {eye(-21)}
      {eye(21)}
      {brows[expr] ? <path d={brows[expr]} stroke={ink} strokeWidth={browW} fill="none" strokeLinecap="round" /> : null}
      {talkingMouth}
      {expr === 'shock' || expr === 'oops' ? <path d={`M 52 ${HEAD.y - 30} q 6 10 0 16 q -6 -6 0 -16 Z`} fill="#8FD3FF" /> : null}
      {/* a power lighting the eyes: a soft halo, a bright iris, a white catchlight (none while the lids are shut) */}
      {glint > 0.01 && blink < 0.95
        ? [-21, 21].map((cx) =>
            farHidden && Math.sign(cx) === farSide ? null : (
              <g key={`gl${cx}`} opacity={Math.min(1, glint)}>
                <circle cx={cx + ex} cy={eyeY} r={17} fill={glintColor} opacity={0.2} />
                <circle cx={cx + ex} cy={eyeY} r={12} fill={glintColor} opacity={0.28} />
                <ellipse cx={cx + ex} cy={eyeY + (lid ? 3 : 0)} rx={8} ry={Math.max(2, 11 * open)} fill={glintColor} />
                <circle cx={cx + ex + 2.5} cy={eyeY - 3} r={2.6} fill="#FFFFFF" />
              </g>
            ),
          )
        : null}
      {glasses > 0.01 ? (
        <g opacity={glasses} transform={`translate(0 ${(1 - glasses) * -60})`}>
          {/* classic shades: a full bar across, two big lenses, one bright glint so it reads at feed size */}
          <path d={`M -58 ${eyeY - 12} L 58 ${eyeY - 12}`} stroke={ink} strokeWidth={6} strokeLinecap="round" />
          <path d={`M -50 ${eyeY - 14} L -6 ${eyeY - 14} L -10 ${eyeY + 8} Q -28 ${eyeY + 18} -46 ${eyeY + 8} Z`} fill="#0D0F1C" stroke={ink} strokeWidth={3} />
          <path d={`M 6 ${eyeY - 14} L 50 ${eyeY - 14} L 46 ${eyeY + 8} Q 28 ${eyeY + 18} 10 ${eyeY + 8} Z`} fill="#0D0F1C" stroke={ink} strokeWidth={3} />
          <path d={`M -40 ${eyeY + 2} L -26 ${eyeY - 10} M 16 ${eyeY + 2} L 30 ${eyeY - 10}`} stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
        </g>
      ) : null}
    </g>
  );
};


/** The front head: the rig's own drawing, hair and gear included. */
const FrontHead: React.FC<{ pose: PersonPose; L: Look; headGear?: React.ReactNode }> = ({ pose, L, headGear }) => {
  const noTuft =
    L.extra === 'bunches' ||
    L.extra === 'bob' ||
    L.extra === 'suit' ||
    L.extra === 'bald' ||
    L.extra === 'cap' ||
    L.extra === 'beanie' ||
    L.extra === 'spiky' ||
    L.extra === 'afro' ||
    L.extra === 'helmet';
  const head = (
    <g transform={`rotate(${pose.tilt}) rotate(${pose.headTilt} 0 ${HEAD.y + 40})`}>
      {L.extra === 'ponytail' ? (
        <g transform={`rotate(${pose.sway * 0.6} ${-pose.facing * 52} ${HEAD.y - 18})`}>
          <path
            d={`M ${-pose.facing * 48} ${HEAD.y - 24} Q ${-pose.facing * 92} ${HEAD.y - 42} ${-pose.facing * 88} ${HEAD.y + 14} Q ${-pose.facing * 64} ${HEAD.y + 8} ${-pose.facing * 48} ${HEAD.y - 10} Z`}
            fill={L.hair}
            stroke={L.line}
            strokeWidth={4}
          />
          <circle cx={-pose.facing * 52} cy={HEAD.y - 18} r={8} fill={L.accent} />
        </g>
      ) : null}
      {L.extra === 'afro' ? (
        <circle cx={HEAD.x - pose.yaw * 8} cy={HEAD.y - 14} r={HEAD.r + 22} fill={L.hair} stroke={L.line} strokeWidth={4} />
      ) : null}
      <circle cx={HEAD.x} cy={HEAD.y} r={HEAD.r} fill={L.skin} stroke={L.line} strokeWidth={4} />
      <path d={`M ${HEAD.x + 14} ${HEAD.y + 58} A ${HEAD.r} ${HEAD.r} 0 0 0 ${HEAD.x + 60} ${HEAD.y + 14} A 70 70 0 0 1 ${HEAD.x + 14} ${HEAD.y + 58} Z`} fill={L.skinShade} />
      {noTuft ? null : (
        <path transform={`translate(${-pose.yaw * 16} 0)`} d={`M -6 ${HEAD.y - 60} q 10 -26 30 -18 q -16 2 -14 16 q -8 -10 -16 2 Z`} fill={L.hair} />
      )}
      {L.extra === 'spiky' ? (
        <path
          transform={`translate(${-pose.yaw * 12} 0)`}
          d={`M -56 ${HEAD.y - 26} L -66 ${HEAD.y - 58} L -36 ${HEAD.y - 52} L -32 ${HEAD.y - 84} L -4 ${HEAD.y - 58} L 16 ${HEAD.y - 88} L 28 ${HEAD.y - 54} L 58 ${HEAD.y - 72} L 54 ${HEAD.y - 28} Q 0 ${HEAD.y - 48} -56 ${HEAD.y - 26} Z`}
          fill={L.hair}
          stroke={L.line}
          strokeWidth={3.5}
          strokeLinejoin="round"
        />
      ) : null}
      {L.extra === 'bunches' ? (
        // a fringe cap and two bunches tied with coral bands; the bunches swing a little with sway
        <g>
          {[-1, 1].map((sd) => (
            <g key={sd} transform={`rotate(${pose.sway * 0.5} ${sd * 58} ${HEAD.y - 30})`}>
              <circle cx={sd * 72 - pose.yaw * 10} cy={HEAD.y - 24} r={24} fill={L.hair} stroke={L.line} strokeWidth={4} />
              <circle cx={sd * 55 - pose.yaw * 10} cy={HEAD.y - 30} r={8} fill={L.accent} />
            </g>
          ))}
          <path transform={`translate(${-pose.yaw * 14} 0)`} d={`M -60 ${HEAD.y - 22} Q -62 ${HEAD.y - 66} 0 ${HEAD.y - 66} Q 62 ${HEAD.y - 66} 60 ${HEAD.y - 22} Q 40 ${HEAD.y - 46} 14 ${HEAD.y - 40} Q 0 ${HEAD.y - 50} -14 ${HEAD.y - 40} Q -40 ${HEAD.y - 46} -60 ${HEAD.y - 22} Z`} fill={L.hair} />
        </g>
      ) : null}
      {L.extra === 'bob' ? (
        // a chin-length bob framing the face, a side parting
        <path
          transform={`translate(${-pose.yaw * 12} 0)`}
          d={`M -74 ${HEAD.y + 34} Q -84 ${HEAD.y - 70} 0 ${HEAD.y - 72} Q 84 ${HEAD.y - 70} 74 ${HEAD.y + 34} L 56 ${HEAD.y + 34} Q 60 ${HEAD.y - 20} 40 ${HEAD.y - 40} Q 10 ${HEAD.y - 34} -16 ${HEAD.y - 48} Q -52 ${HEAD.y - 30} -56 ${HEAD.y + 34} Z`}
          fill={L.hair}
          stroke={L.line}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      ) : null}
      {L.extra === 'suit' ? (
        // short combed-back hair with a hard side parting
        <path transform={`translate(${-pose.yaw * 14} 0)`} d={`M -60 ${HEAD.y - 18} Q -64 ${HEAD.y - 70} 4 ${HEAD.y - 68} Q 64 ${HEAD.y - 64} 60 ${HEAD.y - 18} Q 52 ${HEAD.y - 44} 18 ${HEAD.y - 46} L 12 ${HEAD.y - 54} L 6 ${HEAD.y - 46} Q -44 ${HEAD.y - 46} -60 ${HEAD.y - 18} Z`} fill={L.hair} />
      ) : null}
      {L.extra === 'cap' ? (
        <g transform={`translate(${-pose.yaw * 8} 0)`}>
          <path d={`M -62 ${HEAD.y - 22} A 62 56 0 0 1 62 ${HEAD.y - 22} Z`} fill={L.accent} stroke={L.line} strokeWidth={4} />
          <path d={`M ${pose.facing > 0 ? -10 : -82} ${HEAD.y - 22} L ${pose.facing > 0 ? 82 : 10} ${HEAD.y - 22} Q ${pose.facing * 92} ${HEAD.y - 12} ${pose.facing * 50} ${HEAD.y - 10} L ${pose.facing > 0 ? -10 : -50} ${HEAD.y - 14} Z`} fill={L.jacket} stroke={L.line} strokeWidth={4} />
        </g>
      ) : null}
      {L.extra === 'beanie' ? (
        <g transform={`translate(${-pose.yaw * 8} 0)`}>
          <path d={`M -62 ${HEAD.y - 20} Q -64 ${HEAD.y - 76} 0 ${HEAD.y - 76} Q 64 ${HEAD.y - 76} 62 ${HEAD.y - 20} Z`} fill={L.accent} stroke={L.line} strokeWidth={4} />
          <rect x={-65} y={HEAD.y - 32} width={130} height={18} rx={7} fill={L.jacket} stroke={L.line} strokeWidth={4} />
          <circle cx={0} cy={HEAD.y - 82} r={12} fill={L.accent} stroke={L.line} strokeWidth={3.5} />
        </g>
      ) : null}
      {L.extra === 'helmet' ? (
        <g>
          <path d={`M -68 ${HEAD.y + 8} A 68 68 0 1 1 68 ${HEAD.y + 8} L 54 ${HEAD.y + 28} L -54 ${HEAD.y + 28} Z`} fill={L.accent} stroke={L.line} strokeWidth={4} />
          <rect x={-52} y={HEAD.y - 24} width={104} height={36} rx={12} fill="#1A2639" opacity={0.75} stroke={L.line} strokeWidth={3.5} />
        </g>
      ) : null}
      <Face
        expr={pose.expr}
        blink={pose.blink}
        look={pose.look}
        glasses={L.accessory === 'glasses' ? Math.max(1, pose.glasses) : pose.glasses}
        yaw={pose.yaw}
        ink={L.face}
        glint={pose.glint}
        glintColor={pose.glintColor}
        talk={pose.talk}
        eyeR={(L as Partial<Character>).cast?.eyeR}
        browW={(L as Partial<Character>).cast?.browW}
      />
      {L.accessory === 'beard' ? (
        <path
          transform={`translate(${pose.yaw * 22} 0)`}
          d={`M -44 ${HEAD.y + 14} Q -42 ${HEAD.y + 62} 0 ${HEAD.y + 64} Q 42 ${HEAD.y + 62} 44 ${HEAD.y + 14} Q 22 ${HEAD.y + 30} 0 ${HEAD.y + 28} Q -22 ${HEAD.y + 30} -44 ${HEAD.y + 14} Z`}
          fill={L.hair}
          opacity={0.9}
        />
      ) : null}
      {L.accessory === 'mustache' ? (
        <path
          transform={`translate(${pose.yaw * 26} 0)`}
          d={`M -22 ${HEAD.y + 22} Q -10 ${HEAD.y + 12} 0 ${HEAD.y + 19} Q 10 ${HEAD.y + 12} 22 ${HEAD.y + 22} Q 10 ${HEAD.y + 26} 0 ${HEAD.y + 22} Q -10 ${HEAD.y + 26} -22 ${HEAD.y + 22} Z`}
          fill={L.hair}
        />
      ) : null}
      {L.extra === 'curls'
        ? [-150, -125, -100, -78, -55, -30].map((deg, k) => {
            const a = (deg * Math.PI) / 180;
            return <circle key={k} cx={Math.cos(a) * 54} cy={HEAD.y + Math.sin(a) * 54} r={24} fill={L.hair} />;
          })
        : null}
      {L.accessory === 'headset' || L.accessory === 'headphones' ? (
        <g>
          <path d={`M -62 ${HEAD.y - 4} A 64 64 0 0 1 62 ${HEAD.y - 4}`} stroke={L.accent} strokeWidth={9} fill="none" strokeLinecap="round" />
          <rect x={-74} y={HEAD.y - 20} width={20} height={38} rx={9} fill={L.accent} stroke={L.line} strokeWidth={4} />
          <rect x={54} y={HEAD.y - 20} width={20} height={38} rx={9} fill={L.accent} stroke={L.line} strokeWidth={4} />
          {L.accessory === 'headset' ? (
            <g>
              <path d={`M -62 ${HEAD.y + 12} Q -42 ${HEAD.y + 36} -12 ${HEAD.y + 34}`} stroke={L.line} strokeWidth={5} fill="none" strokeLinecap="round" />
              <circle cx={-10} cy={HEAD.y + 34} r={6} fill={L.accent} stroke={L.line} strokeWidth={3} />
            </g>
          ) : null}
        </g>
      ) : null}
      {headGear}
    </g>
  );
  return head;
};

/** The jacket from the side: a rounded chest, the belly from the body, the collar and tie on the front edge. */
const SideTorso: React.FC<{ L: Look; belly: number }> = ({ L, belly }) => (
  <g>
    <path d={`M -28 -112 Q 4 -124 30 -110 Q ${34 + belly * 0.5} -60 ${28 + belly} -18 Q ${28 + belly} 0 22 4 Q -2 12 -26 2 Q -32 -54 -28 -112 Z`} fill={L.jacket} stroke={L.line} strokeWidth={4} strokeLinejoin="round" />
    <path d="M -28 -112 Q -32 -54 -26 2 Q -18 8 -8 9 Q -14 -50 -10 -117 Z" fill={L.jacketShade} opacity={0.55} />
    <path d="M 6 -117 Q 18 -110 26 -112" stroke={L.accent} strokeWidth={6} fill="none" strokeLinecap="round" />
    {L.extra === 'suit' || L.accessory === 'tie' ? <path d="M 20 -112 L 30 -108 L 33 -66 L 26 -56 L 20 -66 Z" fill={L.accent} stroke={L.line} strokeWidth={3} strokeLinejoin="round" /> : null}
  </g>
);

/** The jacket from behind: no collar, zip or tie. */
const BackTorso: React.FC<{ L: Look }> = ({ L }) => (
  <g>
    <path d="M -46 -112 Q 0 -124 46 -112 L 40 2 Q 0 12 -40 2 Z" fill={L.jacket} stroke={L.line} strokeWidth={4} strokeLinejoin="round" />
    <path d="M 10 -116 Q 30 -114 46 -112 L 40 2 Q 26 8 12 9 Z" fill={L.jacketShade} opacity={0.55} />
    <path d="M 0 -108 L 0 4" stroke={L.jacketShade} strokeWidth={3} opacity={0.7} />
  </g>
);

/** Same pose and slots as <Hero>, plus `body`. */
export const Person: React.FC<{
  pose: PersonPose;
  body?: Body | BodyId;
  look?: Look;
  shadow?: number;
  rimId?: string;
  headGear?: React.ReactNode;
  torsoGear?: React.ReactNode;
  handLProp?: React.ReactNode;
  handRProp?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ pose, body, look = LOOKS.pipHood as Look, shadow = 1, rimId = 'rimR', headGear, torsoGear, handLProp, handRProp, children }) => {
  const c = (look as Partial<Character>).cast;
  const b = bodyOf(body ?? c?.body);
  const j = jointsOf(pose, b);
  const L = look;
  const view = viewOf(pose.yaw);
  const legLen = b.thigh + b.shin;
  // limbs are light with a dark outline, with a smooth quadratic elbow/knee curve and short sleeve cap when bare-armed
  const limb = (o: { root: P; mid: P; end: P }, w: number, sleeve = false, paint?: { limb: string; cap?: string; capTo?: number }) => {
    const limbC = paint?.limb ?? L.limb;
    const capC = paint ? paint.cap : sleeve && L.limb !== L.jacket ? L.jacket : undefined;
    const mx = o.mid.x;
    const my = o.mid.y;
    const p1 = { x: lerp(o.root.x, mx, 0.82), y: lerp(o.root.y, my, 0.82) };
    const p2 = { x: lerp(mx, o.end.x, 0.18), y: lerp(my, o.end.y, 0.18) };
    const d = `M ${o.root.x} ${o.root.y} L ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y} L ${o.end.x} ${o.end.y}`;
    const slEnd = { x: lerp(o.root.x, mx, paint?.capTo ?? 0.46), y: lerp(o.root.y, my, paint?.capTo ?? 0.46) };
    const slD = `M ${o.root.x} ${o.root.y} L ${slEnd.x} ${slEnd.y}`;
    return (
      <g>
        <path d={d} stroke={L.line} strokeWidth={w + 7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} stroke={limbC} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {capC ? (
          <>
            <path d={slD} stroke={L.line} strokeWidth={w + 9} fill="none" strokeLinecap="round" />
            <path d={slD} stroke={capC} strokeWidth={w + 2} fill="none" strokeLinecap="round" />
          </>
        ) : null}
      </g>
    );
  };
  const shoe = (o: { root: P; mid: P; end: P }) => (
    <g>
      {c?.feet.id === 'boots' ? <rect x={o.end.x - 12} y={o.end.y - 26} width={24} height={30} rx={6} fill={L.shoe} stroke={L.line} strokeWidth={4} /> : null}
      <ellipse cx={o.end.x + forward(pose) * 9} cy={o.end.y + 4} rx={22} ry={11} fill={L.shoe} stroke={L.line} strokeWidth={4} />
    </g>
  );
  // a mitten along the forearm: the palm, the thumb toward the body, two knuckle marks; or a pointing fist
  const hand = (o: { mid: P; end: P }, side: 1 | -1, kind: HandKind, prop?: React.ReactNode) => {
    const ang = (Math.atan2(o.end.x - o.mid.x, o.end.y - o.mid.y) * 180) / Math.PI;
    return (
      <g transform={`translate(${o.end.x} ${o.end.y}) rotate(${-ang})`}>
        {kind === 'point' ? (
          <g>
            <rect x={-4} y={10} width={8} height={24} rx={4} fill={L.hand} stroke={L.line} strokeWidth={3.5} />
            <path d="M -11 -2 Q -14 14 -6 18 L 7 18 Q 14 14 11 -2 Z" fill={L.hand} stroke={L.line} strokeWidth={4} strokeLinejoin="round" />
            <ellipse cx={side * 10} cy={6} rx={4.5} ry={7} fill={L.hand} stroke={L.line} strokeWidth={3.5} />
          </g>
        ) : (
          <g>
            <ellipse cx={side * 10} cy={3} rx={5.5} ry={9} transform={`rotate(${side * -28} ${side * 10} 3)`} fill={L.hand} stroke={L.line} strokeWidth={4} />
            <ellipse cx={0} cy={10} rx={11} ry={15} fill={L.hand} stroke={L.line} strokeWidth={4} />
            <path d="M -4 17 L -4 23 M 3 18 L 3 24" stroke={L.line} strokeWidth={2} opacity={0.45} strokeLinecap="round" />
          </g>
        )}
        {prop}
      </g>
    );
  };
  const kw = turnWidth(pose.yaw);
  const sized = `scale(${b.chest} ${b.torso})`;
  const facingFlip = forward(pose) < 0 ? ' scale(-1 1)' : '';
  const torsoFront = (
    <g transform={`rotate(${pose.tilt}) translate(${shoulderShift(pose.yaw)} 0) scale(${kw} 1) ${sized}`}>
      <path d="M -46 -112 Q 0 -124 46 -112 L 40 2 Q 0 12 -40 2 Z" fill={L.jacket} stroke={L.line} strokeWidth={4} strokeLinejoin="round" />
      <path d="M 10 -116 Q 30 -114 46 -112 L 40 2 Q 26 8 12 9 Z" fill={L.jacketShade} opacity={0.55} />
      <path d="M 0 -112 L 0 4" stroke={L.jacketShade} strokeWidth={4} />
      {L.extra === 'suit' || L.accessory === 'tie' ? (
        // a white shirt in the V of the jacket and a tie in the accent colour
        <g>
          <path d="M -24 -116 L 0 -54 L 24 -116 Z" fill="#EDE8DE" />
          <path d="M -7 -112 L 7 -112 L 9 -100 L 5 -64 L 0 -56 L -5 -64 L -9 -100 Z" fill={L.accent} />
          <path d="M -26 -116 L 0 -54 M 26 -116 L 0 -54" stroke={L.line} strokeWidth={4} />
        </g>
      ) : (
        <path d="M -22 -118 Q 0 -100 22 -118" stroke={L.accent} strokeWidth={6} fill="none" strokeLinecap="round" />
      )}
      {L.accessory === 'scarf' ? (
        <g>
          <path d="M -40 -114 Q 0 -98 40 -114 L 38 -96 Q 0 -82 -38 -96 Z" fill={L.accent} stroke={L.line} strokeWidth={3.5} />
          <path d="M 12 -100 L 22 -52 L 6 -50 L 2 -98 Z" fill={L.accent} stroke={L.line} strokeWidth={3.5} />
        </g>
      ) : null}
      {L.accessory === 'badge' ? (
        <g transform="translate(20 -82)">
          <rect x={-10} y={-12} width={20} height={24} rx={3} fill="#F4F6F8" stroke={L.line} strokeWidth={3} />
          <rect x={-7} y={-8} width={14} height={6} fill={L.accent} />
        </g>
      ) : null}
      {torsoGear}
    </g>
  );
  const castView = view === 'profile' ? 'profile' : view === 'back' ? 'back' : 'front';
  const armPaint = !c ? undefined : c.over && c.over.id !== 'apron' ? { limb: c.over.color } : c.top.id === 'tshirt' ? { limb: L.skin, cap: c.top.color } : { limb: c.top.color };
  const legPaint = !c ? undefined : c.legs.id === 'shorts' ? { limb: L.skin, cap: c.legs.color, capTo: 0.78 } : c.legs.id === 'skirt' ? { limb: L.skin } : { limb: c.legs.color };
  const torso = c ? (
    <g transform={view === 'profile' ? `rotate(${pose.tilt}) ${sized}${facingFlip}` : view === 'back' ? `rotate(${pose.tilt}) ${sized}` : `rotate(${pose.tilt}) translate(${shoulderShift(pose.yaw)} 0) scale(${kw} 1) ${sized}`}>
      <OutfitTorso view={castView} c={c} line={L.line} accent={L.accent} skin={L.skin} torsoGear={torsoGear} />
    </g>
  ) :
    view === 'profile' ? (
      <g transform={`rotate(${pose.tilt}) ${sized}${facingFlip}`}>
        <SideTorso L={L} belly={b.belly} />
        {torsoGear}
      </g>
    ) : view === 'back' ? (
      <g transform={`rotate(${pose.tilt}) ${sized}`}>
        <BackTorso L={L} />
      </g>
    ) : (
      torsoFront
    );
  // hair and face parts turn with the head: mirrored in a left profile, slid a little at three-quarter
  const hairView: 'front' | 'profile' | 'back' = view === 'profile' ? 'profile' : view === 'back' ? 'back' : 'front';
  const headT = `rotate(${pose.tilt}) rotate(${pose.headTilt} 0 ${HEAD.y + 40})${view === 'profile' && pose.yaw < 0 ? ' scale(-1 1)' : ''}${view === 'three-quarter' ? ` translate(${-pose.yaw * 12} 0)` : ''}`;
  // the head and what hangs round it sit on the shoulders, wherever this body's shoulders are
  const headY = HEAD.y + (b.shoulder.y + 108);
  const headShift = `translate(0 ${headY - HEAD.y})`;
  const headSize = b.head === 1 ? '' : ` translate(0 ${HEAD.y}) scale(${b.head}) translate(0 ${-HEAD.y})`;
  return (
    <g>
      {shadow > 0 ? <ellipse cx={pose.x} cy={pose.y + legLen * pose.scale + 10} rx={70 * pose.scale} ry={12 * pose.scale} fill="#000" opacity={0.25 * shadow} /> : null}
      <g transform={`translate(${pose.x} ${pose.y}) scale(${pose.scale}) rotate(${pose.spin} 0 -90)`} filter={`url(#${rimId})`}>
        <g transform={`translate(0 ${legLen}) scale(${1 + 0.6 * pose.squash} ${1 - pose.squash}) translate(0 ${-legLen})`}>
          {/* the far side is drawn first, so a turned body overlaps itself the right way */}
          {pose.yaw < 0 ? <>{limb(j.legR, b.leg, false, legPaint)}{shoe(j.legR)}{limb(j.legL, b.leg, false, legPaint)}{shoe(j.legL)}</> : <>{limb(j.legL, b.leg, false, legPaint)}{shoe(j.legL)}{limb(j.legR, b.leg, false, legPaint)}{shoe(j.legR)}</>}
          {c?.legs.id === 'skirt' ? <Skirt knees={[j.legL.mid, j.legR.mid]} color={c.legs.color} shade={c.legs.shade} line={L.line} hip={b.hip} /> : null}
          {pose.yaw < 0 ? <>{limb(j.armR, b.arm, true, armPaint)}{hand(j.armR, -1, pose.handR as HandKind, handRProp)}</> : <>{limb(j.armL, b.arm, true, armPaint)}{hand(j.armL, 1, pose.handL as HandKind, handLProp)}</>}
          {torso}
          {pose.yaw < 0 ? <>{limb(j.armL, b.arm, true, armPaint)}{hand(j.armL, 1, pose.handL as HandKind, handLProp)}</> : <>{limb(j.armR, b.arm, true, armPaint)}{hand(j.armR, -1, pose.handR as HandKind, handRProp)}</>}
          <g transform={`${headShift}${headSize}`}>
          {L.extra === 'hood' ? (
            <g transform={`rotate(${pose.tilt}) rotate(${pose.headTilt * 0.5} 0 ${HEAD.y + 40})`}>
              <path d={`M -70 ${HEAD.y + 14} Q -80 ${HEAD.y - 74} 0 ${HEAD.y - 80} Q 80 ${HEAD.y - 74} 70 ${HEAD.y + 14} Q 52 -100 0 -106 Q -52 -100 -70 ${HEAD.y + 14} Z`} fill={L.jacket} stroke={L.line} strokeWidth={4} />
              {(() => {
                const sw = pose.sway * 0.7 - pose.tilt * 0.6;
                return (
                  <g>
                    <path d={`M -12 -108 Q ${-14 + sw * 0.3} -88 ${-16 + sw} -66 M 12 -108 Q ${14 + sw * 0.3} -88 ${16 + sw} -66`} stroke={L.accent} strokeWidth={5} strokeLinecap="round" fill="none" />
                    <circle cx={-16 + sw} cy={-64} r={5} fill={L.accent} />
                    <circle cx={16 + sw} cy={-64} r={5} fill={L.accent} />
                  </g>
                );
              })()}
            </g>
          ) : null}
          {L.extra === 'curls' && !c ? (
            <g transform={`rotate(${pose.tilt})`}>
              <path d="M -46 -110 Q 0 -86 46 -110" stroke="#E06A5A" strokeWidth={8} fill="none" strokeLinecap="round" />
              <rect x={-60} y={-126} width={20} height={32} rx={8} fill="#E06A5A" stroke={L.line} strokeWidth={4} />
              <rect x={40} y={-126} width={20} height={32} rx={8} fill="#E06A5A" stroke={L.line} strokeWidth={4} />
            </g>
          ) : null}
            {c?.newHair ? <g transform={headT}><HairLayer style={c.hairStyle} view={hairView} part="behind" color={L.hair} line={L.line} /></g> : null}
            <ViewHead pose={pose} L={L} head={<FrontHead pose={pose} L={L} headGear={headGear} />} headGear={headGear} />
            {c ? (
              <g transform={headT}>
                {c.newHair ? <HairLayer style={c.hairStyle} view={hairView} part="over" color={L.hair} line={L.line} /> : null}
                <FaceParts view={view} yaw={pose.yaw} expr={pose.expr} c={c} ink={L.face} hair={L.hair} />
              </g>
            ) : null}
          </g>
          {children}
        </g>
      </g>
    </g>
  );
};
