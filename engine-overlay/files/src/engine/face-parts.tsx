import React from 'react';
import type { CastData } from './cast';

// What makes one face differ from another, drawn over the head: brows at rest, nose, marks, facial hair, eyewear,
// earrings, a headband. A few strokes each. Nothing here on the back of a head except the headband.

const Y = -176;
type View = 'front' | 'three-quarter' | 'profile' | 'back';
const NO_BROW = new Set(['neutral', 'happy', 'cool', 'dizzy']);

export const FaceParts: React.FC<{ view: View; yaw: number; expr: string; c: CastData; ink: string; hair: string }> = ({ view, yaw, expr, c, ink, hair }) => {
  const f = c.face;
  const stroke = { stroke: ink, fill: 'none', strokeLinecap: 'round' as const };
  if (view === 'back') {
    return c.headband ? <path d={`M -62 ${Y - 26} Q 0 ${Y - 44} 62 ${Y - 26} L 60 ${Y - 12} Q 0 ${Y - 30} -60 ${Y - 12} Z`} fill={c.headband} stroke={ink} strokeWidth={3.5} /> : null;
  }

  if (view === 'profile') {
    const ex = 32;
    const ey = Y - 8;
    return (
      <g>
        {f.brows !== 'none' && NO_BROW.has(expr) ? <path d={f.brows === 'arched' ? `M ${ex - 11} ${ey - 15} Q ${ex} ${ey - 26} ${ex + 12} ${ey - 16}` : `M ${ex - 11} ${ey - 17} L ${ex + 12} ${ey - 18}`} {...stroke} strokeWidth={c.browW ?? 5} /> : null}
        {f.marks === 'freckles' ? [[22, 12], [32, 16], [42, 12], [28, 22]].map(([x, y], i) => <circle key={i} cx={x} cy={Y + y!} r={2.2} fill={ink} opacity={0.5} />) : null}
        {f.marks === 'mole' ? <circle cx={42} cy={Y + 22} r={3.2} fill={ink} /> : null}
        {f.marks === 'blush' ? <ellipse cx={26} cy={Y + 18} rx={15} ry={9} fill="#E06A6A" opacity={0.35} /> : null}
        {f.marks === 'dimples' ? <path d={`M 28 ${Y + 28} q -3 5 0 9`} {...stroke} strokeWidth={3} opacity={0.6} /> : null}
        {f.marks === 'wrinkles' ? <path d={`M 18 ${Y - 40} Q 32 ${Y - 44} 46 ${Y - 38} M 44 ${Y - 2} l 7 3`} {...stroke} strokeWidth={2.5} opacity={0.55} /> : null}
        {f.facial === 'stubble' ? <path d={`M 2 ${Y + 30} Q 6 ${Y + 58} 30 ${Y + 54} Q 50 ${Y + 46} 58 ${Y + 24} Q 40 ${Y + 42} 18 ${Y + 40} Z`} fill={hair} opacity={0.3} /> : null}
        {f.facial === 'beard' ? <path d={`M 2 ${Y + 20} Q 4 ${Y + 66} 44 ${Y + 64} Q 64 ${Y + 58} 62 ${Y + 28} Q 42 ${Y + 40} 20 ${Y + 36} Z`} fill={hair} opacity={0.92} /> : null}
        {f.facial === 'goatee' ? <path d={`M 34 ${Y + 46} Q 38 ${Y + 66} 52 ${Y + 60} Q 60 ${Y + 54} 58 ${Y + 44} Q 46 ${Y + 50} 34 ${Y + 46} Z`} fill={hair} /> : null}
        {f.facial === 'mustache' ? <path d={`M 44 ${Y + 24} Q 62 ${Y + 16} 74 ${Y + 25} Q 60 ${Y + 31} 44 ${Y + 28} Z`} fill={hair} /> : null}
        {c.headband ? <path d={`M -58 ${Y - 22} Q 0 ${Y - 44} 58 ${Y - 30} L 60 ${Y - 16} Q 0 ${Y - 30} -60 ${Y - 8} Z`} fill={c.headband} stroke={ink} strokeWidth={3.5} /> : null}
        {c.earrings ? <circle cx={-12} cy={Y + 28} r={5} fill="#E9C46A" stroke={ink} strokeWidth={2.5} /> : null}
        {c.eyewear === 'round' || c.eyewear === 'square' ? (
          <g>
            {c.eyewear === 'round' ? <circle cx={ex + 2} cy={ey} r={15} fill="#BFE3F2" fillOpacity={0.3} stroke={ink} strokeWidth={4} /> : <rect x={ex - 13} y={ey - 12} width={30} height={24} rx={4} fill="#BFE3F2" fillOpacity={0.3} stroke={ink} strokeWidth={4} />}
            <path d={`M ${ex - 13} ${ey - 2} L -14 ${Y - 2}`} {...stroke} strokeWidth={4} />
          </g>
        ) : null}
      </g>
    );
  }

  // front and three-quarter: the same transform the face itself uses
  const ay = Math.min(1, Math.abs(yaw));
  const eyeY = Y - 4;
  const glass = (cx: number) =>
    c.eyewear === 'round' ? <circle key={cx} cx={cx} cy={eyeY} r={16} fill="#BFE3F2" fillOpacity={0.3} stroke={ink} strokeWidth={4} /> : <rect key={cx} x={cx - 16} y={eyeY - 13} width={32} height={26} rx={5} fill="#BFE3F2" fillOpacity={0.3} stroke={ink} strokeWidth={4} />;
  const browAt = (cx: number) =>
    f.brows === 'arched' ? `M ${cx - 12} ${eyeY - 17} Q ${cx} ${eyeY - 29} ${cx + 12} ${eyeY - 17}` : `M ${cx - 12} ${eyeY - 20} L ${cx + 12} ${eyeY - 21}`;
  return (
    <g>
      <g transform={`translate(${yaw * 30} 0) scale(${1 - 0.28 * ay} 1)`}>
        {f.brows !== 'none' && NO_BROW.has(expr) ? <path d={`${browAt(-21)} ${browAt(21)}`} {...stroke} strokeWidth={c.browW ?? 5} /> : null}
        {view === 'front' && f.nose !== 'none' ? <path d={f.nose === 'button' ? `M -6 ${Y + 12} Q 0 ${Y + 18} 6 ${Y + 12}` : f.nose === 'long' ? `M 0 ${Y - 2} L 3 ${Y + 16} L -4 ${Y + 18}` : `M -11 ${Y + 12} Q 0 ${Y + 22} 11 ${Y + 12}`} {...stroke} strokeWidth={4} /> : null}
        {f.marks === 'freckles' ? [[-34, 14], [-26, 19], [-18, 14], [18, 14], [26, 19], [34, 14]].map(([x, y], i) => <circle key={i} cx={x} cy={Y + y!} r={2.2} fill={ink} opacity={0.5} />) : null}
        {f.marks === 'mole' ? <circle cx={24} cy={Y + 22} r={3.2} fill={ink} /> : null}
        {f.marks === 'blush' ? [-32, 32].map((x) => <ellipse key={x} cx={x} cy={Y + 18} rx={14} ry={8} fill="#E06A6A" opacity={0.35} />) : null}
        {f.marks === 'dimples' ? <path d={`M -24 ${Y + 26} q -3 5 0 9 M 24 ${Y + 26} q 3 5 0 9`} {...stroke} strokeWidth={3} opacity={0.6} /> : null}
        {f.marks === 'wrinkles' ? <path d={`M -24 ${Y - 36} Q 0 ${Y - 42} 24 ${Y - 36} M -18 ${Y - 28} Q 0 ${Y - 32} 18 ${Y - 28}`} {...stroke} strokeWidth={2.5} opacity={0.55} /> : null}
        {f.facial === 'stubble' ? <path d={`M -48 ${Y + 18} Q -42 ${Y + 62} 0 ${Y + 62} Q 42 ${Y + 62} 48 ${Y + 18} Q 24 ${Y + 42} 0 ${Y + 40} Q -24 ${Y + 42} -48 ${Y + 18} Z`} fill={hair} opacity={0.22} /> : null}
        {f.facial === 'beard' ? <path d={`M -44 ${Y + 14} Q -42 ${Y + 62} 0 ${Y + 64} Q 42 ${Y + 62} 44 ${Y + 14} Q 22 ${Y + 30} 0 ${Y + 28} Q -22 ${Y + 30} -44 ${Y + 14} Z`} fill={hair} opacity={0.9} /> : null}
        {f.facial === 'goatee' ? <path d={`M -14 ${Y + 46} Q 0 ${Y + 72} 14 ${Y + 46} Q 0 ${Y + 54} -14 ${Y + 46} Z`} fill={hair} /> : null}
        {f.facial === 'mustache' ? <path d={`M -22 ${Y + 22} Q -10 ${Y + 12} 0 ${Y + 19} Q 10 ${Y + 12} 22 ${Y + 22} Q 10 ${Y + 26} 0 ${Y + 22} Q -10 ${Y + 26} -22 ${Y + 22} Z`} fill={hair} /> : null}
        {c.eyewear === 'round' || c.eyewear === 'square' ? (
          <g>
            {glass(-21)}
            {glass(21)}
            <path d={`M -6 ${eyeY - 1} Q 0 ${eyeY - 6} 6 ${eyeY - 1}`} {...stroke} strokeWidth={4} />
          </g>
        ) : null}
      </g>
      {c.headband ? <path transform={`translate(${-yaw * 10} 0)`} d={`M -60 ${Y - 28} Q 0 ${Y - 54} 60 ${Y - 28} L 61 ${Y - 14} Q 0 ${Y - 40} -61 ${Y - 14} Z`} fill={c.headband} stroke={ink} strokeWidth={3.5} /> : null}
      {c.earrings ? (yaw > 0.3 ? [-60] : yaw < -0.3 ? [60] : [-60, 60]).map((x) => <circle key={x} cx={x} cy={Y + 26} r={5} fill="#E9C46A" stroke={ink} strokeWidth={2.5} />) : null}
    </g>
  );
};
