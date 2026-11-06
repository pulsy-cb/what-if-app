import { hasShellMetachars } from './exec.js';

/** Command prefixes the agent may run. Everything else is refused: this is the shell sandbox of the app. */
export const ALLOWED_PREFIXES: { re: RegExp; note: string }[] = [
  { re: /^npx remotion (still|render|studio|bundle|compositions|versions|lambda)\b/, note: 'remotion' },
  { re: /^npx tsc\b/, note: 'typecheck' },
  { re: /^npx eslint\b/, note: 'lint' },
  { re: /^node scripts\/[\w.-]+\.mjs\b/, note: 'skill node script' },
  { re: /^python3? scripts\/[\w.-]+\.py\b/, note: 'skill python script' },
  { re: /^python3? \S+\/scripts\/[\w.-]+\.py\b/, note: 'skill python script (absolute)' },
  { re: /^npm (install|ci|run [\w:-]+)\b/, note: 'npm (ask policy)' },
  { re: /^ffprobe\b/, note: 'probe' },
  { re: /^ffmpeg\b/, note: 'audio/video' },
  { re: /^git (status|diff|log|show|add|commit|restore|checkout|branch|stash|rev-parse)\b/, note: 'git' },
  { re: /^ls\b/, note: 'list' },
  { re: /^cat\b/, note: 'cat' },
  { re: /^find\b/, note: 'find' },
];

export type CommandCheck = { ok: true; note: string } | { ok: false; reason: string };

export function checkCommand(line: string): CommandCheck {
  if (!line.trim()) return { ok: false, reason: 'empty command' };
  if (hasShellMetachars(line)) {
    return { ok: false, reason: 'shell metacharacters (; & | < > ` $ ( ) { } [ ] \\ and newlines) are refused: pass a single command' };
  }
  for (const p of ALLOWED_PREFIXES) if (p.re.test(line.trim())) return { ok: true, note: p.note };
  return { ok: false, reason: 'command not in the allowlist; add it in src/tools/shell-policy.ts if it is legitimate' };
}
