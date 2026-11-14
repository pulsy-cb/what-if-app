export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ImagePart = { mime: string; data: string }; // base64, no data: prefix

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: ImagePart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type ToolSchema = { type: 'function'; function: { name: string; description: string; parameters: unknown } };

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
};

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  usage?: unknown;
  finishReason?: string;
  truncatedToolCall?: string;
};

export type Provider = {
  id: string;
  label: string;
  model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
};

export type ProviderConfig = {
  maxTokens?: number;
  provider: 'mock' | 'openai' | 'anthropic' | 'codex' | 'agy' | string;
  baseURL: string;
  apiKey: string;
  model: string;
};

/** Parse a text/event-stream body into `data:` payload strings. */
export async function* sseData(body: unknown): AsyncGenerator<string> {
  const stream = body as AsyncIterable<Uint8Array>;
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    if (buf.includes('\r')) buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (data) yield data;
    }
  }
  buf += decoder.decode();
  if (buf.includes('\r')) buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (buf.trim()) {
    const data = buf
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (data) yield data;
  }
}

export function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
