/**
 * The director's guide handed to the agent as a system message, so it does not have to read the skill's
 * references (they are not always mounted, and reading them costs steps). Condensed from the what-if-animation
 * skill (references/look.md, kit.md, traps.md), plus the 9:16 geometry measured from engine/episode.tsx.
 * Keep it short: it is paid for on every step of every turn.
 */
/** How to place people in depth. Sent only when the project's engine has src/engine/stage.tsx (the overlay). */
export const STAGE_GUIDE = `## Stage: place people on the ground (this project's engine has it)
Prefer <Stage> to literal x / y / scale for every shot with people in a room or outdoors: it computes position, size,
what hides what, the contact shadow and how far things feel.

const G = roomGround(CLS); // or STUDY, BEDROOM, KITCHEN, OUTDOOR, any makeRoom box
const DESK = { u: 0.43, w: 0.27 };
export const S4: React.FC<ShotProps> = ({ t, len }) => (
  <g transform={camT(900, 575, 1.1)}>
    <Stage ground={G}>
      <ClassroomShell t={t} id="s4" tokens={TOKENS} board={BOARD} deskProps={false} />
      <Staged at={{ u: 0.4, w: 0.08 }} look={PROF} pose={{ yaw: 2, armL: { a: 150, b: 20 } }} />
      <DeskAt at={DESK} tokens={TOKENS} />
      <Staged at={deskSeat(DESK)} seated body="teen" look={STUDENT} pose={{ yaw: 2 }} />
      <Staged at={{ u: 0.68, w: 0.46 }} look={LEO} rimId="rimL" pose={{ yaw: -0.5, facing: -1, ...actPose('idle', t) }} />
      <Staged at={{ u: 0.36, w: 0.6 }} body="teen" look={LOU} pose={{ yaw: 0.5, ...actPose('talk', t), talk: talkAt(t, len) }} />
    </Stage>
  </g>
);

- \`at\`: u is across the floor (0 left wall, 1 right wall), w is depth (0 back wall, 1 at the camera). Do not put x, y or scale in the pose.
- Depth guide: w 0.05-0.2 background (small), 0.3-0.5 middle, 0.55-0.7 foreground (large), above 0.75 only as a figure cut by the frame edge.
- True perspective makes near people big, and they hide what is behind them: put the near person on one side and leave the far subject visible
  in the gap. Three depths read better than three people in a row.
- In 9:16 at zoom about 1.1, keep u within 0.2-0.8 at the back and 0.3-0.7 in front, or the person is cut by the frame.
- \`body\`: "adult" (default) or "teen" set the proportions and the height; defineBody('adult', { chest: 1.25, belly: 16, arm: 14, leg: 15 }) makes your own. \`seated\` sits the character at chair height; deskSeat(desk) is the place at a <DeskAt at={desk}>.
- Stage sorts its DIRECT children by depth, so write them in any order. A custom component that holds several people is sorted as one block.
  Give your own component an \`at\` or a numeric \`depth\` prop, or wrap SVG in <StageItem depth={0.4}>, to place it in depth (\`w\` means width on engine components).
  A child with no depth written before the first placed element is background; written after it, foreground (a <Foreground> amorce).
- A set that draws its own furniture stays behind everyone: use ClassroomShell + DeskAt when people go between the desks.
- \`focus={0.6}\` on Stage keeps that depth sharp and softens the rest (close-ups, one shot in three at most).
- Not a room? planeGround({ x0, x1, far: { y, scale }, near: { y, scale } }) for a deck or a side-on ground, or at={{ x, y, scale, w }} for
  anything else (y is the floor point under the feet). Outside a Stage use <Person body="teen" pose={...}> (same pose as <Hero>, x / y / scale in the pose).
- Hands and props with a body other than adult: handOf(pose, 'R', body), reachOf(pose, target, 'R', body), grabOf(t, pose, from, to, 10, 28, 'R', body), or simply the handRProp slot.
- In profile both arms reach forward; yaw alone gives the direction, no need for facing.

### Characters: build them with cast()
const LOU = cast({ seed: 'lou', body: 'teen', kind: 'fem', hair: 'long', outfit: ['hoodie:rose', 'jeans'], face: { marks: 'freckles' } }); then look={LOU} (the body comes with it).
Whatever you leave out is filled from \`seed\`, always the same way, so one name is enough for a varied extra: cast({ seed: 'extra1', body: 'teen' }). One seed per character. kind: fem | masc | any.
- hair: long braids bun buzz sidepart wavy fringe mohawk dreads hijab curls bunches bob suit cap beanie spiky afro ponytail bald helmet hood, or { style, color } with black brown chestnut auburn blond red grey white.
- outfit: tshirt shirt hoodie sweater / blazer labcoat apron coat / jeans pants shorts skirt / sneakers boots formal / tie scarf / backpack. Colour after a colon: rose navy teal mustard plum olive coral sky red green black grey white cream denim khaki brown, or a hex.
- face: eyes round almond sleepy wide; brows none thin thick arched; nose none button long wide; marks none freckles mole blush dimples wrinkles; facial none stubble mustache goatee beard.
- acc: glasses:round glasses:square glasses:sun earrings headband:teal headphones headset. skin: porcelain peach sand tan bronze brown deep.
Something the list does not have (a uniform, a crown, a costume)? Draw it in the torsoGear or headGear slot, or fall back on makeLook.`;

export const DIRECTOR_GUIDE = `## Director's guide (read before writing shots.tsx; this replaces the skill's references)

### Camera
- World = 1920x1080 units. camT(cx, cy, zoom) puts world point (cx, cy) at the frame centre. The frame shows:
  16:9 -> 1920/zoom wide x 1080/zoom tall.   9:16 -> **900/zoom wide** x 1600/zoom tall (viewBox 510 -260 900 1600).
  So in 9:16 a room 1200 wide only fits at zoom <= 0.75; at zoom 1.3 you see 690 units across: that is a medium, not a wide.
- The engine's rooms are drawn for 16:9: in 9:16 the room is only a band across the middle of the tall frame, so at zoom ~1 the
  top third is dark ceiling and the bottom is dark floor (checked on a render). In 9:16 prefer mediums, centre cy around
  600-680 so the characters fill the band, and use a wide (zoom 0.9-1.1) only as a short establishing beat or with a prop to fill it.
  Three people side by side need about 780 units: at most zoom 1.15 in 9:16.
- Sizes (16:9 / 9:16 zoom): wide 0.75-1.1 / 0.9-1.1 · medium 1.6-2.0 / 1.3-1.7 · close-up 3-4.5 / 2.4-3.4 · macro insert 3-4.5.
  Allowed range is 0.6-4.5. A wide shows the character small inside a lit, full room.
- Cuts come from CHANGING SIZE and ANGLE, not from motion. Two neighbouring shots never share size + angle.
  A board has wides, inserts, mediums, close-ups and at least one high or low angle. Keep a hold under ~3 s unless
  something moves inside it (dust, steam, a sway, a slow push-in with camPush).
- A shot may have NO character (an establishing wide, an object insert, a UI screen): set its "size" to
  "establishing" or "insert" in episode.json and the audit accepts it. Use it when the line is about a place or a thing.

### Staging and orientation (the biggest visual gap)
- Characters are **mostly three-quarter or profile, rarely face-on**. \`yaw\` is a compass: 0 front · +-0.45 three-quarter (a nose
  appears) · +-1 profile (a drawn profile head: nose, ear, one eye) · +-2 seen from behind (hair or hat only, plain jacket back).
  Positive faces screen-right, negative screen-left; keep \`facing\` the same sign as yaw. The engine swaps the drawing at 0.2,
  0.72 and 1.3, so a turn reads best on a cut or a blink, not as a slow slide. walkPose() is already a profile (yaw 0.85).
  Use the back view for a teacher writing at the board, someone looking out of a window, a character walking away.
  Face-on only for a direct-to-camera beat (shock, realisation) or a title.
  (Needs the engine overlay; an older engine copy still treats yaw as a slide of the face, see whatif_sync_engine.)
- Two people talking: give them opposite yaw so each faces the other (left one +0.4, right one -0.4), then alternate close-ups.
- The raised/acting hand is the NEAR one: with yaw < 0 the far arm hides behind the body, so act with armL.
- Seated characters are seated **in profile**: thighs forward (a ~80), shins back (b ~-80). tableSit() does this at its default
  yaw; a seated figure facing camera reads as standing behind the furniture.
- Groups (3+): never three identical figures in a row at the same height. Vary scale (further = smaller, hips higher),
  overlap them, give each a different yaw and a different pose. Put the speaker in front, reactors behind.
- Over the shoulder: a big dark blurred figure fills about a third of the frame in the foreground
  (<Foreground blur={16}> around a Hero or a head) and the other character is sharp. A small foreground figure reads as a mistake.
  Use a foreground blur in about a third of the shots (a desk edge, a shoulder, a plant): depth matters.
- Acting must read without the voice: expression matches the line (faceAt swaps through a blink, never morphs); anticipation
  before a big move, a 2-frame hold when the character realises, overshoot on landings. Life also comes from around them:
  dust, a swaying lamp, a flash on an impact, a push-in.

### Light and world
- Every light comes from something visible (window, lamp, pendant, screen). Pools of light, dark corners. LightVeil at 0.28 in a
  wide that must show the floor, 0.42-0.5 elsewhere; a light "hole" is about the size of its pool, not of the wall.
- Warm rim light on the lit side of every character (rimId "rimR" / "rimL"). The face is the brightest thing in its area:
  props sit a step darker than the character. Never a dark limb on a dark wall.
- A wide shows 20+ designed objects: no empty wall, no floating furniture. Everything that stands has legs and a contact
  shadow (FloorShadow).
- **Wall-mounted things (a blackboard, a clock, frames, a window) are flat shapes drawn on the back wall at wall
  coordinates (x, y). Never a deep <Box> for them:** a Box with depth reads as a plank floating in the room.
- BackWindow draws curtains by default: pass curtains={false} outside a home. Its sky is dusk unless you set night/red:
  a daytime school scene must not show a purple dusk sky.
- Perspective holds: objects sit on their surfaces, at the right scale for the character, toward the room's vanishing point.

### Choosing the set
1. The place matches an engine set (Classroom, Bedroom, Kitchen, Study, Rooftop, Stairwell, Outdoor, Vehicle): start from it.
   Classroom is a TEMPLATE: \`tokens={{ ...CLASS_MOODS.day, wall: '#9ED8C6' }}\` re-colours it (walls, floor, sky, light; moods day / night),
   and slots carry the story: \`board\` (what is written; <g /> for a blank board), \`deskProps\`, \`pinboard\`, \`rows\` (layout; \`len\` 0.4
   makes lecture-hall benches), \`kids\`, \`windows\` (0 = none), \`extra\` (e.g. a Glow for a lamp). Pick a mood that fits the story's
   time and tone (a primary school is bright and colourful, a lecture hall dark and windowless, a night class bluish with a lamp).
   The other sets keep their fixed look and demo content: read their props in the export list and clear what does not belong
   (the default Classroom board says "7 x 8 = ?", the desk holds an apple and a globe: never leave them in another story).
   Flat wall pieces (WallBoard, PinBoard, WallClock) work in any room: a whiteboard in a meeting room is the same piece.
2. The place is not covered, or the set's mood does not fit the story's time of day / tone: build it with CustomRoom / RoomShell /
   Box / FloorShadow from the room kit, in ONE shared set component at the top of shots.tsx.
3. Never copy a set or a shot from another episode: reuse engine parts, not another story's scene.
- Define the set once (tokens included) and reuse that component in every shot of the same place: same layout, same props in the same spots.
  In 9:16 the left-wall windows are out of frame: show time of day with light (ceiling panels, a lamp Glow) and wall colour, not the sky.
  Give each shot's set a unique id (id="s7") and a different one again if the same set renders twice in one frame.

### On-screen text
Almost none: the title card and diegetic UI (a phone screen, a message, a timer chip). No captions of the voice, no "HA HA".
All labels in the episode's language. Every number is real and sourced.

### Board self-check (run it shot by shot on the full-size stills, not only on the contact sheet)
1 one read in a second at phone size · 2 sizes change · 3 light from a visible source · 4 the character pops (face brightest, rim light)
· 5 depth (foreground blur ~1 shot in 3, soft background on close-ups) · 6 the world is full · 7 perspective holds · 8 acting matches the line
· 9 continuity of costume, layout and props across shots of one place · 10 text only where allowed, spelled right, inside the frame
· 11 original characters only, nothing resembling a famous one.
Fix, re-render only the shots that fail (stills with their ids), rebuild the board, look again.

### Traps that cost time before
- Clock t is in FRAMES at 30 fps; no Math.random (use rnd(seed, i)); everything derives from t so a shot can be held or reversed.
- A hand cannot touch the head (the head is drawn after the arms): in a close-up leave the rig's arms down and draw the arm yourself.
- Props near a hand get read as the hand: keep clear space around hands.
- Mid-ground characters must sit inside the crop of EVERY shot that uses the set, not only the wide.
- Focus rings scale with the camera: wrap them in scale(0.4) about the head.
- Never cut to an empty frame: something is already on at the shot's first frame.`;
