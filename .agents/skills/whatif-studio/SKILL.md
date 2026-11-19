---
name: whatif-studio
description: >-
  End-to-end 2D animated video production (9:16 Shorts or 16:9 episodes, in French or English) using the What If Studio MCP tools, :8005 TTS/ASR, Modal cloud rendering, and a mandatory Independent Reviewer subagent. Use this skill whenever the user asks to create, generate, edit, review, or render a What If animated video, Short, or :8005 video ID episode directly from Antigravity CLI.
---

# What If Studio — End-to-End Video Production (`agy` CLI + Subagent Reviewer)

Produce complete 2D SVG + Remotion episodes (`out/<episode>/<episode>-final.mp4` mastered at `-14 LUFS`, `9:16` `1080×1920` or `16:9` `1920×1080` @ 30fps) unattended from start to finish using the **`whatif-studio` MCP server** and an **Independent Reviewer subagent**.

Before coding any shot (`shared.tsx` or `whatif_edit_shot`), you **MUST** read [references/director-guide.md](./references/director-guide.md) once for the exact `shot()`, `cast()`, `place()`, `phoneShot()`, `tabletopShot()`, 6-wall perspective (`view`), `ots`/`pov`, and 9:16 framing rules.

---

## Mandatory Pipeline Order (Run End-to-End Without Stopping)

Never stop halfway to ask "should I continue?". Run every step in order until `<episode>-final.mp4` is mastered:

### 1. Create Project & Import `:8005` Source (or Write Standalone Script)
1. Call MCP `whatif_create_project`:
   - Pass `{ episode: "<slug>", video: "<videoId>", aspect: "9:16" | "16:9" }` (default `"9:16"` for Shorts, `"16:9"` for long-form).
   - Note the returned `hostProjectRoot` (`/home/azy/Musique/2d/what-if-app/data/projects/<slug>`).
2. **If a `:8005` `video` ID was provided**:
   - Call MCP `whatif_run` with `{ episode: "<slug>", step: "source", args: ["--pick", "hook", "--apply"] }`.
   - **CRITICAL**: at import, NEVER translate, shorten or summarize the `:8005` proposal — whether it is in **French (`fr`)** or **English (`en`)**, keep the full text and continue in that same language. The only place where the text is corrected is step 1 bis.
   - Read `src/episodes/<slug>/episode.json` via `whatif_read_file` and set `"defaultSet"` to a clean short `place()` recipe slug (`"classroom"`, `"living"`, `"hospital"`, `"corridor"`, `"auditorium"`, `"street"`, `"office"`, `"bedroom"`, `"restaurant"`, etc.) via `whatif_write_file` (preserving `script`, `lang`, `voice`, `title`, and `aspect`).
3. **If standalone (no `:8005` video ID)**:
   - Write `src/episodes/<slug>/episode.json` following the 7-beat What If formula with sourced `science: [{ claim, working, source }]`, clean `"defaultSet"` slug, and `"lang": "fr"` or `"en"`.

### 1 bis. Read, Correct or Drop the Narration (Before `voice`)
`whatif_run voice` mechanically refuses to run until the script is approved. On the channel's published videos, a first sentence that is a precise act kept 76 % of the viewers against 62 % for an explanation.

1. `whatif_run { episode: "<slug>", step: "script" }` once: it freezes the original in `out/<slug>/script.orig.md` and returns the contract and the shape of the reading card.
2. Read the script against the contract, then write `out/<slug>/script-card.json` with `whatif_write_file`:
   - `"verdict": "good"`: the text respects the contract — do not touch it, do not correct for taste.
   - `"verdict": "fix"`: correct `episode.json.script` wherever needed (any part, ElevenLabs acting tags included) and list every change in `changes: [{ before, after, rule }]`. Never invent a fact, change the payoff, the narrator or the language. Keep 75–110 % of the original words; a dropped name or number goes in `removed`.
   - `"verdict": "discard"`: no payoff, no conflict, or not followable without the original pictures — give the `reason`, tell the user, and STOP (no voice). Never pass `--keep` yourself: it is the user's override.
3. `whatif_run { episode: "<slug>", step: "script" }` again. When it answers that the Reviewer must read the text:
   - launch the read-only `whatif-reviewer` subagent (it did not write the corrections) with the prompt: `"Review the narration of episode '<slug>': read out/<slug>/script-pack.md with whatif_read_file. Judge two things only: same story (no invented, changed or lost fact, same payoff, same narrator) and the contract written in the pack. Do not judge style. Save your verdict with whatif_save_script_review({ episode: '<slug>', pass, sameStory, sig, issues: [{ rule, quote, problem, fix }] }) (passing the mandatory Submitted-Sig token read from script-pack.md and explicit boolean sameStory) and report it."`
   - accepted: go to step 2. Refused: correct what it names, update the card, run step `script` again. A second refusal drops the story.
4. Never write `script-check.json`, `script-review.json` or `source.fit.md` yourself: the studio refuses it.

### 2. Voice, Shotlist & Timeline Plan
1. `whatif_run { episode: "<slug>", step: "voice" }` (do **NOT** pass `--force`: it automatically picks **Léa** or **Hugo** from the FR/EN script content, reuses matching `:8005` audio, and aligns word timestamps via Deepgram in `fr` or `en`).
2. `whatif_run { episode: "<slug>", step: "shotlist" }`
3. `whatif_run { episode: "<slug>", step: "plan" }`
4. Call `whatif_episode_pin { episode: "<slug>", includeEngineDigest: true }` and `whatif_shot_words { episode: "<slug>" }` to read the language lock (`fr`/`en`), narrator gender/POV lock (`first` vs `third`), `word@frame` timings, and every shot's `len / size / view / accent / look`.

### 3. `DIRECTOR.md` & Mandatory Staging Cards (`whatif_stage_shots`)
1. Read [references/director-guide.md](./references/director-guide.md) before designing sets, cast, or shots.
2. Write `src/episodes/<slug>/DIRECTOR.md` (`>= 200` chars) via `whatif_write_file`:
   - 2–3 `place()` spaces with custom `mood` + `palette` in 3 depth layers,
   - Custom `cast()` characters (explicit `skin`, `body: 'adult' | 'teen'`, `hair`, `outfit` — never default `as: 'heroine'`; match `narratorGender` on `pov="first"`, never invent a narrator character on `pov="third"`, never place deceased/absent people standing alive in the present),
   - Match ALL on-screen text (`title`, `stamp`, `tag`, `phoneShot`, `tabletopShot`) strictly to `episode.json.lang` (French only in FR, English only in EN — never mix languages!).
3. Call `whatif_stage_shots { episode: "<slug>", cards: [...] }` for ALL shots (in batches of ~10–15). Fix any anti-monotony or vague-verb feedback before coding!

### 4. Code `shared.tsx` + Modular Shots (`whatif_edit_shot`) -> `stills` -> `board`
1. Write `src/episodes/<slug>/shared.tsx` via `whatif_write_file` with shared `place(...)` constants, `cast(...)` characters, and custom SVG props (`defineAction`, `definePiece` if needed).
2. Code every shot (`S1..S<N>`) in batches of 6–8 calls using `whatif_edit_shot { episode: "<slug>", id: "S1", code: "export const S1 = ..." }`:
   - Align person `beats` and camera `beats` (mandatory on character shots `> 90f`) to the exact `word@frame` from `whatif_shot_words`.
   - Vary perspectives (`view: 'front' | 'reverse' | '3/4-left' | '3/4-right' | 'left' | 'right'`), depth (`cam: 'ots' | 'deep' | 'pov'`, `foreground: 'auto'`), and inserts (`phoneShot`, `tabletopShot`).
3. Run `whatif_run { episode: "<slug>", step: "stills" }` (fix only failed shot IDs if an audit or layout check flags any), then `whatif_run { episode: "<slug>", step: "board" }`.

### 5. Mandatory Independent Reviewer Subagent (Before `render`)
**NEVER review your own storyboard in the main conversation, and NEVER call `render` before the Reviewer subagent has saved its verdict** (`whatif_run render` mechanically blocks until `out/<slug>/review.json` is saved!).

1. Define the Reviewer subagent once per conversation with `define_subagent`:
   - `Name`: `"whatif-reviewer"`
   - `Description`: `"Independent 2D animation storyboard & code reviewer for What If Studio."`
   - `EnableWriteTools`: `false`
   - `EnableMCPTools`: `true`
   - `SystemPrompt`: `"You are an independent animation Director & Storyboard Reviewer. You did NOT write the episode code. When given an episode slug, call the MCP tool whatif_review_pack({ episode }), then inspect EVERY image path listed in hostImagePaths using read_file, audit every shot rigorously against the REVIEWER INSTRUCTIONS and EPISODE DOSSIER returned by whatif_review_pack, and finally record your verdict by calling MCP whatif_save_review({ episode, pass, summary, issues, round, mode }). Return the saved verdict summary to the parent agent."`
2. Launch it with `invoke_subagent`:
   - `TypeName`: `"whatif-reviewer"`
   - `Role`: `"Independent Storyboard Reviewer"`
   - `Model`: `"inherit"` (or `"pro"` if requested by the user)
   - `Prompt`: `"Audit episode '<slug>' now: call whatif_review_pack({ episode: '<slug>' }), inspect all hostImagePaths with read_file, call whatif_save_review with your honest JSON issues, and report the result."`
3. Wait for the subagent's reply (no polling needed):
   - If `pass: true` (or `blocking: false` on final round): proceed immediately to Step 6!
   - If `blocking: true` (`pass: false`): fix **ONLY** the flagged shots with `whatif_edit_shot`, re-render **ONLY** those shots (`whatif_run { episode: "<slug>", step: "stills", args: ["S3", ...] }`), rebuild `board` (`whatif_run { episode: "<slug>", step: "board" }`), and message/re-invoke `whatif-reviewer` for its **Round 2 High-Res Delta Review**!

### 6. Mix Audio, Render on Modal & Master (`-14 LUFS`)
1. `whatif_run { episode: "<slug>", step: "sfx" }`
2. `whatif_run { episode: "<slug>", step: "render" }` (renders on Modal and auto-masters `out/<slug>/<slug>-final.mp4` at `-14 LUFS` + `out/<slug>/report.json`).
3. Update `PROJECT.md` via `whatif_write_file` and report the final result concisely: duration, aspect ratio, voice, LUFS, and clickable path to `/home/azy/Musique/2d/what-if-app/data/projects/<slug>/out/<slug>/<slug>-final.mp4` (plus any unresolved defects if `DEFAUTS-NON-CORRIGES.md` was written).
