import type { Db } from '../db.js';
import type { Provider, ProviderConfig } from './types.js';
import { openAIProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';
import { mockProvider } from './mock.js';

export const PROVIDER_PRESETS: Record<string, { baseURL: string; model: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  anthropic: { baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  google: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro' },
  mistral: { baseURL: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  local: { baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl' },
  mock: { baseURL: '', model: 'mock' },
};

/** Read the provider settings from the DB, falling back to env vars. */
export function providerConfig(db: Db): ProviderConfig {
  const s = db.settings();
  const env = process.env;
  const kind = (s.provider ?? env.WHATIF_PROVIDER ?? 'mock') as ProviderConfig['provider'];
  const preset = PROVIDER_PRESETS[kind] ?? PROVIDER_PRESETS.openai!;
  return {
    provider: kind,
    baseURL: s.baseURL || env.WHATIF_BASE_URL || preset.baseURL,
    apiKey: s.apiKey || env.WHATIF_API_KEY || '',
    model: s.model || env.WHATIF_MODEL || preset.model,
    maxTokens: Number(s.maxTokens || env.WHATIF_MAX_TOKENS || 8_000),
  };
}

export function resolveProvider(db: Db): Provider {
  const cfg = providerConfig(db);
  switch (cfg.provider) {
    case 'mock':
      return mockProvider(cfg.model);
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

export * from './types.js';
export { mockProvider } from './mock.js';
export { openAIProvider } from './openai.js';
export { anthropicProvider } from './anthropic.js';
