import React from 'react';

// Things a person holds. `hold: 'bag'` on a person in shot() puts one in the hand; held('bag', { color }) gives the
// same drawing for a handRProp / handLProp slot or for `props` on a piece. Drawn in the hand's own space: the palm is
// at (0, 10), y grows away from the wrist, about 11 units is half a hand. Flat fills, one dark line, like the people.

const INK = '#1F1B2E';
const SW = 4;

export type HeldName = 'phone' | 'handset' | 'bag' | 'paper' | 'crumpled' | 'cup' | 'keys' | 'book' | 'pen' | 'folder' | 'box' | 'tray' | 'plate' | 'bottle' | 'bucket' | 'glass' | 'mic' | 'money' | 'letter' | 'key' | 'contract' | 'pills';
export const HELD_NAMES: HeldName[] = ['phone', 'handset', 'bag', 'paper', 'crumpled', 'cup', 'keys', 'book', 'pen', 'folder', 'box', 'tray', 'plate', 'bottle', 'bucket', 'glass', 'mic', 'money', 'letter', 'key', 'contract', 'pills'];
export type HeldOpts = { color?: string; scale?: number };

const DEFAULTS: Record<HeldName, string> = {
  phone: '#2B2F3A', handset: '#E7DCC2', bag: '#2F4A78', paper: '#F6F1E4', crumpled: '#F1ECDD', cup: '#F3EEE2',
  keys: '#C9A546', book: '#A8443B', pen: '#2D5FA8', folder: '#D8B45A', box: '#B98A56',
  tray: '#A9AFB8', plate: '#F3EEE2', bottle: '#4E8F6A', bucket: '#8A97A6', glass: '#CFE3EE', mic: '#2B2F3A',
  money: '#5B9A63', letter: '#F6F1E4', key: '#D4A843', contract: '#F8F4EA', pills: '#E88A3E',
};

/** Things that stay level whatever the arm does: a tray held like a phone stood on its edge (custom run, 2026-11-13). */
export const HELD_LEVEL: readonly string[] = ['tray', 'plate', 'bottle', 'bucket', 'glass'];
/** How far below the palm line each drawing ends: where it rests once put down. */
const BOTTOM: Record<HeldName, number> = { phone: 34, handset: 52, bag: 94, paper: 50, crumpled: 34, cup: 40, keys: 60, book: 48, pen: 26, folder: 50, box: 52, tray: 16, plate: 14, bottle: 30, bucket: 44, glass: 26, mic: 30, money: 34, letter: 36, key: 50, contract: 56, pills: 36 };
export const heldBottom = (name?: string): number => BOTTOM[name as HeldName] ?? 24;

const draw: Record<HeldName, (c: string) => React.ReactNode> = {
  phone: (c) => (
    <g>
      <rect x={-13} y={-16} width={26} height={50} rx={6} fill={c} stroke={INK} strokeWidth={SW} />
      <rect x={-9} y={-11} width={18} height={36} rx={2} fill="#10131A" />
    </g>
  ),
  handset: (c) => (
    <g>
      <path d="M -12 -30 Q -22 -30 -22 -18 L -22 -8 Q -22 0 -13 0 L -10 0 L -10 22 L -13 22 Q -22 22 -22 30 L -22 40 Q -22 52 -12 52 L 2 52 Q 8 52 8 44 L 8 -22 Q 8 -30 2 -30 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -4 52 q 10 8 0 16 q -10 8 0 16 q 10 8 0 16 q -10 8 0 16" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
  bag: (c) => (
    <g>
      <path d="M -16 16 Q -16 -4 0 -4 Q 16 -4 16 16" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <path d="M -34 22 Q -34 12 -22 12 L 22 12 Q 34 12 34 22 L 38 82 Q 38 94 26 94 L -26 94 Q -38 94 -38 82 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -24 56 L 24 56 L 22 84 L -22 84 Z" fill="#00000026" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M -30 34 L 30 34" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
  paper: (c) => (
    <g>
      <path d="M -22 -8 L 22 -12 L 26 46 L -18 50 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -12 4 L 14 2 M -11 16 L 16 14 M -10 28 L 10 27" stroke={INK} strokeWidth={2.5} opacity={0.45} strokeLinecap="round" />
    </g>
  ),
  crumpled: (c) => (
    <g>
      <path d="M -16 2 L -6 -8 L 6 -4 L 16 -10 L 20 6 L 14 20 L 20 30 L 4 34 L -8 28 L -18 32 L -22 16 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -6 -8 L -2 10 L 14 20 M -2 10 L -18 32 M 6 -4 L 4 12" fill="none" stroke={INK} strokeWidth={2} opacity={0.4} />
    </g>
  ),
  cup: (c) => (
    <g>
      <path d="M 16 2 Q 32 2 32 16 Q 32 30 16 30" fill="none" stroke={INK} strokeWidth={5} />
      <path d="M -18 -8 L 18 -8 L 15 36 Q 14 40 10 40 L -10 40 Q -14 40 -15 36 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    </g>
  ),
  keys: (c) => (
    <g>
      <circle cx={0} cy={18} r={9} fill="none" stroke={INK} strokeWidth={3.5} />
      <path d="M -4 26 L -12 52 L -6 54 L -8 60 L -2 58 L 2 28 Z" fill={c} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 4 26 L 14 48 L 9 52 L 12 57 L 6 58 L -1 30 Z" fill={c} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
    </g>
  ),
  book: (c) => (
    <g>
      <rect x={-24} y={-14} width={48} height={62} rx={4} fill={c} stroke={INK} strokeWidth={SW} />
      <path d="M -16 -14 L -16 48" stroke={INK} strokeWidth={3} opacity={0.5} />
      <rect x={-8} y={0} width={24} height={8} rx={2} fill="#FFFFFF66" />
    </g>
  ),
  pen: (c) => (
    <g>
      <rect x={-4} y={-22} width={8} height={48} rx={3} fill={c} stroke={INK} strokeWidth={3} />
      <path d="M -4 -22 L 0 -34 L 4 -22 Z" fill="#E9D9B5" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
    </g>
  ),
  folder: (c) => (
    <g>
      <path d="M -30 -10 L -8 -10 L -2 -2 L 30 -2 L 30 50 L -30 50 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -30 8 L 30 8" stroke={INK} strokeWidth={3} opacity={0.4} />
    </g>
  ),
  box: (c) => (
    <g>
      <rect x={-36} y={-6} width={72} height={58} rx={3} fill={c} stroke={INK} strokeWidth={SW} />
      <path d="M -36 10 L 36 10 M 0 -6 L 0 10" stroke={INK} strokeWidth={3} opacity={0.5} />
    </g>
  ),
  // seen from the side, lying flat on the palm: a canteen tray with a bowl and a glass on it
  tray: (c) => (
    <g>
      <path d="M -30 -2 Q -30 -14 -18 -14 L -6 -14 Q 6 -14 6 -2 Z" fill="#ECE4D3" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <rect x={18} y={-22} width={14} height={20} rx={2} fill="#CFE3EE" stroke={INK} strokeWidth={3} />
      <rect x={-62} y={-2} width={124} height={14} rx={6} fill={c} stroke={INK} strokeWidth={SW} />
    </g>
  ),
  plate: (c) => (
    <g>
      <path d="M -20 0 Q -20 -12 0 -12 Q 20 -12 20 0 Z" fill="#D9A45B" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M -38 0 L 38 0 Q 30 12 14 12 L -14 12 Q -30 12 -38 0 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    </g>
  ),
  // hung from its handle: the pail is below the hand
  bucket: (c) => (
    <g>
      <path d="M -22 14 Q 0 -14 22 14" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <path d="M -24 12 L 24 12 L 18 44 L -18 44 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx={0} cy={12} rx={24} ry={5} fill="#00000030" stroke={INK} strokeWidth={3} />
    </g>
  ),
  glass: (c) => (
    <g>
      <path d="M -11 -14 L 11 -14 L 8 26 L -8 26 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" opacity={0.92} />
      <path d="M -9 2 L 9 2 L 7 23 L -7 23 Z" fill="#7FB8D8" opacity={0.7} />
    </g>
  ),
  mic: (c) => (
    <g>
      <rect x={-5} y={-4} width={10} height={34} rx={4} fill={c} stroke={INK} strokeWidth={3} />
      <circle cx={0} cy={-13} r={11} fill="#8A8F99" stroke={INK} strokeWidth={SW} />
      <path d="M -7 -17 L 7 -17 M -9 -12 L 9 -12" stroke={INK} strokeWidth={1.5} opacity={0.5} />
    </g>
  ),
  // upright, held by its body: the neck goes up
  bottle: (c) => (
    <g>
      <rect x={-5} y={-52} width={10} height={10} rx={2} fill="#D8D2C4" stroke={INK} strokeWidth={3} />
      <path d="M -5 -42 L 5 -42 L 6 -30 Q 14 -24 14 -12 L 14 24 Q 14 30 8 30 L -8 30 Q -14 30 -14 24 L -14 -12 Q -14 -24 -6 -30 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <rect x={-14} y={-6} width={28} height={18} fill="#F6F1E4" opacity={0.85} />
    </g>
  ),
  money: (c) => <g transform="translate(0 10)">{GRIP_DRAW.money(c)}</g>,
  letter: (c) => <g transform="translate(0 10)">{GRIP_DRAW.letter(c)}</g>,
  key: (c) => <g transform="translate(0 10)">{GRIP_DRAW.key(c)}</g>,
  contract: (c) => <g transform="translate(0 10)">{GRIP_DRAW.contract(c)}</g>,
  pills: (c) => <g transform="translate(0 10)">{GRIP_DRAW.pills(c)}</g>,
};

/** Grip-oriented prop set: every drawing is strictly anchored at (0, 0) = hand grip center with natural orientation. */
export type GripPropName = 'phone' | 'money' | 'letter' | 'cup' | 'key' | 'contract' | 'bag' | 'pills';
export const GRIP_PROP_NAMES: readonly GripPropName[] = ['phone', 'money', 'letter', 'cup', 'key', 'contract', 'bag', 'pills'];

const GRIP_DRAW: Record<GripPropName, (c: string) => React.ReactNode> = {
  // Phone gripped around its lower-middle body at (0, 0), screen facing cleanly upward/outward
  phone: (c) => (
    <g>
      <rect x={-13} y={-30} width={26} height={48} rx={6} fill={c} stroke={INK} strokeWidth={SW} />
      <rect x={-9} y={-25} width={18} height={35} rx={2} fill="#141923" />
      <rect x={-4} y={-23} width={8} height={2.5} rx={1.2} fill="#394357" />
      <path d="M -6 -16 L 5 -22" stroke="#FFFFFF" strokeWidth={2} opacity={0.22} strokeLinecap="round" />
    </g>
  ),
  // Fanned banknotes gripped by their bottom stack at (0, 0)
  money: (c) => (
    <g>
      <g transform="rotate(-14 0 0)">
        <rect x={-12} y={-30} width={24} height={42} rx={3} fill={c} stroke={INK} strokeWidth={3.2} />
      </g>
      <g transform="rotate(11 0 0)">
        <rect x={-12} y={-30} width={24} height={42} rx={3} fill={c} stroke={INK} strokeWidth={3.2} />
      </g>
      <rect x={-13} y={-32} width={26} height={44} rx={3} fill={c} stroke={INK} strokeWidth={SW} />
      <rect x={-13} y={-14} width={26} height={10} fill="#EBD79A" stroke={INK} strokeWidth={2.5} />
      <circle cx={0} cy={-21} r={4.5} fill="#DDF0DC" stroke={INK} strokeWidth={2} />
    </g>
  ),
  // Sealed envelope gripped at its lower-left edge (0, 0)
  letter: (c) => (
    <g>
      <rect x={-24} y={-24} width={48} height={32} rx={3} fill={c} stroke={INK} strokeWidth={SW} />
      <path d="M -23 -22 L 0 -5 L 23 -22" fill="none" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <circle cx={0} cy={-5} r={4.5} fill="#C84642" stroke={INK} strokeWidth={2} />
    </g>
  ),
  // Coffee mug gripped by its handle loop right at (0, 0)
  cup: (c) => (
    <g>
      <path d="M -6 -10 Q 12 -10 12 0 Q 12 10 -6 10" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d="M -38 -18 L -4 -18 L -7 22 Q -8 26 -12 26 L -30 26 Q -34 26 -35 22 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx={-21} cy={-18} rx={17} ry={4} fill="#6F4A32" stroke={INK} strokeWidth={3} />
    </g>
  ),
  // Single brass key gripped by its bow (head) at (0, 0), blade extending cleanly forward
  key: (c) => (
    <g>
      <circle cx={0} cy={-2} r={11} fill={c} stroke={INK} strokeWidth={SW} />
      <circle cx={0} cy={-2} r={4} fill="#FFFFFF" stroke={INK} strokeWidth={2.5} />
      <path d="M -4 8 L 4 8 L 4 38 L 11 38 L 11 32 L 4 32 L 4 25 L 9 25 L 9 20 L 4 20 L 4 8 Z" fill={c} stroke={INK} strokeWidth={3.2} strokeLinejoin="round" />
    </g>
  ),
  // Formal signed contract gripped at its lower edge (0, 0)
  contract: (c) => (
    <g>
      <path d="M -22 -48 L 14 -48 L 24 -38 L 24 8 L -22 8 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M 14 -48 L 14 -38 L 24 -38" fill="#E3DCCB" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <rect x={-14} y={-40} width={22} height={4} rx={1.5} fill={INK} opacity={0.7} />
      <path d="M -14 -28 L 16 -28 M -14 -20 L 16 -20 M -14 -12 L 10 -12" stroke={INK} strokeWidth={2.4} opacity={0.45} strokeLinecap="round" />
      <path d="M -14 -2 Q -6 -7 2 -1 Q 8 2 14 -3" fill="none" stroke="#2D5FA8" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={15} cy={0} r={4} fill="#C84642" stroke={INK} strokeWidth={2} />
    </g>
  ),
  // Tote / handbag gripped cleanly at the top of its handle arch (0, 0), body hanging naturally below
  bag: (c) => (
    <g>
      <path d="M -16 18 Q -16 -2 0 -2 Q 16 -2 16 18" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <path d="M -32 22 Q -32 14 -22 14 L 22 14 Q 32 14 32 22 L 36 74 Q 36 84 26 84 L -26 84 Q -36 84 -36 74 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M -22 50 L 22 50 L 20 74 L -20 74 Z" fill="#00000024" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M -28 32 L 28 32" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
  // Medicine / pill bottle gripped around its cylinder center at (0, 0)
  pills: (c) => (
    <g>
      <rect x={-13} y={-26} width={26} height={9} rx={3} fill="#F4F1EA" stroke={INK} strokeWidth={3.2} />
      <rect x={-11} y={-17} width={22} height={36} rx={4} fill={c} stroke={INK} strokeWidth={SW} />
      <rect x={-10} y={-10} width={20} height={22} rx={1.5} fill="#FAF8F2" stroke={INK} strokeWidth={2.2} />
      <path d="M 0 -5 L 0 5 M -5 0 L 5 0" stroke="#D1493F" strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
};

export type HeldPropProps = {
  /** Grip-oriented prop name (or any HeldName). */
  kind: GripPropName | HeldName;
  color?: string;
  scale?: number;
  /** 'L' mirrors asymmetrical props horizontally so handle/fan orientation matches a left hand. */
  side?: 'L' | 'R';
  /** Extra rotation in degrees around the (0, 0) grip center. */
  angle?: number;
  /** Shift to palm center (0, 10) for direct placement inside Person's handRProp / handLProp slot. Default false ((0, 0) = grip center). */
  inPalm?: boolean;
};

/** Grip-oriented held prop anchored at (0, 0) = hand grip center for crisp, non-floating handRProp / handLProp use. */
export const HeldProp: React.FC<HeldPropProps> = ({ kind, color, scale = 1, side = 'R', angle = 0, inPalm = false }) => {
  const gripFn = GRIP_DRAW[kind as GripPropName];
  const node = gripFn
    ? gripFn(color ?? DEFAULTS[kind])
    : <g transform="translate(0 -10)">{held(kind, { color })}</g>;
  const sx = side === 'L' ? -scale : scale;
  const parts: string[] = [];
  if (inPalm) parts.push('translate(0 10)');
  if (angle) parts.push(`rotate(${angle})`);
  if (sx !== 1 || scale !== 1) parts.push(`scale(${sx} ${scale})`);
  return <g transform={parts.length ? parts.join(' ') : undefined} data-held-prop={kind}>{node}</g>;
};

/** Functional helper returning a grip-oriented <HeldProp> element for handRProp / handLProp. */
export const heldProp = (kind: GripPropName | HeldName, opts: Omit<HeldPropProps, 'kind'> = {}): React.ReactNode => (
  <HeldProp kind={kind} {...opts} />
);

/** The drawing of a held thing, for `hold`, a hand slot or `props`. Unknown names throw with the list. */
export const held = (name: HeldName | string, opts: HeldOpts = {}): React.ReactNode => {
  const fn = draw[name as HeldName];
  if (!fn) throw new Error(`hold: no object "${name}". Objects: ${HELD_NAMES.join(', ')}. For anything else draw it yourself in handRProp.`);
  return <g transform={`scale(${opts.scale ?? 1})`}>{fn(opts.color ?? DEFAULTS[name as HeldName])}</g>;
};
