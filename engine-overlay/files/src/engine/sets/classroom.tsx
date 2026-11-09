import React from 'react';
import { C } from '../rig';
import { S3, Box, makeRoom, pts } from '../room';
import { WallTexture, RoomCorners, LightVeil, Dust } from '../light';
import { WallBoard, PinBoard } from '../pieces';
import { FONT } from '../fonts';

// The classroom: windows on the left wall, the board on the back wall (`board` sets what is written on it),
// a pinboard, a clock, the teacher's desk, rows of desks with classmates seen from behind.
//
// A template, not a scene: every colour is a token (`tokens`, defaults = the original dusk classroom), and everything
// that belongs to one story is a slot (the writing on the board, what sits on the teacher's desk, the pinboard's
// content, the desk layout, the classmates). So a bright primary school, a night class and a lecture hall are the same
// set with other tokens and slots, and nothing of another story's sum, apple or globe leaks in.
export const CLS = makeRoom({ x: 900, y: 470 }, { x0: 300, x1: 1500, y0: 130, y1: 720 }, 3.2);
export type KidLook = { hair: 'short' | 'bun' | 'pony' | 'cap' | 'curly'; hairC: string; top: string };
export const KIDS: KidLook[] = [
  { hair: 'pony', hairC: '#3A2420', top: '#6A8A9A' },
  { hair: 'cap', hairC: '#2A1C18', top: '#9A6A5A' },
  { hair: 'curly', hairC: '#1E1418', top: '#7A7A4A' },
  { hair: 'bun', hairC: '#5A3A28', top: '#6A5A8A' },
  { hair: 'short', hairC: '#C9925A', top: '#4A6A5A' },
];

export type Furniture = { front: string; top: string; side: string };
export type ClassTokens = {
  wall: string;
  wallSide: string;
  wallRight: string;
  ceiling: string;
  /** the ceiling light panels */
  panel: string;
  floor: string;
  floorLine: string;
  trim: string;
  windowFrame: string;
  /** window sky, top to bottom */
  sky: [string, string, string];
  /** colour of the light patches the windows cast: on the floor, then on the walls */
  sunlight: [string, string];
  boardFrame: string;
  board: string;
  boardTray: string;
  /** the writing colour of the faded old work */
  chalk: string;
  desk: Furniture;
  teacherDesk: Furniture;
  metal: string;
  /** LightVeil strength: how dark the room's mid-tones go (0.42 dusk, ~0.1 bright day) */
  veil: number;
  dust: number;
};

export const CLASS_DEFAULT: ClassTokens = {
  wall: S3.wall,
  wallSide: S3.wallSide,
  wallRight: '#2A2331',
  ceiling: S3.ceiling,
  panel: '#4A4458',
  floor: '#3A3240',
  floorLine: '#2A2230',
  trim: S3.trim,
  windowFrame: '#1E1824',
  sky: ['#5A3A6E', '#E08A5E', '#FFC27A'],
  sunlight: ['#FFC27A', '#FFB46A'],
  boardFrame: '#5A3A3E',
  board: S3.board,
  boardTray: '#4A3034',
  chalk: '#EDEFE6',
  desk: { front: '#7A5747', top: '#8A6452', side: '#5B4038' },
  teacherDesk: { front: '#5B4038', top: '#7A5747', side: '#3A2826' },
  metal: S3.metal,
  veil: 0.42,
  dust: 0.5,
};

/** Ready-made moods; spread one into `tokens` and override what you need. */
export const CLASS_MOODS: Record<'day' | 'night', Partial<ClassTokens>> = {
  day: {
    wall: '#D8D0BE', wallSide: '#C2B9A5', wallRight: '#B9AF9B', ceiling: '#EDE8DC', panel: '#FBF8EE', floor: '#A39580', floorLine: '#8C7F6A',
    trim: '#6B5E4C', windowFrame: '#EDE8DC', sky: ['#86C1EC', '#BDE0F4', '#EAF4E6'], sunlight: ['#FFF3C4', '#FFEBB0'],
    boardFrame: '#8A6B4A', board: '#2F5D50', boardTray: '#6B5238', chalk: '#FFFFFF',
    desk: { front: '#C99B63', top: '#DDB67E', side: '#A87D4C' }, teacherDesk: { front: '#B58552', top: '#D6AB74', side: '#8F6840' },
    metal: '#8A8F99', veil: 0.07, dust: 0.25,
  },
  night: {
    wall: '#3A3447', wallSide: '#2E2A3A', wallRight: '#241F2E', ceiling: '#17131F', panel: '#FFD9A0', floor: '#2A2432', floorLine: '#1E1926',
    windowFrame: '#120F1A', sky: ['#050914', '#0F1B3C', '#22335E'], sunlight: ['#9DB8FF', '#7F9CE8'], veil: 0.55,
  },
};

/** A classmate seen from behind, sitting; `turn` brings the face round, `laugh` opens the mouth. */
export const Kid: React.FC<{ x: number; y: number; s: number; look: KidLook; turn?: number; laugh?: number; t?: number }> = ({ x, y, s, look, turn = 0, laugh = 0, t = 0 }) => {
  const bob = laugh ? Math.abs(Math.sin(t / 2.4 + x)) * 8 * laugh : 0;
  return (
    <g transform={`translate(${x} ${y - bob}) scale(${s})`} filter="url(#rimL)">
      <path d="M -62 0 Q -64 -96 0 -100 Q 64 -96 62 0 Z" fill={look.top} />
      <path d="M -62 0 Q -64 -96 0 -100 L 0 0 Z" fill="#000" opacity={0.12} />
      <g transform={`translate(0 -150) rotate(${laugh ? -8 * laugh : 0})`}>
        <circle r={52} fill={turn > 0.3 ? C.skin : look.hairC} />
        {turn > 0.3 ? (
          <g>
            <path d="M -52 0 A 52 52 0 0 1 30 -42 Q 6 -10 -40 30 Z" fill={look.hairC} />
            <circle cx={26} cy={-4} r={5} fill={C.ink} />
            {laugh ? <path d="M 14 18 Q 30 34 44 16 Z" fill={C.ink} /> : <path d="M 18 22 L 38 20" stroke={C.ink} strokeWidth={4} strokeLinecap="round" />}
          </g>
        ) : null}
        {look.hair === 'bun' ? <circle cx={0} cy={-56} r={22} fill={look.hairC} /> : null}
        {look.hair === 'pony' ? <path d="M -6 -20 Q -30 40 -10 70 Q 4 40 6 -20 Z" fill={look.hairC} /> : null}
        {look.hair === 'cap' ? <path d="M -54 -6 Q -50 -60 0 -62 Q 50 -60 54 -6 Z M 30 -20 L 86 -14 L 86 -6 L 30 -8 Z" fill="#B0463A" /> : null}
        {look.hair === 'curly' ? [-40, -20, 0, 20, 40].map((cx, i) => <circle key={i} cx={cx} cy={-40 + Math.abs(cx) * 0.4} r={20} fill={look.hairC} />) : null}
      </g>
    </g>
  );
};

/** Desks in perspective for the classroom rows. */
const KidDesk: React.FC<{ u: number; w: number; len: number; desk: Furniture; metal: string }> = ({ u, w, len, desk, metal }) => {
  const leg = (uu: number, ww: number, k: number) => {
    const a = CLS.P(uu, 0.83, ww);
    const b = CLS.P(uu, 1, ww);
    return <path key={k} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={metal} strokeWidth={5} />;
  };
  return (
    <g>
      {leg(u + 0.01, w + 0.005, 0)}
      {leg(u + len - 0.01, w + 0.005, 1)}
      {leg(u + 0.01, w + 0.045, 2)}
      {leg(u + len - 0.01, w + 0.045, 3)}
      <Box r={CLS} u={[u, u + len]} v={[0.8, 0.83]} w={[w, w + 0.05]} front={desk.front} top={desk.top} side={desk.side} rim />
    </g>
  );
};

/** `len` is a desk's length across (0.14 a single desk, 0.4 a lecture-hall bench): one classmate sits per 0.14. */
export type DeskRow = { w: number; us: number[]; len?: number };
export const DESK_ROWS_DEFAULT: DeskRow[] = [
  { w: 0.36, us: [0.3, 0.55] },
  { w: 0.54, us: [0.12, 0.36] },
];

/** What sits on the teacher's desk in the original demo: books, an apple, a globe. Pass `deskProps` to replace it. */
const DemoDeskProps: React.FC = () => {
  const tp = CLS.P(0.12, 0.76, 0.2);
  const tp2 = CLS.P(0.24, 0.76, 0.2);
  return (
    <g>
      <rect x={tp.x - 20} y={tp.y - 20} width={60} height={12} fill="#4A5A7A" />
      <rect x={tp.x - 14} y={tp.y - 32} width={52} height={12} fill="#8A4A4A" />
      <circle cx={tp.x + 70} cy={tp.y - 12} r={12} fill="#C0392B" />
      <path d={`M ${tp.x + 70} ${tp.y - 24} l 4 -8`} stroke="#3A2826" strokeWidth={3} />
      <path d={`M ${tp2.x} ${tp2.y} L ${tp2.x} ${tp2.y - 30}`} stroke="#3A2826" strokeWidth={5} />
      <circle cx={tp2.x} cy={tp2.y - 56} r={28} fill="#4A7AA0" />
      <path d={`M ${tp2.x - 14} ${tp2.y - 70} q 10 6 6 18 q 14 -4 18 8`} fill="#6AA06A" />
    </g>
  );
};

const DemoBoard: React.FC<{ solved: boolean; wrong: boolean; chalk: string }> = ({ solved, wrong, chalk }) => (
  <g>
    <text x={690} y={410} textAnchor="middle" fontFamily={FONT.hand} fontSize={120} fill={chalk} opacity={0.92}>
      7 × 8 =
    </text>
    <text x={950} y={410} textAnchor="middle" fontFamily={FONT.hand} fontSize={120} fill={solved ? '#9BEFB0' : chalk} opacity={0.92}>
      {solved ? '56' : wrong ? '54' : '?'}
    </text>
    {wrong && !solved ? <path d="M 900 340 L 1000 430 M 1000 340 L 900 430" stroke="#FF6A5A" strokeWidth={9} strokeLinecap="round" opacity={0.9} /> : null}
  </g>
);

/**
 * `board` is the writing on the board (the writing area is x 426-1054, y 196-524; undefined keeps the original
 * "7 x 8 = ?" demo, pass <g /> for a clean board). `tokens` re-colours the room (see CLASS_DEFAULT, CLASS_MOODS).
 * Slots: `deskProps` (teacher's desk, false for none), `pinboard` (false for none, or your own children), `rows` (desk
 * layout), `kids` (classmates, false for an empty room), `windows` (0 to 3), `clock`, `cubbies`, `extra` (drawn last).
 */
export const Classroom: React.FC<{
  t: number;
  solved?: boolean;
  wrong?: boolean;
  laugh?: number;
  id?: string;
  board?: React.ReactNode;
  tokens?: Partial<ClassTokens>;
  deskProps?: React.ReactNode | false;
  pinboard?: React.ReactNode | false;
  rows?: DeskRow[];
  kids?: KidLook[] | false;
  windows?: number;
  clock?: boolean;
  cubbies?: boolean;
  extra?: React.ReactNode;
}> = ({
  t, solved = false, wrong = false, laugh = 0, id = 'cls', board, tokens, deskProps, pinboard, rows = DESK_ROWS_DEFAULT, kids = KIDS,
  windows = 3, clock: showClock = true, cubbies = true, extra,
}) => {
  const T: ClassTokens = {
    ...CLASS_DEFAULT,
    ...tokens,
    desk: { ...CLASS_DEFAULT.desk, ...tokens?.desk },
    teacherDesk: { ...CLASS_DEFAULT.teacherDesk, ...tokens?.teacherDesk },
  };
  const r = CLS;
  const { P, Q } = r;
  const tiles: React.ReactNode[] = [];
  for (let i = 1; i < 12; i++) {
    const a = P(i / 12, 1, 0);
    const b = P(i / 12, 1, 1);
    tiles.push(<path key={`ta${i}`} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={T.floorLine} strokeWidth={2} />);
  }
  for (let j = 1; j < 10; j++) {
    const w = j / 10;
    const a = P(0, 1, w);
    const b = P(1, 1, w);
    tiles.push(<path key={`tb${j}`} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={T.floorLine} strokeWidth={2} />);
  }
  const wins: [number, number][] = ([
    [0.06, 0.2],
    [0.28, 0.42],
    [0.5, 0.64],
  ] as [number, number][]).slice(0, windows);
  const clock = { x: 1420, y: 250 };
  const [sun1, sun2] = T.sunlight;
  return (
    <g>
      <defs>
        <linearGradient id={`${id}winsky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.sky[0]} />
          <stop offset="70%" stopColor={T.sky[1]} />
          <stop offset="100%" stopColor={T.sky[2]} />
        </linearGradient>
      </defs>
      {/* the floor goes on below the near plane: a tall (9:16) frame shows it */}
      <rect x={-600} y={720} width={3000} height={1600} fill={T.floor} />
      <polygon points={Q([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]])} fill={T.ceiling} />
      {[
        [0.3, 0.45, 0.25, 0.33],
        [0.55, 0.7, 0.25, 0.33],
        [0.3, 0.45, 0.55, 0.63],
        [0.55, 0.7, 0.55, 0.63],
      ].map(([u0, u1, w0, w1], i) => (
        <polygon key={`cl${i}`} points={Q([[u0, 0, w0], [u1, 0, w0], [u1, 0, w1], [u0, 0, w1]])} fill={T.panel} />
      ))}
      <polygon points={Q([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]])} fill={T.wallSide} />
      <polygon points={Q([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]])} fill={T.wallRight} />
      <polygon points={Q([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]])} fill={T.floor} />
      {tiles}
      <rect x={300} y={130} width={1200} height={590} fill={T.wall} />
      <WallTexture rect={[300, 130, 1200, 590]} />
      <WallTexture points={Q([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]])} />
      <WallTexture points={Q([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]])} />
      <RoomCorners x0={300} x1={1500} y0={130} y1={720} />
      <rect x={300} y={704} width={1200} height={16} fill={T.trim} />
      {/* the windows on the left wall, and the light they let in */}
      {wins.map(([w0, w1], i) => (
        <g key={`wn${i}`}>
          <polygon points={Q([[0, 0.16, w0], [0, 0.16, w1], [0, 0.74, w1], [0, 0.74, w0]])} fill={`url(#${id}winsky)`} />
          <polygon points={Q([[0, 0.16, w0], [0, 0.16, w1], [0, 0.74, w1], [0, 0.74, w0]])} fill="none" stroke={T.windowFrame} strokeWidth={10} />
          <path d={`M ${P(0, 0.16, (w0 + w1) / 2).x} ${P(0, 0.16, (w0 + w1) / 2).y} L ${P(0, 0.74, (w0 + w1) / 2).x} ${P(0, 0.74, (w0 + w1) / 2).y}`} stroke={T.windowFrame} strokeWidth={7} />
          <path d={`M ${P(0, 0.42, w0).x} ${P(0, 0.42, w0).y} L ${P(0, 0.42, w1).x} ${P(0, 0.42, w1).y}`} stroke={T.windowFrame} strokeWidth={7} />
          <polygon points={Q([[0, 0.74, w0], [0, 0.74, w1], [0.32, 1, w1 + 0.08], [0.32, 1, w0 + 0.08]])} fill={sun1} opacity={0.07} style={{ mixBlendMode: 'screen' }} />
          <polygon points={Q([[0.22, 1, w0 + 0.06], [0.5, 1, w0 + 0.1], [0.5, 1, w1 + 0.1], [0.22, 1, w1 + 0.06]])} fill={sun2} opacity={0.16} style={{ mixBlendMode: 'screen' }} />
        </g>
      ))}
      {/* the light lands on the back wall too */}
      {windows > 0
        ? [0, 1].map((i) => (
            <polygon key={`wl${i}`} points={pts([{ x: 1130 + i * 150, y: 420 }, { x: 1250 + i * 150, y: 440 }, { x: 1250 + i * 150, y: 640 }, { x: 1130 + i * 150, y: 616 }])} fill={sun2} opacity={0.12} style={{ mixBlendMode: 'screen' }} />
          ))
        : null}
      {/* the board: faded working from an earlier lesson, then whatever is written on it for this story */}
      <WallBoard x={410} y={180} w={660} h={360} frame={T.boardFrame} surface={T.board} tray={T.boardTray} ghost={{ color: T.chalk, text: ['a + b = c', '12 ÷ 4 = 3'] }}>
        {board === undefined ? <DemoBoard solved={solved} wrong={wrong} chalk={T.chalk} /> : board}
      </WallBoard>
      {/* a pinboard of class work */}
      {pinboard === false ? null : <PinBoard x={1110} y={210}>{pinboard}</PinBoard>}
      {/* the clock */}
      {showClock ? (
        <>
          <circle cx={clock.x} cy={clock.y} r={58} fill="#EFE2CC" />
          <circle cx={clock.x} cy={clock.y} r={58} fill="none" stroke="#1E1824" strokeWidth={8} />
          <path d={`M ${clock.x} ${clock.y} L ${clock.x} ${clock.y - 38} M ${clock.x} ${clock.y} L ${clock.x + 26} ${clock.y + 10}`} stroke="#1E1824" strokeWidth={6} strokeLinecap="round" />
        </>
      ) : null}
      {/* the teacher's desk, with whatever is on it */}
      <Box r={r} u={[0.06, 0.3]} v={[0.76, 1]} w={[0.14, 0.26]} front={T.teacherDesk.front} top={T.teacherDesk.top} side={T.teacherDesk.side} rim />
      {deskProps === false ? null : deskProps ?? <DemoDeskProps />}
      {(() => {
        const b = P(0.36, 1, 0.24);
        return (
          <g>
            <ellipse cx={b.x + 6} cy={b.y + 4} rx={40} ry={10} fill="#000" opacity={0.3} />
            <path d={`M ${b.x - 30} ${b.y - 70} L ${b.x + 30} ${b.y - 70} L ${b.x + 24} ${b.y} L ${b.x - 24} ${b.y} Z`} fill="#3E6A8A" />
            <ellipse cx={b.x} cy={b.y - 70} rx={30} ry={8} fill="#2E4E6A" />
          </g>
        );
      })()}
      {/* cubbies on the right wall */}
      {cubbies
        ? [0, 1, 2].map((i) =>
            [0, 1].map((j) => {
              const w0 = 0.42 + i * 0.1;
              const v0 = 0.66 + j * 0.16;
              const c = ['#9A6A5A', '#6A8A9A', '#B0A05A', '#7A6A9A', '#6A9A7A', '#A07A5A'][i * 2 + j];
              return (
                <g key={`cb${i}${j}`}>
                  <polygon points={Q([[1, v0, w0], [1, v0, w0 + 0.09], [1, v0 + 0.15, w0 + 0.09], [1, v0 + 0.15, w0]])} fill="#3A2C35" />
                  <polygon points={Q([[1, v0 + 0.05, w0 + 0.01], [1, v0 + 0.05, w0 + 0.08], [1, v0 + 0.14, w0 + 0.08], [1, v0 + 0.14, w0 + 0.01]])} fill={c} />
                </g>
              );
            }),
          )
        : null}
      <LightVeil id={`${id}veil`} lights={[[P(0, 0.45, 0.35).x, P(0, 0.45, 0.35).y, 900], [1280, 530, 420], [740, 360, 560]]} o={T.veil} />
      <Dust t={t} seed={21} x0={300} y0={300} w={1000} h={560} n={50} o={T.dust} />
      {/* the rows of desks and the class */}
      {rows.map((row, ri) =>
        row.us.map((u, ui) => {
          const len = row.len ?? 0.14;
          const seats = Math.max(1, Math.round(len / 0.14));
          const k = r.s(row.w + 0.1) / r.s(0.55);
          return (
            <g key={`row${ri}-${ui}`}>
              <polygon points={Q([[u - 0.01, 1, row.w - 0.01], [u + len + 0.01, 1, row.w - 0.01], [u + len + 0.01, 1, row.w + 0.07], [u - 0.01, 1, row.w + 0.07]])} fill="#000" opacity={0.25} />
              <KidDesk u={u} w={row.w} len={len} desk={T.desk} metal={T.metal} />
              {(() => {
                const bp = P(u + len + 0.02, 1, row.w + 0.08);
                const kk = r.s(row.w + 0.08) / r.s(0.55);
                const c = ['#B0463A', '#3E6A8A', '#6A8A4A', '#8A5A9A'][(ri * 2 + ui) % 4];
                return <path d={`M ${bp.x - 22 * kk} ${bp.y} L ${bp.x - 24 * kk} ${bp.y - 50 * kk} Q ${bp.x} ${bp.y - 66 * kk} ${bp.x + 24 * kk} ${bp.y - 50 * kk} L ${bp.x + 22 * kk} ${bp.y} Z`} fill={c} />;
              })()}
              {kids
                ? Array.from({ length: seats }, (_, si) => {
                    const seat = P(u + 0.07 + si * 0.14, 1, row.w + 0.1);
                    return <Kid key={si} x={seat.x} y={seat.y - 70 * k} s={0.55 * k} look={kids[(ri * 2 + ui + si) % kids.length]!} turn={laugh > 0 && (ri + ui + si) % 2 === 0 ? 1 : 0} laugh={laugh} t={t} />;
                  })
                : null}
            </g>
          );
        }),
      )}
      {extra}
    </g>
  );
};

/** The hero's own desk in the classroom, toward the classroom's vanishing point. */
export const SchoolDesk: React.FC<{ x: number }> = ({ x }) => {
  const vp = CLS.vp;
  const k = 0.9;
  const bk = (px: number, py: number) => ({ x: vp.x + (px - vp.x) * k, y: vp.y + (py - vp.y) * k });
  const y = 750;
  const a = bk(x - 180, y);
  const b = bk(x + 180, y);
  return (
    <g>
      <polygon points={pts([{ x: x - 180, y }, { x: x + 180, y }, b, a])} fill="#8A6452" />
      <rect x={x - 180} y={y} width={360} height={18} fill="#7A5747" />
      <rect x={x - 180} y={y} width={360} height={2.5} fill={S3.warm} opacity={0.6} />
      <rect x={x - 168} y={y + 18} width={336} height={70} fill="#4A3430" />
      <path d={`M ${x - 160} ${y + 88} L ${x - 166} ${y + 240} M ${x + 160} ${y + 88} L ${x + 166} ${y + 240}`} stroke={S3.metal} strokeWidth={10} />
      <rect x={x - 120} y={y - 10} width={110} height={10} fill="#F4EEE0" transform={`rotate(-3 ${x - 60} ${y - 5})`} />
      <path d={`M ${x + 40} ${y - 6} L ${x + 120} ${y - 14}`} stroke="#E9C46A" strokeWidth={6} strokeLinecap="round" />
    </g>
  );
};
