import React from 'react';
import { Stage, Staged, Duo, cast, ShotFrame, GESTURES, STANCES } from '../../engine';

const LOU = cast({ seed: 'lou', body: 'teen', kind: 'fem', hair: 'long', skin: 'peach', outfit: ['hoodie:rose', 'jeans', 'sneakers:white'], face: { marks: 'none', brows: 'none', nose: 'none', eyes: 'round' } });
const LEO = cast({ seed: 'leo', body: 'adult', kind: 'masc', skin: 'sand', hair: { style: 'sidepart', color: 'black' }, outfit: ['shirt:sky', 'pants:navy', 'sneakers:white'], face: { marks: 'none', brows: 'none', nose: 'none', eyes: 'round', facial: 'none' } });
const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width={1920} height={1080} viewBox="0 0 1920 1080"><ShotFrame><rect x={0} y={0} width={1920} height={1080} fill="#3A3345" />{children}</ShotFrame></svg>
);
const label = (x: number, y: number, t: string) => <text x={x} y={y} fill="#fff" fontSize={20} fontFamily="monospace">{t}</text>;
const ROWS: Record<string, string[]> = { a: ['stand-up', 'sit-down', 'startle', 'jump', 'slump'], b: ['bow', 'pick-up', 'walk', 'run', 'sneak'] };
const DUR: Record<string, number> = { 'stand-up': 26, 'sit-down': 24, startle: 26, jump: 28, slump: 30, bow: 34, 'pick-up': 34, walk: 20, run: 14, sneak: 34 };

export const Motion: React.FC<{ sheet: 'a' | 'b' }> = ({ sheet }) => (
  <Page>
    {ROWS[sheet]!.map((name, r) => (
      <g key={name}>
        {label(6, 30 + r * 214, name)}
        <line x1={110} x2={1910} y1={196 + r * 214} y2={196 + r * 214} stroke="#fff" opacity={0.25} strokeWidth={2} />
        {Array.from({ length: 8 }, (_, c) => {
          const t = Math.round((c / 7) * DUR[name]!);
          return (
            <Stage key={c} t={t} fade={0}>
              <Staged at={{ x: 200 + c * 225, y: 196 + r * 214, scale: 0.46, w: 1 }} look={LEO} yaw={1} act={name as any} />
            </Stage>
          );
        })}
      </g>
    ))}
  </Page>
);

export const Gest: React.FC = () => (
  <Page>
    {GESTURES.map((g, i) => {
      const x = 160 + (i % 6) * 310;
      const y = 340 + Math.floor(i / 6) * 350;
      return (
        <g key={g}>
          {label(x - 60, y - 310, g)}
          <Stage t={14} fade={0}>
            <Staged at={{ x: x - 62, y, scale: 0.62, w: 1 }} look={LOU} yaw={0} act={g} />
            <Staged at={{ x: x + 70, y, scale: 0.62, w: 1 }} look={LEO} yaw={i % 2 ? -0.55 : 1} act={g} />
          </Stage>
        </g>
      );
    })}
  </Page>
);

const VIEWS = [0, 0.45, 1, 2, -1];
export const Stances: React.FC = () => (
  <Page>
    {Object.keys(STANCES).map((st, r) => (
      <g key={st}>
        {label(6, 40 + r * 262, st)}
        <line x1={110} x2={1910} y1={240 + r * 262} y2={240 + r * 262} stroke="#fff" opacity={0.25} strokeWidth={2} />
        <Stage t={10} fade={0}>
          {VIEWS.map((yaw, c) => <Staged key={c} at={{ x: 260 + c * 340, y: 240 + r * 262, scale: 0.56, w: 1 }} look={r % 2 ? LOU : LEO} yaw={yaw} stance={st as any} act="idle" />)}
        </Stage>
      </g>
    ))}
  </Page>
);

const DUOS = ['handshake', 'give', 'hug', 'push', 'whisper'] as const;
const DD: Record<string, number> = { handshake: 44, give: 42, hug: 54, push: 32, whisper: 48 };
const GROUND = { project: (u: number, w: number) => ({ x: u, y: w, scale: 0.46 }) };
export const Duos: React.FC = () => (
  <Page>
    {DUOS.map((name, r) => (
      <g key={name}>
        {label(6, 30 + r * 214, name)}
        <line x1={110} x2={1910} y1={196 + r * 214} y2={196 + r * 214} stroke="#fff" opacity={0.25} strokeWidth={2} />
        {[0.05, 0.25, 0.45, 0.6, 0.8, 1].map((k, c) => {
          const x = 220 + c * 300;
          const gap = name === 'hug' ? 44 : 62;
          return (
            <Stage key={c} t={Math.round(k * DD[name]!)} fade={0} ground={GROUND}>
              <Duo action={name} a={{ at: { u: x - gap, w: 196 + r * 214 }, look: LEO }} b={{ at: { u: x + gap, w: 196 + r * 214 }, look: LOU }}
                prop={<rect x={-14} y={-20} width={28} height={36} rx={4} fill="#F2545B" stroke="#1E1824" strokeWidth={3} />} />
            </Stage>
          );
        })}
      </g>
    ))}
  </Page>
);
