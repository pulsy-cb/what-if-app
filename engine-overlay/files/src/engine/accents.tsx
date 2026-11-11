import React from 'react';
import { STUDIO } from '../studio.config';

// Graphic accents, diegetic stamps, character micro-VFX, tabletop macro inserts, and episode grade looks.
// Designed to work identically in 16:9 (viewBox 0 0 1920 1080) and 9:16 (viewBox 510 -260 900 1600)
// without ever clipping at frame edges or requiring external font loaders in unit-test SSR sandboxes.

const PORTRAIT = STUDIO.height > STUDIO.width;
const VB = PORTRAIT ? { x: 510, y: -260, w: 900, h: 1600 } : { x: 0, y: 0, w: 1920, h: 1080 };
const DISPLAY_FONT = "'Bricolage Grotesque', system-ui, -apple-system, Segoe UI, sans-serif";
const MONO_FONT = "'Fragment Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const INK = '#1A1230';
const PILL = '#0B0816';
const CREAM = '#F6EFE3';
const LIVE = '#FF8A3D';
const GOLD = '#FFE27A';
const GOOD = '#5BE08A';
const BAD = '#FF5A4A';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut3 = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const backOut3 = (v: number) => {
  const x = clamp01(v);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export type ScreenAnchor = 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-center' | 'center';

function anchorPoint(pos: ScreenAnchor, padX = 72, padY = 86): { x: number; y: number; align: 'start' | 'middle' | 'end' } {
  const left = VB.x + (PORTRAIT ? 54 : padX);
  const right = VB.x + VB.w - (PORTRAIT ? 54 : padX);
  const top = VB.y + (PORTRAIT ? 110 : padY);
  const bottom = VB.y + VB.h - (PORTRAIT ? 150 : padY + 24);
  const midX = VB.x + VB.w / 2;
  const midY = VB.y + VB.h * (PORTRAIT ? 0.24 : 0.22);
  switch (pos) {
    case 'top-left':
      return { x: left, y: top, align: 'start' };
    case 'top-right':
      return { x: right, y: top, align: 'end' };
    case 'top-center':
      return { x: midX, y: top + 12, align: 'middle' };
    case 'bottom-left':
      return { x: left, y: bottom, align: 'start' };
    case 'bottom-center':
      return { x: midX, y: bottom, align: 'middle' };
    case 'center':
      return { x: midX, y: midY, align: 'middle' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Screen-space diegetic stamps, value pills, title cards & radial shock bursts
// ---------------------------------------------------------------------------------------------------------------

export type StampSpec = {
  /** Primary short diegetic readout: e.g. "URGENCES · 03H14", "3 ANS PLUS TÔT", "JOUR 4" */
  text: string;
  /** Optional secondary line: e.g. "CHU NORD", "SALLE D'ATTENTE" */
  sub?: string;
  /** Frame when the stamp pops in (default 2) */
  at?: number;
  /** Frames to stay visible before fading out (omit to hold until end of shot) */
  hold?: number;
  pos?: ScreenAnchor;
  accent?: string;
};

/** Diegetic time/place/chapter stamp card (16:9 & 9:16 safe). Never use for voice captions. */
export const StampCard: React.FC<StampSpec & { t: number }> = ({ text, sub, at = 2, hold, pos = 'top-left', accent = LIVE, t }) => {
  const dt = t - at;
  if (dt < 0) return null;
  if (hold !== undefined && dt > hold + 10) return null;
  const enter = backOut3(dt / 8);
  const exit = hold !== undefined && dt > hold ? 1 - clamp01((dt - hold) / 10) : 1;
  const op = clamp01(dt / 4) * exit;
  const { x, y, align } = anchorPoint(pos);
  const fs = PORTRAIT ? 34 : 36;
  const subFs = PORTRAIT ? 23 : 24;
  const mainChars = Math.max(text.length, sub ? Math.ceil(sub.length * 0.72) : 0);
  const w = Math.min(VB.w - 88, Math.max(220, Math.round(mainChars * (fs * 0.62) + 86)));
  const h = sub ? 104 : 72;
  const boxX = align === 'start' ? 0 : align === 'end' ? -w : -w / 2;
  const charsShown = Math.max(1, Math.min(text.length, Math.ceil((dt / 10) * text.length)));
  const shownText = dt < 12 ? text.slice(0, charsShown) : text;
  const blink = Math.floor(t / 10) % 2 === 0 ? 1 : 0.38;

  return (
    <g transform={`translate(${x} ${y}) scale(${0.86 + 0.14 * enter})`} opacity={op}>
      <rect x={boxX} y={-36} width={w} height={h} rx={18} fill={PILL} opacity={0.82} />
      <rect x={boxX} y={-36} width={w} height={h} rx={18} fill="none" stroke={CREAM} strokeWidth={2.5} opacity={0.45} />
      <rect x={boxX + 14} y={-20} width={6} height={h - 32} rx={3} fill={accent} />
      <circle cx={boxX + 38} cy={sub ? -4 : 0} r={7} fill={accent} opacity={blink} />
      <text x={boxX + 58} y={sub ? 7 : 12} fontFamily={MONO_FONT} fontSize={fs} fontWeight={700} fill={CREAM} letterSpacing={2.5}>
        {shownText}
      </text>
      {sub ? (
        <text x={boxX + 58} y={44} fontFamily={MONO_FONT} fontSize={subFs} fill={accent} letterSpacing={2} opacity={0.95}>
          {sub}
        </text>
      ) : null}
    </g>
  );
};

export type ValueTagSpec = {
  /** Static label ("15 000 €", "REFUSÉ", "03:14") OR omit when using `count` */
  text?: string;
  /** Animated live counter: `{ from: 0, to: 15000, suffix: ' €', dur: 28 }` */
  count?: { from: number; to: number; prefix?: string; suffix?: string; decimals?: number; dur?: number };
  /** Optional animated verdict mark drawn after `markAt` frames from `at` */
  mark?: 'check' | 'x';
  markAt?: number;
  at?: number;
  hold?: number;
  pos?: ScreenAnchor;
  x?: number;
  y?: number;
  accent?: string;
};

/** Animated number / price / verdict pill with optional live counter and check/cross mark (16:9 & 9:16 safe). */
export const ValueTag: React.FC<ValueTagSpec & { t: number }> = ({
  text,
  count,
  mark,
  markAt = 10,
  at = 4,
  hold,
  pos = 'top-right',
  x,
  y,
  accent = GOLD,
  t,
}) => {
  const dt = t - at;
  if (dt < 0) return null;
  if (hold !== undefined && dt > hold + 8) return null;
  const s = backOut3(dt / 7);
  const fade = hold !== undefined && dt > hold ? 1 - clamp01((dt - hold) / 8) : 1;

  let display = text ?? '';
  if (count) {
    const p = easeOut3(dt / Math.max(4, count.dur ?? 26));
    const val = count.from + (count.to - count.from) * p;
    const dec = count.decimals ?? 0;
    const formatted = dec > 0 ? val.toFixed(dec) : Math.round(val).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    display = `${count.prefix ?? ''}${formatted}${count.suffix ?? ''}`;
  }

  const fs = PORTRAIT ? 46 : 50;
  const markSpace = mark ? 66 : 0;
  const w = Math.min(VB.w - 84, Math.max(168, Math.round(display.length * (fs * 0.6) + 72 + markSpace)));
  const pt = x !== undefined && y !== undefined ? { x, y, align: 'middle' as const } : anchorPoint(pos);
  const cx = pt.align === 'start' ? pt.x + w / 2 : pt.align === 'end' ? pt.x - w / 2 : pt.x;
  const cy = pt.y + (pt.align === 'middle' ? 0 : 12);
  const m = clamp01((dt - markAt) / 5);
  const textX = mark ? -26 : 0;

  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`} opacity={fade}>
      <rect x={-w / 2} y={-44} width={w} height={88} rx={44} fill={PILL} opacity={0.84} />
      <rect x={-w / 2} y={-44} width={w} height={88} rx={44} fill="none" stroke={CREAM} strokeWidth={3} opacity={0.85} />
      <text x={textX} y={17} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={fs} fill={accent}>
        {display}
      </text>
      {mark && m > 0 ? (
        <g transform={`translate(${w / 2 - 48} 0)`}>
          {mark === 'x' ? (
            <path
              d="M -18 -18 L 18 18 M 18 -18 L -18 18"
              stroke={BAD}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={110}
              strokeDashoffset={110 * (1 - m)}
            />
          ) : (
            <path
              d="M -20 2 L -5 18 L 22 -18"
              fill="none"
              stroke={GOOD}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={90}
              strokeDashoffset={90 * (1 - m)}
            />
          )}
        </g>
      ) : null}
    </g>
  );
};

export type BurstSpec = {
  /** Frame when the impact burst triggers */
  at: number;
  /** Duration in frames (default 14) */
  dur?: number;
  color?: string;
};

/** Crisp 2D radial impact / shock lines around the frame edges on a twist or dramatic reveal. */
export const ShockBurst: React.FC<BurstSpec & { t: number }> = ({ at, dur = 14, color = '#FFF3DC', t }) => {
  const dt = t - at;
  if (dt < 0 || dt > dur) return null;
  const p = dt / Math.max(1, dur);
  const op = (1 - p) * 0.85;
  const cx = VB.x + VB.w / 2;
  const cy = VB.y + VB.h / 2;
  const rxInner = VB.w * (0.34 + 0.08 * p);
  const ryInner = VB.h * (0.32 + 0.08 * p);
  const rxOuter = VB.w * 0.68;
  const ryOuter = VB.h * 0.68;
  const rays = 22;

  return (
    <g opacity={op}>
      {Array.from({ length: rays }, (_, i) => {
        const a = (i / rays) * Math.PI * 2 + (i % 2 === 0 ? 0.04 : -0.03);
        const spread = i % 3 === 0 ? 0.042 : 0.024;
        const x0 = cx + Math.cos(a) * rxInner;
        const y0 = cy + Math.sin(a) * ryInner;
        const x1 = cx + Math.cos(a - spread) * rxOuter;
        const y1 = cy + Math.sin(a - spread) * ryOuter;
        const x2 = cx + Math.cos(a + spread) * rxOuter;
        const y2 = cy + Math.sin(a + spread) * ryOuter;
        return <polygon key={i} points={`${x0},${y0} ${x1},${y1} ${x2},${y2}`} fill={color} />;
      })}
    </g>
  );
};

export type HookTitleSpec = {
  lines: [string, string];
  accent?: string;
  accentT?: number;
  hold?: number;
};

/** Opening hook / premise card, responsive in both 16:9 and 9:16. */
export const HookTitle: React.FC<HookTitleSpec & { t: number }> = ({ lines, accent, accentT = 26, hold, t }) => {
  if (t < 0) return null;
  if (hold !== undefined && t > hold + 10) return null;
  const fade = hold !== undefined && t > hold ? 1 - clamp01((t - hold) / 10) : 1;
  const pop = (d: number) => backOut3((t - d) / 9);
  const pulse = t >= accentT && t < accentT + 14 ? 1 + 0.14 * Math.sin(((t - accentT) / 14) * Math.PI) : 1;
  const maxW = PORTRAIT ? 800 : 1680;
  const baseSize = PORTRAIT ? 98 : 118;
  const effSize = Math.max(44, Math.min(baseSize, Math.floor(maxW / (Math.max(9, lines[1].length) * 0.58))));
  const topY = VB.y + (PORTRAIT ? 210 : 175);
  const cleanWord = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const target = accent ? cleanWord(accent) : '';
  const words = lines[1].split(/\s+/).filter(Boolean);

  return (
    <g opacity={fade}>
      <g transform={`translate(960 ${topY}) scale(${pop(2)})`}>
        <text
          textAnchor="middle"
          fontFamily={DISPLAY_FONT}
          fontWeight={700}
          fontSize={Math.round(effSize * 0.5)}
          letterSpacing={3}
          fill={CREAM}
          stroke={INK}
          strokeWidth={8}
          paintOrder="stroke"
        >
          {lines[0]}
        </text>
      </g>
      <g transform={`translate(960 ${topY + effSize * 0.98}) scale(${pop(5)})`}>
        <text
          textAnchor="middle"
          fontFamily={DISPLAY_FONT}
          fontWeight={800}
          fontSize={effSize}
          fill={LIVE}
          stroke={INK}
          strokeWidth={11}
          paintOrder="stroke"
        >
          {words.map((w, i) => {
            const hit = Boolean(target && cleanWord(w) === target);
            return (
              <tspan key={i} fontSize={hit ? Math.round(effSize * pulse) : undefined} fill={hit ? GOLD : undefined}>
                {(i ? ' ' : '') + w}
              </tspan>
            );
          })}
        </text>
      </g>
    </g>
  );
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Character head-space micro-VFX (attaches cleanly via `vfx` on any person in `shot()`)
// ---------------------------------------------------------------------------------------------------------------

export type PersonVfxKind = 'focus' | 'shock' | 'sweat' | 'dizzy' | 'sparkle' | 'thought' | 'question' | 'anger';

export type PersonVfxSpec = {
  /** Frame of the shot when this reaction accent triggers */
  at: number;
  kind: PersonVfxKind;
  /** Short icon/number for `thought` (max ~10 chars: "15 000 €", "?", "✗", "03:14" — never a speech sentence) */
  label?: string;
  color?: string;
  dur?: number;
};

/** Renders head-attached 2D reaction symbols in local head coordinates (crown around y = -58..-82). */
export const HeadVfx: React.FC<{ items: PersonVfxSpec[]; t: number }> = ({ items, t }) => (
  <g>
    {items.map((item, idx) => {
      const dt = t - item.at;
      const dur = item.dur ?? (item.kind === 'dizzy' || item.kind === 'thought' ? 36 : 22);
      if (dt < 0 || dt > dur) return null;
      const p = dt / Math.max(1, dur);
      const fade = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;

      switch (item.kind) {
        case 'focus':
          return (
            <g key={idx} opacity={fade}>
              {[0, 1, 2].map((rIdx) => {
                const rt = dt - rIdx * 4;
                if (rt <= 0 || rt > 16) return null;
                const rad = 42 + rt * 7.5;
                return (
                  <circle
                    key={rIdx}
                    cx={0}
                    cy={-16}
                    r={rad}
                    fill="none"
                    stroke={item.color ?? GOLD}
                    strokeWidth={3.5}
                    opacity={clamp01(1 - rt / 16)}
                  />
                );
              })}
            </g>
          );

        case 'shock': {
          const s = backOut3(dt / 5);
          const col = item.color ?? GOLD;
          return (
            <g key={idx} transform={`translate(0 -66) scale(${s})`} opacity={fade}>
              {[-52, -26, 0, 26, 52].map((deg, rIdx) => (
                <path
                  key={rIdx}
                  transform={`rotate(${deg})`}
                  d="M 0 -10 L -5 -36 L 5 -36 Z"
                  fill={col}
                  stroke={INK}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
              ))}
            </g>
          );
        }

        case 'sweat': {
          const dropY = -42 + easeOut3(Math.min(1, dt / 16)) * 22;
          const s = backOut3(dt / 5);
          return (
            <g key={idx} transform={`translate(38 ${dropY}) scale(${s})`} opacity={fade}>
              <path
                d="M 0 -16 C 8 -4 11 4 11 10 A 11 11 0 1 1 -11 10 C -11 4 -8 -4 0 -16 Z"
                fill="#7FD4FF"
                stroke={INK}
                strokeWidth={2.8}
              />
              <ellipse cx={-3.5} cy={8} rx={2.5} ry={4.5} fill="#FFFFFF" opacity={0.75} />
            </g>
          );
        }

        case 'dizzy':
          return (
            <g key={idx} opacity={fade}>
              {[0, 1, 2].map((sIdx) => {
                const a = dt * 0.24 + (sIdx * Math.PI * 2) / 3;
                const sx = Math.cos(a) * 52;
                const sy = -66 + Math.sin(a) * 16;
                return (
                  <path
                    key={sIdx}
                    transform={`translate(${sx} ${sy}) scale(0.32)`}
                    d="M 0 -36 L 9 -11 L 36 -11 L 14 5 L 22 32 L 0 16 L -22 32 L -14 5 L -36 -11 L -9 -11 Z"
                    fill={item.color ?? GOLD}
                    stroke={INK}
                    strokeWidth={6}
                    strokeLinejoin="round"
                  />
                );
              })}
            </g>
          );

        case 'sparkle': {
          const k = Math.sin(clamp01(dt / 18) * Math.PI);
          return (
            <g key={idx} opacity={fade}>
              {[
                { x: -46, y: -56, sc: 0.55 },
                { x: 48, y: -44, sc: 0.42 },
              ].map((sp, sIdx) => (
                <path
                  key={sIdx}
                  transform={`translate(${sp.x} ${sp.y}) scale(${k * sp.sc}) rotate(${dt * 5})`}
                  d="M 0 -36 Q 5 -5 36 0 Q 5 5 0 36 Q -5 5 -36 0 Q -5 -5 0 -36 Z"
                  fill={item.color ?? GOLD}
                  stroke={INK}
                  strokeWidth={3}
                />
              ))}
            </g>
          );
        }

        case 'anger': {
          const pulse = 1 + 0.12 * Math.sin(dt * 0.8);
          return (
            <g key={idx} transform={`translate(34 -52) scale(${backOut3(dt / 5) * pulse})`} opacity={fade}>
              <path
                d="M -12 -4 Q -4 -4 -4 -12 M 4 -12 Q 4 -4 12 -4 M 12 4 Q 4 4 4 12 M -4 12 Q -4 4 -12 4"
                fill="none"
                stroke={item.color ?? BAD}
                strokeWidth={4.2}
                strokeLinecap="round"
              />
            </g>
          );
        }

        case 'question':
        case 'thought': {
          const s = backOut3(dt / 7);
          const txt = (item.label ?? (item.kind === 'question' ? '?' : '!')).slice(0, 12);
          const bw = Math.max(76, txt.length * 18 + 38);
          return (
            <g key={idx} transform={`translate(46 -98) scale(${s})`} opacity={fade}>
              <circle cx={-26} cy={38} r={5} fill={CREAM} stroke={INK} strokeWidth={2.5} />
              <circle cx={-16} cy={24} r={8} fill={CREAM} stroke={INK} strokeWidth={2.5} />
              <rect x={-bw / 2} y={-28} width={bw} height={48} rx={24} fill={CREAM} stroke={INK} strokeWidth={3} />
              <text y={5} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={26} fill={INK}>
                {txt}
              </text>
            </g>
          );
        }
      }
    })}
  </g>
);

// ---------------------------------------------------------------------------------------------------------------
// 3. Declarative top-down macro insert: `tabletopShot({ surface, items, hands, tag, stamp })`
// ---------------------------------------------------------------------------------------------------------------

export type TabletopSurface = 'wood' | 'dark-wood' | 'marble' | 'metal' | 'hospital' | 'cloth' | 'desk';

export type TabletopItemKind =
  | 'document'
  | 'bill'
  | 'envelope'
  | 'ring'
  | 'keys'
  | 'pills'
  | 'mug'
  | 'glass'
  | 'cash'
  | 'badge'
  | 'clock'
  | 'card'
  | 'photo'
  | 'box';

export type TabletopItemSpec = {
  kind: TabletopItemKind;
  /** Offset from screen centre (960, 540) in world units (-260..260 keeps items inside both 16:9 and 9:16!) */
  dx?: number;
  dy?: number;
  rot?: number;
  scale?: number;
  color?: string;
  /** Short title/header on a document, bill, badge, card, or clock time ("FACTURE", "URGENCES", "03:14") */
  label?: string;
  /** Highlighted value on a bill, card, cash stack ("15 000 €", "CONFIDENTIEL") */
  sub?: string;
  /** Frame when this item lands / slides onto the surface (0 = already on the table) */
  at?: number;
  /** Custom SVG override when `kind` alone isn't enough */
  draw?: (t: number, len: number) => React.ReactNode;
};

export type TabletopHandSpec = {
  side?: 'left' | 'right' | 'bottom';
  action?: 'reach' | 'point' | 'drop' | 'tremble';
  /** Index in `items` the hand aims toward (default 0) */
  target?: number;
  at?: number;
  /** Optional character (`cast(...)` / `makeLook(...)`) whose skin & sleeve colours are inherited automatically */
  who?: { skin?: string; jacket?: string; cast?: { over?: { color?: string }; top?: { color?: string } } };
  skin?: string;
  sleeve?: string;
};

export type TabletopSpec = {
  surface?: TabletopSurface;
  items: TabletopItemSpec[];
  hands?: TabletopHandSpec[];
  stamp?: StampSpec;
  tag?: ValueTagSpec;
  push?: boolean;
};

const SURFACE_PALETTE: Record<TabletopSurface, { bg: string; grain: string; accent: string }> = {
  wood: { bg: '#8C6239', grain: '#6F4B28', accent: '#A8794B' },
  'dark-wood': { bg: '#4A3426', grain: '#352318', accent: '#614634' },
  marble: { bg: '#DFDDD6', grain: '#C5C2B8', accent: '#F2F0EA' },
  metal: { bg: '#5B6573', grain: '#454E59', accent: '#758191' },
  hospital: { bg: '#CBE0DC', grain: '#A9C6C1', accent: '#E2F0ED' },
  cloth: { bg: '#8E2F3C', grain: '#6E202B', accent: '#A8404E' },
  desk: { bg: '#3B4254', grain: '#2B3140', accent: '#4D566B' },
};

function renderTabletopItem(it: TabletopItemSpec, t: number, len: number): React.ReactNode {
  if (it.draw) return it.draw(t, len);
  const col = it.color;
  switch (it.kind) {
    case 'document':
    case 'bill': {
      const isBill = it.kind === 'bill';
      const head = it.label ?? (isBill ? 'FACTURE' : 'DOSSIER');
      return (
        <g>
          <rect x={-165} y={-220} width={330} height={440} rx={12} fill="#000" opacity={0.24} transform="translate(12 16)" />
          <rect x={-165} y={-220} width={330} height={440} rx={12} fill="#F9F5EB" stroke={INK} strokeWidth={4} />
          <rect x={-140} y={-190} width={280} height={48} rx={8} fill={col ?? (isBill ? '#D94848' : '#3C5A99')} />
          <text x={0} y={-157} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={26} fill="#FFF" letterSpacing={2}>
            {head}
          </text>
          {[-105, -72, -39, -6].map((ly, i) => (
            <rect key={i} x={-132} y={ly} width={i % 2 === 0 ? 250 : 190} height={11} rx={5} fill="#C9C2B2" />
          ))}
          {it.sub ? (
            <g transform="translate(0 92)">
              <rect x={-132} y={-36} width={264} height={72} rx={12} fill="#FFF0D6" stroke={isBill ? '#D94848' : INK} strokeWidth={3} />
              <text y={11} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={34} fill={isBill ? '#C93232' : INK}>
                {it.sub}
              </text>
            </g>
          ) : null}
        </g>
      );
    }

    case 'envelope':
      return (
        <g>
          <rect x={-180} y={-115} width={360} height={230} rx={12} fill="#000" opacity={0.24} transform="translate(10 14)" />
          <rect x={-180} y={-115} width={360} height={230} rx={12} fill={col ?? '#F4E8D1'} stroke={INK} strokeWidth={4} />
          <path d="M -176 -111 L 0 24 L 176 -111" fill="none" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <circle cx={0} cy={18} r={24} fill="#C83E3E" stroke={INK} strokeWidth={3.5} />
          {it.label ? (
            <text y={82} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={26} fill={INK}>
              {it.label}
            </text>
          ) : null}
        </g>
      );

    case 'ring':
      return (
        <g>
          <ellipse cx={8} cy={12} rx={58} ry={58} fill="#000" opacity={0.25} />
          <circle r={56} fill="none" stroke={col ?? '#F5C451'} strokeWidth={18} />
          <circle r={56} fill="none" stroke={INK} strokeWidth={3.5} />
          <polygon points="0,-84 20,-62 0,-44 -20,-62" fill="#B8F2FF" stroke={INK} strokeWidth={3.5} />
        </g>
      );

    case 'keys':
      return (
        <g>
          <circle cx={-34} cy={0} r={38} fill="none" stroke={col ?? '#D8DCE6'} strokeWidth={10} />
          <circle cx={-34} cy={0} r={38} fill="none" stroke={INK} strokeWidth={3.5} />
          <g transform="rotate(14)">
            <rect x={-4} y={-10} width={128} height={20} rx={6} fill="#E6C265" stroke={INK} strokeWidth={3.5} />
            <rect x={86} y={10} width={14} height={22} fill="#E6C265" stroke={INK} strokeWidth={3.5} />
            <rect x={108} y={10} width={14} height={16} fill="#E6C265" stroke={INK} strokeWidth={3.5} />
          </g>
        </g>
      );

    case 'pills':
      return (
        <g>
          <rect x={-72} y={-108} width={144} height={216} rx={26} fill="#000" opacity={0.24} transform="translate(10 14)" />
          <rect x={-72} y={-82} width={144} height={190} rx={24} fill={col ?? '#E08A3C'} stroke={INK} strokeWidth={4} />
          <rect x={-80} y={-114} width={160} height={42} rx={12} fill="#F7F4EE" stroke={INK} strokeWidth={4} />
          <rect x={-58} y={-24} width={116} height={82} rx={8} fill="#F7F4EE" />
          {it.label ? (
            <text y={25} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={22} fill={INK}>
              {it.label}
            </text>
          ) : null}
          {[
            { x: 122, y: 42, r: 28 },
            { x: 158, y: 88, r: -35 },
          ].map((p, i) => (
            <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.r})`}>
              <rect x={-26} y={-12} width={52} height={24} rx={12} fill="#F7F4EE" stroke={INK} strokeWidth={3} />
              <rect x={-26} y={-12} width={26} height={24} rx={12} fill="#FF5A4A" stroke={INK} strokeWidth={3} />
            </g>
          ))}
        </g>
      );

    case 'mug':
    case 'glass': {
      const isMug = it.kind === 'mug';
      return (
        <g>
          <circle cx={10} cy={14} r={82} fill="#000" opacity={0.25} />
          {isMug ? <rect x={68} y={-18} width={38} height={36} rx={14} fill={col ?? '#F4EFE6'} stroke={INK} strokeWidth={4} /> : null}
          <circle r={80} fill={col ?? (isMug ? '#F4EFE6' : '#BCE7F7')} stroke={INK} strokeWidth={4} />
          <circle r={62} fill={isMug ? '#4A2C1B' : '#7BCBE8'} />
          <path d="M -32 -28 A 46 46 0 0 1 24 -36" fill="none" stroke="#FFF" strokeWidth={6} strokeLinecap="round" opacity={0.45} />
        </g>
      );
    }

    case 'cash':
    case 'card': {
      const isCard = it.kind === 'card';
      return (
        <g>
          <rect x={-145} y={-90} width={290} height={180} rx={16} fill="#000" opacity={0.25} transform="translate(10 14)" />
          <rect x={-145} y={-90} width={290} height={180} rx={16} fill={col ?? (isCard ? '#22304A' : '#65A868')} stroke={INK} strokeWidth={4} />
          {isCard ? (
            <rect x={-110} y={-36} width={52} height={40} rx={6} fill="#F0C75E" stroke={INK} strokeWidth={2.5} />
          ) : (
            <circle r={44} fill="#84C287" stroke={INK} strokeWidth={3} />
          )}
          <text y={isCard ? 52 : 12} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={32} fill="#F7F4EE">
            {it.label ?? (isCard ? 'CARTE' : '100 €')}
          </text>
        </g>
      );
    }

    case 'clock':
      return (
        <g>
          <circle cx={10} cy={14} r={104} fill="#000" opacity={0.25} />
          <circle r={102} fill="#F7F4EE" stroke={INK} strokeWidth={8} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={Math.cos(a) * 78}
                y1={Math.sin(a) * 78}
                x2={Math.cos(a) * 90}
                y2={Math.sin(a) * 90}
                stroke={INK}
                strokeWidth={i % 3 === 0 ? 5 : 2.5}
              />
            );
          })}
          <line x1={0} y1={0} x2={26} y2={-44} stroke={INK} strokeWidth={7} strokeLinecap="round" />
          <line
            x1={0}
            y1={0}
            x2={Math.cos(t * 0.12) * 68}
            y2={Math.sin(t * 0.12) * 68}
            stroke={BAD}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <circle r={7} fill={INK} />
        </g>
      );

    case 'badge':
    case 'photo':
    case 'box':
    default:
      return (
        <g>
          <rect x={-130} y={-150} width={260} height={300} rx={16} fill="#000" opacity={0.25} transform="translate(10 14)" />
          <rect x={-130} y={-150} width={260} height={300} rx={16} fill={col ?? '#F4EFE6'} stroke={INK} strokeWidth={4} />
          <rect x={-104} y={-120} width={208} height={168} rx={10} fill="#D6DFEB" stroke={INK} strokeWidth={3} />
          {it.label ? (
            <text y={98} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={26} fill={INK}>
              {it.label}
            </text>
          ) : null}
        </g>
      );
  }
}

/** A top-down macro insert of objects and reaching/pointing hands on a surface, 16:9 & 9:16 safe. Set `"size": "insert"` in episode.json. */
export const tabletopShot = (spec: TabletopSpec): React.FC<{ t: number; len: number; f?: number }> => {
  const TabletopComp: React.FC<{ t: number; len: number; f?: number }> = ({ t, len }) => {
    const pal = SURFACE_PALETTE[spec.surface ?? 'wood'] ?? SURFACE_PALETTE.wood;
    const zoom = spec.push === false ? 1 : 1 + 0.06 * clamp01(t / Math.max(1, len));

    return (
      <g>
        <g transform={`translate(960 540) scale(${zoom}) translate(-960 -540)`}>
          <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={pal.bg} />
          {[-420, -210, 0, 210, 420].map((dy, i) => (
            <rect
              key={i}
              x={VB.x - 160}
              y={540 + dy}
              width={VB.w + 320}
              height={8}
              fill={pal.grain}
              opacity={0.32}
            />
          ))}
          <ellipse cx={960} cy={540} rx={VB.w * 0.46} ry={VB.h * 0.42} fill={pal.accent} opacity={0.18} />

          {spec.items.map((it, idx) => {
            const at = it.at ?? 0;
            const dt = t - at;
            if (dt < 0) return null;
            const enter = at > 0 ? backOut3(dt / 8) : 1;
            const slideY = at > 0 ? (1 - easeOut3(dt / 8)) * -90 : 0;
            const ix = 960 + (it.dx ?? 0);
            const iy = 540 + (it.dy ?? 0) + slideY;
            const sc = (it.scale ?? 1) * (at > 0 ? 0.82 + 0.18 * enter : 1);
            return (
              <g key={idx} transform={`translate(${ix} ${iy}) rotate(${it.rot ?? 0}) scale(${sc})`}>
                {renderTabletopItem(it, t, len)}
              </g>
            );
          })}

          {(spec.hands ?? []).map((h, idx) => {
            const at = h.at ?? 6;
            const dt = t - at;
            if (dt < 0) return null;
            const target = spec.items[h.target ?? 0] ?? { dx: 0, dy: 0 };
            const tx = 960 + (target.dx ?? 0);
            const ty = 540 + (target.dy ?? 0);
            const reach = easeOut3(Math.min(1, dt / 12));
            const tremble = h.action === 'tremble' ? Math.sin(t * 1.9) * 5 : 0;
            const side = h.side ?? 'bottom';
            const skin = h.skin ?? h.who?.skin ?? '#E9BE9A';
            const sleeve = h.sleeve ?? h.who?.cast?.over?.color ?? h.who?.cast?.top?.color ?? h.who?.jacket ?? '#2F3D5C';

            const startX = side === 'left' ? VB.x - 140 : side === 'right' ? VB.x + VB.w + 140 : tx + 40;
            const startY = side === 'bottom' ? VB.y + VB.h + 150 : ty + 60;
            const stopX = side === 'left' ? tx - 95 : side === 'right' ? tx + 95 : tx + 24;
            const stopY = side === 'bottom' ? ty + 115 : ty + 20;
            const hx = startX + (stopX - startX) * reach + tremble;
            const hy = startY + (stopY - startY) * reach;
            const ang = (Math.atan2(ty - hy, tx - hx) * 180) / Math.PI + 90;

            return (
              <g key={idx} transform={`translate(${hx} ${hy}) rotate(${ang})`}>
                <ellipse cx={8} cy={40} rx={52} ry={160} fill="#000" opacity={0.2} />
                <ellipse cx={0} cy={0} rx={44} ry={52} fill={skin} stroke={INK} strokeWidth={4} />
                {[-24, -8, 10, 26].map((fx, fIdx) => (
                  <rect
                    key={fIdx}
                    x={fx - 8}
                    y={h.action === 'point' && fIdx !== 1 ? -46 : -78}
                    width={16}
                    height={h.action === 'point' && fIdx !== 1 ? 34 : 58}
                    rx={8}
                    fill={skin}
                    stroke={INK}
                    strokeWidth={3.5}
                  />
                ))}
                <rect x={-48} y={38} width={96} height={380} rx={28} fill={sleeve} stroke={INK} strokeWidth={4} />
              </g>
            );
          })}
        </g>

        {spec.stamp ? <StampCard {...spec.stamp} t={t} /> : null}
        {spec.tag ? <ValueTag {...spec.tag} t={t} /> : null}
      </g>
    );
  };
  return TabletopComp;
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Built-in narrative episode grade/overlay looks (`memory`, `tension`, `revelation`, `nightmare`, `rewind`)
// ---------------------------------------------------------------------------------------------------------------

export type NarrativeLookDef = {
  grade?: (lv: number) => string;
  jitter?: number;
  Overlay?: React.FC<{ f: number; lv: number; p: number; n: number }>;
};

export const EPISODE_LOOKS: Record<string, NarrativeLookDef> = {
  /** Warm desaturated flashback / memory look */
  memory: {
    grade: (lv) => `saturate(${1 - 0.42 * lv}) sepia(${0.28 * lv}) contrast(${1 + 0.05 * lv})`,
    Overlay: ({ f }) => (
      <g pointerEvents="none">
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="none" stroke="#F6EFE3" strokeWidth={28} opacity={0.2} rx={36} />
        {[0, 1, 2, 3].map((i) => {
          const dx = VB.x + ((i * 257 + f * 2) % VB.w);
          const dy = VB.y + ((i * 389 + f * 3) % VB.h);
          return <circle key={i} cx={dx} cy={dy} r={3.5} fill="#FFF3DC" opacity={0.28} />;
        })}
      </g>
    ),
  },

  /** High-stakes anxiety / hospital / danger look with subtle pulse & micro-jitter */
  tension: {
    grade: (lv) => `saturate(${1 - 0.18 * lv}) contrast(${1 + 0.18 * lv}) brightness(${1 - 0.06 * lv})`,
    jitter: 2.2,
    Overlay: ({ f }) => {
      const pulse = 0.14 + 0.08 * Math.sin(f * 0.28);
      return (
        <g pointerEvents="none">
          <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="none" stroke="#FF3344" strokeWidth={48} opacity={pulse} />
        </g>
      );
    },
  },

  /** Crisp dramatic realization / twist highlight */
  revelation: {
    grade: (lv) => `saturate(${1 + 0.16 * lv}) contrast(${1 + 0.14 * lv}) brightness(${1 + 0.04 * lv})`,
    Overlay: () => (
      <g pointerEvents="none">
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="none" stroke="#FFE27A" strokeWidth={24} opacity={0.22} />
      </g>
    ),
  },

  /** Cold eerie nightmare / lie / betrayal tone */
  nightmare: {
    grade: (lv) => `saturate(${1 - 0.35 * lv}) hue-rotate(${-24 * lv}deg) contrast(${1 + 0.2 * lv}) brightness(${1 - 0.08 * lv})`,
    jitter: 3.5,
  },

  /** VHS time-bend / rewind look */
  rewind: {
    grade: (lv) => `saturate(${1 - 0.3 * lv}) hue-rotate(${18 * lv}deg) contrast(${1 + 0.12 * lv})`,
    jitter: 4.5,
    Overlay: ({ f }) => {
      const band = VB.y + VB.h - ((f * 53) % (VB.h + 320)) + 160;
      return (
        <g pointerEvents="none">
          <rect x={VB.x - 40} y={band} width={VB.w + 80} height={26} fill="#FFFFFF" opacity={0.12} />
          <rect x={VB.x - 40} y={band + 42} width={VB.w + 80} height={8} fill="#7FD4FF" opacity={0.14} />
        </g>
      );
    },
  },
};
