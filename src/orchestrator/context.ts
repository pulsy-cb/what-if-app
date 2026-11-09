import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart, ToolCall } from './providers/types.js';
import type { MessageRow } from './db.js';
import { readText, walk } from '../tools/paths.js';
import { engineDigest } from './engine-digest.js';
import { DIRECTOR_GUIDE, SHOT_GUIDE, STAGE_GUIDE, modernDirectorGuide } from './director-guide.js';

/** Count spoken words in an episode script, stripping [audio tags] and <xml> markers consistently everywhere. */
export function countScriptWords(script: unknown): number {
  if (!Array.isArray(script)) return 0;
  return script.reduce(
    (n: number, b: any) =>
      n +
      String(b?.text ?? '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length,
    0,
  );
}

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
     \`"defaultSet"\` to describe the story's setting and preserve \`"aspect"\` (\`"9:16"\` or \`"16:9"\`).
1. Standalone episodes (ONLY when there is NO \`:8005\` source video id):
   Write \`episode.json\` following the 7-beat What If formula (cold-open demos, French premise/title card, sourced science turn in \`science: [{ claim, working, source }]\`, and closing question).
   **Location rule (\`set\`)**: every episode has its own world — describe the actual place on \`"defaultSet"\` and/or each beat's \`"set"\`
   (e.g. a bespoke bistro, a subway car, a lab, a rooftop, a courtroom, a bedroom, or any custom location). Never use \`<Classroom>\` unless the story is about school!
2. whatif_run voice — **ElevenLabs TTS by default** (\`provider: "elevenlabs"\`, model \`"eleven_v4"\`, default speed/\`speakingRate: 1.15\`) through the local \`:8005\` TTS API (\`POST /api/videos/<videoId>/tts/elevenlabs\`), on the same
   video id (Fish Audio remains available with \`provider: "fish"\`). Both \`source\` and \`voice\` **automatically analyze the French phrasing and grammatical agreements** of the script (e.g. 1st-person feminine vs masculine agreements like *"je me suis remise / assise / confuse"* vs *"je me suis assis / confus"*) to pick the matching voice: **Léa** (\`"KSyQzmsYhFbuOhqj1Xxv"\`, \`narratorGender: "female"\`) or **Hugo** (\`"3Tp5mYhT9wrfnry9pzvV"\`, \`narratorGender: "male"\`). To force a specific voice manually, pass \`args: ["--voice", "lea"]\` or \`["--voice", "hugo"]\` or set \`"locked": true\` in \`episode.json.voice\`. It writes \`public/<episode>/voice.wav\` and \`src/episodes/<episode>/words.json\`: the script's
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
5. **Step 5a — Write \`src/episodes/<slug>/DIRECTOR.md\` (Réalisation & Mise en Scène — MANDATORY before \`stills\`, >= 200 chars)**:
   Before writing \`shots.tsx\`, act as a real animation director and write \`src/episodes/<slug>/DIRECTOR.md\` (>= 200 chars) with:
   - **1. Architecture des décors sur mesure en 3 couches de profondeur**:
     Each episode has its own world, but reuse engine parts instead of redrawing them (see "Choosing the set" in the director's guide): start from an engine set (\`Classroom\` is a template: \`tokens\` + story slots; \`Bedroom\`, \`Kitchen\`…) when the place matches and its mood fits the story (clear its demo content through its props), otherwise build it with \`makeRoom\` / \`RoomShell\` / \`CustomRoom\` / \`Box\` / \`FloorShadow\` or custom SVG. Never copy a set from another episode:
     - *Arrière-plan (couche 1)*: murs texturés (\`<CustomRoom>\`, \`<RoomShell>\`, ou décor extérieur/véhicule/SVG sur mesure), fenêtres (\`<BackWindow>\`), cadres (\`<WallFrame>\`), appliques (\`<WallLight>\`), plantes (\`<FloorPlant>\`), éléments architecturaux propres à l'histoire. Give each shot's set a **unique \`id\`** (e.g. \`id="s1"\`, \`id="s2"\`).
     - *Plan moyen (couche 2)*: mobilier structurant (\`<Box>\`, \`<FloorShadow>\`, \`<DiningTable>\`, \`<Desk>\`, canapés, comptoirs, bancs) et personnages assis ou debout (ex: deux personnages assis face à face avec \`tableSit(760, 690, 'left')\` et \`tableSit(1160, 690, 'right')\` placés **AVANT** \`<DiningTable x={960} y={690} w={520} wood="#8C6239" />\` pour que la table masque naturellement leurs jambes pendant que leurs bustes et leurs mains interagissent au-dessus du plateau à \`y = 665..688\` ; n'ajoute \`cloth="#9E2A3B" candle plates\` QUE si la scène se passe réellement dans un restaurant ou dîner aux chandelles !).
     - *Premier plan & lumière (couche 3)*: accessoires posés sur la table/meuble (\`y = 675..688\`), éléments d'amorce (\`filter="url(#blur16)"\` en over-the-shoulder), lumière d'ambiance (\`<Pendant>\`, \`<LightVeil>\`, \`<Glow>\`, \`<Dust>\`).
   - **2. Casting, silhouettes distinctes & objet-clé (\`makeLook\`)**: définir les personnages récurrents avec des silhouettes (\`extra\`), accessoires (\`accessory\`) et palettes de couleurs distincts, aligner le genre du personnage narrateur principal sur \`episode.json.voice.narratorGender\` (ex: coiffure \`'ponytail' | 'bun' | 'long' | 'bob'\` si \`narratorGender === "female"\` avec la voix de Léa), et vérifier le contraste avec les murs (jamais de veste/membres sombres sans contour ou rim light sur un mur sombre). **Règle d'objet/vêtement-clé** : si l'histoire porte sur un vêtement ou objet spécifique (un nouveau haut, un sac, un plat, une fiole, une bague), donne-lui une couleur et une forme **distinctes** de la veste habituelle des personnages, et respecte la chronologie du récit (un personnage ne porte ou ne tient l'objet qu'à partir du plan où le texte le dit !).
   - **3. Découpage, continuité décor↔code et chorégraphie physique des actions plan par plan**:
     - **Continuité stricte \`DIRECTOR.md\` ↔ \`shots.tsx\`**: le décor, les couleurs de murs et TOUS les meubles/accessoires décrits dans \`DIRECTOR.md\` ou cités dans le texte (ex. canapé, table basse, bol, fenêtre) DOIVENT réellement être codés dans le composant de décor partagé en haut de \`shots.tsx\`. Ne décris jamais un décor dans \`DIRECTOR.md\` pour en coder un autre dans \`shots.tsx\` !
     - **Règles narratives sur les inserts et cartes-titres**:
       - Un plan \`insert\` zoome (\`camT(..., 2.0..2.4)\`) sur l'**objet concret** ou les mains dans le décor de la scène. **INTERDICTION** de remplacer un plan de dialogue, de sourire ou de réaction par un panneau \`<Schematic>\` ou un texte inventé hors sujet (tout libellé \`<SchLabel>\` doit reprendre les mots exacts de la narration en français).
       - \`<TitleCard>\` est réservé au titre d'ouverture/prémisse (début d'épisode) : **JAMAIS** de \`<TitleCard>\` au milieu d'une scène dramatique, et **JAMAIS** de texte en anglais dans un épisode français.
     - Quand deux personnages interagissent, utiliser des **plans à deux (two-shots)** en plan large/moyen et alterner avec des cadrages rapprochés cohérents (ne jamais faire disparaître le mobilier ou l'interlocuteur sans raison !).
     - **Prise et tenue d'objets (INTERDICTION des objets flottants)**: un objet tenu ou saisi ne doit **JAMAIS** être dessiné à des centaines de pixels de la main !
       - Pour un objet tenu en continu dans la main : passe-le à \`<Hero handRProp={<g>...</g>} />\` ou positionne-le à \`const H = handWorld(pose, 'R')\` (\`<g transform={\`translate(\${H.x} \${H.y})\`}>...\`).
       - Pour tendre le bras naturellement vers un objet posé sur la table en \`target = { x: 880, y: 680 }\` : utilise \`reachPose(base, { x: 880, y: 680 }, 'R')\` ou \`ikArm(base, target, 'R')\`.
       - Pour **prendre un objet sur la table et le soulever / le ranger** : utilise \`const g = grabAt(t, seatPose, { x: 890, y: 680 }, { x: 790, y: 635 }, 10, Math.round(len * 0.7), 'R')\` qui retourne \`{ arm, propPos, handPos }\` — passe \`armR: g.arm\` au \`<Hero>\` et dessine l'objet en \`translate(\${g.propPos.x} \${g.propPos.y})\`.
6. **Step 5b — Write & Animate \`shots.tsx\` + \`index.tsx\`, then run \`whatif_run stills\` and \`whatif_run board\`**:
   - Export one component per shot id in \`timeline.json\` (\`S1\`, \`S2\`, …) and register ALL of them in
     \`src/episodes/<slug>/index.tsx\`.
   - **Batching rule for long episodes (> 10 shots)**: never try to generate 15–36 shots in a single giant \`write_file\` call (it will hit the output token limit). Instead, write \`shots.tsx\` in **batches of 6–8 shots**:
     1. First call \`write_file({ path: "src/episodes/<slug>/shots.tsx", content: "..." })\` with imports, \`makeLook\` cast, shared custom set components, and shots \`S1..S7\`,
     2. Then call \`write_file({ path: "src/episodes/<slug>/shots.tsx", content: "...", append: true })\` for \`S8..S14\`, then \`S15..S21\`, etc., until every shot in \`timeline.json\` is exported! (Check the live "Active episode continuity pin" in the system prompt: it always shows your shared header from \`shots.tsx\`, which shots are already exported, and the exact specs of the remaining shots).
   - **Custom Characters (\`makeLook\` + open SVG slots)**: design custom looks at the top of \`shots.tsx\` with \`makeLook({ skin, jacket, accent, hair, extra, accessory }, base)\`. Give each character a distinct \`extra\` and contrasting \`jacket\`. Pass custom SVG to \`<Hero>\` via \`headGear\`, \`torsoGear\`, \`handRProp\` / \`handLProp\`.
   - **Natural Rigging, Lip-Sync & Camera**: every \`<Hero>\` must be animated with \`poseAt(t, ...)\` or \`actPose(kind, t)\`
     AND \`faceAt(t, ...)\`, plus camera motion (\`camT(kf(t, [[0, ...], [len, ...]]), cy, zoom)\` or \`camPush\`/\`camPan\`).
     When a character speaks, use \`actPose('talk' | 'explain' | 'question', t)\` or pass \`talk: talkAt(t, len)\` in the pose so their mouth animates naturally with speech!
   - **Clock \`t\` is in FRAMES (0..\`len\` at 30 fps), NEVER in seconds**:
     never write \`t - 0.8\` or \`t + 0.3\` (use frame integers like \`t - 12\`), and never schedule a keyframe past \`len\`.
   - **Orientation (\`16:9\` vs \`9:16\`) & Framing**: preserve \`"aspect": "16:9"\` or \`"aspect": "9:16"\` in \`episode.json\`. In BOTH orientations, the world canvas centre is \`x = 960, y = 540\` (never \`x = 640\`). Keep \`camT\` zoom inside \`0.6..4.5\`; the per-format table (wide / medium / close-up) is in the director's guide: in 9:16 only 900/zoom units are visible across.
   - **Targeted re-renders**: if only specific shots fail the layout check (e.g. \`S3\`, \`S7\`), fix them in \`shots.tsx\` and run \`whatif_run { episode, step: "stills", args: ["S3", "S7"] }\` followed by \`board\` instead of re-rendering every still!
   - Inspect \`out/<slug>/storyboard.jpg\` with \`view_image\`: if any shot is blank, lopsided or off-model,
     fix \`shots.tsx\` and re-run \`stills\` (for the changed shot IDs) and \`board\`.
7. whatif_run sfx — generates/mixes \`public/<slug>/sfx.wav\` and \`public/<slug>/music.wav\` and sets stem
   volumes in \`timeline.json\`.
8. whatif_run render — renders the video on **Modal** (and automatically builds the per-shot motion grids
   in \`out/<slug>/motion/\`). Then \`whatif_run master\` normalises to -14 LUFS (peaks < -1 dBTP) and writes
   \`out/<slug>/report.json\`.

## How you work
- **Run the pipeline end to end in one turn, unattended.** Nobody is watching for a question: go
  source -> script -> voice -> shotlist -> plan -> DIRECTOR.md -> shots.tsx -> stills -> board -> sfx -> render -> master
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
  keyframes via kf(), poses via poseAt(), faces via faceAt(), frames via camT() / camPush() / camPan().
- The engine (src/engine) belongs to the skill: change it only when the user explicitly asks, and say why.
- **Do not explore.** No repo_map tours and no other episode's shots: the director's guide, the cheat sheet and the
  generated export list (with the full \`Pose\` fields) are enough, and every file you open costs a step you need
  for the pipeline. Open an engine file only when a typecheck/render error names a line, or once, to read the set you
  are about to use (\`src/engine/sets/<set>.tsx\`). Write shots.tsx straight from the export list.
- Sets and characters: define ONE episode set component at the top of \`shots.tsx\` (an engine set with its props, or \`CustomRoom\` /
  \`RoomShell\` / \`Box\` / \`FloorShadow\` / \`BackWindow\` / \`Pendant\` / \`LightVeil\`) and reuse it in every shot of that place,
  and define distinct character looks with \`makeLook(...)\`. Never invent external image/audio file paths.
- Framing. camT(cx, cy, scale) puts the world point (cx, cy) at the centre of the frame, and the frame is 1920/scale wide in
  16:9 but only 900/scale wide in 9:16: use the per-format zoom table in the director's guide. The subject is
  not always centred: put it on a third, face the characters toward each other and leave look room.
- Assets must be referenced through staticFile(), relative to public/.
- A real number needs a real source. If you don't have one, say so instead of inventing it.
- Look at what you produced: view_image on stills, the board and motion grids. A tool result is not a
  finished shot.
- Keep PROJECT.md up to date: the source video id, the decisions, the sources, what is done. That file
  is your memory across runs.
- Rendering runs on Modal (whatif_run render/stills); there is no Chromium in this
  container, so never try to render locally.
- Answer in the user's language (French if they write French). Be concrete and short: what you did, what it
  cost, what you need next.`;

/** Replace everything from `from` up to (not including) `to`. Unchanged when a marker is gone: the smoke test watches for that. */
function swapBlock(text: string, from: string, to: string, replacement: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? text : text.slice(0, a) + replacement + text.slice(b);
}

/** The prompt for a project whose engine has shot(): same pipeline, but the shots are described, not drawn with Hero and poseAt. */
export function modernSystemPrompt(): string {
  let p = SYSTEM_PROMPT;
  p = swapBlock(p, '   - **1. Architecture des décors', '   - **3. Découpage', `   - **1. Le lieu**: une recette \`place()\` (catalogue, ambiance et palette propres à cette histoire) ou des pièces à toi, en 3 couches de profondeur : mur du fond, mobilier et personnages, premier plan. Si le catalogue n'a pas ce qu'il faut, tu construis (voir le guide shot()).
   - **2. Casting, silhouettes distinctes & objet-clé (\`cast()\`)**: une ligne par personnage, chacun sa silhouette (\`hair\`, \`body\`, \`outfit\`), genre du narrateur aligné sur \`episode.json.voice.narratorGender\`. **Règle d'objet/vêtement-clé** : si l'histoire porte sur un objet ou un vêtement, donne-lui une couleur et une forme **distinctes**, et respecte la chronologie du récit (porté ou tenu seulement à partir du plan où le texte le dit).
`);
  p = swapBlock(p, '     - **Prise et tenue d', '6. **Step 5b', `     - **Objets tenus**: passe l'objet à \`handRProp\` / \`handLProp\` ; il suit la main. Un objet posé va dans un slot ou dans \`extra\`. Jamais d'objet flottant loin des mains.
`);
  p = p.replace('with imports, `makeLook` cast, shared custom set components, and shots', 'with imports, the cast(), the place() constants, and shots');
  p = swapBlock(p, '   - **Custom Characters', '   - **Clock `t`', `   - **Write the shots with \`shot({...})\`** (see the shot() section): place, cam, people with an act and a face. A hand-written <Stage> or camT shot is the way out for what shot() cannot do; both mix in one episode.
`);
  p = swapBlock(p, '- Sets and characters: define ONE', '- Framing.', `- Places and characters: define each place once with place() and each character once with cast(), at the top of \`shots.tsx\`, and reuse them in every shot. Never invent external image/audio file paths.
`);
  return p;
}

function fileList(projectRoot: string, cap = 260): string {
  const all = walk(projectRoot, { maxFiles: 2000 });
  // Prioritize episode sources and root files; skip noisy library/public assets so src/episodes is never pushed out
  const priority = all.filter((f) => f.startsWith('src/episodes/') || !f.includes('/'));
  const rest = all.filter(
    (f) => !f.startsWith('src/episodes/') && f.includes('/') && !f.startsWith('library/') && !f.startsWith('public/'),
  );
  return [...priority, ...rest].slice(0, cap).join('\n');
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
import { Hero, LOOKS, makeLook, basePose, poseAt, actPose, walkPose, faceAt, talkAt, handWorld, ikArm, reachPose, grabAt, tableSit, camT, camPush, camPan, parallax, kf, rnd, ShotProps, Foreground } from '../../engine';
import { makeRoom, RoomShell, CustomRoom, Box, FloorShadow, stand, BackWindow, Pendant, WallLight, FloorPlant, WallFrame, DiningTable, MonitorSetup, Tabletop, Study, STUDY, Desk, Bedroom, BEDROOM, bedSit, BedDuvet, Kitchen, KITCHEN, islandTop, Classroom, CLS, CLASS_MOODS, WallBoard, PinBoard, Rooftop, Stairwell } from '../../engine';
import { Outdoor, OUTDOOR, Tree, StreetLamp, CarExterior, Vehicle, carSit, VehicleForeground, Schematic, DrawOn, SchLabel, CountUp, Arrow, TitleCard } from '../../engine';

// 1. Custom character looks with distinct silhouettes (extra) and contrasting colours:
// extra: 'hood'|'curls'|'bunches'|'bob'|'suit'|'cap'|'beanie'|'spiky'|'afro'|'ponytail'|'bald'|'helmet'
// accessory: 'headphones'|'headset'|'glasses'|'beard'|'mustache'|'scarf'|'tie'|'badge'|'none'
const NARRATOR = makeLook({ skin: '#F2D2B6', jacket: '#3A86FF', accent: '#FFBE0B', hair: '#2B1E1A', extra: 'spiky', accessory: 'none' });
const PARTNER  = makeLook({ skin: '#D89B72', jacket: '#E05780', accent: '#FFE5EC', hair: '#1E1418', extra: 'curls', accessory: 'glasses' });
const THIRD    = makeLook({ skin: '#C98850', jacket: '#2A9D8F', accent: '#FFE5EC', hair: '#1E1418', extra: 'bunches' });

// 2. Custom episode set in 3 depth layers + Two-Shot + Physical Object Grabbing + Lip-Sync:
export const S1: React.FC<ShotProps> = ({ t, len }) => {
  const seatL = tableSit(760, 690, 'left');
  const seatR = tableSit(1160, 690, 'right');
  const grab = grabAt(t, { ...basePose, ...seatL }, { x: 885, y: 678 }, { x: 800, y: 635 }, 10, Math.min(len - 6, 28), 'R');
  const poseL = poseAt(t, [
    { f: 0, p: { ...seatL, ...actPose('talk', t), armR: grab.arm } },
    { f: Math.round(len * 0.6), p: { ...seatL, ...actPose('explain', t), armR: grab.arm } },
  ]);
  const poseR = poseAt(t, [
    { f: 0, p: { ...seatR, ...actPose('idle', t) } },
    { f: Math.round(len * 0.55), p: { ...seatR, ...actPose('leanIn', t) } },
  ]);
  const faceL = faceAt(t, [[0, 'happy'], [Math.round(len * 0.5), 'shock']]);
  const faceR = faceAt(t, [[0, 'neutral'], [Math.round(len * 0.45), 'smug']]);
  return (
    <g transform={camPush(t, len, 960, 575, 1.18, 1.28)}>
      {/* Layer 1 (Background): custom room walls, window, wall decor — unique id per shot! */}
      <CustomRoom r={STUDY} t={t} id="s1room" wall="#3B2834" side="#2D1E28" floorC="#2A1C18" night>
        <WallFrame x={650} y={250} w={130} h={95} art={0} />
        <WallFrame x={1140} y={250} w={130} h={95} art={1} />
        <FloorPlant r={STUDY} u={0.14} w={0.18} size={0.85} />
        {/* Layer 2 (Midground): seated characters BEFORE <DiningTable> so the table occludes their lower waist/legs */}
        <Hero look={NARRATOR} pose={{ ...basePose, ...poseL, ...faceL, talk: talkAt(t, len) }} />
        <Hero look={PARTNER} pose={{ ...basePose, ...poseR, ...faceR }} />
        {/* Layer 3 (Foreground): wooden table/desk & physically held/grabbed prop (only pass cloth/candle/plates in restaurant scenes) */}
        <DiningTable x={960} y={690} w={480} wood="#8C6239">
          <g transform={\`translate(\${grab.propPos.x} \${grab.propPos.y})\`}>
            <rect x={-16} y={-24} width={32} height={24} rx={4} fill="#7BDFF2" stroke="#1E1824" strokeWidth={3} />
          </g>
        </DiningTable>
      </CustomRoom>
    </g>
  );
};

// 3. Over the shoulder, in profile: the listener is a big dark blurred foreground figure cut by the frame edge
//    (about a third of the frame), the speaker is sharp, off-centre, facing the listener.
//    (x values below suit a 9:16 medium: only 900/zoom units are visible across; spread them wider in 16:9.)
export const S2: React.FC<ShotProps> = ({ t, len }) => {
  const speaker = poseAt(t, [
    { f: 0, p: { x: 1130, y: 700, scale: 1.3, yaw: -0.5, facing: -1, ...actPose('talk', t) } },
    { f: Math.round(len * 0.6), p: { armL: { a: 40, b: 50 } } },
  ]);
  const face = faceAt(t, [[0, 'neutral'], [Math.round(len * 0.6), 'worried']]);
  return (
    <g transform={camPush(t, len, 1000, 640, 1.5, 1.65)}>
      <CustomRoom r={STUDY} t={t} id="s2room" wall="#3B2834" side="#2D1E28" floorC="#2A1C18">
        <Hero look={PARTNER} pose={{ ...basePose, ...speaker, ...face, talk: talkAt(t, len) }} rimId="rimL" />
      </CustomRoom>
      <Foreground blur={16}>
        <Hero look={NARRATOR} pose={{ ...basePose, x: 690, y: 830, scale: 2.3, yaw: 0.85, facing: 1 }} shadow={0} />
      </Foreground>
    </g>
  );
};

// 4. A group of three: staggered depth (further = smaller and higher), a different yaw each, the speaker in front.
//    Draw back to front so the near ones overlap the far ones.
export const S3: React.FC<ShotProps> = ({ t, len }) => {
  const back = poseAt(t, [{ f: 0, p: { x: 1260, y: 690, scale: 0.85, yaw: -0.7, facing: -1, ...actPose('idle', t) } }]);
  const mid = poseAt(t, [{ f: 0, p: { x: 1010, y: 725, scale: 1.0, yaw: -0.4, facing: -1, ...actPose('shock', t) } }]);
  const front = poseAt(t, [
    { f: 0, p: { x: 760, y: 780, scale: 1.25, yaw: 0.5, facing: 1, ...actPose('talk', t) } },
    { f: Math.round(len * 0.5), p: { ...actPose('explain', t) } },
  ]);
  return (
    <g transform={camT(1000, 640, 1.15)}>
      <CustomRoom r={STUDY} t={t} id="s3room" wall="#3B2834" side="#2D1E28" floorC="#2A1C18">
        <Hero look={THIRD} pose={{ ...basePose, ...back, ...faceAt(t, [[0, 'worried']]) }} rimId="rimL" />
        <Hero look={PARTNER} pose={{ ...basePose, ...mid, ...faceAt(t, [[0, 'shock']]) }} rimId="rimL" />
        <Hero look={NARRATOR} pose={{ ...basePose, ...front, ...faceAt(t, [[0, 'happy']]), talk: talkAt(t, len) }} />
      </CustomRoom>
    </g>
  );
};`;


export type EpisodeStatus = {
  slug: string;
  words: number;
  seconds: string;
  done: string[];
  todo: string[];
  title: string;
  mtimeMs: number;
};

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
    const epFile = path.join(src, 'episode.json');
    let ep: any = {};
    let mtimeMs = 0;
    try {
      ep = JSON.parse(fs.readFileSync(epFile, 'utf8'));
      mtimeMs = fs.statSync(epFile).mtimeMs;
    } catch {
      continue;
    }
    const dir = path.join(projectRoot, 'out', slug);
    const has = (rel: string) => fs.existsSync(path.join(dir, rel));
    const words = countScriptWords(ep.script);
    const steps: [string, boolean][] = [
      ['script', Array.isArray(ep.script) && ep.script.length > 0 && !JSON.stringify(ep.script).includes('TODO')],
      ['words', fs.existsSync(path.join(src, 'words.json'))],
      ['timeline', fs.existsSync(path.join(src, 'timeline.json')) && Number(ep?.shots?.length ?? 0) > 1],
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
      mtimeMs,
    });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
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

/** Resolve which episode slug this conversation is working on, or fall back to the most recently modified episode. */
export function activeEpisodeSlug(projectRoot: string, history?: MessageRow[]): string | null {
  const status = episodeStatus(projectRoot);
  if (!status.length) return null;
  const known = new Set(status.map((s) => s.slug));
  if (history?.length) {
    for (let i = history.length - 1; i >= 0; i--) {
      const row = history[i]!;
      if (row.payload) {
        try {
          const p = JSON.parse(row.payload);
          for (const tc of p?.toolCalls ?? []) {
            const ep = tc?.args?.episode;
            if (typeof ep === 'string' && known.has(ep)) return ep;
            const pth = String(tc?.args?.path ?? '');
            const m = /^src\/episodes\/([^/]+)\//.exec(pth);
            if (m && known.has(m[1]!)) return m[1]!;
          }
        } catch {
          /* ignore */
        }
      }
      for (const slug of known) {
        if (new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(row.content)) {
          return slug;
        }
      }
    }
  }
  const inProgress = status.find((e) => e.done.some((d) => d !== 'script') && e.todo.length > 0);
  return (inProgress ?? status[0])!.slug;
}

/** The steps the active episode still owes, or [] when nothing is running. */
export function pipelineTodo(projectRoot: string, history?: MessageRow[]): string[] {
  const status = episodeStatus(projectRoot);
  if (!status.length) return [];
  const targetSlug = activeEpisodeSlug(projectRoot, history);
  const target = status.find((s) => s.slug === targetSlug) ?? status[0]!;
  return target.todo.filter((t) => t !== 'script');
}

/**
 * Pin the active episode's continuity bible, DIRECTOR.md, shared shots.tsx header (makeLook + set components),
 * last exported shot, and the remaining unexported shots (with frame lengths and spoken words) right in the
 * system header. This ensures small/Flash models never lose track of character looks, set props, or shot IDs
 * across compacted batches on long episodes.
 */
export function episodePin(projectRoot: string, history?: MessageRow[]): string {
  const slug = activeEpisodeSlug(projectRoot, history);
  if (!slug) return '';
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  if (!fs.existsSync(epDir)) return '';

  const parts: string[] = [`## Active episode continuity pin (${slug})`];

  const bibleRaw = (readText(epDir, 'bible.json', 4_000) ?? '').trim();
  if (bibleRaw) {
    parts.push(`### bible.json\n\`\`\`json\n${bibleRaw.slice(0, 2_500)}\n\`\`\``);
  }

  const directorRaw = (readText(epDir, 'DIRECTOR.md', 8_000) ?? '').trim();
  if (directorRaw) {
    parts.push(`### DIRECTOR.md (pinned for continuity)\n${directorRaw.slice(0, 3_200)}`);
  }

  let epJson: any = null;
  let tlJson: any = null;
  try {
    epJson = JSON.parse(fs.readFileSync(path.join(epDir, 'episode.json'), 'utf8'));
  } catch {
    /* ignore */
  }
  try {
    tlJson = JSON.parse(fs.readFileSync(path.join(epDir, 'timeline.json'), 'utf8'));
  } catch {
    /* ignore */
  }

  const shotsRaw = readText(epDir, 'shots.tsx', 120_000) ?? '';
  const isStub = shotsRaw.includes('SHOT S1 — PLACEHOLDER');
  const exportMatches = [...shotsRaw.matchAll(/export\s+(?:const|function)\s+(S\d+)\b/g)];
  const exportedIds = isStub ? [] : exportMatches.map((m) => m[1]!);
  const exportedSet = new Set(exportedIds);

  const tlShots: any[] = Array.isArray(tlJson?.shots) ? tlJson.shots : [];
  const epShotsMap = new Map<string, any>();
  for (const s of Array.isArray(epJson?.shots) ? epJson.shots : []) {
    if (s?.id) epShotsMap.set(String(s.id), s);
  }

  if (tlShots.length > 1) {
    const missing = tlShots.filter((s) => !exportedSet.has(String(s.id)));
    parts.push(
      `### Shots progress (${exportedIds.length}/${tlShots.length} exported in shots.tsx)\n` +
        `- Exported: ${exportedIds.length ? exportedIds.join(', ') : '(none yet)'}\n` +
        `- Remaining to export: ${missing.length ? missing.map((s) => s.id).join(', ') : '(all exported!)'}`,
    );
    if (missing.length > 0) {
      const nextBatch = missing.slice(0, 12).map((s) => {
        const id = String(s.id);
        const epS = epShotsMap.get(id) ?? {};
        const size = epS.size ?? s.size ?? 'medium';
        const set = epS.set ?? 'custom';
        const note = epS.note ?? '';
        return `  - ${id}: len=${s.len}f (${(Number(s.len || 60) / 30).toFixed(1)}s), size="${size}", set="${set}", words="${note}"`;
      });
      parts.push(`### Next shots to write (use these exact IDs, lengths and sizes):\n${nextBatch.join('\n')}`);
    }
  }

  if (!isStub && exportMatches.length > 0) {
    const firstIdx = exportMatches[0]!.index ?? 0;
    const header = shotsRaw.slice(0, firstIdx).trim();
    if (header) {
      parts.push(
        `### Shared header in shots.tsx (reuse these exact characters and places in subsequent batches):\n\`\`\`tsx\n${header.slice(0, 2_800)}\n\`\`\``,
      );
    }
    const lastMatch = exportMatches[exportMatches.length - 1]!;
    const lastCode = shotsRaw.slice(lastMatch.index ?? 0).trim();
    if (lastCode) {
      parts.push(`### Last exported shot in shots.tsx (${lastMatch[1]}):\n\`\`\`tsx\n${lastCode.slice(0, 1_200)}\n\`\`\``);
    }
  }

  return parts.length > 1 ? parts.join('\n\n') : '';
}

export type BuildOptions = {
  projectRoot: string;
  history: MessageRow[];
  maxChars: number;
};

/** Compact large write_file / edit_file tool call payloads from older steps so they don't blow up the context window. */
function compactToolCalls(calls: ToolCall[] | undefined, age: number): ToolCall[] | undefined {
  if (!calls?.length) return undefined;
  if (age <= 2) return calls;
  return calls.map((c) => {
    if (c.name === 'write_file' && typeof c.args?.content === 'string' && c.args.content.length > 600) {
      const lines = c.args.content.split('\n').length;
      const exportsInChunk = [...c.args.content.matchAll(/export\s+(?:const|function)\s+([A-Za-z0-9_$]+)\b/g)].map((m) => m[1]);
      const expNote = exportsInChunk.length ? ` (exports: ${exportsInChunk.join(', ')})` : '';
      return {
        ...c,
        args: {
          ...c.args,
          content: `[compacted: ${lines} lines (${c.args.content.length} chars)${expNote} written to ${String(c.args.path ?? 'file')} — current file & header are pinned above]`,
        },
      };
    }
    if (c.name === 'edit_file' && Array.isArray(c.args?.edits) && JSON.stringify(c.args.edits).length > 800) {
      return {
        ...c,
        args: {
          path: c.args.path,
          edits: [{ oldText: '[compacted]', newText: `[${c.args.edits.length} edit(s) applied to ${String(c.args.path ?? 'file')}]` }],
        },
      };
    }
    return c;
  });
}

function messageCharCost(msg: ChatMessage): number {
  let cost = 'content' in msg ? msg.content.length : 0;
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      cost += tc.name.length + JSON.stringify(tc.args ?? {}).length + 24;
    }
  }
  if (msg.role === 'user' && msg.images?.length) {
    cost += msg.images.length * 2_000;
  }
  return cost;
}

/** Compile the conversation: stable system prefix first (for prompt caching), live state, then compacted history. */
export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const pin = episodePin(opts.projectRoot, opts.history);
  // Put static instructions and engine signatures first so LLM prompt caches hit on every step of a turn
  const engineHas = (file: string) => fs.existsSync(path.join(opts.projectRoot, 'src', 'engine', file));
  const modern = engineHas('shot.tsx');
  const head: ChatMessage[] = [
    { role: 'system', content: modern ? modernSystemPrompt() : SYSTEM_PROMPT },
    ...(modern ? [] : [{ role: 'system' as const, content: ENGINE_CHEAT }]),
    { role: 'system', content: modern ? modernDirectorGuide() : DIRECTOR_GUIDE },
    ...(modern ? [{ role: 'system' as const, content: SHOT_GUIDE }] : []),
    ...(engineHas('stage.tsx') ? [{ role: 'system' as const, content: STAGE_GUIDE }] : []),
    {
      role: 'system',
      content: `## Every engine export and its props (generated from src/engine)\n${engineDigest(opts.projectRoot)}\n\nThis listing is the contract: do not read src/engine/*.tsx again unless a typecheck or a render error names a specific line.`,
    },
    { role: 'system', content: `## Project folder\n${opts.projectRoot}\n\n${memory(opts.projectRoot)}` },
    { role: 'system', content: `## Files\n${fileList(opts.projectRoot)}` },
    {
      role: 'system',
      content: `## Where the episode stands (live, recomputed each turn)\n${projectState(opts.projectRoot)}\n\nDo the next todo step; do not re-read files you already know unless a step fails.`,
    },
    ...(pin ? [{ role: 'system' as const, content: pin }] : []),
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
    if (row.role === 'assistant' && age > 6) content = content.slice(0, 1_500);

    const msg = toChatMessage(row, payload, content, opts.projectRoot, imageBudget, age);
    const cost = messageCharCost(msg);
    if (used + cost > opts.maxChars && kept.length >= 4) {
      dropped = i + 1;
      break;
    }
    used += cost;
    kept.unshift(msg);
  }

  // Never start the kept window with orphan `tool` messages whose preceding `assistant` (with tool_calls) was dropped
  while (kept.length > 0 && kept[0]!.role === 'tool') {
    kept.shift();
    dropped++;
  }
  // Ensure every assistant tool_call in `kept` has its matching tool results, and vice-versa
  const validCallIds = new Set<string>();
  for (const m of kept) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) validCallIds.add(tc.id);
    }
  }
  const sanitized = kept.filter((m) => m.role !== 'tool' || validCallIds.has(m.toolCallId));

  const out = [...head];
  if (dropped > 0) {
    out.push({
      role: 'system',
      content: `(${dropped} older messages were compacted to stay inside the context window. Check Where the episode stands above or read_file if you need details; .git keeps checkpoints.)`,
    });
  }
  out.push(...sanitized);
  return out;
}

function toChatMessage(
  row: MessageRow,
  payload: any,
  content: string,
  projectRoot: string,
  imageBudget: { left: number },
  age = 0,
): ChatMessage {
  if (row.role === 'tool') {
    return { role: 'tool', toolCallId: String(payload?.toolCallId ?? ''), name: String(payload?.name ?? 'tool'), content };
  }
  if (row.role === 'assistant') {
    return { role: 'assistant', content, toolCalls: compactToolCalls(payload?.toolCalls, age) };
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
