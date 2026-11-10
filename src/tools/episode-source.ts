import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { exportedSymbols } from './paths.js';

/** Sort shot identifiers numerically (`S1`, `S2`, ..., `S10`, `S66`). */
export function sortShotIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const na = Number(/^S(\d+)$/i.exec(a)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const nb = Number(/^S(\d+)$/i.exec(b)?.[1] ?? Number.MAX_SAFE_INTEGER);
    if (na !== nb) return na - nb;
    return a.localeCompare(b, 'en', { numeric: true });
  });
}

/** Extract unique canonical `S<N>` shot IDs from any string (e.g. `"S1, S7, s42"` -> `['S1', 'S7', 'S42']`). */
export function extractShotIds(text: string): string[] {
  return sortShotIds((String(text ?? '').match(/\bS\d+\b/gi) ?? []).map((s) => s.toUpperCase()));
}

/** Built-in engine export names used as a fast fallback when `src/engine` is minimal (e.g. unit tests). */
const BUILTIN_ENGINE_EXPORTS = new Set([
  'shot',
  'Shot',
  'phoneShot',
  'place',
  'cast',
  'ShotProps',
  'Timeline',
  'defineEpisode',
  'Stage',
  'Staged',
  'Person',
  'Duo',
  'Hero',
  'Actor',
  'LOOKS',
  'makeLook',
  'basePose',
  'poseAt',
  'actPose',
  'walkPose',
  'faceAt',
  'talkAt',
  'turnAt',
  'act',
  'clip',
  'gesture',
  'handWorld',
  'ikArm',
  'reachPose',
  'grabAt',
  'grabOf',
  'tableSit',
  'bedSit',
  'carSit',
  'Foreground',
  'makeRoom',
  'CustomRoom',
  'RoomShell',
  'Box',
  'FloorShadow',
  'stand',
  'BackWindow',
  'Pendant',
  'WallLight',
  'FloorPlant',
  'WallFrame',
  'WallClock',
  'WallBoard',
  'PinBoard',
  'DiningTable',
  'MonitorSetup',
  'Tabletop',
  'Study',
  'STUDY',
  'Desk',
  'Bedroom',
  'BEDROOM',
  'BedDuvet',
  'Kitchen',
  'KITCHEN',
  'islandTop',
  'Classroom',
  'CLS',
  'CLASS_MOODS',
  'Rooftop',
  'Stairwell',
  'Outdoor',
  'OUTDOOR',
  'Tree',
  'StreetLamp',
  'CarExterior',
  'Vehicle',
  'VehicleForeground',
  'Schematic',
  'DrawOn',
  'SchLabel',
  'CountUp',
  'Arrow',
  'TitleCard',
  'LightVeil',
  'Glow',
  'Dust',
  'camT',
  'camPush',
  'camPan',
  'parallax',
  'kf',
  'rnd',
  'clamp',
  'easeOut',
]);

function discoverEngineExports(projectRoot: string): Set<string> {
  const out = new Set<string>(BUILTIN_ENGINE_EXPORTS);
  const engineDir = path.join(projectRoot, 'src', 'engine');
  if (!fs.existsSync(engineDir)) return out;
  const stack = [engineDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        try {
          for (const sym of exportedSymbols(fs.readFileSync(abs, 'utf8'))) out.add(sym);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

function unwrapExpr(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
}

function isExportedStmt(stmt: ts.Statement): boolean {
  return Boolean(ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

export type SlicedMonolithic = {
  header: string;
  helpersMap: Map<string, string>;
  ownBodies: Map<string, string>;
  shotBodies: Record<string, string>;
  exportedShotIds: string[];
};

/**
 * Parse a monolithic `shots.tsx` (or a single modular `S<N>.tsx` file) via TypeScript AST:
 * - separates top-of-file shared declarations (`header`),
 * - extracts non-exported component/shot helpers (`helpersMap`),
 * - attaches each helper ONLY to the exported `S<N>` shot(s) that reference it (`shotBodies`),
 *   preventing `S11`'s `BEFORE_PULL` helper from bleeding into `S10`!
 */
export function sliceMonolithicShots(shotsSource: string): SlicedMonolithic {
  const sf = ts.createSourceFile('shots.tsx', shotsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ownBodies = new Map<string, string>();
  const helpersMap = new Map<string, string>();
  const headerChunks: string[] = [];
  const exportedShotIds: string[] = [];

  const isComponentOrShotInit = (name: string, init: ts.Expression): boolean => {
    const u = unwrapExpr(init);
    if (ts.isCallExpression(u) && ts.isIdentifier(u.expression) && /^(?:shot|phoneShot)$/.test(u.expression.text)) return true;
    if ((ts.isArrowFunction(u) || ts.isFunctionExpression(u)) && /^[A-Z]/.test(name)) return true;
    if (ts.isIdentifier(u) && helpersMap.has(u.text)) return true;
    return false;
  };

  let seenFirstShotOrLocalHelper = false;
  for (const stmt of sf.statements) {
    const isExp = isExportedStmt(stmt);
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const text = stmt.getText(sf);
      if (isExp && /^S\d+$/.test(name)) {
        seenFirstShotOrLocalHelper = true;
        exportedShotIds.push(name);
        ownBodies.set(name, text);
        continue;
      }
      if (/^[A-Z]/.test(name)) {
        helpersMap.set(name, text);
        if (!seenFirstShotOrLocalHelper) headerChunks.push(text);
        continue;
      }
    } else if (ts.isVariableStatement(stmt)) {
      let handledAsShot = false;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const text = stmt.declarationList.declarations.length === 1 ? stmt.getText(sf) : decl.getText(sf);
        if (isExp && /^S\d+$/.test(name)) {
          seenFirstShotOrLocalHelper = true;
          exportedShotIds.push(name);
          ownBodies.set(name, text);
          handledAsShot = true;
        } else if (!isExp && decl.initializer && isComponentOrShotInit(name, decl.initializer)) {
          helpersMap.set(name, text);
          if (seenFirstShotOrLocalHelper) handledAsShot = true;
        }
      }
      if (handledAsShot) continue;
    }
    if (!seenFirstShotOrLocalHelper) {
      headerChunks.push(stmt.getText(sf));
    }
  }

  const shotBodies: Record<string, string> = {};
  const helperNames = [...helpersMap.keys()];
  for (const [id, own] of ownBodies) {
    if (!helperNames.length) {
      shotBodies[id] = own;
      continue;
    }
    const seen = new Set<string>();
    const extra: string[] = [];
    const visit = (code: string, depth: number) => {
      if (depth > 8) return;
      for (const h of helperNames) {
        if (seen.has(h)) continue;
        if (new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(code)) {
          seen.add(h);
          const hCode = helpersMap.get(h)!;
          extra.push(hCode);
          visit(hCode, depth + 1);
        }
      }
    };
    visit(own, 0);
    shotBodies[id] = extra.length ? `${own}\n${extra.join('\n')}` : own;
  }

  return {
    header: headerChunks.join('\n').trim(),
    helpersMap,
    ownBodies,
    shotBodies,
    exportedShotIds,
  };
}

export type EpisodeShotsBundle = {
  isModular: boolean;
  exists: boolean;
  isPlaceholder: boolean;
  sharedSource: string;
  helpersMap: Map<string, string>;
  shotFiles: Map<string, string>;
  shotBodies: Record<string, string>;
  exportedShotIds: string[];
  /** Unified source text across shared.tsx + all shots (for palette, cast, seed, and global metrics). */
  combinedSource: string;
  /** Most recent modification timestamp across shots.tsx, shared.tsx, and shots/S*.tsx. */
  latestMtimeMs: number;
  /** Per-shot modification timestamps (when modular) for delta tracking. */
  shotMtimesMs: Map<string, number>;
};

function safeMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Read an episode's shot definitions seamlessly whether the episode uses:
 * - **Modular layout**: `shared.tsx` + `shots/S1.tsx .. S<N>.tsx` + barrel `shots.tsx`, OR
 * - **Legacy monolithic layout**: all code in `shots.tsx`.
 */
export function readEpisodeShots(epDir: string): EpisodeShotsBundle {
  const barrelPath = path.join(epDir, 'shots.tsx');
  const sharedPath = path.join(epDir, 'shared.tsx');
  const shotsDir = path.join(epDir, 'shots');

  const barrelExists = fs.existsSync(barrelPath);
  const barrelRaw = barrelExists ? fs.readFileSync(barrelPath, 'utf8') : '';
  const hasShotsDir = fs.existsSync(shotsDir) && fs.statSync(shotsDir).isDirectory();
  const hasSharedFile = fs.existsSync(sharedPath) && fs.statSync(sharedPath).isFile();

  // Modular mode applies whenever `shots/` or `shared.tsx` is present AND `shots.tsx` wasn't manually overwritten with monolithic shots.
  const barrelLooksMonolithic =
    barrelExists &&
    /export\s+(?:const|function)\s+S\d+\b/.test(barrelRaw) &&
    !/from\s+['"]\.\/shots\//.test(barrelRaw);
  const isModular = (hasShotsDir || hasSharedFile) && !barrelLooksMonolithic;

  if (!isModular) {
    const latestMtimeMs = safeMtimeMs(barrelPath);
    const shotMtimesMs = new Map<string, number>();
    if (!barrelExists) {
      return {
        isModular: false,
        exists: false,
        isPlaceholder: false,
        sharedSource: '',
        helpersMap: new Map(),
        shotFiles: new Map(),
        shotBodies: {},
        exportedShotIds: [],
        combinedSource: '',
        latestMtimeMs: 0,
        shotMtimesMs,
      };
    }
    const isPlaceholder = barrelRaw.includes('SHOT S1 — PLACEHOLDER');
    const sliced = sliceMonolithicShots(barrelRaw);
    for (const id of sliced.exportedShotIds) shotMtimesMs.set(id, latestMtimeMs);
    return {
      isModular: false,
      exists: true,
      isPlaceholder,
      sharedSource: sliced.header,
      helpersMap: sliced.helpersMap,
      shotFiles: new Map(),
      shotBodies: sliced.shotBodies,
      exportedShotIds: sliced.exportedShotIds,
      combinedSource: barrelRaw,
      latestMtimeMs,
      shotMtimesMs,
    };
  }

  // Modular episode (`shared.tsx` + `shots/S*.tsx` + barrel `shots.tsx`)
  const sharedSource = hasSharedFile ? fs.readFileSync(sharedPath, 'utf8') : '';
  const sharedSliced = sharedSource ? sliceMonolithicShots(sharedSource) : null;
  const helpersMap = new Map<string, string>(sharedSliced?.helpersMap ?? []);
  const shotFiles = new Map<string, string>();
  const shotBodies: Record<string, string> = {};
  const shotMtimesMs = new Map<string, number>();
  let latestMtimeMs = Math.max(safeMtimeMs(barrelPath), safeMtimeMs(sharedPath));

  if (hasShotsDir) {
    const entries = fs
      .readdirSync(shotsDir)
      .filter((f) => /^S\d+\.tsx$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const fname of entries) {
      const id = fname.replace(/\.tsx$/i, '').toUpperCase();
      const fpath = path.join(shotsDir, fname);
      const raw = fs.readFileSync(fpath, 'utf8');
      const mtime = safeMtimeMs(fpath);
      if (mtime > latestMtimeMs) latestMtimeMs = mtime;
      shotMtimesMs.set(id, mtime);
      shotFiles.set(id, raw);
      // Strip import lines for the shot body so audits/metrics inspect clean executable shot + local helper code
      const withoutImports = raw.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '').trim();
      shotBodies[id] = withoutImports || raw;
    }
  }

  const exportedShotIds = sortShotIds(
    [...shotFiles.entries()]
      .filter(([id, code]) => new RegExp(`export\\s+(?:const|function)\\s+${id}\\b`).test(code))
      .map(([id]) => id),
  );
  const isPlaceholder =
    exportedShotIds.length <= 1 &&
    (barrelRaw.includes('SHOT S1 — PLACEHOLDER') || (shotFiles.get('S1') ?? '').includes('SHOT S1 — PLACEHOLDER'));

  const combinedParts: string[] = [];
  if (sharedSource.trim()) combinedParts.push(sharedSource.trim());
  for (const id of exportedShotIds) {
    const body = shotBodies[id];
    if (body) combinedParts.push(body);
  }

  return {
    isModular: true,
    exists: barrelExists || hasSharedFile || shotFiles.size > 0,
    isPlaceholder,
    sharedSource,
    helpersMap,
    shotFiles,
    shotBodies,
    exportedShotIds,
    combinedSource: combinedParts.join('\n\n'),
    latestMtimeMs,
    shotMtimesMs,
  };
}

/** Normalize lowercase `<shot ...>` JSX tags to `<Shot ...>` and ensure `Shot` is imported alongside `shot`. */
export function normalizeShotTagJsx(code: string): string {
  if (!/<shot(?=[\s/>])/.test(code)) return code;
  let out = code.replace(/<shot(?=[\s/>])/g, '<Shot').replace(/<\/shot\s*>/g, '</Shot>');
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*(['"](?:\.\.\/)+engine['"])/,
    (full, names: string, mod: string) => {
      if (/\bShot\b/.test(names)) return full;
      return `import {${names.replace(/\bshot\b/, 'shot, Shot')}} from ${mod}`;
    },
  );
  return out;
}

/**
 * Normalize `src/episodes/<slug>/shared.tsx`:
 * - fixes accidental `../../../engine` back to `../../engine`,
 * - auto-exports top-level `const` / `let` / `function` / `type` / `interface` declarations so `shots/S<N>.tsx`
 *   and `shots.tsx` (`export * from './shared'`) can import every shared place, cast member, and helper without
 *   TypeScript errors if the model forgot `export`.
 */
export function normalizeSharedEpisodeFile(rawCode: string): string {
  let code = normalizeShotTagJsx(rawCode).replace(/from\s+(['"])\.\.\/\.\.\/\.\.\/engine\1/g, "from '../../engine'");
  const sf = ts.createSourceFile('shared.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inserts: number[] = [];
  for (const stmt of sf.statements) {
    if (isExportedStmt(stmt)) continue;
    if (
      ts.isVariableStatement(stmt) ||
      (ts.isFunctionDeclaration(stmt) && stmt.name) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt)
    ) {
      inserts.push(stmt.getStart(sf));
    }
  }
  for (let i = inserts.length - 1; i >= 0; i--) {
    const at = inserts[i]!;
    code = code.slice(0, at) + 'export ' + code.slice(at);
  }
  return code.endsWith('\n') ? code : code + '\n';
}

/**
 * Prepare an isolated `src/episodes/<slug>/shots/S<N>.tsx` file:
 * - fixes relative import paths (`../../engine` -> `../../../engine`, `./shared` -> `../shared`),
 * - normalizes `<shot>` JSX tags to `<Shot>`,
 * - automatically injects missing `React`, `'../../../engine'`, and `'../shared'` imports so `edit_shot` works
 *   even when the agent sends just `export const S7 = shot({ place: SALON, people: [{ who: LEA, ... }] });`!
 */
export function prepareModularShotFile(projectRoot: string, epDir: string, id: string, rawCode: string): string {
  let code = rawCode
    .trim()
    .replace(/from\s+(['"])\.\.\/\.\.\/engine\1/g, "from '../../../engine'")
    .replace(/from\s+(['"])\.\/shared\1/g, "from '../shared'");
  code = normalizeShotTagJsx(code);

  const sf = ts.createSourceFile(`${id}.tsx`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const importedNames = new Set<string>();
  const localDeclared = new Set<string>();
  let hasReactImport = false;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const cl = stmt.importClause;
      if (cl.name) {
        importedNames.add(cl.name.text);
        if (cl.name.text === 'React') hasReactImport = true;
      }
      if (cl.namedBindings) {
        if (ts.isNamespaceImport(cl.namedBindings)) {
          importedNames.add(cl.namedBindings.name.text);
          if (cl.namedBindings.name.text === 'React') hasReactImport = true;
        } else if (ts.isNamedImports(cl.namedBindings)) {
          for (const el of cl.namedBindings.elements) importedNames.add(el.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      localDeclared.add(stmt.name.text);
    } else if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
      localDeclared.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) localDeclared.add(d.name.text);
      }
    }
  }

  // Collect all identifier tokens used in value or type positions (excluding object property keys `foo: ...` and property accesses `.foo`)
  const usedIds = new Set<string>();
  let usesJsx = false;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) usesJsx = true;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropName =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node);
      if (!isPropName) usedIds.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const sharedPath = path.join(epDir, 'shared.tsx');
  const sharedExports = new Set<string>(
    fs.existsSync(sharedPath) ? exportedSymbols(fs.readFileSync(sharedPath, 'utf8')) : [],
  );
  const engineExports = discoverEngineExports(projectRoot);

  const needEngine: string[] = [];
  const needShared: string[] = [];
  for (const sym of usedIds) {
    if (importedNames.has(sym) || localDeclared.has(sym)) continue;
    if (sharedExports.has(sym)) needShared.push(sym);
    else if (engineExports.has(sym)) needEngine.push(sym);
  }

  const autoImports: string[] = [];
  if (!hasReactImport && (usesJsx || usedIds.has('React'))) {
    autoImports.push(`import React from 'react';`);
  }
  if (needEngine.length) {
    autoImports.push(`import { ${needEngine.sort().join(', ')} } from '../../../engine';`);
  }
  if (needShared.length) {
    autoImports.push(`import { ${needShared.sort().join(', ')} } from '../shared';`);
  }

  const full = autoImports.length ? `${autoImports.join('\n')}\n\n${code}\n` : `${code}\n`;
  return full;
}

/**
 * Rebuild `src/episodes/<slug>/shots.tsx` as a clean barrel re-exporting `./shared` and every `./shots/S<N>`,
 * and keep `src/episodes/<slug>/index.tsx` shot registrations synchronized when `index.tsx` uses the standard
 * `defineEpisode(..., { shots: { ... } })` shape.
 */
export function syncShotsBarrel(epDir: string): string[] {
  const sharedPath = path.join(epDir, 'shared.tsx');
  const shotsDir = path.join(epDir, 'shots');
  const barrelPath = path.join(epDir, 'shots.tsx');

  const hasShared = fs.existsSync(sharedPath);
  const shotIds: string[] = [];
  let maxSourceMtime = hasShared ? safeMtimeMs(sharedPath) : 0;

  if (fs.existsSync(shotsDir)) {
    for (const fname of fs.readdirSync(shotsDir)) {
      const m = /^(S\d+)\.tsx$/i.exec(fname);
      if (!m) continue;
      const id = m[1]!.toUpperCase();
      const fpath = path.join(shotsDir, fname);
      const code = fs.readFileSync(fpath, 'utf8');
      if (new RegExp(`export\\s+(?:const|function)\\s+${id}\\b`).test(code)) {
        shotIds.push(id);
        const mt = safeMtimeMs(fpath);
        if (mt > maxSourceMtime) maxSourceMtime = mt;
      }
    }
  }
  const sorted = sortShotIds(shotIds);
  const lines: string[] = [
    '// Auto-generated barrel — edit shared.tsx or individual shots via edit_shot (shots/S<N>.tsx)',
  ];
  if (hasShared) lines.push(`export * from './shared';`);
  for (const id of sorted) lines.push(`export { ${id} } from './shots/${id}';`);
  fs.writeFileSync(barrelPath, lines.join('\n') + '\n', 'utf8');
  if (maxSourceMtime > 0) {
    try {
      const sec = maxSourceMtime / 1000;
      fs.utimesSync(barrelPath, sec, sec);
    } catch {
      /* ignore utimes failure */
    }
  }

  // Keep index.tsx shot imports & registrations aligned when index.tsx has the standard defineEpisode pattern
  const indexPath = path.join(epDir, 'index.tsx');
  if (sorted.length > 0 && fs.existsSync(indexPath)) {
    try {
      const idxRaw = fs.readFileSync(indexPath, 'utf8');
      if (/import\s*\{[^}]*\}\s*from\s*['"]\.\/shots['"]/.test(idxRaw) && /\bshots\s*:\s*\{[^}]*\}/.test(idxRaw)) {
        const list = sorted.join(', ');
        const updated = idxRaw
          .replace(/import\s*\{[^}]*\}\s*from\s*(['"]\.\/shots['"])/, `import { ${list} } from $1`)
          .replace(/\bshots\s*:\s*\{[^}]*\}/, `shots: { ${list} }`);
        if (updated !== idxRaw) fs.writeFileSync(indexPath, updated, 'utf8');
      }
    } catch {
      /* ignore index sync errors */
    }
  }

  return sorted;
}

/**
 * AST-safe replacement of a single shot `id` inside a legacy monolithic `shots.tsx`.
 * - Replaces `export const S<N> = ...` (plus any immediately preceding non-exported helper declarations
 *   that belong exclusively to `S<N>` or are redefined in `code`),
 * - NEVER deletes non-exported helper declarations immediately above `S<N+1>` (such as `BEFORE_PULL` / `AFTER_PULL`),
 * - Preserves comment lines introducing neighboring shots.
 */
export function replaceShotMonolithic(src: string, id: string, code: string): { text: string; replaced: boolean } {
  const block = code.trim();
  const sf = ts.createSourceFile('shots.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const codeSf = ts.createSourceFile('patch.tsx', block, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const redefinedInPatch = new Set<string>();
  for (const st of codeSf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) redefinedInPatch.add(st.name.text);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) redefinedInPatch.add(d.name.text);
      }
    }
  }

  let targetIdx = -1;
  for (let i = 0; i < sf.statements.length; i++) {
    const stmt = sf.statements[i]!;
    if (!isExportedStmt(stmt)) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === id) {
      targetIdx = i;
      break;
    }
    if (ts.isVariableStatement(stmt)) {
      if (stmt.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === id)) {
        targetIdx = i;
        break;
      }
    }
  }

  if (targetIdx < 0) {
    return { text: src + (src.endsWith('\n') || !src ? '' : '\n') + '\n' + block + '\n', replaced: false };
  }

  const targetStmt = sf.statements[targetIdx]!;
  let replaceStart = targetStmt.getStart(sf);
  const replaceEnd = targetStmt.end;

  // Walk immediately preceding non-exported helper statements that belong ONLY to this shot or are redefined in `code`
  const otherStatementsText = sf.statements
    .filter((_, idx) => idx !== targetIdx)
    .map((s) => s.getText(sf))
    .join('\n');
  const targetText = targetStmt.getText(sf);

  for (let k = targetIdx - 1; k >= 0; k--) {
    const prev = sf.statements[k]!;
    if (isExportedStmt(prev) || ts.isImportDeclaration(prev)) break;
    const names: string[] = [];
    if (ts.isFunctionDeclaration(prev) && prev.name) names.push(prev.name.text);
    else if (ts.isVariableStatement(prev)) {
      for (const d of prev.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    }
    if (!names.length) break;
    const belongsHere = names.every((n) => {
      if (redefinedInPatch.has(n)) return true;
      const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const usedInTarget = re.test(targetText);
      const restWithoutPrev = sf.statements
        .filter((_, idx) => idx !== targetIdx && idx !== k)
        .map((s) => s.getText(sf))
        .join('\n');
      return usedInTarget && !re.test(restWithoutPrev) && /^[A-Z]/.test(n);
    });
    if (!belongsHere) break;
    void otherStatementsText;
    replaceStart = prev.getStart(sf);
  }

  const nextChar = src[replaceEnd];
  const needsNewline = nextChar !== '\n' && nextChar !== '\r';
  const out = src.slice(0, replaceStart) + block + (needsNewline ? '\n' : '') + src.slice(replaceEnd);
  return { text: out, replaced: true };
}
