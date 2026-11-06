import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall, ToolSchema } from './types.js';
import { fetchWithRetry } from './retry.js';
import { safeJson, sseData } from './types.js';

/** Any /chat/completions endpoint: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, vLLM, LM Studio, llama.cpp, Ollama (/v1). */
export function openAIProvider(cfg: {
  baseURL: string;
  apiKey: string;
  model: string;
  label?: string;
  maxTokens?: number;
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
      const res = await fetchWithRetry(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} from ${base}/chat/completions\n${text.slice(0, 1200)}`);
      }

      let text = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break;
        const evt = safeJson(data);
        const delta = evt?.choices?.[0]?.delta;
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
      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, c]) => c.name)
        .map(([i, c]) => ({ id: c.id || `call_${i}_${Date.now()}`, name: c.name, args: safeJson(c.args) ?? {} }));
      return { text, toolCalls };
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
