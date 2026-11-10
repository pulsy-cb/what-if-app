import React from 'react';

// The hairstyles the rig's own head does not have. Each is two layers, `behind` the head and `over` it, drawn for the
// front, for a profile facing screen-right (the caller mirrors for the left) and for the back. Three-quarter uses the front.

const Y = -176;
type View = 'front' | 'profile' | 'back';
type Part = 'behind' | 'over';

const CAP_FRONT = `M -60 ${Y - 16} Q -62 ${Y - 70} 0 ${Y - 70} Q 62 ${Y - 70} 60 ${Y - 16} Q 36 ${Y - 46} 4 ${Y - 44} Q -30 ${Y - 46} -60 ${Y - 16} Z`;
const CAP_SIDE = `M -60 ${Y + 2} Q -64 ${Y - 70} 6 ${Y - 68} Q 56 ${Y - 62} 58 ${Y - 26} Q 30 ${Y - 46} 2 ${Y - 40} Q -34 ${Y - 38} -60 ${Y + 2} Z`;
const BOWL = `M -60 ${Y + 16} A 62 62 0 1 1 60 ${Y + 16} Q 40 ${Y + 46} 0 ${Y + 48} Q -40 ${Y + 46} -60 ${Y + 16} Z`;

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(v);
  return out;
};

export const HairLayer: React.FC<{ style: string; view: View; part: Part; color: string; line: string }> = ({ style, view, part, color, line }) => {
  const st = { fill: color, stroke: line, strokeWidth: 4, strokeLinejoin: 'round' as const };
  const flat = { fill: color };
  const path = (d: string) => <path d={d} {...st} />;
  const cap = view === 'front' ? path(CAP_FRONT) : view === 'profile' ? path(CAP_SIDE) : path(BOWL);
  const beads = (xs: number[], ys: number[], r: number) =>
    xs.flatMap((x, i) => ys.map((y, k) => <circle key={`${i}-${k}`} cx={x} cy={y} r={r - k * 0.5} {...st} />));

  switch (style) {
    case 'long':
      if (view === 'front') return part === 'behind' ? path(`M -74 ${Y + 86} Q -88 ${Y - 74} 0 ${Y - 76} Q 88 ${Y - 74} 74 ${Y + 86} Q 0 ${Y + 96} -74 ${Y + 86} Z`) : cap;
      if (view === 'profile') return part === 'behind' ? path(`M 10 ${Y - 66} Q -84 ${Y - 66} -82 ${Y + 88} Q -56 ${Y + 96} -30 ${Y + 86} Q -30 ${Y + 10} 8 ${Y - 40} Z`) : cap;
      return part === 'over' ? path(`M -76 ${Y + 90} Q -88 ${Y - 74} 0 ${Y - 76} Q 88 ${Y - 74} 76 ${Y + 90} Q 0 ${Y + 102} -76 ${Y + 90} Z`) : null;
    case 'bun': {
      const at = view === 'profile' ? { x: -34, y: Y - 66 } : { x: 0, y: Y - 80 };
      if (view === 'back') return part === 'over' ? <g>{cap}<circle cx={at.x} cy={at.y + 20} r={24} {...st} /></g> : null;
      return part === 'behind' ? <circle cx={at.x} cy={at.y} r={24} {...st} /> : cap;
    }
    case 'buzz':
      if (part !== 'over') return null;
      if (view === 'front') return <path d={`M -60 ${Y - 12} A 62 62 0 0 1 60 ${Y - 12} Q 0 ${Y - 44} -60 ${Y - 12} Z`} {...flat} opacity={0.85} />;
      if (view === 'profile') return <path d={`M -60 ${Y + 8} Q -64 ${Y - 66} 8 ${Y - 64} Q 46 ${Y - 60} 54 ${Y - 34} Q 20 ${Y - 44} -14 ${Y - 26} Q -30 ${Y - 14} -36 ${Y + 12} Z`} {...flat} opacity={0.85} />;
      return <path d={BOWL} {...flat} opacity={0.85} />;
    case 'sidepart':
      if (part !== 'over') return null;
      if (view === 'front') return path(`M -60 ${Y - 14} Q -66 ${Y - 74} 8 ${Y - 72} Q 66 ${Y - 66} 60 ${Y - 14} Q 46 ${Y - 40} 24 ${Y - 48} L 10 ${Y - 66} Q -6 ${Y - 40} -60 ${Y - 14} Z`);
      return cap;
    case 'wavy': {
      const ys = range(Y - 8, Y + 48, 26);
      if (view === 'front') return part === 'behind' ? <g>{beads([-66, 66], ys, 22)}</g> : cap;
      if (view === 'profile') return part === 'behind' ? <g>{beads([-60], ys, 24)}</g> : cap;
      return part === 'over' ? <g>{path(BOWL)}{beads([-52, 0, 52], ys.slice(1), 22)}</g> : null;
    }
    case 'fringe':
      if (part !== 'over') return null;
      if (view === 'front') return path(`M -60 ${Y - 6} Q -62 ${Y - 70} 0 ${Y - 70} Q 62 ${Y - 70} 60 ${Y - 6} L 44 ${Y - 22} L 22 ${Y - 18} L 0 ${Y - 22} L -22 ${Y - 18} L -44 ${Y - 22} Z`);
      if (view === 'profile') return path(`M -60 ${Y + 2} Q -64 ${Y - 70} 6 ${Y - 68} Q 56 ${Y - 62} 60 ${Y - 18} L 44 ${Y - 26} L 26 ${Y - 20} Q -30 ${Y - 34} -60 ${Y + 2} Z`);
      return cap;
    case 'mohawk':
      if (part !== 'over') return null;
      if (view === 'profile') return path(`M -52 ${Y - 36} L -68 ${Y - 72} L -38 ${Y - 66} L -36 ${Y - 100} L -10 ${Y - 74} L 8 ${Y - 108} L 22 ${Y - 72} L 48 ${Y - 86} L 44 ${Y - 48} Q 0 ${Y - 70} -52 ${Y - 36} Z`);
      return path(`M -18 ${Y - 54} L -24 ${Y - 94} L -8 ${Y - 80} L -4 ${Y - 110} L 6 ${Y - 84} L 18 ${Y - 102} L 18 ${Y - 54} Q 0 ${Y - 64} -18 ${Y - 54} Z`);
    case 'dreads': {
      const strand = (x: number, k: number, len = 78) => <rect key={k} x={x - 9} y={Y - 6} width={18} height={len + (k % 2) * 8} rx={9} {...st} />;
      if (view === 'front') return part === 'behind' ? <g>{[-72, -54, 54, 72].map((x, k) => strand(x, k, 86))}</g> : cap;
      if (view === 'profile') return part === 'behind' ? <g>{[-74, -58, -42].map((x, k) => strand(x, k, 86))}</g> : cap;
      return part === 'over' ? <g>{path(BOWL)}{[-48, -24, 0, 24, 48].map((x, k) => strand(x, k, 90))}</g> : null;
    }
    case 'braids': {
      const ys = range(Y + 24, Y + 104, 18);
      if (part === 'behind') return null;
      if (view === 'front') return <g>{cap}{beads([-60, 60], ys, 11)}</g>;
      if (view === 'profile') return <g>{cap}{beads([-54], ys, 11)}</g>;
      return <g>{path(BOWL)}{beads([-18, 18], ys, 11)}</g>;
    }
    case 'hijab': {
      if (view === 'front') {
        const outer = `M -78 ${Y + 86} Q -90 ${Y - 80} 0 ${Y - 82} Q 90 ${Y - 80} 78 ${Y + 86} Q 0 ${Y + 104} -78 ${Y + 86} Z`;
        if (part === 'behind') return path(outer);
        return <path d={`${outer} M -46 ${Y + 2} a 46 54 0 1 0 92 0 a 46 54 0 1 0 -92 0 Z`} fillRule="evenodd" {...st} />;
      }
      if (view === 'profile') return part === 'over' ? path(`M 54 ${Y - 46} Q 30 ${Y - 88} -14 ${Y - 84} Q -82 ${Y - 76} -80 ${Y + 12} Q -78 ${Y + 76} -30 ${Y + 90} L 36 ${Y + 84} Q 10 ${Y + 62} 8 ${Y + 20} Q 10 ${Y - 30} 54 ${Y - 46} Z`) : null;
      return part === 'over' ? path(`M -78 ${Y + 88} Q -90 ${Y - 80} 0 ${Y - 82} Q 90 ${Y - 80} 78 ${Y + 88} Q 0 ${Y + 106} -78 ${Y + 88} Z`) : null;
    }
    case 'braided-bun': {
      // a high braided bun (three stacked braid lobes) with loose strands down the temples
      const top = view === 'profile' ? { x: -18, y: Y - 92 } : { x: 0, y: Y - 98 };
      const braid = (
        <g>
          {[0, 1, 2].map((k) => <ellipse key={k} cx={top.x + (k - 1) * 3} cy={top.y + 22 - k * 16} rx={26 - k * 4} ry={13} {...st} />)}
          {[0, 1, 2].map((k) => <path key={`l${k}`} d={`M ${top.x - 14 + k * 3} ${top.y + 18 - k * 16} q 14 -8 28 0`} stroke={line} strokeWidth={2.5} fill="none" opacity={0.6} />)}
        </g>
      );
      const strands =
        view === 'front' ? (
          <g>
            {path(`M -56 ${Y - 30} Q -72 ${Y + 10} -60 ${Y + 52} Q -54 ${Y + 20} -48 ${Y - 20} Z`)}
            {path(`M 56 ${Y - 30} Q 72 ${Y + 10} 60 ${Y + 52} Q 54 ${Y + 20} 48 ${Y - 20} Z`)}
          </g>
        ) : view === 'profile' ? (
          path(`M 8 ${Y - 42} Q 20 ${Y - 2} 12 ${Y + 42} Q 6 ${Y + 8} 2 ${Y - 32} Z`)
        ) : null;
      if (part === 'behind') return view === 'back' ? null : braid;
      return view === 'back' ? <g>{path(BOWL)}{braid}</g> : <g>{cap}{strands}</g>;
    }
    case 'shag': {
      // a layered mid-length cut: jagged ends at the jaw, a choppy fringe
      if (view === 'front') {
        if (part === 'behind') return path(`M -72 ${Y + 52} L -62 ${Y + 38} L -68 ${Y + 24} Q -86 ${Y - 74} 0 ${Y - 76} Q 86 ${Y - 74} 68 ${Y + 24} L 62 ${Y + 38} L 72 ${Y + 52} L 52 ${Y + 46} L 40 ${Y + 58} Q 0 ${Y + 40} -40 ${Y + 58} L -52 ${Y + 46} Z`);
        return path(`M -62 ${Y - 4} Q -64 ${Y - 72} 0 ${Y - 72} Q 64 ${Y - 72} 62 ${Y - 4} L 48 ${Y - 20} L 34 ${Y - 12} L 18 ${Y - 24} L 2 ${Y - 14} L -14 ${Y - 24} L -30 ${Y - 12} L -46 ${Y - 22} Z`);
      }
      if (view === 'profile') return part === 'behind' ? path(`M 8 ${Y - 66} Q -84 ${Y - 66} -80 ${Y + 46} L -64 ${Y + 38} L -56 ${Y + 54} L -38 ${Y + 40} Q -30 ${Y} 8 ${Y - 40} Z`) : cap;
      return part === 'over' ? path(`M -74 ${Y + 54} Q -88 ${Y - 74} 0 ${Y - 76} Q 88 ${Y - 74} 74 ${Y + 54} L 52 ${Y + 46} L 30 ${Y + 60} L 0 ${Y + 48} L -30 ${Y + 60} L -52 ${Y + 46} Z`) : null;
    }
    default:
      return null;
  }
};
