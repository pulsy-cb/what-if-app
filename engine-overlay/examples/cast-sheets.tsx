import React from 'react';
import { Person, cast, basePose, ShotFrame, HAIR_NEW } from '../../engine';

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width={1920} height={1080} viewBox="0 0 1920 1080"><ShotFrame><rect x={0} y={0} width={1920} height={1080} fill="#3A3345" />{children}</ShotFrame></svg>
);
const label = (x: number, y: number, t: string) => <text x={x} y={y} fill="#fff" fontSize={20} fontFamily="monospace">{t}</text>;

// 8 characters, one line each
export const EIGHT = [
  ['ado sweat', cast({ seed: 'lou', body: 'teen', kind: 'fem', hair: 'long', outfit: ['hoodie:rose', 'jeans', 'sneakers'], acc: ['backpack' as any].filter(() => false), face: { marks: 'freckles', brows: 'thin' } })],
  ['ado sac', cast({ seed: 'leo', body: 'teen', kind: 'masc', hair: { style: 'sidepart', color: 'black' }, outfit: ['tshirt:navy', 'shorts:khaki', 'sneakers', 'backpack:teal'] })],
  ['médecin', cast({ seed: 'doc', body: 'adult', skin: 'bronze', hair: { style: 'bun', color: 'black' }, outfit: ['shirt:sky', 'labcoat', 'pants:navy', 'formal:black'], acc: ['glasses:round'] })],
  ['cadre', cast({ seed: 'boss', body: 'adult', kind: 'masc', skin: 'sand', hair: { style: 'buzz', color: 'grey' }, outfit: ['shirt:white', 'blazer:black', 'tie:red', 'pants:black', 'formal:black'], face: { facial: 'stubble', brows: 'thick' } })],
  ['serveuse', cast({ seed: 'ana', body: 'adult', kind: 'fem', skin: 'tan', hair: { style: 'braids', color: 'chestnut' }, outfit: ['tshirt:white', 'apron:green', 'skirt:black', 'boots:brown'], acc: ['earrings'] })],
  ['voisin', cast({ seed: 'sam', body: 'adult', kind: 'masc', skin: 'deep', hair: { style: 'dreads', color: 'black' }, outfit: ['sweater:mustard', 'jeans', 'boots:brown'], face: { facial: 'goatee' } })],
  ['étudiante', cast({ seed: 'noor', body: 'teen', kind: 'fem', skin: 'peach', hair: { style: 'hijab', color: 'teal' }, outfit: ['coat:plum', 'pants:black', 'sneakers:white'] })],
  ['rocker', cast({ seed: 'zed', body: 'adult', kind: 'masc', hair: { style: 'mohawk', color: 'red' }, outfit: ['tshirt:black', 'jeans', 'boots:black', 'scarf:coral'], acc: ['glasses:sun', 'headband:coral'].slice(0, 1) })],
] as const;
const YAWS = [0, 0.45, 1, 2, -1];
export const Eight: React.FC<{ part: number }> = ({ part }) => (
  <Page>
    {EIGHT.slice(part * 4, part * 4 + 4).map(([name, c], r) => (
      <g key={name}>
        {label(8, 40 + r * 270, name)}
        {YAWS.map((yaw, k) => <Person key={k} look={c} shadow={0} pose={{ ...basePose, x: 260 + k * 370, y: 150 + r * 268, scale: 0.68, yaw }} />)}
      </g>
    ))}
  </Page>
);

export const Hair: React.FC = () => (
  <Page>
    {HAIR_NEW.map((style, c) => {
      const look = cast({ seed: style, skin: 'peach', hair: { style, color: style === 'hijab' ? 'teal' : 'chestnut' }, outfit: ['tshirt:navy', 'pants:black'], face: { brows: 'none', nose: 'none', marks: 'none', eyes: 'round', facial: 'none' } });
      return (
        <g key={style}>
          {label(90 + c * 186, 26, style)}
          {[0, 0.45, 1, 2].map((yaw, r) => <Person key={r} look={look} shadow={0} pose={{ ...basePose, x: 120 + c * 186, y: 250 + r * 255, scale: 0.76, yaw }} />)}
        </g>
      );
    })}
  </Page>
);

const FACE_ROWS: [string, any][] = [
  ['eyes', ['round', 'almond', 'sleepy', 'wide'].map((eyes) => ({ eyes }))], ['brows', ['none', 'thin', 'thick', 'arched'].map((brows) => ({ brows }))],
  ['nose', ['none', 'button', 'long', 'wide'].map((nose) => ({ nose }))], ['marks', ['freckles', 'mole', 'blush', 'dimples', 'wrinkles'].map((marks) => ({ marks }))],
  ['facial', ['stubble', 'mustache', 'goatee', 'beard'].map((facial) => ({ facial }))], ['acc', [['glasses:round'], ['glasses:square'], ['glasses:sun'], ['earrings'], ['headband:teal']]],
];
const bare = { eyes: 'round', brows: 'none', nose: 'none', marks: 'none', facial: 'none' } as const;
export const Faces: React.FC = () => (
  <Page>
    {FACE_ROWS.map(([name, opts], r) => (
      <g key={name}>
        {label(8, 110 + r * 176, name)}
        {opts.map((o: any, c: number) => {
          const isAcc = name === 'acc';
          const look = cast({ seed: 'f', skin: 'sand', hair: { style: 'sidepart', color: 'brown' }, outfit: ['tshirt:navy', 'pants:black'], face: isAcc ? bare : { ...bare, ...o }, acc: isAcc ? o : [] });
          return [0, 1].map((yaw, k) => <Person key={`${c}${k}`} look={look} shadow={0} pose={{ ...basePose, x: 200 + c * 340 + k * 160, y: 300 + r * 176, scale: 0.72, yaw }} />);
        })}
      </g>
    ))}
  </Page>
);

export const Seeds: React.FC = () => (
  <Page>
    {['lou', 'leo', 'ana', 'sam', 'mia', 'tom', 'zoe', 'max', 'eva', 'ali', 'kim', 'noa'].map((s, i) => {
      const look = cast({ seed: s, body: i % 3 === 0 ? 'teen' : 'adult', kind: i % 2 ? 'masc' : 'fem' });
      return <g key={s}>{label(70 + (i % 6) * 310, 30 + Math.floor(i / 6) * 530, s)}<Person look={look} shadow={0} pose={{ ...basePose, x: 150 + (i % 6) * 310, y: 330 + Math.floor(i / 6) * 530, scale: 1, yaw: (i % 3) * 0.45 }} /></g>;
    })}
  </Page>
);
