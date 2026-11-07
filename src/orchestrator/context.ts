import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart } from './providers/types.js';
import type { MessageRow } from './db.js';
import { readText, walk } from '../tools/paths.js';
import { engineDigest } from './engine-digest.js';

export const SYSTEM_PROMPT = `You are the studio agent of "What If", a short-animation pipeline (15–25 s, 16:9 1920x1080 or 9:16 1080x1920 @ 30fps, SVG + Remotion).

You work inside ONE project folder (the studio) and you change it with tools. You never print shell
commands for a human to paste: you call the tools.

## The pipeline (this order is the product)
0. Source. Most of the time the user only gives you a video id from the local "nouveau" app (a YouTube
   video id, or a TikTok id). whatif_new { episode, video } scaffolds the project with that source, then
   whatif_run source runs the import: English transcript (Deepgram) -> 2 French *narration* proposals
   (via the local API) -> the chosen one is saved in out/<episode>/source.fr.md, and the proposal/TTS
   stay attached to that video id so the user can follow everything in the nouveau UI. Read that file,
   then write the 15–25 s episode script yourself: it is a condensation, not a translation.
   Budget: ElevenLabs v4 at speed 1.0 reads ~3.4 French words/second, so 15-25 s means **50-60 words
   total**, not 30 (too short) and not 80 (too long). whatif_run voice reports the measured duration and
   words count: if it lands outside 15-25 s, rewrite and stream voice again (the take is cached by text).
1. episode.json — the 7-beat What If formula:
   - 3 escalating cold-open demos (1 small/selfish, 2 useful, 3 uncanny),
   - beat 2: the premise (title card),
   - beat 4: the turn (one real, worked-out fact with a number, documented in \`science: [{ claim, working, source }]\`),
   - beats 5-7 folded into a closing question.
   **Language rule**: when the narration is in French, both \`title\` (e.g. \`["ET SI TU POUVAIS", "… ?"]\`)
   and beat 2 (\`"Et si tu pouvais … ?"\`) MUST be in French — never mix English \`"WHAT IF YOU COULD"\`
   inside a French narration.
   **Location rule (\`set\`)**: set \`"defaultSet"\` on \`episode.json\` and/or \`"set"\` on each beat in \`script\` to match
   where the story actually takes place (\`"bedroom"\`, \`"study"\`, \`"vehicle"\`, \`"outdoor"\`, \`"rooftop"\`, \`"stairwell"\`,
   \`"kitchen"\`, \`"classroom"\`, or a custom room). Never use \`"classroom"\` unless the story is about school, and never
   use \`"kitchen"\` unless the story is about food/kitchen.
2. whatif_run voice — **ElevenLabs TTS by default** (\`provider: "elevenlabs"\`, model \`"eleven_v4"\`, voices Hugo \`"3Tp5mYhT9wrfnry9pzvV"\` or Léa \`"KSyQzmsYhFbuOhqj1Xxv"\`) through the local \`:8005\` TTS API (\`POST /api/videos/<videoId>/tts/elevenlabs\`), on the same
   video id (Fish Audio remains available with \`provider: "fish"\`). It writes \`public/<episode>/voice.wav\` and \`src/episodes/<episode>/words.json\`: the script's
   words with the *measured* Deepgram times (any \`[audio tags]\` like \`[whispers]\` or \`[excited]\` are sent to ElevenLabs v4 and automatically stripped from \`words.json\`).
3. whatif_run shotlist — cuts the measured words into **9 to 14 clause-aligned shots** (>= 27 cuts/min,
   no shot over ~2.7 s), keeps coherent story locations while varying camera framing (\`wide\`, \`medium\`, \`close\`,
   \`insert\`, \`low angle\`), and seeds \`fx\` and \`sound\` (from the studio's 40 cached \`library/sfx/\` clips).
4. whatif_run plan — turns episode.json.edit into timeline.json (schema 2: total, segments{a,b,t0,t1,shot,look},
   shots, fx, audio). Each edit entry is {"shot": "S2", "at": "<cue>"} and a cue is one of:
     f:120          an absolute frame            s:4.2      seconds
     S1+2 / S1#2+2  2 frames after shot S1 (or after its 2nd segment; S1-4 is before it)
     franchir / franchir+3 / le#2-2   a *word of the script as measured in words.json*, optionally its
                    nth occurrence after the previous cut and an offset. There is **no "w:" prefix**:
                    "w:franchir" is a bad cue and plan.py fails. Cues must be in increasing time order.
5. Write & Animate \`shots.tsx\` + \`index.tsx\`, then run \`whatif_run stills\` and \`whatif_run board\`:
   - Export one component per shot id in \`timeline.json\` (\`S1\`, \`S2\`, …) and register ALL of them in
     \`src/episodes/<slug>/index.tsx\`.
   - **Custom Characters (\`makeLook\` + open SVG slots)**: design custom looks at the top of \`shots.tsx\` with \`makeLook({ skin, jacket, accent, hair, extra, accessory }, base)\`
     so the characters' clothes, hair/hats (\`extra: 'hood' | 'curls' | 'bunches' | 'bob' | 'suit' | 'cap' | 'beanie' | 'spiky' | 'afro' | 'ponytail' | 'bald' | 'helmet'\`)
     and accessories (\`accessory: 'headphones' | 'headset' | 'glasses' | 'beard' | 'mustache' | 'scarf' | 'tie' | 'badge'\`) fit the episode's cast.
     When a character needs ANY accessory, hat, outfit detail or held prop NOT in that list, pass custom SVG to \`<Hero>\` via:
     - \`headGear={<g>...</g>}\` (attached to the head around \`(0, -176)\`, r=62: crowns, chef hats, VR visors, bandages, masks, cat ears…),
     - \`torsoGear={<g>...</g>}\` (attached to the torso around \`(-46..46, -112..2)\`: capes, aprons, armor, stethoscopes, logos…),
     - \`handRProp={<g>...</g>}\` / \`handLProp={<g>...</g>}\` (attached to the right/left hand at \`(0, 0)\`: controllers, microphones, tools, phones, wands…).
   - **Coherent & Open Sets (Indoor, Outdoor, Vehicle, or 100% Custom SVG Sets)**:
     - **Indoor**: use \`<Bedroom>\`, \`<Study>\`, \`<Kitchen>\`, \`<Classroom>\`, \`<Stairwell>\`, OR build any custom interior (lab, hospital, cinema, store, cockpit, bunker…) with \`<CustomRoom r={STUDY} t={t} wall="#..." night>{/* custom SVG furniture & Box/Desk/MonitorSetup */}</CustomRoom>\`.
     - **Outdoor**: use \`<Outdoor kind="street" | "park" | "road" | "nature" t={t} night={...} />\` (with \`stand(OUTDOOR, u, w)\`, \`<Tree>\`, \`<StreetLamp>\`, \`<CarExterior>\`) or \`<Rooftop t={t} />\`, or compose any custom exterior (beach, desert, stadium, space…) with \`<DuskSky>\` / \`<NightSky>\` + custom SVG layers + \`<LightVeil>\`.
     - **Vehicle (Car / Bus / Train / Custom)**: use \`<Vehicle kind="car" | "bus" | "train" t={t} speed={1} night={...} />\` + \`<Hero pose={{ ...basePose, ...carSit('driver'), ... }} />\` + \`<VehicleForeground t={t} />\`, or add custom SVG props inside.
     - Never put \`<Classroom>\` in a story that is not about school!
   - **Animation & Rigging (mandatory)**: every \`<Hero>\` must be animated with \`poseAt(t, [{ f: 0, p: ... }, { f: Math.round(len * 0.55), p: ... }])\` or \`actPose(kind, t)\` (\`'idle' | 'talk' | 'explain' | 'question' | 'cheer' | 'shrug' | 'think' | 'shock' | 'point' | 'hold' | 'headset' | 'sit'\`)
     AND \`faceAt(t, [[0, '...'], [Math.round(len * 0.45), '...']])\`, plus a camera drift \`camT(kf(t, [[0, ...], [len, ...]]), cy, zoom)\`.
     - **Limb angle convention (\`armL\`, \`armR\`, \`legL\`, \`legR\`)**: \`0°\` is straight down, and **POSITIVE** angles (\`a: 20..145\`, \`b: 15..110\`) swing the arm **outward & upward** and bend the elbow naturally upward! Never pass large negative angles like \`{ a: -80, b: -50 }\` (the rig auto-normalizes them, but write positive angles \`{ a: 65, b: 45 }\` or use \`actPose('explain', t)\` directly).
   - **Clock \`t\` is in FRAMES (0..\`len\` at 30 fps), NEVER in seconds**:
     never write \`t - 0.8\` or \`t + 0.3\` (use frame integers like \`t - 12\`), and never schedule a keyframe
     past \`len\` (each shot is typically 35–65 frames long; a keyframe at \`f: 110\` never fires!).
   - **Orientation (\`16:9\` vs \`9:16\`) & Framing**: preserve \`"aspect": "16:9"\` or \`"aspect": "9:16"\` in \`episode.json\` (matching \`PROJECT.md\` or the user's request). In BOTH orientations, the world canvas centre is \`x = 960, y = 540\` (never \`x = 640\`). Keep \`camT\` zoom
     between \`1.0\` (wide), \`1.6–1.9\` (medium), and \`2.1–2.4\` (close) — never \`> 3.0\`. In \`9:16\`, keep key subjects and labels inside \`x = 580..1340\`.
   - Inspect \`out/<slug>/storyboard.jpg\` with \`view_image\`: if any shot is blank, lopsided or off-model,
     fix \`shots.tsx\` and re-run \`stills\` and \`board\`.
6. whatif_run sfx — generates/mixes \`public/<slug>/sfx.wav\` and \`public/<slug>/music.wav\` and sets stem
   volumes in \`timeline.json\`. It uses ElevenLabs when available and automatically falls back to the 40
   cached clips in \`library/sfx/\` so every episode gets a full sound & music mix.
7. whatif_run render — renders the video on **Modal** (and automatically builds the per-shot motion grids
   in \`out/<slug>/motion/\`). Then \`whatif_run master\` normalises to -14 LUFS (peaks < -1 dBTP) and writes
   \`out/<slug>/report.json\`.

## How you work
- **Run the pipeline end to end in one turn, unattended.** Nobody is watching for a question: go
  source -> script -> voice -> shotlist -> plan -> shots.tsx -> stills -> board -> sfx -> render -> master
  and only then report. Stop early only for a fact you cannot invent (no video id, a missing LLM key, an
  explicit request from the user) — never to ask "shall I continue?" or "do you approve the board?".
- read_file before edit_file: oldText must match exactly (the block it returns is the one to copy).
- read_file returns the whole file in one call: never slice a file into 80-line windows, it burns steps.
- npm install in the studio needs its devDependencies (@types/react): whatif_run install does that. If
  tsc says "no interface JSX.IntrinsicElements", run whatif_run install once instead of debugging it.
- Batch related changes in one edit_file call. Prefer small, verifiable steps over big rewrites.
- The steps have one legal order and they enforce it: if a step answers "cannot run X yet" or fails an
  animation/layout check, fix what it names and continue in the same turn — never end the turn with the
  pipeline half done.
- Every shot is a pure function of its own clock t: no state, no Math.random(), seeded rnd(seed, i) only.
  keyframes via kf(), poses via poseAt(), faces via faceAt(), frames via camT().
- The engine (src/engine) belongs to the skill: change it only when the user explicitly asks, and say why.
- **Do not explore.** No repo_map tours, no ls /skill, no reading src/engine/*.tsx, /skill/references/* or
  another episode's shots: the cheat sheet and the generated export list above are enough, and every file
  you open costs a step you need for the pipeline. Open the engine only when a typecheck/render error names
  a line. Write shots.tsx straight from the export list.
- Customize characters & sets to fit the story: define custom character looks at the top of \`shots.tsx\` with \`makeLook(...)\`, and choose or build sets that match the story (Indoor \`CustomRoom\`/\`Bedroom\`/\`Study\`, Outdoor \`Outdoor\`/\`Rooftop\`, or Vehicle \`Vehicle\`+\`carSit\`+\`VehicleForeground\`). Never invent external image/audio file paths.
- Framing. camT(cx, cy, scale) puts the world point (cx, cy) at the centre of a 1920x1080 frame. Use three
  sizes: wide ~ camT(960, 545, 1.0–1.3), medium ~ camT(920, 600, 1.65–1.9), close ~ camT(920, 540, 2.1–2.4).
  Keep the subject inside x 250–1670 and centre diagrams/props around x = 960 (never x = 640).
- Assets must be referenced through staticFile(), relative to public/.
- A real number needs a real source. If you don't have one, say so instead of inventing it.
- Look at what you produced: view_image on stills, the board and motion grids. A tool result is not a
  finished shot.
- Keep PROJECT.md up to date: the source video id, the decisions, the sources, what is done. That file
  is your memory across runs.
- Rendering and typechecking run on Modal (whatif_run render/stills); there is no Chromium in this
  container, so never try to render locally.
- Answer in the user's language (French if they write French). Be concrete and short: what you did, what it
  cost, what you need next.`;

function fileList(projectRoot: string, cap = 260): string {
  const files = walk(projectRoot, { maxFiles: cap });
  return files.join('\n');
}

function memory(projectRoot: string): string {
  const projectMd = readText(projectRoot, 'PROJECT.md', 40_000);
  const episodesDir = path.join(projectRoot, 'src', 'episodes');
  const episodes: string[] = [];
  if (fs.existsSync(episodesDir)) {
    for (const d of fs.readdirSync(episodesDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const ep = path.join(episodesDir, d.name, 'episode.json');
      if (!fs.existsSync(ep)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(ep, 'utf8'));
        episodes.push(`- ${d.name}: id=${json.id} title=${JSON.stringify(json.title)}`);
      } catch {
        episodes.push(`- ${d.name}: (episode.json unreadable)`);
      }
    }
  }
  return `${episodes.length ? `## Episodes\n${episodes.join('\n')}\n` : '## Episodes\n(none yet)\n'}${
    projectMd ? `\n## PROJECT.md\n${projectMd.slice(0, 6000)}` : '\n(no PROJECT.md yet)'
  }`;
}

const TOOL_BUDGET = 2_500;

function imagesFromPayload(payload: any, projectRoot: string, budget: { left: number }): ImagePart[] {
  const paths: string[] = Array.isArray(payload?.images) ? payload.images : [];
  const out: ImagePart[] = [];
  for (const rel of paths) {
    if (out.length >= 3 || budget.left <= 0) break;
    if (!/\.(png|jpe?g|webp)$/i.test(rel)) continue;
    try {
      const abs = path.join(projectRoot, rel);
      const st = fs.statSync(abs);
      if (st.size > budget.left || st.size > 4_000_000) continue;
      budget.left -= st.size;
      out.push({ mime: rel.toLowerCase().endsWith('.png') ? 'image/png' : rel.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(abs).toString('base64') });
    } catch {
      /* missing file: skip */
    }
  }
  return out;
}


/** A condensed map of the engine API, so a run does not spend 20 steps re-reading src/engine. */
const ENGINE_CHEAT = `## Engine cheat sheet (src/engine, stable: read the source only when a shot breaks)
import { Hero, LOOKS, makeLook, basePose, poseAt, actPose, walkPose, faceAt, camT, kf, rnd, ShotProps } from '../../engine';
import { Study, STUDY, Desk, Bedroom, BEDROOM, bedSit, BedDuvet, Kitchen, KITCHEN, stand, islandTop, Classroom, CLS, Rooftop, Stairwell, CustomRoom, MonitorSetup, Tabletop, Box, FloorShadow } from '../../engine';
import { Outdoor, OUTDOOR, Tree, StreetLamp, CarExterior, Vehicle, carSit, VehicleForeground, Schematic, DrawOn, SchLabel, CountUp, Arrow, TitleCard } from '../../engine';

// 1. Custom character looks (define at top of shots.tsx to give each episode its own varied cast):
// extra: 'hood'|'curls'|'bunches'|'bob'|'suit'|'cap'|'beanie'|'spiky'|'afro'|'ponytail'|'bald'|'helmet'
// accessory: 'headphones'|'headset'|'glasses'|'beard'|'mustache'|'scarf'|'tie'|'badge'|'none'
const KID_GAMER = makeLook({ skin: '#F2D2B6', jacket: '#3A86FF', accent: '#FFBE0B', hair: '#2B1E1A', extra: 'spiky', accessory: 'headset' });
const OLDER_PLAYER = makeLook({ skin: '#C98E68', jacket: '#232946', accent: '#FF5D73', hair: '#181420', extra: 'hood', accessory: 'headphones' });

// 2. Indoor / Custom room shot (t is in FRAMES 0..len at 30 fps, NEVER seconds! Positive arm angles a: 20..140, b: 15..100 lift arms outward & upward):
export const S1: React.FC<ShotProps> = ({ t, len }) => {
  const P = stand(BEDROOM, 0.56, 0.55);
  const pose = poseAt(t, [
    { f: 0, p: { x: P.x, y: P.y, scale: P.scale, yaw: 0.25, look: 0.3, ...actPose('talk', 0), armR: { a: 32, b: 42 } } },
    { f: Math.round(len * 0.55), p: { yaw: -0.15, ...actPose('explain', t), armR: { a: 74, b: 48 } } },
  ]);
  const face = faceAt(t, [[0, 'happy'], [Math.round(len * 0.45), 'shock']]); // 'neutral'|'happy'|'smug'|'shock'|'worried'|'oops'|'cool'|'dizzy'|'tired'
  return (
    <g transform={camT(kf(t, [[0, 940], [len, 980]]), 580, 1.75)}> {/* camT(cx, cy, zoom): canvas centre is (960, 540) in both 16:9 & 9:16, zoom 1.0..2.4 */}
      <Bedroom t={t} id="b1" />
      <Hero look={KID_GAMER} pose={{ ...basePose, ...pose, ...face }} rimId="rimBlue" shadow={0.25} />
    </g>
  );
};

// 3. Outdoor shot ('street' | 'park' | 'road' | 'nature') OR Vehicle shot ('car' | 'bus' | 'train') OR 100% Custom SVG:
// Outdoor: <Outdoor kind="street" t={t} night={false} /> + const P = stand(OUTDOOR, 0.5, 0.6); <Hero look={...} pose={...} />
// Vehicle: <Vehicle kind="car" t={t} speed={1.2} night /> + const D = carSit('driver'); <Hero look={...} pose={{ ...basePose, ...D, ...pose, ...face }} /> + <VehicleForeground t={t} screenText="90 km/h" />
// Custom interior/world: <CustomRoom r={STUDY} t={t} wall="#22263A" night><Desk x0={620} x1={1300} y={650} laptop={false} /><MonitorSetup x={960} y={646} muted />{/* + any custom SVG furniture/props */}</CustomRoom>
// Custom character props/accessories (beyond extra/accessory): <Hero look={...} pose={...} headGear={<g>...</g>} torsoGear={<g>...</g>} handRProp={<g>...</g>} />`;


export type EpisodeStatus = { slug: string; words: number; seconds: string; done: string[]; todo: string[]; title: string };

/** Where the episode actually stands, recomputed every turn: cheaper than making the model re-read. */
export function episodeStatus(projectRoot: string): EpisodeStatus[] {
  const eps = path.join(projectRoot, 'src', 'episodes');
  let slugs: string[] = [];
  try {
    slugs = fs
      .readdirSync(eps, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: EpisodeStatus[] = [];
  for (const slug of slugs) {
    const src = path.join(eps, slug);
    let ep: any = {};
    try {
      ep = JSON.parse(fs.readFileSync(path.join(src, 'episode.json'), 'utf8'));
    } catch {
      continue;
    }
    const dir = path.join(projectRoot, 'out', slug);
    const has = (rel: string) => fs.existsSync(path.join(dir, rel));
    const words = (ep.script ?? []).reduce(
      (n: number, b: any) =>
        n +
        String(b.text ?? '')
          .replace(/\[[^\]]*\]/g, ' ')
          .replace(/<[^>]*>/g, ' ')
          .split(/\s+/)
          .filter(Boolean).length,
      0,
    );
    const steps: [string, boolean][] = [
      ['script', Array.isArray(ep.script) && ep.script.length > 0 && !JSON.stringify(ep.script).includes('TODO')],
      ['words', fs.existsSync(path.join(src, 'words.json'))],
      ['timeline', fs.existsSync(path.join(src, 'timeline.json'))],
      ['voice', fs.existsSync(path.join(projectRoot, 'public', slug, 'voice.wav'))],
      ['stills', has('board')],
      ['board', has('storyboard.jpg')],
      ['sfx', fs.existsSync(path.join(projectRoot, 'public', slug, 'sfx.wav'))],
      ['render', has(`${slug}-raw.mp4`)],
      ['master', has(`${slug}-final.mp4`)],
    ];
    let seconds = '';
    try {
      const w = JSON.parse(fs.readFileSync(path.join(src, 'words.json'), 'utf8'));
      const last = Array.isArray(w) ? w[w.length - 1] : null;
      if (last?.e) seconds = `, voice ${Number(last.e).toFixed(1)}s`;
    } catch {
      /* no take yet */
    }
    out.push({
      slug,
      words,
      seconds,
      done: steps.filter(([, v]) => v).map(([k]) => k),
      todo: steps.filter(([, v]) => !v).map(([k]) => k),
      title: Array.isArray(ep.title) ? ep.title.join(' ') : String(ep.title ?? ''),
    });
  }
  return out;
}

function projectState(projectRoot: string): string {
  const status = episodeStatus(projectRoot);
  if (!status.length) return 'no episode yet';
  return status
    .map(
      (e) =>
        `- ${e.slug}: ${e.words} words${e.seconds} | done: ${e.done.join(' ') || '-'} | todo: ${e.todo.join(' ') || '-'}` +
        (e.title ? ` | title: ${e.title}` : ''),
    )
    .join('\n');
}

/** The steps an episode still owes, or [] when nothing is running. */
export function pipelineTodo(projectRoot: string): string[] {
  const status = episodeStatus(projectRoot);
  if (!status.length) return [];
  const started = status.find((e) => e.done.some((d) => d !== 'script')) ?? status[0]!;
  return started.todo.filter((t) => t !== 'script');
}

export type BuildOptions = {
  projectRoot: string;
  history: MessageRow[];
  maxChars: number;
};

/** Compile the conversation: system prompt, project memory, file list, then the (compacted) history. */
export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const head: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `## Project folder\n${opts.projectRoot}\n\n${memory(opts.projectRoot)}` },
    { role: 'system', content: `## Where the episode stands (live, recomputed each turn)\n${projectState(opts.projectRoot)}\n\nDo the next todo step; do not re-read files you already know unless a step fails.` },
    { role: 'system', content: ENGINE_CHEAT },
    { role: 'system', content: `## Every engine export and its props (generated from src/engine at the top of this turn)\n${engineDigest(opts.projectRoot)}\n\nThis listing is the contract: do not read src/engine/*.tsx again unless a typecheck or a render error names a specific line.` },
    { role: 'system', content: `## Files\n${fileList(opts.projectRoot)}` },
  ];
  const headChars = head.reduce((n, m) => n + m.content.length, 0);

  // Walk history backwards, keeping recent turns in full and older ones trimmed.
  const history = opts.history;
  const kept: ChatMessage[] = [];
  let used = headChars;
  let dropped = 0;
  const imageBudget = { left: 4_500_000 };

  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i]!;
    const payload = row.payload ? JSON.parse(row.payload) : null;
    const age = history.length - 1 - i;
    let content = row.content;
    if (row.role === 'tool' && age > 3) content = content.slice(0, TOOL_BUDGET);
    if (row.role === 'assistant' && age > 8) content = content.slice(0, 1_500);

    const msg = toChatMessage(row, payload, content, opts.projectRoot, imageBudget);
    const cost = ('content' in msg ? msg.content.length : 0) + 2_000; // images charged as a flat estimate
    if (used + cost > opts.maxChars && kept.length >= 4) {
      dropped = i + 1;
      break;
    }
    used += cost;
    kept.unshift(msg);
  }

  const out = [...head];
  if (dropped > 0) {
    out.push({
      role: 'system',
      content: `(${dropped} older messages were compacted to stay inside the context window. Re-read files if you need details; the .git history keeps checkpoints.)`,
    });
  }
  out.push(...kept);
  return out;
}

function toChatMessage(
  row: MessageRow,
  payload: any,
  content: string,
  projectRoot: string,
  imageBudget: { left: number },
): ChatMessage {
  if (row.role === 'tool') {
    return { role: 'tool', toolCallId: String(payload?.toolCallId ?? ''), name: String(payload?.name ?? 'tool'), content };
  }
  if (row.role === 'assistant') {
    return { role: 'assistant', content, toolCalls: payload?.toolCalls ?? undefined };
  }
  if (row.role === 'system') return { role: 'system', content };
  return { role: 'user', content, images: imagesFromPayload(payload, projectRoot, imageBudget) };
}

/** The text a tool result is stored as: what the model reads on the next turn. */
export function toolMessageContent(result: { ok: boolean; summary: string; artifacts?: { path: string; kind: string }[] }): string {
  const arts = (result.artifacts ?? []).filter((a) => a.kind !== 'text');
  const suffix = arts.length ? `\n[files: ${arts.map((a) => `${a.path} (${a.kind})`).join(', ')}]` : '';
  return `${result.ok ? 'ok' : 'ERROR'}\n${result.summary}${suffix}`.slice(0, 12_000);
}
