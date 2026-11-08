import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type Project = { id: string; name: string; root: string; created_at: string };
export type Thread = { id: string; project_id: string; title: string | null; created_at: string };
export type MessageRow = {
  id: number;
  thread_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  payload: string | null;
  created_at: string;
};
export type ApprovalRow = {
  id: string;
  thread_id: string;
  tool: string;
  input: string;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  created_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, thread_id TEXT, tool TEXT,
  credits INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL, steps INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
`;

export class Db {
  readonly raw: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.raw = new DatabaseSync(dbPath);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA);
  }

  close(): void {
    this.raw.close();
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ---------------------------------------------------------------- projects
  createProject(id: string, name: string, root: string): Project {
    const row: Project = { id, name, root, created_at: this.now() };
    this.raw.prepare('INSERT INTO projects (id, name, root, created_at) VALUES (?, ?, ?, ?)').run(id, name, root, row.created_at);
    return row;
  }

  listProjects(): Project[] {
    return this.raw.prepare('SELECT * FROM projects ORDER BY created_at').all() as unknown as Project[];
  }

  getProject(id: string): Project | null {
    return (this.raw.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project) ?? null;
  }

  deleteProject(id: string): void {
    this.raw.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ---------------------------------------------------------------- threads
  createThread(projectId: string, title: string | null = null): Thread {
    const row: Thread = { id: randomUUID(), project_id: projectId, title, created_at: this.now() };
    this.raw.prepare('INSERT INTO threads (id, project_id, title, created_at) VALUES (?, ?, ?, ?)').run(row.id, row.project_id, row.title, row.created_at);
    return row;
  }

  listThreads(projectId?: string): Thread[] {
    if (projectId) return this.raw.prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as Thread[];
    return this.raw.prepare('SELECT * FROM threads ORDER BY created_at DESC').all() as unknown as Thread[];
  }

  getThread(id: string): Thread | null {
    return (this.raw.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as Thread) ?? null;
  }

  // ---------------------------------------------------------------- messages
  addMessage(threadId: string, role: MessageRow['role'], content: string, payload?: unknown): number {
    const info = this.raw
      .prepare('INSERT INTO messages (thread_id, role, content, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(threadId, role, content, payload === undefined ? null : JSON.stringify(payload), this.now());
    return Number(info.lastInsertRowid);
  }

  listMessages(threadId: string): MessageRow[] {
    return this.raw.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(threadId) as unknown as MessageRow[];
  }

  // ---------------------------------------------------------------- approvals
  addApproval(threadId: string, tool: string, input: unknown): ApprovalRow {
    const row: ApprovalRow = {
      id: randomUUID(), thread_id: threadId, tool, input: JSON.stringify(input), status: 'pending', created_at: this.now(),
    };
    this.raw.prepare('INSERT INTO approvals (id, thread_id, tool, input, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.thread_id, row.tool, row.input, row.status, row.created_at);
    return row;
  }

  getApproval(id: string): ApprovalRow | null {
    return (this.raw.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as unknown as ApprovalRow) ?? null;
  }

  decideApproval(id: string, status: ApprovalRow['status']): void {
    this.raw.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?').run(status, this.now(), id);
  }

  pendingApprovals(threadId: string): ApprovalRow[] {
    return this.raw
      .prepare("SELECT * FROM approvals WHERE thread_id = ? AND status = 'pending' ORDER BY created_at")
      .all(threadId) as unknown as ApprovalRow[];
  }

  pendingApprovalsAll(): ApprovalRow[] {
    return this.raw
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at")
      .all() as unknown as ApprovalRow[];
  }

  // ---------------------------------------------------------------- settings
  getSetting(key: string): string | null {
    const row = this.raw.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  settings(): Record<string, string> {
    const rows = this.raw.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ---------------------------------------------------------------- credits
  addCredits(projectId: string, threadId: string, tool: string, credits: number): void {
    this.raw.prepare('INSERT INTO ledger (project_id, thread_id, tool, credits, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, threadId, tool, credits, this.now());
  }

  creditsSpent(projectId: string): number {
    const row = this.raw.prepare('SELECT COALESCE(SUM(credits), 0) AS total FROM ledger WHERE project_id = ?').get(projectId) as unknown as { total: number };
    return Number(row?.total ?? 0);
  }

  // ---------------------------------------------------------------- run timings
  addRunDuration(projectId: string, threadId: string, elapsedMs: number, steps = 0): void {
    this.raw
      .prepare('INSERT INTO project_runs (project_id, thread_id, elapsed_ms, steps, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, threadId, Math.max(0, Math.round(elapsedMs)), steps, this.now());
  }

  projectTiming(projectId: string): { totalMs: number; lastRunMs: number } {
    const agg = this.raw
      .prepare('SELECT COALESCE(SUM(elapsed_ms), 0) AS total, COUNT(*) AS cnt FROM project_runs WHERE project_id = ?')
      .get(projectId) as unknown as { total: number; cnt: number } | undefined;
    const last = this.raw
      .prepare('SELECT elapsed_ms FROM project_runs WHERE project_id = ? ORDER BY id DESC LIMIT 1')
      .get(projectId) as unknown as { elapsed_ms: number } | undefined;
    if (agg && Number(agg.cnt) > 0) {
      return { totalMs: Number(agg.total ?? 0), lastRunMs: Number(last?.elapsed_ms ?? 0) };
    }
    // Fallback for projects created before project_runs existed: span between first and last message across the project's threads
    const span = this.raw
      .prepare(
        `SELECT MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at, COUNT(m.id) AS cnt
         FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.project_id = ?`,
      )
      .get(projectId) as unknown as { first_at: string | null; last_at: string | null; cnt: number } | undefined;
    if (span && Number(span.cnt) >= 2 && span.first_at && span.last_at) {
      const diff = Math.max(0, Date.parse(span.last_at) - Date.parse(span.first_at));
      return { totalMs: diff, lastRunMs: diff };
    }
    return { totalMs: 0, lastRunMs: 0 };
  }
}
