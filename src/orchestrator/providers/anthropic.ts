import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall } from './types.js';
import { fetchWithRetry } from './retry.js';
import { safeJson, sseData } from './types.js';

const TRANSIENT_SSE_RE =
  /overloaded|rate_limit|temporarily unavailable|internal_error|service unavailable|timed? out|terminated|body timeout|econnreset|socket hang up|und_err_|premature close|\b(429|500|502|503|504|529)\b/i;

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Anthropic Messages API with tool use and vision. */
export function anthropicProvider(cfg: {
  id?: string;
  label?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  sseRetryBaseMs?: number;
}): Provider {
  const base = (cfg.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const messagesUrl = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  return {
    id: cfg.id || 'anthropic',
    label: cfg.label ?? `anthropic (${cfg.model})`,
    model: cfg.model,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const sysMsgs = req.messages.filter((m) => m.role === 'system');
      // Mark the stable system prefix (first 3 system blocks: SYSTEM_PROMPT, ENGINE_CHEAT, engineDigest) with cache_control
      const system = sysMsgs.map((m, i) => ({
        type: 'text',
        text: m.content,
        ...(i === Math.min(2, sysMsgs.length - 1) ? { cache_control: { type: 'ephemeral' } } : {}),
      }));
      const body: Record<string, unknown> = {
        model: cfg.model,
        max_tokens: cfg.maxTokens ?? 8192,
        stream: true,
        system,
        messages: toAnthropic(req.messages.filter((m) => m.role !== 'system')),
      };
      if (req.tools.length) {
        body.tools = req.tools.map((t, i) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
          ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        }));
      }
      const serializedBody = JSON.stringify(body);
      const maxSseAttempts = 4;

      for (let sseAttempt = 0; sseAttempt < maxSseAttempts; sseAttempt++) {
        const res = await fetchWithRetry(messagesUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': cfg.apiKey,
          },
          body: serializedBody,
          signal: req.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`${res.status} ${res.statusText} from ${messagesUrl}\n${text.slice(0, 1200)}`);
        }

        let text = '';
        let finishReason: string | undefined;
        const calls: { id: string; name: string; args: string }[] = [];
        let open: { id: string; name: string; args: string } | null = null;
        try {
          for await (const data of sseData(res.body)) {
            const evt = safeJson(data);
            if (!evt) continue;
            if (evt.type === 'content_block_start') {
              const block = evt.content_block;
              if (block?.type === 'tool_use') {
                open = { id: block.id, name: block.name, args: '' };
                calls.push(open);
              }
            } else if (evt.type === 'content_block_delta') {
              const d = evt.delta;
              if (d?.type === 'text_delta' && d.text) {
                text += d.text;
                req.onText?.(d.text);
              } else if (d?.type === 'input_json_delta' && open) {
                open.args += d.partial_json ?? '';
              }
            } else if (evt.type === 'content_block_stop') {
              open = null;
            } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
              finishReason = evt.delta.stop_reason === 'max_tokens' ? 'length' : String(evt.delta.stop_reason);
            } else if (evt.type === 'error') {
              const errStr = JSON.stringify(evt.error);
              const err = new Error(`anthropic stream error: ${errStr}`);
              (err as any).transientSse = TRANSIENT_SSE_RE.test(errStr);
              throw err;
            }
          }
        } catch (err) {
          if (req.signal?.aborted) throw err;
          const isTransient =
            Boolean((err as any)?.transientSse) ||
            (text.length === 0 && calls.length === 0 && TRANSIENT_SSE_RE.test(String(err)));
          if (isTransient && sseAttempt < maxSseAttempts - 1) {
            const waitMs = (cfg.sseRetryBaseMs ?? 5_000) * 2 ** sseAttempt;
            await sleepAbortable(waitMs, req.signal);
            continue;
          }
          throw err;
        }
        let truncatedToolCall: string | undefined;
        const toolCalls: ToolCall[] = [];
        for (const c of calls) {
          if (!c.name) continue;
          const parsed = c.args.trim() ? safeJson(c.args) : {};
          if (parsed === null || typeof parsed !== 'object') {
            truncatedToolCall = c.name;
            continue;
          }
          toolCalls.push({ id: c.id, name: c.name, args: parsed as Record<string, unknown> });
        }
        return { text, toolCalls, finishReason, truncatedToolCall };
      }
      throw new Error(`Anthropic SSE stream failed after ${maxSseAttempts} attempts`);
    },
  };
}

type AnthropicBlock = Record<string, unknown>;

function toAnthropic(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
      continue;
    }
    if (m.role === 'assistant') {
      const content: AnthropicBlock[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }
    if (m.role !== 'user') continue;
    const content: AnthropicBlock[] = [{ type: 'text', text: m.content }];
    for (const img of m.images ?? []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
    }
    out.push({ role: 'user', content });
  }
  // Anthropic wants alternating turns: merge consecutive same-role messages.
  const merged: typeof out = [];
  for (const msg of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) last.content.push(...msg.content);
    else merged.push(msg);
  }
  return merged;
}
