// What a person does, in three layers that combine:
//   stance  the lower body: stand, sit, kneel, crouch;
//   gesture the upper body, looping while the person talks or waits: explain, cross-arms, phone…;
//   clip    one action through time, built as anticipation, action, hold, settle: stand-up, startle, walk…
// All of it returns plain pose values: spread them into a pose, or name them on <Staged act="…">. A person's feet stay on
// the ground by themselves on a stage, so a clip only says what the limbs do (and `lift` when both feet leave the floor).
// Pure numbers, no drawing: nothing here depends on the rig.

type Limb = { a: number; b: number };
export type ActBits = {
  armL?: Limb; armR?: Limb; legL?: Limb; legR?: Limb; tilt?: number; headTilt?: number; squash?: number; look?: number; blink?: number;
  expr?: string; talk?: number; handL?: string; handR?: string; sway?: number; yaw?: number;
  /** height of the feet above the ground, in body units */ lift?: number;
};
/** How a body moves: amplitude and speed relative to an adult. */
export type ActStyle = { amp?: number; tempo?: number };
type Ctx = ActStyle & { yaw?: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const foldYaw = (yaw: number) => {
  const a = Math.abs(yaw);
  return a <= 1 ? a : Math.max(0, 2 - a);
};

/** A value through keyed times (0..1), smoothed between keys. */
const curve = (p: number, keys: readonly (readonly number[])[]): number => {
  if (p <= keys[0]![0]!) return keys[0]![1]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const p0 = keys[i]![0]!, v0 = keys[i]![1]!;
    const p1 = keys[i + 1]![0]!, v1 = keys[i + 1]![1]!;
    if (p <= p1) return lerp(v0, v1, smooth((p - p0) / Math.max(1e-6, p1 - p0)));
  }
  return keys[keys.length - 1]![1]!;
};
const mouth = (t: number) => {
  if (t < 2) return 0;
  const syll = Math.sin(t * 0.62 + 1.9) * 0.5 + 0.5;
  return clamp01(syll * (Math.sin(t * 0.17 + 3.1) > -0.35 ? 1 : 0.12));
};

// ---------------------------------------------------------------------------------------------- stances

export const STANCES = {
  stand: {},
  sit: { legL: { a: 78, b: -78 }, legR: { a: 74, b: -74 } },
  kneel: { legL: { a: 8, b: -100 }, legR: { a: 4, b: -100 } },
  crouch: { legL: { a: 66, b: -108 }, legR: { a: 62, b: -104 } },
} satisfies Record<string, ActBits>;
export type Stance = keyof typeof STANCES;

// ---------------------------------------------------------------------------------------------- gestures

const GESTURE_TABLE = {
  idle: (w: number) => ({ armL: { a: 14 + w, b: 12 }, armR: { a: 14 - w, b: 12 } }),
  talk: (w: number, m: number) => ({ armR: { a: 48 + w * 14, b: 42 + w * 10 }, armL: { a: 16, b: 10 }, headTilt: w * 3, talk: m }),
  explain: (w: number, m: number) => ({ armR: { a: 62 + w * 12, b: 36 }, armL: { a: 44 - w * 10, b: 32 }, headTilt: 3 + w * 2, talk: m }),
  question: (w: number, m: number) => ({ armR: { a: 68 + w * 10, b: 54 }, armL: { a: 28, b: 24 }, headTilt: 6, talk: m }),
  shrug: () => ({ armL: { a: 42, b: 78 }, armR: { a: 42, b: 78 }, headTilt: -8 }),
  think: (w: number) => ({ armR: { a: 118, b: 108 }, armL: { a: 12, b: 10 }, headTilt: 7 + w }),
  point: (w: number) => ({ armR: { a: 68 + w * 6, b: 34 }, armL: { a: 16, b: 14 }, handR: 'point', headTilt: 2 }),
  hold: (w: number) => ({ armR: { a: 38 + w * 4, b: 58 }, armL: { a: 28, b: 48 } }),
  phone: (w: number) => ({ armR: { a: 40 + w * 2, b: 96 }, armL: { a: 34 + w * 2, b: 92 }, headTilt: 10 }),
  'cross-arms': (w: number) => ({ armL: { a: -12, b: -70 }, armR: { a: -12, b: -68 }, headTilt: -2 + w }),
  'hands-hips': (w: number) => ({ armL: { a: 19, b: -55 }, armR: { a: 19, b: -55 }, headTilt: w }),
  pockets: (w: number) => ({ armL: { a: 8, b: -24 }, armR: { a: 8, b: -24 }, headTilt: w }),
  cheer: (w: number) => ({ armL: { a: 142 + w * 8, b: 18 }, armR: { a: 142 - w * 8, b: 18 }, squash: -0.04 + w * 0.02 }),
  wave: (w: number, _m: number, w2: number) => ({ armR: { a: 132 + w * 14, b: 42 + w2 * 18 }, armL: { a: 16, b: 12 }, headTilt: 4 }),
  type: (w: number) => ({ armL: { a: 36 + w * 5, b: 62 - w * 6 }, armR: { a: 36 - w * 5, b: 62 + w * 6 }, headTilt: 6 }),
  eat: (w: number) => ({ armR: { a: 76 + w * 28, b: 84 + w * 22 }, armL: { a: 28, b: 48 }, headTilt: w * 4 }),
  facepalm: (w: number) => ({ armR: { a: 122 + w * 2, b: 120 }, armL: { a: 12, b: 10 }, headTilt: 12 }),
  shout: (w: number, m: number) => ({ armR: { a: 104 + w * 10, b: 52 }, armL: { a: 98 - w * 10, b: 50 }, headTilt: -4, talk: Math.min(1, m * 1.4) }),
  push: (w: number) => ({ armR: { a: 72 + w * 5, b: 8 }, armL: { a: 68 - w * 5, b: 10 }, squash: 0.02 }),
  nod: (_w: number, _m: number, _w2: number, t = 0) => ({ headTilt: Math.sin(t * 0.55) * 7, armL: { a: 16, b: 14 }, armR: { a: 18, b: 16 } }),
  shake: (_w: number, _m: number, _w2: number, t = 0) => ({ look: Math.sin(t * 0.7) * 0.9, headTilt: Math.sin(t * 0.7) * 3, armL: { a: 16, b: 14 }, armR: { a: 18, b: 16 } }),
} satisfies Record<string, (w: number, m: number, w2: number, t?: number) => ActBits>;
export type Gesture = keyof typeof GESTURE_TABLE;
export const GESTURES = Object.keys(GESTURE_TABLE) as Gesture[];

/** Shapes that fold the arm across the body from the front mean something else from the side: the same idea, side-on. */
const SIDE_ON: Partial<Record<Gesture, ActBits>> = {
  'cross-arms': { armL: { a: 14, b: 96 }, armR: { a: 10, b: 100 } },
  'hands-hips': { armL: { a: -24, b: 44 }, armR: { a: -24, b: 44 } },
  pockets: { armL: { a: -8, b: 18 }, armR: { a: -8, b: 18 } },
};

/** A head tilt is a rotation on screen: a person facing the other way tips it the other way. */
const mirrorHead = (b: ActBits, yaw: number): ActBits => (yaw < 0 && b.headTilt !== undefined ? { ...b, headTilt: -b.headTilt } : b);

const swapArms = (b: ActBits): ActBits => {
  const { armL, armR, handL, handR, ...rest } = b;
  return { ...rest, ...(armR ? { armL: armR } : {}), ...(armL ? { armR: armL } : {}), ...(handR ? { handL: handR } : {}), ...(handL ? { handR: handL } : {}) };
};

/** The upper body, looping. Facing screen-left the gesturing arm is swapped so it is always the near one. */
export const gesture = (name: Gesture, t: number, ctx: Ctx = {}): ActBits => {
  const tempo = ctx.tempo ?? 1;
  const amp = ctx.amp ?? 1;
  const w = Math.sin(t * tempo * 0.25) * amp;
  const w2 = Math.cos(t * tempo * 0.35) * amp;
  const yaw = ctx.yaw ?? 0;
  const drawn: ActBits = GESTURE_TABLE[name](w, mouth(t), w2, t * tempo);
  const bits = foldYaw(yaw) >= 0.4 && SIDE_ON[name] ? { ...drawn, ...SIDE_ON[name] } : drawn;
  return mirrorHead(yaw < 0 ? swapArms(bits) : bits, yaw);
};

// ---------------------------------------------------------------------------------------------- clips

/** Which way the body leans forward on screen: toward where it faces, and hardly at all face-on (the lean goes into the screen). */
const leanDir = (yaw: number) => (yaw < 0 ? -1 : 1) * foldYaw(yaw);

type ClipFn = (p: number, f: number, dur: number, c: { lean: number; amp: number }) => ActBits;

const CLIP_TABLE = {
  'stand-up': { dur: 26, loop: false, fn: ((p, _f, _d, c) => {
    const up = curve(p, [[0, 0], [0.3, 0], [1, 1]]);
    return {
      legL: { a: lerp(78, 5, up), b: lerp(-78, 0, up) }, legR: { a: lerp(74, -5, up), b: lerp(-74, 0, up) },
      tilt: curve(p, [[0, 0], [0.3, 20], [0.75, 8], [1, 0]]) * c.lean,
      armL: { a: curve(p, [[0, 26], [0.3, 40], [1, 14]]), b: 20 }, armR: { a: curve(p, [[0, 30], [0.3, 44], [1, 14]]), b: 20 },
    };
  }) as ClipFn },
  'sit-down': { dur: 24, loop: false, fn: ((p, _f, _d, c) => {
    const down = curve(p, [[0, 0], [0.2, 0.06], [0.85, 1.04], [1, 1]]);
    return {
      legL: { a: lerp(5, 78, down), b: lerp(0, -78, down) }, legR: { a: lerp(-5, 74, down), b: lerp(0, -74, down) },
      tilt: curve(p, [[0, 0], [0.45, 18], [1, 0]]) * c.lean,
      armL: { a: curve(p, [[0, 14], [0.5, 38], [1, 26]]), b: 20 }, armR: { a: curve(p, [[0, 14], [0.5, 42], [1, 30]]), b: 20 },
    };
  }) as ClipFn },
  startle: { dur: 26, loop: false, fn: ((p) => {
    const arms = curve(p, [[0, 14], [0.12, 8], [0.3, 128], [0.55, 110], [1, 30]]);
    return {
      squash: curve(p, [[0, 0], [0.12, 0.09], [0.28, -0.08], [0.5, 0.05], [0.7, 0]]),
      lift: curve(p, [[0, 0], [0.14, 0], [0.32, 30], [0.5, 0]]),
      armL: { a: arms, b: 30 }, armR: { a: arms, b: 30 }, expr: p > 0.1 ? 'shock' : undefined,
      headTilt: curve(p, [[0, 0], [0.3, -6], [1, 0]]),
    };
  }) as ClipFn },
  jump: { dur: 28, loop: false, fn: ((p) => {
    const bend = curve(p, [[0, 0], [0.22, 1], [0.38, 0], [0.68, 0], [0.82, 0.8], [1, 0]]);
    return {
      legL: { a: 5 + bend * 40, b: -bend * 70 }, legR: { a: -5 + bend * 40, b: -bend * 70 },
      lift: curve(p, [[0, 0], [0.32, 0], [0.52, 70], [0.72, 0]]),
      squash: curve(p, [[0, 0], [0.22, 0.09], [0.4, -0.08], [0.72, 0.08], [1, 0]]),
      armL: { a: curve(p, [[0, 14], [0.22, -10], [0.5, 142], [1, 18]]), b: 18 }, armR: { a: curve(p, [[0, 14], [0.22, -10], [0.5, 142], [1, 18]]), b: 18 },
    };
  }) as ClipFn },
  slump: { dur: 30, loop: false, fn: ((p, _f, _d, c) => {
    const s = curve(p, [[0, 0], [0.7, 1], [1, 1]]);
    return { tilt: 12 * s * c.lean, headTilt: 12 * s, squash: 0.05 * s, armL: { a: lerp(14, 4, s), b: 4 }, armR: { a: lerp(14, 4, s), b: 4 }, legL: { a: 5 + 8 * s, b: -14 * s }, legR: { a: -5 + 8 * s, b: -14 * s }, expr: 'tired' };
  }) as ClipFn },
  bow: { dur: 34, loop: false, fn: ((p, _f, _d, c) => {
    const s = curve(p, [[0, 0], [0.35, 1], [0.7, 1], [1, 0]]);
    return { tilt: 36 * s * c.lean, headTilt: 8 * s, squash: 0.03 * s, armL: { a: 6, b: 8 }, armR: { a: 6, b: 8 } };
  }) as ClipFn },
  'pick-up': { dur: 34, loop: false, fn: ((p, _f, _d, c) => {
    const s = curve(p, [[0, 0], [0.45, 1], [0.6, 1], [1, 0]]);
    return { tilt: 44 * s * c.lean, headTilt: 10 * s, legL: { a: 5 + 42 * s, b: -74 * s }, legR: { a: -5 + 38 * s, b: -70 * s }, armR: { a: 14 + 46 * s, b: 12 }, armL: { a: 14 + 30 * s, b: 12 } };
  }) as ClipFn },
  walk: { dur: 0, loop: true, fn: ((_p, f, _d, c) => {
    const ph = f * 0.6;
    const s = Math.sin(ph);
    return {
      tilt: 5 * c.lean, headTilt: 2 * Math.sin(ph * 2), sway: 10 * Math.sin(ph + 0.8),
      legL: { a: 28 * s * c.amp, b: -Math.max(0, 40 * Math.sin(ph + 1.2)) }, legR: { a: -28 * s * c.amp, b: -Math.max(0, 40 * Math.sin(ph + 1.2 + Math.PI)) },
      armL: { a: -20 * s * c.amp + 2, b: 18 }, armR: { a: 20 * s * c.amp + 2, b: 18 },
      lift: Math.abs(Math.cos(ph)) * 6,
    };
  }) as ClipFn },
  run: { dur: 0, loop: true, fn: ((_p, f, _d, c) => {
    const ph = f * 0.95;
    const s = Math.sin(ph);
    return {
      tilt: 14 * c.lean, headTilt: 3 * Math.sin(ph * 2), sway: 18 * Math.sin(ph + 0.8),
      legL: { a: 48 * s * c.amp + 10, b: -Math.max(12, 95 * Math.max(0, Math.sin(ph + 1.3))) }, legR: { a: -48 * s * c.amp + 10, b: -Math.max(12, 95 * Math.max(0, Math.sin(ph + 1.3 + Math.PI))) },
      armL: { a: -44 * s * c.amp + 10, b: 86 }, armR: { a: 44 * s * c.amp + 10, b: 86 },
      lift: Math.abs(Math.cos(ph)) * 22,
    };
  }) as ClipFn },
  sneak: { dur: 0, loop: true, fn: ((_p, f, _d, c) => {
    const ph = f * 0.32;
    const s = Math.sin(ph);
    return {
      tilt: 16 * c.lean, headTilt: -4,
      legL: { a: 34 + 22 * s, b: -66 - 14 * Math.max(0, Math.sin(ph + 1.2)) }, legR: { a: 34 - 22 * s, b: -66 - 14 * Math.max(0, Math.sin(ph + 1.2 + Math.PI)) },
      armL: { a: 38, b: 84 }, armR: { a: 46, b: 84 }, look: c.lean >= 0 ? 0.5 : -0.5,
    };
  }) as ClipFn },
} satisfies Record<string, { dur: number; loop: boolean; fn: ClipFn }>;
export type Clip = keyof typeof CLIP_TABLE;
export const CLIPS = Object.keys(CLIP_TABLE) as Clip[];

/** One action through time, starting at frame `from`. Before it starts it holds its first pose, after it ends its last one. */
export const clip = (name: Clip, t: number, opts: Ctx & { from?: number; dur?: number } = {}): ActBits => {
  const def = CLIP_TABLE[name];
  const tempo = opts.tempo ?? 1;
  const dur = Math.max(1, (opts.dur ?? def.dur) / tempo);
  const f = Math.max(0, t - (opts.from ?? 0));
  const yaw = opts.yaw ?? 0;
  const out = def.fn(clamp01(f / dur), f * tempo, dur, { lean: leanDir(yaw), amp: opts.amp ?? 1 });
  if (out.expr === undefined) delete out.expr;
  return mirrorHead(out, yaw);
};

// ---------------------------------------------------------------------------------------------- your own actions
// A story always needs a gesture the list does not have. An action is only numbers through time, so anyone can add one:
//   const DIG = defineAction('dig', { loop: true, dur: 22, tilt: 24, armR: { a: [[0, 40], [0.5, 62], [1, 40]], b: 20 } });
// then act: DIG (or act: 'dig'); or pass the object itself as act on a person. A value is a number, or keys [[p, value], …]
// with p from 0 (start of the action) to 1 (its end). Arms and legs: a = swing from the shoulder / hip in degrees (0 hangs
// down, 90 points forward, 140 is up), b = bend of the elbow / knee. tilt leans the torso toward where the person faces.
type Keyed = number | readonly (readonly number[])[];
type LimbKeyed = { a: Keyed; b: Keyed };
export type OwnActionSpec = {
  /** frames for one pass (default 24) */ dur?: number;
  /** true: repeats while the shot lasts (a gesture); false: plays once from `from` and holds its end (a clip) */ loop?: boolean;
  armL?: LimbKeyed; armR?: LimbKeyed; legL?: LimbKeyed; legR?: LimbKeyed;
  /** torso lean, degrees, toward the facing side */ tilt?: Keyed; headTilt?: Keyed; squash?: Keyed; lift?: Keyed; look?: Keyed;
  /** the mouth moves */ talk?: boolean; expr?: string; handL?: string; handR?: string;
  /** stand | sit | kneel | crouch while doing it */ stance?: Stance;
};
const OWN: Record<string, OwnActionSpec> = {};
const LIMBS = ['armL', 'armR', 'legL', 'legR'] as const;
const NUMS = ['tilt', 'headTilt', 'squash', 'lift', 'look'] as const;
const KNOWN_KEYS = new Set<string>(['dur', 'loop', 'talk', 'expr', 'handL', 'handR', 'stance', ...LIMBS, ...NUMS]);
const okKeyed = (v: unknown): boolean => typeof v === 'number' || (Array.isArray(v) && v.length > 0 && v.every((k) => Array.isArray(k) && k.length === 2 && k.every((n) => typeof n === 'number')));
/** Add an action to the engine under a name. Returns the name, typed for `act`. A wrong shape fails here, with the reason. */
export const defineAction = (name: string, spec: OwnActionSpec): ActName => {
  if (!name || typeof spec !== 'object' || !spec) throw new Error(`defineAction(name, { ... }): give a name and the values, got ${JSON.stringify(name)}`);
  for (const k of Object.keys(spec)) if (!KNOWN_KEYS.has(k)) throw new Error(`defineAction('${name}'): unknown field "${k}". Fields: ${[...KNOWN_KEYS].join(', ')}`);
  for (const l of LIMBS) { const v = spec[l]; if (v !== undefined && (!okKeyed(v.a) || !okKeyed(v.b))) throw new Error(`defineAction('${name}').${l} must be { a, b }, each a number or keys [[0, 14], [1, 90]]`); }
  for (const n of NUMS) if (spec[n] !== undefined && !okKeyed(spec[n])) throw new Error(`defineAction('${name}').${n} must be a number or keys [[0, 0], [1, 20]]`);
  OWN[name] = spec;
  return name as ActName;
};
const INLINE = new Map<string, string>();
/** An action given as an object on a person: registered once under a name of its own. */
export const actionName = (a: ActName | OwnActionSpec | undefined): ActName | undefined => {
  if (a === undefined || typeof a === 'string') return a;
  const key = JSON.stringify(a);
  if (!INLINE.has(key)) INLINE.set(key, defineAction(`own-${INLINE.size + 1}`, a) as string);
  return INLINE.get(key) as ActName;
};
export const isOwnAction = (n: string): boolean => n in OWN;
export const ownStance = (n: string | undefined): Stance | undefined => (n ? OWN[(ACTION_ALIASES as Record<string, string>)[n] ?? n]?.stance : undefined);
const keyed = (v: Keyed, p: number): number => (typeof v === 'number' ? v : curve(p, v));
const own = (spec: OwnActionSpec, t: number, opts: Ctx & { from?: number; dur?: number }): ActBits => {
  const tempo = opts.tempo ?? 1;
  const dur = Math.max(1, (opts.dur ?? spec.dur ?? 24) / tempo);
  const f = Math.max(0, t - (opts.from ?? 0));
  const p = spec.loop ? (f % dur) / dur : clamp01(f / dur);
  const yaw = opts.yaw ?? 0;
  // an arm the action does not name hangs as in idle, not straight down behind the body
  const out: ActBits = { armL: { a: 14, b: 12 }, armR: { a: 14, b: 12 } };
  for (const l of LIMBS) { const v = spec[l]; if (v) out[l] = { a: keyed(v.a, p), b: keyed(v.b, p) }; }
  for (const n of NUMS) { const v = spec[n]; if (v !== undefined) out[n] = keyed(v, p) * (n === 'tilt' ? leanDir(yaw) : 1); }
  // Seen from the front a lean has no side to go to: the body sinks a little instead, so lean, rummage and slam still read.
  if (spec.tilt !== undefined) out.squash = (out.squash ?? 0) + Math.abs(keyed(spec.tilt, p)) * (1 - foldYaw(yaw)) * 0.0035;
  if (spec.talk) out.talk = mouth(t);
  if (spec.expr) out.expr = spec.expr;
  if (spec.handL) out.handL = spec.handL;
  if (spec.handR) out.handR = spec.handR;
  // like a gesture: facing screen-left, the working arm is the near one
  return mirrorHead(yaw < 0 ? swapArms(out) : out, yaw);
};
// The ones the stories asked for first (prof, 2026-11-12), written with the same tool anyone has:
/** leans over a desk or a counter, one hand on it */
defineAction('lean', { dur: 12, tilt: [[0, 0], [1, 22]], headTilt: [[0, 0], [1, 6]], armR: { a: [[0, 14], [1, 56]], b: [[0, 12], [1, 4]] }, armL: { a: 20, b: 10 } });
/** digs in a bag, a drawer, a locker: both hands down in front, working */
defineAction('rummage', { loop: true, dur: 20, tilt: 24, headTilt: 12, armR: { a: [[0, 40], [0.5, 62], [1, 40]], b: [[0, 30], [0.5, 8], [1, 30]] }, armL: { a: [[0, 60], [0.5, 38], [1, 60]], b: [[0, 8], [0.5, 30], [1, 8]] } });
/** brings a flat hand down hard on a table */
defineAction('slam', { dur: 14, armR: { a: [[0, 20], [0.4, 150], [0.62, 52], [1, 52]], b: [[0, 12], [0.4, 30], [0.62, 4], [1, 4]] }, armL: { a: 18, b: 12 }, tilt: [[0, 0], [0.4, -6], [0.62, 20], [1, 16]], squash: [[0, 0], [0.62, 0.05], [1, 0]] });
/** holds something out to someone */
defineAction('give', { dur: 14, armR: { a: [[0, 14], [1, 82]], b: [[0, 12], [1, 6]] }, armL: { a: 16, b: 12 }, tilt: [[0, 0], [1, 6]] });
/** reads something held in both hands */
defineAction('read', { loop: true, dur: 60, armR: { a: 58, b: 88 }, armL: { a: 52, b: 84 }, headTilt: [[0, 12], [0.5, 14], [1, 12]] });
export type OwnAction = 'lean' | 'rummage' | 'slam' | 'give' | 'read';

export type ActName = Gesture | Clip | ActionAlias | OwnAction;
/** Words the stories ask for that are another action: kneel and crouch are stances (set `stance`), the rest are synonyms. */
export const ACTION_ALIASES = {
  kneel: 'idle', crouch: 'idle', yell: 'shout', scream: 'shout', 'face-palm': 'facepalm', shove: 'push', laugh: 'talk',
  'lean-on': 'lean', search: 'rummage', dig: 'rummage', hand: 'give', offer: 'give', bang: 'slam',
} as const;
export type ActionAlias = keyof typeof ACTION_ALIASES;
/** The stance an action word implies (act: 'kneel' kneels), or undefined. */
export const stanceOfAction = (name: string | undefined): Stance | undefined => (name === 'kneel' || name === 'crouch' ? name : undefined);
export const isClip = (n: string): n is Clip => n in CLIP_TABLE;
export const isGesture = (n: string): n is Gesture => n in GESTURE_TABLE;

/** Resolve a name: a clip or a gesture. An unknown name fails with the list, so it is fixed at once. */
export const act = (name: ActName | string, t: number, opts: Ctx & { from?: number; dur?: number } = {}): ActBits => {
  name = (ACTION_ALIASES as Record<string, string>)[name] ?? name;
  if (OWN[name]) return own(OWN[name]!, t, opts);
  if (isClip(name)) return clip(name, t, opts);
  if (isGesture(name)) return gesture(name, t, opts);
  throw new Error(`unknown action "${name}". Gestures: ${GESTURES.join(', ')}. Clips: ${CLIPS.join(', ')}. Defined: ${Object.keys(OWN).join(', ')}. For anything else define it: defineAction('${name}', { dur: 20, armR: { a: [[0, 14], [1, 90]], b: 10 }, tilt: 12 }), or pass that object as act.`);
};

/** Turn on a beat: yaw moves to each key over a few frames, through a blink, so the swap of drawings is not seen. */
export const turnAt = (t: number, keys: [number, number][], frames = 6): ActBits => {
  let yaw = keys[0]![1];
  let blink = 0;
  for (let i = 1; i < keys.length; i++) {
    const [f, to] = keys[i]!;
    const from = keys[i - 1]![1];
    if (t >= f) yaw = lerp(from, to, smooth(clamp01((t - f) / frames)));
    if (t >= f - 1 && t <= f + frames) blink = 1;
  }
  return { yaw, blink };
};
