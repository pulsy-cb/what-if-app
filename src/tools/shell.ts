import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from './types.js';
import { exec, splitCommand } from './exec.js';
import { checkCommand } from './shell-policy.js';
import { relOf, safeJoin } from './paths.js';

const shell: Tool = {
  name: 'shell',
  description:
    'Run one allowlisted command in the project (typecheck, remotion render/still, skill python scripts, ffprobe, git). No shell operators, no pipes, one command at a time.',
  policy: 'ask',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'e.g. "npx tsc --noEmit" or "python scripts/plan.py my-episode"' },
      timeoutMs: { type: 'integer', description: 'Default 180000.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  validate: (input) => {
    const check = checkCommand(String(input.command ?? ''));
    return check.ok ? null : check.reason;
  },
  async run(input: { command: string; timeoutMs?: number }, ctx) {
    const argv = splitCommand(input.command);
    const res = await exec(argv, { cwd: ctx.projectRoot, timeoutMs: input.timeoutMs, signal: ctx.signal });
    const tail = (s: string) => s.split('\n').slice(-40).join('\n');
    return {
      ok: res.code === 0,
      summary: `$ ${input.command}\nexit ${res.code}${res.timedOut ? ' (timeout)' : ''}\n${tail(res.stdout)}${res.stderr ? `\n[stderr]\n${tail(res.stderr)}` : ''}`,
      data: { code: res.code, argv, timedOut: res.timedOut },
    };
  },
};

const git: Tool = {
  name: 'git',
  description: 'Project version control: status, diff, checkpoint (commit everything), log, restore a path to the previous checkpoint.',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'diff', 'checkpoint', 'log', 'restore'] },
      message: { type: 'string', description: 'Commit message for checkpoint.' },
      path: { type: 'string', description: 'For restore.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async run(input: { action: string; message?: string; path?: string }, ctx) {
    const run = (args: string[]) => exec(['git', ...args], { cwd: ctx.projectRoot, timeoutMs: 60_000 });
    if (!fs.existsSync(path.join(ctx.projectRoot, '.git'))) {
      await run(['init', '-q']);
      await run(['config', 'user.email', 'agent@local']);
      await run(['config', 'user.name', 'what-if agent']);
    }
    switch (input.action) {
      case 'status': {
        const r = await run(['status', '--short']);
        return { ok: r.code === 0, summary: r.stdout.trim() || 'clean', data: { status: r.stdout.trim() } };
      }
      case 'diff': {
        const r = await run(['diff', '--stat']);
        return { ok: r.code === 0, summary: r.stdout.trim() || 'no changes', data: { diff: r.stdout } };
      }
      case 'checkpoint': {
        const msg = input.message || `agent: checkpoint ${new Date().toISOString()}`;
        await run(['add', '-A']);
        const commit = await run(['commit', '-q', '-m', msg]);
        if (commit.code !== 0 && !/nothing to commit/.test(commit.stdout + commit.stderr)) {
          return { ok: false, summary: `checkpoint failed\n${commit.stdout}${commit.stderr}` };
        }
        const head = await run(['rev-parse', '--short', 'HEAD']);
        return { ok: true, summary: `checkpoint ${head.stdout.trim()} — ${msg}`, data: { commit: head.stdout.trim() } };
      }
      case 'log': {
        const r = await run(['log', '--oneline', '-n', '20']);
        return { ok: r.code === 0, summary: r.stdout.trim() || 'no commits', data: { log: r.stdout } };
      }
      case 'restore': {
        if (!input.path) return { ok: false, summary: 'restore needs a path' };
        const rel = relOf(ctx.projectRoot, safeJoin(ctx.projectRoot, input.path));
        // Since checkpoints are taken BEFORE mutating tools, uncommitted edits on `rel` can be restored from HEAD;
        // if the working copy is already clean and HEAD~1 exists, restore from HEAD~1.
        const dirty = await run(['status', '--porcelain', '--', rel]);
        const hasPrev = (await run(['rev-parse', '--verify', '-q', 'HEAD~1'])).code === 0;
        const source = dirty.stdout.trim() || !hasPrev ? 'HEAD' : 'HEAD~1';
        const r = await run(['restore', `--source=${source}`, '--', rel]);
        return { ok: r.code === 0, summary: r.code === 0 ? `restored ${rel} from ${source}` : r.stderr };
      }
      default:
        return { ok: false, summary: `unknown git action ${input.action}` };
    }
  },
};

export const shellTools: Tool[] = [shell, git];
