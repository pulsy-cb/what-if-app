import React from 'react';
import type { CastData } from './cast';

// Clothes on the torso, for each view. Drawn in the torso's local space (shoulders about y -112, hips about y 0) inside
// the body's own size group, so a garment fits every body. Long garments simply reach lower and cover the thighs.

type View = 'front' | 'profile' | 'back';
type Ink = { line: string; accent: string; skin: string };

const stroke = (line: string) => ({ stroke: line, strokeWidth: 4, strokeLinejoin: 'round' as const });

const FRONT = (bottom: number) => `M -46 -112 Q 0 -124 46 -112 L ${40 + Math.max(0, bottom - 2) * 0.1} ${bottom} Q 0 ${bottom + 10} ${-(40 + Math.max(0, bottom - 2) * 0.1)} ${bottom} Z`;
const SIDE = (bottom: number) => `M -28 -112 Q 4 -124 30 -110 Q 34 -60 28 -18 L 28 ${bottom - 4} Q 0 ${bottom + 10} -26 ${bottom} Q -32 -54 -28 -112 Z`;

const Collar: React.FC<{ kind: string; ink: Ink; color: string; shade: string }> = ({ kind, ink, color, shade }) => {
  if (kind === 'shirt')
    return (
      <g>
        <path d="M -22 -118 L 0 -96 L 22 -118 L 12 -122 L 0 -108 L -12 -122 Z" fill="#fff" fillOpacity={0.9} stroke={ink.line} strokeWidth={3} strokeLinejoin="round" />
        <path d="M 0 -104 L 0 2" stroke={shade} strokeWidth={3} />
        {[-82, -56, -30].map((y) => <circle key={y} cx={0} cy={y} r={2.6} fill={ink.line} />)}
      </g>
    );
  if (kind === 'hoodie')
    return (
      <g>
        <path d="M -30 -118 Q 0 -96 30 -118 L 24 -108 Q 0 -90 -24 -108 Z" fill={shade} stroke={ink.line} strokeWidth={3} strokeLinejoin="round" />
        <path d="M -9 -102 L -11 -72 M 9 -102 L 11 -72" stroke={ink.accent} strokeWidth={4} strokeLinecap="round" />
        <path d="M -28 -30 L 28 -30 L 34 -4 L -34 -4 Z" fill={shade} opacity={0.6} />
      </g>
    );
  if (kind === 'sweater')
    return (
      <g>
        <path d="M -24 -118 Q 0 -102 24 -118" stroke={shade} strokeWidth={8} fill="none" strokeLinecap="round" />
        <path d="M -40 -10 L 40 -10" stroke={shade} strokeWidth={5} />
        <path d="M 0 -60 m -14 -8 l 14 -10 l 14 10 l -14 10 Z" fill={shade} opacity={0.7} />
      </g>
    );
  return <path d="M -22 -118 Q 0 -100 22 -118" stroke={color === ink.accent ? shade : ink.accent} strokeWidth={6} fill="none" strokeLinecap="round" />;
};

const Over: React.FC<{ id: string; view: View; color: string; shade: string; ink: Ink }> = ({ id, view, color, shade, ink }) => {
  const st = stroke(ink.line);
  if (id === 'apron') {
    if (view === 'front') return <path d="M -24 -104 L 24 -104 L 42 -60 L 44 44 Q 0 54 -44 44 L -42 -60 Z" fill={color} {...st} />;
    if (view === 'profile') return <path d="M 8 -104 L 26 -104 L 34 -60 L 38 42 L 14 44 Z" fill={color} {...st} />;
    return <path d="M -40 -112 L 34 -48 M 40 -112 L -34 -48 M -16 -46 L 16 -46" stroke={color} strokeWidth={7} strokeLinecap="round" fill="none" />;
  }
  const long = id === 'labcoat' || id === 'coat';
  const bottom = long ? 62 : 8;
  if (view === 'profile') {
    return (
      <g>
        <path d={SIDE(bottom)} fill={color} {...st} />
        <path d="M 6 -117 L 26 -108 L 16 -82 Z" fill={shade} {...st} />
      </g>
    );
  }
  if (view === 'back') {
    return (
      <g>
        <path d={FRONT(bottom)} fill={color} {...st} />
        <path d={`M 0 -108 L 0 ${bottom}`} stroke={shade} strokeWidth={3} />
        <path d="M -24 -118 Q 0 -108 24 -118" stroke={shade} strokeWidth={8} fill="none" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <path d={FRONT(bottom)} fill={color} {...st} />
      <path d="M -24 -116 L 0 -56 L 24 -116 Z" fill={ink.skin} opacity={0} />
      <path d={`M 0 -60 L 0 ${bottom}`} stroke={ink.line} strokeWidth={3.5} />
      <path d="M -28 -116 L -6 -60 L -22 -50 L -44 -104 Z M 28 -116 L 6 -60 L 22 -50 L 44 -104 Z" fill={shade} {...st} />
      {id === 'labcoat' ? <path d="M -36 12 L -12 12 L -12 36 L -36 36 Z M 12 12 L 36 12 L 36 36 L 12 36 Z" fill="none" stroke={shade} strokeWidth={3} /> : null}
      {id === 'coat' ? [-30, 2, 34].map((y) => <circle key={y} cx={8} cy={y} r={3.2} fill={shade} stroke={ink.line} strokeWidth={2} />) : null}
    </g>
  );
};

const Neck: React.FC<{ id: string; view: View; color: string; ink: Ink }> = ({ id, view, color, ink }) => {
  const st = { stroke: ink.line, strokeWidth: 3.5, strokeLinejoin: 'round' as const };
  if (view === 'back') return id === 'scarf' ? <path d="M -40 -114 Q 0 -98 40 -114 L 38 -96 Q 0 -82 -38 -96 Z" fill={color} {...st} /> : null;
  if (id === 'tie') return view === 'front' ? <path d="M -7 -112 L 7 -112 L 9 -100 L 5 -64 L 0 -56 L -5 -64 L -9 -100 Z" fill={color} {...st} /> : <path d="M 20 -112 L 30 -108 L 33 -66 L 26 -56 L 20 -66 Z" fill={color} {...st} />;
  if (view === 'profile') return <path d="M -24 -116 Q 6 -100 32 -112 L 32 -94 Q 6 -82 -24 -98 Z" fill={color} {...st} />;
  return (
    <g>
      <path d="M -40 -114 Q 0 -98 40 -114 L 38 -96 Q 0 -82 -38 -96 Z" fill={color} {...st} />
      <path d="M 12 -100 L 22 -52 L 6 -50 L 2 -98 Z" fill={color} {...st} />
    </g>
  );
};

/** Drawn before the torso from the front and in profile, after it from behind (a backpack comes round). */
const Backpack: React.FC<{ view: View; color: string; shade: string; line: string }> = ({ view, color, shade, line }) => {
  const st = stroke(line);
  if (view === 'front') return <path d="M -30 -116 L -32 -40 M 30 -116 L 32 -40" stroke={shade} strokeWidth={8} strokeLinecap="round" />;
  if (view === 'profile')
    return (
      <g>
        <path d="M -30 -104 Q -74 -104 -72 -60 L -70 -14 Q -56 -4 -28 -8 Z" fill={color} {...st} />
        <path d="M 2 -116 Q 26 -80 2 -46" stroke={shade} strokeWidth={7} fill="none" strokeLinecap="round" />
      </g>
    );
  return (
    <g>
      <path d="M -34 -104 Q 0 -116 34 -104 L 38 -14 Q 0 -4 -38 -14 Z" fill={color} {...st} />
      <path d="M -24 -58 L 24 -58 L 26 -22 L -26 -22 Z" fill={shade} {...st} />
    </g>
  );
};

/** The whole torso of a cast character, for one view. */
export const OutfitTorso: React.FC<{ view: View; c: CastData; line: string; accent: string; skin: string; torsoGear?: React.ReactNode }> = ({ view, c, line, accent, skin, torsoGear }) => {
  const ink: Ink = { line, accent, skin };
  const st = stroke(line);
  const { top, over, neck, back } = c;
  const base =
    view === 'profile' ? (
      <g>
        <path d={SIDE(2)} fill={top.color} {...st} />
        <path d="M -28 -112 Q -32 -54 -26 2 Q -18 8 -8 9 Q -14 -50 -10 -117 Z" fill={top.shade} opacity={0.55} />
        {top.id === 'hoodie' ? <path d="M -30 -116 Q -56 -130 -38 -96 Q -32 -92 -24 -100 Z" fill={top.shade} {...st} /> : <path d="M 6 -117 Q 18 -110 26 -112" stroke={accent} strokeWidth={6} fill="none" strokeLinecap="round" />}
      </g>
    ) : view === 'back' ? (
      <g>
        <path d={FRONT(2)} fill={top.color} {...st} />
        <path d="M 10 -116 Q 30 -114 46 -112 L 40 2 Q 26 8 12 9 Z" fill={top.shade} opacity={0.55} />
        {top.id === 'hoodie' ? <path d="M -30 -118 Q 0 -146 30 -118 Q 26 -84 0 -80 Q -26 -84 -30 -118 Z" fill={top.shade} {...st} /> : null}
      </g>
    ) : (
      <g>
        {top.id === 'hoodie' ? <path d="M -38 -116 Q 0 -160 38 -116 Z" fill={top.shade} {...st} /> : null}
        <path d={FRONT(2)} fill={top.color} {...st} />
        <path d="M 10 -116 Q 30 -114 46 -112 L 40 2 Q 26 8 12 9 Z" fill={top.shade} opacity={0.55} />
        <Collar kind={top.id} ink={ink} color={top.color} shade={top.shade} />
      </g>
    );
  return (
    <g>
      {back && view !== 'back' ? <Backpack view={view} color={back.color} shade={back.shade} line={line} /> : null}
      {base}
      {over ? <Over id={over.id} view={view} color={over.color} shade={over.shade} ink={ink} /> : null}
      {neck ? <Neck id={neck.id} view={view} color={neck.color} ink={ink} /> : null}
      {back && view === 'back' ? <Backpack view={view} color={back.color} shade={back.shade} line={line} /> : null}
      {view === 'front' ? torsoGear : null}
    </g>
  );
};

/** A skirt from the hips to the knees, following the legs, so it shortens when the person sits. */
export const Skirt: React.FC<{ knees: { x: number; y: number }[]; color: string; shade: string; line: string; hip: number }> = ({ knees, color, shade, line, hip }) => {
  const xs = knees.map((k) => k.x);
  const y = Math.max(...knees.map((k) => k.y)) + 6;
  const x0 = Math.min(...xs, -hip) - 16;
  const x1 = Math.max(...xs, hip) + 16;
  return (
    <g>
      <path d={`M -42 -6 L 42 -6 L ${x1} ${y} Q ${(x0 + x1) / 2} ${y + 10} ${x0} ${y} Z`} fill={color} stroke={line} strokeWidth={4} strokeLinejoin="round" />
      <path d={`M 10 -4 L 42 -6 L ${x1} ${y} L 16 ${y + 3} Z`} fill={shade} opacity={0.5} />
    </g>
  );
};
