# engine-overlay

Improvements to the studio engine that this app owns, because the engine itself comes from the external
`what-if-animation` skill and each project keeps its own copy (4 diverging copies at the time of writing).

`src/tools/engine-overlay.ts` applies this folder on top of a project's `src/engine`:

- `files/` : copied over the project (new files are added, `classroom.tsx` is replaced by the template version);
- patches (in the module): small idempotent text edits located by an anchor (the engine's own files differ slightly
  from one project to the next, so a patch that cannot find its anchor reports it and changes nothing).

It runs when `whatif_new` creates a project and with `whatif_sync_engine { apply: true }` on an existing one
(that works without the skill mounted: only the overlay is applied then).

## What it adds

- `pieces.tsx`: `WallBoard`, `PinBoard`. Flat wall pieces with no story and no fixed colours.
- `sets/classroom.tsx`: `Classroom` as a **template**: `tokens` (colours, sky, light, veil; `CLASS_DEFAULT`, `CLASS_MOODS.day|night`)
  and **slots** (`board` writing, `deskProps`, `pinboard`, `rows` incl. `len` for long benches, `kids`, `windows`, `clock`,
  `cubbies`, `extra`). With no props it renders exactly the original classroom (checked pixel for pixel).
- patch: `RoomShell` keeps its floor darkening below the near plane (a tall 9:16 frame reaches it).
- `views.tsx` + a patch of `rig.tsx`: **views of the character**. `yaw` becomes a compass (0 front, ±0.45 three-quarter with a nose, ±1 a drawn profile head, ±2 from behind with a plain jacket back), for the 12 hairstyles and the accessories. The front view is unchanged. Older engine copies whose `Hero` differs get no `rig.tsx` change (the patch is all-or-nothing) and keep the old behaviour.

Behaviour change worth knowing: with the overlay, a `yaw` of 0.72 or more (and `walkPose`, which uses 0.85) now draws a real profile head instead of a front head with a slid face.

## Person

`person.tsx` is the rig redrawn from measurements: `<Person body="teen" pose={...} />` takes the same pose and slots as `<Hero>`. An adult seen from the front is pixel-identical to `<Hero>`. Bodies are data (`BODIES`, `defineBody`). In profile the arms reach forward, seated legs foreshorten from the front and back, and `yaw` alone gives the direction. Hands and props use `handOf`, `ikArmOf`, `reachOf`, `grabOf`, which take the body. `<Staged>` renders a `Person`.

## Stage

`stage.tsx` places things by ground position: `<Stage ground={roomGround(CLS)}>` with `<Staged at={{ u, w }}>` computes position, size, draw order (far to near, whatever order they are written in), contact shadow, a slight dimming with distance and, with `focus`, softness away from the focus. `sets/classroom.tsx` adds `ClassroomShell`, `DeskAt` and `deskSeat` so desks sort with people. Depth is read only from `at` or a numeric `depth` prop: `w` means width on most engine components. `roomGround` covers every `makeRoom` box (indoors and `OUTDOOR`), `planeGround` a flat ground, and `at={{ x, y, scale }}` anything else. `fade={0}` turns the dimming off (it costs about 25% render time).

`examples/stage-scenes.tsx` and `stage-order.tsx` are the render checks.

`examples/views-sheet.tsx` renders the 12 hairstyles in 6 turns. `examples/classrooms.tsx` renders a lycée by day, a primary school, a lecture hall, a night class and a meeting room
(not a school) from the same pieces. It is a reference, not part of the engine.
