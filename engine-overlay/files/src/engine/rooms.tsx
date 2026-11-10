import React from 'react';
import { Box, makeRoom } from './room';
import type { Room } from './room';
import { RoomShell, FloorPlant, FloorShadow, WallFrame, WallClock, Pendant, pendantLight } from './furnish';
import { LightVeil, Dust, Glow } from './light';
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
export const PLACES: Record<string, { mood: Mood; floor?: 'boards' | 'tiles'; lights?: { u: number; w: number }[]; pieces: PieceSpec[] }> = {
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

export type PlaceOpts = {
  mood?: Mood;
  /** colours to override: wall, floor, side, wood, fabric, board… (a hex; wood and fabric take a hex or a full {top, front, side}) */
  palette?: Partial<Omit<RoomTokens, 'wood' | 'fabric'>> & { wood?: string | Solid; fabric?: string | Solid };
  /** add pieces to the recipe */ add?: PieceSpec[];
  /** remove pieces of the recipe by id or name */ remove?: string[];
  /** replace all pieces */ pieces?: PieceSpec[];
  /** what goes on the board, screen or table, by piece id: { board: <g>…</g> } */ slots?: Record<string, React.ReactNode>;
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
  tokens: RoomTokens;
};

/** Build a place from a recipe name (see PLACES) and your changes. */
export const place = (name: string, opts: PlaceOpts = {}): Placed => {
  const base = PLACES[name];
  if (!base) throw new Error(`unknown place "${name}". Places: ${Object.keys(PLACES).join(', ')}. For anything else use place('blank', { pieces: [...] }).`);
  const mood = MOODS[opts.mood ?? base.mood];
  const pal = opts.palette ?? {};
  const T: RoomTokens = {
    ...mood,
    floorKind: base.floor ?? mood.floorKind,
    ...(pal as Partial<RoomTokens>),
    wood: typeof pal.wood === 'string' ? tone(pal.wood, mood.wood) : pal.wood ?? mood.wood,
    fabric: typeof pal.fabric === 'string' ? tone(pal.fabric, mood.fabric) : pal.fabric ?? mood.fabric,
  };
  const removed = new Set(opts.remove ?? []);
  const list = [...(opts.pieces ?? base.pieces), ...(opts.add ?? [])].filter((s) => !removed.has(s.id ?? s.p) && !removed.has(s.p));
  const resolved: Resolved[] = list.map((s) => {
    const def: PieceDef | undefined = s.draw ? { kind: s.wall ? 'wall' : 'floor', len: s.len ?? 0.1, deep: s.deep ?? 0.1, draw: s.draw } : PIECES[s.p];
    if (!def) throw new Error(`unknown piece "${s.p}". Pieces: ${Object.keys(PIECES).join(', ')}. For anything else give the piece a draw function.`);
    return { ...s, name: s.p, id: s.id ?? s.p, def, u: s.at?.u ?? 0.5, w: s.at?.w ?? def.w ?? 0.3, len: s.len ?? def.len, deep: s.deep ?? def.deep };
  });
  const r = ROOM;
  const ctx = (s: Resolved, t: number): DrawCtx => ({ r, T, t, u: s.u, w: s.w, len: s.len, deep: s.deep, color: s.color, opt: s.opt ?? {}, slot: opts.slots?.[s.id] });
  const lights = opts.lights ?? base.lights ?? [{ u: 0.5, w: 0.4 }];

  const Shell: Placed['Shell'] = ({ t, id = 'pl' }) => (
    <g>
      <RoomShell r={r} id={id} wall={T.wall} side={T.side} floorC={T.floor} ceiling={T.ceiling} lines={T.floorLine} floor={T.floorKind} />
      <rect x={r.back.x0} y={r.back.y1 - 14} width={r.back.x1 - r.back.x0} height={14} fill={T.trim} />
      {resolved.filter((s) => s.def.kind !== 'floor').map((s, i) => <g key={i}>{s.def.draw(ctx(s, t))}</g>)}
      {lights.map((l, i) => <Pendant key={i} r={r} u={l.u} w={l.w} t={t} glow={T.lamps ? 0.55 : 0.12} cone={T.lamps ? 0.28 : 0.05} />)}
      <LightVeil id={`${id}v`} lights={[...lights.map((l) => pendantLight(r, l.u, l.w)), ...resolved.filter((s) => s.name === 'window').map((s): [number, number, number] => [backX(r, s.u + s.len / 2), 360, 420])]} o={T.veil} />
      <Dust t={t} seed={11} x0={380} y0={260} w={1040} h={480} n={24} o={T.dust} />
    </g>
  );
  const items: Placed['items'] = (t) =>
    resolved.filter((s) => s.def.kind === 'floor').map((s, i) => (
      <StageItem key={i} depth={s.w + s.deep / 2}>
        {s.def.draw(ctx(s, t))}
      </StageItem>
    ));
  const findPiece = (id: string, i = 0): { piece: Resolved; idx: number } | undefined => {
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
  const seat: Placed['seat'] = (id, i = 0) => {
    const found = findPiece(id, i);
    if (!found) throw new Error(`no piece "${id}" in this place. It has: ${resolved.map((x) => x.id).join(', ')}.`);
    const { piece: s, idx } = found;
    if (!s.def.seats) throw new Error(`piece "${id}" has no seat: give the person an \`at\` instead.`);
    return s.def.seats(s, idx);
  };
  return {
    ground: roomGround(r),
    Shell,
    items,
    seat,
    has: (id) => !!findPiece(id),
    wantsStool: (id) => !!findPiece(id)?.piece.def.stool || /^stool[1-4]?$/i.test(id),
    tokens: T,
  };
};
