import React from 'react';

// Things a person holds. `hold: 'bag'` on a person in shot() puts one in the hand; held('bag', { color }) gives the
// same drawing for a handRProp / handLProp slot or for `props` on a piece. Drawn in the hand's own space: the palm is
// at (0, 10), y grows away from the wrist, about 11 units is half a hand. Flat fills, one dark line, like the people.

const INK = '#1F1B2E';
const SW = 4;

export type HeldName = 'phone' | 'handset' | 'bag' | 'paper' | 'crumpled' | 'cup' | 'keys' | 'book' | 'pen' | 'folder' | 'box';
export const HELD_NAMES: HeldName[] = ['phone', 'handset', 'bag', 'paper', 'crumpled', 'cup', 'keys', 'book', 'pen', 'folder', 'box'];
export type HeldOpts = { color?: string; scale?: number };

const DEFAULTS: Record<HeldName, string> = {
  phone: '#2B2F3A', handset: '#E7DCC2', bag: '#2F4A78', paper: '#F6F1E4', crumpled: '#F1ECDD', cup: '#F3EEE2',
  keys: '#C9A546', book: '#A8443B', pen: '#2D5FA8', folder: '#D8B45A', box: '#B98A56',
};

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
};

/** The drawing of a held thing, for `hold`, a hand slot or `props`. Unknown names throw with the list. */
export const held = (name: HeldName | string, opts: HeldOpts = {}): React.ReactNode => {
  const fn = draw[name as HeldName];
  if (!fn) throw new Error(`hold: no object "${name}". Objects: ${HELD_NAMES.join(', ')}. For anything else draw it yourself in handRProp.`);
  return <g transform={`scale(${opts.scale ?? 1})`}>{fn(opts.color ?? DEFAULTS[name as HeldName])}</g>;
};
