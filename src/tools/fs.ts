import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import {
  exportedSymbols, globToRegExp, isBinaryPath, mimeOf, readText, relOf, safeJoin, walk,
} from './paths.js';

const repoMap: Tool = {
  name: 'repo_map',
  description:
    'Overview of the project: files (excluding node_modules/out/.git), sizes and exported symbols. Call this first, and again after big changes.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      maxFiles: { type: 'integer', description: 'Cap on listed files (default 300).' },
      filter: { type: 'string', description: 'Optional substring the path must contain.' },
    },
  },
  async run(input: { maxFiles?: number; filter?: string }, ctx) {
    const files = walk(ctx.projectRoot, { maxFiles: input.maxFiles ?? 300 });
    const selected = input.filter ? files.filter((f) => f.includes(input.filter!)) : files;
    const lines: string[] = [];
    let chars = 0;
    for (const rel of selected) {
      const abs = path.join(ctx.projectRoot, rel);
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      let symbols: string[] = [];
      if (/\.(ts|tsx|js|mjs|py)$/.test(rel) && size < 120_000) {
        const src = readText(ctx.projectRoot, rel);
        if (src) symbols = exportedSymbols(src);
      }
      const line = `${rel}${symbols.length ? ` — ${symbols.join(', ')}` : ''} (${size}b)`;
      if (chars + line.length > 60_000) {
        lines.push('… (repo map truncated)');
        break;
      }
      chars += line.length + 1;
      lines.push(line);
    }
    const episodes = files.filter((f) => /^src\/episodes\/[^/]+\/episode\.json$/.test(f)).map((f) => f.split('/')[2]);
    return {
      ok: true,
      summary: `${selected.length} files. Episodes: ${episodes.length ? episodes.join(', ') : 'none yet'}.\n${lines.join('\n')}`,
      data: { files: selected, episodes },
    };
  },
};

const readFile: Tool = {
  name: 'read_file',
  description: 'Read a text file with line numbers. Use start/end (1-based) for large files.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative path.' },
      start: { type: 'integer', description: 'First line (1-based).' },
      end: { type: 'integer', description: 'Last line, inclusive.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input: { path: string; start?: number; end?: number }, ctx) {
    const src = readText(ctx.projectRoot, input.path, 2_000_000);
    if (src === null) throw new Error(`cannot read ${input.path} (missing, binary or > 2MB)`);
    const all = src.split('\n');
    const start = Math.max(1, input.start ?? 1);
    const end = Math.min(all.length, input.end ?? all.length);
    const slice = all.slice(start - 1, end);
    let body = '';
    for (let i = 0; i < slice.length; i++) body += `${String(start + i).padStart(5)}| ${slice[i]}\n`;
    const truncated = start > 1 || end < all.length;
    return {
      ok: true,
      summary: `${input.path} lines ${start}-${end} of ${all.length}${truncated ? ' (partial)' : ''}\n${body}`,
      data: { path: input.path, lines: all.length },
    };
  },
};

const writeFile: Tool = {
  name: 'write_file',
  description: 'Create a file, or replace it entirely. Prefer edit_file for small changes to an existing file.',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(input: { path: string; content: string }, ctx): Promise<ToolResult> {
    if (isBinaryPath(input.path)) throw new Error('write_file refuses binary extensions');
    const abs = safeJoin(ctx.projectRoot, input.path);
    const existed = fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, input.content, 'utf8');
    const lines = input.content.split('\n').length;
    return {
      ok: true,
      summary: `${existed ? 'replaced' : 'created'} ${input.path} (${lines} lines, ${Buffer.byteLength(input.content)} bytes)`,
      data: { path: input.path, created: !existed, lines },
    };
  },
};

const editFile: Tool = {
  name: 'edit_file',
  description:
    'Targeted text replacement: each edit replaces one unique occurrence of oldText with newText. Fails loudly if oldText is missing or ambiguous. Batch nearby changes in one call.',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            oldText: { type: 'string', description: 'Exact text to replace, unique in the file.' },
            newText: { type: 'string' },
          },
          required: ['oldText', 'newText'],
          additionalProperties: false,
        },
      },
    },
    required: ['path', 'edits'],
    additionalProperties: false,
  },
  async run(input: { path: string; edits: { oldText: string; newText: string }[] }, ctx) {
    const src = readText(ctx.projectRoot, input.path, 2_000_000);
    if (src === null) throw new Error(`cannot read ${input.path}`);
    let out = src;
    const applied: number[] = [];
    for (let i = 0; i < input.edits.length; i++) {
      const { oldText, newText } = input.edits[i]!;
      const first = out.indexOf(oldText);
      if (first < 0) throw new Error(`edit ${i}: oldText not found in ${input.path}`);
      if (out.indexOf(oldText, first + 1) >= 0) throw new Error(`edit ${i}: oldText is not unique in ${input.path}`);
      out = out.slice(0, first) + newText + out.slice(first + oldText.length);
      applied.push(first);
    }
    const abs = safeJoin(ctx.projectRoot, input.path);
    fs.writeFileSync(abs, out, 'utf8');
    return {
      ok: true,
      summary: `${applied.length} edit(s) applied to ${input.path}`,
      data: { path: input.path, edits: applied.length },
    };
  },
};

const glob: Tool = {
  name: 'glob',
  description: 'List project files matching a glob (** and * supported), e.g. "src/episodes/**/shots.tsx".',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: { pattern: { type: 'string' }, limit: { type: 'integer' } },
    required: ['pattern'],
    additionalProperties: false,
  },
  async run(input: { pattern: string; limit?: number }, ctx) {
    const re = globToRegExp(input.pattern);
    const files = walk(ctx.projectRoot, { maxFiles: 6000 }).filter((f) => re.test(f));
    const limit = input.limit ?? 200;
    return {
      ok: true,
      summary: `${files.length} match(es)${files.length > limit ? `, first ${limit}` : ''}\n${files.slice(0, limit).join('\n')}`,
      data: { matches: files },
    };
  },
};

const grep: Tool = {
  name: 'grep',
  description: 'Regex search across project text files, with line numbers.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      glob: { type: 'string', description: 'Optional path glob filter.' },
      max: { type: 'integer' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  async run(input: { pattern: string; glob?: string; max?: number }, ctx) {
    const re = new RegExp(input.pattern, 'i');
    const globRe = input.glob ? globToRegExp(input.glob) : null;
    const max = input.max ?? 120;
    const hits: string[] = [];
    for (const rel of walk(ctx.projectRoot, { maxFiles: 6000 })) {
      if (globRe && !globRe.test(rel)) continue;
      const src = readText(ctx.projectRoot, rel);
      if (!src) continue;
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          hits.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 240)}`);
          if (hits.length >= max) break;
        }
      }
      if (hits.length >= max) break;
    }
    return {
      ok: true,
      summary: hits.length ? `${hits.length} hit(s)\n${hits.join('\n')}` : 'no match',
      data: { hits },
    };
  },
};

const viewImage: Tool = {
  name: 'view_image',
  description: 'Open an image or short video from the project (a still, a storyboard sheet, a motion grid) so you can look at it.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input: { path: string }, ctx) {
    const abs = safeJoin(ctx.projectRoot, input.path);
    if (!fs.existsSync(abs)) throw new Error(`no such file: ${input.path}`);
    const rel = relOf(ctx.projectRoot, abs);
    return {
      ok: true,
      summary: `attached ${rel}`,
      artifacts: [{ kind: mimeOf(abs).startsWith('image/') ? 'image' : 'video', path: rel, mime: mimeOf(abs) }],
    };
  },
};

export const fsTools: Tool[] = [repoMap, readFile, writeFile, editFile, glob, grep, viewImage];
