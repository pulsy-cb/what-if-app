import type { Body, BodyId } from './person';

// Build a character in one line: cast({ seed: 'lou', body: 'teen', hair: 'long', outfit: ['hoodie:rose', 'jeans'] }).
// Choices are names, never sliders. Anything not given is filled from `seed`, the same way every time, so a short line
// still gives a varied character. A colour is one of COLORS or a hex value ('hoodie:#E05780').

export const HAIR_NEW = ['long', 'braids', 'bun', 'buzz', 'sidepart', 'wavy', 'fringe', 'mohawk', 'dreads', 'hijab', 'braided-bun', 'shag'] as const;
export const HAIR_RIG = ['tuft', 'curls', 'bunches', 'bob', 'suit', 'cap', 'beanie', 'spiky', 'afro', 'ponytail', 'bald', 'helmet', 'hood'] as const;
export type HairStyle = (typeof HAIR_NEW)[number] | (typeof HAIR_RIG)[number];

export type FaceSpec = {
  eyes: 'round' | 'almond' | 'sleepy' | 'wide';
  brows: 'none' | 'thin' | 'thick' | 'arched';
  nose: 'none' | 'button' | 'long' | 'wide';
  marks: 'none' | 'freckles' | 'mole' | 'blush' | 'dimples' | 'wrinkles';
  facial: 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';
};

export const SKINS = { porcelain: '#F6EFE3', peach: '#F2C9A8', sand: '#E8B58C', tan: '#D89B72', bronze: '#C68A5B', brown: '#8D5A3B', deep: '#5C3A28' };
const SKIN_MAP: Record<string, string> = { ...SKINS, fair: '#F6EFE3', light: '#F2C9A8', olive: '#D8AD84', medium: '#D89B72', caramel: '#C68A5B', warm: '#C68A5B', dark: '#5C3A28' };
export const HAIR_COLORS = { black: '#1E1418', brown: '#3A2A20', chestnut: '#5B3A24', auburn: '#7A3E1E', blond: '#C9A25A', red: '#A8482A', grey: '#A9A6A2', white: '#E6E3DC' };
const HAIR_COLOR_MAP: Record<string, string> = { ...HAIR_COLORS, blonde: '#C9A25A', ginger: '#A8482A', gray: '#A9A6A2' };
export const COLORS: Record<string, string> = {
  rose: '#E05780', navy: '#274472', teal: '#2A9D8F', mustard: '#D9A404', plum: '#5A3E68', olive: '#5E6E46', coral: '#F2545B', sky: '#6FA8DC',
  red: '#B0352E', green: '#3E8C5A', black: '#23232B', grey: '#7C8493', white: '#EDE8DE', cream: '#EFE2CC', denim: '#3E5F8A', khaki: '#B59B6A', brown: '#6A4A34',
};

const SLOTS: Record<string, 'top' | 'over' | 'legs' | 'feet' | 'neck' | 'back'> = {
  tshirt: 'top', shirt: 'top', hoodie: 'top', sweater: 'top',
  blazer: 'over', labcoat: 'over', apron: 'over', coat: 'over',
  jeans: 'legs', pants: 'legs', shorts: 'legs', skirt: 'legs', joggers: 'legs', cargo: 'legs',
  dress: 'top',
  sneakers: 'feet', boots: 'feet', formal: 'feet',
  tie: 'neck', scarf: 'neck',
  backpack: 'back',
};

/** accent: a second colour after a +, e.g. 'joggers:green+mustard' (the side stripe) */
export type Garment = { id: string; color: string; shade: string; accent?: string };
export type CastData = {
  body?: Body | BodyId;
  hairStyle: string;
  /** true when hair.tsx draws the hair (the rig's own head then stays bald) */
  newHair: boolean;
  face: FaceSpec;
  eyeR?: [number, number];
  browW?: number;
  noseK?: number;
  top: Garment;
  over?: Garment;
  legs: Garment;
  feet: Garment;
  neck?: Garment;
  back?: Garment;
  eyewear?: 'round' | 'square' | 'sun';
  /** iris colours, left eye then right eye on screen; two different ones for heterochromia */
  iris?: [string, string];
  /** a short word printed on the chest of the top ('her') */
  print?: { text: string; color: string };
  earrings?: boolean;
  headband?: string;
};
export type CastSpec = {
  /** fills everything not given, reproducibly; use the character's name */
  seed?: string;
  body?: Body | BodyId;
  /** biases what the seed picks: hair and facial hair */
  kind?: 'fem' | 'masc' | 'any';
  skin?: keyof typeof SKINS | string;
  hair?: HairStyle | { style?: HairStyle; color?: keyof typeof HAIR_COLORS | string };
  hairColor?: keyof typeof HAIR_COLORS | string;
  face?: Partial<FaceSpec>;
  /** garments by name, optionally coloured: 'hoodie:rose', 'jeans', 'sneakers', 'tie:red', 'backpack:teal' */
  outfit?: string[];
  /** 'glasses:round' | 'glasses:square' | 'glasses:sun' | 'earrings' | 'headband:teal' | 'headphones' | 'headset' */
  acc?: string[];
  /** eye colour: blue green brown hazel grey amber or a hex; two for heterochromia ['blue', 'green'] */
  eyes?: string | [string, string];
  /** a short word on the chest of the top, and its colour: { text: 'her', color: 'coral' } */
  print?: { text: string; color?: string };
  /** start from a type of character (see CAST_TYPES); everything given here wins over it */
  as?: CastType;
};
export type Character = {
  skin: string; skinShade: string; hand: string; jacket: string; jacketShade: string; accent: string; limb: string; line: string;
  shoe: string; face: string; hair: string; extra?: string; accessory?: string;
  cast: CastData;
};

const INK = '#1D2033';
const shadeOf = (hex: string, k = 0.8): string => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};
const colorOf = (name: string | undefined, table: Record<string, string>, fallback: string): string => {
  if (!name) return fallback;
  if (name.startsWith('#')) return name;
  return table[name] ?? table[name.toLowerCase()] ?? (fallback.startsWith('#') ? fallback : '#D89B72');
};

/** A small seeded generator: the same seed gives the same character. Every draw is taken in a fixed order. */
const rngOf = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const EYES: Record<FaceSpec['eyes'], [number, number] | undefined> = { round: undefined, almond: [9, 7], sleepy: [7.5, 6], wide: [9, 12] };
const BROW_W: Record<FaceSpec['brows'], number | undefined> = { none: undefined, thin: 3.5, thick: 8, arched: undefined };
const NOSE_K: Record<FaceSpec['nose'], number | undefined> = { none: undefined, button: 0.7, long: 1.4, wide: 1.2 };

const HAIR_POOL: Record<NonNullable<CastSpec['kind']>, HairStyle[]> = {
  fem: ['long', 'braided-bun', 'shag', 'bob', 'ponytail', 'bun', 'braids', 'wavy', 'fringe', 'curls', 'bunches'],
  masc: ['sidepart', 'buzz', 'spiky', 'suit', 'curls', 'dreads', 'afro', 'wavy'],
  any: ['long', 'bob', 'ponytail', 'bun', 'wavy', 'fringe', 'curls', 'sidepart', 'buzz', 'spiky', 'suit', 'afro', 'dreads'],
};

export const EYE_COLORS: Record<string, string> = { blue: '#4E9BE0', green: '#3E9C5A', brown: '#6A4A34', hazel: '#8A6A3A', grey: '#8A96A4', amber: '#C98A2E' };

/** Characters that come back from story to story: start from one with cast({ as: 'mother', seed: 'mum' }) and change what you need. */
export const CAST_TYPES = {
  /** the channel's lead: copper braided bun, freckles, one blue eye and one green, white tee and green joggers with a yellow stripe */
  heroine: { body: 'adult', kind: 'fem', skin: 'porcelain', hair: { style: 'braided-bun', color: '#C8642E' }, eyes: ['blue', 'green'], face: { marks: 'freckles', brows: 'thin' },
    outfit: ['tshirt:white', 'joggers:green+mustard', 'sneakers:#F2C94C'], print: { text: 'her', color: 'coral' } },
  mother: { body: 'adult', kind: 'fem', hair: 'bob', outfit: ['sweater:plum', 'pants:grey', 'formal:brown'], face: { marks: 'wrinkles' } },
  father: { body: 'adult', kind: 'masc', hair: 'sidepart', outfit: ['shirt:sky', 'pants:khaki', 'formal:brown'], face: { facial: 'stubble' } },
  brother: { body: 'teen', kind: 'masc', hair: 'spiky', outfit: ['hoodie:navy', 'jeans', 'sneakers:white'] },
  sister: { body: 'teen', kind: 'fem', hair: 'ponytail', outfit: ['tshirt:rose', 'jeans', 'sneakers:white'] },
  friend: { body: 'adult', kind: 'any', hair: 'wavy', outfit: ['sweater:mustard', 'jeans', 'sneakers:white'] },
  police: { body: 'adult', kind: 'any', hair: { style: 'cap', color: '#1E2A44' }, outfit: ['shirt:navy', 'pants:navy', 'boots:black', 'tie:black'] },
  doctor: { body: 'adult', kind: 'any', hair: 'sidepart', outfit: ['shirt:sky', 'labcoat', 'pants:grey', 'formal:black'], acc: ['glasses:square'] },
  nurse: { body: 'adult', kind: 'fem', hair: 'bun', outfit: ['shirt:teal', 'pants:teal', 'sneakers:white'] },
  waiter: { body: 'adult', kind: 'masc', hair: 'suit', outfit: ['shirt:white', 'apron:black', 'pants:black', 'formal:black'] },
  teacher: { body: 'adult', kind: 'any', hair: 'sidepart', outfit: ['shirt:cream', 'blazer:brown', 'pants:navy', 'formal:brown'], acc: ['glasses:round'] },
  bride: { body: 'adult', kind: 'fem', hair: 'braided-bun', outfit: ['dress:white', 'formal:white'], acc: ['earrings'] },
  groom: { body: 'adult', kind: 'masc', hair: 'sidepart', outfit: ['shirt:white', 'blazer:black', 'pants:black', 'tie:black', 'formal:black'] },
  boss: { body: 'adult', kind: 'any', hair: 'suit', outfit: ['shirt:white', 'blazer:grey', 'pants:grey', 'tie:red', 'formal:black'] },
} satisfies Record<string, CastSpec>;
export type CastType = keyof typeof CAST_TYPES;

export const cast = (input: CastSpec = {}): Character => {
  if (input.as && !(input.as in CAST_TYPES)) throw new Error(`cast: unknown type "${input.as}" (known: ${Object.keys(CAST_TYPES).join(', ')})`);
  const preset = (input.as ? CAST_TYPES[input.as] : {}) as CastSpec;
  // what is given wins over the type; face fields merge, the outfit is replaced only when given
  const spec: CastSpec = { ...preset, ...input, face: { ...(preset.face ?? {}), ...(input.face ?? {}) } };
  const r = rngOf(spec.seed ?? 'cast');
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const kind = spec.kind ?? 'any';
  const seeded = {
    skin: pick(Object.keys(SKINS)),
    hairStyle: pick(HAIR_POOL[kind]),
    hairColor: pick(Object.keys(HAIR_COLORS).slice(0, 6)),
    eyes: pick(['round', 'round', 'almond', 'sleepy', 'wide'] as FaceSpec['eyes'][]),
    brows: pick(['none', 'thin', 'thick', 'arched'] as FaceSpec['brows'][]),
    nose: pick(['none', 'none', 'button', 'long', 'wide'] as FaceSpec['nose'][]),
    marks: pick(['none', 'none', 'freckles', 'mole', 'blush', 'dimples'] as FaceSpec['marks'][]),
    facial: pick(['none', 'none', 'stubble', 'mustache', 'goatee', 'beard'] as FaceSpec['facial'][]),
    top: pick(['tshirt', 'hoodie', 'shirt', 'sweater']),
    topColor: pick(['rose', 'navy', 'teal', 'mustard', 'plum', 'olive', 'coral', 'sky', 'green']),
    legs: pick(['jeans', 'pants', 'pants']),
    legsColor: pick(['denim', 'black', 'khaki', 'grey', 'navy']),
    feetColor: pick(['#2FB7A6', '#F2545B', 'white', 'black', 'mustard']),
    accent: pick(['cream', 'mustard', 'coral', 'sky', 'white']),
  };

  const worn: Partial<Record<'top' | 'over' | 'legs' | 'feet' | 'neck' | 'back', Garment>> = {};
  for (const item of spec.outfit ?? []) {
    const [id, colors] = item.split(':') as [string, string | undefined];
    const [color, accentName] = (colors ?? '').split('+') as [string, string | undefined];
    const slot = SLOTS[id];
    if (!slot) throw new Error(`cast: unknown garment "${id}" (known: ${Object.keys(SLOTS).join(', ')}); draw your own with torsoGear`);
    const fallback =
      slot === 'over' ? (id === 'labcoat' ? COLORS.white! : COLORS.navy!)
      : slot === 'neck' ? COLORS.red!
      : slot === 'top' ? colorOf(seeded.topColor, COLORS, COLORS.teal!)
      : slot === 'legs' ? (id === 'jeans' ? COLORS.denim! : colorOf(seeded.legsColor, COLORS, COLORS.grey!))
      : slot === 'feet' ? colorOf(seeded.feetColor, COLORS, seeded.feetColor)
      : COLORS.teal!;
    const hex = colorOf(color || undefined, COLORS, fallback);
    worn[slot] = { id, color: hex, shade: shadeOf(hex), ...(accentName ? { accent: colorOf(accentName, COLORS, COLORS.mustard!) } : id === 'joggers' ? { accent: COLORS.white! } : {}) };
    // a dress is the top and the skirt at once, down to the ankles
    if (id === 'dress' && !worn.legs) worn.legs = { id: 'dress', color: hex, shade: shadeOf(hex) };
  }
  const garment = (id: string, name: string): Garment => {
    const hex = colorOf(name, COLORS, name);
    return { id, color: hex, shade: shadeOf(hex) };
  };
  const top = worn.top ?? garment(seeded.top, seeded.topColor);
  const legs = worn.legs ?? garment(seeded.legs, seeded.legsColor);
  const feet = worn.feet ?? garment('sneakers', seeded.feetColor);

  const hairSpec = typeof spec.hair === 'string' ? { style: spec.hair, color: spec.hairColor } : { color: spec.hairColor, ...(spec.hair ?? {}) };
  const hairStyle = hairSpec.style ?? seeded.hairStyle;
  const hair = colorOf(hairSpec.color ?? seeded.hairColor, HAIR_COLOR_MAP, HAIR_COLORS.brown);
  const newHair = (HAIR_NEW as readonly string[]).includes(hairStyle);

  const youngOrFem = kind === 'fem' || spec.body === 'teen';
  const face: FaceSpec = {
    eyes: spec.face?.eyes ?? seeded.eyes,
    brows: spec.face?.brows ?? seeded.brows,
    nose: spec.face?.nose ?? seeded.nose,
    marks: spec.face?.marks ?? seeded.marks,
    facial: spec.face?.facial ?? (youngOrFem || kind === 'any' ? 'none' : seeded.facial),
  };

  let eyewear: CastData['eyewear'];
  let earrings = false;
  let headband: string | undefined;
  let accessory = 'none';
  for (const item of spec.acc ?? []) {
    const [id, opt] = item.split(':') as [string, string | undefined];
    if (id === 'glasses') eyewear = opt === 'square' || opt === 'sun' ? opt : 'round';
    else if (id === 'earrings') earrings = true;
    else if (id === 'headband') headband = colorOf(opt, COLORS, COLORS.coral!);
    else if (id === 'headphones' || id === 'headset') accessory = id;
    else throw new Error(`cast: unknown accessory "${id}" (known: glasses, earrings, headband, headphones, headset); use headGear for your own`);
  }

  const eyeOf = (n: string) => colorOf(n, EYE_COLORS, EYE_COLORS.brown!);
  const iris: [string, string] | undefined = spec.eyes === undefined ? undefined : typeof spec.eyes === 'string' ? [eyeOf(spec.eyes), eyeOf(spec.eyes)] : [eyeOf(spec.eyes[0]), eyeOf(spec.eyes[1])];
  const print = spec.print ? { text: String(spec.print.text).slice(0, 6), color: colorOf(spec.print.color, COLORS, COLORS.coral!) } : undefined;
  const skin = colorOf(spec.skin ?? seeded.skin, SKIN_MAP, SKINS.peach);
  return {
    skin,
    skinShade: shadeOf(skin, 0.9),
    hand: skin,
    jacket: top.color,
    jacketShade: top.shade,
    accent: colorOf(seeded.accent, COLORS, COLORS.cream!),
    limb: skin,
    line: INK,
    shoe: feet.color,
    face: INK,
    hair,
    extra: newHair ? 'bald' : hairStyle === 'tuft' ? undefined : hairStyle,
    accessory,
    cast: {
      body: spec.body,
      hairStyle,
      newHair,
      face,
      eyeR: EYES[face.eyes],
      browW: BROW_W[face.brows],
      noseK: NOSE_K[face.nose],
      top,
      over: worn.over,
      legs,
      feet,
      neck: worn.neck,
      back: worn.back,
      eyewear,
      iris,
      print,
      earrings,
      headband,
    },
  };
};
