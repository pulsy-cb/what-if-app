import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import { listAgyModels } from './agy.js';
import { loadProvidersCatalog } from './catalog.js';
import { CODEX_DEFAULT_BASE_URL, defaultCodexAuthPath, hasCodexAuth, isAllowedCodexBase, loadValidCodexAuth } from './codex.js';
import { getEnvProviderSummary, getProviderPresets } from './index.js';

export type DiscoveredModel = {
  id: string;
  label: string;
  supportsVision?: boolean;
};

export type ModelDiscoveryResult = {
  provider: string;
  source: 'live' | 'config_file' | 'cache_file' | 'env_fallback' | 'preset_fallback' | 'empty';
  models: DiscoveredModel[];
  defaultAgentModel: string;
  defaultReviewerModel: string;
  error: string | null;
};

type CacheEntry = {
  expiresAt: number;
  value: ModelDiscoveryResult;
};

const CACHE_TTL_MS = 60_000;
const discoveryCache = new Map<string, CacheEntry>();

export function clearModelDiscoveryCache(): void {
  discoveryCache.clear();
}

const NON_CHAT_MODEL_RE =
  /^(text-embedding|embedding-|whisper|tts-|dall-e|gpt-image|omni-moderation|text-moderation|babbage-|davinci-|canary-tts|rerank)/i;

export function parseCodexModelsPayload(payload: unknown): DiscoveredModel[] {
  const rawList = Array.isArray((payload as any)?.models)
    ? (payload as any).models
    : Array.isArray((payload as any)?.data)
      ? (payload as any).data
      : Array.isArray(payload)
        ? payload
        : [];
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    if (item.visibility === 'hide' || item.supported_in_api === false) continue;
    const id = String(item.slug ?? item.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = String(item.display_name ?? item.name ?? id).trim();
    const supportsVision = !Array.isArray(item.input_modalities) || item.input_modalities.includes('image');
    out.push({ id, label, supportsVision });
  }
  return out;
}

export function parseOpenAIModelsPayload(payload: unknown): DiscoveredModel[] {
  const rawList = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray((payload as any)?.models)
      ? (payload as any).models
      : Array.isArray(payload)
        ? payload
        : [];
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const id = typeof item === 'string' ? item.trim() : String(item?.id ?? item?.slug ?? item?.name ?? '').trim();
    if (!id || seen.has(id)) continue;
    if (NON_CHAT_MODEL_RE.test(id)) continue;
    seen.add(id);
    const display =
      typeof item === 'object' && item !== null
        ? String(item.display_name ?? item.name ?? id).trim()
        : id;
    out.push({ id, label: display || id });
  }
  return out;
}

export function parseAnthropicModelsPayload(payload: unknown): DiscoveredModel[] {
  const rawList = Array.isArray((payload as any)?.data) ? (payload as any).data : [];
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const id = String(item?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = String(item?.display_name ?? id).trim();
    out.push({ id, label: label || id, supportsVision: true });
  }
  return out;
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 6_000,
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        json: parsed,
        error: `HTTP ${res.status} sur ${url}${text ? `: ${text.slice(0, 180)}` : ''}`,
      };
    }
    return { ok: true, status: res.status, json: parsed };
  } catch (err: any) {
    return { ok: false, status: 0, json: null, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function readCodexCacheFile(authPath: string): DiscoveredModel[] {
  const cachePath = path.join(path.dirname(authPath), 'models_cache.json');
  try {
    if (!fs.existsSync(cachePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parseCodexModelsPayload(parsed);
  } catch {
    return [];
  }
}

function pickPreferred(models: DiscoveredModel[], candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const clean = String(c ?? '').trim();
    if (!clean) continue;
    if (models.some((m) => m.id === clean)) return clean;
  }
  return models[0]?.id ?? String(candidates.find((c) => c && c.trim()) ?? '');
}

function sameUrlOrigin(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  }
}

export async function discoverProviderModels(
  db: Db,
  opts?: {
    provider?: string;
    baseURL?: string;
    apiKey?: string;
    forceRefresh?: boolean;
    env?: NodeJS.ProcessEnv;
    agyBin?: string;
    codexAuthPath?: string;
  },
): Promise<ModelDiscoveryResult> {
  const env = opts?.env ?? process.env;
  const s = db.settings();
  const catalog = loadProvidersCatalog(env, db.dataRoot);
  const presets = getProviderPresets(env, db.dataRoot);
  const envSummary = getEnvProviderSummary(env);
  const provider = String(
    opts?.provider ||
      s.provider ||
      catalog.defaultProvider ||
      (envSummary.available ? 'env' : env.WHATIF_PROVIDER) ||
      'mock',
  ).trim();
  const preset = presets[provider] ?? presets.openai!;
  const catEntry = catalog.providers[provider];
  const effectiveDriver = catEntry
    ? catEntry.driver
    : provider === 'env'
      ? envSummary.underlyingKind
      : provider;

  // Resolve effective baseURL & apiKey for HTTP providers.
  // Security: NEVER send a stored DB/.env/providers.json API key to an unverified caller-supplied baseURL override!
  const callerBaseURL = (opts?.baseURL ?? '').trim();
  const callerApiKey = (opts?.apiKey ?? '').trim();
  let effectiveBaseURL = callerBaseURL;
  let effectiveApiKey = callerApiKey;

  if (catEntry) {
    const configuredBase = catEntry.baseURL || (provider === s.provider ? s.baseURL || '' : '');
    if (!effectiveBaseURL) effectiveBaseURL = configuredBase;
    const isTrustedOverride = !callerBaseURL || sameUrlOrigin(callerBaseURL, configuredBase);
    if (!effectiveApiKey && isTrustedOverride) {
      effectiveApiKey = catEntry.apiKey || (provider === s.provider ? s.apiKey || '' : '');
    }
  } else if (provider === 'env') {
    const trustedBase = envSummary.baseURL;
    effectiveBaseURL = callerBaseURL || trustedBase;
    if (!effectiveApiKey && (!callerBaseURL || sameUrlOrigin(callerBaseURL, trustedBase))) {
      effectiveApiKey = (env.WHATIF_API_KEY ?? '').trim();
    }
  } else if (provider !== 'agy' && provider !== 'codex' && provider !== 'mock') {
    const matchesEnvProvider = provider === (env.WHATIF_PROVIDER || '').trim();
    const configuredBase =
      (provider === s.provider ? s.baseURL : '') ||
      (matchesEnvProvider ? env.WHATIF_BASE_URL || '' : '') ||
      preset.baseURL;
    if (!effectiveBaseURL) {
      effectiveBaseURL = configuredBase;
    }
    const isTrustedOverride =
      !callerBaseURL ||
      sameUrlOrigin(callerBaseURL, configuredBase) ||
      sameUrlOrigin(callerBaseURL, preset.baseURL);
    if (!effectiveApiKey && isTrustedOverride) {
      effectiveApiKey =
        (provider === s.provider ? s.apiKey || '' : '') ||
        (matchesEnvProvider ? env.WHATIF_API_KEY || '' : '');
    }
  }

  const keyHash = effectiveApiKey
    ? crypto.createHash('sha1').update(effectiveApiKey).digest('hex').slice(0, 10)
    : 'nokey';
  const cacheKey = `${provider}|${effectiveBaseURL}|${keyHash}|${catalog.signature}`;
  if (!opts?.forceRefresh) {
    const cached = discoveryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  const saveCache = (res: ModelDiscoveryResult): ModelDiscoveryResult => {
    discoveryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: res });
    return res;
  };

  // Fast path: explicit model list in `providers.json` with `discoverModels: false` (default when `models` is provided)
  if (catEntry && catEntry.models.length > 0 && !catEntry.discoverModels) {
    const defaultAgentModel = pickPreferred(catEntry.models, [
      provider === s.provider ? s.model : null,
      catEntry.model,
    ]);
    const defaultReviewerModel = pickPreferred(catEntry.models, [
      provider === s.reviewProvider ? s.reviewModel : null,
      catEntry.reviewModel,
      catEntry.model,
    ]);
    return saveCache({
      provider,
      source: 'config_file',
      models: catEntry.models,
      defaultAgentModel,
      defaultReviewerModel,
      error: null,
    });
  }

  if (effectiveDriver === 'mock') {
    return saveCache({
      provider,
      source: 'preset_fallback',
      models: catEntry?.models.length ? catEntry.models : [{ id: 'mock', label: 'mock (test local)' }],
      defaultAgentModel: catEntry?.model || 'mock',
      defaultReviewerModel: catEntry?.reviewModel || 'mock',
      error: null,
    });
  }

  // 1. Google Antigravity CLI (`agy models`)
  if (effectiveDriver === 'agy') {
    const { models, error } = await listAgyModels({ agyBin: opts?.agyBin, env });
    if (models.length > 0) {
      const defaultAgentModel = pickPreferred(models, [
        s.provider === 'agy' ? s.model : null,
        'gemini-3.8-flash-medium',
        'gemini-3.8-flash-high',
        'claude-sonnet-4-6',
      ]);
      const defaultReviewerModel = pickPreferred(models, [
        s.reviewProvider === 'agy' ? s.reviewModel : null,
        'claude-sonnet-4-6',
        'gemini-3.8-flash-high',
        'gemini-3.8-flash-medium',
      ]);
      return saveCache({
        provider,
        source: 'live',
        models: models.map((m) => ({ ...m, supportsVision: true })),
        defaultAgentModel,
        defaultReviewerModel,
        error: null,
      });
    }
    return saveCache({
      provider,
      source: 'empty',
      models: [],
      defaultAgentModel: preset.model,
      defaultReviewerModel: preset.reviewModel ?? preset.model,
      error: error ?? 'Aucun modèle retourné par « agy models »',
    });
  }

  // 2. ChatGPT / Codex subscription OAuth (`/codex/models` + `~/.codex/models_cache.json` fallback)
  if (effectiveDriver === 'codex') {
    const authPath = opts?.codexAuthPath || defaultCodexAuthPath();
    const rawBase = (effectiveBaseURL || CODEX_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const base = isAllowedCodexBase(rawBase) ? rawBase : CODEX_DEFAULT_BASE_URL;
    let liveError: string | null = null;

    if (hasCodexAuth(authPath)) {
      try {
        const auth = await loadValidCodexAuth(authPath);
        const url = `${base}/models?client_version=0.164.0`;
        const resp = await fetchJsonWithTimeout(url, {
          authorization: `Bearer ${auth.accessToken}`,
          ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {}),
          originator: 'codex_cli_rs',
        });
        if (resp.ok) {
          const models = parseCodexModelsPayload(resp.json);
          if (models.length > 0) {
            return saveCache({
              provider,
              source: 'live',
              models,
              defaultAgentModel: pickPreferred(models, [
                s.provider === 'codex' ? s.model : null,
                'gpt-6.1-terra',
                'gpt-6-astra',
                'gpt-6-sol',
              ]),
              defaultReviewerModel: pickPreferred(models, [
                s.reviewProvider === 'codex' ? s.reviewModel : null,
                'gpt-6-sol',
                'gpt-6.1-terra',
                'gpt-6-astra',
              ]),
              error: null,
            });
          }
        } else {
          liveError = resp.error ?? 'Échec récupération modèles Codex';
        }
      } catch (err: any) {
        liveError = err?.message || String(err);
      }
    } else {
      liveError = 'Session Codex absente (~/.codex/auth.json)';
    }

    const cachedModels = readCodexCacheFile(authPath);
    if (cachedModels.length > 0) {
      return saveCache({
        provider,
        source: 'cache_file',
        models: cachedModels,
        defaultAgentModel: pickPreferred(cachedModels, ['gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-sol']),
        defaultReviewerModel: pickPreferred(cachedModels, ['gpt-6-sol', 'gpt-6.1-terra', 'gpt-6-astra']),
        error: liveError,
      });
    }

    return saveCache({
      provider,
      source: 'empty',
      models: [],
      defaultAgentModel: preset.model,
      defaultReviewerModel: preset.reviewModel ?? preset.model,
      error: liveError,
    });
  }

  // 3. Anthropic (`/v1/models`)
  if (effectiveDriver === 'anthropic') {
    const base = (effectiveBaseURL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    const pinnedCatModels = catEntry?.models ?? [];
    if (!effectiveApiKey) {
      return saveCache({
        provider,
        source: pinnedCatModels.length > 0 ? 'config_file' : 'empty',
        models: pinnedCatModels,
        defaultAgentModel: pinnedCatModels[0]?.id ?? preset.model,
        defaultReviewerModel: preset.reviewModel ?? pinnedCatModels[0]?.id ?? preset.model,
        error: pinnedCatModels.length > 0 ? null : 'Clé API Anthropic requise pour lister les modèles',
      });
    }
    const resp = await fetchJsonWithTimeout(modelsUrl, {
      'x-api-key': effectiveApiKey,
      'anthropic-version': '2023-06-01',
    });
    const mergedAnthropic = new Map<string, DiscoveredModel>();
    for (const pm of pinnedCatModels) mergedAnthropic.set(pm.id, pm);
    if (resp.ok) {
      for (const m of parseAnthropicModelsPayload(resp.json)) {
        if (!mergedAnthropic.has(m.id)) mergedAnthropic.set(m.id, m);
      }
    }
    const models = [...mergedAnthropic.values()];
    return saveCache({
      provider,
      source: resp.ok && models.length > 0 ? 'live' : pinnedCatModels.length > 0 ? 'config_file' : 'empty',
      models,
      defaultAgentModel: pickPreferred(models, [provider === s.provider ? s.model : null, preset.model]),
      defaultReviewerModel: pickPreferred(models, [
        provider === s.reviewProvider ? s.reviewModel : null,
        preset.reviewModel,
        preset.model,
      ]),
      error: resp.ok ? null : resp.error ?? null,
    });
  }

  // 4. `.env` custom API, `providers.json` (with discoverModels: true), & all OpenAI-compatible providers
  const isLocal = /127\.0\.0\.1|localhost/.test(effectiveBaseURL);
  const pinnedEnvModels: DiscoveredModel[] = [...(catEntry?.models ?? [])];
  const seenPinned = new Set(pinnedEnvModels.map((m) => m.id));
  if (provider === 'env' || provider === (env.WHATIF_PROVIDER || '').trim()) {
    if (env.WHATIF_MODEL?.trim() && !seenPinned.has(env.WHATIF_MODEL.trim())) {
      seenPinned.add(env.WHATIF_MODEL.trim());
      pinnedEnvModels.push({
        id: env.WHATIF_MODEL.trim(),
        label: `${env.WHATIF_MODEL.trim()} (défaut Agent .env)`,
      });
    }
    if (
      env.WHATIF_REVIEW_MODEL?.trim() &&
      env.WHATIF_REVIEW_MODEL.trim() !== env.WHATIF_MODEL?.trim() &&
      !seenPinned.has(env.WHATIF_REVIEW_MODEL.trim())
    ) {
      seenPinned.add(env.WHATIF_REVIEW_MODEL.trim());
      pinnedEnvModels.push({
        id: env.WHATIF_REVIEW_MODEL.trim(),
        label: `${env.WHATIF_REVIEW_MODEL.trim()} (défaut Reviewer .env)`,
      });
    }
  }

  if (!effectiveBaseURL || (!effectiveApiKey && !isLocal && provider !== 'openrouter')) {
    return saveCache({
      provider,
      source: catEntry && pinnedEnvModels.length > 0 ? 'config_file' : pinnedEnvModels.length > 0 ? 'env_fallback' : 'empty',
      models: pinnedEnvModels,
      defaultAgentModel: pinnedEnvModels[0]?.id ?? preset.model,
      defaultReviewerModel: preset.reviewModel ?? pinnedEnvModels[1]?.id ?? pinnedEnvModels[0]?.id ?? preset.model,
      error: !effectiveApiKey ? `Clé API requise pour interroger ${effectiveBaseURL || provider}/models` : null,
    });
  }

  const baseClean = effectiveBaseURL.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (effectiveApiKey) headers.authorization = `Bearer ${effectiveApiKey}`;

  const primaryResp = await fetchJsonWithTimeout(`${baseClean}/models`, headers);
  const merged = new Map<string, DiscoveredModel>();

  // Put `.env` configured defaults at the top with clear badges if applicable
  for (const pm of pinnedEnvModels) {
    merged.set(pm.id, pm);
  }

  if (primaryResp.ok) {
    for (const m of parseOpenAIModelsPayload(primaryResp.json)) {
      if (!merged.has(m.id)) {
        merged.set(m.id, m);
      }
    }
  }

  // If `env` has a separate WHATIF_REVIEW_BASE_URL or WHATIF_REVIEW_API_KEY, query it too so Reviewer models appear!
  if (provider === 'env') {
    const revBase = (env.WHATIF_REVIEW_BASE_URL || env.WHATIF_BASE_URL || '').trim().replace(/\/+$/, '');
    const revKey = (env.WHATIF_REVIEW_API_KEY || env.WHATIF_API_KEY || '').trim();
    if (revBase && (revBase !== baseClean || revKey !== effectiveApiKey)) {
      const revResp = await fetchJsonWithTimeout(`${revBase}/models`, revKey ? { authorization: `Bearer ${revKey}` } : {});
      if (revResp.ok) {
        for (const m of parseOpenAIModelsPayload(revResp.json)) {
          if (!merged.has(m.id)) merged.set(m.id, m);
        }
      }
    }
  }

  const models = [...merged.values()];
  const defaultAgentModel = pickPreferred(models, [
    provider === 'env' ? env.WHATIF_MODEL : null,
    provider === s.provider ? s.model : null,
    preset.model,
  ]);
  const defaultReviewerModel = pickPreferred(models, [
    provider === 'env' ? env.WHATIF_REVIEW_MODEL || env.WHATIF_MODEL : null,
    provider === s.reviewProvider ? s.reviewModel : null,
    preset.reviewModel,
    preset.model,
  ]);

  return saveCache({
    provider,
    source: primaryResp.ok
      ? 'live'
      : catEntry && models.length > 0
        ? 'config_file'
        : models.length > 0
          ? 'env_fallback'
          : 'empty',
    models,
    defaultAgentModel,
    defaultReviewerModel,
    error: primaryResp.ok ? null : primaryResp.error ?? null,
  });
}
