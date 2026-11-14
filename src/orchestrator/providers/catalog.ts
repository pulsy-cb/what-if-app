import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProviderDriver = 'openai' | 'anthropic' | 'codex' | 'agy' | 'mock';

export type CatalogModelSpec = {
  id: string;
  label: string;
  supportsVision?: boolean;
};

export type ResolvedCatalogProvider = {
  id: string;
  label: string;
  driver: ProviderDriver;
  baseURL: string;
  apiKey: string;
  hasKey: boolean;
  model: string;
  reviewModel: string;
  maxTokens?: number;
  models: CatalogModelSpec[];
  discoverModels: boolean;
  sourceFile: string;
};

export type LoadedProvidersCatalog = {
  files: string[];
  signature: string;
  defaultProvider: string;
  defaultModel: string;
  defaultReviewProvider: string;
  defaultReviewModel: string;
  providers: Record<string, ResolvedCatalogProvider>;
  errors: string[];
};

export type ProvidersCatalogPublicSummary = {
  loaded: boolean;
  files: string[];
  providerIds: string[];
  defaultProvider: string | null;
  defaultReviewProvider: string | null;
  errors: string[];
};

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IS_NODE_TEST_RUNNER = process.execArgv.includes('--test') || process.env.NODE_ENV === 'test';

const MULTIMODAL_MODEL_HINT_RE =
  /(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-6|o1|o3|o4|claude-3|claude-sonnet|claude-opus|claude-haiku-4|gemini|pixtral|vision|-vl\b|vl-|qwen2\.5-vl|qwen3-vl|kimi-k2\.5|kimi-k3|glm-4v|glm-5|llama-3\.2-(11|90)b|llama-4)/i;

type CachedRawFile = {
  mtimeMs: number;
  size: number;
  parsed: Record<string, unknown> | null;
  error: string | null;
};

const parsedFileCache = new Map<string, CachedRawFile>();

export function clearProvidersCatalogCache(): void {
  parsedFileCache.clear();
}

/**
 * Strip `//` line comments, `/* ... *\/` block comments, and trailing commas outside JSON strings
 * so hand-edited `providers.json` files stay forgiving without corrupting URLs like `"https://..."`.
 */
export function stripJsonCommentsAndTrailingCommas(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  const n = raw.length;

  for (let i = 0; i < n; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    // Single-line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && raw[i] !== '\n') i++;
      if (i < n) out += '\n';
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(raw[i] === '*' && raw[i + 1] === '/')) {
        if (raw[i] === '\n') out += '\n';
        i++;
      }
      i++; // skip closing '/'
      continue;
    }

    out += ch;
  }

  // Second pass: remove trailing commas before `}` or `]` outside strings
  let clean = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    if (inString) {
      clean += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      clean += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j]!)) j++;
      if (out[j] === '}' || out[j] === ']') {
        continue;
      }
    }
    clean += ch;
  }
  return clean;
}

function readParsedCatalogFile(absPath: string): { parsed: Record<string, unknown> | null; error: string | null; sig: string } {
  let st: fs.Stats;
  try {
    st = fs.statSync(absPath);
  } catch {
    parsedFileCache.delete(absPath);
    return { parsed: null, error: null, sig: '' };
  }
  if (!st.isFile()) {
    return { parsed: null, error: null, sig: '' };
  }

  const sig = `${absPath}:${st.mtimeMs}:${st.size}`;
  const cached = parsedFileCache.get(absPath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return { parsed: cached.parsed, error: cached.error, sig };
  }

  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    if (!raw.trim()) {
      const entry: CachedRawFile = { mtimeMs: st.mtimeMs, size: st.size, parsed: {}, error: null };
      parsedFileCache.set(absPath, entry);
      return { parsed: {}, error: null, sig };
    }
    const stripped = stripJsonCommentsAndTrailingCommas(raw);
    const json = JSON.parse(stripped);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      const err = `${path.basename(absPath)} doit contenir un objet JSON racine { "providers": { ... } }`;
      parsedFileCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, parsed: null, error: err });
      return { parsed: null, error: err, sig };
    }
    parsedFileCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, parsed: json as Record<string, unknown>, error: null });
    return { parsed: json as Record<string, unknown>, error: null, sig };
  } catch (err: any) {
    const msg = `${path.basename(absPath)}: ${err?.message || String(err)}`;
    parsedFileCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, parsed: null, error: msg });
    return { parsed: null, error: msg, sig };
  }
}

export function resolveCatalogFilePaths(env: NodeJS.ProcessEnv = process.env, dataRoot?: string): string[] {
  if ('WHATIF_PROVIDERS_FILE' in env) {
    const explicit = (env.WHATIF_PROVIDERS_FILE ?? '').trim();
    return explicit ? [path.resolve(explicit)] : [];
  }

  const candidates: string[] = [];
  if (!IS_NODE_TEST_RUNNER) {
    candidates.push(path.join(PACKAGE_ROOT, 'providers.json'));
  }
  const effDataRoot = (dataRoot || env.WHATIF_DATA || '').trim();
  if (effDataRoot) {
    candidates.push(path.join(path.resolve(effDataRoot), 'providers.json'));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (!seen.has(abs)) {
      seen.add(abs);
      unique.push(abs);
    }
  }
  return unique;
}

function resolveSecretValue(rawKey: unknown, rawEnvName: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof rawEnvName === 'string' && rawEnvName.trim()) {
    const v = env[rawEnvName.trim()];
    if (v && v.trim()) return v.trim();
  }
  if (typeof rawKey !== 'string') return '';
  const trimmed = rawKey.trim();
  if (!trimmed) return '';

  // Support "$VAR_NAME" or "${VAR_NAME}"
  const envMatch = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(trimmed);
  if (envMatch) {
    return (env[envMatch[1]!] ?? '').trim();
  }
  return trimmed;
}

function normalizeDriver(id: string, rawDriver: unknown, baseURL: string): ProviderDriver {
  const clean = typeof rawDriver === 'string' ? rawDriver.trim().toLowerCase() : '';
  if (clean === 'anthropic' || clean === 'claude') return 'anthropic';
  if (clean === 'codex') return 'codex';
  if (clean === 'agy' || clean === 'antigravity') return 'agy';
  if (clean === 'mock') return 'mock';
  if (clean === 'openai' || clean === 'openai-compatible' || clean === 'openrouter') return 'openai';

  const idLow = id.toLowerCase();
  if (idLow === 'anthropic' || /anthropic\.com/i.test(baseURL)) return 'anthropic';
  if (idLow === 'codex') return 'codex';
  if (idLow === 'agy') return 'agy';
  if (idLow === 'mock') return 'mock';
  return 'openai';
}

function defaultBaseUrlForDriver(id: string, driver: ProviderDriver): string {
  if (driver === 'agy' || driver === 'mock') return '';
  if (driver === 'codex') return 'https://chatgpt.com/backend-api/codex';
  if (driver === 'anthropic') return 'https://api.anthropic.com';
  const idLow = id.toLowerCase();
  if (idLow.includes('openrouter')) return 'https://openrouter.ai/api/v1';
  if (idLow.includes('deepseek')) return 'https://api.deepseek.com/v1';
  if (idLow.includes('groq')) return 'https://api.groq.com/openai/v1';
  if (idLow.includes('mistral')) return 'https://api.mistral.ai/v1';
  if (idLow.includes('google') || idLow.includes('gemini')) {
    return 'https://generativelanguage.googleapis.com/v1beta/openai';
  }
  if (idLow === 'local' || idLow.includes('ollama')) return 'http://127.0.0.1:11434/v1';
  return 'https://api.openai.com/v1';
}

function hostOf(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').split('/')[0] ?? rawUrl;
  }
}

function normalizeModelsList(rawModels: unknown): CatalogModelSpec[] {
  if (!Array.isArray(rawModels)) return [];
  const seen = new Set<string>();
  const out: CatalogModelSpec[] = [];
  for (const item of rawModels) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: id,
        supportsVision: true,
      });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id = String(obj.id ?? obj.slug ?? obj.model ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim() : id;
      const supportsVision =
        typeof obj.supportsVision === 'boolean'
          ? obj.supportsVision
          : typeof obj.vision === 'boolean'
            ? obj.vision
            : true;
      out.push({ id, label, supportsVision });
    }
  }
  return out;
}

function parseProviderEntry(
  rawId: string,
  rawEntry: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  sourceFile: string,
): ResolvedCatalogProvider | null {
  const id = rawId.trim();
  if (!id || id.startsWith('_')) return null;
  if (rawEntry.enabled === false) return null;

  const rawBase = typeof rawEntry.baseURL === 'string' ? rawEntry.baseURL.trim() : typeof rawEntry.baseUrl === 'string' ? rawEntry.baseUrl.trim() : '';
  const driver = normalizeDriver(id, rawEntry.driver ?? rawEntry.kind ?? rawEntry.type, rawBase);
  const baseURL = rawBase || defaultBaseUrlForDriver(id, driver);
  const apiKey = resolveSecretValue(rawEntry.apiKey, rawEntry.apiKeyEnv, env);
  const models = normalizeModelsList(rawEntry.models);

  const explicitModel = String(rawEntry.defaultModel ?? rawEntry.model ?? '').trim();
  const model = explicitModel || models[0]?.id || (driver === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1');

  const explicitRevModel = String(rawEntry.reviewModel ?? rawEntry.defaultReviewModel ?? '').trim();
  const reviewModel = explicitRevModel || model;

  // Ensure default model & reviewModel are always selectable in the dropdown even if omitted from `models`
  const mergedModels = [...models];
  const existingIds = new Set(mergedModels.map((m) => m.id));
  if (explicitModel && !existingIds.has(explicitModel)) {
    mergedModels.unshift({
      id: explicitModel,
      label: explicitModel,
      supportsVision: true,
    });
    existingIds.add(explicitModel);
  }
  if (explicitRevModel && !existingIds.has(explicitRevModel)) {
    mergedModels.push({
      id: explicitRevModel,
      label: explicitRevModel,
      supportsVision: true,
    });
    existingIds.add(explicitRevModel);
  }

  const rawLabel = typeof rawEntry.label === 'string' ? rawEntry.label.trim() : typeof rawEntry.name === 'string' ? rawEntry.name.trim() : '';
  const host = hostOf(baseURL);
  const label = rawLabel || `${id}${host ? ` (${host})` : ''}`;

  const maxTokensNum = Number(rawEntry.maxTokens);
  const maxTokens = Number.isFinite(maxTokensNum) && maxTokensNum > 0 ? Math.round(maxTokensNum) : undefined;

  const discoverModels =
    typeof rawEntry.discoverModels === 'boolean' ? rawEntry.discoverModels : mergedModels.length === 0;

  return {
    id,
    label,
    driver,
    baseURL,
    apiKey,
    hasKey: Boolean(apiKey) || driver === 'codex' || driver === 'agy' || driver === 'mock' || /127\.0\.0\.1|localhost/.test(baseURL),
    model,
    reviewModel,
    ...(maxTokens ? { maxTokens } : {}),
    models: mergedModels,
    discoverModels,
    sourceFile,
  };
}

export function loadProvidersCatalog(env: NodeJS.ProcessEnv = process.env, dataRoot?: string): LoadedProvidersCatalog {
  const candidates = resolveCatalogFilePaths(env, dataRoot);
  const files: string[] = [];
  const sigParts: string[] = [];
  const providers: Record<string, ResolvedCatalogProvider> = {};
  const errors: string[] = [];
  let defaultProvider = '';
  let defaultModel = '';
  let defaultReviewProvider = '';
  let defaultReviewModel = '';

  for (const filePath of candidates) {
    const { parsed, error, sig } = readParsedCatalogFile(filePath);
    if (sig) sigParts.push(sig);
    if (error) {
      errors.push(error);
      continue;
    }
    if (!parsed) continue;
    files.push(filePath);

    if (typeof parsed.defaultProvider === 'string' && parsed.defaultProvider.trim()) {
      defaultProvider = parsed.defaultProvider.trim();
    }
    if (typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim()) {
      defaultModel = parsed.defaultModel.trim();
    }
    if (typeof parsed.defaultReviewProvider === 'string' && parsed.defaultReviewProvider.trim()) {
      defaultReviewProvider = parsed.defaultReviewProvider.trim();
    }
    if (typeof parsed.defaultReviewModel === 'string' && parsed.defaultReviewModel.trim()) {
      defaultReviewModel = parsed.defaultReviewModel.trim();
    }

    const rawProviders = parsed.providers;
    if (Array.isArray(rawProviders)) {
      for (const item of rawProviders) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const id = String(obj.id ?? obj.slug ?? '').trim();
        if (!id) continue;
        const resolved = parseProviderEntry(id, obj, env, filePath);
        if (resolved) providers[resolved.id] = resolved;
      }
    } else if (rawProviders && typeof rawProviders === 'object') {
      for (const [id, item] of Object.entries(rawProviders as Record<string, unknown>)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const resolved = parseProviderEntry(id, item as Record<string, unknown>, env, filePath);
        if (resolved) providers[resolved.id] = resolved;
      }
    }
  }

  return {
    files,
    signature: sigParts.join(';') || 'none',
    defaultProvider,
    defaultModel,
    defaultReviewProvider,
    defaultReviewModel,
    providers,
    errors,
  };
}

export function getProvidersCatalogSummary(
  env: NodeJS.ProcessEnv = process.env,
  dataRoot?: string,
): ProvidersCatalogPublicSummary {
  const cat = loadProvidersCatalog(env, dataRoot);
  return {
    loaded: cat.files.length > 0,
    files: cat.files.map((f) => path.basename(f)),
    providerIds: Object.keys(cat.providers),
    defaultProvider: cat.defaultProvider || null,
    defaultReviewProvider: cat.defaultReviewProvider || null,
    errors: cat.errors,
  };
}
