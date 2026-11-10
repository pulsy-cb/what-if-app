import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from './exec.js';
import type { Tool, ToolResult } from './types.js';
import {
  exportedSymbols, globToRegExp, isBinaryPath, mimeOf, readText, relOf, safeJoin, walk,
} from './paths.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the agent may write inside a project: its episodes, notes at the root (PROJECT.md…) and scratch files in out/.
 * Everything else (the engine, studio config, exports, package manifests, scripts, git internals, .env) is refused: a
 * model that mis-targets a path used to overwrite studio files (src/exports/, src/engine) and lose them.
 * Engine edits stay possible when the operator sets WHATIF_ALLOW_ENGINE_WRITES=1 (e.g. to extend a set on request).
 */
const WRITABLE_PATHS = [/^src\/episodes\//, /^[^/]+\.md$/, /^out\//];
const ENGINE_PATHS = /^src\/(engine|exports)\//;

function assertWritableProjectPath(relPath: string): void {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/\(exports:|\[compacted/i.test(norm)) {
    throw new Error(`writing to "${norm}" is refused: pass the clean file path (e.g. "src/episodes/<slug>/shots.tsx") without annotations`);
  }
  if (
    norm === 'package.json' ||
    norm === 'package-lock.json' ||
    norm.startsWith('scripts/') ||
    norm.startsWith('.git/') ||
    /(^|\/)\.env(\.|$)/.test(norm)
  ) {
    throw new Error(`writing to "${norm}" is refused by security policy`);
  }
  if (WRITABLE_PATHS.some((re) => re.test(norm))) return;
  if (process.env.WHATIF_ALLOW_ENGINE_WRITES === '1' && ENGINE_PATHS.test(norm)) return;
  throw new Error(
    `writing to "${norm}" is refused: write inside src/episodes/<slug>/ (shots.tsx, index.tsx, DIRECTOR.md…), a root note like PROJECT.md, or out/. ` +
      `The engine (src/engine) is shared by every episode and is not edited by the agent.`,
  );
}

function assertNotCompactedPlaceholder(text: string, toolName: string): void {
  if (/\[compacted:\s*\d+\s*lines/i.test(text)) {
    throw new Error(
      `${toolName} refused: content contains a "[compacted: ...]" placeholder instead of real code. Write the actual TypeScript/JSX code for the shots.`,
    );
  }
}

/** Normalize lowercase `<shot ... />` JSX tags into `<Shot ... />` in shots.tsx so both `shot({...})` and `<Shot ... />` work. */
function normalizeShotsJsx(relPath: string, code: string): string {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!/^src\/episodes\/[^/]+\/shots\.tsx$/.test(norm)) return code;
  if (!/<shot(?=[\s/>])/.test(code)) return code;
  let out = code.replace(/<shot(?=[\s/>])/g, '<Shot').replace(/<\/shot\s*>/g, '</Shot>');
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*(['"]\.\.\/\.\.\/engine['"])/,
    (full, names: string, mod: string) => {
      if (/\bShot\b/.test(names)) return full;
      return `import {${names.replace(/\bshot\b/, 'shot, Shot')}} from ${mod}`;
    },
  );
  return out;
}

/**
 * Fast local TypeScript check when an episode's shots.tsx or index.tsx is written/edited and node_modules exists.
 * Catches syntax/prop errors immediately before a slow Modal round-trip.
 */
async function quickEpisodeTypecheck(projectRoot: string, relPath: string): Promise<string> {
  const norm = relPath.replace(/\\/g, '/');
  const m = /^src\/episodes\/([^/]+)\/(shots|index)\.tsx$/.exec(norm);
  if (!m) return '';
  const slug = m[1]!;
  if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) return '';
  const projTsc = path.join(projectRoot, 'node_modules', '.bin', 'tsc');
  const appTsc = path.join(APP_ROOT, 'node_modules', '.bin', 'tsc');
  const tscBin = fs.existsSync(projTsc) ? projTsc : fs.existsSync(appTsc) ? appTsc : '';
  if (!tscBin) return '';

  // Only run tsc once all timeline shots are exported (skip intermediate write_file append chunks)
  try {
    const tl = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src', 'episodes', slug, 'timeline.json'), 'utf8'));
    const shotsSrc = fs.readFileSync(path.join(projectRoot, 'src', 'episodes', slug, 'shots.tsx'), 'utf8');
    const wanted: string[] = (tl?.shots ?? []).map((s: any) => String(s?.id ?? '')).filter(Boolean);
    if (wanted.some((id) => !new RegExp(`export\\s+(?:const|function)\\s+${id}\\b`).test(shotsSrc))) {
      return '';
    }
  } catch {
    /* run check anyway */
  }

  const res = await exec([tscBin, '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], {
    cwd: projectRoot,
    timeoutMs: 25_000,
  });
  if (res.code === 0) return '\n[tsc] OK (0 TypeScript errors)';
  const out = `${res.stdout}\n${res.stderr}`
    .split('\n')
    .filter((l) => l.includes(`src/episodes/${slug}/`) || /error TS\d+/.test(l))
    .slice(0, 15)
    .join('\n');
  return out ? `\n[tsc] TypeScript errors detected — fix before running stills/render:\n${out}` : '';
}

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
  description:
    'Read a text file with line numbers. It returns the WHOLE file (up to 6000 lines): do not paginate it ' +
    'into windows, call it once. start/end exist only for files above that limit.',
  policy: 'auto',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative path.' },
      start: { type: 'integer', description: 'First line (1-based).' },
      end: { type: 'integer', description: 'Last line, inclusive.' },
      limit: { type: 'integer', description: 'Optional max number of lines to read.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input: { path: string; start?: number; end?: number; limit?: number }, ctx) {
    const src = readText(ctx.projectRoot, input.path, 2_000_000);
    if (src === null) throw new Error(`cannot read ${input.path} (missing, binary or > 2MB)`);
    const all = src.split('\n');
    const start = Math.max(1, input.start ?? 1);
    const end = Math.min(all.length, input.end ?? (input.limit ? start + input.limit - 1 : start + 5_999));
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
  description:
    'Create a file, replace it entirely, or append to it (when append: true). For large files like shots.tsx with 10+ shots, write the first 6-8 shots with write_file and append the remaining shots in batches of 6-8 with append: true.',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
      append: { type: 'boolean', description: 'If true, append content to the end of the file instead of overwriting.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(input: { path: string; content: string; append?: boolean }, ctx): Promise<ToolResult> {
    if (isBinaryPath(input.path)) throw new Error('write_file refuses binary extensions');
    assertWritableProjectPath(input.path);
    assertNotCompactedPlaceholder(input.content, 'write_file');
    const content = normalizeShotsJsx(input.path, input.content);
    const abs = safeJoin(ctx.projectRoot, input.path);
    const existed = fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (input.append && existed) {
      const prev = fs.readFileSync(abs, 'utf8');
      const sep = prev.length > 0 && !prev.endsWith('\n') ? '\n' : '';
      const combined = normalizeShotsJsx(input.path, prev + sep + content);
      fs.writeFileSync(abs, combined, 'utf8');
      const totalLines = combined.split('\n').length;
      const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, input.path);
      return {
        ok: true,
        summary: `appended to ${input.path} (+${content.split('\n').length} lines, total ${totalLines} lines)${tscNote}`,
        data: { path: input.path, created: false, appended: true, lines: totalLines },
      };
    }
    fs.writeFileSync(abs, content, 'utf8');
    const lines = content.split('\n').length;
    const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, input.path);
    return {
      ok: true,
      summary: `${existed ? 'replaced' : 'created'} ${input.path} (${lines} lines, ${Buffer.byteLength(content)} bytes)${tscNote}`,
      data: { path: input.path, created: !existed, lines },
    };
  },
};


/** A whitespace-tolerant match: same text once leading indentation and blank lines are ignored. */
function looseMatch(
  haystack: string,
  needle: string,
): { start: number; end: number; replace: (text: string) => string } | null {
  const want = needle
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!want.length) return null;
  const lines = haystack.split('\n');
  const offsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1;
  }

  // One-line needle: the model usually misses the indentation, or quotes a fragment of a longer line.
  if (want.length === 1) {
    const hits: { at: number; end: number }[] = [];
    lines.forEach((line, i) => {
      const at = line.indexOf(want[0]!);
      if (at >= 0) hits.push({ at: offsets[i]! + at, end: offsets[i]! + at + want[0]!.length });
    });
    if (hits.length !== 1) return null;
    return {
      start: hits[0]!.at,
      end: hits[0]!.end,
      replace: (text: string) => text.split('\n').map((l) => l.trim()).join('\n'),
    };
  }

  let found: { start: number; end: number; indent: string } | null = null;
  let hits = 0;
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (lines[i + k]!.trim() !== want[k]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    hits++;
    const indent = /^\s*/.exec(lines[i]!)?.[0] ?? '';
    const last = lines[i + want.length - 1]!;
    found = { start: offsets[i]!, end: offsets[i + want.length - 1]! + last.length, indent };
  }
  if (hits !== 1 || !found) return null;
  const { start, end, indent } = found;
  return {
    start,
    end,
    // keep the new text at the block's indentation so the patch looks like the file around it
    replace: (text: string) =>
      text
        .split('\n')
        .map((l, idx) => (idx === 0 || l.trim() === '' ? l : indent + l.replace(/^\s+/, '')))
        .join('\n'),
  };
}

/** The block of the file that most resembles the requested oldText, to hand back as a hint. */
function nearestBlock(haystack: string, needle: string): { line: number; endLine: number; text: string } | null {
  const want = needle.trim().split('\n')[0]!.trim();
  if (want.length < 4) return null;
  const lines = haystack.split('\n');
  let best = { index: -1, score: 0 };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const score = commonRun(t, want);
    if (score > best.score) best = { index: i, score };
  });
  if (best.index < 0 || best.score < Math.min(6, Math.ceil(want.length / 2))) return null;
  const count = Math.max(1, needle.split('\n').length);
  const from = Math.max(0, best.index - 2);
  const to = Math.min(lines.length, best.index + count + 3);
  const slice = lines.slice(from, to);
  return { line: from + 1, endLine: from + slice.length, text: slice.join('\n') };
}

/** Length of the longest common substring. */
function commonRun(a: string, b: string): number {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]!;
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1;
        if (prev[j]! > best) best = prev[j]!;
      } else prev[j] = 0;
      diag = keep;
    }
  }
  return best;
}

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
    assertWritableProjectPath(input.path);
    for (const e of input.edits) assertNotCompactedPlaceholder(e.newText, 'edit_file');
    const src = readText(ctx.projectRoot, input.path, 2_000_000);
    if (src === null) throw new Error(`cannot read ${input.path}`);
    let out = src;
    const applied: number[] = [];
    const isShotsTsx = /(?:^|\/)shots\.tsx$/.test(input.path.replace(/\\/g, '/'));
    const shotsTip = isShotsTsx
      ? '\nTip: for shots.tsx, prefer edit_shot (replaces one shot S<N> cleanly by ID) or send smaller single-shot edits.'
      : '';
    for (let i = 0; i < input.edits.length; i++) {
      const { oldText, newText } = input.edits[i]!;
      const first = out.indexOf(oldText);
      if (first >= 0) {
        if (out.indexOf(oldText, first + 1) >= 0) {
          const hitLines: number[] = [];
          let cursor = 0;
          while (hitLines.length < 6) {
            const idx = out.indexOf(oldText, cursor);
            if (idx < 0) break;
            hitLines.push(out.slice(0, idx).split('\n').length);
            cursor = idx + Math.max(1, oldText.length);
          }
          throw new Error(
            `edit ${i}: oldText is not unique in ${input.path} (matches at lines ${hitLines.join(', ')} — include surrounding lines to disambiguate).${shotsTip}`,
          );
        }
        out = out.slice(0, first) + newText + out.slice(first + oldText.length);
        applied.push(first);
        continue;
      }
      // Indentation and blank lines are what models get wrong; match on trimmed text instead of failing.
      const loose = looseMatch(out, oldText);
      if (loose) {
        out = out.slice(0, loose.start) + loose.replace(newText) + out.slice(loose.end);
        applied.push(loose.start);
        continue;
      }
      const near = nearestBlock(out, oldText);
      throw new Error(
        `edit ${i}: oldText not found in ${input.path}.` +
          (near
            ? ` The closest text is lines ${near.line}-${near.endLine}:\n---\n${near.text}\n---\nCopy the exact lines you want to replace (indentation included).`
            : ' Read the file and copy the text exactly.') +
          shotsTip,
      );
    }
    const abs = safeJoin(ctx.projectRoot, input.path);
    fs.writeFileSync(abs, out, 'utf8');
    const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, input.path);
    return {
      ok: true,
      summary: `${applied.length} edit(s) applied to ${input.path}${tscNote}`,
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
      path: { type: 'string', description: 'Optional file path or glob filter (alias for glob).' },
      max: { type: 'integer' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  async run(input: { pattern: string; glob?: string; path?: string; max?: number }, ctx) {
    const re = new RegExp(input.pattern, 'i');
    const filterPat = input.glob ?? input.path;
    const globRe = filterPat ? globToRegExp(filterPat) : null;
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

/**
 * Replace one shot of shots.tsx by its id, or add it when it is missing: the model sends the new shot only and never
 * has to read the file back to quote it exactly. The comment lines just above the next shot stay with that shot.
 */
export function replaceShot(src: string, id: string, code: string): { text: string; replaced: boolean } {
  const start = new RegExp(`^export\\s+(?:const|function)\\s+${id}\\b`, 'm').exec(src);
  const block = code.trim() + '\n';
  if (!start) return { text: src + (src.endsWith('\n') || !src ? '' : '\n') + '\n' + block, replaced: false };
  const after = src.slice(start.index + 1);
  const next = /^export\s+(?:const|function)\s+[A-Za-z0-9_$]+/m.exec(after);
  let end = next ? start.index + 1 + next.index : src.length;
  if (next) {
    // keep the comment lines that introduce the next shot
    const lines = src.slice(0, end).split('\n');
    lines.pop();
    while (lines.length && /^\s*(\/\/.*)?$/.test(lines[lines.length - 1]!) && lines.join('\n').length > start.index) {
      const l = lines[lines.length - 1]!;
      if (!/^\s*\/\//.test(l)) break;
      lines.pop();
    }
    end = lines.join('\n').length + 1;
  }
  return { text: src.slice(0, start.index) + block + (next ? '\n' : '') + src.slice(end), replaced: true };
}

const editShot: Tool = {
  name: 'edit_shot',
  description:
    'Replace one shot of src/episodes/<episode>/shots.tsx by its id (S7), or add it if it is missing. Send the whole new shot, starting with `export const S7 =`. No need to read the file first: this is the way to fix a shot after the audit or the reviewer.',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      id: { type: 'string', description: 'Shot id, e.g. "S7".' },
      code: { type: 'string', description: 'The complete new shot, starting with `export const S7 =`.' },
    },
    required: ['episode', 'id', 'code'],
    additionalProperties: false,
  },
  validate: (input) => {
    if (!/^S\d+$/.test(String(input.id ?? ''))) return 'id must be a shot id like "S7"';
    if (!new RegExp(`^\\s*(\\/\\/[^\\n]*\\n\\s*)*export\\s+(?:const|function)\\s+${String(input.id)}\\b`).test(String(input.code ?? '')))
      return `code must start with \`export const ${String(input.id)} =\``;
    return null;
  },
  async run(input: { episode: string; id: string; code: string }, ctx): Promise<ToolResult> {
    const rel = `src/episodes/${input.episode}/shots.tsx`;
    assertWritableProjectPath(rel);
    assertNotCompactedPlaceholder(input.code, 'edit_shot');
    const abs = safeJoin(ctx.projectRoot, rel);
    if (!fs.existsSync(abs)) throw new Error(`${rel} does not exist yet: write it with write_file first`);
    const { text, replaced } = replaceShot(fs.readFileSync(abs, 'utf8'), input.id, input.code);
    fs.writeFileSync(abs, normalizeShotsJsx(rel, text), 'utf8');
    const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, rel);
    return { ok: true, summary: `${replaced ? 'replaced' : 'added'} ${input.id} in ${rel}${tscNote}`, data: { path: rel, id: input.id, replaced } };
  },
};

export const fsTools: Tool[] = [repoMap, readFile, writeFile, editFile, editShot, glob, grep, viewImage];
