import fs from 'node:fs';
import path from 'node:path';

/**
 * The engine is ~4 500 lines of TSX and the agent has to write shots against it. Left to itself it reads
 * the files one by one (20+ steps, and it still guesses the props), so we hand it a generated listing of
 * every export with its props instead. Line-based parsing, no TypeScript dependency:
 *
 *   export const Kitchen: React.FC<{ t: number; veil?: number }> = ...   ->  Kitchen{t: number; veil?: number}
 *   export const KITCHEN = makeRoom({...})                              ->  KITCHEN = makeRoom({...})
 *   export function stand(r: Room, u: number, w: number)                 ->  stand(r: Room, u: number, w: number)
 *   export type Pose = {...}                                            ->  type Pose
 */
/** Types whose fields the agent needs to write a shot (the digest shows their body, not just their name). */
const INLINE_TYPES = new Set(['Pose', 'Limb', 'Expr', 'ActKind', 'HandKind', 'ClassTokens', 'DeskRow', 'KidLook', 'Furniture']);

export function engineDigest(projectRoot: string, cap = 16_500): string {
  const root = path.join(projectRoot, 'src', 'engine');
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(e.name)) files.push(abs);
    }
  };
  walk(root);
  if (!files.length) return '';

  const lines: string[] = [];
  for (const file of files.sort()) {
    const src = fs.readFileSync(file, 'utf8');
    const named = [...src.matchAll(/^export type (\w+)\s*=|^export interface (\w+)/gm)].map((m) => m[1] ?? m[2]);
    const entries: string[] = [];

    for (const m of src.matchAll(/^export (const|function)\s+(\w+)/gm)) {
      const [full, kind, name] = m as unknown as [string, string, string];
      if (name.startsWith('_') || entries.some((e) => e.startsWith(name))) continue;
      const after = src.slice(m.index! + full.length);

      if (kind === 'function') {
        const params = balanced(after, '(', ')');
        entries.push(`${name}${params === null ? '()' : `(${squash(params)})`}`);
        continue;
      }
      // const: a component (React.FC<...>), a value, or a plain function
      const inline = /^\s*:\s*React\.FC<\s*\{/.exec(after);
      if (inline) {
        const props = balanced(after.slice(inline[0].length - 1), '{', '}');
        entries.push(`${name}${props === null ? '{}' : `{${squash(props)}}`}`);
        continue;
      }
      const typed = /^\s*:\s*React\.FC<\s*(\w+)\s*>/.exec(after);
      if (typed) {
        entries.push(`${name}:${typed[1]}`);
        continue;
      }
      const value = after.replace(/^\s*(?::[^=]*)?=\s*/, '');
      if (value.startsWith('(') || value.startsWith('function')) {
        const params = balanced(value, '(', ')');
        entries.push(`${name}${params === null ? '()' : `(${squash(params)})`}`);
      } else {
        entries.push(`${name} = ${squash(value.split('\n')[0] ?? '').slice(0, 54)}`);
      }
    }

    const parts = [...entries];
    for (const name of named) {
      if (!INLINE_TYPES.has(name!)) continue;
      const body = typeBody(src, name!);
      if (body) parts.push(`type ${name} = ${body}`);
    }
    const others = named.filter((n) => !INLINE_TYPES.has(n!));
    if (others.length) parts.push(`types: ${others.join(', ')}`);
    if (parts.length) lines.push(`${path.relative(root, file).replace(/\.tsx?$/, '')}: ${parts.join('  |  ')}`);
  }

  const body = lines.join('\n');
  return body.length > cap ? `${body.slice(0, cap)}\n… (truncated)` : body;
}

/** The right-hand side of `export type <name> = ...;` with comments stripped and whitespace collapsed, or null. */
function typeBody(src: string, name: string): string | null {
  const m = new RegExp(`^export type ${name}\\s*=`, 'm').exec(src);
  if (!m) return null;
  let depth = 0;
  let end = -1;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '<') depth++;
    else if (c === '}' || c === ')' || c === '>') depth--;
    else if (c === ';' && depth <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const body = src
    .slice(m.index + m[0].length, end)
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  return squash(body).slice(0, 900);
}

/** The text between an opening bracket and its match, or null. */
function balanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/** One line, collapsed. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/;\s*/g, '; ').replace(/,\s*/g, ', ').trim();
}
