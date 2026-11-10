import React from 'react';
import { place, shot, cast } from '../../engine';

// Every ready place, then a short scene written with shot(). Used to check the catalogue by eye.
const lou = cast({ seed: 'lou', body: 'teen', kind: 'fem', hair: 'long', outfit: ['hoodie:rose', 'jeans'] });
const sam = cast({ seed: 'sam', body: 'teen', kind: 'masc', hair: 'sidepart', outfit: ['tshirt:teal', 'jeans'] });
const prof = cast({ seed: 'prof', body: 'adult', kind: 'masc', hair: 'buzz', outfit: ['shirt:cream', 'pants:navy', 'tie:red'], acc: ['glasses:square'] });

const chalk = <text x={0} y={20} textAnchor="middle" fontSize={64} fill="#EDE8DE">x = 2y + 3</text>;

export const PClass = shot({ place: place('classroom', { slots: { board: chalk } }), cam: 'establishing', move: 'still' });
export const PBed = shot({ place: place('bedroom'), cam: 'establishing', move: 'still' });
export const PKit = shot({ place: place('kitchen'), cam: 'establishing', move: 'still' });
export const PLiving = shot({ place: place('living'), cam: 'establishing', move: 'still' });
export const POffice = shot({ place: place('office'), cam: 'establishing', move: 'still' });
export const PResto = shot({ place: place('restaurant'), cam: 'establishing', move: 'still' });

const room = place('classroom', { slots: { board: chalk } });
const nightRoom = place('classroom', { mood: 'night', palette: { wall: '#3A2E4E' }, slots: { board: chalk } });
export const SWide = shot({ place: room, cam: 'wide', people: [{ who: prof, at: { u: 0.22, w: 0.3 }, yaw: 0.45, act: 'explain' }, { who: lou, on: 'd4', yaw: -2 }, { who: sam, on: 'd2', yaw: -2 }] });
export const SMed = shot({ place: room, cam: 'medium', people: [{ who: lou, on: 'd1', yaw: 0.45, act: 'think' }] });
export const SClose = shot({ place: room, cam: 'close', people: [{ who: sam, at: { u: 0.6, w: 0.6 }, yaw: -0.45 }] });
export const SDuo = shot({ place: nightRoom, cam: 'wide', duo: { a: { who: lou, at: { u: 0.35, w: 0.55 } }, b: { who: sam, at: { u: 0.62, w: 0.55 } }, action: 'handshake', from: 0, dur: 30 } });

// A place the catalogue does not have, built without touching the engine: a laundromat, with one piece drawn on the spot.
const washer = ({ r, u, w, len, deep }: { r: { P: (u: number, v: number, w: number) => { x: number; y: number } }; u: number; w: number; len: number; deep: number }) => {
  const a = r.P(u, 0.62, w + deep);
  const b = r.P(u + len, 1, w + deep);
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const R = (b.x - a.x) * 0.3;
  return (
    <g>
      <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} rx={8} fill="#E8EAEE" stroke="#9AA0AC" strokeWidth={4} />
      <circle cx={c.x} cy={c.y} r={R} fill="#5C89B8" stroke="#6E7480" strokeWidth={8} />
      <circle cx={c.x - R * 0.3} cy={c.y - R * 0.3} r={R * 0.25} fill="#FFFFFF" opacity={0.5} />
    </g>
  );
};
const laundry = place('blank', {
  mood: 'dusk',
  palette: { wall: '#D97B66', side: '#B86552', floor: '#D8D2C6', floorLine: '#B8B0A0', floorKind: 'tiles' },
  lights: [{ u: 0.5, w: 0.3 }],
  pieces: [
    { p: 'window', at: { u: 0.62 }, len: 0.2 },
    { p: 'clock', at: { u: 0.32 } },
    ...[0.2, 0.34, 0.48].map((u, i) => ({ p: 'washer', id: `w${i}`, at: { u, w: 0.02 }, len: 0.12, deep: 0.1, draw: washer as never })),
    { p: 'table', id: 'fold', at: { u: 0.32, w: 0.42 }, len: 0.3, deep: 0.12, color: '#EAD7A8' },
    { p: 'plant', at: { u: 0.8, w: 0.2 } },
  ],
});
export const SLaundry = shot({ place: laundry, cam: 'establishing', move: 'still' });
export const SWalk = shot({ place: laundry, cam: 'wide', people: [{ who: sam, at: (t, len) => ({ u: 0.3 + (0.3 * t) / len, w: 0.35 }), yaw: 1, act: 'walk' }, { who: lou, on: 'fold', yaw: 2, face: [[0, 'neutral'], [10, 'shock']] }] });

// Several moments in one shot, set on the words: "J'ai soulevé (f 8) les cheveux derrière l'oreille (f 30) de mon client (f 48)".
const salon = place('blank', { mood: 'dusk', palette: { wall: '#6E5661', floor: '#7A5C49' }, pieces: [{ p: 'chair', id: 'seat', at: { u: 0.5, w: 0.36 } }, { p: 'counter', at: { u: 0.7, w: 0 }, len: 0.24 }] });
const nora = cast({ seed: 'nora', kind: 'fem', hair: 'bun', outfit: ['blazer:plum', 'skirt'] });
const miles = cast({ seed: 'miles', kind: 'masc', hair: 'buzz', outfit: ['coat:black', 'jeans'] });
export const SBeats = shot({
  place: salon,
  cam: 'wide',
  beats: [{ at: 30, cam: 'medium', on: 1 }, { at: 48, shake: 8 }],
  people: [
    { who: miles, on: 'seat', yaw: -0.45, act: 'idle', face: 'neutral', beats: [{ at: 48, act: 'startle', face: 'shock' }] },
    { who: nora, at: { u: 0.36, w: 0.4 }, look: 0, act: 'idle', face: 'neutral', beats: [{ at: 8, reach: { to: 0 } }, { at: 30, face: 'shock' }, { at: 48, reach: null, act: 'shrug' }] },
  ],
});
