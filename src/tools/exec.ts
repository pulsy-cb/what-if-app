import { spawn } from 'node:child_process';

export type ExecResult = { code: number; stdout: string; stderr: string; timedOut: boolean; argv: string[] };

const MAX_OUT = 240_000;

/** Split a command line into argv. Supports single and double quotes; no globbing, no expansion. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
    has = true;
  }
  if (quote) throw new Error('unterminated quote in command');
  if (has || cur) out.push(cur);
  return out;
}

/** Run a program with an argv array (never through a shell). Resolves with the exit code, never rejects on exit != 0. */
export function exec(
  argv: string[],
  opts: {
    cwd: string;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
  },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    if (!argv.length) {
      resolve({ code: 2, stdout: '', stderr: 'empty command', timedOut: false, argv });
      return;
    }
    let out = '';
    let err = '';
    let timedOut = false;
    let settled = false;
    const max = opts.maxBytes ?? MAX_OUT;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout: out, stderr: err, timedOut, argv });
    };
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onAbort = () => {
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? 180_000);

    let lineBuf = '';
    const emitLines = (chunk: string) => {
      if (!opts.onLine) return;
      lineBuf += chunk;
      const parts = lineBuf.split('\n');
      lineBuf = parts.pop() ?? '';
      for (const l of parts) {
        const trimmed = l.trim();
        if (trimmed) opts.onLine(trimmed);
      }
    };
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      if (out.length < max) out += d;
      emitLines(d);
    });
    child.stderr!.on('data', (d: string) => {
      if (err.length < max) err += d;
      emitLines(d);
    });
    child.on('error', (e) => {
      err += String(e);
      finish(127);
    });
    child.on('close', (code) => finish(code ?? (timedOut ? 124 : 1)));
  });
}

/** True when the command line contains shell metacharacters we refuse to interpret. */
export function hasShellMetachars(line: string): boolean {
  return /[;&|<>`$(){}\\[\]\n\r\\]/.test(line);
}
