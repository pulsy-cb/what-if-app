import React from 'react';
import { STUDIO } from '../studio.config';

// Narration subtitles, drawn by the engine from the voice's measured words (pipeline/sfx_run.py writes them into
// timeline.json as `subtitles`: 1 to 2 words per cue, always on a single line, in global frames). The agent never writes them.
// Lower third of the frame, current word highlighted, readable in 9:16 (1080 x 1920) and 16:9.

export type SubWord = { w: string; a: number; b: number };
export type SubCue = { a: number; b: number; words: SubWord[] };

const PORTRAIT = STUDIO.height > STUDIO.width;
const DISPLAY_FONT = "'Bricolage Grotesque', system-ui, -apple-system, Segoe UI, sans-serif";
const INK = '#0B0816';
const CREAM = '#F6EFE3';
const GOLD = '#FFE27A';

export const Subtitles: React.FC<{ tl: unknown; f: number }> = ({ tl, f }) => {
  const cues = ((tl as { subtitles?: SubCue[] }).subtitles ?? []) as SubCue[];
  const cue = cues.find((c) => f >= c.a && f < c.b);
  if (!cue) return null;
  const baseFs = Math.round((PORTRAIT ? 0.036 : 0.05) * STUDIO.height * (PORTRAIT ? 1.6 : 1));
  // Always keep the cue on a single line: shrink font size if a long word would overflow the frame width.
  const chars = cue.words.reduce((n, w) => n + w.w.length, 0) + Math.max(0, cue.words.length - 1) * 0.5;
  const usableWidth = STUDIO.width * 0.88;
  const fs = Math.min(baseFs, Math.max(24, Math.floor(usableWidth / Math.max(1, chars * 0.62))));
  const pop = Math.min(1, (f - cue.a + 1) / 3);
  return (
    <div
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        top: PORTRAIT ? '68%' : '76%',
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        gap: `0 ${Math.round(fs * 0.28)}px`,
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: fs,
        lineHeight: 1.15,
        textAlign: 'center',
        opacity: pop,
        transform: `translateY(${(1 - pop) * 8}px)`,
        pointerEvents: 'none',
      }}
    >
      {cue.words.map((w, i) => {
        const on = f >= w.a && f < w.b;
        return (
          <span
            key={i}
            style={{
              color: on ? GOLD : CREAM,
              WebkitTextStroke: `${Math.max(4, Math.round(fs * 0.09))}px ${INK}`,
              paintOrder: 'stroke fill',
              textShadow: `0 ${Math.round(fs * 0.06)}px 0 ${INK}`,
              transform: on ? 'scale(1.08)' : undefined,
              display: 'inline-block',
              whiteSpace: 'nowrap',
            }}
          >
            {w.w}
          </span>
        );
      })}
    </div>
  );
};
