import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.whatif', '.cache', '__pycache__']);
const BINARY_EXT = new Set([
  '.mp4', '.mov', '.mp3', '.wav', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.pdf',
]);

function isSensitiveConfigPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return /(^|\/)\.env(\.|$)/i.test(norm) || /(^|\/)providers\.json$/i.test(norm);
}

/** Resolve a project-relative path, refusing anything that escapes the project root (including via symlinks). */
export function safeJoin(root: string, rel: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`path escapes the project: ${rel}`);

  // Prevent symlink escapes outside the project root (allow the studio's shared node_modules junction only)
  const relPosix = path.relative(base, full).split(path.sep).join('/');
  if (relPosix && relPosix !== 'node_modules' && !relPosix.startsWith('node_modules/')) {
    let realBase = base;
    try {
      if (fs.existsSync(base)) realBase = fs.realpathSync(base);
    } catch {
      /* keep base */
    }
    let cur = full;
    while (cur.length >= base.length && !fs.existsSync(cur)) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    if (fs.existsSync(cur)) {
      let realCur: string;
      try {
        realCur = fs.realpathSync(cur);
      } catch {
        throw new Error(`path escapes the project (unresolvable symlink): ${rel}`);
      }
      if (realCur !== realBase && !realCur.startsWith(realBase + path.sep)) {
        throw new Error(`path escapes the project via symlink: ${rel}`);
      }
    }
  }
  return full;
}

export function relOf(root: string, abs: string): string {
  return path.relative(path.resolve(root), abs).split(path.sep).join('/');
}

export function isBinaryPath(p: string): boolean {
  return BINARY_EXT.has(path.extname(p).toLowerCase());
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 2048);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export type WalkOptions = { maxFiles?: number; maxBytes?: number; includeBinary?: boolean };

/** Deterministic, sorted walk of the project, skipping build/dep/output folders. */
export function walk(root: string, opts: WalkOptions = {}): string[] {
  const maxFiles = opts.maxFiles ?? 4000;
  const maxBytes = opts.maxBytes ?? 400_000;
  const out: string[] = [];
  const stack: string[] = [path.resolve(root)];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const entryRel = relOf(root, abs);
      if (isSensitiveConfigPath(entryRel)) continue;
      if (!opts.includeBinary && isBinaryPath(abs)) continue;
      try {
        if (fs.statSync(abs).size > maxBytes) continue;
      } catch {
        continue;
      }
      out.push(entryRel);
    }
  }
  return out.sort();
}

/** Read a text file, or null when it is binary, missing, .env/providers.json, or too large. */
export function readText(root: string, rel: string, maxBytes = 400_000): string | null {
  const abs = safeJoin(root, rel);
  const normRel = relOf(root, abs);
  if (isSensitiveConfigPath(normRel)) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > maxBytes) return null;
  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) return null;
  return buf.toString('utf8');
}

export function mimeOf(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const table: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json', '.md': 'text/markdown',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.ts': 'text/plain', '.tsx': 'text/plain', '.py': 'text/plain', '.txt': 'text/plain',
  };
  return table[ext] ?? 'application/octet-stream';
}

export function kindOf(p: string): 'image' | 'video' | 'audio' | 'text' | 'file' {
  const m = mimeOf(p);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m === 'application/json') return 'text';
  return 'file';
}

/** '/**'‑style glob to RegExp: supports * , ** and ? only. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

/** Cheap symbol extraction for the repo map: exported names only, no parser. */
export function exportedSymbols(src: string): string[] {
  const names = new Set<string>();
  const re = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(re)) names.add(m[1]!);
  const re2 = /^\s*export\s*\{([^}]+)\}/gm;
  for (const m of src.matchAll(re2)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].slice(0, 40);
}
