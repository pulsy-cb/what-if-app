import { hasShellMetachars, splitCommand } from './exec.js';

/** Command prefixes the agent may run. Everything else is refused: this is the shell sandbox of the app. */
export const ALLOWED_PREFIXES: { re: RegExp; note: string }[] = [
  { re: /^npx remotion (still|render|studio|bundle|compositions|versions|lambda)\b/, note: 'remotion' },
  { re: /^npx tsc\b/, note: 'typecheck' },
  { re: /^npx eslint\b/, note: 'lint' },
  { re: /^node scripts\/[\w.-]+\.mjs\b/, note: 'skill node script' },
  { re: /^python3? scripts\/[\w.-]+\.py\b/, note: 'skill python script' },
  { re: /^python3? \S+\/scripts\/[\w.-]+\.py\b/, note: 'skill python script (absolute)' },
  { re: /^npm (install|ci|run (build|typecheck|lint))\b/, note: 'npm (ask policy)' },
  { re: /^ffprobe\b/, note: 'probe' },
  { re: /^ffmpeg\b/, note: 'audio/video' },
  { re: /^git (status|diff|log|show|add|commit|restore|checkout|branch|stash|rev-parse)\b/, note: 'git' },
  { re: /^ls\b/, note: 'list' },
  { re: /^cat\b/, note: 'cat' },
  { re: /^find\b/, note: 'find' },
];

export type CommandCheck = { ok: true; note: string } | { ok: false; reason: string };

export function checkCommand(line: string): CommandCheck {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: 'empty command' };
  if (hasShellMetachars(trimmed)) {
    return { ok: false, reason: 'shell metacharacters (; & | < > ` $ ( ) { } [ ] \\ and newlines) are refused: pass a single command' };
  }
  let argv: string[];
  try {
    argv = splitCommand(trimmed);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const cmd = argv[0] ?? '';

  // Prevent accidental 2-hour local CPU video renders or legacy O(N^2) skill scripts via shell
  if (/^npx\s+remotion\s+render\b/.test(trimmed)) {
    return { ok: false, reason: 'local CPU "npx remotion render" is refused in shell — use whatif_run { step: "render" } (Modal GPU + auto-master)' };
  }
  if (/^python3?\s+\S*scripts\/(master|motiongrid|sfx)\.py\b/.test(trimmed)) {
    return { ok: false, reason: 'legacy skill script is refused in shell — use whatif_run { step: "master" | "sfx" | "motiongrid" } instead' };
  }

  // Block dangerous flags on find and path escapes on file-reading/writing commands
  if (cmd === 'find' && argv.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fls)$/.test(a))) {
    return { ok: false, reason: 'find with -delete or -exec is refused' };
  }
  if (cmd === 'cat' || cmd === 'ls' || cmd === 'find' || cmd === 'ffmpeg' || cmd === 'ffprobe') {
    for (const arg of argv.slice(1)) {
      if (arg.startsWith('-')) continue;
      if (arg.startsWith('/') || arg.split('/').includes('..') || /(^|\/)\.env(\.|$)/.test(arg)) {
        return { ok: false, reason: `argument "${arg}" must stay inside the project folder (no absolute paths, .., or .env)` };
      }
    }
  }

  for (const p of ALLOWED_PREFIXES) if (p.re.test(trimmed)) return { ok: true, note: p.note };
  return { ok: false, reason: 'command not in the allowlist; add it in src/tools/shell-policy.ts if it is legitimate' };
}
