import React from 'react';

// The shapes this file reads from the rig, declared here (not imported) so it compiles against every engine copy:
// older rigs have fewer hairstyles and no `talk`.
type Look = {
  skin: string; skinShade: string; jacket: string; jacketShade: string; accent: string; line: string; face: string; hair: string;
  extra?: string; accessory?: string;
  cast?: { eyeR?: [number, number]; browW?: number; noseK?: number };
};
type Pose = { yaw: number; tilt: number; headTilt: number; expr: string; blink: number; look: number; glasses: number; sway?: number; talk?: number };

// Views of the character. `yaw` is the turn angle of the body, as a number you can read like a compass:
//    0 front · ±0.45 three-quarter · ±1 profile (facing screen-right when > 0) · ±2 seen from behind.
// The front keeps the rig's own head. A three-quarter view adds a nose to it. Profile and back swap in a head drawn
// for that view (the face of the front head cannot be turned into a profile by sliding it), and a back view also
// drops the front details of the jacket. Hair, hats and gear follow the Look's `extra` and `accessory`.

const HEAD = { x: 0, y: -176, r: 62 };
const Y = HEAD.y;

export type View = 'front' | 'three-quarter' | 'profile' | 'back';

/** Which view a yaw is: front under 0.2, three-quarter to 0.72, profile to 1.3, then from behind. */
export const viewOf = (yaw: number): View => {
  const a = Math.abs(yaw);
  return a < 0.2 ? 'front' : a < 0.72 ? 'three-quarter' : a <= 1.3 ? 'profile' : 'back';
};

/** The width-relevant turn: 0 face-on, 1 in profile, and back to 0 as the character turns away (yaw 2 = from behind). */
export const foldYaw = (yaw: number): number => {
  const a = Math.abs(yaw);
  return a <= 1 ? a : Math.max(0, 2 - a);
};

type Ctx = { L: Look; s: 1 | -1; pose: Pose };
const stroke = (L: Look) => ({ stroke: L.line, strokeWidth: 4, strokeLinejoin: 'round' as const });

// ---------------------------------------------------------------------------------------------- hair, profile

/** Hair and hats seen from the side, drawn for a character facing screen-right (the caller mirrors for the left). */
const HairProfile: React.FC<{ L: Look; pose: Pose }> = ({ L, pose }) => {
  const st = stroke(L);
  switch (L.extra) {
    case 'bald':
    case 'hood':
      return null;
    case 'curls':
      return (
        <g>
          {[-165, -140, -115, -90, -65, -40, -15].map((deg, k) => {
            const a = (deg * Math.PI) / 180;
            return <circle key={k} cx={Math.cos(a) * 52 - 4} cy={Y + Math.sin(a) * 52} r={24} fill={L.hair} />;
          })}
        </g>
      );
    case 'afro':
      return <circle cx={-12} cy={Y - 12} r={HEAD.r + 22} fill={L.hair} {...st} />;
    case 'bob':
      return (
        <g>
          <path d={`M 14 ${Y - 66} Q -84 ${Y - 66} -76 ${Y + 38} L -30 ${Y + 38} Q -36 ${Y - 4} 12 ${Y - 40} Z`} fill={L.hair} {...st} />
          <path d={`M -34 ${Y - 58} Q 22 ${Y - 86} 58 ${Y - 30} Q 26 ${Y - 44} -4 ${Y - 28} Z`} fill={L.hair} {...st} />
        </g>
      );
    case 'bunches':
      return (
        <g>
          <circle cx={-58} cy={Y - 28} r={24} fill={L.hair} {...st} />
          <circle cx={-48} cy={Y - 34} r={8} fill={L.accent} />
          <path d={`M -56 ${Y - 18} Q -54 ${Y - 68} 8 ${Y - 66} Q 58 ${Y - 62} 60 ${Y - 24} Q 40 ${Y - 44} 14 ${Y - 38} Q -20 ${Y - 46} -56 ${Y - 18} Z`} fill={L.hair} {...st} />
        </g>
      );
    case 'ponytail':
      return (
        <g>
          <g transform={`rotate(${(pose.sway ?? 0) * 0.6} -50 ${Y - 18})`}>
            <path d={`M -48 ${Y - 24} Q -96 ${Y - 40} -92 ${Y + 20} Q -66 ${Y + 12} -48 ${Y - 8} Z`} fill={L.hair} {...st} />
            <circle cx={-52} cy={Y - 18} r={8} fill={L.accent} />
          </g>
          <path d={`M -58 ${Y - 6} Q -60 ${Y - 68} 6 ${Y - 66} Q 52 ${Y - 62} 56 ${Y - 28} Q 30 ${Y - 48} 6 ${Y - 40} Q -30 ${Y - 40} -58 ${Y - 6} Z`} fill={L.hair} {...st} />
        </g>
      );
    case 'spiky':
      return (
        <path
          d={`M -58 ${Y - 10} L -74 ${Y - 44} L -44 ${Y - 44} L -42 ${Y - 80} L -14 ${Y - 56} L 6 ${Y - 90} L 22 ${Y - 56} L 48 ${Y - 76} L 52 ${Y - 40} Q 10 ${Y - 52} -10 ${Y - 30} Q -34 ${Y - 20} -58 ${Y - 10} Z`}
          fill={L.hair}
          {...st}
        />
      );
    case 'suit':
      return <path d={`M -60 ${Y - 8} Q -66 ${Y - 70} 6 ${Y - 68} Q 60 ${Y - 62} 58 ${Y - 22} Q 36 ${Y - 44} 4 ${Y - 42} Q -34 ${Y - 40} -60 ${Y - 8} Z`} fill={L.hair} {...st} />;
    case 'cap':
      return (
        <g>
          <path d={`M -62 ${Y - 22} A 62 56 0 0 1 62 ${Y - 22} Z`} fill={L.accent} {...st} />
          <path d={`M 24 ${Y - 22} L 100 ${Y - 14} Q 102 ${Y - 4} 28 ${Y - 8} Z`} fill={L.jacket} {...st} />
        </g>
      );
    case 'beanie':
      return (
        <g>
          <path d={`M -62 ${Y - 20} Q -64 ${Y - 76} 0 ${Y - 76} Q 64 ${Y - 76} 62 ${Y - 20} Z`} fill={L.accent} {...st} />
          <rect x={-65} y={Y - 32} width={130} height={18} rx={7} fill={L.jacket} {...st} />
          <circle cx={0} cy={Y - 82} r={12} fill={L.accent} {...st} />
        </g>
      );
    case 'helmet':
      return (
        <g>
          <path d={`M -68 ${Y + 8} A 68 68 0 1 1 68 ${Y + 8} L 54 ${Y + 28} L -54 ${Y + 28} Z`} fill={L.accent} {...st} />
          <path d={`M 8 ${Y - 24} L 64 ${Y - 24} L 64 ${Y + 6} L 8 ${Y + 6} Z`} fill="#1A2639" opacity={0.8} {...st} />
        </g>
      );
    default:
      // Pip's own: a small tuft
      return <path d={`M -6 ${Y - 60} q 10 -26 30 -18 q -16 2 -14 16 q -8 -10 -16 2 Z`} fill={L.hair} />;
  }
};

// ---------------------------------------------------------------------------------------------- head, profile

const eyeShape = (L: Look, pose: Pose, x: number, y: number): React.ReactNode => {
  const e = pose.expr;
  const open = pose.blink >= 0.95 ? 0.08 : e === 'tired' ? 0.5 : e === 'smug' || e === 'cool' ? 0.55 : 1;
  const look = pose.look * 4;
  if (pose.blink >= 0.95) return <path d={`M ${x - 9} ${y + 1} Q ${x} ${y + 7} ${x + 9} ${y + 1}`} stroke={L.face} strokeWidth={5} fill="none" strokeLinecap="round" />;
  if (e === 'happy') return <path d={`M ${x - 9} ${y + 3} Q ${x} ${y - 9} ${x + 9} ${y + 3}`} stroke={L.face} strokeWidth={6} fill="none" strokeLinecap="round" />;
  if (e === 'dizzy') return <path d={`M ${x - 7} ${y - 7} L ${x + 7} ${y + 7} M ${x + 7} ${y - 7} L ${x - 7} ${y + 7}`} stroke={L.face} strokeWidth={5} strokeLinecap="round" />;
  if (e === 'oops') return <path d={`M ${x - 8} ${y - 6} L ${x + 4} ${y} L ${x - 8} ${y + 6}`} stroke={L.face} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  const big = e === 'shock';
  return (
    <g>
      <ellipse cx={x + look} cy={y} rx={big ? 10 : L.cast?.eyeR?.[0] ?? 7} ry={(big ? 12 : L.cast?.eyeR?.[1] ?? 10) * open} fill={L.face} />
      {big ? <circle cx={x + look + 3} cy={y - 4} r={3.2} fill="#fff" /> : null}
      {e === 'smug' || e === 'cool' ? <path d={`M ${x - 12} ${y - 4} L ${x + 11} ${y - 2}`} stroke={L.face} strokeWidth={4} strokeLinecap="round" /> : null}
    </g>
  );
};

const browPath = (e: string, x: number, y: number): string => {
  switch (e) {
    case 'worried':
      return `M ${x - 10} ${y - 8} L ${x + 10} ${y - 16}`;
    case 'shock':
      return `M ${x - 10} ${y - 18} Q ${x} ${y - 26} ${x + 12} ${y - 18}`;
    case 'smug':
      return `M ${x - 10} ${y - 12} L ${x + 12} ${y - 18}`;
    case 'oops':
      return `M ${x - 10} ${y - 10} L ${x + 12} ${y - 6}`;
    case 'tired':
      return `M ${x - 11} ${y - 8} Q ${x} ${y - 12} ${x + 11} ${y - 9}`;
    default:
      return '';
  }
};

const MouthProfile: React.FC<{ L: Look; pose: Pose }> = ({ L, pose }) => {
  const x = 42;
  const y = Y + 38;
  const talk = Math.max(0, Math.min(1, pose.talk ?? 0));
  if (talk > 0.16 && pose.expr !== 'oops')
    return (
      <g>
        <ellipse cx={x} cy={y} rx={6 + talk * 3} ry={3 + talk * 9} fill={L.face} />
        {talk > 0.42 ? <ellipse cx={x} cy={y + 3 + talk * 3} rx={3.5} ry={2.5} fill="#E06A6A" /> : null}
      </g>
    );
  switch (pose.expr) {
    case 'happy':
      return <path d={`M ${x - 12} ${y - 4} Q ${x} ${y + 16} ${x + 8} ${y - 4} Z`} fill={L.face} />;
    case 'shock':
      return <ellipse cx={x + 2} cy={y + 2} rx={7} ry={10} fill={L.face} />;
    case 'worried':
      return <path d={`M ${x - 12} ${y + 4} Q ${x - 4} ${y - 4} ${x + 2} ${y + 3} Q ${x + 8} ${y + 10} ${x + 12} ${y + 2}`} stroke={L.face} strokeWidth={4.5} fill="none" strokeLinecap="round" />;
    case 'smug':
    case 'cool':
      return <path d={`M ${x - 12} ${y + 3} Q ${x} ${y + 8} ${x + 10} ${y - 5}`} stroke={L.face} strokeWidth={4.5} fill="none" strokeLinecap="round" />;
    default:
      return <path d={`M ${x - 12} ${y} Q ${x} ${y + 4} ${x + 9} ${y}`} stroke={L.face} strokeWidth={4.5} fill="none" strokeLinecap="round" />;
  }
};

/** A head in profile facing screen-right: skull, nose, ear, one eye, mouth, hair and gear. */
const ProfileHead: React.FC<Ctx> = ({ L, pose }) => {
  const st = stroke(L);
  const ex = 32;
  const ey = Y - 8;
  const hairBehind = L.extra === 'afro' || L.extra === 'ponytail';
  return (
    <g>
      {hairBehind ? <HairProfile L={L} pose={pose} /> : null}
      <circle cx={0} cy={Y} r={HEAD.r} fill={L.skin} {...st} />
      <path d={`M -4 ${Y + 60} A ${HEAD.r} ${HEAD.r} 0 0 0 -58 ${Y + 20} A 70 70 0 0 1 -4 ${Y + 60} Z`} fill={L.skinShade} />
      {/* the nose, in front of the skull */}
      <g transform={`translate(57 ${Y + 6}) scale(${L.cast?.noseK ?? 1}) translate(-57 ${-(Y + 6)})`}>
        <path d={`M 54 ${Y - 8} Q 92 ${Y + 6} 54 ${Y + 20} Z`} fill={L.skin} />
        <path d={`M 57 ${Y - 8} Q 92 ${Y + 6} 57 ${Y + 20}`} fill="none" {...st} />
      </g>
      {/* the ear */}
      <ellipse cx={-12} cy={Y + 10} rx={8} ry={12} fill={L.skinShade} {...st} strokeWidth={3.5} />
      <path d={`M -14 ${Y + 4} Q -8 ${Y + 10} -13 ${Y + 17}`} stroke={L.line} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.6} />
      {hairBehind ? null : <HairProfile L={L} pose={pose} />}
      {browPath(pose.expr, ex, ey) ? <path d={browPath(pose.expr, ex, ey)} stroke={L.face} strokeWidth={L.cast?.browW ?? 5} fill="none" strokeLinecap="round" /> : null}
      {eyeShape(L, pose, ex, ey)}
      <MouthProfile L={L} pose={pose} />
      {L.accessory === 'beard' ? <path d={`M 4 ${Y + 20} Q 6 ${Y + 64} 44 ${Y + 62} Q 62 ${Y + 56} 60 ${Y + 28} Q 40 ${Y + 38} 20 ${Y + 34} Z`} fill={L.hair} opacity={0.92} /> : null}
      {L.accessory === 'mustache' ? <path d={`M 50 ${Y + 22} Q 66 ${Y + 14} 74 ${Y + 24} Q 62 ${Y + 28} 50 ${Y + 26} Z`} fill={L.hair} /> : null}
      {L.accessory === 'glasses' || pose.glasses > 0.5 ? (
        <g>
          <circle cx={ex + 2} cy={ey} r={15} fill="#0D0F1C" opacity={0.85} stroke={L.face} strokeWidth={4} />
          <path d={`M ${ex - 13} ${ey - 2} L -14 ${Y - 4}`} stroke={L.face} strokeWidth={4} strokeLinecap="round" />
          <path d={`M ${ex - 6} ${ey + 6} L ${ex + 6} ${ey - 8}`} stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
        </g>
      ) : null}
      {L.accessory === 'headphones' || L.accessory === 'headset' ? (
        <g>
          <path d={`M -10 ${Y - 4} A 66 66 0 0 1 54 ${Y - 40}`} stroke={L.accent} strokeWidth={9} fill="none" strokeLinecap="round" />
          <rect x={-22} y={Y - 12} width={24} height={40} rx={10} fill={L.accent} {...st} />
          {L.accessory === 'headset' ? (
            <g>
              <path d={`M -10 ${Y + 28} Q 20 ${Y + 52} 50 ${Y + 40}`} stroke={L.line} strokeWidth={5} fill="none" strokeLinecap="round" />
              <circle cx={52} cy={Y + 40} r={6} fill={L.accent} stroke={L.line} strokeWidth={3} />
            </g>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};

// ---------------------------------------------------------------------------------------------- head, back

/** The back of a head: ears at the sides, hair or hat over the whole skull. No face. */
const BackHead: React.FC<Ctx> = ({ L, pose }) => {
  const st = stroke(L);
  const hair = L.extra === 'hood' ? L.jacket : L.hair;
  const bowl = `M -60 ${Y + 16} A 62 62 0 1 1 60 ${Y + 16} Q 40 ${Y + 46} 0 ${Y + 48} Q -40 ${Y + 46} -60 ${Y + 16} Z`;
  const ears = (
    <g>
      <circle cx={-61} cy={Y + 8} r={11} fill={L.skin} {...st} />
      <circle cx={61} cy={Y + 8} r={11} fill={L.skin} {...st} />
    </g>
  );
  const skull = <circle cx={0} cy={Y} r={HEAD.r} fill={L.skin} {...st} />;
  const body = (() => {
    switch (L.extra) {
      case 'bald':
        return <g>{ears}{skull}</g>;
      case 'suit':
        return <g>{ears}<path d={bowl} fill={hair} {...st} /></g>;
      case 'afro':
        return <g>{ears}<circle cx={0} cy={Y - 10} r={HEAD.r + 22} fill={hair} {...st} /></g>;
      case 'curls':
        return (
          <g>
            {ears}
            <path d={bowl} fill={hair} {...st} />
            {[-160, -130, -100, -70, -40, -10, 20, 160, 190].map((deg, k) => {
              const a = (deg * Math.PI) / 180;
              return <circle key={k} cx={Math.cos(a) * 54} cy={Y + Math.sin(a) * 50} r={22} fill={hair} />;
            })}
          </g>
        );
      case 'bob':
        return (
          <g>
            <path d={`M -76 ${Y + 38} Q -88 ${Y - 74} 0 ${Y - 76} Q 88 ${Y - 74} 76 ${Y + 38} Q 38 ${Y + 54} 0 ${Y + 52} Q -38 ${Y + 54} -76 ${Y + 38} Z`} fill={hair} {...st} />
          </g>
        );
      case 'bunches':
        return (
          <g>
            {ears}
            {[-1, 1].map((sd) => (
              <g key={sd}>
                <circle cx={sd * 72} cy={Y - 24} r={24} fill={hair} {...st} />
                <circle cx={sd * 55} cy={Y - 30} r={8} fill={L.accent} />
              </g>
            ))}
            <path d={bowl} fill={hair} {...st} />
          </g>
        );
      case 'ponytail':
        return (
          <g>
            {ears}
            <path d={`M -14 ${Y - 30} Q -34 ${Y + 26} -8 ${Y + 74} Q 16 ${Y + 26} 14 ${Y - 30} Z`} fill={hair} {...st} />
            <path d={bowl} fill={hair} {...st} />
            <circle cx={0} cy={Y - 20} r={8} fill={L.accent} />
          </g>
        );
      case 'spiky':
        return (
          <g>
            {ears}
            <path d={bowl} fill={hair} {...st} />
            <path d={`M -60 ${Y - 24} L -72 ${Y - 58} L -40 ${Y - 52} L -30 ${Y - 88} L -2 ${Y - 62} L 22 ${Y - 90} L 32 ${Y - 56} L 62 ${Y - 70} L 58 ${Y - 24} Z`} fill={hair} {...st} />
          </g>
        );
      case 'cap':
        return (
          <g>
            {ears}
            <path d={bowl} fill={hair} {...st} />
            <path d={`M -62 ${Y - 20} A 62 58 0 0 1 62 ${Y - 20} Z`} fill={L.accent} {...st} />
            <rect x={-26} y={Y - 22} width={52} height={12} rx={3} fill={L.jacket} {...st} />
          </g>
        );
      case 'beanie':
        return (
          <g>
            {ears}
            <path d={bowl} fill={hair} {...st} />
            <path d={`M -62 ${Y - 20} Q -64 ${Y - 76} 0 ${Y - 76} Q 64 ${Y - 76} 62 ${Y - 20} Z`} fill={L.accent} {...st} />
            <rect x={-65} y={Y - 32} width={130} height={18} rx={7} fill={L.jacket} {...st} />
            <circle cx={0} cy={Y - 82} r={12} fill={L.accent} {...st} />
          </g>
        );
      case 'helmet':
        return (
          <g>
            {ears}
            <path d={`M -68 ${Y + 14} A 68 68 0 1 1 68 ${Y + 14} L 56 ${Y + 36} L -56 ${Y + 36} Z`} fill={L.accent} {...st} />
            <path d={`M -30 ${Y - 36} L 30 ${Y - 36} M -34 ${Y - 14} L 34 ${Y - 14}`} stroke={L.line} strokeWidth={4} strokeLinecap="round" />
          </g>
        );
      default:
        return (
          <g>
            {ears}
            <path d={bowl} fill={hair} {...st} />
            <path d={`M -6 ${Y - 60} q 10 -26 30 -18 q -16 2 -14 16 q -8 -10 -16 2 Z`} fill={hair} />
          </g>
        );
    }
  })();
  return (
    <g>
      {body}
      {L.accessory === 'headphones' || L.accessory === 'headset' ? (
        <g>
          <path d={`M -62 ${Y - 4} A 64 64 0 0 1 62 ${Y - 4}`} stroke={L.accent} strokeWidth={9} fill="none" strokeLinecap="round" />
          <rect x={-74} y={Y - 20} width={20} height={38} rx={9} fill={L.accent} {...st} />
          <rect x={54} y={Y - 20} width={20} height={38} rx={9} fill={L.accent} {...st} />
        </g>
      ) : null}
      {L.accessory === 'glasses' ? <path d={`M -62 ${Y - 4} L -50 ${Y - 6} M 62 ${Y - 4} L 50 ${Y - 6}`} stroke={L.face} strokeWidth={4} strokeLinecap="round" /> : null}
    </g>
  );
};

// ---------------------------------------------------------------------------------------------- three-quarter

/** A nose on the front head when it turns (the face has slid toward the side it faces). */
const Nose: React.FC<{ L: Look; yaw: number }> = ({ L, yaw }) => {
  const s = yaw > 0 ? 1 : -1;
  const a = Math.min(1, Math.abs(yaw) / 0.7);
  const x = yaw * 36 + s * 6;
  const y = Y + 10;
  const len = (7 + a * 11) * (L.cast?.noseK ?? 1);
  return <path d={`M ${x} ${y - 8} Q ${x + s * len} ${y + 2} ${x + s * 2} ${y + 8}`} stroke={L.line} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
};

// ---------------------------------------------------------------------------------------------- the pieces Hero uses

/** The head for a pose: the rig's own `head` in front and three-quarter views, a drawn profile or back head otherwise. */
export const ViewHead: React.FC<{ pose: Pose; L: Look; head: React.ReactNode; headGear?: React.ReactNode }> = ({ pose, L, head, headGear }) => {
  const v = viewOf(pose.yaw);
  if (v === 'front') return <>{head}</>;
  const T = `rotate(${pose.tilt}) rotate(${pose.headTilt} 0 ${Y + 40})`;
  if (v === 'three-quarter')
    return (
      <>
        {head}
        <g transform={T}>
          <Nose L={L} yaw={pose.yaw} />
        </g>
      </>
    );
  const s: 1 | -1 = pose.yaw > 0 ? 1 : -1;
  return (
    <g transform={T}>
      <g transform={s < 0 ? 'scale(-1 1)' : undefined}>{v === 'profile' ? <ProfileHead L={L} s={s} pose={pose} /> : <BackHead L={L} s={s} pose={pose} />}</g>
      {headGear}
    </g>
  );
};

/** The jacket: unchanged except from behind, where the collar, zip and tie of the front are not there. */
export const ViewTorso: React.FC<{ pose: Pose; L: Look; torso: React.ReactNode }> = ({ pose, L, torso }) => {
  if (viewOf(pose.yaw) !== 'back') return <>{torso}</>;
  const kw = 1 - 0.4 * foldYaw(pose.yaw);
  return (
    <g transform={`rotate(${pose.tilt}) scale(${kw} 1)`}>
      <path d="M -46 -112 Q 0 -124 46 -112 L 40 2 Q 0 12 -40 2 Z" fill={L.jacket} stroke={L.line} strokeWidth={4} strokeLinejoin="round" />
      <path d="M 10 -116 Q 30 -114 46 -112 L 40 2 Q 26 8 12 9 Z" fill={L.jacketShade} opacity={0.55} />
      <path d="M 0 -108 L 0 4" stroke={L.jacketShade} strokeWidth={3} opacity={0.7} />
    </g>
  );
};
