import React from 'react';
import { Hero, makeLook, basePose, actPose, LOOKS, ShotFrame } from '../../engine';

export const LOOK_SETS: Record<string, [string, ReturnType<typeof makeLook>][]> = {
  A: [
    ['bob', makeLook({ skin: '#F2C9A8', jacket: '#E05780', accent: '#FFE5EC', hair: '#5B3A24', extra: 'bob' })],
    ['spiky', makeLook({ skin: '#E8B58C', jacket: '#274472', accent: '#9CC3F5', hair: '#2B1E1A', extra: 'spiky' })],
    ['curls+glasses', makeLook({ skin: '#D89B72', jacket: '#E05780', accent: '#FFE5EC', hair: '#1E1418', extra: 'curls', accessory: 'glasses' })],
  ],
  B: [
    ['pip (default)', LOOKS.pip],
    ['ponytail', makeLook({ skin: '#F2D2B6', jacket: '#3A86FF', accent: '#FFBE0B', hair: '#7A3E1E', extra: 'ponytail' })],
    ['bunches', makeLook({ skin: '#C98850', jacket: '#2A9D8F', accent: '#FFE5EC', hair: '#1E1418', extra: 'bunches' })],
  ],
  C: [
    ['cap', makeLook({ skin: '#E8B58C', jacket: '#5A3E68', accent: '#D9534F', hair: '#2B1E1A', extra: 'cap' })],
    ['headset', makeLook({ skin: '#F2D2B6', jacket: '#274472', accent: '#FFBE0B', hair: '#2B1E1A', extra: 'spiky', accessory: 'headset' })],
    ['afro', makeLook({ skin: '#8D5A3B', jacket: '#E9C46A', accent: '#2A9D8F', hair: '#1E1418', extra: 'afro' })],
  ],
  D: [
    ['beanie', makeLook({ skin: '#F2C9A8', jacket: '#8A5A6A', accent: '#3A86FF', hair: '#5B3A24', extra: 'beanie' })],
    ['suit+beard', makeLook({ skin: '#D9C6AE', jacket: '#2B2F3A', accent: '#A8323E', hair: '#3A2A20', extra: 'suit', accessory: 'beard' })],
    ['hood', LOOKS.pipHood],
  ],
};

const YAWS = [0, 0.45, 1, 2, -1, -0.45];
const EXPR = ['neutral', 'happy', 'shock', 'neutral', 'smug', 'worried'] as const;

export const Views: React.FC<{ set: string }> = ({ set }) => (
  <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ background: '#2A2433' }}>
    <ShotFrame>
      <rect x={0} y={0} width={1920} height={1080} fill="#3A3345" />
      {LOOK_SETS[set]!.map(([name, look], r) => (
        <g key={name}>
          <text x={14} y={90 + r * 350} fill="#fff" fontSize={26} fontFamily="monospace">{name}</text>
          {YAWS.map((yaw, c) => (
            <Hero key={c} look={look} shadow={0.4}
              pose={{ ...basePose, x: 170 + c * 310, y: 185 + r * 350, scale: 0.72, yaw, facing: yaw >= 0 ? 1 : -1, expr: EXPR[c]! }} />
          ))}
        </g>
      ))}
    </ShotFrame>
  </svg>
);

export const Heads: React.FC<{ k: number }> = ({ k }) => {
  const all = Object.values(LOOK_SETS).flat();
  const rows = all.slice(k * 4, k * 4 + 4);
  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ background: '#2A2433' }}>
      <ShotFrame>
        <rect x={0} y={0} width={1920} height={1080} fill="#3A3345" />
        {rows.map(([name, look], r) => (
          <g key={name}>
            <text x={14} y={150 + r * 270} fill="#fff" fontSize={24} fontFamily="monospace">{name}</text>
            {YAWS.map((yaw, c) => (
              <Hero key={c} look={look} shadow={0}
                pose={{ ...basePose, x: 330 + c * 300, y: 330 + r * 270, scale: 1.1, yaw, facing: yaw >= 0 ? 1 : -1, expr: EXPR[c]! }} />
            ))}
          </g>
        ))}
      </ShotFrame>
    </svg>
  );
};
