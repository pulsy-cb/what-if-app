import React from 'react';
import { Box, makeRoom } from './room';
import type { Room } from './room';
import { RoomShell, FloorPlant, FloorShadow, WallFrame, WallClock, Pendant, pendantLight } from './furnish';
import { LightVeil, Dust, Glow, RoomCorners } from './light';
import { WallBoard, PinBoard } from './pieces';
import { StageItem, roomGround } from './stage';
import type { Ground } from './stage';

// Places made of pieces. A place is a recipe: a room shell in the episode's colours, and a list of pieces at positions
// on the floor or the back wall. Nothing belongs to a story: what is written on a board, who sits where, comes from the
// shot. A piece on the floor sorts by depth with the people around it. Use a ready recipe (PLACES) and change what you
// need, or list your own pieces, or add a piece of your own with `draw`.

export const ROOM = makeRoom({ x: 900, y: 470 }, { x0: 300, x1: 1500, y0: 130, y1: 720 }, 3.2);

type Solid = { front: string; top: string; side: string };
export type RoomTokens = {
  wall: string; side: string; ceiling: string; floor: string; floorLine: string; floorKind: 'boards' | 'tiles'; trim: string;
  wood: Solid; fabric: Solid; metal: string; sky: [string, string, string]; frame: string; curtain: string; board: string; boardFrame: string;
  /** darkening of the mid-tones: about 0.07 by day, 0.42 at dusk, 0.55 at night */ veil: number;
  dust: number;
  /** lit ceiling and lamps */ lamps: boolean;
};
export type Mood = 'day' | 'dusk' | 'night';

const solid = (top: string, front: string, side: string): Solid => ({ top, front, side });
export const MOODS: Record<Mood, RoomTokens> = {
  day: {
    wall: '#D8D0BE', side: '#C2B9A5', ceiling: '#EDE8DC', floor: '#A39580', floorLine: '#8C7F6A', floorKind: 'tiles', trim: '#6B5E4C',
    wood: solid('#DDB67E', '#C99B63', '#A87D4C'), fabric: solid('#7FA3B8', '#6A8DA2', '#577888'), metal: '#8A8F99',
    sky: ['#86C1EC', '#BDE0F4', '#EAF4E6'], frame: '#EDE8DC', curtain: '#B9A98C', board: '#2F5D50', boardFrame: '#8A6B4A', veil: 0.07, dust: 0.25, lamps: false,
  },
  dusk: {
    wall: '#443A4B', side: '#362E3E', ceiling: '#211B28', floor: '#3A3240', floorLine: '#2A2230', floorKind: 'boards', trim: '#231C29',
    wood: solid('#7A5747', '#5B4038', '#3A2826'), fabric: solid('#5A5A7A', '#4A4A68', '#3A3A54'), metal: '#5E5A6C',
    sky: ['#5A3A6E', '#E08A5E', '#FFC27A'], frame: '#1E1824', curtain: '#4E2F42', board: '#253C35', boardFrame: '#5A3A3E', veil: 0.42, dust: 0.5, lamps: true,
  },
  night: {
    wall: '#2C3856', side: '#232C45', ceiling: '#10141F', floor: '#1E2538', floorLine: '#151B2B', floorKind: 'boards', trim: '#141A28',
    wood: solid('#5A4A52', '#463A44', '#332A34'), fabric: solid('#46507A', '#3A4468', '#2E3654'), metal: '#4E5468',
    sky: ['#050914', '#0F1B3C', '#22335E'], frame: '#120F1A', curtain: '#2A2A48', board: '#1F2B2A', boardFrame: '#2B2F3A', veil: 0.55, dust: 0.3, lamps: true,
  },
};

export type PieceSpec = {
  /** a name from PIECES, or your own when you give `draw` */ p: string;
  /** how the shot refers to it: seats and slots. Defaults to `p` */ id?: string;
  /** u across the floor or wall, w depth (0 back wall, 1 camera) */ at?: { u: number; w?: number };
  /** width across (0..1 of the room), depth, or size where it applies */ len?: number; deep?: number;
  /** a colour for this one piece */ color?: string;
  /** your own drawing: receives the room and the tokens. A way out when the catalogue does not have it */ draw?: (c: DrawCtx) => React.ReactNode;
  /** with `draw`: true when it hangs on the wall (no depth sorting) */ wall?: boolean;
  /** extra options for this piece (see the catalogue) */ opt?: Record<string, unknown>;
};
export type DrawCtx = { r: Room; T: RoomTokens; t: number; u: number; w: number; len: number; deep: number; color?: string; opt: Record<string, unknown>; slot?: React.ReactNode };

type PieceDef = {
  kind: 'floor' | 'wall' | 'flat';
  len: number;
  deep: number;
  w?: number;
  draw: (c: DrawCtx) => React.ReactNode;
  /** the piece is sat at, not on: the person gets a stool */ stool?: boolean;
  /** height of its top surface, as a room v (0 ceiling, 1 floor): where a hand goes to touch it */ top?: number;
  /** where people sit: floor position of seat i */
  seats?: (c: { u: number; w: number; len: number; deep: number }, i: number) => { u: number; w: number };
};

const tone = (c: string | undefined, fallback: Solid): Solid => {
  if (!c) return fallback;
  const n = parseInt(c.slice(1), 16);
  const k = (f: number) => {
    const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
    return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  };
  return solid(k(1.12), c, k(0.8));
};
const backX = (r: Room, u: number) => r.back.x0 + (r.back.x1 - r.back.x0) * u;
const backY = (r: Room, v: number) => r.back.y0 + (r.back.y1 - r.back.y0) * v;

/** A slot's own origin is the centre of what it sits on, so `<text x={0} y={0} textAnchor="middle">` lands in the middle. */
const slotAt = (x: number, y: number, slot: React.ReactNode) => (slot ? <g transform={`translate(${x} ${y})`}>{slot}</g> : null);

const legs = (c: DrawCtx, top: number, inset = 0.01): React.ReactNode =>
  [[c.u + inset, c.w + inset], [c.u + c.len - inset, c.w + inset], [c.u + inset, c.w + c.deep - inset], [c.u + c.len - inset, c.w + c.deep - inset]].map(([u, w], i) => {
    const a = c.r.P(u!, top, w!);
    const b = c.r.P(u!, 1, w!);
    return <path key={i} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={c.T.metal} strokeWidth={5} />;
  });

const shadow = (c: DrawCtx) => <FloorShadow r={c.r} u={[c.u - 0.01, c.u + c.len + 0.01]} w={[c.w - 0.005, c.w + c.deep + 0.01]} />;

export const PIECES: Record<string, PieceDef> = {
  // ---------------------------------------- on the floor
  desk: { kind: 'floor', len: 0.14, deep: 0.05, stool: true, seats: (c, i) => ({ u: c.u + 0.07 + i * 0.14, w: c.w + c.deep + 0.03 }),
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}{legs(c, 0.83)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.8, 0.83]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} rim /></g>; } },
  table: { kind: 'floor', len: 0.34, deep: 0.16, stool: true, seats: (c, i) => ({ u: c.u + c.len * (0.25 + 0.5 * (i % 2)), w: c.w + c.deep + 0.03 }),
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}{legs(c, 0.84)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.8, 0.84]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} rim />{slotAt(c.r.P(c.u + c.len / 2, 0.8, c.w + c.deep / 2).x, c.r.P(c.u + c.len / 2, 0.8, c.w + c.deep / 2).y, c.slot)}</g>; } },
  chair: { kind: 'floor', len: 0.07, deep: 0.05, seats: (c) => ({ u: c.u + c.len / 2, w: c.w + c.deep / 2 + 0.01 }),
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}{legs(c, 0.88)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.86, 0.89]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} /><Box r={c.r} u={[c.u, c.u + c.len]} v={[0.68, 0.87]} w={[c.w, c.w + 0.008]} front={s.front} top={s.top} side={s.side} /></g>; } },
  sofa: { kind: 'floor', len: 0.34, deep: 0.16, seats: (c, i) => ({ u: c.u + c.len * (0.25 + 0.5 * (i % 2)), w: c.w + c.deep * 0.7 }),
    draw: (c) => { const s = tone(c.color, c.T.fabric); return (
      <g>
        {shadow(c)}
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.64, 0.86]} w={[c.w, c.w + 0.05]} front={s.front} top={s.top} side={s.side} />
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.84, 1]} w={[c.w, c.w + c.deep]} front={s.side} top={s.top} side={s.side} />
        <Box r={c.r} u={[c.u - 0.025, c.u]} v={[0.74, 1]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} />
        <Box r={c.r} u={[c.u + c.len, c.u + c.len + 0.025]} v={[0.74, 1]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} />
      </g>
    ); } },
  'coffee-table': { kind: 'floor', len: 0.2, deep: 0.09,
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}{legs(c, 0.93, 0.012)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.9, 0.93]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} rim /></g>; } },
  bed: { kind: 'floor', len: 0.36, deep: 0.42, w: 0, seats: (c, i) => ({ u: c.u + c.len * (0.3 + 0.4 * (i % 2)), w: c.w + c.deep + 0.02 }),
    draw: (c) => { const s = tone(c.color, c.T.fabric); const w = c.T.wood; const P = c.r.P; return (
      <g>
        {shadow(c)}
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.52, 1]} w={[c.w, c.w + 0.03]} front={w.front} side={w.side} top={w.top} rim />
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.86, 1]} w={[c.w + 0.03, c.w + c.deep]} front={w.side} side={w.side} top={w.top} />
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.79, 0.86]} w={[c.w + 0.03, c.w + 0.14]} front="#E6E0D2" side="#C6BEB0" top="#EFE9DC" />
        {[0.3, 0.7].map((k) => { const p = P(c.u + c.len * k, 0.79, c.w + 0.07); return <ellipse key={k} cx={p.x} cy={p.y - 12} rx={70} ry={26} fill="#F2ECDF" stroke="#C6BEB0" strokeWidth={3} />; })}
        <Box r={c.r} u={[c.u - 0.005, c.u + c.len + 0.005]} v={[0.78, 0.9]} w={[c.w + 0.14, c.w + c.deep]} front={s.front} top={s.top} side={s.side} />
      </g>
    ); } },
  nightstand: { kind: 'floor', len: 0.09, deep: 0.1, w: 0,
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.78, 1]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} rim /></g>; } },
  wardrobe: { kind: 'floor', len: 0.13, deep: 0.3, w: 0.1,
    draw: (c) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.1, 1]} w={[c.w, c.w + c.deep]} front={s.front} top={s.top} side={s.side} /></g>; } },
  bookshelf: { kind: 'floor', len: 0.2, deep: 0.05, w: 0,
    draw: (c) => { const s = tone(c.color, c.T.wood); const inks = ['#B0463A', '#3E6A8A', '#6A8A4A', '#C9A44A', '#8A5A9A', '#D8D0BE']; return (
      <g>
        {shadow(c)}
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.12, 1]} w={[c.w, c.w + c.deep]} front={s.side} top={s.top} side={s.side} />
        {[0.2, 0.38, 0.56, 0.74, 0.92].map((v, row) => Array.from({ length: 9 }, (_, i) => { const a = c.r.P(c.u + 0.012 + (i * (c.len - 0.024)) / 9, v, c.w + c.deep); const b = c.r.P(c.u + 0.012 + ((i + 0.8) * (c.len - 0.024)) / 9, v + 0.12 - ((i * 7 + row * 3) % 4) * 0.012, c.w + c.deep); return <rect key={`${row}${i}`} x={a.x} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={inks[(i * 5 + row) % inks.length]} />; }))}
      </g>
    ); } },
  counter: { kind: 'floor', len: 0.55, deep: 0.1, w: 0,
    draw: (c) => { const s = tone(c.color, c.T.wood); const P = c.r.P; const n = Math.round(c.len / 0.11); return (
      <g>
        <Box r={c.r} u={[c.u, c.u + c.len]} v={[0.72, 1]} w={[c.w, c.w + c.deep]} front={s.front} top="#D9D4C6" side={s.side} rim />
        {Array.from({ length: n }, (_, i) => { const a = P(c.u + (i + 0.08) * (c.len / n), 0.76, c.w + c.deep); const b = P(c.u + (i + 0.92) * (c.len / n), 0.96, c.w + c.deep); return <rect key={i} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} fill="none" stroke={s.side} strokeWidth={3} />; })}
        {(() => { const a = P(c.u + c.len * 0.3, 0.72, c.w + 0.02); const b = P(c.u + c.len * 0.5, 0.72, c.w + 0.08); return <rect x={a.x} y={a.y} width={b.x - a.x} height={Math.max(3, b.y - a.y)} fill="#8A8F99" />; })()}
      </g>
    ); } },
  fridge: { kind: 'floor', len: 0.11, deep: 0.1, w: 0,
    draw: (c) => { const col = c.color ?? '#D5D8DC'; const P = c.r.P; const h = P(c.u + 0.02, 0.45, c.w + c.deep); return <g>{shadow(c)}<Box r={c.r} u={[c.u, c.u + c.len]} v={[0.16, 1]} w={[c.w, c.w + c.deep]} front={col} top="#E6E8EB" side="#AEB2B8" /><rect x={h.x} y={h.y - 24} width={8} height={48} rx={3} fill="#7A7E86" /></g>; } },
  plant: { kind: 'floor', len: 0.04, deep: 0.04, draw: (c) => <FloorPlant r={c.r} u={c.u} w={c.w} size={c.len / 0.04} /> },
  bin: { kind: 'floor', len: 0.04, deep: 0.04, draw: (c) => { const b = c.r.P(c.u, 1, c.w); const k = c.r.s(c.w) * 0.75; const col = c.color ?? '#3E6A8A'; return <g><ellipse cx={b.x + 6} cy={b.y + 4} rx={40 * k} ry={10 * k} fill="#000" opacity={0.3} /><path d={`M ${b.x - 30 * k} ${b.y - 70 * k} L ${b.x + 30 * k} ${b.y - 70 * k} L ${b.x + 24 * k} ${b.y} L ${b.x - 24 * k} ${b.y} Z`} fill={col} /></g>; } },
  'floor-lamp': { kind: 'floor', len: 0.05, deep: 0.05, draw: (c) => { const b = c.r.P(c.u, 1, c.w); const k = c.r.s(c.w); return <g><ellipse cx={b.x} cy={b.y} rx={36 * k} ry={8 * k} fill="#2A2026" /><path d={`M ${b.x} ${b.y} L ${b.x} ${b.y - 330 * k}`} stroke="#2A2026" strokeWidth={7} /><path d={`M ${b.x - 30 * k} ${b.y - 360 * k} L ${b.x + 30 * k} ${b.y - 360 * k} L ${b.x + 44 * k} ${b.y - 310 * k} L ${b.x - 44 * k} ${b.y - 310 * k} Z`} fill="#F2D2A0" /><Glow x={b.x} y={b.y - 320 * k} r={240} o={c.T.lamps ? 0.55 : 0.16} /></g>; } },
  // ---------------------------------------- on the floor, flat under everyone
  rug: { kind: 'flat', len: 0.42, deep: 0.3, draw: (c) => { const col = c.color ?? '#7A5A7A'; return <g><polygon points={c.r.Q([[c.u, 1, c.w], [c.u + c.len, 1, c.w], [c.u + c.len, 1, c.w + c.deep], [c.u, 1, c.w + c.deep]])} fill={col} /><polygon points={c.r.Q([[c.u + 0.02, 1, c.w + 0.02], [c.u + c.len - 0.02, 1, c.w + 0.02], [c.u + c.len - 0.02, 1, c.w + c.deep - 0.02], [c.u + 0.02, 1, c.w + c.deep - 0.02]])} fill="none" stroke="#FFFFFF" strokeOpacity={0.25} strokeWidth={4} /></g>; } },
  // ---------------------------------------- on the back wall (u is the left edge, or the centre for small things)
  window: { kind: 'wall', len: 0.24, deep: 0, draw: (c) => {
    const x0 = backX(c.r, c.u); const x1 = backX(c.r, c.u + c.len); const y0 = backY(c.r, 0.14); const y1 = backY(c.r, 0.62); const id = `win${Math.round(c.u * 1000)}`;
    return (
      <g>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.T.sky[0]} /><stop offset="70%" stopColor={c.T.sky[1]} /><stop offset="100%" stopColor={c.T.sky[2]} /></linearGradient></defs>
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={`url(#${id})`} />
        {c.opt.night || c.T.veil > 0.5 ? <circle cx={x0 + (x1 - x0) * 0.7} cy={y0 + 70} r={26} fill="#EEF0F8" /> : null}
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={c.T.frame} strokeWidth={12} />
        <path d={`M ${(x0 + x1) / 2} ${y0} L ${(x0 + x1) / 2} ${y1} M ${x0} ${y0 + (y1 - y0) * 0.4} L ${x1} ${y0 + (y1 - y0) * 0.4}`} stroke={c.T.frame} strokeWidth={8} />
        {c.opt.curtains === false ? null : [x0 - 44, x1 - 26].map((x, i) => <rect key={i} x={x} y={y0 - 20} width={70} height={y1 - y0 + 100} fill={c.T.curtain} opacity={0.95} />)}
      </g>
    );
  } },
  board: { kind: 'wall', len: 0.5, deep: 0, draw: (c) => <WallBoard x={backX(c.r, c.u)} y={backY(c.r, 0.1)} w={backX(c.r, c.u + c.len) - backX(c.r, c.u)} h={360} frame={c.T.boardFrame} surface={c.color ?? c.T.board} tray={c.T.boardFrame}>{slotAt((backX(c.r, c.u) + backX(c.r, c.u + c.len)) / 2, backY(c.r, 0.1) + 180, c.slot)}</WallBoard> },
  whiteboard: { kind: 'wall', len: 0.42, deep: 0, draw: (c) => <WallBoard x={backX(c.r, c.u)} y={backY(c.r, 0.12)} w={backX(c.r, c.u + c.len) - backX(c.r, c.u)} h={300} frame="#AEB4C0" surface="#F6F7F9" tray="#C4C9D4" chalk={false}>{slotAt((backX(c.r, c.u) + backX(c.r, c.u + c.len)) / 2, backY(c.r, 0.12) + 150, c.slot)}</WallBoard> },
  pinboard: { kind: 'wall', len: 0.2, deep: 0, draw: (c) => <PinBoard x={backX(c.r, c.u)} y={backY(c.r, 0.14)} /> },
  frame: { kind: 'wall', len: 0.09, deep: 0, draw: (c) => <WallFrame x={backX(c.r, c.u)} y={backY(c.r, 0.3)} w={(c.len * 1200)} h={c.len * 1200 * 0.8} art={Number(c.opt.art ?? 0) as 0 | 1 | 2} /> },
  clock: { kind: 'wall', len: 0.05, deep: 0, draw: (c) => <WallClock x={backX(c.r, c.u)} y={backY(c.r, 0.18)} r={42} t={c.t} /> },
  tv: { kind: 'wall', len: 0.24, deep: 0, draw: (c) => { const x = backX(c.r, c.u); const w = c.len * 1200; const y = backY(c.r, 0.3); return <g><rect x={x} y={y} width={w} height={w * 0.58} rx={8} fill="#14161C" /><rect x={x + 10} y={y + 10} width={w - 20} height={w * 0.58 - 20} fill={c.color ?? '#26304A'} />{slotAt(x + w / 2, y + w * 0.29, c.slot)}</g>; } },
  door: { kind: 'wall', len: 0.13, deep: 0, draw: (c) => { const x = backX(c.r, c.u); const w = c.len * 1200; const y0 = backY(c.r, 0.24); const y1 = backY(c.r, 1); const s = tone(c.color, c.T.wood); return <g><rect x={x - 10} y={y0 - 10} width={w + 20} height={y1 - y0 + 10} fill={c.T.trim} /><rect x={x} y={y0} width={w} height={y1 - y0} fill={s.front} /><circle cx={x + w - 18} cy={(y0 + y1) / 2 + 20} r={7} fill="#C9A46A" /></g>; } },
};
export const PIECE_NAMES = (): string[] => Object.keys(PIECES);

/** Add a piece to the catalogue (a promoted piece, or your own helper). */
export const definePiece = (name: string, def: PieceDef): void => {
  PIECES[name] = def;
};

/** Ready recipes. Start from one and change the mood, the palette, or the pieces. */
export type Recipe = {
  mood: Mood;
  floor?: 'boards' | 'tiles';
  lights?: { u: number; w: number }[];
  pieces: PieceSpec[];
  /** what hangs on the opposite wall, seen in the reverse view (view: 'reverse') */ front?: PieceSpec[];
  /** an open-air place: sky and ground, no walls or ceiling */ outdoor?: boolean;
  /** this recipe's own colours, before the episode's palette */ palette?: Partial<RoomTokens>;
};
export const PLACES: Record<string, Recipe> = {
  classroom: {
    mood: 'day', floor: 'tiles', lights: [{ u: 0.3, w: 0.35 }, { u: 0.7, w: 0.35 }],
    pieces: [
      { p: 'board', at: { u: 0.1 } }, { p: 'pinboard', at: { u: 0.64 } }, { p: 'clock', at: { u: 0.88 } }, { p: 'desk', id: 'teacher', at: { u: 0.12, w: 0.14 }, len: 0.24, deep: 0.09 },
      { p: 'desk', id: 'd1', at: { u: 0.3, w: 0.32 } }, { p: 'desk', id: 'd2', at: { u: 0.55, w: 0.32 } }, { p: 'desk', id: 'd3', at: { u: 0.25, w: 0.52 } }, { p: 'desk', id: 'd4', at: { u: 0.55, w: 0.52 } },
      { p: 'bin', at: { u: 0.84, w: 0.2 } },
    ],
  },
  bedroom: {
    mood: 'night', floor: 'boards', lights: [{ u: 0.52, w: 0.2 }],
    pieces: [
      { p: 'window', at: { u: 0.56 } }, { p: 'frame', at: { u: 0.14 }, opt: { art: 1 } }, { p: 'frame', at: { u: 0.28 }, opt: { art: 2 } }, { p: 'rug', at: { u: 0.42, w: 0.42 } },
      { p: 'bed', at: { u: 0.12, w: 0 } }, { p: 'nightstand', at: { u: 0.49, w: 0 } }, { p: 'wardrobe', at: { u: 0.8, w: 0.1 } }, { p: 'plant', at: { u: 0.74, w: 0.1 } },
    ],
  },
  kitchen: {
    mood: 'day', floor: 'tiles', lights: [{ u: 0.5, w: 0.4 }],
    pieces: [
      { p: 'window', at: { u: 0.22 }, len: 0.2 }, { p: 'clock', at: { u: 0.62 } }, { p: 'counter', at: { u: 0.02, w: 0 }, len: 0.62 }, { p: 'fridge', at: { u: 0.66, w: 0 } },
      { p: 'table', at: { u: 0.32, w: 0.42 } }, { p: 'chair', id: 'c1', at: { u: 0.36, w: 0.34 } }, { p: 'chair', id: 'c2', at: { u: 0.55, w: 0.34 } }, { p: 'plant', at: { u: 0.84, w: 0.2 } },
    ],
  },
  living: {
    mood: 'dusk', floor: 'boards', lights: [{ u: 0.5, w: 0.45 }],
    pieces: [
      { p: 'window', at: { u: 0.58 } }, { p: 'frame', at: { u: 0.1 }, opt: { art: 0 } }, { p: 'frame', at: { u: 0.24 }, opt: { art: 2 } }, { p: 'rug', at: { u: 0.26, w: 0.3 } },
      { p: 'bookshelf', at: { u: 0.4, w: 0 } }, { p: 'sofa', at: { u: 0.2, w: 0.24 }, len: 0.3 }, { p: 'coffee-table', at: { u: 0.26, w: 0.52 } }, { p: 'floor-lamp', at: { u: 0.8, w: 0.3 } }, { p: 'plant', at: { u: 0.78, w: 0.08 } },
    ],
  },
  office: {
    mood: 'day', floor: 'tiles', lights: [{ u: 0.35, w: 0.4 }, { u: 0.7, w: 0.4 }],
    pieces: [
      { p: 'window', at: { u: 0.68 } }, { p: 'whiteboard', at: { u: 0.14 } }, { p: 'clock', at: { u: 0.6 } }, { p: 'table', id: 'd1', at: { u: 0.2, w: 0.4 }, len: 0.25, deep: 0.1 },
      { p: 'table', id: 'd2', at: { u: 0.55, w: 0.4 }, len: 0.25, deep: 0.1 }, { p: 'plant', at: { u: 0.86, w: 0.12 } }, { p: 'bin', at: { u: 0.5, w: 0.2 } },
    ],
  },
  restaurant: {
    mood: 'dusk', floor: 'boards', lights: [{ u: 0.3, w: 0.45 }, { u: 0.72, w: 0.45 }],
    pieces: [
      { p: 'window', at: { u: 0.38 } }, { p: 'frame', at: { u: 0.12 }, opt: { art: 1 } }, { p: 'frame', at: { u: 0.76 }, opt: { art: 0 } }, { p: 'table', id: 't1', at: { u: 0.2, w: 0.42 }, len: 0.25, deep: 0.14 },
      { p: 'table', id: 't2', at: { u: 0.55, w: 0.42 }, len: 0.25, deep: 0.14 }, { p: 'plant', at: { u: 0.13, w: 0.1 } }, { p: 'plant', at: { u: 0.87, w: 0.1 } },
    ],
  },
  blank: { mood: 'day', pieces: [] },
};

// ------------------------------------------------------------------------------------------------ more pieces
// Pieces for the places that come back most often in the channel's stories: streets and gardens, corridors and lockers,
// hospital rooms, reception halls, shops, police offices. Each one is a few boxes in the room's perspective.

const box = (c: DrawCtx, u: [number, number], v: [number, number], w: [number, number], s: Solid, rim = false) => (
  <Box r={c.r} u={u} v={v} w={w} front={s.front} top={s.top} side={s.side} rim={rim} />
);
const back = (c: DrawCtx) => ({ x0: backX(c.r, c.u), x1: backX(c.r, c.u + c.len) });

Object.assign(PIECES, {
  // ---------------------------------------- indoors
  'hospital-bed': { kind: 'floor', len: 0.22, deep: 0.34, w: 0.05, top: 0.8, seats: (c: { u: number; w: number; len: number; deep: number }, i: number) => ({ u: c.u + c.len * (0.3 + 0.4 * (i % 2)), w: c.w + c.deep + 0.02 }),
    draw: (c: DrawCtx) => { const m = c.T.metal; const sheet = tone(c.color ?? '#B9C4E8', c.T.fabric); return (
      <g>{shadow(c)}{legs(c, 0.84, 0.015)}
        {box(c, [c.u, c.u + c.len], [0.55, 0.84], [c.w, c.w + 0.02], solid('#E8ECF0', '#D5DAE0', '#B8BEC8'))}
        {box(c, [c.u, c.u + c.len], [0.8, 0.85], [c.w + 0.02, c.w + c.deep], solid('#F2F4F6', '#DDE2E8', '#C0C6D0'))}
        {box(c, [c.u + 0.01, c.u + c.len - 0.01], [0.77, 0.81], [c.w + 0.02, c.w + 0.09], solid('#FFFFFF', '#F0F0F2', '#D8DCE2'))}
        {box(c, [c.u - 0.004, c.u + c.len + 0.004], [0.78, 0.83], [c.w + 0.1, c.w + c.deep], sheet)}
        <path d={`M ${c.r.P(c.u, 0.74, c.w + c.deep * 0.5).x} ${c.r.P(c.u, 0.74, c.w + c.deep * 0.5).y} L ${c.r.P(c.u, 0.74, c.w + c.deep).x} ${c.r.P(c.u, 0.74, c.w + c.deep).y}`} stroke={m} strokeWidth={5} />
      </g>
    ); } },
  monitor: { kind: 'floor', len: 0.05, deep: 0.04, w: 0.04, top: 0.5,
    draw: (c: DrawCtx) => { const a = c.r.P(c.u + c.len / 2, 1, c.w); const t = c.r.P(c.u + c.len / 2, 0.45, c.w); const k = c.r.s(c.w); const beat = (c.t * 3) % 60; return (
      <g><path d={`M ${a.x} ${a.y} L ${t.x} ${t.y}`} stroke={c.T.metal} strokeWidth={6} />
        <rect x={t.x - 52 * k} y={t.y - 80 * k} width={104 * k} height={74 * k} rx={6} fill="#1B222B" stroke="#4A5562" strokeWidth={4} />
        <path d={`M ${t.x - 44 * k} ${t.y - 42 * k} l ${20 * k} 0 l ${8 * k} ${-22 * k} l ${10 * k} ${36 * k} l ${8 * k} ${-14 * k} l ${42 * k} 0`} stroke="#5BE38A" strokeWidth={3} fill="none" opacity={0.6 + 0.4 * Math.sin(beat / 9)} />
      </g>
    ); } },
  'iv-stand': { kind: 'floor', len: 0.03, deep: 0.03, w: 0.1, top: 0.35,
    draw: (c: DrawCtx) => { const a = c.r.P(c.u, 1, c.w); const t = c.r.P(c.u, 0.3, c.w); const k = c.r.s(c.w); return (
      <g><path d={`M ${a.x} ${a.y} L ${t.x} ${t.y} M ${t.x - 30 * k} ${t.y} L ${t.x + 30 * k} ${t.y}`} stroke={c.T.metal} strokeWidth={5} />
        <rect x={t.x + 14 * k} y={t.y + 6 * k} width={26 * k} height={44 * k} rx={8 * k} fill="#DDEEF8" stroke="#9FB5C6" strokeWidth={3} />
        <path d={`M ${t.x + 27 * k} ${t.y + 50 * k} q ${10 * k} ${120 * k} ${-60 * k} ${200 * k}`} stroke="#B8D4E6" strokeWidth={2.5} fill="none" />
      </g>
    ); } },
  curtain: { kind: 'floor', len: 0.2, deep: 0.01, w: 0.3, top: 0.5,
    draw: (c: DrawCtx) => { const col = c.color ?? '#9EC9C2'; const a = c.r.P(c.u, 0.12, c.w); const b = c.r.P(c.u + c.len, 0.98, c.w); const n = 7; return (
      <g><path d={`M ${a.x} ${a.y} L ${b.x} ${a.y}`} stroke={c.T.metal} strokeWidth={5} />
        {Array.from({ length: n }, (_, i) => { const x = a.x + ((b.x - a.x) * i) / n; return <rect key={i} x={x} y={a.y} width={(b.x - a.x) / n + 2} height={b.y - a.y} fill={i % 2 ? col : tone(col, c.T.fabric).side} opacity={0.92} />; })}
      </g>
    ); } },
  locker: { kind: 'floor', len: 0.36, deep: 0.05, w: 0, top: 0.2,
    draw: (c: DrawCtx) => { const col = tone(c.color ?? '#3E6A8A', c.T.fabric); const n = Math.max(2, Math.round(c.len / 0.06)); const P = c.r.P; return (
      <g>{box(c, [c.u, c.u + c.len], [0.2, 1], [c.w, c.w + c.deep], col)}
        {Array.from({ length: n }, (_, i) => { const a = P(c.u + (i * c.len) / n, 0.22, c.w + c.deep); const b = P(c.u + ((i + 1) * c.len) / n, 0.98, c.w + c.deep); return (
          <g key={i}><rect x={a.x + 3} y={a.y} width={b.x - a.x - 6} height={b.y - a.y} fill="none" stroke={col.side} strokeWidth={3} />
            {[0.1, 0.16, 0.22].map((v) => <rect key={v} x={a.x + (b.x - a.x) * 0.3} y={a.y + (b.y - a.y) * v} width={(b.x - a.x) * 0.4} height={3} fill={col.side} />)}
            <rect x={b.x - 14} y={a.y + (b.y - a.y) * 0.5} width={5} height={18} fill="#C8CCD2" /></g>); })}
      </g>
    ); } },
  shelf: { kind: 'floor', len: 0.28, deep: 0.06, w: 0, top: 0.5,
    draw: (c: DrawCtx) => { const s = tone(c.color ?? '#D8D2C4', c.T.wood); const inks = ['#E0573E', '#F2B33D', '#3E8C5A', '#3E6A8A', '#B05A8A', '#EDE8DE']; return (
      <g>{shadow(c)}{box(c, [c.u, c.u + c.len], [0.25, 1], [c.w, c.w + c.deep], s)}
        {[0.4, 0.58, 0.76, 0.94].map((v, row) => Array.from({ length: 10 }, (_, i) => { const a = c.r.P(c.u + 0.01 + (i * (c.len - 0.02)) / 10, v - 0.12, c.w + c.deep); const b = c.r.P(c.u + 0.01 + ((i + 0.85) * (c.len - 0.02)) / 10, v, c.w + c.deep); return <rect key={`${row}${i}`} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} rx={2} fill={inks[(i * 3 + row * 2) % inks.length]} />; }))}
      </g>
    ); } },
  stage: { kind: 'floor', len: 0.7, deep: 0.18, w: 0, top: 0.9,
    draw: (c: DrawCtx) => { const s = tone(c.color ?? '#3A2A30', c.T.wood); return <g>{box(c, [c.u, c.u + c.len], [0.9, 1], [c.w, c.w + c.deep], s, true)}</g>; } },
  podium: { kind: 'floor', len: 0.07, deep: 0.05, w: 0.08, top: 0.72,
    draw: (c: DrawCtx) => { const s = tone(c.color ?? '#5A3A2E', c.T.wood); return <g>{shadow(c)}{box(c, [c.u, c.u + c.len], [0.7, 1], [c.w, c.w + c.deep], s, true)}</g>; } },
  'seat-row': { kind: 'floor', len: 0.6, deep: 0.05, top: 0.84, seats: (c: { u: number; w: number; len: number; deep: number }, i: number) => ({ u: c.u + 0.04 + (i % Math.max(1, Math.round(c.len / 0.08))) * 0.08, w: c.w + c.deep / 2 + 0.01 }),
    draw: (c: DrawCtx) => { const s = tone(c.color ?? '#7A1F2E', c.T.fabric); const n = Math.max(1, Math.round(c.len / 0.08)); return (
      <g>{Array.from({ length: n }, (_, i) => { const u = c.u + i * 0.08; return <g key={i}>{box(c, [u + 0.008, u + 0.072], [0.84, 0.9], [c.w, c.w + c.deep], s)}{box(c, [u + 0.008, u + 0.072], [0.66, 0.86], [c.w, c.w + 0.01], s)}</g>; })}</g>
    ); } },
  'round-table': { kind: 'floor', len: 0.14, deep: 0.1, stool: true, top: 0.82, seats: (c: { u: number; w: number; len: number; deep: number }, i: number) => ({ u: c.u + c.len * (i % 2 ? 0.9 : 0.1), w: c.w + c.deep + 0.02 }),
    draw: (c: DrawCtx) => { const mid = c.r.P(c.u + c.len / 2, 0.82, c.w + c.deep / 2); const foot = c.r.P(c.u + c.len / 2, 1, c.w + c.deep / 2); const rx = (backX(c.r, c.u + c.len) - backX(c.r, c.u)) * c.r.s(c.w + c.deep / 2) / 2; const cloth = c.color ?? '#F4EFE6'; return (
      <g><ellipse cx={foot.x} cy={foot.y} rx={rx * 0.9} ry={rx * 0.18} fill="#000" opacity={0.25} />
        <path d={`M ${mid.x - rx} ${mid.y} L ${mid.x - rx * 0.92} ${foot.y - 6} L ${mid.x + rx * 0.92} ${foot.y - 6} L ${mid.x + rx} ${mid.y} Z`} fill={tone(cloth, c.T.fabric).side} />
        <ellipse cx={mid.x} cy={mid.y} rx={rx} ry={rx * 0.22} fill={cloth} />{c.slot ? slotAt(mid.x, mid.y, c.slot) : null}
      </g>
    ); } },
  arch: { kind: 'floor', len: 0.2, deep: 0.02, w: 0.06, top: 0.3,
    draw: (c: DrawCtx) => { const a = c.r.P(c.u, 1, c.w); const b = c.r.P(c.u + c.len, 1, c.w); const top = c.r.P(c.u + c.len / 2, 0.18, c.w); const flowers = ['#F2B6C6', '#FFFFFF', '#F7D58B', '#E58FA8']; const pts = Array.from({ length: 22 }, (_, i) => { const k = i / 21; const ang = Math.PI * (1 - k); return { x: (a.x + b.x) / 2 + Math.cos(ang) * (b.x - a.x) / 2, y: a.y - Math.sin(ang) * (a.y - top.y) }; }); return (
      <g><path d={`M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`} stroke="#5E7A4A" strokeWidth={14} fill="none" />
        {pts.map((p, i) => <circle key={i} cx={p.x + Math.sin(i * 7) * 6} cy={p.y} r={13 + (i % 3) * 3} fill={flowers[i % flowers.length]} />)}</g>
    ); } },
  bars: { kind: 'floor', len: 1, deep: 0.01, w: 0.62, top: 0.5,
    draw: (c: DrawCtx) => { const n = 14; const m = c.T.metal; return (
      <g>{Array.from({ length: n + 1 }, (_, i) => { const a = c.r.P(c.u + (i * c.len) / n, 0, c.w); const b = c.r.P(c.u + (i * c.len) / n, 1, c.w); return <path key={i} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={m} strokeWidth={9} />; })}
        {[0.15, 0.55].map((v) => { const a = c.r.P(c.u, v, c.w); const b = c.r.P(c.u + c.len, v, c.w); return <path key={v} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={m} strokeWidth={12} />; })}</g>
    ); } },
  bench: { kind: 'floor', len: 0.16, deep: 0.05, top: 0.86, seats: (c: { u: number; w: number; len: number; deep: number }, i: number) => ({ u: c.u + c.len * (0.25 + 0.5 * (i % 2)), w: c.w + c.deep / 2 + 0.01 }),
    draw: (c: DrawCtx) => { const s = tone(c.color, c.T.wood); return <g>{shadow(c)}{legs(c, 0.88, 0.012)}{box(c, [c.u, c.u + c.len], [0.86, 0.89], [c.w, c.w + c.deep], s, true)}{box(c, [c.u, c.u + c.len], [0.7, 0.78], [c.w, c.w + 0.008], s)}</g>; } },
  'picnic-table': { kind: 'floor', len: 0.22, deep: 0.12, stool: false, top: 0.8, seats: (c: { u: number; w: number; len: number; deep: number }, i: number) => ({ u: c.u + c.len * (0.25 + 0.5 * (i % 2)), w: c.w + c.deep + 0.02 }),
    draw: (c: DrawCtx) => { const s = tone(c.color ?? '#C9A06A', c.T.wood); return (
      <g>{shadow(c)}{box(c, [c.u - 0.01, c.u + c.len + 0.01], [0.9, 0.92], [c.w - 0.03, c.w - 0.005], s)}{legs(c, 0.82, 0.02)}{box(c, [c.u, c.u + c.len], [0.8, 0.83], [c.w, c.w + c.deep], s, true)}{box(c, [c.u - 0.01, c.u + c.len + 0.01], [0.9, 0.92], [c.w + c.deep + 0.005, c.w + c.deep + 0.03], s)}</g>
    ); } },
  flowers: { kind: 'floor', len: 0.04, deep: 0.04, top: 0.6,
    draw: (c: DrawCtx) => { const b = c.r.P(c.u, 0.75, c.w); const k = c.r.s(c.w); const cols = ['#F2B6C6', '#FFFFFF', '#F7D58B', '#C7A2E8']; return (
      <g><path d={`M ${b.x - 18 * k} ${b.y} L ${b.x + 18 * k} ${b.y} L ${b.x + 12 * k} ${b.y + 60 * k} L ${b.x - 12 * k} ${b.y + 60 * k} Z`} fill={c.color ?? '#D8D2C4'} />
        {Array.from({ length: 9 }, (_, i) => <circle key={i} cx={b.x + Math.cos(i * 2.1) * 26 * k} cy={b.y - 22 * k + Math.sin(i * 2.1) * 16 * k} r={11 * k} fill={cols[i % cols.length]} />)}</g>
    ); } },
  // ---------------------------------------- on the back wall
  mirror: { kind: 'wall', len: 0.14, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const y = backY(c.r, 0.22); return <g><rect x={x0} y={y} width={x1 - x0} height={(x1 - x0) * 1.25} rx={10} fill="#9DB4C2" stroke={c.color ?? '#C9A24B'} strokeWidth={12} /><path d={`M ${x0 + 20} ${y + 60} l 50 -40 M ${x0 + 20} ${y + 110} l 90 -75`} stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={8} /></g>; } },
  screen: { kind: 'wall', len: 0.5, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const y = backY(c.r, 0.08); const h = (x1 - x0) * 0.5; return <g><rect x={x0 - 10} y={y - 10} width={x1 - x0 + 20} height={h + 20} fill="#0E0F14" /><rect x={x0} y={y} width={x1 - x0} height={h} fill={c.color ?? '#2B3F6E'} />{slotAt((x0 + x1) / 2, y + h / 2, c.slot)}</g>; } },
  'wall-shelf': { kind: 'wall', len: 0.2, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const cols = ['#E0B36A', '#7FB8A0', '#D87A7A', '#8CA8D8']; return <g>{[0.28, 0.46].map((v, row) => { const y = backY(c.r, v); return <g key={v}><rect x={x0} y={y} width={x1 - x0} height={10} fill={c.T.trim} />{Array.from({ length: 6 }, (_, i) => <rect key={i} x={x0 + 10 + i * ((x1 - x0 - 20) / 6)} y={y - 36 - ((i + row) % 3) * 8} width={(x1 - x0 - 20) / 6 - 8} height={36 + ((i + row) % 3) * 8} rx={4} fill={cols[(i + row) % cols.length]} />)}</g>; })}</g>; } },
  'alarm': { kind: 'wall', len: 0.03, deep: 0, draw: (c: DrawCtx) => { const x = backX(c.r, c.u); const y = backY(c.r, 0.5); return <g><rect x={x} y={y} width={36} height={48} rx={4} fill="#D3302F" /><rect x={x + 10} y={y + 14} width={16} height={20} fill="#FFFFFF" /></g>; } },
  // ---------------------------------------- outdoors: the back plane is the far side of the street
  facade: { kind: 'wall', len: 0.4, deep: 0, draw: (c: DrawCtx) => {
    const { x0, x1 } = back(c); const floors = Number(c.opt.floors ?? 3); const yb = backY(c.r, 1); const fh = (backY(c.r, 1) - backY(c.r, 0)) * 0.42; const top = yb - fh * floors; const col = c.color ?? '#C98F6A'; const cols = Math.max(2, Math.round((x1 - x0) / 120));
    const lit = c.T.lamps; return (
      <g><rect x={x0} y={top} width={x1 - x0} height={yb - top} fill={col} /><rect x={x0 - 8} y={top - 16} width={x1 - x0 + 16} height={18} fill={tone(col, c.T.wood).side} />
        {Array.from({ length: floors }, (_, f) => Array.from({ length: cols }, (_, i) => { const wx = x0 + ((i + 0.22) * (x1 - x0)) / cols; const wy = top + f * fh + fh * 0.22; const isDoor = f === floors - 1 && i === Math.floor(cols / 2) && c.opt.door !== false; return isDoor ? <rect key={`${f}${i}`} x={wx} y={yb - fh * 0.72} width={((x1 - x0) / cols) * 0.56} height={fh * 0.72} fill="#4A3428" /> : <rect key={`${f}${i}`} x={wx} y={wy} width={((x1 - x0) / cols) * 0.56} height={fh * 0.5} fill={lit && (f * 3 + i) % 4 !== 0 ? '#F6D27A' : c.T.sky[1]} stroke={tone(col, c.T.wood).side} strokeWidth={4} />; }))}
      </g>
    ); } },
  house: { kind: 'wall', len: 0.5, deep: 0, draw: (c: DrawCtx) => {
    const { x0, x1 } = back(c); const yb = backY(c.r, 1); const h = (backY(c.r, 1) - backY(c.r, 0)) * 0.75; const col = c.color ?? '#EDE4D3'; const roof = String(c.opt.roof ?? '#8A4A3A'); const w = x1 - x0; return (
      <g><rect x={x0} y={yb - h} width={w} height={h} fill={col} /><path d={`M ${x0 - 30} ${yb - h} L ${(x0 + x1) / 2} ${yb - h - w * 0.32} L ${x1 + 30} ${yb - h} Z`} fill={roof} />
        <rect x={x0 + w * 0.42} y={yb - h * 0.6} width={w * 0.16} height={h * 0.6} fill="#5A3A2A" /><circle cx={x0 + w * 0.55} cy={yb - h * 0.3} r={5} fill="#E0C080" />
        {[0.12, 0.7].map((k) => <rect key={k} x={x0 + w * k} y={yb - h * 0.72} width={w * 0.18} height={h * 0.34} fill={c.T.lamps ? '#F6D27A' : c.T.sky[1]} stroke="#FFFFFF" strokeWidth={8} />)}
      </g>
    ); } },
  skyline: { kind: 'wall', len: 1.6, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const yb = backY(c.r, 1); const n = 16; const col = c.color ?? (c.T.lamps ? '#2A2F4A' : '#9AA8BC'); return <g opacity={0.95}>{Array.from({ length: n }, (_, i) => { const w = (x1 - x0) / n; const h = 180 + ((i * 53) % 7) * 60; return <g key={i}><rect x={x0 + i * w} y={yb - h} width={w - 6} height={h} fill={col} />{c.T.lamps ? Array.from({ length: 6 }, (_, k) => <rect key={k} x={x0 + i * w + 12 + (k % 2) * (w / 2 - 10)} y={yb - h + 24 + Math.floor(k / 2) * 46} width={10} height={14} fill="#F6D27A" opacity={(i + k) % 3 ? 0.8 : 0.2} />) : null}</g>; })}</g>; } },
  fence: { kind: 'wall', len: 1.4, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const yb = backY(c.r, 1); const col = c.color ?? '#F2EEE6'; const n = Math.round((x1 - x0) / 34); return <g><rect x={x0} y={yb - 90} width={x1 - x0} height={10} fill={col} /><rect x={x0} y={yb - 40} width={x1 - x0} height={10} fill={col} />{Array.from({ length: n }, (_, i) => <path key={i} d={`M ${x0 + i * 34} ${yb} l 0 -110 l 10 -12 l 10 12 l 0 110 Z`} fill={col} />)}</g>; } },
  hedge: { kind: 'wall', len: 1.4, deep: 0, draw: (c: DrawCtx) => { const { x0, x1 } = back(c); const yb = backY(c.r, 1); const col = c.color ?? '#4E7A3E'; return <g><rect x={x0} y={yb - 120} width={x1 - x0} height={120} rx={40} fill={col} />{Array.from({ length: Math.round((x1 - x0) / 60) }, (_, i) => <circle key={i} cx={x0 + 30 + i * 60} cy={yb - 118} r={34} fill={col} />)}</g>; } },
  parapet: { kind: 'flat', len: 1.4, deep: 0.04, draw: (c: DrawCtx) => { const s = tone(c.color ?? '#B9B2A6', c.T.wood); return box(c, [c.u, c.u + c.len], [0.78, 1], [c.w, c.w + c.deep], s, true); } },
  // ---------------------------------------- outdoors, flat on the ground
  road: { kind: 'flat', len: 1.6, deep: 0.3, draw: (c: DrawCtx) => { const col = c.color ?? '#4A4C52'; const mid = c.w + c.deep / 2; return <g><polygon points={c.r.Q([[c.u, 1, c.w], [c.u + c.len, 1, c.w], [c.u + c.len, 1, c.w + c.deep], [c.u, 1, c.w + c.deep]])} fill={col} />{Array.from({ length: 10 }, (_, i) => { const u = c.u + (i + 0.2) * (c.len / 10); return <polygon key={i} points={c.r.Q([[u, 1, mid - 0.006], [u + c.len / 22, 1, mid - 0.006], [u + c.len / 22, 1, mid + 0.006], [u, 1, mid + 0.006]])} fill="#E8E2C8" />; })}</g>; } },
  sidewalk: { kind: 'flat', len: 1.6, deep: 0.2, draw: (c: DrawCtx) => { const col = c.color ?? '#B8B2A8'; return <g><polygon points={c.r.Q([[c.u, 1, c.w], [c.u + c.len, 1, c.w], [c.u + c.len, 1, c.w + c.deep], [c.u, 1, c.w + c.deep]])} fill={col} />{Array.from({ length: 14 }, (_, i) => { const u = c.u + (i * c.len) / 14; const a = c.r.P(u, 1, c.w); const b = c.r.P(u, 1, c.w + c.deep); return <path key={i} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={tone(col, c.T.wood).side} strokeWidth={2} />; })}</g>; } },
  path: { kind: 'flat', len: 0.16, deep: 0.9, draw: (c: DrawCtx) => <polygon points={c.r.Q([[c.u, 1, c.w], [c.u + c.len, 1, c.w], [c.u + c.len * 1.3, 1, c.w + c.deep], [c.u - c.len * 0.3, 1, c.w + c.deep]])} fill={c.color ?? '#D8C6A0'} /> },
  // ---------------------------------------- outdoors, standing
  tree: { kind: 'floor', len: 0.06, deep: 0.06, top: 0.3,
    draw: (c: DrawCtx) => { const b = c.r.P(c.u, 1, c.w); const k = c.r.s(c.w); const leaf = c.color ?? '#5E8F48'; return (
      <g><ellipse cx={b.x} cy={b.y} rx={70 * k} ry={14 * k} fill="#000" opacity={0.25} /><path d={`M ${b.x - 14 * k} ${b.y} L ${b.x - 9 * k} ${b.y - 300 * k} L ${b.x + 9 * k} ${b.y - 300 * k} L ${b.x + 14 * k} ${b.y} Z`} fill="#6A4A34" />
        {[[-60, -380, 110], [60, -400, 100], [0, -470, 120], [-20, -330, 90], [50, -320, 80]].map(([dx, dy, r], i) => <circle key={i} cx={b.x + dx! * k} cy={b.y + dy! * k} r={r! * k} fill={i % 2 ? tone(leaf, c.T.wood).front : leaf} />)}</g>
    ); } },
  'street-lamp': { kind: 'floor', len: 0.03, deep: 0.03, top: 0.2,
    draw: (c: DrawCtx) => { const b = c.r.P(c.u, 1, c.w); const k = c.r.s(c.w); const top = b.y - 520 * k; return (
      <g><path d={`M ${b.x} ${b.y} L ${b.x} ${top} q 0 -30 40 -30 L ${b.x + 70 * k} ${top - 30}`} stroke="#2E3138" strokeWidth={9 * k} fill="none" /><rect x={b.x + 50 * k} y={top - 34} width={46 * k} height={16 * k} rx={6} fill="#F6E2A8" />
        <Glow x={b.x + 72 * k} y={top - 20} r={260 * k} o={c.T.lamps ? 0.6 : 0} /></g>
    ); } },
  car: { kind: 'floor', len: 0.26, deep: 0.1, top: 0.7,
    draw: (c: DrawCtx) => { const body = tone(c.color ?? '#B0352E', c.T.fabric); const glass = '#9FC3DA'; const u0 = c.u; const u1 = c.u + c.len; const P = c.r.P; const wf = c.w + c.deep; const wheel = (u: number) => { const p = P(u, 1, wf); const k = c.r.s(wf); return <g key={u}><circle cx={p.x} cy={p.y - 28 * k} r={30 * k} fill="#1E1E22" /><circle cx={p.x} cy={p.y - 28 * k} r={13 * k} fill="#A8ACB4" /></g>; }; return (
      <g>{shadow(c)}{box(c, [u0, u1], [0.82, 0.96], [c.w, wf], body, true)}{box(c, [u0 + c.len * 0.22, u1 - c.len * 0.2], [0.7, 0.82], [c.w + 0.01, wf - 0.01], solid(body.top, glass, body.side))}
        {wheel(u0 + c.len * 0.2)}{wheel(u1 - c.len * 0.2)}</g>
    ); } },
  bus: { kind: 'floor', len: 0.55, deep: 0.12, top: 0.5,
    draw: (c: DrawCtx) => { const body = tone(c.color ?? '#F2B33D', c.T.fabric); const u0 = c.u; const u1 = c.u + c.len; const wf = c.w + c.deep; const P = c.r.P; return (
      <g>{shadow(c)}{box(c, [u0, u1], [0.5, 0.95], [c.w, wf], body, true)}
        {Array.from({ length: 7 }, (_, i) => { const a = P(u0 + 0.02 + i * (c.len - 0.04) / 7, 0.56, wf); const b = P(u0 + 0.02 + (i + 0.8) * (c.len - 0.04) / 7, 0.7, wf); return <rect key={i} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} fill="#9FC3DA" />; })}
        {[u0 + c.len * 0.15, u1 - c.len * 0.15].map((u) => { const p = P(u, 1, wf); const k = c.r.s(wf); return <circle key={u} cx={p.x} cy={p.y - 26 * k} r={30 * k} fill="#1E1E22" />; })}</g>
    ); } },
});

const OUT_DAY: Partial<RoomTokens> = { sky: ['#6FAEE3', '#B6DAF2', '#F2EEDC'], floor: '#8DBF6A', veil: 0.02, dust: 0.1, lamps: false };
const OUT_DUSK: Partial<RoomTokens> = { sky: ['#4A3A7A', '#E08A5E', '#FFC27A'], floor: '#6A7A52', veil: 0.3, dust: 0.3, lamps: true };
const OUT_NIGHT: Partial<RoomTokens> = { sky: ['#050914', '#0F1B3C', '#22335E'], floor: '#2E3A2E', veil: 0.5, dust: 0.2, lamps: true };
export const OUTDOOR_MOODS: Record<Mood, Partial<RoomTokens>> = { day: OUT_DAY, dusk: OUT_DUSK, night: OUT_NIGHT };

Object.assign(PLACES, {
  // ---------------------------------------- streets and outside (about a third of the stories)
  street: { mood: 'day', outdoor: true, palette: { floor: '#9C9890' }, lights: [],
    pieces: [{ p: 'facade', at: { u: -0.35 }, len: 0.5, color: '#C98F6A' }, { p: 'facade', at: { u: 0.17 }, len: 0.42, color: '#D8C7A2', opt: { floors: 4 } }, { p: 'facade', at: { u: 0.62 }, len: 0.75, color: '#9C6A5A' },
      { p: 'sidewalk', at: { u: -0.3, w: 0 }, len: 1.6, deep: 0.16 }, { p: 'road', at: { u: -0.3, w: 0.16 }, len: 1.6, deep: 0.34 }, { p: 'sidewalk', at: { u: -0.3, w: 0.5 }, len: 1.6, deep: 0.5 },
      { p: 'street-lamp', at: { u: 0.22, w: 0.12 } }, { p: 'car', id: 'car', at: { u: 0.6, w: 0.18 } }, { p: 'tree', at: { u: 0.88, w: 0.1 } }, { p: 'bin', at: { u: 0.08, w: 0.56 } }],
    front: [{ p: 'facade', at: { u: -0.35 }, len: 0.9, color: '#A88A6A', opt: { floors: 4 } }, { p: 'facade', at: { u: 0.55 }, len: 0.8, color: '#C9B08A' }] },
  garden: { mood: 'day', outdoor: true, lights: [],
    pieces: [{ p: 'hedge', at: { u: -0.3 }, len: 1.6 }, { p: 'house', at: { u: 0.25 }, len: 0.5 }, { p: 'path', at: { u: 0.44, w: 0 }, len: 0.12, deep: 1 }, { p: 'tree', at: { u: 0.1, w: 0.2 } }, { p: 'flowers', at: { u: 0.72, w: 0.3 } }, { p: 'bench', at: { u: 0.7, w: 0.46 } }],
    front: [{ p: 'fence', at: { u: -0.3 }, len: 1.6 }, { p: 'skyline', at: { u: -0.3 }, len: 1.6 }] },
  park: { mood: 'day', outdoor: true, lights: [],
    pieces: [{ p: 'hedge', at: { u: -0.3 }, len: 1.6, color: '#5E8F48' }, { p: 'skyline', at: { u: -0.3 }, len: 1.6 }, { p: 'path', at: { u: 0.36, w: 0 }, len: 0.2, deep: 1 }, { p: 'tree', at: { u: 0.08, w: 0.15 } }, { p: 'tree', at: { u: 0.86, w: 0.24 } }, { p: 'bench', id: 'bench', at: { u: 0.62, w: 0.36 } }, { p: 'street-lamp', at: { u: 0.3, w: 0.22 } }],
    front: [{ p: 'hedge', at: { u: -0.3 }, len: 1.6 }] },
  schoolyard: { mood: 'day', outdoor: true, palette: { floor: '#B8826A' }, lights: [],
    pieces: [{ p: 'facade', at: { u: -0.3 }, len: 1.6, color: '#F2D34A', opt: { floors: 2 } }, { p: 'picnic-table', id: 't1', at: { u: 0.18, w: 0.4 } }, { p: 'picnic-table', id: 't2', at: { u: 0.58, w: 0.4 } }, { p: 'tree', at: { u: 0.04, w: 0.14 } }, { p: 'tree', at: { u: 0.92, w: 0.16 } }, { p: 'bus', at: { u: 0.62, w: 0.04 } }],
    front: [{ p: 'fence', at: { u: -0.3 }, len: 1.6, color: '#9AA0A8' }, { p: 'skyline', at: { u: -0.3 }, len: 1.6 }] },
  rooftop: { mood: 'dusk', outdoor: true, palette: { floor: '#6E6A66' }, lights: [],
    pieces: [{ p: 'skyline', at: { u: -0.3 }, len: 1.6 }, { p: 'parapet', at: { u: -0.3, w: 0.02 }, len: 1.6 }, { p: 'bench', at: { u: 0.18, w: 0.4 } }, { p: 'plant', at: { u: 0.82, w: 0.3 } }],
    front: [{ p: 'facade', at: { u: 0.3 }, len: 0.4, color: '#7A6A62', opt: { floors: 1 } }] },
  // ---------------------------------------- corridors, offices, services
  corridor: { mood: 'day', floor: 'tiles', lights: [{ u: 0.5, w: 0.25 }, { u: 0.5, w: 0.6 }],
    pieces: [{ p: 'door', at: { u: 0.1 } }, { p: 'door', at: { u: 0.43 } }, { p: 'door', at: { u: 0.76 } }, { p: 'alarm', at: { u: 0.62 } }, { p: 'locker', id: 'lockers', at: { u: 0.0, w: 0.25 }, len: 0.05, deep: 0.5 }, { p: 'plant', at: { u: 0.9, w: 0.3 } }],
    front: [{ p: 'door', at: { u: 0.45 } }, { p: 'clock', at: { u: 0.2 } }] },
  hallway: { mood: 'day', floor: 'tiles', lights: [{ u: 0.5, w: 0.3 }],
    pieces: [{ p: 'locker', id: 'lockers', at: { u: 0.04, w: 0 }, len: 0.56 }, { p: 'door', at: { u: 0.72 } }, { p: 'pinboard', at: { u: 0.62 } }, { p: 'bin', at: { u: 0.9, w: 0.2 } }],
    front: [{ p: 'locker', at: { u: 0.3, w: 0 }, len: 0.4 }, { p: 'window', at: { u: 0.05 }, len: 0.2 }] },
  hospital: { mood: 'day', floor: 'tiles', palette: { wall: '#CFE6DE', side: '#B6D2C8', floor: '#C8CEC8' }, lights: [{ u: 0.5, w: 0.35 }],
    pieces: [{ p: 'window', at: { u: 0.66 }, len: 0.2, opt: { curtains: false } }, { p: 'hospital-bed', id: 'bed', at: { u: 0.28, w: 0.05 } }, { p: 'monitor', at: { u: 0.2, w: 0.04 } }, { p: 'iv-stand', at: { u: 0.55, w: 0.12 } }, { p: 'curtain', at: { u: 0.0, w: 0.4 }, len: 0.16 }, { p: 'chair', id: 'visitor', at: { u: 0.62, w: 0.32 } }],
    front: [{ p: 'door', at: { u: 0.4 } }, { p: 'tv', at: { u: 0.7 }, len: 0.16 }] },
  clinic: { mood: 'day', floor: 'tiles', palette: { wall: '#E4ECF0', side: '#CCD6DC' }, lights: [{ u: 0.5, w: 0.35 }],
    pieces: [{ p: 'hospital-bed', id: 'exam', at: { u: 0.1, w: 0.05 }, len: 0.2, deep: 0.26 }, { p: 'desk', id: 'desk', at: { u: 0.56, w: 0.24 }, len: 0.24, deep: 0.08 }, { p: 'chair', id: 'patient', at: { u: 0.62, w: 0.38 } }, { p: 'frame', at: { u: 0.62 }, opt: { art: 2 } }, { p: 'wall-shelf', at: { u: 0.36 } }],
    front: [{ p: 'door', at: { u: 0.45 } }] },
  'police-office': { mood: 'dusk', floor: 'tiles', palette: { wall: '#C9BFA6', side: '#B4AA92' }, lights: [{ u: 0.5, w: 0.35 }],
    pieces: [{ p: 'whiteboard', at: { u: 0.12 }, len: 0.34 }, { p: 'window', at: { u: 0.62 }, len: 0.24, opt: { curtains: false } }, { p: 'table', id: 'desk', at: { u: 0.32, w: 0.34 }, len: 0.3, deep: 0.12 }, { p: 'chair', id: 'c1', at: { u: 0.38, w: 0.5 } }, { p: 'chair', id: 'c2', at: { u: 0.54, w: 0.5 } }, { p: 'bookshelf', at: { u: 0.78, w: 0 }, len: 0.16 }],
    front: [{ p: 'door', at: { u: 0.3 } }, { p: 'frame', at: { u: 0.6 } }] },
  cell: { mood: 'night', floor: 'tiles', palette: { wall: '#8C8E8A', side: '#767874', floor: '#5E605C' }, lights: [{ u: 0.5, w: 0.3 }],
    pieces: [{ p: 'bench', id: 'bench', at: { u: 0.2, w: 0.1 }, len: 0.3 }, { p: 'window', at: { u: 0.6 }, len: 0.1, opt: { curtains: false } }, { p: 'bars', at: { u: 0, w: 0.62 } }],
    front: [{ p: 'door', at: { u: 0.45 } }] },
  shop: { mood: 'day', floor: 'tiles', lights: [{ u: 0.3, w: 0.35 }, { u: 0.7, w: 0.35 }],
    pieces: [{ p: 'shelf', at: { u: 0.04, w: 0 } }, { p: 'shelf', at: { u: 0.36, w: 0 } }, { p: 'counter', id: 'counter', at: { u: 0.62, w: 0.3 }, len: 0.3 }, { p: 'shelf', at: { u: 0.08, w: 0.4 }, len: 0.22 }],
    front: [{ p: 'window', at: { u: 0.1 }, len: 0.34, opt: { curtains: false } }, { p: 'door', at: { u: 0.6 } }] },
  diner: { mood: 'dusk', floor: 'tiles', palette: { wall: '#E4D6B8', floor: '#B05A4A' }, lights: [{ u: 0.3, w: 0.35 }, { u: 0.7, w: 0.35 }],
    pieces: [{ p: 'counter', id: 'counter', at: { u: 0.04, w: 0 }, len: 0.6 }, { p: 'wall-shelf', at: { u: 0.7 } }, { p: 'table', id: 't1', at: { u: 0.2, w: 0.44 }, len: 0.2, deep: 0.1 }, { p: 'table', id: 't2', at: { u: 0.56, w: 0.44 }, len: 0.2, deep: 0.1 }],
    front: [{ p: 'window', at: { u: 0.1 }, len: 0.4 }, { p: 'door', at: { u: 0.65 } }] },
  salon: { mood: 'dusk', floor: 'boards', palette: { wall: '#6E5661', floor: '#7A5C49' }, lights: [{ u: 0.5, w: 0.3 }],
    pieces: [{ p: 'mirror', at: { u: 0.43 } }, { p: 'wall-shelf', at: { u: 0.12 } }, { p: 'chair', id: 'seat', at: { u: 0.47, w: 0.3 }, color: '#1B1B22' }, { p: 'counter', id: 'counter', at: { u: 0.72, w: 0 }, len: 0.26 }, { p: 'plant', at: { u: 0.08, w: 0.2 } }],
    front: [{ p: 'window', at: { u: 0.15 }, len: 0.3 }, { p: 'door', at: { u: 0.62 } }] },
  // ---------------------------------------- big rooms: receptions, stages
  reception: { mood: 'dusk', floor: 'boards', palette: { wall: '#E8DCCB', side: '#D6C8B4' }, lights: [{ u: 0.3, w: 0.35 }, { u: 0.7, w: 0.35 }],
    pieces: [{ p: 'arch', at: { u: 0.4, w: 0.04 } }, { p: 'window', at: { u: 0.08 }, len: 0.2 }, { p: 'window', at: { u: 0.72 }, len: 0.2 }, { p: 'round-table', id: 't1', at: { u: 0.14, w: 0.4 } }, { p: 'round-table', id: 't2', at: { u: 0.62, w: 0.4 } }, { p: 'flowers', at: { u: 0.21, w: 0.44 } }, { p: 'flowers', at: { u: 0.69, w: 0.44 } }],
    front: [{ p: 'door', at: { u: 0.45 } }, { p: 'frame', at: { u: 0.2 } }, { p: 'frame', at: { u: 0.7 } }] },
  auditorium: { mood: 'night', floor: 'boards', palette: { wall: '#2A2430', side: '#221C28' }, lights: [{ u: 0.5, w: 0.2 }],
    pieces: [{ p: 'screen', at: { u: 0.2 }, len: 0.6 }, { p: 'stage', at: { u: 0.05, w: 0 }, len: 0.9 }, { p: 'podium', id: 'podium', at: { u: 0.72, w: 0.08 } }, { p: 'seat-row', id: 'r1', at: { u: 0.1, w: 0.42 }, len: 0.8 }, { p: 'seat-row', id: 'r2', at: { u: 0.1, w: 0.56 }, len: 0.8 }],
    front: [{ p: 'door', at: { u: 0.1 } }, { p: 'door', at: { u: 0.78 } }] },
  cafeteria: { mood: 'day', floor: 'tiles', lights: [{ u: 0.3, w: 0.35 }, { u: 0.7, w: 0.35 }],
    pieces: [{ p: 'counter', id: 'counter', at: { u: 0.04, w: 0 }, len: 0.56 }, { p: 'window', at: { u: 0.7 }, len: 0.22 }, { p: 'table', id: 't1', at: { u: 0.18, w: 0.42 }, len: 0.24, deep: 0.1 }, { p: 'table', id: 't2', at: { u: 0.56, w: 0.42 }, len: 0.24, deep: 0.1 }],
    front: [{ p: 'door', at: { u: 0.45 } }, { p: 'pinboard', at: { u: 0.1 } }] },
});
// the reverse views of the first recipes: what was behind the camera
Object.assign(PLACES.classroom!, { front: [{ p: 'door', at: { u: 0.12 } }, { p: 'pinboard', at: { u: 0.34 } }, { p: 'window', at: { u: 0.62 }, len: 0.26 }] });
Object.assign(PLACES.bedroom!, { front: [{ p: 'door', at: { u: 0.62 } }, { p: 'frame', at: { u: 0.2 }, opt: { art: 0 } }, { p: 'mirror', at: { u: 0.4 } }] });
Object.assign(PLACES.kitchen!, { front: [{ p: 'door', at: { u: 0.7 } }, { p: 'window', at: { u: 0.2 }, len: 0.24 }] });
Object.assign(PLACES.living!, { front: [{ p: 'tv', at: { u: 0.36 }, len: 0.26 }, { p: 'door', at: { u: 0.78 } }, { p: 'frame', at: { u: 0.12 }, opt: { art: 1 } }] });
Object.assign(PLACES.office!, { front: [{ p: 'door', at: { u: 0.2 } }, { p: 'window', at: { u: 0.5 }, len: 0.3, opt: { curtains: false } }] });
Object.assign(PLACES.restaurant!, { front: [{ p: 'window', at: { u: 0.1 }, len: 0.3 }, { p: 'door', at: { u: 0.62 } }] });

export type PlaceOpts = {
  mood?: Mood;
  /** colours to override: wall, floor, side, wood, fabric, board… (a hex; wood and fabric take a hex or a full {top, front, side}) */
  palette?: Partial<Omit<RoomTokens, 'wood' | 'fabric'>> & { wood?: string | Solid; fabric?: string | Solid };
  /** add pieces to the recipe */ add?: PieceSpec[];
  /** remove pieces of the recipe by id or name */ remove?: string[];
  /** replace all pieces */ pieces?: PieceSpec[];
  /** what goes on the board, screen or table, by piece id: { board: <g>…</g> } */ slots?: Record<string, React.ReactNode>;
  /** what hangs on the opposite wall, seen in the reverse view; replaces the recipe's */ front?: PieceSpec[];
  lights?: { u: number; w: number }[];
};
type Resolved = PieceSpec & { name: string; id: string; def: PieceDef; u: number; w: number; len: number; deep: number };
export type Placed = {
  ground: Ground;
  /** the room and what hangs on its walls; goes first in a Stage */ Shell: React.FC<{ t: number; id?: string }>;
  /** the furniture, as stage elements sorted by depth with the people */ items: (t: number) => React.ReactNode[];
  /** floor position of seat `i` on piece `id` */ seat: (id: string, i?: number) => { u: number; w: number };
  has: (id: string) => boolean;
  /** true when someone sitting at piece `id` needs a stool under them */ wantsStool: (id: string) => boolean;
  /** the world point a hand goes to on piece `id` (its top, or the middle of a wall piece) */ pointOf: (id: string) => { x: number; y: number };
  tokens: RoomTokens;
  outdoor: boolean;
  view: 'front' | 'reverse';
  /** the same place seen from the other end of the room: the opposite wall, the furniture mirrored */ reverse: Placed;
};

/** Finds a piece by id, or by a loose name the model tends to use (chair2, table, couch). */
const finderOf = (resolved: Resolved[]) => (id: string, i = 0): { piece: Resolved; idx: number } | undefined => {
  const direct = resolved.find((x) => x.id === id);
  if (direct) return { piece: direct, idx: i };
  const m = /^(stool|chair|seat|arm|armchair|couch|desk|table)([1-4])?$/i.exec(id);
  if (!m) return undefined;
  const kind = m[1]!.toLowerCase();
  const n = m[2] ? Number(m[2]) - 1 : i;
  if (kind === 'stool' || kind === 'chair' || kind === 'seat' || kind === 'arm' || kind === 'armchair') {
    const byC = resolved.find((x) => x.id === `c${n + 1}`);
    if (byC) return { piece: byC, idx: 0 };
    const chairs = resolved.filter((x) => x.name === 'chair' || x.name === 'sofa');
    if (chairs[n]) return { piece: chairs[n]!, idx: 0 };
    const tbl = resolved.find((x) => x.name === 'table' || x.name === 'desk');
    if (tbl) return { piece: tbl, idx: n };
  }
  if (kind === 'couch') {
    const sofa = resolved.find((x) => x.name === 'sofa');
    if (sofa) return { piece: sofa, idx: n };
  }
  if (kind === 'desk' || kind === 'table') {
    const byD = resolved.find((x) => x.id === `d${n + 1}` || x.id === `t${n + 1}`);
    if (byD) return { piece: byD, idx: 0 };
    const tbl = resolved.find((x) => x.name === kind || x.name === 'table' || x.name === 'desk');
    if (tbl) return { piece: tbl, idx: n };
  }
  return undefined;
};

/** The same spot seen from the other end of the room: left and right swap, near and far swap. */
export const mirrorSpot = (at: { u: number; w: number }): { u: number; w: number } => ({ u: 1 - at.u, w: Math.min(0.95, 1 - at.w) });
/** A person's yaw seen from the other end of the room: a face becomes a back, screen-right becomes screen-left. */
export const mirrorYaw = (yaw: number): number => (yaw >= 0 ? -(2 - yaw) : 2 + yaw);

/** Build a place from a recipe name (see PLACES) and your changes. */
export const place = (name: string, opts: PlaceOpts = {}): Placed => {
  const base = PLACES[name];
  if (!base) throw new Error(`unknown place "${name}". Places: ${Object.keys(PLACES).join(', ')}. For anything else use place('blank', { pieces: [...] }), or place('open', { pieces: [...] }) outdoors.`);
  const outdoor = Boolean(base.outdoor);
  const moodName = opts.mood ?? base.mood;
  const mood = { ...MOODS[moodName], ...(outdoor ? OUTDOOR_MOODS[moodName] : {}) };
  const pal = opts.palette ?? {};
  const T: RoomTokens = {
    ...mood,
    floorKind: base.floor ?? mood.floorKind,
    ...(base.palette ?? {}),
    ...(pal as Partial<RoomTokens>),
    wood: typeof pal.wood === 'string' ? tone(pal.wood, mood.wood) : pal.wood ?? mood.wood,
    fabric: typeof pal.fabric === 'string' ? tone(pal.fabric, mood.fabric) : pal.fabric ?? mood.fabric,
  };
  const removed = new Set(opts.remove ?? []);
  const keep = (list: PieceSpec[]) => list.filter((x) => !removed.has(x.id ?? x.p) && !removed.has(x.p));
  const resolve = (x: PieceSpec): Resolved => {
    const def: PieceDef | undefined = x.draw ? { kind: x.wall ? 'wall' : 'floor', len: x.len ?? 0.1, deep: x.deep ?? 0.1, draw: x.draw } : PIECES[x.p];
    if (!def) throw new Error(`unknown piece "${x.p}". Pieces: ${Object.keys(PIECES).join(', ')}. For anything else give the piece a draw function.`);
    return { ...x, name: x.p, id: x.id ?? x.p, def, u: x.at?.u ?? 0.5, w: x.at?.w ?? def.w ?? 0.3, len: x.len ?? def.len, deep: x.deep ?? def.deep };
  };
  const frontList = keep([...(opts.pieces ?? base.pieces), ...(opts.add ?? [])]).map(resolve);
  // the reverse view: floor pieces seen from the other end (those right behind the camera drop out), and the opposite wall
  const reverseList = [
    ...frontList
      .filter((x) => x.def.kind !== 'wall')
      .map((x) => ({ ...x, u: 1 - x.u - x.len, w: x.def.kind === 'flat' ? Math.max(0, 1 - x.w - x.deep) : 1 - x.w - x.deep }))
      .filter((x) => x.def.kind === 'flat' || x.w + x.deep <= 0.9),
    ...keep(opts.front ?? base.front ?? [{ p: 'door', at: { u: 0.45 } }]).map(resolve),
  ];
  const r = ROOM;
  const lights = opts.lights ?? base.lights ?? (outdoor ? [] : [{ u: 0.5, w: 0.4 }]);

  const build = (resolved: Resolved[], lamps: { u: number; w: number }[], view: 'front' | 'reverse'): Placed => {
    const ctx = (x: Resolved, t: number): DrawCtx => ({ r, T, t, u: x.u, w: x.w, len: x.len, deep: x.deep, color: x.color, opt: x.opt ?? {}, slot: opts.slots?.[x.id] });
    const walls = (t: number) => resolved.filter((x) => x.def.kind === 'wall').map((x, i) => <g key={`w${i}`}>{x.def.draw(ctx(x, t))}</g>);
    const flats = (t: number) => resolved.filter((x) => x.def.kind === 'flat').map((x, i) => <g key={`f${i}`}>{x.def.draw(ctx(x, t))}</g>);
    const skyId = `sky${name}${view}`;
    const Shell: Placed['Shell'] = ({ t, id = 'pl' }) =>
      outdoor ? (
        <g>
          <defs>
            <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.sky[0]} />
              <stop offset="70%" stopColor={T.sky[1]} />
              <stop offset="100%" stopColor={T.sky[2]} />
            </linearGradient>
          </defs>
          <rect x={-3000} y={-3000} width={9000} height={3000 + r.back.y1} fill={`url(#${skyId})`} />
          <rect x={-3000} y={r.back.y1} width={9000} height={4000} fill={T.floor} />
          {flats(t)}
          {walls(t)}
          <LightVeil id={`${id}v`} lights={[[960, 200, 900]]} o={T.veil} />
          <Dust t={t} seed={7} x0={300} y0={200} w={1300} h={600} n={14} o={T.dust} />
        </g>
      ) : (
        <g>
          <RoomShell r={r} id={id} wall={T.wall} side={T.side} floorC={T.floor} ceiling={T.ceiling} lines={T.floorLine} floor={T.floorKind} />
          {/* the shell's noise texture reads as dirty clouds on a flat cartoon wall: paint most of it back to the plain colour */}
          <g opacity={0.7}>
            <rect x={r.back.x0} y={r.back.y0} width={r.back.x1 - r.back.x0} height={r.back.y1 - r.back.y0} fill={T.wall} />
            <polygon points={r.Q([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]])} fill={T.side} />
            <polygon points={r.Q([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]])} fill={T.side} />
          </g>
          <RoomCorners x0={r.back.x0} x1={r.back.x1} y0={r.back.y0} y1={r.back.y1} />
          <rect x={r.back.x0} y={r.back.y1 - 14} width={r.back.x1 - r.back.x0} height={14} fill={T.trim} />
          {walls(t)}
          {flats(t)}
          {lamps.map((l, i) => <Pendant key={i} r={r} u={l.u} w={l.w} t={t} glow={T.lamps ? 0.55 : 0.12} cone={T.lamps ? 0.28 : 0.05} />)}
          <LightVeil id={`${id}v`} lights={[...lamps.map((l) => pendantLight(r, l.u, l.w)), ...resolved.filter((x) => x.name === 'window').map((x): [number, number, number] => [backX(r, x.u + x.len / 2), 360, 420])]} o={T.veil} />
          <Dust t={t} seed={11} x0={380} y0={260} w={1040} h={480} n={24} o={T.dust} />
        </g>
      );
    const items: Placed['items'] = (t) =>
      resolved.filter((x) => x.def.kind === 'floor').map((x, i) => (
        <StageItem key={i} depth={x.w + x.deep / 2}>
          {x.def.draw(ctx(x, t))}
        </StageItem>
      ));
    const findPiece = finderOf(resolved);
    // seats always come from the front layout: a shot in the reverse view mirrors the people itself
    const frontSeat = (id: string, i = 0) => {
      const found = findFront(id, i);
      if (!found) throw new Error(`no piece "${id}" in this place. It has: ${frontList.map((x) => x.id).join(', ')}.`);
      const { piece: x, idx } = found;
      if (!x.def.seats) throw new Error(`piece "${id}" has no seat: give the person an \`at\` instead.`);
      return x.def.seats(x, idx);
    };
    return {
      ground: roomGround(r),
      Shell,
      items,
      seat: frontSeat,
      has: (id) => !!findPiece(id),
      wantsStool: (id) => !!findFront(id)?.piece.def.stool || /^stool[1-4]?$/i.test(id),
      pointOf: (id) => {
        const x = findPiece(id)?.piece;
        if (!x) throw new Error(`no piece "${id}" in this ${view === 'reverse' ? 'reverse view' : 'place'}. It has: ${resolved.map((y) => y.id).join(', ')}.`);
        if (x.def.kind !== 'floor') return r.P(x.u + x.len / 2, 0.45, 0);
        return r.P(x.u + x.len / 2, x.def.top ?? 0.8, x.w + x.deep / 2);
      },
      tokens: T,
      outdoor,
      view,
      get reverse(): Placed {
        return reversePlaced();
      },
    };
  };
  let rev: Placed | null = null;
  const findFront = finderOf(frontList);
  const front = build(frontList, lights, 'front');
  const reversePlaced = (): Placed => (rev ??= build(reverseList, lights.map(mirrorSpot), 'reverse'));
  return front;
};
