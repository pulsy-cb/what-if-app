import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart } from './providers/types.js';
import type { MessageRow } from './db.js';
import { readText, walk } from '../tools/paths.js';
import { engineDigest } from './engine-digest.js';

export const SYSTEM_PROMPT = `You are the studio agent of "What If", a 2D animation pipeline (from 15 s shorts up to multi-minute episodes, 16:9 1920x1080 or 9:16 1080x1920 @ 30fps, SVG + Remotion).

You work inside ONE project folder (the studio) and you change it with tools. You never print shell
commands for a human to paste: you call the tools.

## The pipeline (this order is the product)
0. Source (\`:8005\`). When the project has a source video id from the local "nouveau" server (\`:8005\`),
   \`whatif_new { episode, video, aspect }\` scaffolds the project, and \`whatif_run { episode, step: "source", args: ["--pick", "hook", "--apply"] }\`
   fetches the server's existing French translation proposals (or generates them if none exist yet), selects the
   proposal on \`:8005\`, saves it in \`out/<episode>/source.fr.md\`, and **automatically populates \`episode.json.script\`
   with the full French narration**.
   - **CRITICAL RULE FOR \`:8005\` VIDEOS**: **NEVER rewrite, summarize, or shorten the server's French translation proposal!**
     Episodes from \`:8005\` can be 30 seconds, 90 seconds, or several minutes long. Keep the complete French narration
     from \`source.fr.md\` in \`episode.json.script\` (the pipeline audit rejects any shortened script!). Only set
     \`"defaultSet"\` (e.g. \`"restaurant"\`, \`"bedroom"\`, \`"vehicle"\`, \`"outdoor"\`, \`"study"\`) and preserve \`"aspect"\` (\`"9:16"\` or \`"16:9"\`).
1. Standalone episodes (ONLY when there is NO \`:8005\` source video id):
   Write \`episode.json\` following the 7-beat What If formula (cold-open demos, French premise/title card, sourced science turn in \`science: [{ claim, working, source }]\`, and closing question).
   **Location rule (\`set\`)**: set \`"defaultSet"\` on \`episode.json\` and/or \`"set"\` on each beat in \`script\` to match
   where the story actually takes place (\`"restaurant"\`, \`"bedroom"\`, \`"study"\`, \`"vehicle"\`, \`"outdoor"\`, \`"rooftop"\`, \`"stairwell"\`,
   \`"kitchen"\`, \`"classroom"\`, or a custom room). Never use \`"classroom"\` unless the story is about school!
2. whatif_run voice — **ElevenLabs TTS by default** (\`provider: "elevenlabs"\`, model \`"eleven_v4"\`, default speed/\`speakingRate: 1.15\`, voices Hugo \`"3Tp5mYhT9wrfnry9pzvV"\` or Léa \`"KSyQzmsYhFbuOhqj1Xxv"\`) through the local \`:8005\` TTS API (\`POST /api/videos/<videoId>/tts/elevenlabs\`), on the same
   video id (Fish Audio remains available with \`provider: "fish"\`). It writes \`public/<episode>/voice.wav\` and \`src/episodes/<episode>/words.json\`: the script's
   words with the *measured* Deepgram times (any \`[audio tags]\` like \`[whispers]\` or \`[excited]\` are sent to ElevenLabs v4 and automatically stripped from \`words.json\`).
3. whatif_run shotlist — cuts the measured words into clause-aligned shots (9–14 shots for 20s shorts, scaling up to 15–36 shots for multi-minute stories),
   keeps coherent story locations while varying camera framing (\`wide\`, \`medium\`, \`close\`, \`insert\`, \`low angle\`),
   and seeds \`fx\` and \`sound\` (from the studio's 40 cached \`library/sfx/\` clips).
4. whatif_run plan — turns episode.json.edit into timeline.json (schema 2: total, segments{a,b,t0,t1,shot,look},
   shots, fx, audio). Each edit entry is {"shot": "S2", "at": "<cue>"} and a cue is one of:
     f:120          an absolute frame            s:4.2      seconds
     S1+2 / S1#2+2  2 frames after shot S1 (or after its 2nd segment; S1-4 is before it)
     franchir / franchir+3 / le#2-2   a *word of the script as measured in words.json*, optionally its
                    nth occurrence after the previous cut and an offset. There is **no "w:" prefix**:
                    "w:franchir" is a bad cue and plan.py fails. Cues must be in increasing time order.
5. **Step 5a — Write \`src/episodes/<slug>/DIRECTOR.md\` (Réalisation & Mise en Scène — MANDATORY before \`stills\`)**:
   Before writing \`shots.tsx\`, act as a real animation director and write \`src/episodes/<slug>/DIRECTOR.md\` (>= 250 chars) with:
   - **1. Architecture des décors en 3 couches de profondeur**:
     - *Arrière-plan*: murs texturés (\`<CustomRoom>\`, \`<Study>\`, \`<Bedroom>\`, \`<Outdoor>\`, \`<Vehicle>\`), fenêtres (\`<BackWindow>\`), cadres (\`<WallFrame>\`), appliques (\`<WallLight>\`), plantes (\`<FloorPlant>\`), ou décor extérieur/urbain.
     - *Plan moyen*: mobilier structurant et personnages assis ou debout (ex: dans un restaurant/café, deux personnages assis face à face avec \`tableSit(760, 690, 'left')\` et \`tableSit(1160, 690, 'right')\` placés **AVANT** \`<DiningTable x={960} y={690} w={520} cloth="#9E2A3B" candle plates />\` pour que la nappe masque naturellement leurs jambes pendant que leurs bustes et leurs mains interagissent au-dessus de la table à \`y = 665..688\` !).
     - *Premier plan*: accessoires posés sur la table (\`y = 675..688\`), lumière d'ambiance (\`<Pendant>\`, \`<LightVeil>\`, \`<Dust>\`).
   - **2. Casting & costumes (\`makeLook\`)**: définir les personnages récurrents (narrateur, date/interlocuteur, serveur, etc.) avec des tenues, coiffures et accessoires distincts.
   - **3. Découpage et chorégraphie physique des actions plan par plan**:
     - Quand deux personnages interagissent (ex: rendez-vous au restaurant), utiliser des **plans à deux (two-shots)** en plan large/moyen et alterner avec des cadrages rapprochés cohérents (ne jamais faire disparaître la table ou l'interlocuteur sans raison !).
     - **Prise et tenue d'objets (INTERDICTION des objets flottants)**: un objet tenu ou saisi ne doit **JAMAIS** être dessiné à des centaines de pixels de la main !
       - Pour un objet tenu en continu dans la main : passe-le à \`<Hero handRProp={<g>...</g>} />\` ou positionne-le à \`const H = handWorld(pose, 'R')\` (\`<g transform={\`translate(\${H.x} \${H.y})\`}>...\`).
       - Pour tendre le bras naturellement vers un objet posé sur la table en \`target = { x: 880, y: 680 }\` : utilise \`reachPose(base, { x: 880, y: 680 }, 'R')\` ou \`ikArm(base, target, 'R')\` (cinématique inverse à 2 os avec coude plié naturel, jamais de bras raide ou tordu).
       - Pour **prendre un objet sur la table et le soulever / le ranger** (ex: prendre un verre d'eau, sortir un Tupperware et y mettre des raviolis, prendre l'addition) : utilise \`const g = grabAt(t, seatPose, { x: 890, y: 680 }, { x: 790, y: 635 }, 10, Math.round(len * 0.7), 'R')\` qui retourne \`{ arm, propPos, handPos }\` — passe \`armR: g.arm\` au \`<Hero>\` et dessine l'objet en \`translate(\${g.propPos.x} \${g.propPos.y})\` : la main va chercher l'objet sur la table, le saisit et le déplace !
6. **Step 5b — Write & Animate \`shots.tsx\` + \`index.tsx\`, then run \`whatif_run stills\` and \`whatif_run board\`**:
   - Export one component per shot id in \`timeline.json\` (\`S1\`, \`S2\`, …) and register ALL of them in
     \`src/episodes/<slug>/index.tsx\`.
   - **Batching rule for long episodes (> 10 shots)**: never try to generate 15–36 shots in a single giant \`write_file\` call (it will hit the output token limit). Instead, write \`shots.tsx\` in **batches of 6–8 shots**:
     1. First call \`write_file({ path: "src/episodes/<slug>/shots.tsx", content: "..." })\` with imports, \`makeLook\` cast, shared set helpers, and shots \`S1..S7\`,
     2. Then call \`write_file({ path: "src/episodes/<slug>/shots.tsx", content: "...", append: true })\` for \`S8..S14\`, then \`S15..S21\`, etc., until every shot in \`timeline.json\` is exported!
   - **Custom Characters (\`makeLook\` + open SVG slots)**: design custom looks at the top of \`shots.tsx\` with \`makeLook({ skin, jacket, accent, hair, extra, accessory }, base)\`.
     Pass custom SVG to \`<Hero>\` via \`headGear\`, \`torsoGear\`, \`handRProp\` / \`handLProp\`.
   - **Natural Rigging & Motion**: every \`<Hero>\` must be animated with \`poseAt(t, ...)\` or \`actPose(kind, t)\`
     AND \`faceAt(t, ...)\`, plus a camera drift \`camT(kf(t, [[0, ...], [len, ...]]), cy, zoom)\`.
     Use \`tableSit(x, 690, 'left' | 'right')\` for characters seated at a table, \`carSit('driver' | 'passenger')\` in vehicles, \`bedSit\` on a bed, or \`stand(ROOM, u, w)\` when standing.
   - **Clock \`t\` is in FRAMES (0..\`len\` at 30 fps), NEVER in seconds**:
     never write \`t - 0.8\` or \`t + 0.3\` (use frame integers like \`t - 12\`), and never schedule a keyframe past \`len\`.
   - **Orientation (\`16:9\` vs \`9:16\`) & Framing**: preserve \`"aspect": "16:9"\` or \`"aspect": "9:16"\` in \`episode.json\`. In BOTH orientations, the world canvas centre is \`x = 960, y = 540\` (never \`x = 640\`). In \`9:16\` vertical (viewBox width 900 around x=960, i.e. \`x = 510..1410\`), seat two-shot table characters around \`x = 760\` and \`x = 1160\` (or \`780\` and \`1140\`) and keep \`camT\` zoom around \`1.0–1.35\` for two-shots and \`1.55–2.1\` for singles so both characters and the table fit comfortably inside the vertical frame!
   - Inspect \`out/<slug>/storyboard.jpg\` with \`view_image\`: if any shot is blank, lopsided or off-model,
     fix \`shots.tsx\` and re-run \`stills\` and \`board\`.
7. whatif_run sfx — generates/mixes \`public/<slug>/sfx.wav\` and \`public/<slug>/music.wav\` and sets stem
   volumes in \`timeline.json\`.
8. whatif_run render — renders the video on **Modal** (and automatically builds the per-shot motion grids
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
import { Hero, LOOKS, makeLook, basePose, poseAt, actPose, walkPose, faceAt, handWorld, ikArm, reachPose, grabAt, tableSit, camT, kf, rnd, ShotProps } from '../../engine';
import { Study, STUDY, Desk, Bedroom, BEDROOM, bedSit, BedDuvet, Kitchen, KITCHEN, stand, islandTop, Classroom, CLS, Rooftop, Stairwell, CustomRoom, DiningTable, MonitorSetup, Tabletop, Box, FloorShadow, WallFrame, WallLight, FloorPlant } from '../../engine';
import { Outdoor, OUTDOOR, Tree, StreetLamp, CarExterior, Vehicle, carSit, VehicleForeground, Schematic, DrawOn, SchLabel, CountUp, Arrow, TitleCard } from '../../engine';

// 1. Custom character looks (define at top of shots.tsx to give each episode its own varied cast):
// extra: 'hood'|'curls'|'bunches'|'bob'|'suit'|'cap'|'beanie'|'spiky'|'afro'|'ponytail'|'bald'|'helmet'
// accessory: 'headphones'|'headset'|'glasses'|'beard'|'mustache'|'scarf'|'tie'|'badge'|'none'
const NARRATOR = makeLook({ skin: '#F2D2B6', jacket: '#3A86FF', accent: '#FFBE0B', hair: '#2B1E1A', extra: 'spiky', accessory: 'none' });
const DATE_GIRL = makeLook({ skin: '#D89B72', jacket: '#E05780', accent: '#FFE5EC', hair: '#1E1418', extra: 'curls', accessory: 'glasses' });

// 2. Restaurant / Café / Table Two-Shot + Physical Object Grabbing (NEVER float objects away from hands!):
export const S1: React.FC<ShotProps> = ({ t, len }) => {
  const seatL = tableSit(760, 690, 'left');
  const seatR = tableSit(1160, 690, 'right');
  // Physical pickup: right hand reaches to the table at (885, 678) at frame 10, picks up the glass/box, and lifts it to (800, 635) by frame 28
  const grab = grabAt(t, { ...basePose, ...seatL }, { x: 885, y: 678 }, { x: 800, y: 635 }, 10, Math.min(len - 6, 28), 'R');
  const poseL = poseAt(t, [
    { f: 0, p: { ...seatL, ...actPose('talk', t), armR: grab.arm } },
    { f: Math.round(len * 0.6), p: { ...seatL, ...actPose('explain', t), armR: grab.arm } },
  ]);
  const poseR = poseAt(t, [
    { f: 0, p: { ...seatR, ...actPose('idle', t) } },
    { f: Math.round(len * 0.55), p: { ...seatR, ...actPose('question', t) } },
  ]);
  const faceL = faceAt(t, [[0, 'happy'], [Math.round(len * 0.5), 'shock']]);
  const faceR = faceAt(t, [[0, 'neutral'], [Math.round(len * 0.45), 'smug']]);
  return (
    <g transform={camT(kf(t, [[0, 950], [len, 970]]), 575, 1.25)}>
      <CustomRoom r={STUDY} t={t} id="rest1" wall="#2B1B24" side="#21141C" floorC="#2A1C18" night>
        <WallFrame x={650} y={250} w={130} h={95} art={0} />
        <WallFrame x={1140} y={250} w={130} h={95} art={1} />
        <FloorPlant r={STUDY} u={0.14} w={0.18} size={0.85} />
        {/* Render seated characters BEFORE <DiningTable> so the tablecloth naturally occludes their legs */}
        <Hero look={NARRATOR} pose={{ ...basePose, ...poseL, ...faceL }} />
        <Hero look={DATE_GIRL} pose={{ ...basePose, ...poseR, ...faceR }} />
        <DiningTable x={960} y={690} w={480} cloth="#9E2A3B" candle plates>
          {/* Prop moves physically with the character's hand via grab.propPos! */}
          <g transform={\`translate(\${grab.propPos.x} \${grab.propPos.y})\`}>
            <rect x={-16} y={-24} width={32} height={24} rx={4} fill="#7BDFF2" stroke="#1E1824" strokeWidth={3} />
          </g>
        </DiningTable>
      </CustomRoom>
    </g>
  );
};

// 3. Outdoor shot ('street' | 'park' | 'road' | 'nature') OR Vehicle shot ('car' | 'bus' | 'train') OR 100% Custom SVG:
// Outdoor: <Outdoor kind="street" t={t} night={false} /> + const P = stand(OUTDOOR, 0.5, 0.6); <Hero look={...} pose={...} />
// Vehicle: <Vehicle kind="car" t={t} speed={1.2} night /> + const D = carSit('driver'); <Hero look={...} pose={{ ...basePose, ...D, ...pose, ...face }} /> + <VehicleForeground t={t} screenText="90 km/h" />
// Held prop directly in hand: <Hero look={...} pose={...} handRProp={<g><rect x={-10} y={-22} width={20} height={32} rx={4} fill="#FFF" /></g>} />`;


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
      ['director', fs.existsSync(path.join(src, 'DIRECTOR.md'))],
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
    if (row.role === 'assistant' && !row.content.trim() && !payload?.toolCalls?.length) continue;
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
