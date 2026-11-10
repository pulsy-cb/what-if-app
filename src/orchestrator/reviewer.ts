import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart, Provider } from './providers/types.js';
import { readText } from '../tools/paths.js';
import { timedChanges } from '../tools/whatif.js';

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
  /** false when the model could not take the contact sheets: the verdict comes from the code alone */
  sawImages?: boolean;
  /** true while the board is refused and another review round is still allowed: render waits for it */
  blocking?: boolean;
};

const MAX_REVIEW_IMAGES = 6;

const REVIEWER_SYSTEM_PROMPT = `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Tu n'as PAS écrit le code : ton rôle est d'auditer en toute indépendance la cohérence entre le récit (script FR), la note de mise en scène (DIRECTOR.md), le code des plans (shots.tsx) et les planches de contact du storyboard (images jointes, 8 à 9 plans chacune).

Vérifie particulièrement ces 9 points critiques :
1. **Fidélité décor & accessoires (DIRECTOR.md ↔ shots.tsx / storyboard)** :
   - Le décor codé et visible correspond-il au lieu de l'histoire et à DIRECTOR.md (murs, ambiance jour/nuit, mobilier comme canapé, table, bol, miroir, fenêtre) ?
   - Si le récit dit qu'un personnage bondit d'un canapé ou pose des Doritos sur une table, ces éléments existent-ils vraiment dans la scène ?
2. **Costume / Objet-clé & chronologie** :
   - Si l'histoire tourne autour d'un objet ou vêtement spécifique (ex. un nouveau haut acheté, une fiole, un téléphone, un plat), est-il visuellement distinct de la tenue de base des personnages et n'est-il porté/tenu qu'au moment où le récit l'indique ?
3. **Inserts & panneaux de texte (<SchLabel> / <Schematic>)** :
   - Aucun plan de dialogue ou de réaction émotionnelle (ex. "Il me va parfaitement, a-t-elle souri", "Désolée...") ne doit être remplacé par un panneau de texte abstrait sans personnage.
   - Aucun libellé <SchLabel> inventé ou hors sujet (comme "FILET D'EAU MAGIQUE" sur une phrase qui parle d'essayer un vêtement).
4. **Cartes-titres (<TitleCard>) & langue française** :
   - Pas de <TitleCard> en plein milieu de l'histoire qui casse la tension dramatique.
   - Aucun texte en anglais ("YOU PUT ITCHING...", "WHAT IF...") coupé ou laissé dans un épisode en français.
5. **Cadrage & placement (16:9 ou 9:16)** :
   - Les personnages et objets tenus (handRProp / grabAt / handWorld) sont-ils bien cadrés, sans objet flottant loin des mains ni moitié d'écran vide ?
   - En 9:16 : un tiers ou plus du cadre vide (plafond ou sol sombre), un personnage coupé par le bord sans raison, trois personnages qui ne tiennent pas dans 900/zoom unités de large.
6. **Mise en scène et rythme** :
   - Ce qui se passe à l'image suit-il ce que dit le narrateur au moment où il le dit (geste, regard, objet, réaction) ? Un personnage qui « parle » alors que le narrateur décrit une action, ou un plan où rien ne bouge pendant toute la réplique, est un défaut (les mesures automatiques comptent les plans figés).
   - Un plan qui tient plus de 6 s sans évènement casse le rythme.
   - Les personnages sont-ils presque tous de face (les « Mesures automatiques » donnent le nombre de plans orientés) ? Deux personnes qui se parlent doivent se faire face (yaw opposés), pas regarder la caméra.
   - Un groupe de 3 est-il aligné à la même hauteur et à la même échelle, en rang ? Il doit être étagé en profondeur.
   - Les cadrages varient-ils (deux plans voisins de même taille et même angle sont un défaut) ? Y a-t-il au moins un plan large, un gros plan et un angle haut ou bas ?
   - Une amorce floue (Foreground) donne-t-elle de la profondeur dans environ un plan sur trois ?
7. **Lisibilité du lieu** : le lieu se reconnaît-il sans la voix ? Une salle de classe a un tableau plat collé au mur du fond (pas une planche suspendue au milieu de la pièce), des pupitres d'élèves (pas des tables de restaurant), une fenêtre ; une chambre a un lit, etc. Les éléments du décor d'origine sans rapport avec l'histoire (démo « 7 × 8 », rideaux et ciel de crépuscule dans une scène de jour) sont des défauts.
8. **Lumière, contraste, profondeur** : le visage est-il l'élément le plus lumineux de sa zone ? Pas de membre sombre sur mur sombre ? Une source de lumière visible par plan ?
9. **Cohérence d'un même lieu** : même disposition, mêmes accessoires, mêmes couleurs d'un plan à l'autre.

Le code peut décrire les plans au lieu de les dessiner : \`shot({ place, cam, people, duo })\`. \`place('classroom', …)\` est le décor, \`cam\` la taille du plan, \`people\` les personnages (\`who\` = \`cast(…)\`, \`at\` = position au sol, \`on\` = assis à un meuble, \`yaw\` = orientation, \`act\` = action, \`face\` = expression), \`duo\` une interaction à deux. \`view: 'reverse'\` est le contrechamp (le mur opposé), \`angle\` une contre-plongée ('low') ou une plongée ('high'). Tes correctifs doivent employer ces mêmes champs quand le plan est écrit ainsi.

Réponds UNIQUEMENT avec un objet JSON valide (sans texte autour, ou dans un bloc \`\`\`json) respectant exactement ce schéma :
{
  "pass": true,
  "summary": "Résumé concis en 1-2 phrases de la qualité de la réalisation.",
  "issues": [
    {
      "shot": "S3",
      "severity": "error",
      "problem": "Description précise de l'incohérence narrative ou visuelle constatée.",
      "fix": "Instruction concrète et directe à appliquer dans shots.tsx (ou DIRECTOR.md) pour corriger ce plan."
    }
  ]
}
Règles de décision :
- Mets "pass": false UNIQUEMENT s'il y a au moins une issue avec "severity": "error" qui nuit vraiment à la cohérence du récit ou du cadrage.
- Limite-toi aux problèmes réels et vérifiables (maximum 8 issues ciblées, les plus graves d'abord). Les défauts de mise en scène (point 6) et de lisibilité du lieu (point 7) sont "error" quand ils touchent plus de la moitié des plans, sinon "warn". S'il n'y a rien de bloquant, retourne "pass": true et "issues": [].`;

function summarizeShotsCode(shotsRaw: string): string {
  if (!shotsRaw) return '(shots.tsx missing)';
  const matches = [...shotsRaw.matchAll(/export\s+(?:const|function)\s+(S\d+)\b/g)];
  if (!matches.length) return shotsRaw.slice(0, 3_000);
  const firstIdx = matches[0]!.index ?? 0;
  const header = shotsRaw.slice(0, firstIdx).trim().slice(0, 2_200);
  const perShot: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i]![1]!;
    const start = matches[i]!.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? shotsRaw.length) : shotsRaw.length;
    const body = shotsRaw.slice(start, end).replace(/\s+/g, ' ').trim();
    perShot.push(`- ${id}: ${body.slice(0, 380)}`);
  }
  return `### En-tête partagé (shots.tsx)\n\`\`\`tsx\n${header}\n\`\`\`\n\n### Résumé du code par plan (${matches.length} plans)\n${perShot.join('\n')}`;
}

/** Counts read straight from shots.tsx, handed to the Reviewer so it does not have to guess from thumbnails. */
export function staticMetrics(shotsRaw: string): string {
  const parts = shotsRaw.split(/(?=export\s+(?:const|function)\s+S\d+\b)/).filter((p) => /^export\s+(?:const|function)\s+S\d+\b/.test(p));
  if (!parts.length) return '(shots.tsx has no exported shot)';
  let oriented = 0;
  let blur = 0;
  let group3 = 0;
  let still = 0;
  let idleOnly = 0;
  for (const body of parts) {
    if (timedChanges(body) === 0 && /\bpeople\s*[=:]|<(Hero|Staged|Person)\b/.test(body)) still++;
    const acts = [...body.matchAll(/\bact\s*[:=]\s*['"]([a-z-]+)/g)].map((m) => m[1]);
    if (acts.length && acts.every((a) => a === 'idle')) idleOnly++;
    const yaws = [...body.matchAll(/\byaw\s*[:=]\s*\{?\s*(-?\d*\.?\d+)/g)].map((m) => Math.abs(Number(m[1])));
    if (yaws.some((y) => y >= 0.3) || /\b(tableSit|walkPose|carSit|bedSit)\(|<Duo\b|\bduo\s*:\s*\{/.test(body)) oriented++;
    if (/<Foreground\b|blur16|\bfocus\s*[=:]/.test(body)) blur++;
    if ((body.match(/<(Hero|Staged|Person)\b|\bwho\s*:/g) ?? []).length >= 3) group3++;
  }
  return `${oriented}/${parts.length} plans avec un personnage orienté (yaw >= 0,3, tableSit ou walkPose) · ${blur}/${parts.length} plans avec amorce floue · ${group3} plans à 3 personnages ou plus · ${still} plans avec personnages où rien ne change pendant le plan · ${idleOnly} plans où l'unique action est idle`;
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

export async function reviewEpisodeBoard(
  provider: Provider,
  projectRoot: string,
  slug: string,
  signal?: AbortSignal,
  opts: { final?: boolean } = {},
): Promise<ReviewReport> {
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  const outDir = path.join(projectRoot, 'out', slug);
  const epRaw = readText(epDir, 'episode.json', 25_000) ?? '{}';
  const directorRaw = readText(epDir, 'DIRECTOR.md', 10_000) ?? '(aucun DIRECTOR.md)';
  const bibleRaw = readText(epDir, 'bible.json', 4_000) ?? '';
  const shotsRaw = readText(epDir, 'shots.tsx', 120_000) ?? '';

  let timeline: any = null;
  try {
    timeline = JSON.parse(readText(epDir, 'timeline.json', 400_000) ?? 'null');
  } catch {
    timeline = null;
  }
  let ep: any = {};
  try {
    ep = JSON.parse(epRaw);
  } catch {
    ep = {};
  }

  const scriptLines = (Array.isArray(ep?.script) ? ep.script : [])
    .map((b: any, i: number) => `${i + 1}. ${String(b?.text ?? '').trim()}`)
    .join('\n');
  const shotLines = (Array.isArray(ep?.shots) ? ep.shots : [])
    .map((s: any) => `- ${s.id} [${s.size ?? 'medium'}, set=${s.set ?? 'custom'}]: "${s.note ?? ''}"`)
    .join('\n');

  // contact sheets (8-9 shots each) are readable; the single storyboard.jpg is a tall strip of thumbnails
  const images: ImagePart[] = [];
  const addImage = (file: string, mime: string): void => {
    try {
      const st = fs.statSync(file);
      if (st.size > 0 && st.size <= 4_000_000) images.push({ mime, data: fs.readFileSync(file).toString('base64') });
    } catch {
      /* missing file: skip */
    }
  };
  const sheetsDir = path.join(outDir, 'sheets');
  const sheetFiles = fs.existsSync(sheetsDir)
    ? fs.readdirSync(sheetsDir).filter((n) => /^sheet-\d+\.jpe?g$/i.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    : [];
  for (const n of sheetFiles.slice(0, MAX_REVIEW_IMAGES)) addImage(path.join(sheetsDir, n), 'image/jpeg');
  if (!images.length) addImage(path.join(outDir, 'storyboard.jpg'), 'image/jpeg');

  const userPrompt = [
    `# Audit indépendant de l'épisode "${slug}" (orientation: ${ep?.aspect ?? '16:9'}, defaultSet: ${JSON.stringify(ep?.defaultSet ?? '')})`,
    `## 1. Script complet (narration FR)\n${scriptLines.slice(0, 4_500)}`,
    `## 2. Découpage des plans (episode.json.shots)\n${shotLines.slice(0, 4_500)}`,
    bibleRaw ? `## 3. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 2_000)}` : '',
    `## 4. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 3_500)}`,
    `## 5. Code des plans (shots.tsx)\n${summarizeShotsCode(shotsRaw)}`,
    `## 6. Mesures automatiques (lues dans shots.tsx et timeline.json)\n${staticMetrics(shotsRaw)}\n${timingMetrics(timeline)}`,
    images.length
      ? `\n${images.length} planche(s) de contact jointe(s) (plans dans l'ordre, légende = numéro du plan, taille, début du texte)${sheetFiles.length > MAX_REVIEW_IMAGES ? `, les ${MAX_REVIEW_IMAGES} premières sur ${sheetFiles.length}` : ''}. Compare chaque vignette et le code des plans au récit et à DIRECTOR.md, puis renvoie ton verdict JSON.`
      : `\nInspecte la cohérence entre le récit, DIRECTOR.md et le code de shots.tsx, puis renvoie ton verdict JSON.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt, ...(images.length ? { images } : {}) },
  ];

  const ask = async (msgs: ChatMessage[]): Promise<ReviewReport> =>
    parseReviewJson((await provider.chat({ messages: msgs, tools: [], signal })).text, provider.model, slug);
  let sawImages = images.length > 0;
  let sent = messages;
  let report: ReviewReport;
  try {
    report = await ask(sent);
  } catch (err) {
    if (!images.length) throw err;
    // a text-only model refuses the request outright: judging the code alone is still worth it
    sawImages = false;
    sent = [messages[0]!, { role: 'user', content: userPrompt }];
    report = await ask(sent);
  }
  if (!report.ok) report = await ask(sent);
  report.sawImages = sawImages;
  report.blocking = report.ok && !report.pass && !opts.final;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  } catch {
    /* ignore write error */
  }

  return report;
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
  const affectedShots = [
    ...new Set(
      errors
        .map((i) => i.shot.trim())
        .filter((s) => /^S\d+$/i.test(s))
        .map((s) => s.toUpperCase()),
    ),
  ];
  const lines: string[] = [
    `[reviewer indépendant · ${report.model}] Audit de "${slug}" : ${report.pass ? 'VALIDÉ ✓' : 'CORRECTIONS REQUISES ✗'}`,
    `Résumé : ${report.summary}`,
    ...(report.sawImages === false ? ["(Ce modèle n'accepte pas les images : verdict établi sur le code seul.)"] : []),
  ];
  if (errors.length) {
    lines.push(`\nProblèmes bloquants à corriger dans src/episodes/${slug}/shots.tsx :`);
    for (const err of errors) {
      lines.push(`- [${err.shot}] Problème : ${err.problem}\n  → Correctif : ${err.fix}`);
    }
    if (wordFrames.length) lines.push(`\nMoment de chaque mot dans ces plans (mot@image, horloge du plan) pour placer les beats :\n${wordFrames.join('\n')}`);
    const rerunArgs = affectedShots.length ? `, args: ${JSON.stringify(affectedShots)}` : '';
    lines.push(
      `\nApplique ces corrections dans src/episodes/${slug}/shots.tsx (avec edit_file), relance uniquement les plans modifiés via whatif_run { episode: "${slug}", step: "stills"${rerunArgs} } puis whatif_run { episode: "${slug}", step: "board" }, et enchaîne ensuite sfx -> render -> master.`,
    );
  } else if (warns.length) {
    lines.push(`\nRemarques mineures (non bloquantes) :`);
    for (const w of warns) {
      lines.push(`- [${w.shot}] ${w.problem} (${w.fix})`);
    }
  }
  return lines.join('\n');
}
