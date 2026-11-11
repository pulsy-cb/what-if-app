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
import { directorSizeMismatches, timedChanges } from '../tools/whatif.js';
import { shotWordFrames } from './context.js';

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
};

const MAX_REVIEW_IMAGES = 6;

const REVIEWER_SYSTEM_PROMPT = `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Tu n'as PAS écrit le code : ton rôle est d'auditer en toute indépendance la cohérence entre le récit (script FR), la note de mise en scène (DIRECTOR.md), le code des plans (shared.tsx + shots/S*.tsx ou shots.tsx) et les planches de contact du storyboard (images jointes, 8 à 9 plans chacune).

IMPORTANT — Vignette fixe vs animation réelle du plan :
Chaque vignette sur une planche de contact est capturée à UN SEUL instant \`t = key\` (indiqué pour chaque plan, souvent \`t = 18f\`, soit 0,6 s après la coupe). Un plan de 2 à 4 s comporte souvent plusieurs phases ou beats (\`beats: [{ at: ... }]\`, \`t < ...\`, \`poseAt\`, \`faceAt\`, \`grabAt\`). Avant d'affirmer qu'un geste de milieu ou de fin de phrase manque sur la vignette, VÉRIFIE LE CODE DU PLAN : si l'action est programmée aux frames suivantes sur l'horloge \`0..len\`, elle se joue bien en vidéo et CE N'EST PAS UN DÉFAUT !

Vérifie particulièrement ces 9 points critiques :
1. **Fidélité décor & accessoires (DIRECTOR.md ↔ code / storyboard)** :
   - Le décor codé et visible correspond-il au lieu de l'histoire et à DIRECTOR.md (murs, ambiance jour/nuit, mobilier comme canapé, table, bol, miroir, fenêtre) ?
   - Si le récit dit qu'un personnage bondit d'un canapé ou pose un objet sur une table, ces éléments existent-ils vraiment dans la scène ?
2. **Casting des personnages, cohérence physique/familiale, costume & chronologie** :
   - Le genre, l'âge apparent (\`body: 'adult'\` pour adultes/parents/mariés/métiers vs \`'teen'\` réservé aux enfants/ados/élèves) et la tenue correspondent-ils au récit et à \`voice.narratorGender\` (sans inventer de personnage narrateur supplémentaire dans un récit à la 3e personne, ni coller la mascotte \`as: 'heroine'\` au t-shirt anglais \`"her"\` hors propos) ?
   - Les carnations (\`skin\`) sont-elles cohérentes au sein d'une même famille biologique (parents, frère/sœur, jumeaux) ainsi qu'entre un personnage et ses mains en insert (\`phoneShot\` / \`tabletopShot\`) ?
   - **Présence chronologique** : un personnage décédé ou absent au moment de la scène ne doit jamais apparaître debout vivant dans la pièce présente (uniquement sur une photo/écran ou dans un plan flashback \`look: "memory"\`).
   - Si l'histoire tourne autour d'un objet ou vêtement spécifique (ex. un nouveau haut acheté, une fiole, un téléphone, une bague), est-il visuellement distinct et n'est-il porté/tenu qu'au moment où le récit l'indique ?
3. **Inserts & panneaux de texte (<SchLabel> / <Schematic> vs inserts concrets)** :
   - Aucun plan de dialogue ou de réaction émotionnelle ne doit être remplacé par un panneau de texte abstrait (<Schematic>) sans personnage.
   - En revanche, les inserts macro concrets (\`phoneShot\`, \`tabletopShot\` sur dossier/facture/clés/bague/tasse/mains) sont des plans \`insert\` légitimes et encouragés sans \`<Person>\`.
   - Aucun libellé <SchLabel> inventé ou hors sujet.
4. **Cartes-titres (<TitleCard>), accents graphiques & langue française** :
   - Pas de <TitleCard> plein écran en plein milieu de l'histoire qui coupe l'image, ni de sous-titres recopiant la voix.
   - En revanche, les accents graphiques/diégétiques courts en français intégrés au moteur — \`title\` d'accroche sur \`S1\`, \`stamp\` lieu/heure (\`StampCard\`), \`tag\` chiffre/montant (\`ValueTag\`), rayons \`burst\` (\`ShockBurst\`), et micro-effets \`vfx\` (\`shock\`, \`sweat\`, \`focus\`, \`thought\`, etc.) — sont **encouragés** et ne constituent JAMAIS un défaut !
   - Aucun texte en anglais ("YOU PUT ITCHING...", "WHAT IF...") laissé dans un épisode en français.
5. **Cadrage & placement (16:9 ou 9:16)** :
   - Les personnages et objets tenus (handRProp / grabAt / handWorld) sont-ils bien cadrés, sans objet flottant loin des mains ni moitié d'écran vide ?
   - En 9:16 : un tiers ou plus du cadre vide (plafond ou sol sombre), un personnage coupé par le bord sans raison, trois personnages qui ne tiennent pas dans 900/zoom unités de large.
6. **Mise en scène et rythme** :
   - Ce qui se passe à l'image suit-il ce que dit le narrateur au moment où il le dit (geste, regard, objet, réaction) ?
   - Un plan qui tient plus de 6 s sans évènement casse le rythme.
   - Les personnages sont-ils presque tous de face (les « Mesures automatiques » donnent le nombre de plans orientés) ? Deux personnes qui se parlent doivent se faire face (yaw opposés), pas regarder la caméra.
   - Un groupe de 3 doit être étagé en profondeur.
   - Les cadrages varient-ils ? Une amorce floue (Foreground) donne-t-elle de la profondeur dans environ un plan sur trois ?
7. **Lisibilité du lieu** : le lieu se reconnaît-il sans la voix ? Les éléments du décor d'origine sans rapport avec l'histoire (démo « 7 × 8 », rideaux et ciel de crépuscule dans une scène de jour) sont des défauts.
8. **Lumière, contraste, profondeur** : le visage est-il l'élément le plus lumineux de sa zone ? Pas de membre sombre sur mur sombre ?
9. **Cohérence d'un même lieu** : même disposition, mêmes accessoires, mêmes couleurs d'un plan à l'autre.

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

const DELTA_REVIEWER_SYSTEM_PROMPT = `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Ceci est une **CONTRE-VISITE CIBLÉE (Delta Review)** après correction des plans signalés au tour précédent.

Tu reçois :
1. Les problèmes bloquants exacts qui avaient été signalés au tour précédent,
2. Les **images individuelles pleine résolution** (\`out/<slug>/board/S<N>.png\`) des plans corrigés/modifiés,
3. Le **code complet non tronqué** de chacun de ces plans ciblés (ainsi que \`shared.tsx\`, \`DIRECTOR.md\` et le script pour le contexte).

Règles STRICTES de contre-visite (anti-boucle infinie) :
1. **Périmètre verrouillé** : vérifie UNIQUEMENT (a) si les problèmes bloquants signalés au tour précédent sur ces plans ciblés ont été résolus de façon cohérente, et (b) qu'aucune casse visuelle franche (cadre vide, personnage disparu, texte anglais, objet flottant aberrant) n'a été introduite sur ces plans modifiés.
2. **Interdiction de déplacer les poteaux de but** : N'INVENTE PAS de nouvelles exigences sur d'autres plans non signalés, et ne demande pas un réalisme anatomique impossible pour un rig vectoriel 2D (\`shot()\`, \`<Person>\`, \`phoneShot()\`, \`tabletopShot()\`). Les accents graphiques français (\`stamp\`, \`tag\`, \`vfx\`, \`burst\`, \`title\` sur S1) sont intentionnels.
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
    if (/\b(phoneShot|tabletopShot)\s*\(/.test(body)) macroInserts++;
    if (/\b(stamp|tag|title|burst)\s*:|<(StampCard|ValueTag|HookTitle|ShockBurst)\b/.test(body)) stampsTags++;
    if (/\bvfx\s*:\s*\[|<(HeadVfx|FocusRings|Sparkle)\b/.test(body)) headVfx++;
    if (/\bbeats\s*:\s*\[[^\]]*\b(cam|shake|angle)\s*:/.test(body)) camBeats++;
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
  for (const body of bodies) {
    if (timedChanges(body) === 0 && /\bpeople\s*[=:]|<(Hero|Staged|Person)\b|\bwho\s*[=:]/.test(body)) still++;
    const acts = [...body.matchAll(/\bact\s*[:=]\s*['"]([a-z-]+)/g)].map((m) => m[1]);
    if (acts.length && acts.every((a) => a === 'idle')) idleOnly++;
    const yaws = [...body.matchAll(/\byaw\s*[:=]\s*\{?\s*(-?\d*\.?\d+)/g)].map((m) => Math.abs(Number(m[1])));
    if (yaws.some((y) => y >= 0.3) || /\b(tableSit|walkPose|carSit|bedSit)\(|<Duo\b|\bduo\s*:\s*\{/.test(body)) oriented++;
    if (/<Foreground\b|\bforeground\s*:/.test(body)) blur++;
    else if (/\bfocus\s*[=:]|blur16/.test(body)) focus++;
    if ((body.match(/<(Hero|Staged|Person)\b|\bwho\s*[:=]/g) ?? []).length >= 3) group3++;
  }
  return `${oriented}/${bodies.length} plans avec un personnage orienté (yaw >= 0,3, tableSit ou walkPose) · ${blur}/${bodies.length} plans avec amorce floue au premier plan (Foreground) · ${focus} autres avec seulement un flou de profondeur (pas une amorce) · ${group3} plans à 3 personnages ou plus · ${still} plans avec personnages où rien ne change pendant le plan · ${idleOnly} plans où l'unique action est idle`;
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
    return {
      ok: false,
      pass: true,
      model,
      episode,
      summary: `Réponse du reviewer non-JSON ignorée (${cleaned.slice(0, 140)})`,
      issues: [],
      createdAt: new Date().toISOString(),
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

async function askReviewerWithFallback(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  images: ImagePart[],
  slug: string,
  signal?: AbortSignal,
): Promise<{ report: ReviewReport; sawImages: boolean }> {
  const ask = async (msgs: ChatMessage[]): Promise<ReviewReport> =>
    parseReviewJson((await provider.chat({ messages: msgs, tools: [], signal })).text, provider.model, slug);

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
  if (!report.ok) report = await ask(sent);
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
          ((!prevReview.pass && prevReview.blocking && prevErrors.length > 0) || prevReview.pass),
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
        `# Contre-visite ciblée (Tour ${round}) de l'épisode "${slug}" (orientation: ${aspect})`,
        targetChunks.length > 1 ? `Lot ciblé ${cIdx + 1}/${targetChunks.length} — plans vérifiés : ${chunkIds.join(', ')}` : `Plans ciblés vérifiés : ${chunkIds.join(', ')}`,
        `## 1. Problèmes bloquants signalés au tour précédent (à vérifier point par point)\n${prevIssuesList}`,
        `## 2. Script complet (narration FR — contexte)\n${scriptLines.slice(0, 25_000)}`,
        `## 3. Découpage des plans ciblés (episode.json.shots)\n${formatShotBreakdown(chunkSet) || '(aucune entrée)'}`,
        wordMarks.length ? `## 4. Repères mot@frame sur l'horloge propre de chaque plan ciblé\n${wordMarks.join('\n')}` : '',
        bibleRaw ? `## 5. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 6. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 14_000)}`,
        `## 7. Code COMPLET non tronqué des plans ciblés\n${summarizeShotsCode(epSrc, { onlyShots: chunkIds, shotTimings, perShotChars: 8_000 })}`,
        images.length
          ? `\n${images.length} image(s) pleine résolution jointe(s) (${chunkIds.join(', ')}). Vérifie uniquement si les problèmes ci-dessus sont résolus sur ces plans et renvoie ton verdict JSON.`
          : `\nVérifie sur le code complet ci-dessus si les problèmes bloquants signalés sur ${chunkIds.join(', ')} sont résolus, puis renvoie ton verdict JSON.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { report, sawImages } = await askReviewerWithFallback(
        provider,
        DELTA_REVIEWER_SYSTEM_PROMPT,
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
    const sheetChunks = sheetFiles.length ? chunkArray(sheetFiles, MAX_REVIEW_IMAGES) : [[]];
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

      // Map this sheet batch (e.g. sheet-07..sheet-09) to the exact shots rendered on those sheets when multi-batch
      let batchShots: string[] | undefined;
      if (sheetChunks.length > 1 && orderedAllShots.length > cIdx * MAX_REVIEW_IMAGES * perSheet) {
        const startShotIdx = cIdx * MAX_REVIEW_IMAGES * perSheet;
        const endShotIdx = startShotIdx + chunkSheets.length * perSheet;
        const slice = orderedAllShots.slice(startShotIdx, endShotIdx);
        if (slice.length) batchShots = slice;
      }

      const sheetRangeNote =
        sheetChunks.length > 1
          ? ` (lot ${cIdx + 1}/${sheetChunks.length} : planches ${cIdx * MAX_REVIEW_IMAGES + 1} à ${cIdx * MAX_REVIEW_IMAGES + chunkSheets.length} sur ${sheetFiles.length}${batchShots ? `, couvrant ${batchShots[0]}..${batchShots[batchShots.length - 1]}` : ''})`
          : '';

      const userPrompt = [
        `# Audit indépendant de l'épisode "${slug}" (orientation: ${aspect}, defaultSet: ${JSON.stringify(ep?.defaultSet ?? '')})${sheetRangeNote}`,
        `## 1. Script complet (narration FR)\n${scriptLines.slice(0, 25_000)}`,
        `## 2. Découpage des plans (episode.json.shots)\n${formatShotBreakdown().slice(0, 25_000)}`,
        bibleRaw ? `## 3. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 3_000)}` : '',
        `## 4. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 15_000)}`,
        `## 5. Code des plans (${epSrc.isModular ? 'shared.tsx + shots/S*.tsx' : 'shots.tsx'})\n${summarizeShotsCode(epSrc, { onlyShots: batchShots, shotTimings, perShotChars: 2_600 })}`,
        `## 6. Mesures automatiques (lues dans les plans et timeline.json)\n${autoMetrics}`,
        images.length
          ? `\n${images.length} planche(s) de contact jointe(s)${sheetRangeNote} (plans dans l'ordre, légende = numéro du plan, taille, début du texte). Compare chaque vignette (capturée à t=key) et le code des plans au récit et à DIRECTOR.md, puis renvoie ton verdict JSON.`
          : `\nInspecte la cohérence entre le récit, DIRECTOR.md et le code des plans, puis renvoie ton verdict JSON.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { report, sawImages } = await askReviewerWithFallback(
        provider,
        REVIEWER_SYSTEM_PROMPT,
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
  }

  finalReport.round = round;
  finalReport.batches = batchCount;
  finalReport.sawImages = sawImagesOverall;
  finalReport.blocking = finalReport.ok && !finalReport.pass && !opts.final;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(finalReport, null, 2) + '\n');
  } catch {
    /* ignore write error */
  }

  return finalReport;
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
