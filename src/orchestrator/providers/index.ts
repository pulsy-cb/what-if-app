import type { Db, Project } from '../db.js';
import type { Provider, ProviderConfig } from './types.js';
import { openAIProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';
import { codexProvider, CODEX_DEFAULT_BASE_URL, hasCodexAuth } from './codex.js';
import { agyProvider, hasAgyCli } from './agy.js';
import { mockProvider } from './mock.js';

export type ProviderPreset = {
  label: string;
  baseURL: string;
  model: string;
  reviewModel?: string;
  authMode: 'oauth' | 'env' | 'api_key' | 'none';
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
  },
  agy: {
    label: 'agy (Google Antigravity)',
    baseURL: '',
    model: 'gemini-3.8-flash-medium',
    reviewModel: 'claude-sonnet-4-6',
    authMode: 'oauth',
  },
  openai: {
    label: 'openai (API OpenAI / compatible)',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    authMode: 'api_key',
  },
  openrouter: {
    label: 'openrouter (OpenRouter API)',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    authMode: 'api_key',
  },
  anthropic: {
    label: 'anthropic (Claude API)',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    authMode: 'api_key',
  },
  google: {
    label: 'google (Gemini API)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    authMode: 'api_key',
  },
  mistral: {
    label: 'mistral (Mistral API)',
    baseURL: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    authMode: 'api_key',
  },
  groq: {
    label: 'groq (Groq API)',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    authMode: 'api_key',
  },
  local: {
    label: 'local (Ollama / LM Studio)',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl',
    authMode: 'none',
  },
  mock: {
    label: 'mock (Test hors-ligne)',
    baseURL: '',
    model: 'mock',
    authMode: 'none',
  },
};

export function getProviderPresets(env: NodeJS.ProcessEnv = process.env): Record<string, ProviderPreset> {
  const envInfo = getEnvProviderSummary(env);
  if (!envInfo.available) return { ...STATIC_PROVIDER_PRESETS };
  return {
    env: {
      label: `env (API personnalisée .env — ${envInfo.host})`,
      baseURL: envInfo.baseURL,
      model: envInfo.model,
      reviewModel: envInfo.reviewModel,
      authMode: 'env',
    },
    ...STATIC_PROVIDER_PRESETS,
  };
}

export const PROVIDER_PRESETS = STATIC_PROVIDER_PRESETS;

/** Read the provider settings from the project (if overridden), else DB settings, else env vars. */
export function providerConfig(db: Db, project?: Pick<Project, 'provider' | 'model'> | null): ProviderConfig {
  const s = db.settings();
  const env = process.env;
  const presets = getProviderPresets(env);
  const envInfo = getEnvProviderSummary(env);

  const projProvider = project?.provider?.trim() || '';
  const projModel = project?.model?.trim() || '';
  const defaultGlobal = envInfo.available && !s.provider ? 'env' : s.provider || env.WHATIF_PROVIDER || 'mock';
  const kind = (projProvider || defaultGlobal) as ProviderConfig['provider'];
  const preset = presets[kind] ?? presets.openai!;
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
      s.apiKey ||
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
  const envInfo = getEnvProviderSummary(process.env);
  const effectiveDriver = cfg.provider === 'env' ? envInfo.underlyingKind : cfg.provider;

  switch (effectiveDriver) {
    case 'mock':
      return mockProvider(cfg.model);
    case 'codex':
      return codexProvider({ baseURL: cfg.baseURL, model: cfg.model });
    case 'agy':
      return agyProvider({ model: cfg.model });
    case 'anthropic':
      if (!cfg.apiKey) throw new Error(`no API key for ${cfg.provider}: set it in the settings panel or .env`);
      return anthropicProvider({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: cfg.maxTokens });
    default:
      if (!cfg.apiKey && !/127\.0\.0\.1|localhost/.test(cfg.baseURL)) {
        throw new Error(`no API key for ${cfg.provider}: set it in the settings panel or .env`);
      }
      return openAIProvider({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: cfg.maxTokens });
  }
}

/**
 * Independent Reviewer provider configuration (supports per-project overrides so concurrent projects
 * can run with distinct Agent & Reviewer providers/models simultaneously).
 */
export function reviewProviderConfig(
  db: Db,
  project?: Pick<Project, 'provider' | 'model' | 'review_provider' | 'review_model'> | null,
): ProviderConfig | null {
  const s = db.settings();
  const env = process.env;
  const presets = getProviderPresets(env);
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
      env.WHATIF_REVIEW_MODEL ||
      s.reviewProvider ||
      env.WHATIF_REVIEW_PROVIDER ||
      ''
    ).trim(),
  );
  const enabled = rawEnabled === 'true' || rawEnabled === '1' || rawEnabled === 'on' || hasExplicitReviewModel;
  const primary = providerConfig(db, project);
  if (!enabled && primary.provider === 'mock') return null;

  const projOverrodePrimary = Boolean(project?.provider?.trim());
  const defaultEnvRev = envInfo.available && !s.reviewProvider && !s.provider ? 'env' : env.WHATIF_REVIEW_PROVIDER || '';
  const kind = (
    projRevProv ||
    (projOverrodePrimary ? primary.provider : '') ||
    s.reviewProvider ||
    defaultEnvRev ||
    primary.provider
  ) as ProviderConfig['provider'];
  if (kind === 'mock' && !hasExplicitReviewModel) return null;

  const preset = presets[kind] ?? presets.openai!;
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
      s.reviewApiKey ||
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
  const envInfo = getEnvProviderSummary(process.env);
  const effectiveDriver = cfg.provider === 'env' ? (env.WHATIF_REVIEW_PROVIDER || envInfo.underlyingKind) : cfg.provider;

  switch (effectiveDriver) {
    case 'mock':
      return mockProvider(cfg.model);
    case 'codex':
      return codexProvider({ baseURL: cfg.baseURL, model: cfg.model });
    case 'agy':
      return agyProvider({ model: cfg.model });
    case 'anthropic':
      if (!cfg.apiKey) return null;
      return anthropicProvider({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: cfg.maxTokens });
    default:
      if (!cfg.apiKey && !/127\.0\.0\.1|localhost/.test(cfg.baseURL)) return null;
      return openAIProvider({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: cfg.maxTokens });
  }
}

const env = process.env;

export * from './types.js';
export * from './models.js';
export { mockProvider } from './mock.js';
export { openAIProvider } from './openai.js';
export { anthropicProvider } from './anthropic.js';
export { codexProvider, hasCodexAuth } from './codex.js';
export { agyProvider, hasAgyCli, normalizeAgyModel, buildAgyPrompt, parseAgyModelsOutput, listAgyModels } from './agy.js';
