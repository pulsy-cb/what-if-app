import { hasShellMetachars, splitCommand } from './exec.js';

/** Command prefixes the agent may run. Everything else is refused: this is the shell sandbox of the app. */
export const ALLOWED_PREFIXES: { re: RegExp; note: string }[] = [
  { re: /^npx remotion (still|render|studio|bundle|compositions|versions|lambda)(?:\s|$)/, note: 'remotion' },
  { re: /^npx tsc(?:\s|$)/, note: 'typecheck' },
  { re: /^npx eslint(?:\s|$)/, note: 'lint' },
  { re: /^node scripts\/[\w.-]+\.mjs(?:\s|$)/, note: 'skill node script' },
  { re: /^python3? scripts\/[\w.-]+\.py(?:\s|$)/, note: 'skill python script' },
  { re: /^python3? \/[^\s;]+\/scripts\/[\w.-]+\.py(?:\s|$)/, note: 'skill python script (absolute)' },
  { re: /^npm (install|ci|run (build|typecheck|lint))(?:\s|$)/, note: 'npm (ask policy)' },
  { re: /^ffprobe(?:\s|$)/, note: 'probe' },
  { re: /^ffmpeg(?:\s|$)/, note: 'audio/video' },
  { re: /^git (status|diff|log|show|add|commit|restore|checkout|branch|stash|rev-parse)(?:\s|$)/, note: 'git' },
  { re: /^ls(?:\s|$)/, note: 'list' },
  { re: /^cat(?:\s|$)/, note: 'cat' },
  { re: /^find(?:\s|$)/, note: 'find' },
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

  // Block dangerous flags on find, npx, git, python, and path escapes on file-reading/writing commands
  if (cmd === 'find' && argv.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fls)$/.test(a))) {
    return { ok: false, reason: 'find with -delete or -exec is refused' };
  }
  if ((cmd === 'python' || cmd === 'python3') && argv[1]) {
    const scriptArg = argv[1];
    if (scriptArg.includes('..') || /(^|\/)out\//.test(scriptArg)) {
      return { ok: false, reason: `python script "${scriptArg}" is refused: only studio/skill scripts/ are allowed` };
    }
  }
  if (cmd === 'npx' && (argv[1] === 'tsc' || argv[1] === 'eslint')) {
    if (argv.slice(2).some((a) => /^(-c|--config|--rulesdir|--plugin|--outDir|--outFile|-o|--output|--fix)(?:=|$)/.test(a))) {
      return { ok: false, reason: `dangerous ${argv[1]} flag refused (custom config/plugin/output/fix is not allowed)` };
    }
  }
  if (cmd === 'git') {
    if (
      argv.slice(1).some((a) =>
        /^(-c|--config-env|--exec-path|--git-dir|--work-tree|--output)(?:=|$)/.test(a) ||
        /(^|[/:])\.env(\.|$)/i.test(a) ||
        /(^|[/:])providers\.json$/i.test(a),
      )
    ) {
      return { ok: false, reason: 'git config/output overrides and .env / providers.json access are refused' };
    }
  }
  if (cmd === 'cat' || cmd === 'ls' || cmd === 'find' || cmd === 'ffmpeg' || cmd === 'ffprobe') {
    for (const arg of argv.slice(1)) {
      if (arg.startsWith('-')) continue;
      if (
        arg.startsWith('/') ||
        /^(file|https?|ftp|tcp|udp|rtmp|pipe|subfile|concat):/i.test(arg) ||
        /(^|[/:])\.\.(\/|$)/.test(arg) ||
        /(^|[/:])\.env(\.|$)/i.test(arg) ||
        /(^|[/:])providers\.json$/i.test(arg)
      ) {
        return { ok: false, reason: `argument "${arg}" must stay inside the project folder (no absolute paths, protocols, .., .env, or providers.json)` };
      }
    }
  }

  for (const p of ALLOWED_PREFIXES) if (p.re.test(trimmed)) return { ok: true, note: p.note };
  return { ok: false, reason: 'command not in the allowlist; add it in src/tools/shell-policy.ts if it is legitimate' };
}
