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

/** Fit monospace text strictly inside `maxWidth`: shrinks `fontSize` first, then falls back to `textLength` + `spacingAndGlyphs`. */
function fitMonoText(
  text: string,
  maxWidth: number,
  maxFs: number,
  minFs = 13,
  letterSpacing = 0,
): { fontSize: number; textLength?: number; lengthAdjust?: 'spacingAndGlyphs' } {
  const chars = Math.max(1, text.length);
  const usable = Math.max(24, maxWidth);
  const spacingTotal = Math.max(0, chars - 1) * letterSpacing;
  const ideal = Math.floor((usable - spacingTotal) / (chars * 0.62));
  const fontSize = Math.max(minFs, Math.min(maxFs, ideal));
  const estWidth = chars * fontSize * 0.62 + spacingTotal;
  if (estWidth > usable) {
    return { fontSize, textLength: Math.round(usable), lengthAdjust: 'spacingAndGlyphs' };
  }
  return { fontSize };
}

/** Deterministic word wrapper for card bodies and Polaroid captions. */
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      if (lines.length >= maxLines) return lines;
      cur = w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

let insertIdSeq = 0;
function makeInsertId(prefix: string, seedText: string): string {
  insertIdSeq += 1;
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  }
  return `${prefix}_${insertIdSeq}_${(h >>> 0).toString(36)}`;
}

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
  /** a named colour for the accent bar and the second line */
  tone?: 'amber' | 'red' | 'teal' | 'ink';
};
const STAMP_TONES: Record<string, string> = { amber: '#F2A33A', red: '#E5484D', teal: '#2BB3A3', ink: '#C9CCD6' };

/** Diegetic time/place/chapter stamp card (16:9 & 9:16 safe). Never use for voice captions. */
export const StampCard: React.FC<StampSpec & { t: number }> = ({ text, sub, at = 2, hold, pos = 'top-left', accent: accentIn, tone, t }) => {
  const accent = accentIn ?? (tone ? STAMP_TONES[tone] : undefined) ?? LIVE;
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
  // a monospace glyph is 0.6 em wide and the text is spaced 2.5: without the spacing a long stamp ran out of its box
  const w = Math.min(VB.w - 88, Math.max(220, Math.round(mainChars * (fs * 0.6 + 2.5) + 58 + 24)));
  const h = sub ? 104 : 72;
  const boxX = align === 'start' ? 0 : align === 'end' ? -w : -w / 2;
  const charsShown = Math.max(1, Math.min(text.length, Math.ceil((dt / 10) * text.length)));
  const shownText = dt < 12 ? text.slice(0, charsShown) : text;
  const blink = Math.floor(t / 10) % 2 === 0 ? 1 : 0.38;
  const maxTextW = w - 80;
  const mainFit = fitMonoText(text, maxTextW, fs, 16, 2.5);
  const subFit = sub ? fitMonoText(sub, maxTextW, subFs, 14, 2) : null;

  return (
    <g transform={`translate(${x} ${y}) scale(${0.86 + 0.14 * enter})`} opacity={op}>
      <rect x={boxX} y={-36} width={w} height={h} rx={18} fill={PILL} opacity={0.82} />
      <rect x={boxX} y={-36} width={w} height={h} rx={18} fill="none" stroke={CREAM} strokeWidth={2.5} opacity={0.45} />
      <rect x={boxX + 14} y={-20} width={6} height={h - 32} rx={3} fill={accent} />
      <circle cx={boxX + 38} cy={sub ? -4 : 0} r={7} fill={accent} opacity={blink} />
      <text
        x={boxX + 58}
        y={sub ? 7 : 12}
        fontFamily={MONO_FONT}
        fontSize={mainFit.fontSize}
        fontWeight={700}
        fill={CREAM}
        letterSpacing={2.5}
        textLength={dt >= 12 ? mainFit.textLength : undefined}
        lengthAdjust={dt >= 12 ? mainFit.lengthAdjust : undefined}
      >
        {shownText}
      </text>
      {sub && subFit ? (
        <text
          x={boxX + 58}
          y={44}
          fontFamily={MONO_FONT}
          fontSize={subFit.fontSize}
          fill={accent}
          letterSpacing={2}
          opacity={0.95}
          textLength={subFit.textLength}
          lengthAdjust={subFit.lengthAdjust}
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
};

export type ValueTagSpec = {
  /** Static label ("15 000 €", "REFUSÉ", "03:14") OR omit when using `count` */
  text?: string;
  /** a short second line under the pill ("FACTURE", "PAR MOIS") */
  sub?: string;
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
  sub,
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
      {sub ? (
        <g>
          <rect x={-Math.min(w, sub.length * 17 + 44) / 2} y={50} width={Math.min(w, sub.length * 17 + 44)} height={40} rx={20} fill={PILL} opacity={0.84} />
          <text y={78} textAnchor="middle" fontFamily={MONO_FONT} fontWeight={700} fontSize={PORTRAIT ? 24 : 26} fill={CREAM} letterSpacing={2}>{sub}</text>
        </g>
      ) : null}
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
  // Capitals with accents and a thick stroke are wide (about 0.7 em a letter, more when the accent word pulses): size by
  // the real width, and break the big line in two when one line would get too small (prof, 2026-11-11: title cut in 9:16).
  const maxW = PORTRAIT ? 780 : 1680;
  const em = 0.72;
  const baseSize = PORTRAIT ? 98 : 118;
  const cleanWord = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const target = accent ? cleanWord(accent) : '';
  const allWords = lines[1].split(/\s+/).filter(Boolean);
  const fitSize = (chars: number) => Math.floor(maxW / (Math.max(6, chars) * em * 1.08));
  let rows: string[][] = [allWords];
  if (PORTRAIT && fitSize(lines[1].length) < 70 && allWords.length > 1) {
    // balanced two-row split on the space nearest the middle
    let best = 1;
    let gap = Infinity;
    for (let i = 1; i < allWords.length; i++) {
      const left = allWords.slice(0, i).join(' ').length;
      const g = Math.abs(left - (lines[1].length - left));
      if (g < gap) {
        gap = g;
        best = i;
      }
    }
    rows = [allWords.slice(0, best), allWords.slice(best)];
  }
  const widest = Math.max(...rows.map((r) => r.join(' ').length));
  const effSize = Math.max(40, Math.min(baseSize, fitSize(widest)));
  const topSize = Math.max(26, Math.min(Math.round(effSize * 0.5), Math.floor(maxW / (Math.max(6, lines[0].length) * 0.66 * 1.08))));
  const topY = VB.y + (PORTRAIT ? 210 : 175);

  return (
    <g opacity={fade}>
      <g transform={`translate(960 ${topY}) scale(${pop(2)})`}>
        <text
          textAnchor="middle"
          fontFamily={DISPLAY_FONT}
          fontWeight={700}
          fontSize={topSize}
          letterSpacing={3}
          fill={CREAM}
          stroke={INK}
          strokeWidth={8}
          paintOrder="stroke"
        >
          {lines[0]}
        </text>
      </g>
      {rows.map((row, r) => (
        <g key={r} transform={`translate(960 ${topY + effSize * (0.98 + r * 1.02)}) scale(${pop(5 + r * 2)})`}>
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
            {row.map((w, i) => {
              const hit = Boolean(target && cleanWord(w) === target);
              return (
                <tspan key={i} fontSize={hit ? Math.round(effSize * pulse) : undefined} fill={hit ? GOLD : undefined}>
                  {(i ? ' ' : '') + w}
                </tspan>
              );
            })}
          </text>
        </g>
      ))}
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
  /** Highlighted value / stamp on a bill, document, card, cash stack ("15 000 €", "CONFIDENTIEL") */
  sub?: string;
  /** Optional alias for `sub` stamp text on a document/bill */
  stamp?: string;
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
      const headFit = fitMonoText(head, 256, 26, 13, 2);
      const subText = it.sub ?? it.stamp;
      const subFit = subText ? fitMonoText(subText, 240, 34, 13, 0) : null;
      return (
        <g>
          <rect x={-165} y={-220} width={330} height={440} rx={12} fill="#000" opacity={0.24} transform="translate(12 16)" />
          <rect x={-165} y={-220} width={330} height={440} rx={12} fill="#F9F5EB" stroke={INK} strokeWidth={4} />
          <rect x={-140} y={-190} width={280} height={48} rx={8} fill={col ?? (isBill ? '#D94848' : '#3C5A99')} />
          <text
            x={0}
            y={-166 + Math.round(headFit.fontSize * 0.35)}
            textAnchor="middle"
            fontFamily={MONO_FONT}
            fontWeight={700}
            fontSize={headFit.fontSize}
            fill="#FFF"
            letterSpacing={2}
            textLength={headFit.textLength}
            lengthAdjust={headFit.lengthAdjust}
          >
            {head}
          </text>
          {[-105, -72, -39, -6].map((ly, i) => (
            <rect key={i} x={-132} y={ly} width={i % 2 === 0 ? 250 : 190} height={11} rx={5} fill="#C9C2B2" />
          ))}
          {subText && subFit ? (
            <g transform="translate(0 92)">
              <rect x={-132} y={-36} width={264} height={72} rx={12} fill="#FFF0D6" stroke={isBill ? '#D94848' : INK} strokeWidth={3} />
              <text
                y={Math.round(subFit.fontSize * 0.34)}
                textAnchor="middle"
                fontFamily={MONO_FONT}
                fontWeight={700}
                fontSize={subFit.fontSize}
                fill={isBill ? '#C93232' : INK}
                textLength={subFit.textLength}
                lengthAdjust={subFit.lengthAdjust}
              >
                {subText}
              </text>
            </g>
          ) : null}
        </g>
      );
    }

    case 'envelope': {
      const envFit = it.label ? fitMonoText(it.label, 312, 26, 13, 0) : null;
      return (
        <g>
          <rect x={-180} y={-115} width={360} height={230} rx={12} fill="#000" opacity={0.24} transform="translate(10 14)" />
          <rect x={-180} y={-115} width={360} height={230} rx={12} fill={col ?? '#F4E8D1'} stroke={INK} strokeWidth={4} />
          <path d="M -176 -111 L 0 24 L 176 -111" fill="none" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <circle cx={0} cy={18} r={24} fill="#C83E3E" stroke={INK} strokeWidth={3.5} />
          {it.label && envFit ? (
            <text
              y={82}
              textAnchor="middle"
              fontFamily={MONO_FONT}
              fontWeight={700}
              fontSize={envFit.fontSize}
              fill={INK}
              textLength={envFit.textLength}
              lengthAdjust={envFit.lengthAdjust}
            >
              {it.label}
            </text>
          ) : null}
        </g>
      );
    }

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

    case 'pills': {
      const pillFit = it.label ? fitMonoText(it.label, 102, 22, 11, 0) : null;
      return (
        <g>
          <rect x={-72} y={-108} width={144} height={216} rx={26} fill="#000" opacity={0.24} transform="translate(10 14)" />
          <rect x={-72} y={-82} width={144} height={190} rx={24} fill={col ?? '#E08A3C'} stroke={INK} strokeWidth={4} />
          <rect x={-80} y={-114} width={160} height={42} rx={12} fill="#F7F4EE" stroke={INK} strokeWidth={4} />
          <rect x={-58} y={-24} width={116} height={82} rx={8} fill="#F7F4EE" />
          {it.label && pillFit ? (
            <text
              y={17 + Math.round(pillFit.fontSize * 0.34)}
              textAnchor="middle"
              fontFamily={MONO_FONT}
              fontWeight={700}
              fontSize={pillFit.fontSize}
              fill={INK}
              textLength={pillFit.textLength}
              lengthAdjust={pillFit.lengthAdjust}
            >
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
    }

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
      const cardText = it.label ?? (isCard ? 'CARTE' : '100 €');
      const cardFit = fitMonoText(cardText, 252, 32, 13, 0);
      return (
        <g>
          <rect x={-145} y={-90} width={290} height={180} rx={16} fill="#000" opacity={0.25} transform="translate(10 14)" />
          <rect x={-145} y={-90} width={290} height={180} rx={16} fill={col ?? (isCard ? '#22304A' : '#65A868')} stroke={INK} strokeWidth={4} />
          {isCard ? (
            <rect x={-110} y={-36} width={52} height={40} rx={6} fill="#F0C75E" stroke={INK} strokeWidth={2.5} />
          ) : (
            <circle r={44} fill="#84C287" stroke={INK} strokeWidth={3} />
          )}
          <text
            y={isCard ? 52 : 12}
            textAnchor="middle"
            fontFamily={MONO_FONT}
            fontWeight={700}
            fontSize={cardFit.fontSize}
            fill="#F7F4EE"
            textLength={cardFit.textLength}
            lengthAdjust={cardFit.lengthAdjust}
          >
            {cardText}
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
    default: {
      const boxFit = it.label ? fitMonoText(it.label, 224, 26, 13, 0) : null;
      return (
        <g>
          <rect x={-130} y={-150} width={260} height={300} rx={16} fill="#000" opacity={0.25} transform="translate(10 14)" />
          <rect x={-130} y={-150} width={260} height={300} rx={16} fill={col ?? '#F4EFE6'} stroke={INK} strokeWidth={4} />
          <rect x={-104} y={-120} width={208} height={168} rx={10} fill="#D6DFEB" stroke={INK} strokeWidth={3} />
          {it.label && boxFit ? (
            <text
              y={98}
              textAnchor="middle"
              fontFamily={MONO_FONT}
              fontWeight={700}
              fontSize={boxFit.fontSize}
              fill={INK}
              textLength={boxFit.textLength}
              lengthAdjust={boxFit.lengthAdjust}
            >
              {it.label}
            </text>
          ) : null}
        </g>
      );
    }
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
            const dropHand = (spec.hands ?? []).find((h) => h.action === 'drop' && (h.target ?? 0) === idx);
            let dropY = 0;
            let dropScale = 1;
            let dropRot = 0;
            if (dropHand) {
              const hdt = t - (dropHand.at ?? 6);
              if (hdt >= 0) {
                if (hdt < 10) {
                  const lift = easeOut3(clamp01(hdt / 10));
                  dropY = -28 * lift;
                  dropScale = 1 + 0.1 * lift;
                  dropRot = -7 * lift;
                } else {
                  const settle = easeOut3(clamp01((hdt - 10) / 8));
                  const bounce = Math.sin(clamp01((hdt - 10) / 10) * Math.PI) * 0.05;
                  dropY = -28 * (1 - settle);
                  dropScale = 1 + 0.1 * (1 - settle) - bounce;
                  dropRot = -7 * (1 - settle);
                }
              }
            }
            const ix = 960 + (it.dx ?? 0);
            const iy = 540 + (it.dy ?? 0) + slideY + dropY;
            const sc = (it.scale ?? 1) * (at > 0 ? 0.82 + 0.18 * enter : 1) * dropScale;
            return (
              <g key={idx} transform={`translate(${ix} ${iy}) rotate(${(it.rot ?? 0) + dropRot}) scale(${sc})`}>
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
            const isDrop = h.action === 'drop';
            const reach = easeOut3(Math.min(1, dt / (isDrop ? 10 : 12)));
            const openK = isDrop ? easeOut3(clamp01((dt - 10) / 7)) : 0;
            const retract = isDrop ? easeOut3(clamp01((dt - 12) / 14)) * 0.34 : 0;
            const travel = reach - retract;
            const tremble = h.action === 'tremble' ? Math.sin(t * 1.9) * 5 : 0;
            const side = h.side ?? 'bottom';
            const skin = h.skin ?? h.who?.skin ?? '#E9BE9A';
            const sleeve = h.sleeve ?? h.who?.cast?.over?.color ?? h.who?.cast?.top?.color ?? h.who?.jacket ?? '#2F3D5C';

            const startX = side === 'left' ? VB.x - 140 : side === 'right' ? VB.x + VB.w + 140 : tx + 40;
            const startY = side === 'bottom' ? VB.y + VB.h + 150 : ty + 60;
            const stopX = side === 'left' ? tx - 95 : side === 'right' ? tx + 95 : tx + 24;
            const stopY = side === 'bottom' ? ty + 115 : ty + 20;
            const hx = startX + (stopX - startX) * travel + tremble;
            const hy = startY + (stopY - startY) * travel;
            const ang = (Math.atan2(ty - hy, tx - hx) * 180) / Math.PI + 90;

            return (
              <g key={idx} transform={`translate(${hx} ${hy}) rotate(${ang})`}>
                <ellipse cx={8} cy={40} rx={52} ry={160} fill="#000" opacity={0.2} />
                <ellipse cx={0} cy={0} rx={44} ry={52} fill={skin} stroke={INK} strokeWidth={4} />
                {[-24, -8, 10, 26].map((fx, fIdx) => {
                  const spread = (fIdx - 1.5) * openK;
                  return (
                    <rect
                      key={fIdx}
                      x={fx - 8 + spread * 6}
                      y={h.action === 'point' && fIdx !== 1 ? -46 : -78 - openK * 4}
                      width={16}
                      height={h.action === 'point' && fIdx !== 1 ? 34 : 58 + openK * 4}
                      rx={8}
                      fill={skin}
                      stroke={INK}
                      strokeWidth={3.5}
                      transform={openK > 0 ? `rotate(${spread * 8} ${fx} -20)` : undefined}
                    />
                  );
                })}
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

// ---------------------------------------------------------------------------------------------------------------
// 5. Animated graphic insert factories: `notifShot`, `counterShot`, `polaroidShot` (16:9 & 9:16 safe)
// ---------------------------------------------------------------------------------------------------------------

export type NotifShotSpec = {
  /** Notification header / app name (e.g. "BANQUE", "ALERTE", "MESSAGES") */
  title: string;
  /** Main notification body text */
  body: string;
  /** Optional highlighted amount / value pill (e.g. "+ 8 000 000 €", "- 450 €") */
  amount?: string;
  /** Optional icon kind: 'bank' | 'bell' | 'mail' | 'alert' | 'check' | 'heart' (or a short symbol) */
  icon?: 'bank' | 'bell' | 'mail' | 'alert' | 'check' | 'heart' | string;
  /** Accent colour for the icon badge, bar, and amount */
  accent?: string;
  /** Backdrop colour */
  bg?: string;
  /** Optional hold duration in frames before a gentle fade-out */
  hold?: number;
};

function renderNotifIcon(icon: string, accent: string): React.ReactNode {
  switch (icon) {
    case 'bank':
      return (
        <g>
          <path d="M -20 -6 L 0 -20 L 20 -6 Z" fill="#FFF" />
          <rect x={-16} y={-2} width={6} height={16} rx={2} fill="#FFF" />
          <rect x={-3} y={-2} width={6} height={16} rx={2} fill="#FFF" />
          <rect x={10} y={-2} width={6} height={16} rx={2} fill="#FFF" />
          <rect x={-20} y={16} width={40} height={5} rx={2.5} fill="#FFF" />
        </g>
      );
    case 'mail':
      return (
        <g>
          <rect x={-20} y={-14} width={40} height={28} rx={4} fill="none" stroke="#FFF" strokeWidth={4} />
          <path d="M -18 -11 L 0 3 L 18 -11" fill="none" stroke="#FFF" strokeWidth={4} strokeLinejoin="round" />
        </g>
      );
    case 'alert':
      return (
        <g>
          <path d="M 0 -20 L 20 16 L -20 16 Z" fill="none" stroke="#FFF" strokeWidth={4} strokeLinejoin="round" />
          <line x1={0} y1={-7} x2={0} y2={5} stroke="#FFF" strokeWidth={4} strokeLinecap="round" />
          <circle cx={0} cy={11} r={2.5} fill="#FFF" />
        </g>
      );
    case 'check':
      return <path d="M -16 2 L -4 14 L 18 -12" fill="none" stroke="#FFF" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />;
    case 'heart':
      return <path d="M 0 16 C -18 4 -22 -12 -10 -16 C -3 -18 0 -11 0 -11 C 0 -11 3 -18 10 -16 C 22 -12 18 4 0 16 Z" fill="#FFF" />;
    case 'bell':
      return (
        <g>
          <path d="M -14 8 C -14 -8 -10 -16 0 -16 C 10 -16 14 -8 14 8 L 19 14 L -19 14 Z" fill="#FFF" />
          <circle cx={0} cy={18} r={4.5} fill={accent} stroke="#FFF" strokeWidth={2.5} />
        </g>
      );
    default:
      return (
        <text y={11} textAnchor="middle" fontFamily={DISPLAY_FONT} fontWeight={800} fontSize={30} fill="#FFF">
          {icon.slice(0, 2)}
        </text>
      );
  }
}

/** Animated push / bank notification card sliding down with subtle bounce (16:9 & 9:16 safe). Set `"size": "insert"` in episode.json. */
export const notifShot = (spec: NotifShotSpec): React.FC<{ t: number; len: number; f?: number }> => {
  const glowId = makeInsertId('notifGlow', `${spec.title}:${spec.body}`);
  const defaultAccent =
    spec.accent ??
    (spec.amount?.trim().startsWith('+') ? GOOD : spec.amount?.trim().startsWith('-') ? BAD : LIVE);

  const NotifComp: React.FC<{ t: number; len: number; f?: number }> = ({ t }) => {
    const bg = spec.bg ?? '#120E24';
    const enter = backOut3(t / 14);
    const fadeIn = clamp01(t / 5);
    const fadeOut = spec.hold !== undefined && t > spec.hold ? 1 - clamp01((t - spec.hold) / 10) : 1;
    const op = fadeIn * fadeOut;
    const bob = t > 14 ? Math.sin((t - 14) * 0.09) * 3 : 0;

    const cardW = PORTRAIT ? 760 : 940;
    const lines = wrapLines(spec.body, PORTRAIT ? 28 : 38, 3);
    const hasAmount = Boolean(spec.amount);
    const cardH = 152 + Math.max(1, lines.length) * 44 + (hasAmount ? 104 : 24);
    const cx = 960;
    const baseY = PORTRAIT ? 460 : 540;
    const cy = baseY - (1 - enter) * 210 + bob;

    const titleText = spec.title.toUpperCase();
    const titleFit = fitMonoText(titleText, cardW - 210, PORTRAIT ? 28 : 30, 15, 2.2);
    const amountFit = spec.amount ? fitMonoText(spec.amount, cardW - 140, PORTRAIT ? 48 : 54, 22, 1) : null;
    const amountPop = backOut3((t - 7) / 10);
    const pulseR = 260 + (t % 36) * 8;
    const pulseOp = (1 - (t % 36) / 36) * 0.22;

    return (
      <g>
        <defs>
          <radialGradient id={glowId} cx="50%" cy="46%" r="58%">
            <stop offset="0%" stopColor={defaultAccent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={bg} stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={bg} />
        <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={`url(#${glowId})`} />
        <circle cx={cx} cy={baseY} r={pulseR} fill="none" stroke={defaultAccent} strokeWidth={3} opacity={pulseOp * op} />

        <g transform={`translate(${cx} ${cy}) scale(${0.92 + 0.08 * enter})`} opacity={op}>
          <rect x={-cardW / 2 + 12} y={-cardH / 2 + 18} width={cardW} height={cardH} rx={32} fill="#000" opacity={0.34} />
          <rect x={-cardW / 2} y={-cardH / 2} width={cardW} height={cardH} rx={32} fill="#FBF8F2" stroke={INK} strokeWidth={4.5} />
          <rect x={-cardW / 2 + 16} y={-cardH / 2 + 24} width={10} height={cardH - 48} rx={5} fill={defaultAccent} />

          {/* Icon badge */}
          <g transform={`translate(${-cardW / 2 + 78} ${-cardH / 2 + 64})`}>
            <rect x={-34} y={-34} width={68} height={68} rx={20} fill={defaultAccent} stroke={INK} strokeWidth={3.5} />
            {renderNotifIcon(spec.icon ?? (hasAmount ? 'bank' : 'bell'), defaultAccent)}
            <circle cx={28} cy={-28} r={9} fill={LIVE} stroke="#FBF8F2" strokeWidth={3} opacity={Math.floor(t / 12) % 2 === 0 ? 1 : 0.45} />
          </g>

          {/* Header */}
          <text
            x={-cardW / 2 + 136}
            y={-cardH / 2 + 73}
            fontFamily={MONO_FONT}
            fontWeight={700}
            fontSize={titleFit.fontSize}
            fill={INK}
            letterSpacing={2.2}
            textLength={titleFit.textLength}
            lengthAdjust={titleFit.lengthAdjust}
          >
            {titleText}
          </text>
          <line x1={-cardW / 2 + 44} y1={-cardH / 2 + 114} x2={cardW / 2 - 44} y2={-cardH / 2 + 114} stroke={INK} strokeWidth={2} opacity={0.14} />

          {/* Body lines */}
          {lines.map((line, i) => (
            <text
              key={i}
              x={-cardW / 2 + 48}
              y={-cardH / 2 + 162 + i * 44}
              fontFamily={DISPLAY_FONT}
              fontWeight={700}
              fontSize={PORTRAIT ? 34 : 36}
              fill={INK}
            >
              {line}
            </text>
          ))}

          {/* Optional amount pill */}
          {spec.amount && amountFit ? (
            <g transform={`translate(0 ${cardH / 2 - 58}) scale(${0.86 + 0.14 * amountPop})`}>
              <rect x={-cardW / 2 + 44} y={-40} width={cardW - 88} height={80} rx={22} fill={PILL} stroke={INK} strokeWidth={3} />
              <text
                y={Math.round(amountFit.fontSize * 0.35)}
                textAnchor="middle"
                fontFamily={MONO_FONT}
                fontWeight={700}
                fontSize={amountFit.fontSize}
                fill={defaultAccent}
                letterSpacing={1}
                textLength={amountFit.textLength}
                lengthAdjust={amountFit.lengthAdjust}
              >
                {spec.amount}
              </text>
            </g>
          ) : null}
        </g>
      </g>
    );
  };
  return NotifComp;
};

export type CounterShotSpec = {
  /** Label shown above the animated counter */
  label: string;
  /** Starting numeric value */
  from: number;
  /** Target numeric value */
  to: number;
  /** Optional prefix (e.g. "+", "$") */
  prefix?: string;
  /** Optional suffix (e.g. " €", " %", " km") */
  suffix?: string;
  /** Accent colour for digits & progress bar */
  accent?: string;
  /** Backdrop colour */
  bg?: string;
  /** Roll duration in frames (default 36) */
  duration?: number;
};

/** Animated rolling numeric counter with smooth ease-out and arrival pop (16:9 & 9:16 safe). Set `"size": "insert"` in episode.json. */
export const counterShot = (spec: CounterShotSpec): React.FC<{ t: number; len: number; f?: number }> => {
  const glowId = makeInsertId('counterGlow', `${spec.label}:${spec.from}:${spec.to}`);
  const decFrom = Number.isInteger(spec.from) ? 0 : Math.min(2, String(spec.from).split('.')[1]?.length ?? 0);
  const decTo = Number.isInteger(spec.to) ? 0 : Math.min(2, String(spec.to).split('.')[1]?.length ?? 0);
  const decimals = Math.max(decFrom, decTo);

  const CounterComp: React.FC<{ t: number; len: number; f?: number }> = ({ t }) => {
    const bg = spec.bg ?? '#100D20';
    const accent = spec.accent ?? GOLD;
    const dur = Math.max(6, spec.duration ?? 36);
    const p = easeOut3(t / dur);
    const val = spec.from + (spec.to - spec.from) * p;
    const formatted =
      decimals > 0
        ? val.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
        : Math.round(val)
            .toString()
            .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const display = `${spec.prefix ?? ''}${formatted}${spec.suffix ?? ''}`;

    const enter = backOut3(t / 10);
    const arrived = t >= dur;
    const arrivePop = arrived ? 1 + 0.14 * Math.sin(clamp01((t - dur) / 10) * Math.PI) : 1;
    const ringP = arrived ? clamp01((t - dur) / 16) : 0;

    const cardW = PORTRAIT ? 780 : 1080;
    const cardH = PORTRAIT ? 410 : 370;
    const cx = 960;
    const cy = PORTRAIT ? 480 : 540;
    const labelText = spec.label.toUpperCase();
    const labelFit = fitMonoText(labelText, cardW - 110, PORTRAIT ? 28 : 32, 15, 2.5);
    const numFit = fitMonoText(display, cardW - 104, PORTRAIT ? 108 : 130, 34, 0);
    const barW = cardW - 120;

    return (
      <g>
        <defs>
          <radialGradient id={glowId} cx="50%" cy="48%" r="56%">
            <stop offset="0%" stopColor={accent} stopOpacity={0.24} />
            <stop offset="100%" stopColor={bg} stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={bg} />
        <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={`url(#${glowId})`} />

        {arrived && ringP < 1 ? (
          <circle
            cx={cx}
            cy={cy}
            r={220 + ringP * 240}
            fill="none"
            stroke={accent}
            strokeWidth={6 * (1 - ringP)}
            opacity={(1 - ringP) * 0.65}
          />
        ) : null}

        <g transform={`translate(${cx} ${cy}) scale(${0.88 + 0.12 * enter})`} opacity={clamp01(t / 4)}>
          <rect x={-cardW / 2 + 12} y={-cardH / 2 + 18} width={cardW} height={cardH} rx={36} fill="#000" opacity={0.38} />
          <rect x={-cardW / 2} y={-cardH / 2} width={cardW} height={cardH} rx={36} fill={PILL} stroke={CREAM} strokeWidth={3.5} opacity={0.94} />

          {/* Label */}
          <text
            y={-cardH / 2 + 78}
            textAnchor="middle"
            fontFamily={MONO_FONT}
            fontWeight={700}
            fontSize={labelFit.fontSize}
            fill={CREAM}
            letterSpacing={2.5}
            opacity={0.86}
            textLength={labelFit.textLength}
            lengthAdjust={labelFit.lengthAdjust}
          >
            {labelText}
          </text>

          {/* Animated value */}
          <g transform={`translate(0 18) scale(${arrivePop})`}>
            <text
              y={Math.round(numFit.fontSize * 0.34)}
              textAnchor="middle"
              fontFamily={MONO_FONT}
              fontWeight={700}
              fontSize={numFit.fontSize}
              fill={accent}
              textLength={numFit.textLength}
              lengthAdjust={numFit.lengthAdjust}
            >
              {display}
            </text>
          </g>

          {/* Progress track */}
          <rect x={-barW / 2} y={cardH / 2 - 58} width={barW} height={14} rx={7} fill="#FFFFFF" opacity={0.14} />
          <rect x={-barW / 2} y={cardH / 2 - 58} width={Math.max(14, barW * p)} height={14} rx={7} fill={accent} />
        </g>
      </g>
    );
  };
  return CounterComp;
};

export type PolaroidShotSpec = {
  /** Readable caption printed beneath the Polaroid photo */
  caption: string;
  /** Optional date / archive stamp (e.g. "14 JUIN 2019", "ARCHIVE · 1998") */
  date?: string;
  /** Final card tilt angle in degrees (default -4) */
  tilt?: number;
  /** Backdrop surface colour (default '#2B2233') */
  bg?: string;
  /** Optional custom SVG inside the photo window (centered at 0, 0 in ~520x460 local coords) */
  children?: React.ReactNode | ((t: number, len: number) => React.ReactNode);
};

/** Tilted Polaroid / press-clipping insert dropping gently into frame (16:9 & 9:16 safe). Set `"size": "insert"` in episode.json. */
export const polaroidShot = (spec: PolaroidShotSpec): React.FC<{ t: number; len: number; f?: number }> => {
  const bgId = makeInsertId('polBg', `${spec.caption}:${spec.date ?? ''}`);
  const photoId = makeInsertId('polPhoto', `${spec.caption}:${spec.date ?? ''}`);
  const clipId = makeInsertId('polClip', `${spec.caption}:${spec.date ?? ''}`);

  const PolaroidComp: React.FC<{ t: number; len: number; f?: number }> = ({ t, len }) => {
    const bg = spec.bg ?? '#2B2233';
    const finalTilt = spec.tilt ?? -4;
    const dropP = easeOut3(t / 18);
    const scale = 1.2 - 0.2 * dropP;
    const yOff = -140 * (1 - dropP);
    const rot = finalTilt + 11 * (1 - dropP);
    const op = clamp01(t / 5);
    const shadowDx = 14 + 22 * (1 - dropP);
    const shadowDy = 20 + 30 * (1 - dropP);

    const cardW = PORTRAIT ? 640 : 620;
    const cardH = PORTRAIT ? 760 : 720;
    const photoW = cardW - 64;
    const photoH = cardH - 220;
    const photoTop = -cardH / 2 + 32;
    const photoCy = photoTop + photoH / 2;
    const cx = 960;
    const cy = PORTRAIT ? 470 : 540;

    const captionLines = wrapLines(spec.caption, 24, 2);
    const dateFit = spec.date ? fitMonoText(spec.date.toUpperCase(), cardW - 96, 22, 13, 2) : null;
    const sheenX = -photoW + ((t * 14) % (photoW * 3));
    const inner = typeof spec.children === 'function' ? spec.children(t, len) : spec.children;

    return (
      <g>
        <defs>
          <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={bg} />
            <stop offset="100%" stopColor="#16111F" />
          </linearGradient>
          <linearGradient id={photoId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#435373" />
            <stop offset="60%" stopColor="#8C6B6E" />
            <stop offset="100%" stopColor="#E6B37E" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={-photoW / 2} y={photoTop} width={photoW} height={photoH} rx={6} />
          </clipPath>
        </defs>

        <rect x={VB.x - 160} y={VB.y - 160} width={VB.w + 320} height={VB.h + 320} fill={`url(#${bgId})`} />
        {[-360, -120, 120, 360].map((dy, i) => (
          <rect key={i} x={VB.x - 160} y={540 + dy} width={VB.w + 320} height={4} fill="#FFFFFF" opacity={0.05} />
        ))}

        <g transform={`translate(${cx} ${cy + yOff}) rotate(${rot}) scale(${scale})`} opacity={op}>
          {/* Crisp drop shadow */}
          <rect
            x={-cardW / 2 + shadowDx}
            y={-cardH / 2 + shadowDy}
            width={cardW}
            height={cardH}
            rx={10}
            fill="#000"
            opacity={0.34 - 0.08 * (1 - dropP)}
          />
          {/* Polaroid frame */}
          <rect x={-cardW / 2} y={-cardH / 2} width={cardW} height={cardH} rx={10} fill="#FAF6EE" stroke={INK} strokeWidth={4.5} />

          {/* Masking tape accent */}
          <rect x={-76} y={-cardH / 2 - 18} width={152} height={38} rx={4} fill="#F2E2B6" opacity={0.78} transform="rotate(-2)" />

          {/* Photo window */}
          <g clipPath={`url(#${clipId})`}>
            <rect x={-photoW / 2} y={photoTop} width={photoW} height={photoH} fill={`url(#${photoId})`} />
            {inner ? (
              <g transform={`translate(0 ${photoCy})`}>{inner}</g>
            ) : (
              <g transform={`translate(0 ${photoCy})`}>
                <circle cx={photoW * 0.22} cy={-photoH * 0.16} r={54} fill="#FFE8B6" opacity={0.75} />
                <path
                  d={`M ${-photoW / 2} ${photoH / 2} L ${-photoW * 0.16} ${-24} L ${photoW * 0.12} ${photoH * 0.18} L ${photoW * 0.34} ${-8} L ${photoW / 2} ${photoH / 2} Z`}
                  fill="#2A2338"
                  opacity={0.78}
                />
                <path
                  d={`M ${-photoW / 2} ${photoH / 2} L ${-photoW * 0.3} ${photoH * 0.08} L ${photoW * 0.04} ${photoH * 0.32} L ${photoW / 2} ${photoH * 0.14} L ${photoW / 2} ${photoH / 2} Z`}
                  fill="#1C1628"
                  opacity={0.9}
                />
              </g>
            )}
            {/* Subtle glossy sheen */}
            <polygon
              points={`${sheenX},${photoTop - 20} ${sheenX + 90},${photoTop - 20} ${sheenX - 60},${photoTop + photoH + 20} ${sheenX - 150},${photoTop + photoH + 20}`}
              fill="#FFFFFF"
              opacity={0.12}
            />
          </g>
          <rect x={-photoW / 2} y={photoTop} width={photoW} height={photoH} rx={6} fill="none" stroke={INK} strokeWidth={3} />

          {/* Caption */}
          {captionLines.map((line, i) => {
            const capFit = fitMonoText(line, cardW - 84, 34, 18, 0);
            return (
              <text
                key={i}
                y={photoTop + photoH + 62 + i * 42}
                textAnchor="middle"
                fontFamily={DISPLAY_FONT}
                fontWeight={700}
                fontSize={capFit.fontSize}
                fill={INK}
                textLength={capFit.textLength}
                lengthAdjust={capFit.lengthAdjust}
              >
                {line}
              </text>
            );
          })}

          {/* Optional date stamp */}
          {spec.date && dateFit ? (
            <text
              y={cardH / 2 - 26}
              textAnchor="middle"
              fontFamily={MONO_FONT}
              fontWeight={700}
              fontSize={dateFit.fontSize}
              fill="#7A6E82"
              letterSpacing={2}
              textLength={dateFit.textLength}
              lengthAdjust={dateFit.lengthAdjust}
            >
              {spec.date.toUpperCase()}
            </text>
          ) : null}
        </g>
      </g>
    );
  };
  return PolaroidComp;
};
