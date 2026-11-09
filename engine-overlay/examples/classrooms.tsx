import React from 'react';
import { Hero, makeLook, basePose, actPose, talkAt, camT, ShotProps, Classroom, CLS, CLASS_MOODS, WallBoard, PinBoard, CustomRoom, Box, WallClock, FONT, Glow } from '../../engine';

const LOU = makeLook({ skin: '#F2C9A8', jacket: '#E05780', accent: '#FFE5EC', hair: '#5B3A24', extra: 'bob' });
const LEO = makeLook({ skin: '#E8B58C', jacket: '#274472', accent: '#9CC3F5', hair: '#2B1E1A', extra: 'spiky' });

const Cast: React.FC<{ t: number }> = ({ t }) => (
  <>
    <Hero look={LOU} pose={{ ...basePose, x: 760, y: 800, scale: 1.25, yaw: 0.4, facing: 1, ...actPose('talk', t), talk: talkAt(t, 80) }} />
    <Hero look={LEO} pose={{ ...basePose, x: 1080, y: 790, scale: 1.2, yaw: -0.4, facing: -1, ...actPose('idle', t) }} rimId="rimL" />
  </>
);
const cam = (t: number) => camT(900, 600, 0.95);

const chalk = (color: string, lines: { x: number; y: number; s: number; t: string }[]) => (
  <g fill={color} fontFamily={FONT.hand} opacity={0.92}>
    {lines.map((l, i) => <text key={i} x={l.x} y={l.y} fontSize={l.s}>{l.t}</text>)}
  </g>
);

// 1. lycée, daytime: same set, day mood, writing for THIS story, nothing of the demo left
export const C1: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam(t)}>
    <Classroom t={t} id="c1" tokens={CLASS_MOODS.day}
      board={chalk('#FFFFFF', [{ x: 470, y: 290, s: 64, t: 'Théorème de Thalès' }, { x: 470, y: 380, s: 48, t: 'AB / AC = AD / AE' }])}
      deskProps={<g><rect x={560} y={600} width={70} height={14} fill="#F2EEE4" /><rect x={566} y={586} width={60} height={14} fill="#DDD6C6" /></g>} />
    <Cast t={t} />
  </g>
);

// 2. primary school: bright, small desks, 3 rows, 2 windows, children's drawings on the pinboard
export const C2: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam(t)}>
    <Classroom t={t} id="c2" windows={2} rows={[{ w: 0.3, us: [0.12, 0.36, 0.6] }, { w: 0.46, us: [0.12, 0.36, 0.6] }, { w: 0.62, us: [0.12, 0.36, 0.6] }]}
      tokens={{ ...CLASS_MOODS.day, wall: '#9ED8C6', wallSide: '#86C4B2', wallRight: '#79B5A4', floor: '#E6B79A', floorLine: '#D09F82', trim: '#F2994A', boardFrame: '#F2C14E',
        desk: { front: '#F29E4C', top: '#F7B96E', side: '#D9822B' }, veil: 0.05 }}
      board={chalk('#FFFFFF', [{ x: 540, y: 380, s: 170, t: 'A B C' }])}
      pinboard={<PinBoard x={1110} y={210} items={[
        { dx: 20, dy: 20, c: '#FF6B6B', rot: -4 }, { dx: 86, dy: 26, c: '#FFE66D', rot: 3 }, { dx: 152, dy: 18, c: '#4ECDC4', rot: -2 },
        { dx: 28, dy: 94, c: '#A78BFA', rot: 2 }, { dx: 100, dy: 100, c: '#FF9F43', rot: -3 }, { dx: 168, dy: 90, c: '#54A0FF', rot: 4 }]} />}
      deskProps={<g><circle cx={640} cy={590} r={26} fill="#5FAE6B" /><rect x={628} y={606} width={24} height={22} fill="#C0713B" /></g>} />
    <Cast t={t} />
  </g>
);

// 3. lecture hall: no windows, 4 long rows, dark panelled walls, no pinboard, no cubbies
export const C3: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam(t)}>
    <Classroom t={t} id="c3" windows={0} pinboard={false} cubbies={false} deskProps={false}
      rows={[{ w: 0.28, us: [0.04, 0.5], len: 0.42 }, { w: 0.42, us: [0.04, 0.5], len: 0.42 }, { w: 0.56, us: [0.04, 0.5], len: 0.42 }]}
      tokens={{ wall: '#4E5668', wallSide: '#3E4555', wallRight: '#343B49', ceiling: '#2A2F3B', panel: '#CFE3FF', floor: '#2E3340', floorLine: '#232834', trim: '#1A1E27',
        board: '#1F2B2A', boardFrame: '#2B2F3A', boardTray: '#20242E', desk: { front: '#3B3F4C', top: '#5B6275', side: '#2D313C' }, veil: 0.45 }}
      board={chalk('#EDEFE6', [{ x: 460, y: 300, s: 60, t: 'E = mc²' }, { x: 460, y: 390, s: 46, t: 'Relativité restreinte' }])} />
    <Cast t={t} />
  </g>
);

// 4. night class: night mood, a ceiling light on, other writing
export const C4: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam(t)}>
    <Classroom t={t} id="c4" tokens={{ ...CLASS_MOODS.night, wall: '#2C3856', wallSide: '#232C45', wallRight: '#1C2438', floor: '#1E2538', floorLine: '#151B2B', ceiling: '#10141F' }}
      extra={<><Glow x={640} y={560} r={330} kind="warm" o={0.42} /><Glow x={1180} y={420} r={260} kind="cool" o={0.16} /></>}
      board={chalk('#EDEFE6', [{ x: 470, y: 330, s: 80, t: 'Contrôle surprise' }])}
      deskProps={<g><rect x={560} y={596} width={30} height={30} rx={6} fill="#F2EEE4" /><circle cx={610} cy={614} r={11} fill="#FFD9A0" /></g>} />
    <Cast t={t} />
  </g>
);

// 5. not a school: a meeting room made of the same pieces (WallBoard, WallClock, a table) in the room kit
export const C5: React.FC<ShotProps> = ({ t }) => {
  const leg = (u: number, w: number, k: number) => {
    const a = CLS.P(u, 0.8, w);
    const b = CLS.P(u, 1, w);
    return <path key={k} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke="#8B93A1" strokeWidth={6} />;
  };
  return (
    <g transform={cam(t)}>
      <CustomRoom r={CLS} t={t} id="c5" wall="#C9CFDA" side="#B5BCC9" floorC="#7C8493" ceiling="#E8ECF2" window={false} veil={0.08}>
        <WallBoard x={470} y={190} w={560} h={330} frame="#AEB4C0" surface="#F6F7F9" tray="#C4C9D4" chalk={false}>
          <g fill="#2F5DA8" fontFamily={FONT.hand}>
            <text x={520} y={310} fontSize={64}>Plan T4</text>
            <path d="M 520 350 L 900 350 M 520 410 L 820 410 M 520 470 L 700 470" stroke="#2F5DA8" strokeWidth={8} strokeLinecap="round" />
          </g>
        </WallBoard>
        <WallClock x={1120} y={260} t={t} r={40} />
        {[0.28, 0.72].map((u, i) => leg(u, 0.36, i))}
        {[0.28, 0.72].map((u, i) => leg(u, 0.6, i + 2))}
        <Box r={CLS} u={[0.22, 0.78]} v={[0.8, 0.84]} w={[0.34, 0.62]} front="#B58552" top="#D6AB74" side="#8F6840" rim />
      </CustomRoom>
      <Cast t={t} />
    </g>
  );
};

// 0. the original default (regression check against the pre-refactor render)
export const C0: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam(t)}>
    <Classroom t={t} id="c0" />
    <Cast t={t} />
  </g>
);
