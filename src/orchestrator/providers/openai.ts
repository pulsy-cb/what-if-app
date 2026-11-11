import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall, ToolSchema } from './types.js';
import { fetchWithRetry } from './retry.js';
import { safeJson, sseData } from './types.js';

const TRANSIENT_SSE_RE =
  /temporarily unavailable|please retry|overloaded|rate limit|too many requests|bad gateway|gateway timeout|service unavailable|internal error|server error|upstream|timed? out|connection reset|\b(429|500|502|503|504)\b/i;

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

/** Any /chat/completions endpoint: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, vLLM, LM Studio, llama.cpp, Ollama (/v1). */
export function openAIProvider(cfg: {
  baseURL: string;
  apiKey: string;
  model: string;
  label?: string;
  maxTokens?: number;
  sseRetryBaseMs?: number;
}): Provider {
  const base = cfg.baseURL.replace(/\/+$/, '');
  return {
    id: 'openai',
    label: cfg.label ?? `openai-compatible (${base})`,
    model: cfg.model,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: cfg.model,
        stream: true,
        messages: req.messages.map(toOpenAI),
        // Reasoning models (Kimi-K3, GLM, o-series) spend this budget thinking first: leave it out and the
        // gateway's small default gives an empty message with finish_reason "length".
        max_tokens: cfg.maxTokens ?? 8_000,
      };
      if (req.tools.length) {
        body.tools = req.tools.map((t: ToolSchema) => t);
        body.tool_choice = 'auto';
      }
      const serializedBody = JSON.stringify(body);
      const maxSseAttempts = 4;

      for (let sseAttempt = 0; sseAttempt < maxSseAttempts; sseAttempt++) {
        const res = await fetchWithRetry(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: serializedBody,
          signal: req.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`${res.status} ${res.statusText} from ${base}/chat/completions\n${text.slice(0, 1200)}`);
        }

        let text = '';
        let finishReason: string | undefined;
        const calls = new Map<number, { id: string; name: string; args: string }>();
        try {
          for await (const data of sseData(res.body)) {
            if (data === '[DONE]') break;
            const evt = safeJson(data);
            if (evt?.error) {
              const msg = String(evt.error?.message ?? JSON.stringify(evt.error));
              const err = new Error(`400 SSE error from ${base}/chat/completions: ${msg}`);
              (err as any).transientSse = TRANSIENT_SSE_RE.test(msg);
              throw err;
            }
            const choice = evt?.choices?.[0];
            if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            const delta = choice?.delta;
            if (!delta) continue;
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content;
              req.onText?.(delta.content);
            }
            for (const tc of delta.tool_calls ?? []) {
              const i = Number(tc.index ?? 0);
              const cur = calls.get(i) ?? { id: '', name: '', args: '' };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              calls.set(i, cur);
            }
          }
        } catch (err) {
          if (req.signal?.aborted) throw err;
          const isTransient = Boolean((err as any)?.transientSse) || (text.length === 0 && calls.size === 0 && TRANSIENT_SSE_RE.test(String(err)));
          if (isTransient && sseAttempt < maxSseAttempts - 1) {
            const waitMs = (cfg.sseRetryBaseMs ?? 5_000) * 2 ** sseAttempt;
            console.error(`[provider] transient SSE error (${(err as Error).message}) — retry ${sseAttempt + 1}/${maxSseAttempts - 1} in ${waitMs / 1000}s`);
            await sleepAbortable(waitMs, req.signal);
            continue;
          }
          throw err;
        }

        let truncatedToolCall: string | undefined;
        const toolCalls: ToolCall[] = [];
        for (const [i, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
          if (!c.name) continue;
          const parsed = c.args.trim() ? safeJson(c.args) : {};
          if (parsed === null || typeof parsed !== 'object') {
            truncatedToolCall = c.name;
            continue;
          }
          toolCalls.push({ id: c.id || `call_${i}_${Date.now()}`, name: c.name, args: parsed as Record<string, unknown> });
        }
        return { text, toolCalls, finishReason, truncatedToolCall };
      }
      throw new Error(`SSE stream failed after ${maxSseAttempts} attempts`);
    },
  };
}

function toOpenAI(m: ChatMessage): any {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant') {
    const out: any = { role: 'assistant', content: m.content || null };
    if (m.toolCalls?.length) {
      out.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }));
    }
    return out;
  }
  if (m.role === 'user' && m.images?.length) {
    return {
      role: 'user',
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })),
      ],
    };
  }
  return { role: m.role, content: m.content };
}
