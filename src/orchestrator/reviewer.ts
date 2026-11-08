import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ImagePart, Provider } from './providers/types.js';
import { readText } from '../tools/paths.js';

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
};

const REVIEWER_SYSTEM_PROMPT = `Tu es un Directeur de Réalisation & Reviewer Indépendant pour le studio d'animation 2D "What If" (SVG + Remotion).
Tu n'as PAS écrit le code : ton rôle est d'auditer en toute indépendance la cohérence entre le récit (script FR), la note de mise en scène (DIRECTOR.md), le code des plans (shots.tsx) et la planche storyboard (storyboard.jpg).

Vérifie particulièrement ces 5 points critiques :
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
- Limite-toi aux problèmes réels et vérifiables (maximum 5 issues ciblées). S'il n'y a rien de bloquant, retourne "pass": true et "issues": [].`;

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
): Promise<ReviewReport> {
  const epDir = path.join(projectRoot, 'src', 'episodes', slug);
  const outDir = path.join(projectRoot, 'out', slug);
  const epRaw = readText(epDir, 'episode.json', 25_000) ?? '{}';
  const directorRaw = readText(epDir, 'DIRECTOR.md', 10_000) ?? '(aucun DIRECTOR.md)';
  const bibleRaw = readText(epDir, 'bible.json', 4_000) ?? '';
  const shotsRaw = readText(epDir, 'shots.tsx', 120_000) ?? '';

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

  const images: ImagePart[] = [];
  const boardPath = path.join(outDir, 'storyboard.jpg');
  if (fs.existsSync(boardPath)) {
    try {
      const st = fs.statSync(boardPath);
      if (st.size > 0 && st.size <= 4_000_000) {
        images.push({ mime: 'image/jpeg', data: fs.readFileSync(boardPath).toString('base64') });
      }
    } catch {
      /* ignore */
    }
  }

  const userPrompt = [
    `# Audit indépendant de l'épisode "${slug}" (orientation: ${ep?.aspect ?? '16:9'}, defaultSet: ${JSON.stringify(ep?.defaultSet ?? '')})`,
    `## 1. Script complet (narration FR)\n${scriptLines.slice(0, 4_500)}`,
    `## 2. Découpage des plans (episode.json.shots)\n${shotLines.slice(0, 4_500)}`,
    bibleRaw ? `## 3. Bible de continuité (bible.json)\n${bibleRaw.slice(0, 2_000)}` : '',
    `## 4. Note de réalisation (DIRECTOR.md)\n${directorRaw.slice(0, 3_500)}`,
    `## 5. Code des plans (shots.tsx)\n${summarizeShotsCode(shotsRaw)}`,
    images.length
      ? `\nLa planche storyboard (out/${slug}/storyboard.jpg) est jointe en image. Compare chaque vignette et le code des plans au récit et à DIRECTOR.md, puis renvoie ton verdict JSON.`
      : `\nInspecte la cohérence entre le récit, DIRECTOR.md et le code de shots.tsx, puis renvoie ton verdict JSON.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt, ...(images.length ? { images } : {}) },
  ];

  const res = await provider.chat({ messages, tools: [], signal });
  const report = parseReviewJson(res.text, provider.model, slug);

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  } catch {
    /* ignore write error */
  }

  return report;
}

export function formatReviewFeedback(report: ReviewReport, slug: string): string {
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
  ];
  if (errors.length) {
    lines.push(`\nProblèmes bloquants à corriger dans src/episodes/${slug}/shots.tsx :`);
    for (const err of errors) {
      lines.push(`- [${err.shot}] Problème : ${err.problem}\n  → Correctif : ${err.fix}`);
    }
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
