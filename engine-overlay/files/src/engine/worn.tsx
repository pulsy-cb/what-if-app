import React from 'react';

// Things a person wears, and animal heads on a human body. On a person in shot():
//   wear: ['eye-mask', { what: 'collar', color: '#8A8A8A' }]      accessories
//   animal: 'lion'   or   animal: { kind: 'cat', fur: '#D98A3A' } ears, muzzle, whiskers, mane: an animal that stands and talks
// Two agents drew a mane, jaws and a collar by hand in `extra` (2026-11-13): the pieces did not follow the head.
// Everything here is drawn in the head's own space (centre 0, -176, radius 62) or the torso's (neck at y -112), so it
// follows the body. `yaw` slides what sits on the face toward the side the person looks at.

const INK = '#1F1B2E';
const SW = 4;
const HY = -176;
const R = 62;

export type WornName =
  | 'crown' | 'party-hat' | 'halo' | 'headphones' | 'headband' | 'bandage' | 'horns'
  | 'eye-mask' | 'face-mask' | 'eye-patch' | 'sunglasses' | 'clown-nose'
  | 'cat-ears' | 'bunny-ears' | 'bear-ears' | 'dog-ears'
  | 'collar' | 'tie' | 'bow-tie' | 'scarf' | 'badge' | 'medal' | 'necklace';
export type AnimalKind = 'cat' | 'dog' | 'lion' | 'bear' | 'rabbit' | 'wolf' | 'fox' | 'pig' | 'mouse';
export type WornOpts = { color?: string; yaw?: number };
export type WornSpec = WornName | ({ what: WornName } & WornOpts);
export type AnimalSpec = AnimalKind | { kind: AnimalKind; fur?: string; inner?: string };

const TORSO: WornName[] = ['collar', 'tie', 'bow-tie', 'scarf', 'badge', 'medal', 'necklace'];
export const WORN_NAMES: WornName[] = [
  'crown', 'party-hat', 'halo', 'headphones', 'headband', 'bandage', 'horns', 'eye-mask', 'face-mask', 'eye-patch', 'sunglasses', 'clown-nose',
  'cat-ears', 'bunny-ears', 'bear-ears', 'dog-ears', 'collar', 'tie', 'bow-tie', 'scarf', 'badge', 'medal', 'necklace',
];
export const ANIMAL_KINDS: AnimalKind[] = ['cat', 'dog', 'lion', 'bear', 'rabbit', 'wolf', 'fox', 'pig', 'mouse'];
export const wornOnTorso = (name: string): boolean => TORSO.includes(name as WornName);

const DEFAULTS: Record<WornName, string> = {
  crown: '#E3B93C', 'party-hat': '#E05A6A', halo: '#F4D35E', headphones: '#2B2F3A', headband: '#D9453B', bandage: '#F1ECDD', horns: '#B5352B',
  'eye-mask': '#22202C', 'face-mask': '#BFE0EA', 'eye-patch': '#22202C', sunglasses: '#16151D', 'clown-nose': '#D9352B',
  'cat-ears': '#3A3A44', 'bunny-ears': '#F1ECE4', 'bear-ears': '#7A5236', 'dog-ears': '#8A5A34',
  collar: '#C0392B', tie: '#2D4A8A', 'bow-tie': '#B5352B', scarf: '#C9453B', badge: '#E3B93C', medal: '#E3B93C', necklace: '#E3B93C',
};

/** how far a thing on the face slides when the head turns */
const slide = (yaw = 0) => Math.max(-1, Math.min(1, yaw)) * 20;

const ears = (kind: 'point' | 'round' | 'long' | 'flop', c: string, inner: string): React.ReactNode => {
  if (kind === 'long') return (
    <g>
      {[-1, 1].map((s) => (
        <g key={s} transform={`translate(${s * 26} ${HY - R + 8}) rotate(${s * 8})`}>
          <path d="M -13 0 Q -17 -72 0 -92 Q 17 -72 13 0 Z" fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M -6 -8 Q -8 -58 0 -74 Q 8 -58 6 -8 Z" fill={inner} />
        </g>
      ))}
    </g>
  );
  if (kind === 'flop') return (
    <g>
      {[-1, 1].map((s) => (
        <path key={s} d={`M ${s * 44} ${HY - 40} Q ${s * 82} ${HY - 34} ${s * 78} ${HY + 20} Q ${s * 70} ${HY + 40} ${s * 56} ${HY + 8} Z`} fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      ))}
    </g>
  );
  if (kind === 'round') return (
    <g>
      {[-1, 1].map((s) => (
        <g key={s}>
          <circle cx={s * 46} cy={HY - 50} r={20} fill={c} stroke={INK} strokeWidth={SW} />
          <circle cx={s * 46} cy={HY - 50} r={9} fill={inner} />
        </g>
      ))}
    </g>
  );
  return (
    <g>
      {[-1, 1].map((s) => (
        <g key={s}>
          <path d={`M ${s * 24} ${HY - 54} L ${s * 52} ${HY - 92} L ${s * 60} ${HY - 34} Z`} fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d={`M ${s * 36} ${HY - 54} L ${s * 50} ${HY - 76} L ${s * 54} ${HY - 44} Z`} fill={inner} />
        </g>
      ))}
    </g>
  );
};

const draw: Record<WornName, (c: string, dx: number) => React.ReactNode> = {
  crown: (c) => (
    <g>
      <path d={`M -44 ${HY - 48} L -48 ${HY - 92} L -24 ${HY - 70} L 0 ${HY - 100} L 24 ${HY - 70} L 48 ${HY - 92} L 44 ${HY - 48} Z`} fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx={0} cy={HY - 64} r={6} fill="#D9453B" stroke={INK} strokeWidth={2.5} />
    </g>
  ),
  'party-hat': (c) => (
    <g>
      <path d={`M -30 ${HY - 52} L 4 ${HY - 128} L 34 ${HY - 50} Z`} fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx={4} cy={HY - 130} r={9} fill="#F4D35E" stroke={INK} strokeWidth={3} />
    </g>
  ),
  halo: (c) => <ellipse cx={0} cy={HY - R - 26} rx={44} ry={11} fill="none" stroke={c} strokeWidth={8} />,
  headphones: (c) => (
    <g>
      <path d={`M -62 ${HY} Q -62 ${HY - 78} 0 ${HY - 78} Q 62 ${HY - 78} 62 ${HY}`} fill="none" stroke={c} strokeWidth={9} />
      {[-1, 1].map((s) => <rect key={s} x={s * 62 - 13} y={HY - 20} width={26} height={44} rx={10} fill={c} stroke={INK} strokeWidth={SW} />)}
    </g>
  ),
  headband: (c) => <path d={`M -60 ${HY - 22} Q 0 ${HY - 44} 60 ${HY - 22} L 60 ${HY - 8} Q 0 ${HY - 30} -60 ${HY - 8} Z`} fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />,
  bandage: (c) => (
    <g>
      <path d={`M -60 ${HY - 30} Q 0 ${HY - 52} 60 ${HY - 30} L 61 ${HY - 10} Q 0 ${HY - 32} -61 ${HY - 10} Z`} fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <circle cx={-26} cy={HY - 30} r={7} fill="#D9453B" opacity={0.7} />
    </g>
  ),
  horns: (c) => (
    <g>
      {[-1, 1].map((s) => <path key={s} d={`M ${s * 30} ${HY - 54} Q ${s * 58} ${HY - 70} ${s * 50} ${HY - 104} Q ${s * 38} ${HY - 78} ${s * 18} ${HY - 60} Z`} fill={c} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />)}
    </g>
  ),
  'eye-mask': (c, dx) => (
    <g transform={`translate(${dx} 0)`}>
      <path d={`M -52 ${HY - 16} Q 0 ${HY - 30} 52 ${HY - 16} Q 56 ${HY + 6} 28 ${HY + 8} Q 0 ${HY - 4} -28 ${HY + 8} Q -56 ${HY + 6} -52 ${HY - 16} Z`} fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <ellipse cx={-24} cy={HY - 6} rx={9} ry={7} fill="#F4F1EA" />
      <ellipse cx={24} cy={HY - 6} rx={9} ry={7} fill="#F4F1EA" />
      <circle cx={-24} cy={HY - 6} r={3.5} fill={INK} />
      <circle cx={24} cy={HY - 6} r={3.5} fill={INK} />
    </g>
  ),
  'face-mask': (c, dx) => (
    <g transform={`translate(${dx * 0.6} 0)`}>
      <path d={`M -46 ${HY + 8} Q 0 ${HY - 2} 46 ${HY + 8} L 40 ${HY + 46} Q 0 ${HY + 62} -40 ${HY + 46} Z`} fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d={`M -32 ${HY + 22} L 32 ${HY + 22} M -28 ${HY + 34} L 28 ${HY + 34}`} stroke={INK} strokeWidth={2} opacity={0.35} />
      <path d={`M -46 ${HY + 10} L -60 ${HY - 2} M 46 ${HY + 10} L 60 ${HY - 2}`} stroke={INK} strokeWidth={3} />
    </g>
  ),
  'eye-patch': (c, dx) => (
    <g transform={`translate(${dx} 0)`}>
      <path d={`M -58 ${HY - 36} L 60 ${HY - 4}`} stroke={c} strokeWidth={5} />
      <path d={`M 8 ${HY - 20} L 40 ${HY - 16} L 36 ${HY + 8} Q 22 ${HY + 14} 10 ${HY + 4} Z`} fill={c} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
    </g>
  ),
  sunglasses: (c, dx) => (
    <g transform={`translate(${dx} 0)`}>
      <rect x={-46} y={HY - 20} width={38} height={26} rx={8} fill={c} stroke={INK} strokeWidth={3.5} />
      <rect x={8} y={HY - 20} width={38} height={26} rx={8} fill={c} stroke={INK} strokeWidth={3.5} />
      <path d={`M -8 ${HY - 10} L 8 ${HY - 10}`} stroke={INK} strokeWidth={4} />
    </g>
  ),
  'clown-nose': (c, dx) => <circle cx={dx * 1.2} cy={HY + 10} r={13} fill={c} stroke={INK} strokeWidth={3.5} />,
  'cat-ears': (c) => ears('point', c, '#E7A6A6'),
  'bunny-ears': (c) => ears('long', c, '#F0B8C0'),
  'bear-ears': (c) => ears('round', c, '#C99A74'),
  'dog-ears': (c) => ears('flop', c, c),
  collar: (c) => (
    <g>
      <path d="M -28 -116 Q 0 -104 28 -116 L 28 -104 Q 0 -92 -28 -104 Z" fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <circle cx={0} cy={-92} r={7} fill="#E3B93C" stroke={INK} strokeWidth={2.5} />
    </g>
  ),
  tie: (c) => <path d="M -8 -108 L 8 -108 L 5 -96 L 12 -52 L 0 -40 L -12 -52 L -5 -96 Z" fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />,
  'bow-tie': (c) => (
    <g>
      <path d="M 0 -104 L -22 -116 L -22 -92 Z M 0 -104 L 22 -116 L 22 -92 Z" fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <circle cx={0} cy={-104} r={5} fill={c} stroke={INK} strokeWidth={3} />
    </g>
  ),
  scarf: (c) => (
    <g>
      <path d="M -32 -120 Q 0 -104 32 -120 L 34 -100 Q 0 -84 -34 -100 Z" fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M 10 -98 L 26 -98 L 30 -48 L 12 -44 Z" fill={c} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
    </g>
  ),
  badge: (c) => <path d="M 14 -86 L 30 -86 L 30 -72 Q 22 -62 14 -72 Z" fill={c} stroke={INK} strokeWidth={3} strokeLinejoin="round" />,
  medal: (c) => (
    <g>
      <path d="M -14 -112 L 0 -70 L 14 -112" fill="none" stroke="#C0392B" strokeWidth={6} />
      <circle cx={0} cy={-62} r={12} fill={c} stroke={INK} strokeWidth={3.5} />
    </g>
  ),
  necklace: (c) => (
    <g>
      <path d="M -22 -114 Q 0 -78 22 -114" fill="none" stroke={c} strokeWidth={4} />
      <circle cx={0} cy={-90} r={6} fill={c} stroke={INK} strokeWidth={2.5} />
    </g>
  ),
};

/** One thing worn. Unknown names throw with the list. */
export const worn = (name: WornName | string, opts: WornOpts = {}): React.ReactNode => {
  const fn = draw[name as WornName];
  if (!fn) throw new Error(`wear: nothing called "${name}". On the head: ${WORN_NAMES.filter((n) => !wornOnTorso(n)).join(', ')}. On the torso: ${TORSO.join(', ')}. Animal heads: animal: '${ANIMAL_KINDS.join("' | '")}'. For anything else draw it in headGear / torsoGear (head centre 0, -176, radius 62).`);
  return fn(opts.color ?? DEFAULTS[name as WornName], slide(opts.yaw));
};

const ANIMALS: Record<AnimalKind, { ears: 'point' | 'round' | 'long' | 'flop'; fur: string; inner: string; muzzle: string; nose: string; whiskers?: boolean; mane?: boolean; snout?: 'flat' | 'long' }> = {
  cat: { ears: 'point', fur: '#8A8A93', inner: '#E7A6A6', muzzle: '#F1ECE4', nose: '#D98A93', whiskers: true },
  dog: { ears: 'flop', fur: '#9A6A3C', inner: '#9A6A3C', muzzle: '#EBDDC8', nose: '#22202C', snout: 'long' },
  lion: { ears: 'round', fur: '#D9A441', inner: '#B9792B', muzzle: '#F3E3BF', nose: '#7A4A2A', whiskers: true, mane: true },
  bear: { ears: 'round', fur: '#7A5236', inner: '#C99A74', muzzle: '#D9BE9C', nose: '#22202C' },
  rabbit: { ears: 'long', fur: '#EDE7DD', inner: '#F0B8C0', muzzle: '#FFFFFF', nose: '#E59AA6', whiskers: true },
  wolf: { ears: 'point', fur: '#6E7480', inner: '#B9BDC6', muzzle: '#DADDE3', nose: '#22202C', snout: 'long' },
  fox: { ears: 'point', fur: '#D9772B', inner: '#3A2A22', muzzle: '#F6EFE4', nose: '#22202C', snout: 'long' },
  pig: { ears: 'point', fur: '#EFA9A9', inner: '#E08C94', muzzle: '#E89AA0', nose: '#C76B76', snout: 'flat' },
  mouse: { ears: 'round', fur: '#A9A4A0', inner: '#F0B8C0', muzzle: '#EFEAE4', nose: '#E59AA6', whiskers: true },
};

/** An animal's head on a person: what goes behind the face (mane), and on it (ears, muzzle, nose, whiskers). */
export const animalHead = (spec: AnimalSpec, yaw = 0): React.ReactNode => {
  const kind = typeof spec === 'string' ? spec : spec?.kind;
  const def = ANIMALS[kind as AnimalKind];
  if (!def) throw new Error(`animal: no "${kind}". Animals: ${ANIMAL_KINDS.join(', ')}. Give your own colours with animal: { kind: 'cat', fur: '#D98A3A' }.`);
  const fur = (typeof spec === 'object' && spec.fur) || def.fur;
  const inner = (typeof spec === 'object' && spec.inner) || def.inner;
  const dx = slide(yaw);
  const my = HY + 20;
  return (
    <g>
      {def.mane ? (
        <g>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            // a ring of tufts around the head: the face itself stays the person's own, so it still talks and frowns
            return <circle key={i} cx={Math.cos(a) * (R + 17)} cy={HY + Math.sin(a) * (R + 17)} r={20} fill={inner} stroke={INK} strokeWidth={3.5} />;
          })}
        </g>
      ) : null}
      {ears(def.ears, fur, inner)}
      <g transform={`translate(${dx} 0)`}>
        {def.snout === 'flat' ? (
          <g>
            <ellipse cx={0} cy={my - 12} rx={22} ry={15} fill={def.muzzle} stroke={INK} strokeWidth={3.5} />
            <ellipse cx={-8} cy={my - 12} rx={4} ry={6} fill={def.nose} />
            <ellipse cx={8} cy={my - 12} rx={4} ry={6} fill={def.nose} />
          </g>
        ) : (
          <g>
            {/* two pads and a nose above the mouth: the mouth below is the person's own and keeps moving */}
            <circle cx={-12} cy={my - 6} r={def.snout === 'long' ? 15 : 13} fill={def.muzzle} stroke={INK} strokeWidth={3} />
            <circle cx={12} cy={my - 6} r={def.snout === 'long' ? 15 : 13} fill={def.muzzle} stroke={INK} strokeWidth={3} />
            <path d={`M -10 ${my - 22} Q 0 ${my - 28} 10 ${my - 22} Q 6 ${my - 10} 0 ${my - 8} Q -6 ${my - 10} -10 ${my - 22} Z`} fill={def.nose} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          </g>
        )}
        {def.whiskers ? (
          <path d={`M -26 ${my - 10} L -58 ${my - 18} M -26 ${my - 2} L -58 ${my + 2} M 26 ${my - 10} L 58 ${my - 18} M 26 ${my - 2} L 58 ${my + 2}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
        ) : null}
      </g>
    </g>
  );
};
