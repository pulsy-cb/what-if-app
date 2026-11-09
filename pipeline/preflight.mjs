#!/usr/bin/env node
// Everything a real run needs that only the machine itself can answer. Run it before the first episode:
//   docker compose exec studio node pipeline/preflight.mjs
// It reads, and makes one short call to each configured model. It writes nothing and renders nothing. Keys are never printed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(path.join(ROOT, 'dist', rel));
const { loadConfig } = await load('orchestrator/config.js');
const { Db } = await load('orchestrator/db.js');
const { resolveProvider, resolveReviewProvider, reviewProviderConfig } = await load('orchestrator/providers/index.js');
const { applyEngineOverlay, overlaySummary } = await load('tools/engine-overlay.js');

let failed = 0;
const line = (state, what, detail = '') => {
  if (state === 'ÉCHEC') failed++;
  console.log(`${state.padEnd(6)} ${what}${detail ? ` : ${detail}` : ''}`);
};
const has = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};
// a 1x1 white PNG: enough to learn whether the model accepts an image at all
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const ask = async (provider, images) => {
  const messages = [{ role: 'user', content: 'Réponds par le seul mot OK.', ...(images ? { images: [{ mime: 'image/png', data: PIXEL }] } : {}) }];
  const started = Date.now();
  const res = await provider.chat({ messages, tools: [], signal: AbortSignal.timeout(90_000) });
  return { text: res.text.trim().slice(0, 40), ms: Date.now() - started, finish: res.finishReason };
};

const config = loadConfig();
const db = new Db(config.dbPath);

// ---------------------------------------------------------------- the skill and the engine
const skill = config.skillDir;
if (!skill) line('ÉCHEC', 'skill', 'WHATIF_SKILL_DIR ne contient pas studio/ (montage ../what-if-animation:/skill)');
else {
  line('OK', 'skill', skill);
  const missing = ['scripts/plan.py', 'scripts/board.py', 'scripts/stills.mjs', 'scripts/master.py', 'scripts/motiongrid.py', 'scripts/mixcheck.py', 'studio/package.json'].filter((f) => !fs.existsSync(path.join(skill, f)));
  line(missing.length ? 'ÉCHEC' : 'OK', 'fichiers du skill', missing.length ? `manquants : ${missing.join(', ')}` : 'complets');
  const studio = path.join(skill, 'studio');
  const report = applyEngineOverlay(studio, { dryRun: true });
  const skipped = report.skipped ?? [];
  const serious = skipped.filter((s) => !/rig\.tsx/.test(typeof s === 'string' ? s : s.file ?? ''));
  line(serious.length ? 'ÉCHEC' : skipped.length ? 'ATTENTION' : 'OK', 'calque moteur', overlaySummary(report, false));
  if (skipped.length && !serious.length) console.log('       (rig.tsx ignoré : <Hero> garde ses anciens profils ; shot(), <Staged> et <Person> ne sont pas concernés)');
  const portrait = fs.readFileSync(path.join(studio, 'src/engine/episode.tsx'), 'utf8').includes('IS_PORTRAIT');
  line('OK', 'cadre 9:16', portrait ? 'présent dans le skill' : 'absent du skill, ajouté par le calque');
}

// ---------------------------------------------------------------- the machine
for (const [what, cmd, args] of [
  ['ffmpeg', 'ffmpeg', ['-version']],
  ['python : pillow et numpy', 'python3', ['-c', 'import PIL, numpy']],
  ['python : modal', 'python3', ['-c', 'import modal']],
]) line(has(cmd, args) ? 'OK' : 'ÉCHEC', what);
line(fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') ? 'OK' : 'ATTENTION', 'police DejaVu', 'légendes accentuées des planches de contact');
const modalToml = [process.env.MODAL_CONFIG_PATH, path.join(os.homedir(), '.modal.toml'), '/home/node/.modal.toml'].some((p) => p && fs.existsSync(p));
if (config.renderMode === 'local') line('ATTENTION', 'rendu', 'WHATIF_RENDER=local : Chromium doit être présent dans le conteneur');
else line(process.env.MODAL_TOKEN_ID || modalToml ? 'OK' : 'ÉCHEC', 'identifiants Modal', process.env.MODAL_TOKEN_ID ? 'variables d’environnement' : modalToml ? '~/.modal.toml' : 'ni MODAL_TOKEN_ID ni ~/.modal.toml');
try {
  const res = await fetch(`${config.nouveauUrl}/`, { signal: AbortSignal.timeout(5_000) });
  line('OK', 'serveur nouveau', `${config.nouveauUrl} répond ${res.status}`);
} catch (e) {
  line('ÉCHEC', 'serveur nouveau', `${config.nouveauUrl} injoignable (${e.message}) : source et voix échoueront`);
}

// ---------------------------------------------------------------- the models
try {
  const agent = resolveProvider(db);
  if (agent.id === 'mock') line('ÉCHEC', 'modèle de l’agent', 'WHATIF_PROVIDER=mock : aucun vrai modèle configuré');
  else {
    const r = await ask(agent);
    line(r.text ? 'OK' : 'ÉCHEC', `modèle de l’agent (${agent.model})`, `${r.ms} ms, réponse « ${r.text} », fin ${r.finish}`);
    try {
      await ask(agent, true);
      line('OK', 'l’agent voit les images');
    } catch (e) {
      line('ATTENTION', 'l’agent ne prend pas les images', `il ne verra pas ses planches (${String(e.message).split('\n')[0].slice(0, 120)})`);
    }
  }
} catch (e) {
  line('ÉCHEC', 'modèle de l’agent', String(e.message).split('\n')[0].slice(0, 200));
}
const reviewCfg = reviewProviderConfig(db);
const reviewer = reviewCfg ? resolveReviewProvider(db) : null;
if (!reviewer) line('ATTENTION', 'Reviewer', 'désactivé ou sans clé : aucun second regard sur les planches');
else {
  const same = reviewCfg.model === resolveProvider(db).model;
  try {
    const r = await ask(reviewer, true);
    line(r.text ? 'OK' : 'ÉCHEC', `Reviewer (${reviewer.model})`, `voit les images, ${r.ms} ms, réponse « ${r.text} », fin ${r.finish}${r.text ? '' : ' : réponse vide, monter WHATIF_REVIEW_MAX_TOKENS'}`);
  } catch (e) {
    line('ATTENTION', `Reviewer (${reviewer.model})`, `refuse les images (${String(e.message).split('\n')[0].slice(0, 120)}) : il jugera le code seul, choisir un modèle vision`);
  }
  if (same) line('ATTENTION', 'Reviewer', 'même modèle que l’agent : régler WHATIF_REVIEW_MODEL pour un regard vraiment indépendant');
}
db.close();
console.log(failed ? `\n${failed} point(s) bloquant(s) à corriger avant un run.` : '\nRien de bloquant : le run peut partir.');
process.exit(failed ? 1 : 0);
