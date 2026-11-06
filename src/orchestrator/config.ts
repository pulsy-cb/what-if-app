import fs from 'node:fs';
import path from 'node:path';

export type Config = {
  host: string;
  port: number;
  dataRoot: string;
  dbPath: string;
  projectsDir: string;
  skillDir: string | null;
  webDir: string;
  authToken: string | null;
  maxSteps: number;
  contextChars: number;
  approvalTimeoutMs: number;
  /** Local TTS/translation API (the "nouveau" app), the one the videos and their takes live in. */
  nouveauUrl: string;
  /** "modal" (default) renders on Modal, "local" falls back to npx remotion inside this container. */
  renderMode: 'modal' | 'local';
};

/** Find the upstream skill folder: env first, then a sibling clone of this app. */
function detectSkillDir(): string | null {
  const env = process.env.WHATIF_SKILL_DIR;
  if (env && fs.existsSync(path.join(env, 'studio'))) return path.resolve(env);
  const here = path.dirname(new URL(import.meta.url).pathname);
  const root = path.resolve(here, '..', '..');
  for (const candidate of [
    path.join(path.dirname(root), 'what-if-animation'),
    path.join(root, 'what-if-animation'),
  ]) {
    if (fs.existsSync(path.join(candidate, 'studio'))) return candidate;
  }
  return null;
}

export function loadConfig(): Config {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const packageRoot = path.resolve(here, '..', '..');
  const dataRoot = path.resolve(process.env.WHATIF_DATA ?? path.join(packageRoot, 'data'));
  const dbPath = process.env.WHATIF_DB ?? path.join(dataRoot, 'app.db');
  fs.mkdirSync(dataRoot, { recursive: true });
  return {
    host: process.env.WHATIF_HOST ?? '127.0.0.1',
    port: Number(process.env.WHATIF_PORT ?? 3000),
    dataRoot,
    dbPath,
    projectsDir: path.join(dataRoot, 'projects'),
    skillDir: detectSkillDir(),
    webDir: path.join(packageRoot, 'web', 'public'),
    authToken: process.env.WHATIF_AUTH_TOKEN ?? null,
    maxSteps: Number(process.env.WHATIF_MAX_STEPS ?? 24),
    contextChars: Number(process.env.WHATIF_CONTEXT_CHARS ?? 90_000),
    approvalTimeoutMs: Number(process.env.WHATIF_APPROVAL_TIMEOUT_MS ?? 30 * 60_000),
    nouveauUrl: (process.env.WHATIF_NOUVEAU_URL ?? 'http://127.0.0.1:8005').replace(/\/$/, ''),
    renderMode: process.env.WHATIF_RENDER === 'local' ? 'local' : 'modal',
  };
}
