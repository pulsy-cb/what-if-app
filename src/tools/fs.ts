import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from './exec.js';
import type { Tool, ToolResult } from './types.js';
import {
  exportedSymbols, globToRegExp, isBinaryPath, mimeOf, readText, relOf, safeJoin, walk,
} from './paths.js';
import {
  normalizeSharedEpisodeFile,
  normalizeShotTagJsx,
  prepareModularShotFile,
  readEpisodeShots,
  replaceShotMonolithic,
  syncShotsBarrel,
} from './episode-source.js';

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

/**
 * Normalize episode TSX files on write/edit:
 * - `shots.tsx`: `<shot>` -> `<Shot>`
 * - `shared.tsx`: `<shot>` -> `<Shot>` + auto-export top-level shared places/cast/helpers
 * - `shots/S<N>.tsx`: auto-import `React`, `'../../../engine'`, `'../shared'` + `<shot>` -> `<Shot>`
 */
function normalizeEpisodeTsx(projectRoot: string, relPath: string, code: string): string {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^src\/episodes\/[^/]+\/shots\.tsx$/.test(norm)) {
    return normalizeShotTagJsx(code);
  }
  if (/^src\/episodes\/[^/]+\/shared\.tsx$/.test(norm)) {
    return normalizeSharedEpisodeFile(code);
  }
  const shotMatch = /^src\/episodes\/([^/]+)\/shots\/(S\d+)\.tsx$/i.exec(norm);
  if (shotMatch) {
    const epDir = path.join(projectRoot, 'src', 'episodes', shotMatch[1]!);
    return prepareModularShotFile(projectRoot, epDir, shotMatch[2]!.toUpperCase(), code);
  }
  return code;
}

/** Auto-rebuild barrel `shots.tsx` (and `index.tsx` shot map) whenever `shared.tsx` or `shots/S<N>.tsx` changes. */
function maybeSyncEpisodeBarrel(projectRoot: string, relPath: string): void {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const m = /^src\/episodes\/([^/]+)\/(?:shared\.tsx|shots\/S\d+\.tsx)$/i.exec(norm);
  if (!m) return;
  const epDir = path.join(projectRoot, 'src', 'episodes', m[1]!);
  const epSrc = readEpisodeShots(epDir);
  if (epSrc.isModular) {
    syncShotsBarrel(epDir);
  }
}

/**
 * Fast local TypeScript check when an episode's shots, shared.tsx, or index.tsx is written/edited and node_modules exists.
 * Catches syntax/prop errors immediately before a slow Modal round-trip.
 */
async function quickEpisodeTypecheck(projectRoot: string, relPath: string): Promise<string> {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const m = /^src\/episodes\/([^/]+)\/(?:shots|shared|index|shots\/S\d+)\.tsx$/i.exec(norm);
  if (!m) return '';
  const slug = m[1]!;
  if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) return '';
  const projTsc = path.join(projectRoot, 'node_modules', '.bin', 'tsc');
  const appTsc = path.join(APP_ROOT, 'node_modules', '.bin', 'tsc');
  const tscBin = fs.existsSync(projTsc) ? projTsc : fs.existsSync(appTsc) ? appTsc : '';
  if (!tscBin) return '';

  // Only run tsc once all timeline shots are exported (skip intermediate batches while shots are still being added)
  try {
    const epDir = path.join(projectRoot, 'src', 'episodes', slug);
    const tl = JSON.parse(fs.readFileSync(path.join(epDir, 'timeline.json'), 'utf8'));
    const epSrc = readEpisodeShots(epDir);
    if (epSrc.isPlaceholder) return '';
    const exported = new Set(epSrc.exportedShotIds);
    const wanted: string[] = (tl?.shots ?? []).map((s: any) => String(s?.id ?? '')).filter(Boolean);
    if (wanted.some((id) => !exported.has(id))) {
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
    const abs = safeJoin(ctx.projectRoot, input.path);
    const existed = fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (input.append && existed) {
      const prev = fs.readFileSync(abs, 'utf8');
      const sep = prev.length > 0 && !prev.endsWith('\n') ? '\n' : '';
      const combined = normalizeEpisodeTsx(ctx.projectRoot, input.path, prev + sep + input.content);
      fs.writeFileSync(abs, combined, 'utf8');
      maybeSyncEpisodeBarrel(ctx.projectRoot, input.path);
      const totalLines = combined.split('\n').length;
      const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, input.path);
      return {
        ok: true,
        summary: `appended to ${input.path} (+${input.content.split('\n').length} lines, total ${totalLines} lines)${tscNote}`,
        data: { path: input.path, created: false, appended: true, lines: totalLines },
      };
    }
    const content = normalizeEpisodeTsx(ctx.projectRoot, input.path, input.content);
    fs.writeFileSync(abs, content, 'utf8');
    maybeSyncEpisodeBarrel(ctx.projectRoot, input.path);
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
    const normalizedOut = normalizeEpisodeTsx(ctx.projectRoot, input.path, out);
    fs.writeFileSync(abs, normalizedOut, 'utf8');
    maybeSyncEpisodeBarrel(ctx.projectRoot, input.path);
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
 * has to read the file back to quote it exactly. AST-aware so neighboring local helpers and comments are preserved.
 */
export function replaceShot(src: string, id: string, code: string): { text: string; replaced: boolean } {
  return replaceShotMonolithic(src, id, code);
}

const editShot: Tool = {
  name: 'edit_shot',
  description:
    'Write or replace one shot S<N> of an episode by its id (e.g. "S7"). On modular episodes (with shared.tsx / shots/), writes isolated `src/episodes/<episode>/shots/S7.tsx` (auto-importing shared places/cast and engine helpers) and syncs the `shots.tsx` barrel + `index.tsx`. On legacy single-file episodes, replaces `S7` cleanly inside `shots.tsx`. Pass `export const S7 = ...` (optionally preceded by shot-local helpers).',
  policy: 'auto',
  mutating: true,
  schema: {
    type: 'object',
    properties: {
      episode: { type: 'string' },
      id: { type: 'string', description: 'Shot id, e.g. "S7".' },
      code: {
        type: 'string',
        description: 'The complete shot code exporting `export const S7 = ...` (local helpers like `const BEFORE = shot(...)` above `export const S7` are allowed).',
      },
    },
    required: ['episode', 'id', 'code'],
    additionalProperties: false,
  },
  validate: (input) => {
    const id = String(input.id ?? '');
    if (!/^S\d+$/.test(id)) return 'id must be a shot id like "S7"';
    const code = String(input.code ?? '');
    if (!new RegExp(`^\\s*export\\s+(?:const|function)\\s+${id}\\b`, 'm').test(code)) {
      return `code must start with \`export const ${id} =\` (optionally preceded by local helpers or imports)`;
    }
    for (const m of code.matchAll(/^\s*export\s+(?:const|function)\s+(S\d+)\b/gm)) {
      if (m[1] !== id) {
        return `edit_shot writes one shot at a time: found \`export const ${m[1]}\` inside edit_shot for ${id}. Make a separate edit_shot call per shot.`;
      }
    }
    return null;
  },
  async run(input: { episode: string; id: string; code: string }, ctx): Promise<ToolResult> {
    const epRel = `src/episodes/${input.episode}`;
    assertWritableProjectPath(`${epRel}/shots.tsx`);
    assertNotCompactedPlaceholder(input.code, 'edit_shot');
    const epDir = safeJoin(ctx.projectRoot, epRel);
    if (!fs.existsSync(epDir)) {
      throw new Error(`${epRel} does not exist yet: scaffold the episode first`);
    }

    const epSrc = readEpisodeShots(epDir);
    // Modular mode: write isolated `src/episodes/<episode>/shots/<id>.tsx` and sync barrel `shots.tsx` + `index.tsx`
    if (epSrc.isModular || !epSrc.exists || epSrc.isPlaceholder) {
      const shotsDir = path.join(epDir, 'shots');
      fs.mkdirSync(shotsDir, { recursive: true });
      // Remove scaffold S1 placeholder if another shot is written first
      if (input.id !== 'S1') {
        const stubS1 = path.join(shotsDir, 'S1.tsx');
        if (fs.existsSync(stubS1) && fs.readFileSync(stubS1, 'utf8').includes('SHOT S1 — PLACEHOLDER')) {
          fs.unlinkSync(stubS1);
        }
      }
      const shotRel = `${epRel}/shots/${input.id}.tsx`;
      const shotAbs = safeJoin(ctx.projectRoot, shotRel);
      const existed = fs.existsSync(shotAbs) && !fs.readFileSync(shotAbs, 'utf8').includes('SHOT S1 — PLACEHOLDER');
      const prepared = prepareModularShotFile(ctx.projectRoot, epDir, input.id, input.code);
      fs.writeFileSync(shotAbs, prepared, 'utf8');
      const allIds = syncShotsBarrel(epDir);
      const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, shotRel);
      return {
        ok: true,
        summary: `${existed ? 'replaced' : 'added'} ${input.id} in ${shotRel} (${allIds.length} shot(s) synced in shots.tsx)${tscNote}`,
        data: { path: shotRel, id: input.id, replaced: existed, modular: true },
      };
    }

    // Legacy monolithic fallback: AST-safe single-shot replacement inside `shots.tsx`
    const rel = `${epRel}/shots.tsx`;
    const abs = safeJoin(ctx.projectRoot, rel);
    const { text, replaced } = replaceShot(fs.readFileSync(abs, 'utf8'), input.id, input.code);
    fs.writeFileSync(abs, normalizeEpisodeTsx(ctx.projectRoot, rel, text), 'utf8');
    const tscNote = await quickEpisodeTypecheck(ctx.projectRoot, rel);
    return { ok: true, summary: `${replaced ? 'replaced' : 'added'} ${input.id} in ${rel}${tscNote}`, data: { path: rel, id: input.id, replaced } };
  },
};

export const fsTools: Tool[] = [repoMap, readFile, writeFile, editFile, editShot, glob, grep, viewImage];
