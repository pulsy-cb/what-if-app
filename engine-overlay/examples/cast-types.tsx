import React from 'react';
import { Person, cast, basePose, ShotFrame, CAST_TYPES, STANCES } from '../../engine';
import type { CastType } from '../../engine';

// The channel's lead in five views and close up, then every ready type, one line each: cast({ as: 'mother', seed: 'mum' }).
const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width={1920} height={1080} viewBox="0 0 1920 1080"><ShotFrame><rect x={0} y={0} width={1920} height={1080} fill="#3A3345" />{children}</ShotFrame></svg>
);
const label = (x: number, y: number, t: string) => <text x={x} y={y} fill="#fff" fontSize={22} fontFamily="monospace">{t}</text>;
const HERO = cast({ as: 'heroine', seed: 'her' });
export const Heroine: React.FC = () => (
  <Page>
    {[0, 0.45, 1, 2, -0.45].map((yaw, k) => <Person key={k} look={HERO} shadow={0} pose={{ ...basePose, x: 190 + k * 300, y: 300, scale: 0.95, yaw }} />)}
    <Person look={HERO} shadow={0} pose={{ ...basePose, x: 1700, y: 380, scale: 2.4, yaw: 0, expr: 'shock' } as never} />
    {label(20, 40, "cast({ as: 'heroine' }) : chignon tressé, yeux vairons, taches de rousseur, jogging à bande")}
  </Page>
);
const TYPES = Object.keys(CAST_TYPES).filter((t) => t !== 'heroine') as CastType[];
export const Types: React.FC = () => (
  <Page>
    {TYPES.map((t, i) => {
      const x = 130 + (i % 7) * 265;
      const y = 260 + Math.floor(i / 7) * 470;
      return (
        <g key={t}>
          {label(x - 60, y - 210, t)}
          <Person look={cast({ as: t, seed: t })} shadow={0} pose={{ ...basePose, x, y, scale: 0.9, yaw: 0.45 }} />
        </g>
      );
    })}
  </Page>
);
export const Bride: React.FC = () => (
  <Page>
    <Person look={cast({ as: 'bride', seed: 'b' })} shadow={0} pose={{ ...basePose, x: 400, y: 420, scale: 1.2, yaw: 0.45 }} />
    <Person look={cast({ as: 'bride', seed: 'b' })} shadow={0} pose={{ ...basePose, ...STANCES.sit, x: 900, y: 490, scale: 1.2, yaw: 0 } as never} />
    <Person look={cast({ as: 'groom', seed: 'g' })} shadow={0} pose={{ ...basePose, x: 1400, y: 420, scale: 1.2, yaw: -0.45 }} />
  </Page>
);
