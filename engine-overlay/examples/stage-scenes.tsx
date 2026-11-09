import React from 'react';
import { Hero, makeLook, basePose, actPose, talkAt, camT, ShotProps, ClassroomShell, Classroom, CLS, CLASS_MOODS, FONT, Stage, Staged, roomGround, planeGround, DeskAt, deskSeat, Outdoor, OUTDOOR, Rooftop, walkPose } from '../../engine';

const PROF = makeLook({ skin: '#C68A5B', jacket: '#5A3E68', accent: '#F6EFE3', hair: '#3A2A20', extra: 'suit' });
const LOU = makeLook({ skin: '#F2C9A8', jacket: '#E05780', accent: '#FFE5EC', hair: '#5B3A24', extra: 'bob' });
const LEO = makeLook({ skin: '#E8B58C', jacket: '#274472', accent: '#9CC3F5', hair: '#2B1E1A', extra: 'spiky' });
const STUDENT = makeLook({ skin: '#D89B72', jacket: '#2A9D8F', accent: '#FFE5EC', hair: '#1E1418', extra: 'curls' });
const BOARD = <g fill="#fff" fontFamily={FONT.hand}><text x={470} y={300} fontSize={64}>Pythagore</text><text x={470} y={390} fontSize={50}>a² + b² = c²</text></g>;
const G = roomGround(CLS);
const DESK = { u: 0.43, w: 0.27 };
const cam = camT(900, 575, 1.1);

// what the agent wrote before: literal positions, scale 1, drawn in the order written
export const Before: React.FC<ShotProps> = ({ t }) => (
  <g transform={camT(900, 640, 0.95)}>
    <Classroom t={t} id="sa" tokens={CLASS_MOODS.day} board={BOARD} deskProps={false} />
    <Hero look={PROF} pose={{ ...basePose, x: 640, y: 690, yaw: 2, armL: { a: 150, b: 20 } }} />
    <Hero look={LOU} pose={{ ...basePose, x: 780, y: 780, yaw: 0.5, ...actPose('talk', t), talk: talkAt(t, 80) }} />
    <Hero look={LEO} pose={{ ...basePose, x: 1090, y: 770, yaw: -0.5, facing: -1, ...actPose('idle', t) }} rimId="rimL" />
  </g>
);

// the same people on the floor, written in shuffled order on purpose: the stage sorts them
export const After: React.FC<ShotProps & { dark?: boolean }> = ({ t, len, dark }) => {
  const tokens = dark ? undefined : CLASS_MOODS.day;
  return (
    <g transform={cam}>
      <Stage ground={G}>
        <ClassroomShell t={t} id="sb" tokens={tokens} board={BOARD} deskProps={false} />
        <Staged at={{ u: 0.36, w: 0.6 }} body="teen" look={LOU} pose={{ yaw: 0.5, ...actPose('talk', t), talk: talkAt(t, len) }} />
        <DeskAt at={DESK} tokens={tokens} />
        <Staged at={deskSeat(DESK)} seated body="teen" look={STUDENT} pose={{ yaw: 2, armL: { a: 30, b: 50 }, armR: { a: 30, b: 50 } }} />
        <Staged at={{ u: 0.68, w: 0.46 }} look={LEO} rimId="rimL" pose={{ yaw: -0.5, facing: -1, ...actPose('idle', t) }} />
        <Staged at={{ u: 0.4, w: 0.08 }} look={PROF} pose={{ yaw: 2, armL: { a: 150, b: 20 } }} />
      </Stage>
    </g>
  );
};

// one person at three depths, optionally with the focus on the near one
export const Depths: React.FC<ShotProps & { focus?: number }> = ({ t, focus }) => (
  <g transform={cam}>
    <Stage ground={G} focus={focus}>
      <ClassroomShell t={t} id={`sc${focus ?? ''}`} tokens={CLASS_MOODS.day} board={BOARD} deskProps={false} />
      <Staged at={{ u: 0.47, w: 0.08 }} look={LEO} pose={{ yaw: 0.5 }} />
      <Staged at={{ u: 0.68, w: 0.4 }} look={LEO} pose={{ yaw: -0.5, facing: -1 }} rimId="rimL" />
      <Staged at={{ u: 0.34, w: 0.62 }} look={LEO} pose={{ yaw: 1, ...actPose('explain', t) }} />
    </Stage>
  </g>
);

// walking: the limbs come from walkPose, the place from the stage
export const Walk: React.FC<ShotProps> = ({ t }) => (
  <g transform={cam}>
    <Stage ground={G}>
      <ClassroomShell t={t} id="sw" tokens={CLASS_MOODS.day} board={BOARD} deskProps={false} />
      <Staged at={{ u: 0.3 + t * 0.004, w: 0.5 }} body="teen" look={LOU} pose={walkPose(0, t * 0.6, 0, 1, {}, 1)} />
      <Staged at={{ u: 0.74 - t * 0.003, w: 0.25 }} look={LEO} rimId="rimL" pose={walkPose(0, t * 0.6, 0, 1, {}, -1)} />
    </Stage>
  </g>
);

// not a classroom: a street (makeRoom box) and a rooftop deck (plane ground)
export const Street: React.FC<ShotProps> = ({ t }) => (
  <g transform={camT(960, 600, 1.1)}>
    <Stage ground={roomGround(OUTDOOR)}>
      <Outdoor t={t} id="st" />
      <Staged at={{ u: 0.38, w: 0.55 }} look={LOU} height={0.93} pose={{ yaw: 0.5 }} />
      <Staged at={{ u: 0.62, w: 0.18 }} look={LEO} rimId="rimL" pose={{ yaw: -1, facing: -1 }} />
    </Stage>
  </g>
);
export const Roof: React.FC<ShotProps> = ({ t }) => (
  <g transform={camT(960, 560, 1.15)}>
    <Stage ground={planeGround({ x0: 640, x1: 1280, far: { y: 825, scale: 1 }, near: { y: 1020, scale: 1.5 } })}>
      <Rooftop t={t} />
      <Staged at={{ u: 0.7, w: 0.1 }} look={LEO} pose={{ yaw: 2 }} rimId="rimL" />
      <Staged at={{ u: 0.25, w: 0.7 }} look={LOU} height={0.93} pose={{ yaw: 0.6 }} />
    </Stage>
  </g>
);
