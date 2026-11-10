import type { Db, Project } from '../db.js';
import type { Provider, ProviderConfig } from './types.js';
import { openAIProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';
import { codexProvider, CODEX_DEFAULT_BASE_URL, hasCodexAuth } from './codex.js';
import { agyProvider, hasAgyCli } from './agy.js';
import { mockProvider } from './mock.js';

export type ModelChoice = { id: string; label: string };

export const PROVIDER_MODEL_CATALOG: Record<
  string,
  {
    label: string;
    agent: ModelChoice[];
    reviewer: ModelChoice[];
    defaultAgentModel: string;
    defaultReviewerModel: string;
  }
> = {
  codex: {
    label: 'codex (Abonnement ChatGPT)',
    agent: [
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    ],
    reviewer: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
    ],
    defaultAgentModel: 'gpt-6.1-terra',
    defaultReviewerModel: 'gpt-6.1-sol',
  },
  agy: {
    label: 'agy (Google Antigravity)',
    agent: [
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-4-carbon-low', label: 'Gemini 4 Carbon (Low)' },
      { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
    ],
    reviewer: [
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
      { id: 'gemini-4-carbon-medium', label: 'Gemini 4 Carbon (Medium)' },
    ],
    defaultAgentModel: 'gemini-3.8-flash-medium',
    defaultReviewerModel: 'gemini-4-argon-medium',
  },
};

export const PROVIDER_PRESETS: Record<string, { baseURL: string; model: string; reviewModel?: string }> = {
  codex: { baseURL: CODEX_DEFAULT_BASE_URL, model: 'gpt-6.1-terra', reviewModel: 'gpt-6.1-sol' },
  agy: { baseURL: '', model: 'gemini-3.8-flash-medium', reviewModel: 'gemini-4-argon-medium' },
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  anthropic: { baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  google: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro' },
  mistral: { baseURL: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  local: { baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl' },
  mock: { baseURL: '', model: 'mock' },
};

/** Read the provider settings from the project (if overridden), else DB settings, else env vars. */
export function providerConfig(db: Db, project?: Pick<Project, 'provider' | 'model'> | null): ProviderConfig {
  const s = db.settings();
  const env = process.env;
  const projProvider = project?.provider?.trim() || '';
  const projModel = project?.model?.trim() || '';
  const globalKind = (s.provider || env.WHATIF_PROVIDER || 'mock') as ProviderConfig['provider'];
  const kind = (projProvider || globalKind) as ProviderConfig['provider'];
  const preset = PROVIDER_PRESETS[kind] ?? PROVIDER_PRESETS.openai!;
  const sameAsGlobal = kind === s.provider;
  const sameAsEnv = !projProvider && (!s.provider || !env.WHATIF_PROVIDER || s.provider === env.WHATIF_PROVIDER);

  return {
    provider: kind,
    baseURL:
      kind === 'agy'
        ? ''
        : (sameAsGlobal ? s.baseURL : '') || (sameAsEnv ? env.WHATIF_BASE_URL : '') || preset.baseURL,
    apiKey: (sameAsGlobal ? s.apiKey : s.apiKey) || (sameAsEnv ? env.WHATIF_API_KEY : '') || '',
    model:
      projModel ||
      (sameAsGlobal ? s.model : '') ||
      (sameAsEnv ? env.WHATIF_MODEL : '') ||
      preset.model,
    maxTokens: Number(s.maxTokens || env.WHATIF_MAX_TOKENS || 8_000),
  };
}

export function resolveProvider(db: Db, project?: Pick<Project, 'provider' | 'model'> | null): Provider {
  const cfg = providerConfig(db, project);
  switch (cfg.provider) {
    case 'mock':
      return mockProvider(cfg.model);
    case 'codex':
      return codexProvider({ baseURL: cfg.baseURL, model: cfg.model });
    case 'agy':
      return agyProvider({ model: cfg.model });
    case 'anthropic':
      if (!cfg.apiKey) throw new Error('no API key for anthropic: set it in the settings panel');
      return anthropicProvider({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: cfg.maxTokens });
    default:
      if (!cfg.apiKey && !/127\.0\.0\.1|localhost/.test(cfg.baseURL)) {
        throw new Error(`no API key for ${cfg.provider}: set it in the settings panel`);
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

  // If the project overrode its primary provider (e.g. to 'agy') without setting a project review_provider,
  // prefer that project's provider for the reviewer as well unless review_provider is explicitly set on the project!
  const projOverrodePrimary = Boolean(project?.provider?.trim());
  const kind = (
    projRevProv ||
    (projOverrodePrimary ? primary.provider : '') ||
    s.reviewProvider ||
    env.WHATIF_REVIEW_PROVIDER ||
    primary.provider
  ) as ProviderConfig['provider'];
  if (kind === 'mock' && !hasExplicitReviewModel) return null;

  const preset = PROVIDER_PRESETS[kind] ?? PROVIDER_PRESETS.openai!;
  const defaultReviewModel = preset.reviewModel ?? preset.model;
  const sameAsGlobalRev = !projRevProv && !projOverrodePrimary && kind === s.reviewProvider;
  const sameAsEnv = !projRevProv && !projOverrodePrimary && (!s.reviewProvider || !env.WHATIF_REVIEW_PROVIDER || s.reviewProvider === env.WHATIF_REVIEW_PROVIDER);
  const sameProviderAsPrimary = !projRevProv && !s.reviewProvider && !env.WHATIF_REVIEW_PROVIDER && kind === primary.provider;

  return {
    provider: kind,
    baseURL:
      kind === 'agy'
        ? ''
        : (sameAsGlobalRev ? s.reviewBaseURL : '') ||
          (sameAsEnv ? env.WHATIF_REVIEW_BASE_URL : '') ||
          (sameProviderAsPrimary ? primary.baseURL : preset.baseURL),
    apiKey:
      s.reviewApiKey ||
      (sameAsEnv ? env.WHATIF_REVIEW_API_KEY : '') ||
      (kind === primary.provider ? primary.apiKey : '') ||
      '',
    model:
      projRevModel ||
      (sameAsGlobalRev ? s.reviewModel : '') ||
      (sameAsEnv ? env.WHATIF_REVIEW_MODEL : '') ||
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
  switch (cfg.provider) {
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

export * from './types.js';
export { mockProvider } from './mock.js';
export { openAIProvider } from './openai.js';
export { anthropicProvider } from './anthropic.js';
export { codexProvider, hasCodexAuth } from './codex.js';
export { agyProvider, hasAgyCli, normalizeAgyModel, buildAgyPrompt } from './agy.js';
