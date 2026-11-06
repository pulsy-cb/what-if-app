import type { Bus } from './bus.js';
import type { Db, ApprovalRow } from './db.js';

type Decision = 'approved' | 'denied' | 'timeout';

/**
 * Gate for tools whose policy is "ask": the run blocks until the human answers in the chat UI.
 * A timeout denies. Cancelling the run also denies.
 */
export class Approvals {
  private waiters = new Map<string, (d: Decision) => void>();

  constructor(private db: Db, private bus: Bus) {}

  async request(
    threadId: string,
    tool: string,
    input: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Decision> {
    const row: ApprovalRow = this.db.addApproval(threadId, tool, input);
    this.bus.emit(threadId, 'approval_request', { id: row.id, tool, input });
    return new Promise<Decision>((resolve) => {
      let done = false;
      const finish = (decision: Decision) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiters.delete(row.id);
        this.db.decideApproval(row.id, decision);
        this.bus.emit(threadId, 'approval_decided', { id: row.id, decision });
        resolve(decision);
      };
      const onAbort = () => finish('denied');
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(row.id, finish);
    });
  }

  /** Called by the HTTP layer when the human clicks approve/deny. */
  decide(approvalId: string, approve: boolean): boolean {
    const waiter = this.waiters.get(approvalId);
    if (!waiter) return false;
    waiter(approve ? 'approved' : 'denied');
    return true;
  }

  pending(): ApprovalRow[] {
    return [...this.waiters.keys()].map((id) => this.db.getApproval(id)).filter((r): r is ApprovalRow => Boolean(r));
  }
}
