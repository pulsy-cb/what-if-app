import React from 'react';
import {
  ShotProps, Stage, roomGround, Staged, makeRoom, cast, kf, camT, camPush, Foreground, FloorShadow,
  WallClock, WallFrame, LightVeil, Dust, Glow, Phone, poseAt, faceAt, Person, Hero, StageItem,
} from '../../engine';
import { AvatarBubble, BubblePhone } from './_s6s19';

/* =====================================================================
   CE QUE J'AI VU SUR SON TÉLÉPHONE — un salon de manucure de quartier, le soir.
   Tout le décor est décrit dans DIRECTOR.md §1 : une seule pièce partagée.
   ===================================================================== */

const SALON = makeRoom({ x: 950, y: 500 }, { x0: 300, x1: 1520, y0: 130, y1: 760 }, 3.3);
const G = roomGround(SALON, 0.62);
/** un point d'appui au sol : position écran + échelle à (u, w) */
const gp = (u: number, w: number): { x: number; y: number; scale: number } => G.project(u, w);
const RUG = SALON.Q([[0.17, 1, 0.36], [0.87, 1, 0.36], [0.87, 1, 0.74], [0.17, 1, 0.74]]);

const COL = {
  back: '#6E8C76', side: '#5C7764', ceil: '#3B4C42', floor: '#4A3629', line: '#3A2A1E',
  trim: '#2A1F18', metal: '#9A9AA2', sky: ['#20253F', '#3A3A62', '#5E4A6E'] as [string, string, string],
  neon: '#FF6B8A', warm: '#FFD9A0', phone: '#1F4E79',
};
const NAILS = ['#E23B5A', '#F2A03D', '#8E5CC4', '#2F9E8F', '#E8C86A', '#C7D2DD', '#FF6B8A', '#4F7FE0', '#D94B8C'];

type At = { u: number; w: number };
type Cam = { x: number; y: number; zoom: number };
const ROOM: Cam = { x: 960, y: 600, zoom: 1.42 };

/* ------------------------------------------------ positions partagées */
const AT_NARR: At = { u: 0.34, w: 0.5 };
const AT_MARC: At = { u: 0.7, w: 0.42 };
const AT_LUISA: At = { u: 0.6, w: 0.16 };
const phoneMarc = () => SALON.P(0.82, 0.705, 0.62);
const phoneNarr = () => SALON.P(0.2, 0.705, 0.6);

/* ------------------------------------------------ mobilier du salon */
const DeskShadow: React.FC<{ u: number; w: number; len?: number }> = ({ u, w, len = 0.22 }) => <FloorShadow r={SALON} u={[u - 0.02, u + len + 0.02]} w={[w - 0.02, w + 0.32]} />;
const DeskFrame: React.FC<{ u: number; w: number; len?: number }> = ({ u, w, len = 0.22 }) => {
  const a = SALON.P(u, 0.685, w), b = SALON.P(u + len, 0.685, w), c = SALON.P(u + len, 0.735, w + 0.3), d = SALON.P(u, 0.735, w + 0.3);
  const e = SALON.P(u + 0.03, 0.685, w + 0.27), f = SALON.P(u + 0.03, 1, w + 0.27), g = SALON.P(u + len - 0.03, 1, w + 0.27);
  return (
    <g>
      <path d={`M ${e.x} ${e.y} L ${f.x} ${f.y} L ${g.x} ${g.y}`} stroke={COL.metal} strokeWidth={9} fill="none" />
      <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`} fill="#E6D7BE" />
      <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`} fill="none" stroke="#F6EEE0" strokeWidth={3} />
      <path d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${b.x - 4} ${b.y + 22} L ${a.x - 4} ${a.y + 22} Z`} fill="#D8C6A6" />
    </g>
  );
};
const Touches: React.FC<{ u: number; w: number; f: number }> = ({ u, w, f }) => {
  const a = SALON.P(u + 0.035, 0.7, w + 0.1), b = SALON.P(u + 0.185, 0.7, w + 0.1);
  const c = SALON.P(u + 0.035, 0.7, w + 0.21), d = SALON.P(u + 0.185, 0.7, w + 0.21);
  const on = f % 14 < 9;
  return <path d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${d.x} ${d.y} L ${c.x} ${c.y} Z`} fill={on ? '#CFEFF9' : '#84A9B6'} opacity={0.9} />;
};
const Tray: React.FC<{ u: number; w: number }> = ({ u, w }) => {
  const a = SALON.P(u + 0.145, 0.7, w + 0.1), b = SALON.P(u + 0.2, 0.7, w + 0.1);
  return (
    <g>
      <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} fill="#A6A6AE" rx={3} />
      {[0.155, 0.172, 0.19].map((k, i) => {
        const p = SALON.P(u + k, 0.7, w + 0.14);
        return <rect key={i} x={p.x} y={p.y - 18} width={6} height={18} rx={3} fill={NAILS[(i + 2) % NAILS.length]} />;
      })}
    </g>
  );
};
const DeskLamp: React.FC<{ u: number; w: number }> = ({ u, w }) => {
  const b = SALON.P(u, 0.72, w + 0.24), h = SALON.P(u, 0.56, w + 0.24);
  return (
    <g>
      <ellipse cx={b.x} cy={b.y} rx={22} ry={6} fill="#2A2026" />
      <path d={`M ${b.x} ${b.y} L ${b.x} ${h.y + 30}`} stroke="#2A2026" strokeWidth={5} />
      <path d={`M ${h.x - 28} ${h.y + 34} L ${h.x + 28} ${h.y + 34} L ${h.x + 16} ${h.y - 4} L ${h.x - 16} ${h.y - 4} Z`} fill="#F0D3A6" />
      <Glow x={h.x} y={h.y + 38} r={160} o={0.45} />
    </g>
  );
};
const Plant: React.FC = () => {
  const b = SALON.P(0.1, 1, 0.28);
  return (
    <g>
      <ellipse cx={b.x} cy={b.y} rx={46} ry={12} fill="#000" opacity={0.3} />
      {[-1.2, -0.7, -0.2, 0.3, 0.8, 1.3].map((a, i) => {
        const l = 96 + (i % 3) * 28;
        const ex = b.x + Math.sin(a) * l * 0.7, ey = b.y - 96 - Math.cos(a) * l;
        return <path key={i} d={`M ${b.x} ${b.y - 90} Q ${b.x + Math.sin(a) * l * 0.4} ${b.y - 130 - l * 0.5} ${ex} ${ey}`} stroke={i % 2 ? '#3F7A55' : '#4C8F63'} strokeWidth={17} strokeLinecap="round" fill="none" />;
      })}
      <path d={`M ${b.x - 32} ${b.y - 92} L ${b.x + 32} ${b.y - 92} L ${b.x + 23} ${b.y} L ${b.x - 23} ${b.y} Z`} fill="#B9704F" />
      <path d={`M ${b.x - 32} ${b.y - 92} L ${b.x + 32} ${b.y - 92} L ${b.x + 30} ${b.y - 80} L ${b.x - 30} ${b.y - 80} Z`} fill="#CF8663" />
    </g>
  );
};

/** le décor unique, identique plan à plan (continuité DIRECTOR §1) */
const Salon: React.FC<{ t: number; id: string; phone?: number }> = ({ t, id, phone = 1 }) => {
  const back = { x0: SALON.back.x0, x1: SALON.back.x1, y0: SALON.back.y0, y1: SALON.back.y1 };
  const bx = (u: number) => back.x0 + (back.x1 - back.x0) * u;
  const by = (v: number) => back.y0 + (back.y1 - back.y0) * v;
  const shelves = [0.4, 0.5, 0.6, 0.7];
  const pm = phoneMarc();
  return (
    <g>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COL.sky[0]} /><stop offset="70%" stopColor={COL.sky[1]} /><stop offset="100%" stopColor={COL.sky[2]} />
        </linearGradient>
        <linearGradient id={`${id}cone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COL.warm} stopOpacity={0.3} /><stop offset="100%" stopColor={COL.warm} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={1920} height={back.y0 + 10} fill={COL.ceil} />
      <rect x={back.x0} y={back.y0} width={back.x1 - back.x0} height={back.y1 - back.y0} fill={COL.back} />
      <polygon points={SALON.Q([[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]])} fill={COL.side} />
      <polygon points={SALON.Q([[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]])} fill={COL.side} />
      <polygon points={SALON.Q([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]])} fill={COL.floor} />
      {[0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88, 0.96].map((w, i) => {
        const a = SALON.P(0, 1, w), b = SALON.P(1, 1, w);
        return <path key={i} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={COL.line} strokeWidth={2.5} opacity={0.55} />;
      })}
      <polygon points={SALON.Q([[0, 1, 0.26], [1, 1, 0.26], [1, 1, 0.66], [0, 1, 0.66]])} fill="#1E2C26" opacity={0.4} />
      <rect x={back.x0} y={back.y1 - 14} width={back.x1 - back.x0} height={14} fill={COL.trim} />
      {/* fenêtre sur la rue, à gauche */}
      <rect x={bx(0.03)} y={by(0.2)} width={bx(0.26) - bx(0.03)} height={by(0.66) - by(0.2)} fill={`url(#${id}sky)`} />
      <rect x={bx(0.033)} y={by(0.48)} width={(bx(0.26) - bx(0.03)) * 0.5} height={by(0.66) - by(0.48)} fill="#141A2C" />
      <rect x={bx(0.17)} y={by(0.55)} width={(bx(0.26) - bx(0.03)) * 0.42} height={by(0.66) - by(0.55)} fill="#101426" />
      <rect x={bx(0.05)} y={by(0.52)} width={26} height={20} fill={COL.neon} opacity={0.85} />
      <rect x={bx(0.062)} y={by(0.58)} width={20} height={16} fill={COL.warm} opacity={0.7} />
      <rect x={bx(0.03)} y={by(0.2)} width={bx(0.26) - bx(0.03)} height={by(0.66) - by(0.2)} fill="none" stroke="#2A2018" strokeWidth={13} />
      <path d={`M ${bx(0.145)} ${by(0.2)} L ${bx(0.145)} ${by(0.66)} M ${bx(0.03)} ${by(0.47)} L ${bx(0.26)} ${by(0.47)}`} stroke="#2A2018" strokeWidth={9} />
      <polygon points={`${bx(0.02)},${by(0.2)} ${bx(0.05)},${by(0.2)} ${bx(0.1)},${by(0.98)} ${bx(0.04)},${by(0.98)}`} fill={COL.neon} opacity={0.1} />
      {/* affiche de prix collée au mur */}
      {(() => {
        const x = bx(0.3), y = by(0.22), w = 168, h = 158;
        return (
          <g transform={`rotate(-2.5 ${x + w / 2} ${y + h / 2})`}>
            <rect x={x} y={y} width={w} height={h} fill="#F6EEDC" stroke="#C9B48A" strokeWidth={4} />
            <rect x={x} y={y} width={w} height={32} fill={COL.neon} opacity={0.88} />
            <text x={x + w / 2} y={y + 23} textAnchor="middle" fontSize={19} fontWeight={700} fill="#3A1420" fontFamily="system-ui, sans-serif">ONGLES 25€</text>
            <text x={x + w / 2} y={y + 62} textAnchor="middle" fontSize={16} fill="#4A3A2A" fontFamily="system-ui, sans-serif">POSE GEL 40€</text>
            <text x={x + w / 2} y={y + 88} textAnchor="middle" fontSize={16} fill="#4A3A2A" fontFamily="system-ui, sans-serif">LUISA</text>
            <text x={x + w / 2} y={y + 112} textAnchor="middle" fontSize={16} fill="#4A3A2A" fontFamily="system-ui, sans-serif">SUR R.-V.</text>
            <text x={x + w / 2} y={y + 140} textAnchor="middle" fontSize={14} fill="#8A6B4A" fontFamily="system-ui, sans-serif">06 12 44 90 37</text>
          </g>
        );
      })()}
      <WallClock x={1090} y={by(0.3)} r={42} t={t} />
      <WallFrame x={1220} y={by(0.24)} w={120} h={88} art={1} />
      <WallFrame x={1370} y={by(0.3)} w={82} h={62} art={0} />
      {/* l'enseigne rose */}
      <rect x={780} y={back.y0 + 22} width={268} height={44} rx={10} fill="#2A1420" stroke={COL.neon} strokeWidth={4} />
      <text x={914} y={back.y0 + 54} textAnchor="middle" fontSize={27} fontWeight={700} fill={COL.neon} fontFamily="system-ui, sans-serif" opacity={0.9}>MANUCURE</text>
      {/* l'étagère à vernis */}
      {shelves.map((sv, r) => (
        <g key={r}>
          <rect x={bx(0.58)} y={by(sv)} width={bx(0.98) - bx(0.58)} height={9} fill="#8A6B4A" />
          {Array.from({ length: 16 }, (_, i) => {
            const x = bx(0.59) + i * ((bx(0.97) - bx(0.59)) / 16);
            return <rect key={i} x={x} y={by(sv) - 38} width={17} height={38} rx={5} fill={NAILS[(i + r * 3) % NAILS.length]} />;
          })}
        </g>
      ))}
      {/* le comptoir d'accueil, à l'arrière */}
      {(() => {
        const a = SALON.P(0.44, 0.9, 0.05), b = SALON.P(0.56, 0.9, 0.05), c = SALON.P(0.56, 1, 0.05), d = SALON.P(0.44, 1, 0.05);
        const ta = SALON.P(0.44, 0.9, 0.22), tb = SALON.P(0.56, 0.9, 0.22);
        return (
          <g>
            <FloorShadow r={SALON} u={[0.42, 0.58]} w={[0.03, 0.2]} />
            <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`} fill="#7E6A4E" />
            <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${tb.x},${tb.y} ${ta.x},${ta.y}`} fill="#A98C63" />
            <path d={`M ${ta.x} ${ta.y} L ${tb.x} ${tb.y}`} stroke="#D3B489" strokeWidth={6} />
            <path d={`M ${a.x + 30} ${a.y + 20} L ${a.x + 30} ${d.y - 20}`} stroke="#5E4A34" strokeWidth={3} />
          </g>
        );
      })()}
      <polygon points={`${bx(0.03)},${by(0.48)} ${bx(0.28)},${by(0.36)} ${bx(0.6)},${by(0.98)} ${bx(0.14)},${by(0.98)}`} fill={COL.neon} opacity={0.1} />
      {/* sol : moquette, plante, deux tables */}
      <polygon points={RUG} fill="#5A3B4A" opacity={0.85} />
      <polygon points={SALON.Q([[0.18, 1, 0.37], [0.86, 1, 0.37], [0.86, 1, 0.73], [0.18, 1, 0.73]])} fill="none" stroke="#FFE3C8" strokeOpacity={0.14} strokeWidth={4} />
      <Plant />
      <DeskShadow u={0.22} w={0.48} />
      <DeskShadow u={0.6} w={0.4} />
      <DeskFrame u={0.22} w={0.48} />
      <DeskFrame u={0.6} w={0.4} />
      <Touches u={0.22} w={0.48} f={t} />
      <Touches u={0.6} w={0.4} f={t + 5} />
      <Tray u={0.22} w={0.48} />
      <Tray u={0.6} w={0.4} />
      <DeskLamp u={0.74} w={0.4} />
      {/* le téléphone bleu de Marc, dans la lumière de la lampe */}
      {phone > 0 ? <Phone x={pm.x} y={pm.y} w={52} rot={-10} on={phone} f={t} caller="" /> : null}
      {/* lumière */}
      <polygon points={`${SALON.P(0.74, 0.56, 0.86).x},${SALON.P(0.74, 0.56, 0.86).y} ${SALON.P(0.5, 1, 0.94).x},${SALON.P(0.5, 1, 0.94).y} ${SALON.P(0.98, 1, 0.94).x},${SALON.P(0.98, 1, 0.94).y} ${SALON.P(0.86, 0.56, 0.86).x},${SALON.P(0.86, 0.56, 0.86).y}`} fill={`url(#${id}cone)`} />
      <Dust t={t} seed={7} x0={back.x0} y0={by(0.25)} w={back.x1 - back.x0} h={760} n={22} o={0.2} />
      <LightVeil id={`${id}veil`} lights={[[SALON.P(0.74, 0.5, 0.7).x, SALON.P(0.74, 0.5, 0.7).y, 520], [bx(0.14), by(0.44), 360]]} o={0.42} />
    </g>
  );
};

/* ------------------------------------------------ casting (DIRECTOR §2) */
const NARR = cast({ seed: 'narr', kind: 'fem', hair: { style: 'wavy', color: 'auburn' }, outfit: ['sweater:cream', 'jeans'], acc: ['earrings'], skin: 'peach' });
const LUISA = cast({ seed: 'luisa', kind: 'fem', hair: { style: 'bun', color: 'black' }, outfit: ['tshirt:teal', 'apron:plum', 'pants:black'], acc: ['glasses:round'], skin: 'tan' });
const MARC = cast({ seed: 'marc', kind: 'masc', hair: { style: 'sidepart', color: 'brown' }, outfit: ['shirt:white', 'pants:navy'], facial: 'beard', skin: 'sand' } as any);

/* ------------------------------------------------ primitives de plan */
const Stage0: React.FC<{ t: number; cam?: Cam; children?: React.ReactNode; kids?: React.ReactNode; focus?: number }> = ({ t, cam = ROOM, children, focus }) => (
  <g transform={camT(cam.x, cam.y, cam.zoom)}>
    <Stage ground={G} t={t} focus={focus as any}>{children}</Stage>
  </g>
);
const Scrim: React.FC<{ cam: Cam }> = ({ cam }) => (
  <rect x={cam.x - 1500 / cam.zoom} y={cam.y - 1500 / cam.zoom} width={3000 / cam.zoom} height={3000 / cam.zoom} fill="#000" opacity={0.2} />
);

/** un personnage dans le Stage (assis ou debout) */

const Prim: React.FC<any> = (p) => <Staged {...p} act={p.act as any} />;

/** la charpente qu'on dessine soi-même : une silhouette qui lit comme quelqu'un sans passer par <Staged> */
const SK = '#E9BE9A', CRA = '#1E1418', CREAM = '#F2E6D2', PLUM = '#6E3E5C', TEAL = '#2F7F86';
const Who: React.FC<{
  x: number; y: number; s?: number; turn?: number; hair?: 'wave' | 'bun' | 'short';
  top?: string; lap?: string; be?: number; skin?: string; fr?: number;
}> = ({ x, y, s = 1, turn = 0, hair = 'wave', top = CREAM, lap = '#2F4C6E', be = 0, skin = SK, fr = 0 }) => (
  <g transform={`translate(${x} ${y}) scale(${s * (turn < 0 ? -1 : 1)} ${s})`}>
    <ellipse cx={0} cy={4} rx={58} ry={12} fill="#000" opacity={0.3} />
    <path d={`M -30 0 L -30 -104 Q 0 -116 30 -104 L 30 0`} fill={lap} />
    <path d={`M -38 -96 Q -34 -196 0 -200 Q 34 -196 38 -96 Q 0 -84 -38 -96 Z`} fill={top} />
    <rect x={-13} y={-214} width={26} height={22} rx={8} fill={skin} />
    <circle cx={0} cy={-242} r={31} fill={skin} />
    {hair === 'bun' ? <g><circle cx={-4} cy={-278} r={17} fill={CRA} /><path d="M -31 -244 Q -30 -276 0 -276 Q 30 -276 30 -244 Q 14 -264 -10 -260 Z" fill={CRA} /></g>
      : hair === 'short' ? <path d="M -31 -246 Q -32 -278 0 -276 Q 32 -278 32 -246 Q 14 -262 -10 -258 Z" fill={CRA} />
        : <path d="M -33 -240 Q -38 -284 0 -278 Q 38 -284 33 -240 Q 26 -262 12 -256 Q -6 -240 -33 -240 Z" fill="#7B3B22" />}
    {be > 0 ? <g transform={`translate(9 ${-250 + be * 1.1})`} opacity={be}><circle cx={6} cy={-24} r={7} fill={CRA} /><circle cx={15} cy={-32} r={7} fill={CRA} /><circle cx={24} cy={-36} r={6} fill={CRA} /></g> : null}
    {fr > 0 ? (
      <g opacity={fr}>
        <rect x={-16} y={-192} width={32} height={46} rx={5} fill="#E4D6BC" stroke="#B9A887" strokeWidth={2} />
        <text x={0} y={-168} textAnchor="middle" fontSize={11} fill="#3A2A20" fontFamily="sans-serif">12</text>
      </g>
    ) : null}
  </g>
);

/* =====================================================================
   S1 — wide : le salon est plein, et ce n'est pas Luisa qui la coiffe
   ===================================================================== */
export const S1: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 620, zoom: 1.0 };
  return (
    <g>
      <Salon t={t} id="s1" phone={0} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={AT_LUISA && LUISA} at={AT_LUISA} yaw={0.5} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.55} seated act="hold" face="happy" />
        <Who {...gp(0.34, 0.5)} s={gp(0.34, 0.5).scale * 1.05} turn={1} hair="wave" top={CREAM} lap="#2F4C6E" be={kf(t, [[60, 0], [80, 1]])} fr={kf(t, [[118, 0], [132, 1]])} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S2 — close : « pas de place pour moi »
   ===================================================================== */
export const S2: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1000, y: 600, zoom: 1.55 };
  return (
    <g>
      <Salon t={t} id="s2" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={LUISA} at={AT_LUISA} yaw={-0.6} seated act="shrug" face="worried"
          beats={[{ at: 72, act: 'explain', face: 'worried' }, { at: 128, yaw: -0.9, look: 0 }, { at: 160, face: 'happy', act: 'point' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S3 — wide : 2 % de batterie, alors elle regarde le téléphone de Marc
   ===================================================================== */
export const S3: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 625, zoom: 0.98 };
  const pn = phoneNarr();
  return (
    <g>
      <Salon t={t} id="s3" phone={0} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.4} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.5} seated act="hold" face="neutral"
          beats={[{ at: 120, act: 'idle' }, { at: 190, face: 'happy' }]} />
        <Who {...gp(0.34, 0.5)} s={gp(0.34, 0.5).scale * 1.05} turn={1} hair="wave" top={CREAM} lap="#2F4C6E" be={kf(t, [[70, 0], [86, 0.35]])} fr={kf(t, [[150, 0], [166, 1]])} />
      </Stage0>
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <Phone x={pn.x} y={pn.y} w={48} rot={14} on={2} f={t} caller="" />
        <Phone x={phoneMarc().x} y={phoneMarc().y} w={52} rot={-10} on={1} f={t} caller="" />
        <BatteryChip x={pn.x + 34} y={pn.y - 96} t={t} />
      </g>
      <Scrim cam={cam} />
    </g>
  );
};
/** l'UI diégétique : 2 % de batterie */
const BatteryChip: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) => {
  const o = kf(t, [[78, 0], [92, 1]]);
  return (
    <g opacity={o}>
      <rect x={x} y={y} width={158} height={52} rx={13} fill="#14181F" opacity={0.9} />
      <rect x={x + 14} y={y + 17} width={40} height={20} rx={5} fill="none" stroke="#F26B6B" strokeWidth={3} />
      <rect x={x + 18} y={y + 21} width={6} height={12} fill="#F26B6B" />
      <rect x={x + 56} y={y + 25} width={4} height={6} fill="#F26B6B" />
      <text x={x + 72} y={y + 35} fontSize={25} fontWeight={700} fill="#F6EFE3" fontFamily="system-ui, sans-serif">2 %</text>
    </g>
  );
};

/* =====================================================================
   S4 — medium : le temps d'arrêt avant que ça bascule
   ===================================================================== */
export const S4: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1010, y: 650, zoom: 1.55 };
  return (
    <g>
      <Salon t={t} id="s4" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.85} seated act="idle" face="neutral"
          beats={[{ at: 23, yaw: -0.6, face: 'happy' }, { at: 36, act: 'explain' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S5 — insert macro : « Tu me manques tellement » s'affiche
   ===================================================================== */
export const S5: React.FC<ShotProps> = ({ t }) => {
  const p = phoneMarc();
  const cam: Cam = { x: p.x - 22, y: p.y - 96, zoom: 2.55 };
  return (
    <g>
      <Salon t={t} id="s5" phone={0} />
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <rect x={-800} y={-700} width={1600} height={1400} fill="#0C0F16" opacity={0.5} />
        <ScreenMarc x={p.x - 168} y={p.y - 300} t={t} scale={1.42} />
      </g>
    </g>
  );
};
/** l'écran de Marc : la conversation qui s'écrit sous nos yeux */
const ScreenMarc: React.FC<{ x: number; y: number; t: number; scale?: number }> = ({ x, y, t, scale = 1 }) => {
  const appear = (f: number) => kf(t, [[f - 6, 0], [f, 1]]);
  const a = appear(9);
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(-5)`}>
      <rect x={0} y={0} width={300} height={420} rx={26} fill={COL.phone} />
      <rect x={10} y={10} width={280} height={400} rx={20} fill="#101827" />
      <rect x={20} y={20} width={260} height={44} rx={10} fill="#17263C" />
      <circle cx={46} cy={42} r={14} fill="#C97A9E" />
      <path d="M 40 52 Q 46 36 52 52" fill="#3A2030" />
      <text x={70} y={48} fontSize={19} fill="#E6EEF8" fontFamily="system-ui, sans-serif">Camille</text>
      <g opacity={a} transform={`translate(${(1 - a) * 10} ${(1 - a) * 14})`}>
        <rect x={20} y={86} width={244} height={112} rx={16} fill="#8E5CC4" opacity={0.92} />
        <circle cx={54} cy={118} r={16} fill="#C97A9E" />
        <path d="M 46 130 Q 54 112 62 130" fill="#3A2030" />
        <text x={80} y={124} fontSize={18} fontWeight={700} fill="#FFF" fontFamily="system-ui, sans-serif">Camille</text>
        <text x={32} y={158} fontSize={21} fill="#FFF" fontFamily="system-ui, sans-serif">Tu me manques</text>
        <text x={32} y={184} fontSize={21} fill="#FFF" fontFamily="system-ui, sans-serif">tellement</text>
      </g>
      <rect x={20} y={230} width={200} height={40} rx={14} fill="#1E3350" />
      <rect x={20} y={282} width={240} height={40} rx={14} fill="#1E3350" />
      <rect x={20} y={356} width={260} height={34} rx={17} fill="#24395A" />
    </g>
  );
};

/* =====================================================================
   S6 — close : la photo de profil, ce n'est pas sa femme
   ===================================================================== */
export const S6: React.FC<ShotProps> = ({ t }) => {
  const p = phoneMarc();
  const cam: Cam = { x: p.x + 4, y: p.y - 210, zoom: 3.1 };
  const hand = kf(t, [[0, 0], [18, 1], [104, 1], [120, 0.5]]);
  return (
    <g>
      <Salon t={t} id="s6" phone={1} />
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        {/* les mains de Marc tiennent le téléphone posé sur la table : l'objet est tenu, jamais flottant */}
        <g opacity={hand}>
          <ellipse cx={p.x} cy={p.y + 96} rx={120} ry={60} fill="#E2B48E" />
          <ellipse cx={p.x - 96} cy={p.y + 70} rx={28} ry={44} fill="#E2B48E" />
          <ellipse cx={p.x + 96} cy={p.y + 70} rx={28} ry={44} fill="#E2B48E" />
          <path d={`M ${p.x - 108} ${p.y + 124} L ${p.x + 108} ${p.y + 124} L ${p.x + 96} ${p.y + 152} L ${p.x - 96} ${p.y + 152} Z`} fill="#EDE6DA" />
        </g>
        <ScreenMarc x={p.x - 168} y={p.y - 300} t={t} scale={1.42} />
        <AvatarBubble x={p.x - 60} y={p.y - 220} t={t} />
      </g>
    </g>
  );
};

export const S7: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 990, y: 615, zoom: 1.02 };
  return (
    <g>
      <Salon t={t} id="s7" phone={1} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.5} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.4} seated act="hold" face="happy" beats={[{ at: 72, act: 'explain' }]} />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.5} seated act="idle" face="worried"
          beats={[{ at: 40, face: 'tired' }, { at: 100, face: 'worried', look: 1 }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S8 — medium : « si ce n'était pas pour Luisa… »
   ===================================================================== */
export const S8: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1010, y: 645, zoom: 1.6 };
  return (
    <g>
      <Salon t={t} id="s8" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.7} seated act="idle" face="happy"
          beats={[{ at: 19, act: 'talk' }, { at: 105, act: 'explain' }]} />
      </Stage0>
      <Scrim cam={cam} />
      <Foreground blur={16}>
        <g transform={camT(cam.x, cam.y, cam.zoom)}>
          <rect x={cam.x + 300} y={cam.y - 420} width={560} height={960} rx={44} fill="#2A1F18" opacity={0.7} />
        </g>
      </Foreground>
    </g>
  );
};

/* =====================================================================
   S9 — close : « ta fille de treize ans adore ça » (il parle de sa fille)
   ===================================================================== */
export const S9: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1010, y: 630, zoom: 1.9 };
  return (
    <g>
      <Salon t={t} id="s9" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.75} seated act="talk" face="happy"
          beats={[{ at: 36, act: 'explain' }, { at: 78, act: 'talk', face: 'happy' }, { at: 130, face: 'smug', act: 'explain' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S10 — medium : elle se retourne, il est en train de lui écrire
   ===================================================================== */
export const S10: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 930, y: 640, zoom: 1.6 };
  return (
    <g>
      <Salon t={t} id="s10" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.25}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.9} seated act="idle" face="worried"
          beats={[{ at: 15, yaw: 0.5, look: 1, face: 'worried' }, { at: 46, face: 'shock' }]} />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.7} seated act="hold" face="happy" beats={[{ at: 27, act: 'talk' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S11 — insert macro : « je regardais du coin de l'œil » -> la photo en grand
   ===================================================================== */
export const S11: React.FC<ShotProps> = ({ t }) => {
  const p = phoneMarc();
  const cam: Cam = { x: p.x - 18, y: p.y - 118, zoom: 2.2 };
  return (
    <g>
      <Salon t={t} id="s11" phone={0} />
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <rect x={-800} y={-700} width={1600} height={1400} fill="#0C0F16" opacity={0.5} />
        <ScreenMarc x={p.x - 168} y={p.y - 300} t={t} scale={1.42} />
        <g opacity={kf(t, [[140, 0], [158, 1]])}>
          <PhotoCard x={p.x - 178} y={p.y - 156} t={t} />
        </g>
      </g>
    </g>
  );
};
/** la photo de profil, tirée en grand sur la table */
const PhotoCard: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) => {
  const p = kf(t, [[140, 0], [158, 1]]);
  return (
    <g transform={`translate(0 ${(1 - p) * 24})`}>
      <rect x={x} y={y} width={236} height={292} rx={16} fill="#F6EEDC" stroke="#E2D4BE" strokeWidth={3} />
      <rect x={x + 14} y={y + 14} width={208} height={208} rx={10} fill="#D8B48C" />
      <path d={`M ${x + 24} ${y + 210} Q ${x + 30} ${y + 40} ${x + 118} ${y + 44} Q ${x + 208} ${y + 48} ${x + 212} ${y + 214} Q ${x + 168} ${y + 96} ${x + 118} ${y + 100} Q ${x + 62} ${y + 104} ${x + 24} ${y + 210} Z`} fill="#3A2A20" />
      <circle cx={x + 92} cy={y + 118} r={7} fill="#2A1E18" />
      <circle cx={x + 146} cy={y + 118} r={7} fill="#2A1E18" />
      <path d={`M ${x + 104} ${y + 156} Q ${x + 119} ${y + 172} ${x + 134} ${y + 156}`} stroke="#B56A5A" strokeWidth={5} fill="none" strokeLinecap="round" />
      <text x={x + 118} y={y + 262} textAnchor="middle" fontSize={24} fill="#3A2A1E" fontFamily="system-ui, sans-serif">Camille, 13 ans</text>
    </g>
  );
};

/* =====================================================================
   S12 — medium : « la personne à qui il écrivait semblait extrêmement jeune »
   ===================================================================== */
export const S12: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 940, y: 640, zoom: 1.62 };
  return (
    <g>
      <Salon t={t} id="s12" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.75} seated act="idle" face="shock"
          beats={[{ at: 22, face: 'worried' }, { at: 58, face: 'shock' }, { at: 77, act: 'shrug' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* ------------------------------------------------ fin du premier lot */
/* =====================================================================
   S13 — close : « elle ressemblait à une fille de treize ans »
   ===================================================================== */
export const S13: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 905, y: 630, zoom: 1.85 };
  return (
    <g>
      <Salon t={t} id="s13" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.6} seated act="hold" face="neutral"
          beats={[{ at: 12, act: 'idle', face: 'shock' }, { at: 41, act: 'think', face: 'worried' }, { at: 86, act: 'idle', face: 'neutral' }, { at: 98, face: 'shock' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S14 — medium : « je suis tellement fier de ta maturité »
   ===================================================================== */
export const S14: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1020, y: 640, zoom: 1.58 };
  return (
    <g>
      <Salon t={t} id="s14" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.2} seated act="type" face="happy"
          beats={[{ at: 7, act: 'talk', face: 'happy' }, { at: 57, face: 'smug' }, { at: 112, act: 'type', face: 'smug' }, { at: 129, act: 'talk', face: 'happy' }, { at: 179, face: 'smug' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S15 — close : « je l'ai regardé taper un message »
   ===================================================================== */
export const S15: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 890, y: 620, zoom: 1.95 };
  return (
    <g>
      <Salon t={t} id="s15" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.22} seated act="idle" face="worried"
          beats={[{ at: 7, yaw: 1.05, look: 1 }, { at: 33, face: 'shock' }, { at: 86, act: 'hold', face: 'neutral' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S16 — medium : « il attendait le bon moment »
   ===================================================================== */
export const S16: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1030, y: 645, zoom: 1.5 };
  return (
    <g>
      <Salon t={t} id="s16" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.25}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.55} seated act="type" face="neutral"
          beats={[{ at: 9, act: 'talk', face: 'happy' }, { at: 47, act: 'type', face: 'neutral' }, { at: 78, act: 'talk', face: 'smug' }, { at: 114, face: 'happy' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S17 — close : la photo du tutu rose sur son écran
   ===================================================================== */
export const S17: React.FC<ShotProps> = ({ t }) => {
  const p = phoneMarc();
  const cam: Cam = { x: p.x - 26, y: p.y - 128, zoom: 2.25 };
  return (
    <g>
      <Salon t={t} id="s17" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.6}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.8} seated act="hold" face="smug"
          beats={[{ at: 26, act: 'talk' }, { at: 93, face: 'happy' }]} />
      </Stage0>
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <TutuCard x={p.x - 150} y={p.y - 74} t={t} />
      </g>
    </g>
  );
};
/** la photo du tutu rose, sur l'écran de Marc */
const TutuCard: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) => {
  const w = 300, h = 214;
  const drop = kf(t, [[0, 0], [10, 14]]);
  return (
    <g transform={`translate(0 ${drop})`}>
      <rect x={x} y={y} width={w} height={h} rx={18} fill="#F6EEDC" stroke="#E2D4BE" strokeWidth={3} />
      <rect x={x + 12} y={y + 12} width={w - 24} height={h - 44} rx={10} fill="#EFE6D6" />
      {Array.from({ length: 9 }, (_, i) => (
        <ellipse key={i} cx={x + 60 + i * 22} cy={y + 88 + Math.sin(i * 0.9) * 6} rx={30} ry={17}
          fill="#F6C6D0" stroke="#E7A8B6" strokeWidth={3} transform={`rotate(${(i - 4) * 9} ${x + 60 + i * 22} ${y + 88})`} />
      ))}
      <path d={`M ${x + 96} ${y + 84} Q ${x + 150} ${y + 64} ${x + 204} ${y + 84}`} stroke="#E7A8B6" strokeWidth={6} fill="none" />
      <text x={x + 16} y={y + 26} fontSize={18} fill="#8A7A66" fontFamily="system-ui, sans-serif">10:41</text>
      <text x={x + w - 16} y={y + 26} textAnchor="end" fontSize={18} fill="#8A7A66" fontFamily="system-ui, sans-serif">photo</text>
      <text x={x + w / 2} y={y + h - 12} textAnchor="middle" fontSize={19} fill="#3A2A1E" fontFamily="system-ui, sans-serif">« mets-la ce soir »</text>
    </g>
  );
};

/* =====================================================================
   S18 — medium : il se tourne vers Luisa et ment
   ===================================================================== */
export const S18: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1000, y: 630, zoom: 1.45 };
  return (
    <g>
      <Salon t={t} id="s18" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.1} seated act="idle" face="neutral"
          beats={[{ at: 22, face: 'happy' }, { at: 103, yaw: 0.5, look: 0 }]} />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.7} seated act="hold" face="happy"
          beats={[{ at: 43, act: 'idle', face: 'neutral' }, { at: 77, yaw: 1.9, look: 0 }, { at: 110, act: 'talk', yaw: 0.9, face: 'happy' }, { at: 150, act: 'shrug' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S19 — close : sur son téléphone, le SMS de « sa mère »
   ===================================================================== */
export const S19: React.FC<ShotProps> = ({ t }) => {
  const p = phoneMarc();
  const cam: Cam = { x: p.x - 20, y: p.y - 200, zoom: 2.6 };
  const hand = kf(t, [[0, 0.35], [14, 1], [80, 1], [96, 0.8]]);
  return (
    <g>
      <Salon t={t} id="s19" phone={1} />
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        {/* amorce : la main de Marc qui tient le téléphone */}
        <g opacity={hand}>
          <ellipse cx={p.x + 30} cy={p.y + 92} rx={124} ry={58} fill="#E2B48E" />
          <ellipse cx={p.x + 132} cy={p.y + 66} rx={26} ry={42} fill="#E2B48E" />
          <ellipse cx={p.x - 70} cy={p.y + 66} rx={26} ry={42} fill="#E2B48E" />
          <path d={`M ${p.x - 120} ${p.y + 120} L ${p.x + 120} ${p.y + 120} L ${p.x + 106} ${p.y + 150} L ${p.x - 106} ${p.y + 150} Z`} fill="#EDE6DA" />
        </g>
        <BubblePhone x={p.x - 150} y={p.y - 66} t={t} />
        <Glow x={p.x} y={p.y + 60} r={260} kind="cool" o={0.3} />
      </g>
    </g>
  );
};

export const S20: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 930, y: 635, zoom: 1.55 };
  return (
    <g>
      <Salon t={t} id="s20" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.7} seated act="idle" face="shock"
          beats={[{ at: 17, face: 'worried' }, { at: 41, act: 'shrug', face: 'worried' }, { at: 82, face: 'shock', act: 'idle' }]} />
      </Stage0>
      <Scrim cam={cam} />
      <Foreground blur={16}>
        <g transform={camT(cam.x, cam.y, cam.zoom)}>
          <rect x={cam.x + 250} y={cam.y - 460} width={620} height={980} rx={48} fill="#2A1F18" opacity={0.65} />
        </g>
      </Foreground>
    </g>
  );
};

/* =====================================================================
   S21 — wide : elle sort son propre téléphone et écrit à la police
   ===================================================================== */
export const S21: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 625, zoom: 1.0 };
  const pn = phoneNarr();
  return (
    <g>
      <Salon t={t} id="s21" phone={1} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.5} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.2} seated act="hold" face="happy" beats={[{ at: 140, face: 'neutral' }]} />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.35} seated act="hold" face="worried"
          beats={[{ at: 76, act: 'type', face: 'worried' }, { at: 143, act: 'type', face: 'neutral' }, { at: 170, act: 'idle', face: 'worried' }]} />
      </Stage0>
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <Phone x={pn.x} y={pn.y} w={48} rot={12} on={kf(t, [[60, 0], [76, 1]]) > 0.5 ? 3 : 0} f={t} caller="" />
      </g>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S22 — close : « ils ont dit qu'ils étaient en route »
   ===================================================================== */
export const S22: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1030, y: 640, zoom: 1.9 };
  return (
    <g>
      <Salon t={t} id="s22" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.8} seated act="hold" face="happy"
          beats={[{ at: 9, act: 'talk', face: 'happy' }, { at: 35, act: 'idle', face: 'smug' }, { at: 86, face: 'neutral' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S23 — wide : elle fait traîner, pour gagner du temps
   ===================================================================== */
export const S23: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 950, y: 620, zoom: 1.05 };
  return (
    <g>
      <Salon t={t} id="s23" phone={0} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.4} seated act="explain" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.5} seated act="hold" face="neutral" />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.5} seated act="explain" face="worried"
          beats={[{ at: 21, act: 'talk', face: 'worried' }, { at: 50, act: 'question', face: 'neutral' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S24 — close : « des trucs en plus que je n'aimais même pas »
   ===================================================================== */
export const S24: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 890, y: 625, zoom: 1.88 };
  return (
    <g>
      <Salon t={t} id="s24" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.3} seated act="idle" face="worried"
          beats={[{ at: 6, act: 'explain', face: 'neutral' }, { at: 35, act: 'question', face: 'worried' }, { at: 59, act: 'shrug', face: 'tired' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};
/* =====================================================================
   S25 — wide : pieds nus, elle demande une pédicure (pour le retenir)
   ===================================================================== */
export const S25: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 615, zoom: 0.98 };
  return (
    <g>
      <Salon t={t} id="s25" phone={1} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.55} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.45} seated act="hold" face="neutral" beats={[{ at: 90, act: 'idle', face: 'worried' }]} />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.4} seated act="idle" face="neutral"
          beats={[{ at: 30, act: 'explain', face: 'neutral' }, { at: 98, act: 'wave', yaw: 0.7, face: 'happy' }]} />
        <StageItem depth={0.6}>
          <g transform={`translate(${SALON.P(0.3, 1, 0.62).x} ${SALON.P(0.3, 1, 0.62).y})`}>
            <ellipse cx={0} cy={66} rx={62} ry={14} fill="#1B1410" opacity={0.35} />
            <rect x={-46} y={-14} width={72} height={26} rx={12} fill="#B9C6D2" stroke="#7E8C99" strokeWidth={3} />
            <ellipse cx={34} cy={-4} rx={34} ry={16} fill="#F6C6D0" stroke="#E7A8B6" strokeWidth={3} transform={`rotate(${kf(t, [[40, -18], [70, 6]])} 34 -4)`} />
          </g>
        </StageItem>
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S26 — close : « enfin j'ai vu les voitures de police s'arrêter dehors »
   ===================================================================== */
export const S26: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 900, y: 560, zoom: 1.72 };
  const flash = kf(t, [[0, 0.1], [30, 0.55], [60, 0.25], [90, 0.8], [139, 0.5]]);
  return (
    <g>
      <Salon t={t} id="s26" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={1.5} seated act="idle" face="neutral"
          beats={[{ at: 38, face: 'shock' }, { at: 81, act: 'point', yaw: 1.75, face: 'shock' }]} />
      </Stage0>
      <g transform={camT(cam.x, cam.y, cam.zoom)}>
        <rect x={cam.x - 900} y={cam.y - 900} width={1800} height={1800} fill="#2C6BFF" opacity={flash * 0.16} />
        <rect x={cam.x - 900} y={cam.y - 900} width={1800} height={1800} fill="#FF3B3B" opacity={flash * 0.1 * Math.abs(Math.sin(t * 0.35))} />
      </g>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S27 — wide : deux officiers entrent et vont droit vers le mari
   ===================================================================== */
export const OFF1 = cast({ seed: 'off1', kind: 'masc', hair: 'buzz', outfit: ['shirt:navy', 'pants:black', 'boots'], acc: ['glasses:sun'] as any, skin: 'brown' } as any);
export const OFF2 = cast({ seed: 'off2', kind: 'fem', hair: { style: 'bun', color: 'black' }, outfit: ['shirt:navy', 'pants:black'], skin: 'tan' });
const walkIn = (t: number, len: number, from: number, to: number) => from + (to - from) * kf(t, [[0, 0], [len * 0.72, 1]]);

export const S27: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1000, y: 630, zoom: 0.95 };
  const u1 = walkIn(t, 113, 0.2, 0.62), u2 = walkIn(t, 113, 0.3, 0.68);
  return (
    <g>
      <Salon t={t} id="s27" phone={1} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.3} seated act="shrug" face="shock" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={1.5} seated act="idle" face="worried" beats={[{ at: 86, yaw: 0.9, face: 'shock' }]} />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.9} seated act="idle" face="shock" />
        <Prim t={t} who={OFF1} at={{ u: u1, w: 0.66 }} yaw={0.35} act={t < 84 ? 'walk' : 'idle'} face="neutral" />
        <Prim t={t} who={OFF2} at={{ u: u2, w: 0.6 }} yaw={0.3} act={t < 88 ? 'walk' : 'idle'} face="neutral" />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S28 — close : les officiers parlent au mari, il montre son téléphone
   ===================================================================== */
export const S28: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1040, y: 630, zoom: 1.8 };
  return (
    <g>
      <Salon t={t} id="s28" phone={1} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={0.35} seated act="idle" face="worried"
          beats={[{ at: 52, act: 'talk', face: 'worried' }, { at: 81, act: 'hold', face: 'worried' }]} />
      </Stage0>
      <Foreground blur={16}>
        <g transform={camT(cam.x, cam.y, cam.zoom)}>
          <ellipse cx={cam.x - 230} cy={cam.y + 90} rx={120} ry={150} fill="#1E2A3A" opacity={0.9} />
          <ellipse cx={cam.x - 230} cy={cam.y - 70} rx={72} ry={84} fill="#7A5A44" opacity={0.95} />
        </g>
      </Foreground>
    </g>
  );
};

/* =====================================================================
   S29 — medium : elle s'attend à une arrestation... ils éclatent de rire
   ===================================================================== */
export const S29: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 625, zoom: 1.42 };
  const shakeL = Math.sin(t * 0.6) * 4 * kf(t, [[129, 0], [136, 1]]);
  const shakeR = Math.sin(t * 0.55 + 1) * 4 * kf(t, [[129, 0], [136, 1]]);
  return (
    <g>
      <Salon t={t} id="s29" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={OFF1} at={{ u: 0.62, w: 0.66 }} yaw={0.2} act="cross-arms" face="neutral"
          beats={[{ at: 129, act: 'shrug', face: 'happy' }]} />
        <Prim t={t} who={OFF2} at={{ u: 0.75, w: 0.6 }} yaw={-0.2} act="cross-arms" face="neutral"
          beats={[{ at: 134, act: 'hands-hips', face: 'happy' }]} />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.75} seated act="idle" face="worried"
          beats={[{ at: 91, face: 'shock' }, { at: 151, face: 'dizzy' }]} />
      </Stage0>
      <g transform={`translate(${shakeL} 0)`} />
      <g transform={`translate(${shakeR} 0)`} />
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S30 — close : un rire si profond que le ventre tremble
   ===================================================================== */
export const S30: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1000, y: 615, zoom: 1.85 };
  const amt = kf(t, [[16, 0.2], [45, 1]]);
  const tremble = Math.sin(t * 0.9) * 5 * amt;
  return (
    <g>
      <Salon t={t} id="s30" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={OFF1} at={{ u: 0.62, w: 0.66 }} yaw={0.15} act="hands-hips" face="happy"
          pose={(f: number) => ({ y: -Math.abs(Math.sin(f * 0.28)) * 4 * amt } as any)}
          beats={[{ at: 16, act: 'shrug', face: 'happy' }, { at: 110, act: 'hands-hips', face: 'happy' }, { at: 132, face: 'neutral', act: 'idle' }]} />
      </Stage0>
      <Scrim cam={cam} />
      <g transform={`translate(${tremble} 0)`} />
    </g>
  );
};

/* =====================================================================
   S31 — wide : « j'ai demandé, extrêmement confuse »
   ===================================================================== */
export const S31: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 950, y: 625, zoom: 0.95 };
  return (
    <g>
      <Salon t={t} id="s31" phone={0} />
      <Stage0 t={t} cam={cam}>
        <Prim t={t} who={LUISA} at={{ u: 0.58, w: 0.14 }} yaw={0.2} seated act="idle" face="neutral" />
        <Prim t={t} who={MARC} at={AT_MARC} yaw={0.5} seated act="idle" face="worried" />
        <Prim t={t} who={OFF1} at={{ u: 0.62, w: 0.66 }} yaw={0.1} act="idle" face="happy" beats={[{ at: 104, act: 'explain', face: 'neutral' }]} />
        <Prim t={t} who={OFF2} at={{ u: 0.75, w: 0.6 }} yaw={-0.1} act="idle" face="happy" />
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.6} seated act="question" face="dizzy"
          beats={[{ at: 29, act: 'question', face: 'dizzy' }, { at: 92, act: 'idle', face: 'worried' }, { at: 123, act: 'think', face: 'neutral' }, { at: 144, face: 'shock' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S32 — medium : « la fille à qui il écrivait était sa fille biologique »
   ===================================================================== */
export const S32: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 890, y: 635, zoom: 1.52 };
  return (
    <g>
      <Salon t={t} id="s32" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={NARR} at={AT_NARR} yaw={0.25} seated act="idle" face="neutral"
          beats={[{ at: 6, act: 'think' }, { at: 47, face: 'shock', act: 'idle' }, { at: 81, act: 'question', face: 'worried' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S33 — close : la fille dont l'ex de Marc ne lui avait jamais parlé
   ===================================================================== */
export const S33: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 1030, y: 630, zoom: 1.9 };
  return (
    <g>
      <Salon t={t} id="s33" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.6} seated act="idle" face="worried"
          beats={[{ at: 14, act: 'think', face: 'worried' }, { at: 57, act: 'shrug', face: 'tired' }, { at: 72, act: 'slump', face: 'worried' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S34 — medium : une relation qu'il commençait à construire
   ===================================================================== */
export const S34: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 630, zoom: 1.35 };
  return (
    <g>
      <Salon t={t} id="s34" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.25}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.3} seated act="talk" face="worried" beats={[{ at: 36, act: 'explain' }, { at: 84, act: 'talk', face: 'happy' }]} />
        <Prim t={t} who={OFF1} at={{ u: 0.55, w: 0.66 }} yaw={0.25} act="idle" face="neutral" beats={[{ at: 67, face: 'happy' }]} />
      </Stage0>
      <Scrim cam={cam} />
    </g>
  );
};

/* =====================================================================
   S35 — close : « il le cachait à Luisa parce qu'il ne savait pas comment lui parler »
   ===================================================================== */
export const S35: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 950, y: 620, zoom: 1.85 };
  return (
    <g>
      <Salon t={t} id="s35" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.15}>
        <Prim t={t} who={LUISA} at={{ u: 0.56, w: 0.14 }} yaw={-0.15} seated act="idle" face="neutral"
          beats={[{ at: 29, face: 'shock' }, { at: 67, act: 'shrug', face: 'worried' }, { at: 91, act: 'idle', face: 'tired' }]} />
      </Stage0>
      <Foreground blur={16}>
        <g transform={camT(cam.x, cam.y, cam.zoom)}>
          <rect x={cam.x - 330} y={cam.y + 120} width={660} height={420} fill="#3A2A1E" opacity={0.7} />
        </g>
      </Foreground>
    </g>
  );
};

/* =====================================================================
   S36 — medium : la rencontre, c'était son anniversaire de treize ans
   ===================================================================== */
export const S36: React.FC<ShotProps> = ({ t }) => {
  const cam: Cam = { x: 960, y: 625, zoom: 1.3 };
  const pop = kf(t, [[69, 0], [78, 1]]);
  return (
    <g>
      <Salon t={t} id="s36" phone={0} />
      <Stage0 t={t} cam={cam} focus={0.2}>
        <Prim t={t} who={MARC} at={AT_MARC} yaw={-0.2} seated act="talk" face="happy"
          beats={[{ at: 7, act: 'talk', face: 'smug' }, { at: 31, act: 'explain', face: 'happy' }, { at: 74, act: 'explain', face: 'happy' }]} />
        <Prim t={t} who={LUISA} at={{ u: 0.56, w: 0.14 }} yaw={0.3} seated act="idle" face="worried" beats={[{ at: 74, face: 'happy' }]} />
        <Prim t={t} who={NARR} at={{ u: 0.42, w: 0.5 }} yaw={-0.35} seated act="idle" face="neutral" />
      </Stage0>
      <g transform={camT(cam.x, cam.y, cam.zoom)} opacity={pop}>
        <g transform={`translate(${SALON.P(0.5, 0.36, 0.5).x} ${SALON.P(0.5, 0.36, 0.5).y - 300}) scale(${0.8 + pop * 0.2})`}>
          <rect x={-120} y={-44} width={240} height={64} rx={12} fill="#F6C6D0" stroke="#E7A8B6" strokeWidth={4} />
          <rect x={-120} y={0} width={240} height={20} fill="#E7A8B6" opacity={0.6} />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${-60 + i * 60} -44)`}>
              <rect x={-4} y={-26} width={8} height={26} fill="#FFF4D6" />
              <ellipse cx={0} cy={-32} rx={5} ry={8} fill="#FFD9A0" />
            </g>
          ))}
          <text x={0} y={26} textAnchor="middle" fontSize={34} fill="#7A3B4E" fontFamily="system-ui, sans-serif">13 ans</text>
        </g>
      </g>
      <Scrim cam={cam} />
    </g>
  );
};
