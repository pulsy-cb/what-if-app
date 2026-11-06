import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall } from './types.js';
import { safeJson, sseData } from './types.js';

/** Anthropic Messages API with tool use and vision. */
export function anthropicProvider(cfg: { baseURL: string; apiKey: string; model: string }): Provider {
  const base = (cfg.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '');
  return {
    id: 'anthropic',
    label: `anthropic (${cfg.model})`,
    model: cfg.model,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const body: Record<string, unknown> = {
        model: cfg.model,
        max_tokens: 8192,
        stream: true,
        system,
        messages: toAnthropic(req.messages.filter((m) => m.role !== 'system')),
      };
      if (req.tools.length) {
        body.tools = req.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
      }
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': cfg.apiKey,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} from ${base}/v1/messages\n${text.slice(0, 1200)}`);
      }

      let text = '';
      const calls: { id: string; name: string; args: string }[] = [];
      let open: { id: string; name: string; args: string } | null = null;
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
        } else if (evt.type === 'error') {
          throw new Error(`anthropic stream error: ${JSON.stringify(evt.error)}`);
        }
      }
      const toolCalls: ToolCall[] = calls
        .filter((c) => c.name)
        .map((c) => ({ id: c.id, name: c.name, args: safeJson(c.args || '{}') ?? {} }));
      return { text, toolCalls };
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
