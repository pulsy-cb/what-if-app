import type { Db, Project } from '../db.js';
import type { Provider, ProviderConfig } from './types.js';
import { openAIProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';
import { codexProvider, CODEX_DEFAULT_BASE_URL, hasCodexAuth } from './codex.js';
import { agyProvider, hasAgyCli } from './agy.js';
import { mockProvider } from './mock.js';
import {
  clearProvidersCatalogCache,
  getProvidersCatalogSummary,
  loadProvidersCatalog,
  resolveCatalogFilePaths,
  stripJsonCommentsAndTrailingCommas,
  type CatalogModelSpec,
  type LoadedProvidersCatalog,
  type ProviderDriver,
  type ProvidersCatalogPublicSummary,
  type ResolvedCatalogProvider,
} from './catalog.js';

export type ProviderPreset = {
  label: string;
  baseURL: string;
  model: string;
  reviewModel?: string;
  authMode: 'oauth' | 'env' | 'config_file' | 'api_key' | 'none';
  driver?: ProviderDriver;
  hasKey?: boolean;
  fromCatalog?: boolean;
};

export type EnvProviderSummary = {
  available: boolean;
  underlyingKind: string;
  host: string;
  baseURL: string;
  reviewBaseURL: string;
  model: string;
  reviewModel: string;
  hasKey: boolean;
  hasReviewKey: boolean;
};

function hostOf(rawUrl?: string): string {
  const clean = String(rawUrl ?? '').trim();
  if (!clean) return '';
  try {
    return new URL(clean).host;
  } catch {
    return clean.replace(/^https?:\/\//, '').split('/')[0] ?? clean;
  }
}

export function getEnvProviderSummary(env: NodeJS.ProcessEnv = process.env): EnvProviderSummary {
  const underlyingKind = (env.WHATIF_PROVIDER || 'openai').trim().toLowerCase();
  const baseURL = (env.WHATIF_BASE_URL || '').trim();
  const reviewBaseURL = (env.WHATIF_REVIEW_BASE_URL || baseURL).trim();
  const model = (env.WHATIF_MODEL || '').trim();
  const reviewModel = (env.WHATIF_REVIEW_MODEL || model).trim();
  const hasKey = Boolean((env.WHATIF_API_KEY || '').trim());
  const hasReviewKey = Boolean((env.WHATIF_REVIEW_API_KEY || env.WHATIF_API_KEY || '').trim());
  const isApiKind = !['mock', 'codex', 'agy'].includes(underlyingKind);
  const available = isApiKind && Boolean(baseURL || hasKey || model);
  return {
    available,
    underlyingKind: isApiKind ? underlyingKind : 'openai',
    host: hostOf(baseURL) || underlyingKind,
    baseURL: baseURL || 'https://api.openai.com/v1',
    reviewBaseURL: reviewBaseURL || baseURL || 'https://api.openai.com/v1',
    model: model || 'gpt-4.1',
    reviewModel: reviewModel || model || 'gpt-4.1',
    hasKey,
    hasReviewKey,
  };
}

export const STATIC_PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  codex: {
    label: 'codex (Abonnement ChatGPT)',
    baseURL: CODEX_DEFAULT_BASE_URL,
    model: 'gpt-6.1-terra',
    reviewModel: 'gpt-6-sol',
    authMode: 'oauth',
    driver: 'codex',
  },
  agy: {
    label: 'agy (Google Antigravity)',
    baseURL: '',
    model: 'gemini-3.8-flash-medium',
    reviewModel: 'claude-sonnet-4-6',
    authMode: 'oauth',
    driver: 'agy',
  },
  openai: {
    label: 'openai (API OpenAI / compatible)',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    authMode: 'api_key',
    driver: 'openai',
  },
  openrouter: {
    label: 'openrouter (OpenRouter API)',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    authMode: 'api_key',
    driver: 'openai',
  },
  anthropic: {
    label: 'anthropic (Claude API)',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    authMode: 'api_key',
    driver: 'anthropic',
  },
  google: {
    label: 'google (Gemini API)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    authMode: 'api_key',
    driver: 'openai',
  },
  mistral: {
    label: 'mistral (Mistral API)',
    baseURL: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    authMode: 'api_key',
    driver: 'openai',
  },
  groq: {
    label: 'groq (Groq API)',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    authMode: 'api_key',
    driver: 'openai',
  },
  local: {
    label: 'local (Ollama / LM Studio)',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl',
    authMode: 'none',
    driver: 'openai',
  },
  mock: {
    label: 'mock (Test hors-ligne)',
    baseURL: '',
    model: 'mock',
    authMode: 'none',
    driver: 'mock',
  },
};

export function getProviderPresets(env: NodeJS.ProcessEnv = process.env, dataRoot?: string): Record<string, ProviderPreset> {
  const catalog = loadProvidersCatalog(env, dataRoot);
  const envInfo = getEnvProviderSummary(env);
  const out: Record<string, ProviderPreset> = {};

  // 1. Custom / configured providers from `providers.json` appear first
  for (const [id, cp] of Object.entries(catalog.providers)) {
    const authMode: ProviderPreset['authMode'] =
      cp.driver === 'codex' || cp.driver === 'agy'
        ? 'oauth'
        : cp.driver === 'mock'
          ? 'none'
          : cp.hasKey
            ? 'config_file'
            : 'api_key';
    out[id] = {
      label: cp.label,
      baseURL: cp.baseURL,
      model: cp.model,
      reviewModel: cp.reviewModel,
      authMode,
      driver: cp.driver,
      hasKey: cp.hasKey,
      fromCatalog: true,
    };
  }

  // 2. `.env` custom API slot when present
  if (envInfo.available && !out.env) {
    out.env = {
      label: `env (API personnalisée .env — ${envInfo.host})`,
      baseURL: envInfo.baseURL,
      model: envInfo.model,
      reviewModel: envInfo.reviewModel,
      authMode: 'env',
      driver: envInfo.underlyingKind === 'anthropic' ? 'anthropic' : 'openai',
      hasKey: envInfo.hasKey,
    };
  }

  // 3. Standard built-in presets (unless overridden in `providers.json`)
  for (const [id, preset] of Object.entries(STATIC_PROVIDER_PRESETS)) {
    if (!out[id]) {
      out[id] = preset;
    }
  }

  return out;
}

export const PROVIDER_PRESETS = STATIC_PROVIDER_PRESETS;

/** Read the provider settings from the project (if overridden), else DB settings, else `providers.json`, else env vars. */
export function providerConfig(db: Db, project?: Pick<Project, 'provider' | 'model'> | null): ProviderConfig {
  const s = db.settings();
  const env = process.env;
  const catalog = loadProvidersCatalog(env, db.dataRoot);
  const presets = getProviderPresets(env, db.dataRoot);
  const envInfo = getEnvProviderSummary(env);

  const projProvider = project?.provider?.trim() || '';
  const projModel = project?.model?.trim() || '';
  const defaultGlobal =
    s.provider ||
    (catalog.defaultProvider && (catalog.providers[catalog.defaultProvider] || presets[catalog.defaultProvider])
      ? catalog.defaultProvider
      : '') ||
    (envInfo.available ? 'env' : '') ||
    env.WHATIF_PROVIDER ||
    'mock';

  const kind = (projProvider || defaultGlobal) as ProviderConfig['provider'];
  const preset = presets[kind] ?? presets.openai!;
  const catEntry = catalog.providers[kind];
  const sameAsGlobal = kind === s.provider;

  if (kind === 'env') {
    return {
      provider: 'env',
      baseURL: envInfo.baseURL,
      apiKey: (env.WHATIF_API_KEY || s.apiKey || '').trim(),
      model: projModel || (sameAsGlobal ? s.model || '' : '') || envInfo.model,
      maxTokens: Number(s.maxTokens || env.WHATIF_MAX_TOKENS || 8_000),
    };
  }

  if (catEntry) {
    const defaultCatModel =
      !projProvider && !s.provider && kind === catalog.defaultProvider && catalog.defaultModel
        ? catalog.defaultModel
        : catEntry.model;
    return {
      provider: kind,
      baseURL: catEntry.driver === 'agy' ? '' : catEntry.baseURL || (sameAsGlobal ? s.baseURL || '' : ''),
      apiKey: catEntry.apiKey || (sameAsGlobal ? s.apiKey || '' : '') || '',
      model: projModel || (sameAsGlobal ? s.model || '' : '') || defaultCatModel,
      maxTokens: Number(s.maxTokens || catEntry.maxTokens || env.WHATIF_MAX_TOKENS || 8_000),
    };
  }

  const matchesEnvKind = envInfo.available && kind === envInfo.underlyingKind;
  return {
    provider: kind,
    baseURL:
      kind === 'agy'
        ? ''
        : (sameAsGlobal ? s.baseURL : '') || (matchesEnvKind ? env.WHATIF_BASE_URL : '') || preset.baseURL,
    apiKey:
      (sameAsGlobal ? s.apiKey : '') ||
      (matchesEnvKind ? env.WHATIF_API_KEY : '') ||
      (!projProvider ? s.apiKey : '') ||
      '',
    model:
      projModel ||
      (sameAsGlobal ? s.model : '') ||
      (matchesEnvKind ? env.WHATIF_MODEL : '') ||
      preset.model,
    maxTokens: Number(s.maxTokens || env.WHATIF_MAX_TOKENS || 8_000),
  };
}

export function resolveProvider(db: Db, project?: Pick<Project, 'provider' | 'model'> | null): Provider {
  const cfg = providerConfig(db, project);
  const catalog = loadProvidersCatalog(process.env, db.dataRoot);
  const catEntry = catalog.providers[cfg.provider];
  const envInfo = getEnvProviderSummary(process.env);
  const effectiveDriver = catEntry
    ? catEntry.driver
    : cfg.provider === 'env'
      ? envInfo.underlyingKind
      : cfg.provider;

  const modelVision = catEntry?.models.find((m) => m.id === cfg.model)?.supportsVision;

  switch (effectiveDriver) {
    case 'mock':
      return mockProvider(cfg.model);
    case 'codex':
      return codexProvider({ baseURL: cfg.baseURL, model: cfg.model });
    case 'agy':
      return agyProvider({ model: cfg.model });
    case 'anthropic':
      if (!cfg.apiKey) {
        throw new Error(`no API key for ${cfg.provider}: set it in providers.json, the settings panel, or .env`);
      }
      return anthropicProvider({
        id: cfg.provider,
        label: catEntry?.label,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
      });
    default:
      if (!cfg.apiKey && !/127\.0\.0\.1|localhost/.test(cfg.baseURL)) {
        throw new Error(`no API key for ${cfg.provider}: set it in providers.json, the settings panel, or .env`);
      }
      return openAIProvider({
        id: cfg.provider,
        label: catEntry?.label,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        ...(typeof modelVision === 'boolean' ? { supportsVision: modelVision } : {}),
      });
  }
}

/**
 * Independent Reviewer provider configuration (supports per-project overrides AND `providers.json` entries
 * so concurrent projects can run with distinct Agent & Reviewer providers/models simultaneously).
 */
export function reviewProviderConfig(
  db: Db,
  project?: Pick<Project, 'provider' | 'model' | 'review_provider' | 'review_model'> | null,
): ProviderConfig | null {
  const s = db.settings();
  const env = process.env;
  const catalog = loadProvidersCatalog(env, db.dataRoot);
  const presets = getProviderPresets(env, db.dataRoot);
  const envInfo = getEnvProviderSummary(env);

  const rawEnabled = (s.reviewerEnabled ?? env.WHATIF_REVIEWER_ENABLED ?? '').trim().toLowerCase();
  if (rawEnabled === 'false' || rawEnabled === '0' || rawEnabled === 'off' || rawEnabled === 'no') {
    return null;
  }

  const projRevProv = project?.review_provider?.trim() || '';
  const projRevModel = project?.review_model?.trim() || '';
  const hasExplicitReviewModel = Boolean(
    (
      projRevProv ||
      projRevModel ||
      s.reviewModel ||
      s.reviewProvider ||
      catalog.defaultReviewProvider ||
      catalog.defaultReviewModel ||
      env.WHATIF_REVIEW_MODEL ||
      env.WHATIF_REVIEW_PROVIDER ||
      ''
    ).trim(),
  );
  const enabled = rawEnabled === 'true' || rawEnabled === '1' || rawEnabled === 'on' || hasExplicitReviewModel;
  const primary = providerConfig(db, project);
  if (!enabled && primary.provider === 'mock') return null;

  const projOverrodePrimary = Boolean(project?.provider?.trim());
  const defaultCatalogRev =
    !s.reviewProvider && !s.provider && catalog.defaultReviewProvider ? catalog.defaultReviewProvider : '';
  const defaultEnvRev =
    envInfo.available && !s.reviewProvider && !s.provider && !defaultCatalogRev ? 'env' : env.WHATIF_REVIEW_PROVIDER || '';

  const kind = (
    projRevProv ||
    (projOverrodePrimary ? primary.provider : '') ||
    s.reviewProvider ||
    defaultCatalogRev ||
    defaultEnvRev ||
    primary.provider
  ) as ProviderConfig['provider'];
  if (kind === 'mock' && !hasExplicitReviewModel) return null;

  const preset = presets[kind] ?? presets.openai!;
  const catEntry = catalog.providers[kind];
  const defaultReviewModel = preset.reviewModel ?? preset.model;
  const sameAsGlobalRev = !projRevProv && !projOverrodePrimary && kind === s.reviewProvider;

  if (kind === 'env') {
    return {
      provider: 'env',
      baseURL: envInfo.reviewBaseURL,
      apiKey: (env.WHATIF_REVIEW_API_KEY || env.WHATIF_API_KEY || s.reviewApiKey || s.apiKey || '').trim(),
      model: projRevModel || (sameAsGlobalRev ? s.reviewModel || '' : '') || envInfo.reviewModel,
      maxTokens: Number(env.WHATIF_REVIEW_MAX_TOKENS || 12_000),
    };
  }

  if (catEntry) {
    const catRevModel =
      !projRevProv && !s.reviewProvider && kind === catalog.defaultReviewProvider && catalog.defaultReviewModel
        ? catalog.defaultReviewModel
        : catEntry.reviewModel || catEntry.model;
    return {
      provider: kind,
      baseURL: catEntry.driver === 'agy' ? '' : catEntry.baseURL || (sameAsGlobalRev ? s.reviewBaseURL || '' : ''),
      apiKey:
        catEntry.apiKey ||
        (sameAsGlobalRev ? s.reviewApiKey || '' : '') ||
        (kind === primary.provider ? primary.apiKey : '') ||
        '',
      model: projRevModel || (sameAsGlobalRev ? s.reviewModel || '' : '') || catRevModel,
      maxTokens: Number(env.WHATIF_REVIEW_MAX_TOKENS || catEntry.maxTokens || 12_000),
    };
  }

  const matchesEnvRevKind =
    envInfo.available && kind === (env.WHATIF_REVIEW_PROVIDER || envInfo.underlyingKind).trim().toLowerCase();
  const sameProviderAsPrimary = !projRevProv && !s.reviewProvider && !env.WHATIF_REVIEW_PROVIDER && kind === primary.provider;

  return {
    provider: kind,
    baseURL:
      kind === 'agy'
        ? ''
        : (sameAsGlobalRev ? s.reviewBaseURL : '') ||
          (matchesEnvRevKind ? env.WHATIF_REVIEW_BASE_URL || env.WHATIF_BASE_URL : '') ||
          (sameProviderAsPrimary ? primary.baseURL : preset.baseURL),
    apiKey:
      (sameAsGlobalRev ? s.reviewApiKey : '') ||
      (matchesEnvRevKind ? env.WHATIF_REVIEW_API_KEY || env.WHATIF_API_KEY : '') ||
      (kind === primary.provider ? primary.apiKey : '') ||
      (!projRevProv && kind === s.reviewProvider ? s.reviewApiKey : '') ||
      '',
    model:
      projRevModel ||
      (sameAsGlobalRev ? s.reviewModel : '') ||
      (matchesEnvRevKind ? env.WHATIF_REVIEW_MODEL || env.WHATIF_MODEL : '') ||
      (sameProviderAsPrimary && !preset.reviewModel ? primary.model : defaultReviewModel),
    maxTokens: Number(env.WHATIF_REVIEW_MAX_TOKENS || 12_000),
  };
}

export function resolveReviewProvider(
  db: Db,
  project?: Pick<Project, 'provider' | 'model' | 'review_provider' | 'review_model'> | null,
): Provider | null {
  const cfg = reviewProviderConfig(db, project);
  if (!cfg) return null;
  const catalog = loadProvidersCatalog(process.env, db.dataRoot);
  const catEntry = catalog.providers[cfg.provider];
  const envInfo = getEnvProviderSummary(process.env);
  const effectiveDriver = catEntry
    ? catEntry.driver
    : cfg.provider === 'env'
      ? env.WHATIF_REVIEW_PROVIDER || envInfo.underlyingKind
      : cfg.provider;

  const revModelVision = catEntry?.models.find((m) => m.id === cfg.model)?.supportsVision;

  switch (effectiveDriver) {
    case 'mock':
      return mockProvider(cfg.model);
    case 'codex':
      return codexProvider({ baseURL: cfg.baseURL, model: cfg.model });
    case 'agy':
      return agyProvider({ model: cfg.model });
    case 'anthropic':
      if (!cfg.apiKey) return null;
      return anthropicProvider({
        id: cfg.provider,
        label: catEntry?.label,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
      });
    default:
      if (!cfg.apiKey && !/127\.0\.0\.1|localhost/.test(cfg.baseURL)) return null;
      return openAIProvider({
        id: cfg.provider,
        label: catEntry?.label,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        ...(typeof revModelVision === 'boolean' ? { supportsVision: revModelVision } : {}),
      });
  }
}

const env = process.env;

export * from './types.js';
export * from './models.js';
export {
  clearProvidersCatalogCache,
  getProvidersCatalogSummary,
  loadProvidersCatalog,
  resolveCatalogFilePaths,
  stripJsonCommentsAndTrailingCommas,
  type CatalogModelSpec,
  type LoadedProvidersCatalog,
  type ProviderDriver,
  type ProvidersCatalogPublicSummary,
  type ResolvedCatalogProvider,
};
export { mockProvider } from './mock.js';
export { openAIProvider } from './openai.js';
export { anthropicProvider } from './anthropic.js';
export { codexProvider, hasCodexAuth, isAllowedCodexBase } from './codex.js';
export { agyProvider, hasAgyCli, normalizeAgyModel, buildAgyPrompt, parseAgyModelsOutput, listAgyModels } from './agy.js';
