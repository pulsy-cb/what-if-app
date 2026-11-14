/** Per-thread event bus: SSE subscribers + a replay buffer so a reloaded page sees the run it missed. */
export type AgentEvent = {
  seq: number;
  type: string;
  data: unknown;
  at: string;
};

export class Bus {
  private seq = 0;
  private subs = new Map<string, Set<(e: AgentEvent) => void>>();
  private buffer = new Map<string, AgentEvent[]>();
  private readonly cap: number;

  constructor(cap = 400) {
    this.cap = cap;
  }

  emit(threadId: string, type: string, data: unknown): AgentEvent {
    const event: AgentEvent = { seq: ++this.seq, type, data, at: new Date().toISOString() };
    const buf = this.buffer.get(threadId) ?? [];
    const last = buf[buf.length - 1];
    // Coalesce consecutive assistant_delta chunks inside the bounded replay buffer so a 500-token stream
    // never evicts structural events (tool_call, approval_request, turn_start), while live subscribers get every delta.
    if (
      type === 'assistant_delta' &&
      last?.type === 'assistant_delta' &&
      typeof (last.data as any)?.text === 'string' &&
      typeof (data as any)?.text === 'string'
    ) {
      buf[buf.length - 1] = {
        seq: event.seq,
        type: 'assistant_delta',
        data: { text: `${(last.data as any).text}${(data as any).text}` },
        at: event.at,
      };
    } else {
      buf.push(event);
      if (buf.length > this.cap) buf.splice(0, buf.length - this.cap);
    }
    this.buffer.set(threadId, buf);
    for (const fn of this.subs.get(threadId) ?? []) {
      try {
        fn(event);
      } catch {
        /* a dead subscriber must not break the run */
      }
    }
    return event;
  }

  replay(threadId: string, afterSeq = 0): AgentEvent[] {
    const list = this.buffer.get(threadId) ?? [];
    return afterSeq > 0 ? list.filter((e) => e.seq > afterSeq) : [...list];
  }

  lastSeq(threadId?: string): number {
    if (!threadId) return this.seq;
    const list = this.buffer.get(threadId);
    return list && list.length > 0 ? list[list.length - 1]!.seq : this.seq;
  }

  subscribe(threadId: string, fn: (e: AgentEvent) => void): () => void {
    const set = this.subs.get(threadId) ?? new Set();
    set.add(fn);
    this.subs.set(threadId, set);
    return () => {
      set.delete(fn);
    };
  }

  clear(threadId: string): void {
    this.buffer.delete(threadId);
  }
}
