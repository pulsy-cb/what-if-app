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
    buf.push(event);
    if (buf.length > this.cap) buf.splice(0, buf.length - this.cap);
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

  replay(threadId: string): AgentEvent[] {
    return [...(this.buffer.get(threadId) ?? [])];
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
