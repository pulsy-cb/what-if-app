import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall, ToolSchema } from './types.js';
import { fetchWithRetry } from './retry.js';
import { safeJson, sseData } from './types.js';

export const CODEX_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export type CodexAuthData = {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  authPath: string;
  raw: Record<string, any>;
};

export function defaultCodexAuthPath(): string {
  if (process.env.WHATIF_CODEX_AUTH) return process.env.WHATIF_CODEX_AUTH;
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'auth.json');
}

export function normalizeCodexModel(raw: string): { model: string; effort: string } {
  const trimmed = String(raw || 'gpt-6.1-terra').trim();
  const [modelPart, effortPart] = trimmed.split(':');
  const slug = (modelPart || 'gpt-6.1-terra').trim().toLowerCase().replace(/\s+/g, '-');
  const effort = (effortPart || process.env.WHATIF_REASONING_EFFORT || 'medium').trim().toLowerCase();
  return { model: slug, effort };
}

function jwtExpiresSoon(token: string, skewSec = 90): boolean {
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number') return false;
    return Date.now() / 1000 >= payload.exp - skewSec;
  } catch {
    return false;
  }
}

export function hasCodexAuth(authPath = defaultCodexAuthPath()): boolean {
  try {
    if (!fs.existsSync(authPath)) return false;
    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    return Boolean(raw?.tokens?.access_token || raw?.access_token);
  } catch {
    return false;
  }
}

function readCodexAuth(authPath: string): CodexAuthData {
  if (!fs.existsSync(authPath)) {
    throw new Error(`Codex auth not found at ${authPath}. Run "codex login" on the host first.`);
  }
  const raw = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const tokens = raw?.tokens ?? raw ?? {};
  const accessToken = String(tokens.access_token ?? '');
  if (!accessToken) {
    throw new Error(`No ChatGPT OAuth access_token in ${authPath}. Run "codex login" using ChatGPT.`);
  }
  return {
    accessToken,
    refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
    accountId: tokens.account_id ? String(tokens.account_id) : undefined,
    authPath,
    raw,
  };
}

async function refreshCodexAuth(auth: CodexAuthData, tokenUrl = CODEX_OAUTH_TOKEN_URL): Promise<CodexAuthData> {
  if (!auth.refreshToken) return auth;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX_OAUTH_CLIENT_ID,
    refresh_token: auth.refreshToken,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Codex OAuth token refresh failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const updated = (await res.json()) as Record<string, any>;
  const nextAccess = String(updated.access_token ?? '');
  if (!nextAccess) throw new Error('Codex OAuth token refresh returned no access_token');
  const nextRefresh = updated.refresh_token ? String(updated.refresh_token) : auth.refreshToken;

  const nextRaw = { ...auth.raw };
  if (nextRaw.tokens && typeof nextRaw.tokens === 'object') {
    nextRaw.tokens = {
      ...nextRaw.tokens,
      access_token: nextAccess,
      ...(nextRefresh ? { refresh_token: nextRefresh } : {}),
      ...(updated.id_token ? { id_token: updated.id_token } : {}),
    };
  } else {
    nextRaw.access_token = nextAccess;
    if (nextRefresh) nextRaw.refresh_token = nextRefresh;
  }
  nextRaw.last_refresh = new Date().toISOString();

  try {
    const tmp = `${auth.authPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(nextRaw, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, auth.authPath);
  } catch {
    // Read-only mount fallback: keep refreshed token in memory for this request
  }

  return {
    ...auth,
    accessToken: nextAccess,
    refreshToken: nextRefresh,
    raw: nextRaw,
  };
}

export async function loadValidCodexAuth(
  authPath = defaultCodexAuthPath(),
  oauthTokenUrl = CODEX_OAUTH_TOKEN_URL,
): Promise<CodexAuthData> {
  let auth = readCodexAuth(authPath);
  if (jwtExpiresSoon(auth.accessToken)) {
    auth = await refreshCodexAuth(auth, oauthTokenUrl);
  }
  return auth;
}

export function toCodexResponsesPayload(
  messages: ChatMessage[],
  tools: ToolSchema[],
  modelSpec: string,
): { instructions: string; input: any[]; tools: any[]; model: string; effort: string } {
  const { model, effort } = normalizeCodexModel(modelSpec);
  const sysParts: string[] = [];
  const input: any[] = [];
  const emittedCalls = new Set<string>();

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content?.trim()) sysParts.push(m.content.trim());
      continue;
    }
    if (m.role === 'user') {
      const content: any[] = [];
      if (m.content || !(m.images?.length)) {
        content.push({ type: 'input_text', text: m.content || ' ' });
      }
      for (const img of m.images ?? []) {
        content.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.data}` });
      }
      input.push({ type: 'message', role: 'user', content });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.content && m.content.trim()) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: m.content }],
        });
      }
      for (const tc of m.toolCalls ?? []) {
        const callId = tc.id || `call_${input.length}`;
        emittedCalls.add(callId);
        input.push({
          type: 'function_call',
          call_id: callId,
          name: tc.name,
          arguments: JSON.stringify(tc.args ?? {}),
        });
      }
      continue;
    }
    if (m.role === 'tool') {
      if (m.toolCallId && emittedCalls.has(m.toolCallId)) {
        input.push({
          type: 'function_call_output',
          call_id: m.toolCallId,
          output: m.content ?? '',
        });
      } else {
        input.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `[Résultat outil ${m.name}]:\n${m.content ?? ''}` }],
        });
      }
    }
  }

  if (input.length === 0) {
    input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] });
  }

  const flatTools = tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));

  return {
    instructions: sysParts.join('\n\n') || 'You are a helpful studio assistant.',
    input,
    tools: flatTools,
    model,
    effort,
  };
}

/** ChatGPT / Codex OAuth Responses API provider (uses ~/.codex/auth.json from `codex login`). */
export function codexProvider(cfg: {
  baseURL?: string;
  model: string;
  authPath?: string;
  oauthTokenUrl?: string;
  label?: string;
}): Provider {
  const rawBase = (cfg.baseURL || CODEX_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const base = /chatgpt\.com|localhost|127\.0\.0\.1/.test(rawBase) ? rawBase : CODEX_DEFAULT_BASE_URL;
  const authPath = cfg.authPath || defaultCodexAuthPath();
  const { model: normalizedModel } = normalizeCodexModel(cfg.model);

  return {
    id: 'codex',
    label: cfg.label ?? `codex (${normalizedModel})`,
    model: normalizedModel,
    async chat(req: ChatRequest): Promise<ChatResult> {
      let auth = await loadValidCodexAuth(authPath, cfg.oauthTokenUrl);

      const converted = toCodexResponsesPayload(req.messages, req.tools, cfg.model);
      const body: Record<string, unknown> = {
        model: converted.model,
        instructions: converted.instructions,
        store: false,
        stream: true,
        reasoning: { effort: converted.effort },
        input: converted.input,
      };
      if (converted.tools.length) {
        body.tools = converted.tools;
        body.tool_choice = 'auto';
      }

      const doFetch = (token: string, accountId?: string) =>
        fetchWithRetry(`${base}/responses`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${token}`,
            ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
            originator: 'codex_cli_rs',
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });

      let res = await doFetch(auth.accessToken, auth.accountId);
      if (res.status === 401 && auth.refreshToken) {
        auth = await refreshCodexAuth(auth, cfg.oauthTokenUrl);
        res = await doFetch(auth.accessToken, auth.accountId);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} from ${base}/responses (${converted.model})\n${errBody.slice(0, 1200)}`);
      }

      let text = '';
      let finishReason: string | undefined;
      let usage: unknown;
      let truncatedToolCall: string | undefined;
      const toolCalls: ToolCall[] = [];
      const seenCallIds = new Set<string>();

      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break;
        const evt = safeJson(data);
        if (!evt || typeof evt !== 'object') continue;

        if (evt.type === 'error' || evt.type === 'response.failed') {
          const msg = evt.error?.message || evt.response?.error?.message || JSON.stringify(evt.error ?? evt);
          throw new Error(`Codex stream error (${converted.model}): ${msg}`);
        }

        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string' && evt.delta) {
          text += evt.delta;
          req.onText?.(evt.delta);
          continue;
        }

        if (evt.type === 'response.output_item.done' && evt.item) {
          const item = evt.item;
          if (item.type === 'function_call' && item.name) {
            const callId = String(item.call_id || item.id || `call_${toolCalls.length}_${Date.now()}`);
            if (seenCallIds.has(callId)) continue;
            seenCallIds.add(callId);
            const rawArgs = typeof item.arguments === 'string' ? item.arguments.trim() : '';
            const parsed = rawArgs ? safeJson(rawArgs) : {};
            if (parsed === null || typeof parsed !== 'object') {
              truncatedToolCall = String(item.name);
              continue;
            }
            toolCalls.push({
              id: callId,
              name: String(item.name),
              args: parsed as Record<string, unknown>,
            });
          } else if (item.type === 'message' && !text && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part?.type === 'output_text' && typeof part.text === 'string' && part.text) {
                text += part.text;
                req.onText?.(part.text);
              }
            }
          }
          continue;
        }

        if (evt.type === 'response.completed' || evt.type === 'response.incomplete') {
          const status = evt.response?.status ?? (evt.type === 'response.incomplete' ? 'incomplete' : 'completed');
          finishReason = status === 'incomplete' ? 'length' : toolCalls.length > 0 ? 'tool_calls' : 'stop';
          usage = evt.response?.usage;
        }
      }

      return { text, toolCalls, usage, finishReason, truncatedToolCall };
    },
  };
}
