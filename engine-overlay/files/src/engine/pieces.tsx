import React from 'react';
import { FONT } from './fonts';

// Reusable room pieces: flat things hung on a wall. They know nothing about a story (no demo sums, no fixed colours
// beyond defaults): colours come from props (a set's tokens), content comes in as children. A blackboard, a whiteboard
// and a pinboard are the same pieces with other tokens, in a school or in a meeting room.

/** A board on the back wall at wall coordinates: frame, writing surface and chalk tray. Children are the writing. */
export const WallBoard: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  frame?: string;
  surface?: string;
  tray?: string;
  /** faded earlier writing, as on a blackboard that was never fully wiped; null for a clean board */
  ghost?: { color: string; text: string[] } | null;
  /** chalk or markers resting on the tray */
  chalk?: boolean;
  children?: React.ReactNode;
}> = ({ x, y, w, h, frame = '#5A3A3E', surface = '#253C35', tray = '#4A3034', ghost = null, chalk = true, children }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={8} fill={frame} />
    <rect x={x + 16} y={y + 16} width={w - 32} height={h - 32} rx={4} fill={surface} />
    {ghost ? (
      <g fill={ghost.color} opacity={0.12} fontFamily={FONT.hand} fontSize={30}>
        <text x={x + 50} y={y + 70}>{ghost.text[0]}</text>
        <text x={x + w - 250} y={y + h - 50}>{ghost.text[1]}</text>
        <path d={`M ${x + w - 170} ${y + 50} L ${x + w - 110} ${y + 120} L ${x + w - 200} ${y + 120} Z`} fill="none" stroke={ghost.color} strokeWidth={3} />
      </g>
    ) : null}
    {children}
    <rect x={x} y={y + h - 4} width={w} height={14} fill={tray} />
    {chalk ? (
      <>
        <rect x={x + 70} y={y + h - 12} width={60} height={10} rx={3} fill="#8A8EA6" />
        <rect x={x + 150} y={y + h - 10} width={30} height={7} rx={3} fill="#F4F1EA" />
        <rect x={x + 194} y={y + h - 10} width={22} height={7} rx={3} fill="#E9C46A" />
      </>
    ) : null}
  </g>
);

export type PinItem = { dx: number; dy: number; c: string; rot: number };
export const PIN_ITEMS: PinItem[] = [
  { dx: 20, dy: 20, c: '#F4EEE0', rot: -4 },
  { dx: 86, dy: 26, c: '#E9C46A', rot: 3 },
  { dx: 152, dy: 18, c: '#9FC0D6', rot: -2 },
  { dx: 28, dy: 94, c: '#E4A27A', rot: 2 },
  { dx: 100, dy: 100, c: '#F4EEE0', rot: -3 },
  { dx: 168, dy: 90, c: '#B0D49A', rot: 4 },
];

/** A cork pinboard with pinned sheets; pass `items` for other sheets or children for your own drawings. */
export const PinBoard: React.FC<{
  x: number;
  y: number;
  w?: number;
  h?: number;
  frame?: string;
  cork?: string;
  items?: PinItem[];
  children?: React.ReactNode;
}> = ({ x, y, w = 240, h = 190, frame = '#6A4A34', cork = '#9A7450', items = PIN_ITEMS, children }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} fill={frame} />
    <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} fill={cork} />
    {items.map((it, i) => (
      <g key={`pp${i}`} transform={`rotate(${it.rot} ${x + it.dx} ${y + it.dy})`}>
        <rect x={x + it.dx} y={y + it.dy} width={52} height={62} fill={it.c} />
        <circle cx={x + it.dx + 26} cy={y + it.dy + 6} r={4} fill="#C0392B" />
      </g>
    ))}
    {children}
  </g>
);
