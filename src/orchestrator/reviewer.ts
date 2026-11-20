import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart, Provider } from './providers/types.js';
import { readText } from '../tools/paths.js';
import {
  type EpisodeShotsBundle,
  extractShotIds,
  readEpisodeShots,
  sliceMonolithicShots,
  sortShotIds,
} from '../tools/episode-source.js';
import { detectEpisodeLanguage, directorSizeMismatches, timedChanges } from '../tools/whatif.js';
import { shotWordFrames } from './context.js';
import { formatStageCards, shotCoded } from '../tools/staging.js';
import { packSubmittedSig, readScriptState, recordScriptReview, recordScriptReviewFailure, scriptFiles } from '../tools/script-check.js';

export { extractShotIds as extractReviewShotIds };

export type ReviewIssue = {
  shot: string;
  severity: 'error' | 'warn';
  problem: string;
  fix: string;
};

export type ReviewReport = {
  ok: boolean;
  pass: boolean;
  model: string;
  episode: string;
  summary: string;
  issues: ReviewIssue[];
  createdAt: string;
  /** 'global' on Round 1 (100% of contact sheets); 'delta' on Rounds 2+ (high-res stills + full code of flagged/edited shots) */
  mode?: 'global' | 'delta';
  round?: number;
  targetShots?: string[];
  batches?: number;
  /** false when the model could not take the contact sheets: the verdict comes from the code alone */
  sawImages?: boolean;
  /** true while the board is refused and another review round is still allowed: render waits for it */
  blocking?: boolean;
  /** last round, still refused: the video ships and the unresolved defects are listed in this file */
  defectsFile?: string;
  /** how many reviews in a row refused each shot */
  strikes?: Record<string, number>;
  /** the answer was not valid JSON and its fields were read one by one (unescaped quotes, cut answer) */
  salvaged?: boolean;
  /** the answer as received, kept when nothing could be read from it */
  raw?: string;
  /** the reviewer gave no answer in time, twice: the chain goes on unreviewed */
  timedOut?: boolean;
  /** shots refused three times in a row: the review stops there instead of asking again */
  gaveUpOn?: string[];
  /** a closed review the user came back to: the next board is looked at again, on the shots that changed */
  reopened?: boolean;
  /** provenance of opening captures (f:0, f:30, f:60): verified=true only when all expected opening frames have cryptographic source+timeline+file proof */
  openingFrames?: { exact: number[]; unverified?: number[]; missing: number[]; verified: boolean; stale?: boolean; reason?: string };
};

const MAX_REVIEW_IMAGES = 6;

export function reviewerSystemPrompt(lang: 'fr' | 'en' = 'fr'): string {
  const isEn = lang === 'en';
  const scriptLabel = isEn ? 'script EN (en anglais)' : 'script FR';
  const point4 = isEn
    ? `4. **Cartes-titres (<TitleCard>), accents graphiques & cohérence de langue anglaise (EN)** :
   - Pas de <TitleCard> plein écran en plein milieu de l'histoire qui coupe l'image, ni de sous-titres recopiant la voix.
   - En revanche, les accents graphiques/diégétiques courts **en anglais** intégrés au moteur — \`title\` d'accroche sur \`S1\`, \`stamp\` lieu/heure (\`StampCard\`), \`tag\` chiffre/montant (\`ValueTag\`), rayons \`burst\` (\`ShockBurst\`), messages \`phoneShot\`, étiquettes \`tabletopShot\` et micro-effets \`vfx\` (\`shock\`, \`sweat\`, \`focus\`, \`thought\`, etc.) — sont **encouragés** et ne constituent JAMAIS un défaut !
   - L'épisode étant narré en **anglais**, tous les textes à l'écran DOIVENT être en anglais : ne signale JAMAIS l'anglais comme un défaut (signale uniquement du français résiduel laissé par erreur).`
    : `4. **Cartes-titres (<TitleCard>), accents graphiques & langue française** :
   - Pas de <TitleCard> plein écran en plein milieu de l'histoire qui coupe l'image, ni de sous-titres recopiant la voix.
   - En revanche, les accents graphiques/diégétiques courts en français intégrés au moteur — \`title\` d'accroche sur \`S1\`, \`stamp\` lieu/heure (\`StampCard\`), \`tag\` chiffre/montant (\`ValueTag\`), rayons \`burst\` (\`ShockBurst\`), et micro-effets \`vfx\` (\`shock\`, \`sweat\`, \`focus\`, \`thought\`, etc.) — sont **encouragés** et ne constituent JAMAIS un défaut !
   - Aucun texte en anglais ("YOU PUT ITCHING...", "WHAT IF...") laissé dans un épisode en français.`;

  return `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Tu n'as PAS écrit le code : ton rôle est d'auditer en toute indépendance la cohérence entre le récit (${scriptLabel}), la note de mise en scène (DIRECTOR.md), le code des plans (shared.tsx + shots/S*.tsx ou shots.tsx) et les planches de contact du storyboard (images jointes, 8 à 9 plans chacune).

IMPORTANT — Vignette fixe vs animation réelle du plan :
Chaque vignette sur une planche de contact est capturée à UN SEUL instant \`t = key\` (indiqué pour chaque plan, souvent \`t = 18f\`, soit 0,6 s après la coupe). Un plan de 2 à 4 s comporte souvent plusieurs phases ou beats (\`beats: [{ at: ... }]\`, \`t < ...\`, \`poseAt\`, \`faceAt\`, \`grabAt\`). Avant d'affirmer qu'un geste de milieu ou de fin de phrase manque sur la vignette, VÉRIFIE LE CODE DU PLAN : si l'action est programmée aux frames suivantes sur l'horloge \`0..len\`, elle se joue bien en vidéo et CE N'EST PAS UN DÉFAUT !

Vérifie particulièrement ces points critiques :
0. **Fiche de mise en scène ↔ image** : quand une fiche existe pour un plan, l'image doit montrer ce que dit sa fiche (qui est là, l'action précise, l'objet tenu ou posé, l'angle). Un objet cité par la fiche et absent de l'image, ou une action remplacée par un personnage immobile bras tendu, est un défaut bloquant.
1. **Fidélité décor & accessoires (DIRECTOR.md ↔ code / storyboard)** :
   - Le décor codé et visible correspond-il au lieu de l'histoire et à DIRECTOR.md (murs, ambiance jour/nuit, mobilier comme canapé, table, bol, miroir, fenêtre) ?
   - Si le récit dit qu'un personnage bondit d'un canapé ou pose un objet sur une table, ces éléments existent-ils vraiment dans la scène ?
2. **Casting des personnages, cohérence physique/familiale, costume & chronologie** :
   - Le genre, l'âge apparent (\`body: 'adult'\` pour adultes/parents/mariés/métiers vs \`'teen'\` pour ados/élèves, \`'child'\` pour un enfant, \`'elder'\` pour une personne âgée) et la tenue correspondent-ils au récit et à \`voice.narratorGender\` (sans inventer de personnage narrateur supplémentaire dans un récit à la 3e personne, ni coller la mascotte \`as: 'heroine'\` hors propos) ?
   - Les carnations (\`skin\`) sont-elles cohérentes au sein d'une même famille biologique (parents, frère/sœur, jumeaux) ainsi qu'entre un personnage et ses mains en insert (\`phoneShot\` / \`tabletopShot\`) ?
   - **Présence chronologique** : un personnage décédé ou absent au moment de la scène ne doit jamais apparaître debout vivant dans la pièce présente (uniquement sur une photo/écran ou dans un plan flashback \`look: "memory"\`).
   - Si l'histoire tourne autour d'un objet ou vêtement spécifique (ex. un nouveau haut acheté, une fiole, un téléphone, une bague), est-il visuellement distinct et n'est-il porté/tenu qu'au moment où le récit l'indique ?
3. **Inserts & panneaux de texte (<SchLabel> / <Schematic> vs inserts concrets)** :
   - Aucun plan de dialogue ou de réaction émotionnelle ne doit être remplacé par un panneau de texte abstrait (<Schematic>) sans personnage.
   - En revanche, les inserts macro concrets (\`phoneShot\`, \`tabletopShot\` sur dossier/facture/clés/bague/tasse/mains) sont des plans \`insert\` légitimes et encouragés sans \`<Person>\`.
   - Aucun libellé <SchLabel> inventé ou hors sujet.
${point4}
5. **Cadrage & placement (16:9 ou 9:16)** :
   - Les personnages et objets tenus (handRProp / grabAt / handWorld) sont-ils bien cadrés, sans objet flottant loin des mains ni moitié d'écran vide ?
   - En 9:16 : un tiers ou plus du cadre vide (plafond ou sol sombre), un personnage coupé par le bord sans raison, trois personnages qui ne tiennent pas dans 900/zoom unités de large.
6. **Mise en scène et rythme** :
   - Ce qui se passe à l'image suit-il ce que dit le narrateur au moment où il le dit (geste, regard, objet, réaction) ?
   - Un plan qui tient plus de 6 s sans évènement casse le rythme.
   - Les personnages sont-ils presque tous de face (les « Mesures automatiques » donnent le nombre de plans orientés) ? Deux personnes qui se parlent doivent se faire face (yaw opposés), pas regarder la caméra.
   - Un groupe de 3 doit être étagé en profondeur.
   - Les points de vue et cadrages varient-ils réellement (champ / contrechamp avec \`view: 'reverse'\`, perspectives diagonales/latérales \`view: '3/4-left' | '3/4-right' | 'left' | 'right'\`, amorce épaule \`cam: 'ots'\` ou vue subjective \`cam: 'pov'\`, sous-zones \`zone\`, plongée/contre-plongée \`angle: 'low' | 'high'\`, amorce floue \`foreground\` / \`Foreground\` / \`cam: 'deep'\`, et coupures vers un lieu secondaire quand le récit change d'espace) ? Les silhouettes d'amorce floues en bord de cadre (\`cam: 'ots'\`, \`foreground\`) et les mains en bas d'écran (\`cam: 'pov'\`) sont des effets cinématographiques intentionnels, jamais des défauts.
7. **Lisibilité du lieu** : le lieu se reconnaît-il sans la voix ? Les éléments du décor d'origine sans rapport avec l'histoire (démo « 7 × 8 », rideaux et ciel de crépuscule dans une scène de jour) sont des défauts.
8. **Lumière, contraste, profondeur** : le visage est-il l'élément le plus lumineux de sa zone ? Pas de membre sombre sur mur sombre ?
9. **Cohérence d'un même lieu** : même disposition, mêmes accessoires, mêmes couleurs d'un plan à l'autre.
10. **Ouverture sans le son** (quand une planche « ouverture » f:0 / f:30 / f:60 à 360 px est jointe) : réponds à trois questions dans le résumé — que comprend-on sans le son ? l'acte de la première phrase est-il visible ? qu'est-ce qui accroche l'œil à la première image ? **Défaut majeur (\`error\`, plan S1) seulement si RIEN de la première phrase n'est visible** sur ces trois images ; le reste est une remarque (\`warning\`).
11. **Remarques non bloquantes (\`warning\`, jamais \`error\`)** : personnages petits dans le cadre (le sujet doit occuper au moins 40 % de la hauteur d'un cadre vertical, surtout à la première image) ; nombre de lieux (une histoire qui le permet en montre 2 à 4, pas un seul décor du début à la fin).

Avant d'affirmer qu'un personnage manque dans un plan, lis la ligne « personnages cités » de ce plan dans le résumé du code : s'il y est, il est dessiné (vérifie plutôt son cadrage sur la planche). Un insert (\`phoneShot\`, \`tabletopShot\`, objet en gros plan) qui illustre ce que dit le narrateur n'est pas un défaut.

Le code peut décrire les plans avec \`shot({ place, cam, people, duo, stamp, tag, burst, title, overlay })\`, \`phoneShot(...)\` ou \`tabletopShot(...)\` : \`place(...)\` est le décor, \`cam\` la taille du plan, \`people\` les personnages (\`who\` = \`cast(…)\`, \`at\` = position au sol, \`on\` = assis à un meuble, \`yaw\` = orientation, \`act\` = action, \`face\` = expression, \`vfx\` = micro-effet émotionnel, \`beats\` = changements minutés), \`duo\` une interaction à deux. Tes correctifs doivent employer ces mêmes champs via \`edit_shot\`.

Réponds UNIQUEMENT avec un objet JSON valide (sans texte autour, ou dans un bloc \`\`\`json) respectant exactement ce schéma :
{
  "pass": true,
  "summary": "Résumé concis en 1-2 phrases de la qualité de la réalisation.",
  "issues": [
    {
      "shot": "S3",
      "severity": "error",
      "problem": "Description précise de l'incohérence narrative ou visuelle constatée.",
      "fix": "Instruction concrète et directe à appliquer avec edit_shot pour corriger ce plan."
    }
  ]
}
Règles de décision :
- Mets un seul identifiant de plan par entrée ("S3", pas une liste vague) chaque fois que possible.
- Mets "pass": false UNIQUEMENT s'il y a au moins une issue avec "severity": "error" qui nuit vraiment à la cohérence du récit ou du cadrage.
- Limite-toi aux problèmes réels et vérifiables (maximum 8 issues ciblées, les plus graves d'abord). Les défauts globaux de mise en scène (point 6) et de lisibilité du lieu (point 7) sont "error" quand ils touchent plus de la moitié des plans, sinon "warn". S'il n'y a rien de bloquant, retourne "pass": true et "issues": [].`;
}

export function deltaReviewerSystemPrompt(lang: 'fr' | 'en' = 'fr'): string {
  const wrongLangNote = lang === 'en' ? 'texte français résiduel dans un épisode en anglais' : 'texte anglais dans un épisode en français';
  const accentsLang = lang === 'en' ? 'anglais' : 'français';
  return `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Ceci est une **CONTRE-VISITE CIBLÉE (Delta Review)** après correction des plans signalés au tour précédent.

Tu reçois :
1. Les problèmes bloquants exacts qui avaient été signalés au tour précédent,
2. Les **images individuelles pleine résolution** (\`out/<slug>/board/S<N>.png\`) des plans corrigés/modifiés,
3. Le **code complet non tronqué** de chacun de ces plans ciblés (ainsi que \`shared.tsx\`, \`DIRECTOR.md\` et le script pour le contexte).

Règles STRICTES de contre-visite (anti-boucle infinie) :
1. **Périmètre verrouillé** : vérifie UNIQUEMENT (a) si les problèmes bloquants signalés au tour précédent sur ces plans ciblés ont été résolus de façon cohérente, et (b) qu'aucune casse visuelle franche (cadre vide, personnage disparu, ${wrongLangNote}, objet flottant aberrant) n'a été introduite sur ces plans modifiés.
2. **Interdiction de déplacer les poteaux de but** : N'INVENTE PAS de nouvelles exigences sur d'autres plans non signalés, et ne demande pas un réalisme anatomique impossible pour un rig vectoriel 2D (\`shot()\`, \`<Person>\`, \`phoneShot()\`, \`tabletopShot()\`). Les accents graphiques ${accentsLang} (\`stamp\`, \`tag\`, \`vfx\`, \`burst\`, \`title\` sur S1) sont intentionnels.
3. **Attention au keyframe fixe** : l'image jointe \`S<N>.png\` montre l'instant unique \`t = key\` (indiqué pour chaque plan). Si une action en plusieurs temps (\`beats\`, \`t < ...\`, \`poseAt\`, \`grabAt\`) est correctement codée aux frames correspondantes dans le code complet du plan, elle fonctionne en vidéo !
4. **Validation immédiate** : dès que les défauts bloquants précédents sont corrigés de manière satisfaisante, renvoie \`"pass": true\` et \`"issues": []\`.

Réponds UNIQUEMENT avec un objet JSON valide respectant ce schéma :
{
  "pass": true,
  "summary": "Résumé concis en 1-2 phrases du résultat de la contre-visite.",
  "issues": [
    {
      "shot": "S3",
      "severity": "error",
      "problem": "Ce qui reste concrètement cassé parmi les points signalés (ou la régression introduite sur ce plan).",
      "fix": "Instruction directe et réalisable via edit_shot sur ce plan."
    }
  ]
}`;
}

/** Names bound to cast(...) or makeLook(...) in shared/shots code: the characters a shot can show. */
function castNames(src: string): string[] {
  return [
    ...new Set(
      [...src.matchAll(/(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:cast|makeLook)\s*\(/g)].map(
        (m) => m[1]!,
      ),
    ),
  ];
}

function formatHelpersSection(helpersMap: Map<string, string>, budget = 10_000): string {
  const out: string[] = [];
  let used = 0;
  for (const [, code] of helpersMap) {
    const line = `- ${code.replace(/\s+/g, ' ').trim().slice(0, 1_600)}`;
    if (used + line.length > budget) {
      out.push('- (…)');
      break;
    }
    out.push(line);
    used += line.length;
  }
  return out.join('\n');
}

export type SummarizeShotsOptions = {
  onlyShots?: string[];
  shotTimings?: Map<string, { len: number; key: number }>;
  perShotChars?: number;
};

/**
 * Summarize episode code cleanly for the Reviewer using AST-accurate per-shot bodies:
 * - Works on both raw monolithic `shots.tsx` strings and `EpisodeShotsBundle` (`shared.tsx` + `shots/S*.tsx`),
 * - Never bleeds `S11`'s local helpers into `S10`,
 * - Annotates each shot with its cast names and optional `[len=...f, vignette t=...f]`.
 */
export function summarizeShotsCode(
  shotsInput: string | EpisodeShotsBundle,
  opts: SummarizeShotsOptions = {},
): string {
  const perShotLimit = opts.perShotChars ?? 2_600;
  let header = '';
  let helpersMap = new Map<string, string>();
  let shotBodies: Record<string, string> = {};
  let exportedIds: string[] = [];
  let combined = '';
  let sourceLabel = 'shots.tsx';

  if (typeof shotsInput === 'string') {
    if (!shotsInput) return '(shots.tsx missing)';
    const sliced = sliceMonolithicShots(shotsInput);
    if (!sliced.exportedShotIds.length) return shotsInput.slice(0, 4_000);
    header = sliced.header;
    helpersMap = sliced.helpersMap;
    shotBodies = sliced.shotBodies;
    exportedIds = sliced.exportedShotIds;
    combined = shotsInput;
  } else {
    if (!shotsInput.exists) return '(shots.tsx missing)';
    if (!shotsInput.exportedShotIds.length) return shotsInput.combinedSource.slice(0, 4_000) || '(no exported shots)';
    header = shotsInput.sharedSource;
    helpersMap = shotsInput.helpersMap;
    shotBodies = shotsInput.shotBodies;
    exportedIds = shotsInput.exportedShotIds;
    combined = shotsInput.combinedSource;
    sourceLabel = shotsInput.isModular ? 'shared.tsx + shots/S*.tsx' : 'shots.tsx';
  }

  const names = castNames(combined);
  const selectedIds = opts.onlyShots?.length
    ? exportedIds.filter((id) => opts.onlyShots!.includes(id))
    : exportedIds;
  const idsToShow = selectedIds.length ? selectedIds : exportedIds;

  const perShot: string[] = [];
  for (const id of idsToShow) {
    const rawBody = shotBodies[id] ?? '';
    const body = perShotLimit >= 6_000 ? rawBody.trim() : rawBody.replace(/\s+/g, ' ').trim();
    const who = names.filter((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(rawBody));
    const tm = opts.shotTimings?.get(id);
    const tmNote = tm ? `, len=${tm.len}f (${(tm.len / 30).toFixed(1)}s), vignette à t=${tm.key}f` : '';
    if (perShotLimit >= 6_000) {
      perShot.push(
        `#### ${id} (personnages cités : ${who.length ? who.join(', ') : 'aucun'}${tmNote})\n\`\`\`tsx\n${body.slice(0, perShotLimit)}\n\`\`\``,
      );
    } else {
      perShot.push(
        `- ${id} (personnages cités : ${who.length ? who.join(', ') : 'aucun'}${tmNote}): ${body.slice(0, perShotLimit)}`,
      );
    }
  }

  const comps = formatHelpersSection(helpersMap);
  const rangeLabel =
    idsToShow.length < exportedIds.length
      ? `${idsToShow.length} plans ciblés sur ${exportedIds.length}`
      : `${exportedIds.length} plans`;

  return (
    `### En-tête partagé (${sourceLabel})\n\`\`\`tsx\n${header.slice(0, 6_000)}\n\`\`\`\n\n` +
    `${comps ? `### Composants du fichier (début de chaque définition)\n${comps}\n\n` : ''}` +
    `### Résumé du code par plan (${rangeLabel})\n${perShot.join('\n')}`
  );
}

/** Counts of deliberate inserts and graphic/micro-VFX accents so the Reviewer recognizes them immediately. */
export function accentMetrics(shotsInput: string | EpisodeShotsBundle): string {
  const bodies: string[] =
    typeof shotsInput === 'string'
      ? (() => {
          const sliced = sliceMonolithicShots(shotsInput);
          return sliced.exportedShotIds.map((id) => sliced.shotBodies[id] ?? '');
        })()
      : shotsInput.exportedShotIds.map((id) => shotsInput.shotBodies[id] ?? '');
  if (!bodies.length) return '';
  let macroInserts = 0;
  let stampsTags = 0;
  let headVfx = 0;
  let camBeats = 0;
  for (const body of bodies) {
    if (/\b(phoneShot|tabletopShot|screenShot|notifShot|counterShot|polaroidShot)\s*\(/.test(body)) macroInserts++;
    if (/\b(stamp|tag|title|burst)\s*:|<(StampCard|ValueTag|HookTitle|ShockBurst)\b/.test(body)) stampsTags++;
    if (/\bvfx\s*:\s*\[|<(HeadVfx|FocusRings|Sparkle)\b/.test(body)) headVfx++;
    if (/\bbeats\s*:\s*\[[^\]]*\b(cam|shake|angle|view|zone)\s*:/.test(body)) camBeats++;
  }
  return `dynamisme & accents : ${macroInserts} insert(s) macro (phoneShot/tabletopShot) · ${stampsTags} accent(s) écran (stamp/tag/title/burst) · ${headVfx} plan(s) avec micro-VFX personnage · ${camBeats} plan(s) avec changement de cadrage interne (camBeat)`;
}

/** Counts read straight from episode shot bodies, handed to the Reviewer so it does not have to guess from thumbnails. */
export function staticMetrics(shotsInput: string | EpisodeShotsBundle): string {
  const bodies: string[] =
    typeof shotsInput === 'string'
      ? (() => {
          const sliced = sliceMonolithicShots(shotsInput);
          if (sliced.exportedShotIds.length) {
            return sliced.exportedShotIds.map((id) => sliced.shotBodies[id] ?? '');
          }
          return shotsInput
            .split(/(?=export\s+(?:const|function)\s+S\d+\b)/)
            .filter((p) => /^export\s+(?:const|function)\s+S\d+\b/.test(p));
        })()
      : shotsInput.exportedShotIds.map((id) => shotsInput.shotBodies[id] ?? '');

  if (!bodies.length) return '(shots.tsx has no exported shot)';
  let oriented = 0;
  let blur = 0;
  let focus = 0;
  let group3 = 0;
  let still = 0;
  let idleOnly = 0;
  const actShots = new Map<string, number>();
  for (const body of bodies) {
    if (timedChanges(body) === 0 && /\bpeople\s*[=:]|<(Hero|Staged|Person)\b|\bwho\s*[=:]/.test(body)) still++;
    const acts = [...body.matchAll(/\bact\s*[:=]\s*['"]([a-z-]+)/g)].map((m) => m[1]);
    if (acts.length && acts.every((a) => a === 'idle')) idleOnly++;
    for (const a of new Set(acts)) if (a && a !== 'idle') actShots.set(a, (actShots.get(a) ?? 0) + 1);
    const yaws = [...body.matchAll(/\byaw\s*[:=]\s*\{?\s*(-?\d*\.?\d+)/g)].map((m) => Math.abs(Number(m[1])));
    if (yaws.some((y) => y >= 0.3) || /\b(tableSit|walkPose|carSit|bedSit)\(|<Duo\b|\bduo\s*:\s*\{|\blook\s*:\s*\d|\bview\s*:\s*['"](3\/4-left|3\/4-right|left|right)['"]/.test(body)) oriented++;
    if (/<Foreground\b|\bforeground\s*:\s*(?!['"]none['"])|\bcam\s*:\s*['"]ots['"]/.test(body)) blur++;
    else if (/\bfocus\s*[=:]|blur16/.test(body)) focus++;
    if ((body.match(/<(Hero|Staged|Person)\b|\bwho\s*[:=]/g) ?? []).length >= 3) group3++;
  }
  const base = `${oriented}/${bodies.length} plans avec un personnage orienté (yaw >= 0,3, tableSit ou walkPose) · ${blur}/${bodies.length} plans avec amorce floue au premier plan (Foreground) · ${focus} autres avec seulement un flou de profondeur (pas une amorce) · ${group3} plans à 3 personnages ou plus · ${still} plans avec personnages où rien ne change pendant le plan · ${idleOnly} plans où l'unique action est idle`;
  const top = [...actShots.entries()].sort((x, y) => y[1] - x[1])[0];
  const repeat = top && bodies.length >= 6 && top[1] > bodies.length / 3 ? ` · geste répété : « ${top[0]} » dans ${top[1]}/${bodies.length} plans (varie les gestes : un tiers au plus)` : '';
  return base + repeat;
}

/** Shot lengths from timeline.json: a long held shot is the first thing that kills the pace. */
export function timingMetrics(timeline: any): string {
  const fps = Number(timeline?.fps ?? 30);
  const shots = (Array.isArray(timeline?.shots) ? timeline.shots : []) as { id: string; len: number }[];
  if (!shots.length) return '(pas de timeline)';
  const secs = shots.map((s) => ({ id: String(s.id), s: Number(s.len ?? 0) / fps })).sort((a, b) => a.s - b.s);
  const median = secs[Math.floor(secs.length / 2)]!.s;
  const longest = secs[secs.length - 1]!;
  const over = secs.filter((x) => x.s > 6).map((x) => x.id);
  return `durée des plans : médiane ${median.toFixed(1)} s, la plus longue ${longest.s.toFixed(1)} s (${longest.id}) · ${over.length} plan(s) de plus de 6 s${over.length ? ` (${over.slice(0, 8).join(', ')})` : ''}`;
}

/**
 * Reads a review whose JSON does not parse, field by field. A reviewer that quotes a word of the script inside a text
 * ("il dit "pouces" trop tôt") or whose answer is cut by the output cap gives invalid JSON; the first real launch on
 * the 16 Nov engine lost a whole refused review that way and the video shipped unreviewed. Each value runs from its
 * key to the next known key, so quotes inside a text no longer matter.
 */
export function salvageReview(text: string): { pass?: boolean; summary?: string; issues: ReviewIssue[] } | null {
  const KEY = /"(pass|summary|issues|shot|severity|problem|fix)"\s*:/g;
  const marks: { key: string; start: number; end: number }[] = [];
  for (let m = KEY.exec(text); m; m = KEY.exec(text)) marks.push({ key: m[1]!, start: m.index, end: m.index + m[0].length });
  if (!marks.length) return null;
  const valueOf = (i: number): string => {
    let v = text.slice(marks[i]!.end, marks[i + 1]?.start ?? text.length).trim();
    v = v.replace(/```\s*$/, '').replace(/[\s,{}[\]]+$/, '');
    if (v.startsWith('"')) v = v.slice(1);
    if (v.endsWith('"') && !v.endsWith('\\"')) v = v.slice(0, -1);
    return v.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
  };
  let pass: boolean | undefined;
  let summary: string | undefined;
  const issues: ReviewIssue[] = [];
  let cur: Partial<ReviewIssue> | null = null;
  const flush = () => {
    if (cur && ((cur.problem ?? '').length >= 12 || (cur.fix ?? '').length >= 12))
      issues.push({ shot: (cur.shot || 'GLOBAL').trim(), severity: cur.severity ?? 'warn', problem: cur.problem ?? '', fix: cur.fix ?? '' });
    cur = null;
  };
  marks.forEach((mk, i) => {
    const v = valueOf(i);
    if (mk.key === 'pass') pass = /^true\b/i.test(v) ? true : /^false\b/i.test(v) ? false : pass;
    else if (mk.key === 'summary') summary = v;
    else if (mk.key === 'issues') flush();
    else {
      const k = mk.key as 'shot' | 'severity' | 'problem' | 'fix';
      if (!cur || cur[k] !== undefined) {
        flush();
        cur = {};
      }
      if (k === 'severity') cur.severity = v.toLowerCase().startsWith('error') ? 'error' : 'warn';
      else cur[k] = v;
    }
  });
  flush();
  if (!issues.length && pass === undefined) return null;
  return { pass, summary, issues };
}

export function parseReviewJson(raw: string, model: string, episode: string): ReviewReport {
  const cleaned = raw.trim();
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : cleaned;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonSlice = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;

  try {
    const parsed = JSON.parse(jsonSlice);
    const rawIssues = Array.isArray(parsed?.issues) ? parsed.issues : [];
    const issues: ReviewIssue[] = rawIssues
      .filter((it: any) => it && (it.problem || it.fix))
      .map((it: any) => ({
        shot: String(it.shot ?? 'GLOBAL').trim(),
        severity: (String(it.severity ?? 'warn').toLowerCase() === 'error' ? 'error' : 'warn') as 'error' | 'warn',
        problem: String(it.problem ?? '').trim(),
        fix: String(it.fix ?? '').trim(),
      }));
    const hasError = issues.some((i) => i.severity === 'error');
    const pass = typeof parsed?.pass === 'boolean' ? parsed.pass && !hasError : !hasError;
    return {
      ok: true,
      pass,
      model,
      episode,
      summary: String(parsed?.summary ?? (pass ? 'Réalisation cohérente.' : `${issues.length} problème(s) détecté(s).`)).trim(),
      issues,
      createdAt: new Date().toISOString(),
    };
  } catch {
    const got = salvageReview(cleaned);
    const hasError = !!got && got.issues.some((i) => i.severity === 'error');
    // a refusal whose blocking issue was cut off is not read as a pass: it stays unreadable, so the reviewer is asked again
    if (got && !(got.pass === false && !hasError)) {
      const pass = !hasError;
      return {
        ok: true,
        pass,
        model,
        episode,
        summary: got.summary || (pass ? 'Réalisation cohérente.' : `${got.issues.length} problème(s) détecté(s).`),
        issues: got.issues,
        createdAt: new Date().toISOString(),
        salvaged: true,
      };
    }
    return {
      ok: false,
      pass: true,
      model,
      episode,
      summary: `Réponse du reviewer non-JSON ignorée (${cleaned.slice(0, 140)})`,
      issues: [],
      createdAt: new Date().toISOString(),
      raw: cleaned.slice(0, 20_000),
    };
  }
}

/** The orientation the studio renders at: episode.json first, else src/studio.config.ts (never a silent 16:9 guess). */
function episodeAspect(projectRoot: string, epRaw: string): string {
  try {
    const a = String(JSON.parse(epRaw)?.aspect ?? '');
    if (a === '9:16' || a === '16:9') return a;
  } catch {
    /* fall through */
  }
  const cfg = readText(path.join(projectRoot, 'src'), 'studio.config.ts', 50_000) ?? '';
  if (/aspect\s*:\s*['"]9:16['"]/.test(cfg) || (/width\s*:\s*1080\b/.test(cfg) && /height\s*:\s*1920\b/.test(cfg))) return '9:16';
  return '16:9';
}

function readImagePart(file: string, mime: string): ImagePart | null {
  try {
    const st = fs.statSync(file);
    if (st.size > 0 && st.size <= 4_000_000) {
      return { mime, data: fs.readFileSync(file).toString('base64') };
    }
  } catch {
    /* missing file */
  }
  return null;
}

function loadPreviousReview(outDir: string): ReviewReport | null {
  try {
    const raw = fs.readFileSync(path.join(outDir, 'review.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ReviewReport;
  } catch {
    /* none */
  }
  return null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** How long one call to the reviewer may take. One episode waited 31 minutes for a review, another 10 (2026-11-16). */
export const reviewTimeoutMs = (): number => {
  const n = Number(process.env.WHATIF_REVIEW_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 240_000;
};
export class ReviewTimeout extends Error {}
/** provider.chat with a deadline of its own: the call is aborted and, should the provider ignore that, left behind. */
export async function chatWithin(provider: Provider, messages: ChatMessage[], signal: AbortSignal | undefined, ms = reviewTimeoutMs()): Promise<string> {
  const ctl = new AbortController();
  const onUser = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  signal?.addEventListener('abort', onUser, { once: true });
  let timer: NodeJS.Timeout | undefined;
  let late = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      late = true;
      ctl.abort();
      reject(new ReviewTimeout(`no answer from the reviewer in ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  try {
    const call = provider.chat({ messages, tools: [], signal: ctl.signal }).then((r) => r.text);
    call.catch(() => undefined);
    return await Promise.race([call, deadline]);
  } catch (err) {
    if (late && !signal?.aborted) throw new ReviewTimeout(`no answer from the reviewer in ${Math.round(ms / 1000)} s`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onUser);
  }
}

async function askReviewerWithFallback(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  images: ImagePart[],
  slug: string,
  signal?: AbortSignal,
): Promise<{ report: ReviewReport; sawImages: boolean }> {
  const late = (): ReviewReport => ({
    ok: false,
    pass: true,
    model: provider.model,
    episode: slug,
    summary: `Reviewer indisponible : aucune réponse en ${Math.round(reviewTimeoutMs() / 60_000)} min, deux essais.`,
    issues: [],
    createdAt: new Date().toISOString(),
    timedOut: true,
  });
  // a reviewer that does not answer is asked once more, then the chain goes on unreviewed instead of waiting
  const ask = async (msgs: ChatMessage[]): Promise<ReviewReport> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return parseReviewJson(await chatWithin(provider, msgs, signal), provider.model, slug);
      } catch (err) {
        if (!(err instanceof ReviewTimeout)) throw err;
      }
    }
    return late();
  };

  let sawImages = images.length > 0;
  let sent: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt, ...(images.length ? { images } : {}) },
  ];
  let report: ReviewReport;
  try {
    report = await ask(sent);
  } catch (err) {
    if (!images.length) throw err;
    // Text-only reviewer fallback: audit the code + script + DIRECTOR.md without images
    sawImages = false;
    sent = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
    report = await ask(sent);
  }
  if (!report.ok && !report.timedOut) report = await ask(sent);
  return { report, sawImages };
}

function mergeBatchReports(reports: ReviewReport[], model: string, episode: string): ReviewReport {
  if (reports.length === 1) return reports[0]!;
  const okReports = reports.filter((r) => r.ok);
  if (!okReports.length) return reports[0]!;

  const seen = new Set<string>();
  const mergedIssues: ReviewIssue[] = [];
  for (const r of okReports) {
    for (const iss of r.issues) {
      const key = `${iss.shot.toUpperCase()}::${iss.severity}::${iss.problem.slice(0, 80).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mergedIssues.push(iss);
    }
  }
  mergedIssues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const cappedIssues = mergedIssues.slice(0, 10);
  const hasError = cappedIssues.some((i) => i.severity === 'error');
  const pass = okReports.every((r) => r.pass) && !hasError;
  const summaries = okReports.map((r, idx) => `Lot ${idx + 1}/${okReports.length}: ${r.summary}`).join(' · ');

  return {
    ok: true,
    pass,
    model,
    episode,
    summary: summaries,
    issues: cappedIssues,
    createdAt: new Date().toISOString(),
  };
}

export type OpeningCaptureStatus = {
  exact: number[];
  unverified: number[];
  missing: number[];
  verified: boolean;
  hasSheet: boolean;
  stale: boolean;
  reason?: string;
};

const OPENING_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.svg']);

function fileSha256Hex32(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[k] = canonicalizeJson((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function timelineSha256Hex32(filePath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rest: Record<string, unknown> = {};
      for (const k of Object.keys(parsed as Record<string, unknown>).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (k === 'audio') continue;
        rest[k] = canonicalizeJson((parsed as Record<string, unknown>)[k]);
      }
      return crypto.createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex').slice(0, 32);
    }
    return crypto.createHash('sha256').update(JSON.stringify(canonicalizeJson(parsed)), 'utf8').digest('hex').slice(0, 32);
  } catch {
    return fileSha256Hex32(filePath);
  }
}

function collectOpeningSourceFiles(rootDir: string, currentDir: string, skipRelPosix: string, out: string[]): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(currentDir, ent.name);
    if (ent.isDirectory()) {
      collectOpeningSourceFiles(rootDir, full, skipRelPosix, out);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!OPENING_SOURCE_EXTS.has(ext)) continue;
      const relPosix = path.relative(rootDir, full).split(path.sep).join('/');
      if (relPosix === skipRelPosix) continue;
      out.push(relPosix);
    }
  }
}

/** Canonical SHA-256 signatures of `timeline.json` (excluding `audio`) and all episode/engine source files (matching `render_run.mjs` and `board_sheets.py`). */
export function computeOpeningInputSigs(projectRoot: string, slug: string): { timelineSig: string | null; sourcesSig: string | null } {
  const tlRel = `src/episodes/${slug}/timeline.json`;
  const tlPath = path.join(projectRoot, 'src', 'episodes', slug, 'timeline.json');
  const timelineSig = fs.existsSync(tlPath) && fs.statSync(tlPath).isFile() ? timelineSha256Hex32(tlPath) : null;

  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  if (!fs.existsSync(epDir) || !fs.statSync(epDir).isDirectory()) {
    return { timelineSig, sourcesSig: null };
  }
  const epFiles: string[] = [];
  collectOpeningSourceFiles(projectRoot, epDir, tlRel, epFiles);
  if (!epFiles.length) return { timelineSig, sourcesSig: null };

  const allFiles = [...epFiles];
  for (const extraRel of ['src/Root.tsx', 'src/studio.config.ts']) {
    const p = path.join(projectRoot, extraRel);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) allFiles.push(extraRel);
    } catch {
      /* ignore */
    }
  }
  const engineDir = path.join(projectRoot, 'src', 'engine');
  if (fs.existsSync(engineDir)) {
    collectOpeningSourceFiles(projectRoot, engineDir, tlRel, allFiles);
  }
  const uniqueSorted = [...new Set(allFiles)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const relPosix of uniqueSorted) {
    const fSha = fileSha256Hex32(path.join(projectRoot, ...relPosix.split('/')));
    if (!fSha) return { timelineSig, sourcesSig: null };
    h.update(`${relPosix}\0${fSha}\n`, 'utf8');
  }
  return { timelineSig, sourcesSig: h.digest('hex').slice(0, 32) };
}

/**
 * Inspect opening captures (frames 0, 30, 60) with cryptographic source + timeline + file hash verification.
 * Never relies on mtime tolerances and never validates stale `opening.json` metadata or missing/unproven images.
 */
export function readOpeningStatus(projectRoot: string, slug: string, timeline?: any): OpeningCaptureStatus {
  const outDir = path.join(projectRoot, 'out', slug);
  const sheetsDir = path.join(outDir, 'sheets');
  const openDir = path.join(outDir, 'opening');
  const sheetPath = path.join(sheetsDir, 'opening.jpg');
  const metaPath = path.join(sheetsDir, 'opening.json');
  const manifestPath = path.join(openDir, 'manifest.json');

  const total = Number(timeline?.total ?? 0);
  const targets = [0, 30, 60].filter((f) => total <= 0 || f < total);
  const expected = targets.length ? targets : [0];

  const { timelineSig, sourcesSig } = computeOpeningInputSigs(projectRoot, slug);
  const hadArtifacts = fs.existsSync(metaPath) || fs.existsSync(manifestPath);
  if (!timelineSig || !sourcesSig) {
    return {
      exact: [],
      unverified: [],
      missing: expected,
      verified: false,
      hasSheet: false,
      stale: hadArtifacts,
      reason: 'missing_sources_or_timeline',
    };
  }

  let manifest: any = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return {
        exact: [],
        unverified: [],
        missing: expected,
        verified: false,
        hasSheet: false,
        stale: true,
        reason: 'corrupted_render_manifest',
      };
    }
    if (!manifest || typeof manifest !== 'object' || manifest.timelineSig !== timelineSig || manifest.sourcesSig !== sourcesSig) {
      return {
        exact: [],
        unverified: [],
        missing: expected,
        verified: false,
        hasSheet: false,
        stale: true,
        reason: 'stale_sources_or_timeline',
      };
    }
  }

  if (!fs.existsSync(metaPath)) {
    return {
      exact: [],
      unverified: [],
      missing: expected,
      verified: false,
      hasSheet: false,
      stale: false,
      reason: 'missing_opening_metadata',
    };
  }

  let meta: any = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return {
      exact: [],
      unverified: [],
      missing: expected,
      verified: false,
      hasSheet: false,
      stale: true,
      reason: 'corrupted_opening_metadata',
    };
  }

  if (!meta || typeof meta !== 'object' || meta.timelineSig !== timelineSig || meta.sourcesSig !== sourcesSig) {
    return {
      exact: [],
      unverified: [],
      missing: expected,
      verified: false,
      hasSheet: false,
      stale: true,
      reason: 'stale_opening_metadata',
    };
  }

  if (Array.isArray(meta.staleFrames) && meta.staleFrames.length > 0) {
    return {
      exact: [],
      unverified: [],
      missing: expected,
      verified: false,
      hasSheet: false,
      stale: true,
      reason: 'stale_opening_captures',
    };
  }

  const frameHashes = meta.frameHashes && typeof meta.frameHashes === 'object' ? (meta.frameHashes as Record<string, string>) : {};
  const hashKeys = Object.keys(frameHashes);
  for (const k of hashKeys) {
    const fNum = Number(k);
    const p4 = path.join(openDir, `f${String(fNum).padStart(4, '0')}.png`);
    const p1 = path.join(openDir, `f${fNum}.png`);
    const mFile = manifest?.frames?.[k]?.file ? path.join(openDir, path.basename(String(manifest.frames[k].file))) : null;
    const cand = mFile && fs.existsSync(mFile) ? mFile : fs.existsSync(p4) ? p4 : fs.existsSync(p1) ? p1 : null;
    if (!cand || fileSha256Hex32(cand) !== frameHashes[k]) {
      return {
        exact: [],
        unverified: [],
        missing: expected,
        verified: false,
        hasSheet: false,
        stale: true,
        reason: 'missing_or_corrupted_opening_image',
      };
    }
  }

  if (hashKeys.length > 0) {
    const actualSheetSha = fs.existsSync(sheetPath) ? fileSha256Hex32(sheetPath) : null;
    if (!actualSheetSha || typeof meta.sheetSha256 !== 'string' || actualSheetSha !== meta.sheetSha256) {
      return {
        exact: [],
        unverified: [],
        missing: expected,
        verified: false,
        hasSheet: false,
        stale: true,
        reason: 'missing_or_corrupted_opening_sheet',
      };
    }
  }

  const exact: number[] = [];
  const unverified: number[] = [];
  const missing: number[] = [];
  for (const f of expected) {
    const key = String(f);
    const metaHash = frameHashes[key];
    const mEntry = manifest?.frames?.[key];
    if (manifest && mEntry && typeof mEntry.sha256 === 'string' && typeof mEntry.file === 'string' && metaHash === mEntry.sha256) {
      const cand = path.join(openDir, path.basename(mEntry.file));
      if (fs.existsSync(cand) && fileSha256Hex32(cand) === mEntry.sha256) {
        exact.push(f);
        continue;
      }
      return {
        exact: [],
        unverified: [],
        missing: expected,
        verified: false,
        hasSheet: false,
        stale: true,
        reason: 'missing_or_corrupted_opening_image',
      };
    }
    if (metaHash) {
      unverified.push(f);
      missing.push(f);
    } else {
      missing.push(f);
    }
  }

  const hasSheet = (exact.length > 0 || unverified.length > 0) && fs.existsSync(sheetPath);
  const verified = Boolean(manifest) && hasSheet && exact.length === expected.length && missing.length === 0 && unverified.length === 0;
  return {
    exact,
    unverified,
    missing,
    verified,
    hasSheet,
    stale: false,
    ...(verified ? {} : { reason: !manifest ? 'missing_render_manifest' : 'missing_opening_frames' }),
  };
}

/** Flag any Reviewer summary assertion about missing/unverified opening frames so unproven frames are never passed off as visually verified. */
export function guardUnverifiedOpeningClaims(summary: string, missing: number[], status?: OpeningCaptureStatus): string {
  if (!summary) return summary;
  const effectiveMissing = status ? status.missing : missing;
  if (status?.verified || (!effectiveMissing.length && !status?.stale)) return summary;
  const missingSet = new Set(effectiveMissing);
  const claimed = new Set<number>();
  for (const m of summary.matchAll(/\bf\s*:?\s*(0|30|60)\b/gi)) {
    const f = Number(m[1]);
    if (missingSet.has(f)) claimed.add(f);
  }
  const mentionsOpening = /\b(ouverture|opening|sans le son|première seconde|first second)\b/i.test(summary);
  if (!claimed.size && !mentionsOpening && !status?.stale) return summary;
  const list = (claimed.size ? [...claimed] : effectiveMissing).sort((a, b) => a - b).map((f) => `f:${f}`).join(', ');
  const detail = status?.stale
    ? `sources/timeline modifiées ou images absentes depuis le rendu (${status.reason ?? 'stale'})`
    : status?.reason === 'missing_render_manifest'
      ? `preuve de rendu (manifeste/signatures) absente sur ${list || 'f:0, f:30, f:60'}`
      : `capture(s) exacte(s) absente(s) sur ${list || 'f:0, f:30, f:60'}`;
  return `${summary} [ouverture non vérifiée : ${detail}]`;
}

/** Prompt block for the opening sheet: reports exact vs unverified vs missing opening captures honestly and forbids claims on unproven frames. */
export function openingReviewBlock(ep: any, scriptLines: string, status?: OpeningCaptureStatus): string {
  const opening = ep?.opening && typeof ep.opening === 'object' ? ep.opening : null;
  const firstScript = String((Array.isArray(ep?.script) ? ep.script[0]?.text : '') ?? '').trim();
  const sentence = String(opening?.sentence ?? '').trim() || (firstScript.match(/^[^.!?]*[.!?]?/)?.[0] ?? '').trim() || scriptLines.split('\n')[0] || '';
  const title = ep?.titleCard === true && Array.isArray(ep?.title) ? ep.title.join(' / ') : '';

  if (status?.stale) {
    const missLabel = (status.missing.length ? status.missing : [0, 30, 60]).map((f) => `f:${f}`).join(', ');
    return [
      `## 7. Ouverture sans le son — CAPTURES OBSOLÈTES / INVALIDÉES (${missLabel}, raison : ${status.reason ?? 'stale'})`,
      `Première phrase : « ${sentence} »`,
      opening ? `Type d'ouverture proposé : ${opening.type ?? '?'} (${opening.why ?? ''})${opening.weak ? ' — ouverture faible signalée' : ''}` : '',
      title ? `Titre affiché : ${title}` : 'Aucun titre affiché (choix par défaut).',
      `Les sources des plans, timeline.json ou les fichiers d'ouverture ont changé depuis le dernier rendu : l'ancienne planche d'ouverture est invalidée et non jointe. Refuse la validation tant que stills et board n'ont pas été relancés.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (status && status.exact.length === 0 && (!status.unverified || status.unverified.length === 0)) {
    const missLabel = (status.missing.length ? status.missing : [0, 30, 60]).map((f) => `f:${f}`).join(', ');
    return [
      `## 7. Ouverture sans le son — CAPTURES EXACTES MANQUANTES / INCONNUES (${missLabel})`,
      `Première phrase : « ${sentence} »`,
      opening ? `Type d'ouverture proposé : ${opening.type ?? '?'} (${opening.why ?? ''})${opening.weak ? ' — ouverture faible signalée' : ''}` : '',
      title ? `Titre affiché : ${title}` : 'Aucun titre affiché (choix par défaut).',
      `Aucune capture exacte vérifiée (${missLabel}) n'existe dans out/<slug>/opening/ : aucune planche d'ouverture n'est jointe (les vignettes keyframe t=key ne remplacent pas ces instants). N'affirme JAMAIS avoir vu ${missLabel} et ne prononce ni validation ni erreur visuelle sur ces frames absentes.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (status && !status.verified) {
    const exactLabel = status.exact.length ? status.exact.map((f) => `f:${f}`).join(', ') : 'aucune';
    const unvLabel = status.unverified?.length ? status.unverified.map((f) => `f:${f}`).join(', ') : '';
    const missLabel = status.missing.map((f) => `f:${f}`).join(', ');
    return [
      `## 7. Ouverture sans le son (planche « ouverture » NON VÉRIFIÉE / PARTIELLE — exactes prouvées : ${exactLabel}${unvLabel ? ` ; sans manifeste de rendu : ${unvLabel}` : ''} ; manquantes/non prouvées : ${missLabel})`,
      `Première phrase : « ${sentence} »`,
      opening ? `Type d'ouverture proposé : ${opening.type ?? '?'} (${opening.why ?? ''})${opening.weak ? ' — ouverture faible signalée' : ''}` : '',
      title ? `Titre affiché : ${title}` : 'Aucun titre affiché (choix par défaut).',
      `Attention : l'ouverture n'est pas entièrement prouvée par signature de rendu (${status.reason ?? 'incomplète'}). Juge avec réserve uniquement les cases présentes et n'affirme jamais avoir vérifié les cases INCONNU (${missLabel}).`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `## 7. Ouverture sans le son (dernière image jointe : planche « ouverture », captures exactes f:0, f:30, f:60 à 360 px de large)`,
    `Première phrase : « ${sentence} »`,
    opening ? `Type d'ouverture proposé : ${opening.type ?? '?'} (${opening.why ?? ''})${opening.weak ? ' — ouverture faible signalée' : ''}` : '',
    title ? `Titre affiché : ${title}` : 'Aucun titre affiché (choix par défaut).',
    `Réponds dans le résumé : 1) que comprend-on sans le son ? 2) l'acte de la première phrase est-il visible ? 3) qu'est-ce qui accroche l'œil à f:0${title ? ' ; le titre dit-il la fin ?' : ''}. Défaut majeur (error, S1) seulement si rien de la première phrase n'est visible ; sinon remarque (warning).`,
  ]
    .filter(Boolean)
    .join('\n');
}

export type ReviewOptions = {
  final?: boolean;
  round?: number;
  mode?: 'auto' | 'global' | 'delta';
};

export async function reviewEpisodeBoard(
  provider: Provider,
  projectRoot: string,
  slug: string,
  signal?: AbortSignal,
  opts: ReviewOptions = {},
): Promise<ReviewReport> {
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  const outDir = path.join(projectRoot, 'out', slug);
  const epRaw = readText(epDir, 'episode.json', 3_000_000) ?? '{}';
  const directorRaw = readText(epDir, 'DIRECTOR.md', 200_000) ?? '(aucun DIRECTOR.md)';
  const bibleRaw = readText(epDir, 'bible.json', 8_000) ?? '';
  let stagedShots: any[] = [];
  try {
    stagedShots = (JSON.parse(epRaw).shots ?? []).filter((s: any) => s?.stage);
  } catch {
    /* episode.json unreadable: no cards */
  }
  const cardsBlock = (ids?: string[]): string => {
    const text = formatStageCards(stagedShots, ids);
    return text ? `\n\n## Fiches de mise en scène (ce que CHAQUE plan doit montrer — juge l'image contre sa fiche)\n${text.slice(0, 16_000)}` : '';
  };
  const epSrc = readEpisodeShots(epDir);
  const aspect = episodeAspect(projectRoot, epRaw);

  let timeline: any = null;
  try {
    timeline = JSON.parse(readText(epDir, 'timeline.json', 600_000) ?? 'null');
  } catch {
    timeline = null;
  }
  let ep: any = {};
  try {
    ep = JSON.parse(epRaw);
  } catch {
    ep = {};
  }
  const epLang = detectEpisodeLanguage(ep);
  const langUpper = epLang.toUpperCase();

  const shotTimings = new Map<string, { len: number; key: number }>();
  for (const s of Array.isArray(timeline?.shots) ? timeline.shots : []) {
    if (s?.id) {
      const len = Number(s.len ?? 60);
      const key = Math.min(Math.max(0, Number(s.key ?? 18)), Math.max(0, len - 1));
      shotTimings.set(String(s.id).toUpperCase(), { len, key });
    }
  }

  const scriptLines = (Array.isArray(ep?.script) ? ep.script : [])
    .map((b: any, i: number) => `${i + 1}. ${String(b?.text ?? '').trim()}`)
    .join('\n');

  const formatShotBreakdown = (filterIds?: Set<string>) =>
    (Array.isArray(ep?.shots) ? ep.shots : [])
      .filter((s: any) => !filterIds || filterIds.has(String(s?.id ?? '').toUpperCase()))
      .map((s: any) => {
        const id = String(s?.id ?? '').toUpperCase();
        const tm = shotTimings.get(id);
        const tmTag = tm ? `, len=${tm.len}f, vignette@t=${tm.key}f` : '';
        return `- ${s.id} [${s.size ?? 'medium'}, set=${s.set ?? 'custom'}${tmTag}]: "${s.note ?? ''}"`;
      })
      .join('\n');

  const boardDir = path.join(outDir, 'board');
  const boardStillIds = fs.existsSync(boardDir)
    ? sortShotIds(
        fs
          .readdirSync(boardDir)
          .filter((n) => /^S\d+\.png$/i.test(n))
          .map((n) => n.replace(/\.png$/i, '').toUpperCase()),
      )
    : [];

  const sheetsDir = path.join(outDir, 'sheets');
  const sheetFiles = fs.existsSync(sheetsDir)
    ? fs
        .readdirSync(sheetsDir)
        .filter((n) => /^sheet-\d+\.jpe?g$/i.test(n))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    : [];

  // Determine whether this review is Round 1 (Global 100% Audit) or Round 2+ (Targeted High-Res Delta Re-check)
  const prevReview = loadPreviousReview(outDir);
  const prevErrors = prevReview?.ok && !prevReview.pass ? prevReview.issues.filter((i) => i.severity === 'error') : [];
  const prevRound = typeof prevReview?.round === 'number' ? prevReview.round : 0;
  const round = opts.round ?? (prevReview?.ok ? prevRound + 1 : 1);

  const requestedMode = opts.mode ?? 'auto';
  const prevCreatedMs = prevReview?.createdAt ? Date.parse(prevReview.createdAt) || 0 : 0;
  const flaggedShots = sortShotIds(prevErrors.flatMap((i) => extractShotIds(i.shot)));
  const modifiedShots: string[] = [];
  if (prevCreatedMs > 0) {
    for (const [id, mt] of epSrc.shotMtimesMs) {
      if (epSrc.isModular && mt > prevCreatedMs + 500) modifiedShots.push(id);
    }
    for (const id of boardStillIds) {
      try {
        const st = fs.statSync(path.join(boardDir, `${id}.png`));
        if (st.mtimeMs > prevCreatedMs + 500) modifiedShots.push(id);
      } catch {
        /* ignore */
      }
    }
  }
  const deltaTargetShots = sortShotIds([...flaggedShots, ...modifiedShots]);
  const useDeltaMode =
    requestedMode === 'delta' ||
    (requestedMode === 'auto' &&
      Boolean(
        prevReview?.ok &&
          deltaTargetShots.length > 0 &&
          ((!prevReview.pass && (prevReview.blocking || prevReview.reopened) && prevErrors.length > 0) || prevReview.pass),
      ));

  const sizeDrift = directorSizeMismatches(directorRaw, ep);
  const autoMetrics = [
    staticMetrics(epSrc),
    accentMetrics(epSrc),
    timingMetrics(timeline),
    sizeDrift.length ? `écarts de taille DIRECTOR.md ↔ episode\.json (${sizeDrift.length}) : ${sizeDrift.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let finalReport: ReviewReport;
  let sawImagesOverall = false;
  let batchCount = 1;

  const openingStatus = readOpeningStatus(projectRoot, slug, timeline);

  if (useDeltaMode && deltaTargetShots.length > 0) {
    // ── MODE 2: High-Resolution Targeted Delta Re-check (Rounds 2+) ──
    const targetChunks = chunkArray(deltaTargetShots, MAX_REVIEW_IMAGES);
    batchCount = targetChunks.length;
    const chunkReports: ReviewReport[] = [];

    for (let cIdx = 0; cIdx < targetChunks.length; cIdx++) {
      const chunkIds = targetChunks[cIdx]!;
      const chunkSet = new Set(chunkIds);
      const images: ImagePart[] = [];
      for (const id of chunkIds) {
        const img = readImagePart(path.join(boardDir, `${id}.png`), 'image/png');
        if (img) images.push(img);
      }
      // Fallback if individual board PNGs are absent (e.g. minimal unit test fixtures)
      if (!images.length) {
        for (const n of sheetFiles.slice(0, MAX_REVIEW_IMAGES)) {
          const img = readImagePart(path.join(sheetsDir, n), 'image/jpeg');
          if (img) images.push(img);
        }
      }
      if (!images.length) {
        const strip = readImagePart(path.join(outDir, 'storyboard.jpg'), 'image/jpeg');
        if (strip) images.push(strip);
      }

      const relevantPrevErrors = prevErrors.filter((iss) => {
        const ids = extractShotIds(iss.shot);
        return !ids.length || ids.some((id) => chunkSet.has(id));
      });
      const prevIssuesList = (relevantPrevErrors.length ? relevantPrevErrors : prevErrors)
        .map((iss) => `- [${iss.shot}] Problème signalé : ${iss.problem}\n  Correctif demandé : ${iss.fix}`)
        .join('\n');
      const wordMarks = shotWordFrames(projectRoot, slug, chunkIds);

      const deltaUserPrompt = [
        `# Contre-visite ciblée (Tour ${round}) de l'épisode "${slug}" (orientation: ${aspect}, langue: ${langUpper})`,
        targetChunks.length > 1 ? `Lot ciblé ${cIdx + 1}/${targetChunks.length} — plans vérifiés : ${chunkIds.join(', ')}` : `Plans ciblés vérifiés : ${chunkIds.join(', ')}`,
        `## 1. Problèmes bloquants signalés au tour précédent (à vérifier point par point)\n${prevIssuesList}`,
        `## 2. Script complet (narration ${langUpper} — contexte)\n${scriptLines.slice(0, 25_000)}`,
        `## 3. Découpage des plans ciblés (episode.json.shots)\n${formatShotBreakdown(chunkSet) || '(aucune entrée)'}`,
        wordMarks.length ? `## 4. Repères mot@frame sur l'horloge propre de chaque plan ciblé\n${wordMarks.join('\n')}` : '',
        bibleRaw ? `## 5. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 6. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 14_000)}${cardsBlock(chunkIds)}`,
        `## 7. Code COMPLET non tronqué des plans ciblés\n${summarizeShotsCode(epSrc, { onlyShots: chunkIds, shotTimings, perShotChars: 8_000 })}`,
        images.length
          ? `\n${images.length} image(s) pleine résolution jointe(s) (${chunkIds.join(', ')}). Vérifie uniquement si les problèmes ci-dessus sont résolus sur ces plans et renvoie ton verdict JSON.`
          : `\nVérifie sur le code complet ci-dessus si les problèmes bloquants signalés sur ${chunkIds.join(', ')} sont résolus, puis renvoie ton verdict JSON.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { report, sawImages } = await askReviewerWithFallback(
        provider,
        deltaReviewerSystemPrompt(epLang),
        deltaUserPrompt,
        images,
        slug,
        signal,
      );
      if (sawImages) sawImagesOverall = true;
      chunkReports.push(report);
    }

    finalReport = mergeBatchReports(chunkReports, provider.model, slug);
    finalReport.mode = 'delta';
    finalReport.targetShots = deltaTargetShots;
  } else {
    // ── MODE 1: Global 100% Audit across ALL contact sheets in chunks of <= 6 sheets ──
    // The opening sheet rides with the first batch only when at least one exact opening capture exists.
    const hasOpening = openingStatus.hasSheet;
    const firstSize = hasOpening ? MAX_REVIEW_IMAGES - 1 : MAX_REVIEW_IMAGES;
    const sheetChunks = sheetFiles.length
      ? [sheetFiles.slice(0, firstSize), ...chunkArray(sheetFiles.slice(firstSize), MAX_REVIEW_IMAGES)].filter((c, i) => i === 0 || c.length)
      : [[]];
    batchCount = sheetChunks.length;
    const perSheet = aspect === '9:16' ? 8 : 9;
    const orderedAllShots = boardStillIds.length ? boardStillIds : epSrc.exportedShotIds;
    const chunkReports: ReviewReport[] = [];

    for (let cIdx = 0; cIdx < sheetChunks.length; cIdx++) {
      const chunkSheets = sheetChunks[cIdx]!;
      const images: ImagePart[] = [];
      for (const n of chunkSheets) {
        const img = readImagePart(path.join(sheetsDir, n), 'image/jpeg');
        if (img) images.push(img);
      }
      if (!images.length && cIdx === 0) {
        const strip = readImagePart(path.join(outDir, 'storyboard.jpg'), 'image/jpeg');
        if (strip) images.push(strip);
      }
      // Opening sheet (exact frames 0, 30, 60 at phone width, built by board_sheets.py): judged once, or marked unknown when captures are absent.
      let openingBlock = '';
      if (cIdx === 0) {
        const openingImg = hasOpening ? readImagePart(path.join(sheetsDir, 'opening.jpg'), 'image/jpeg') : null;
        if (openingImg) {
          images.push(openingImg);
          openingBlock = openingReviewBlock(ep, scriptLines, openingStatus);
        } else if (ep?.opening || fs.existsSync(path.join(sheetsDir, 'opening.json'))) {
          openingBlock = openingReviewBlock(ep, scriptLines, { ...openingStatus, exact: [], hasSheet: false, verified: false });
        }
      }

      // Map this sheet batch (e.g. sheet-06..sheet-09) to the exact shots rendered on those sheets when multi-batch
      const priorSheets = sheetChunks.slice(0, cIdx).reduce((sum, c) => sum + c.length, 0);
      let batchShots: string[] | undefined;
      if (sheetChunks.length > 1 && orderedAllShots.length > priorSheets * perSheet) {
        const startShotIdx = priorSheets * perSheet;
        const endShotIdx = startShotIdx + chunkSheets.length * perSheet;
        const slice = orderedAllShots.slice(startShotIdx, endShotIdx);
        if (slice.length) batchShots = slice;
      }

      const sheetRangeNote =
        sheetChunks.length > 1
          ? ` (lot ${cIdx + 1}/${sheetChunks.length} : planches ${priorSheets + 1} à ${priorSheets + chunkSheets.length} sur ${sheetFiles.length}${batchShots ? `, couvrant ${batchShots[0]}..${batchShots[batchShots.length - 1]}` : ''})`
          : '';

      const userPrompt = [
        `# Audit indépendant de l'épisode "${slug}" (orientation: ${aspect}, langue: ${langUpper}, defaultSet: ${JSON.stringify(ep?.defaultSet ?? '')})${sheetRangeNote}`,
        `## 1. Script complet (narration ${langUpper})\n${scriptLines.slice(0, 25_000)}`,
        `## 2. Découpage des plans (episode.json.shots)\n${formatShotBreakdown().slice(0, 25_000)}`,
        bibleRaw ? `## 3. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 4. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 15_000)}${cardsBlock(batchShots)}`,
        `## 5. Code des plans (${epSrc.isModular ? 'shared.tsx + shots/S*.tsx' : 'shots.tsx'})\n${summarizeShotsCode(epSrc, { onlyShots: batchShots, shotTimings, perShotChars: 2_600 })}`,
        `## 6. Mesures automatiques (lues dans les plans et timeline.json)\n${autoMetrics}`,
        openingBlock,
        images.length
          ? `\n${images.length} planche(s) de contact jointe(s)${sheetRangeNote} (plans dans l'ordre, légende = numéro du plan, taille, début du texte). Compare chaque vignette (capturée à t=key) et le code des plans au récit et à DIRECTOR.md, puis renvoie ton verdict JSON.`
          : `\nInspecte la cohérence entre le récit, DIRECTOR.md et le code des plans, puis renvoie ton verdict JSON.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { report, sawImages } = await askReviewerWithFallback(
        provider,
        reviewerSystemPrompt(epLang),
        userPrompt,
        images,
        slug,
        signal,
      );
      if (sawImages) sawImagesOverall = true;
      chunkReports.push(report);
    }

    finalReport = mergeBatchReports(chunkReports, provider.model, slug);
    finalReport.mode = 'global';
    if (openingStatus.stale) {
      finalReport.pass = false;
      finalReport.issues.unshift({
        shot: 'S1',
        severity: 'error',
        problem: `Captures ou métadonnées d'ouverture obsolètes/invalides (${openingStatus.reason ?? 'stale'}) : les sources, timeline.json ou images out/${slug}/opening/ ne correspondent plus au dernier rendu.`,
        fix: `Relancer whatif_run({ episode: "${slug}", step: "stills" }) puis whatif_run({ episode: "${slug}", step: "board" }) avant toute validation.`,
      });
    }
    finalReport.summary = guardUnverifiedOpeningClaims(finalReport.summary, openingStatus.missing, openingStatus);
  }

  finalReport.openingFrames = {
    exact: openingStatus.exact,
    ...(openingStatus.unverified.length ? { unverified: openingStatus.unverified } : {}),
    missing: openingStatus.missing,
    verified: openingStatus.verified,
    ...(openingStatus.stale ? { stale: true } : {}),
    ...(openingStatus.reason ? { reason: openingStatus.reason } : {}),
  };
  finalReport.round = round;
  finalReport.batches = batchCount;
  finalReport.sawImages = sawImagesOverall;
  // The same shot refused three reviews in a row will not be fixed by a fourth: on 2026-11-13 three projects went to
  // round 8 ("5e signalement, correctif toujours non appliqué") and ended refused anyway. Stop, ship, list the defects.
  const strikes = nextStrikes(prevReview?.ok && !prevReview.pass ? prevReview.strikes : undefined, finalReport);
  finalReport.strikes = strikes;
  const gaveUpOn = finalReport.ok && !finalReport.pass ? Object.keys(strikes).filter((id) => strikes[id]! >= MAX_STRIKES) : [];
  if (gaveUpOn.length) finalReport.gaveUpOn = gaveUpOn;
  const final = Boolean(opts.final) || gaveUpOn.length > 0;
  finalReport.blocking = finalReport.ok && !finalReport.pass && !final;
  if (finalReport.ok && finalReport.pass) {
    try {
      fs.rmSync(path.join(outDir, 'DEFAUTS-NON-CORRIGES.md'), { force: true });
    } catch {
      /* ignore */
    }
  } else if (final && finalReport.ok && !finalReport.pass) {
    const file = writeUnresolvedDefects(projectRoot, slug, finalReport);
    if (file) finalReport.defectsFile = file;
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(finalReport, null, 2) + '\n');
  } catch {
    /* ignore write error */
  }

  return finalReport;
}

/**
 * The cards read before any shot is coded: text only, one short call. A weak picture is cheaper to fix as a sentence
 * than as code, stills and a review round. Advisory: it never blocks, it runs once per set of cards, and an unreadable
 * answer is silence, not a verdict. Returns the note for the agent, or null when there is nothing to say.
 */
/**
 * What the cards say about variety, counted: an episode can have forty correct shots and still be one picture
 * (custom-shortlist-086: one man, his phone, his living room, from the first shot to the last).
 */
export function varietyFigures(shots: any[]): { places: number; people: number; longestRun: number; runFrom: string; runTo: string; topObject: string; topObjectShare: number; text: string } {
  const cards = shots.filter((s) => s?.stage);
  const key = (s: any): string => {
    const who = (Array.isArray(s.stage.people) ? s.stage.people : []).map((p: any) => String(p?.who ?? '').trim().toUpperCase()).filter(Boolean).sort().join('+');
    return who ? `${who}@${String(s.stage.zone ?? s.set ?? '')}` : '';
  };
  const places = new Set(cards.map((s) => String(s.set ?? '')).filter(Boolean)).size;
  const people = new Set(cards.flatMap((s) => (Array.isArray(s.stage.people) ? s.stage.people : []).map((p: any) => String(p?.who ?? '').trim().toUpperCase())).filter(Boolean)).size;
  let longestRun = 0;
  let runFrom = '';
  let runTo = '';
  let run = 0;
  let start = '';
  let whoPrev = '';
  for (const s of cards) {
    const who = key(s).split('@')[0] ?? '';
    if (who && who === whoPrev) run++;
    else {
      run = who ? 1 : 0;
      start = String(s.id);
    }
    whoPrev = who;
    if (run > longestRun) {
      longestRun = run;
      runFrom = start;
      runTo = String(s.id);
    }
  }
  const objects = new Map<string, number>();
  for (const s of cards) for (const o of new Set((Array.isArray(s.stage.objects) ? s.stage.objects : []).map((x: any) => String(x).trim().toLowerCase()).filter(Boolean))) objects.set(o as string, (objects.get(o as string) ?? 0) + 1);
  const top = [...objects.entries()].sort((a, b) => b[1] - a[1])[0];
  const topObject = top?.[0] ?? '';
  const topObjectShare = cards.length && top ? Math.round((top[1] / cards.length) * 100) / 100 : 0;
  const text = [
    `- lieux distincts : ${places} ; personnes distinctes : ${people} ; fiches : ${cards.length}`,
    `- plus longue série de fiches avec exactement les mêmes personnes à l'image : ${longestRun}${longestRun > 1 ? ` (${runFrom} à ${runTo})` : ''}`,
    topObject ? `- objet le plus présent : « ${topObject} » dans ${Math.round(topObjectShare * 100)} % des fiches` : '- aucun objet déclaré',
  ].join('\n');
  return { places, people, longestRun, runFrom, runTo, topObject, topObjectShare, text };
}

export async function reviewStageCards(provider: Provider, projectRoot: string, slug: string, signal?: AbortSignal): Promise<string | null> {
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  let ep: any;
  try {
    ep = JSON.parse(readText(epDir, 'episode.json', 3_000_000) ?? 'null');
  } catch {
    return null;
  }
  const shots: any[] = Array.isArray(ep?.shots) ? ep.shots : [];
  if (!shots.length || shots.some((s) => !s?.stage)) return null;
  const cards = formatStageCards(shots);
  const sig = String(cards.length) + ':' + [...cards].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  const marker = path.join(projectRoot, 'out', slug, 'cards-review.json');
  // Once per episode, and only while nothing is coded. Read again at every change, it ran 26 times AFTER the code and
  // each answer had the agent rewrite cards instead of shots: 26 minutes for nothing (custom, 2026-11-13).
  if (fs.existsSync(marker)) return null;
  if (shots.some((s) => shotCoded(epDir, String(s.id)))) return null;
  const script = (Array.isArray(ep.script) ? ep.script : []).map((b: any) => String(b?.text ?? '')).join(' ').slice(0, 9_000);
  const system = `Tu es réalisateur d'animation. On te donne le script d'un épisode court et la fiche de mise en scène de chaque plan, AVANT que le moindre plan soit codé. Dis seulement ce qui donnera une mauvaise image : un plan sans sujet clair ; une action qu'on ne peut pas dessiner ou trop vague ; un personnage qui change de place sans raison entre deux plans voisins ; un objet qui apparaît ou disparaît sans être pris ni posé ; celui qui agit dans le texte absent du plan ; trois plans de suite au même cadre et même point de vue ; un dialogue entier filmé face au même mur sans alterner les angles (view: "3/4-left", "3/4-right", "ots", "pov") ; un changement de lieu dans le texte qui reste coincé dans l'ancien décor ; un format vertical où deux personnages sont côte à côte au lieu d'être en profondeur. Ne commente pas ce qui va bien. Réponds en JSON strict : {"issues":[{"shot":"S4","problem":"…","fix":"…"}]} avec 8 remarques au plus, les plus graves d'abord ; {"issues":[]} si tout est bon.`;
  const variety = varietyFigures(shots);
  const monotone = variety.longestRun > 6 || variety.topObjectShare > 0.4;
  const varietyNote = `## Variété (comptée sur les fiches)\n${variety.text}\n${
    monotone
      ? "Ces chiffres annoncent un épisode monotone. Dans la série la plus longue, désigne 1 à 3 fiches à transformer en plan d'évocation : ce dont parle la phrase, montré sans la personne (l'objet nommé, un écran, un document, le lieu vide, un détail), et jamais le même appareil que l'insert précédent. Donne pour chacune ce qui remplit le cadre."
      : "Rien d'alarmant sur la variété : n'en parle pas."
  }`;
  const user = `## Script\n${script}\n\n${varietyNote}\n\n## Fiches (format ${ep.aspect ?? '16:9'}, ${shots.length} plans)\n${cards.slice(0, 20_000)}`;
  let issues: { shot: string; problem: string; fix: string }[] = [];
  try {
    const text = await chatWithin(provider, [{ role: 'system', content: system }, { role: 'user', content: user }], signal);
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : null;
    if (!parsed || !Array.isArray(parsed.issues)) return null;
    issues = parsed.issues.filter((i: any) => i && typeof i.problem === 'string' && i.problem.trim()).slice(0, 8).map((i: any) => ({ shot: String(i.shot ?? '?'), problem: String(i.problem), fix: String(i.fix ?? '') }));
  } catch {
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ sig, model: provider.model, createdAt: new Date().toISOString(), issues }, null, 2) + '\n');
  } catch {
    /* the note still goes to the agent */
  }
  if (!issues.length) return null;
  return [
    `[REVIEWER — LECTURE DES FICHES, avant le code] ${issues.length} fiche(s) donneraient une image faible. Corrige-les avec stage_shots (seulement ces plans) AVANT de coder ; c'est un conseil, rien n'est bloqué :`,
    ...issues.map((i) => `- [${i.shot}] ${i.problem}${i.fix ? `\n  → ${i.fix}` : ''}`),
  ].join('\n');
}

export const SCRIPT_REVIEW_SYSTEM = `Tu es relecteur de scripts pour des vidéos courtes racontées par une seule voix. On te donne le texte d'origine, le texte proposé pour la voix et la fiche de lecture de l'auteur des corrections. Tu vérifies deux choses, rien d'autre.

1. MÊME HISTOIRE. Aucun fait, personnage ou réplique inventé qui change l'histoire. La chute est la même. Même narrateur (« je » ou « il/elle »), même langue. Aucun fait retiré dont la suite dépend.

2. CONTRAT.
- ouverture : la première phrase est un acte précis et anormal d'une personne, qu'on peut dessiner. Pas une règle, un décor, une date, un résumé ni une morale.
- enjeu : ce que la personne risque apparaît dans les trois premières phrases.
- voix : on sait toujours qui parle ; pas de style télégraphique qu'on ne peut pas suivre à l'oreille.
- chute : elle arrive dans les quatre dernières phrases. Après elle : un geste ou une conséquence. Jamais une morale, une explication de ce qu'on vient de voir, ou la phrase d'ouverture recollée.
- balises : les indications entre crochets correspondent à ce qui est dit ; pas de balise lente sur la chute.

Ne juge pas le style et ne demande aucune réécriture de goût. Si le texte d'origine respectait déjà le contrat et qu'il n'a pas été abîmé, accepte. Si la fiche déclare le texte « good » alors qu'il viole le contrat, refuse et dis quoi corriger.

Réponds UNIQUEMENT par un objet JSON : {"pass": true|false, "sameStory": true|false, "issues": [{"rule": "histoire|ouverture|enjeu|voix|chute|balises", "quote": "<phrase citée>", "problem": "<le défaut>", "fix": "<la correction>"}]}. Le booléen "sameStory" est OBLIGATOIRE dans chaque réponse (sans "sameStory": true, le script n'est jamais validé). "pass" est faux si "sameStory" est faux ou si une règle du contrat est violée. Cinq défauts au plus, les plus graves.`;

/**
 * The second reading of the narration, before the voice (text only). Accepted: the text is approved. Refused: the agent
 * corrects, twice at most, then the story is dropped. An answer that cannot be read is never an acceptance: it counts as
 * "no verdict", and after two of those the text goes on with the agent's reading only (Pulsy, 2026-11-19).
 */
export async function reviewScript(provider: Provider, projectRoot: string, slug: string, signal?: AbortSignal): Promise<string | null> {
  const state = readScriptState(projectRoot, slug);
  if (!state || state.status !== 'review') return null;
  const expectedSig = typeof state.submittedSig === 'string' && state.submittedSig.trim() ? state.submittedSig.trim() : null;
  const pack = readText(path.join(projectRoot, 'out', slug), 'script-pack.md', 200_000) ?? (fs.existsSync(scriptFiles(projectRoot, slug).pack) ? fs.readFileSync(scriptFiles(projectRoot, slug).pack, 'utf8') : '');
  const submittedSig = pack.trim() ? packSubmittedSig(pack) : null;
  if (!expectedSig || !submittedSig || submittedSig !== expectedSig) {
    return recordScriptReview(projectRoot, slug, {
      pass: false,
      sameStory: false,
      sig: expectedSig ?? 'missing-submitted-sig',
      model: provider.model,
    }).summary;
  }
  let text = '';
  try {
    text = await chatWithin(provider, [{ role: 'system', content: SCRIPT_REVIEW_SYSTEM }, { role: 'user', content: pack.slice(0, 60_000) }], signal);
  } catch (err) {
    if (signal?.aborted) return null;
    return recordScriptReviewFailure(
      projectRoot,
      slug,
      err instanceof ReviewTimeout ? err.message : `reviewer error: ${String((err as Error)?.message ?? err).slice(0, 120)}`,
      submittedSig,
    ).summary;
  }
  let parsed: any = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.pass !== 'boolean') {
    return recordScriptReviewFailure(projectRoot, slug, 'the reviewer answer is not a verdict', submittedSig).summary;
  }
  return recordScriptReview(projectRoot, slug, {
    pass: parsed.pass,
    sameStory: typeof parsed.sameStory === 'boolean' ? parsed.sameStory : undefined,
    sig: submittedSig,
    issues: parsed.issues,
    model: provider.model,
  }).summary;
}

export const MAX_STRIKES = 3;
const shotIdsOf = (shot: unknown): string[] => [...new Set((String(shot ?? '').toUpperCase().match(/\bS\d+\b/g) ?? []))];
/** Refusals in a row per shot: +1 for each shot with an error in this review, back to nothing for the others. */
export function nextStrikes(prev: Record<string, number> | undefined, report: { ok: boolean; pass: boolean; issues: { shot?: unknown; severity?: string }[] }): Record<string, number> {
  if (!report.ok || report.pass) return {};
  const out: Record<string, number> = {};
  for (const i of report.issues) {
    if (i.severity !== 'error') continue;
    for (const id of shotIdsOf(i.shot)) out[id] = Math.max(out[id] ?? 0, (prev?.[id] ?? 0) + 1);
  }
  return out;
}

/**
 * The shots the last review refused, when nothing that could fix them has changed since (null otherwise).
 * Asking the reviewer again would cost a paid call and give the same verdict (z8nvytvrw5c, 2026-11-11: 16 minutes for nothing).
 * Changes that count: a refused shot's own file, any shared file of the episode, DIRECTOR.md, episode.json.
 */
export function refusedUnchanged(projectRoot: string, slug: string): string[] | null {
  const prev = loadPreviousReview(path.join(projectRoot, 'out', slug));
  if (!prev?.ok || prev.pass || !(prev.blocking || prev.reopened) || !prev.createdAt) return null;
  const since = (Date.parse(prev.createdAt) || 0) + 500;
  const refused = sortShotIds(prev.issues.filter((i) => i.severity === 'error').flatMap((i) => extractShotIds(i.shot)));
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  const newer = (file: string): boolean => {
    try {
      return fs.statSync(file).mtimeMs > since;
    } catch {
      return false;
    }
  };
  const walk = (dir: string, depth = 0): boolean => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    for (const n of names) {
      const f = path.join(dir, n);
      let st: fs.Stats;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 2 && walk(f, depth + 1)) return true;
        continue;
      }
      // a modular shot file only matters when that shot was refused
      const m = /^(S\d+)\.tsx$/i.exec(n);
      if (m && path.basename(dir) === 'shots' && !refused.includes(m[1]!.toUpperCase())) continue;
      if (/\.(tsx?|json|md)$/i.test(n) && !/^(timeline|words)\.json$/.test(n) && st.mtimeMs > since) return true;
    }
    return false;
  };
  if (walk(epDir)) return null;
  return refused.length ? refused : null;
}

/** Written next to the video when the last review round still refused it: the video ships, with this list. */
export function writeUnresolvedDefects(projectRoot: string, slug: string, report: ReviewReport): string | null {
  const errors = report.issues.filter((i) => i.severity === 'error');
  if (report.pass || !errors.length) return null;
  const rel = `out/${slug}/DEFAUTS-NON-CORRIGES.md`;
  const body = [
    `# Défauts non corrigés — ${slug}`,
    '',
    `Le Reviewer (${report.model}) a refusé la planche au dernier tour (tour ${report.round ?? '?'}). La vidéo est rendue quand même : voici ce qui n'est pas corrigé.`,
    '',
    `Résumé : ${report.summary}`,
    '',
    ...errors.map((e) => `- **${e.shot}** — ${e.problem}\n  → ${e.fix}`),
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.join(projectRoot, 'out', slug), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, rel), body);
    return rel;
  } catch {
    return null;
  }
}

/**
 * A review closed with defects (three refusals of a shot, or no round left) stays closed for the run that made it.
 * When the user writes again on that project ("fix S5 and S38, then render"), the fixes deserve a look: the counts
 * start again and the next board is reviewed, on the changed shots only. The render is not held back meanwhile.
 * Returns the shots that were left refused, or null when there is nothing to reopen.
 */
export function reopenReview(projectRoot: string, slug: string): string[] | null {
  const file = path.join(projectRoot, 'out', slug, 'review.json');
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewReport;
    if (!report?.ok || report.pass || report.blocking || report.reopened) return null;
    const refused = sortShotIds(report.issues.filter((i) => i.severity === 'error').flatMap((i) => extractShotIds(i.shot)));
    if (!refused.length) return null;
    const { gaveUpOn: _g, strikes: _s, ...rest } = report;
    fs.writeFileSync(file, JSON.stringify({ ...rest, reopened: true }, null, 2) + '\n');
    return refused;
  } catch {
    return null;
  }
}

/**
 * The agent asked for the render again and again without touching a refused shot: it will not fix them. The review is
 * closed as after three refusals of a shot: the video ships with the list of its defects. Returns the defects file.
 */
export function giveUpReview(projectRoot: string, slug: string): string | null {
  const file = path.join(projectRoot, 'out', slug, 'review.json');
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewReport;
    if (!report?.ok || report.pass || !report.blocking) return null;
    const refused = sortShotIds(report.issues.filter((i) => i.severity === 'error').flatMap((i) => extractShotIds(i.shot)));
    const defectsFile = writeUnresolvedDefects(projectRoot, slug, report) ?? undefined;
    fs.writeFileSync(file, JSON.stringify({ ...report, blocking: false, gaveUpOn: refused, defectsFile }, null, 2) + '\n');
    return defectsFile ?? `out/${slug}/review.json`;
  } catch {
    return null;
  }
}

/** A board that was not reviewed cannot stay refused: the reviewer failed, is off, or has no round left. */
export function clearReviewBlock(projectRoot: string, slug: string): void {
  const file = path.join(projectRoot, 'out', slug, 'review.json');
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.blocking) fs.writeFileSync(file, JSON.stringify({ ...report, blocking: false }, null, 2) + '\n');
  } catch {
    /* no review yet */
  }
}

export function formatReviewFeedback(report: ReviewReport, slug: string, wordFrames: string[] = []): string {
  if (!report.ok && report.timedOut) {
    return `[reviewer indépendant · ${report.model}] Audit de "${slug}" : NON VÉRIFIÉ. ${report.summary}\nContinue la chaîne : vérifie toi-même les planches de contact.`;
  }
  if (!report.ok) {
    return `[reviewer indépendant · ${report.model}] Audit de "${slug}" : NON VÉRIFIÉ (réponse illisible, deux essais). ${report.summary}\nContinue la chaîne : vérifie toi-même les planches de contact.`;
  }
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warns = report.issues.filter((i) => i.severity === 'warn');
  const affectedShots = sortShotIds(errors.flatMap((i) => extractShotIds(i.shot)));
  const modeLabel =
    report.mode === 'delta'
      ? `Contre-visite ciblée (tour ${report.round ?? 2}${report.targetShots?.length ? ` · ${report.targetShots.join(', ')}` : ''})`
      : `Audit global${report.batches && report.batches > 1 ? ` (${report.batches} lots, 100% des planches)` : ''}`;

  const lines: string[] = [
    `[reviewer indépendant · ${report.model}] ${modeLabel} de "${slug}" : ${report.pass ? 'VALIDÉ ✓' : 'CORRECTIONS REQUISES ✗'}`,
    `Résumé : ${report.summary}`,
    ...(report.sawImages === false ? ["(Ce modèle n'accepte pas les images : verdict établi sur le code seul.)"] : []),
  ];
  if (errors.length) {
    lines.push(`\nProblèmes bloquants à corriger plan par plan (avec edit_shot) :`);
    for (const err of errors) {
      lines.push(`- [${err.shot}] Problème : ${err.problem}\n  → Correctif : ${err.fix}`);
    }
    if (wordFrames.length) lines.push(`\nMoment de chaque mot dans ces plans (mot@image, horloge du plan) pour placer les beats :\n${wordFrames.join('\n')}`);
    if (report.defectsFile) {
      lines.push(
        `\n⚠ ${report.gaveUpOn?.length ? `ARRÊT DE LA REVUE : ${report.gaveUpOn.join(', ')} refusé(s) ${MAX_STRIKES} fois de suite, une revue de plus ne changerait rien.` : 'DERNIER TOUR :'} il n'y a plus de contre-visite. Le rendu n'est plus bloqué, mais ces défauts restent. Corrige ce que tu peux d'abord ; puis, quoi que tu fasses, termine ton message final par « Vidéo livrée avec ${affectedShots.length || errors.length} défaut(s) non corrigé(s) » et cite-les. La liste est dans ${report.defectsFile}.`,
      );
    }
    const rerunArgs = affectedShots.length ? `, args: ${JSON.stringify(affectedShots)}` : '';
    lines.push(
      `\nApplique ces corrections plan par plan avec edit_shot { episode: "${slug}", id: "S...", code: "..." } (sans toucher aux autres plans déjà validés), relance uniquement les plans modifiés via whatif_run { episode: "${slug}", step: "stills"${rerunArgs} } puis whatif_run { episode: "${slug}", step: "board" }, et enchaîne ensuite sfx -> render -> master.`,
    );
  } else if (warns.length) {
    lines.push(`\nRemarques mineures (non bloquantes) :`);
    for (const w of warns) {
      lines.push(`- [${w.shot}] ${w.problem} (${w.fix})`);
    }
  }
  return lines.join('\n');
}
