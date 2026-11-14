import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type Project = {
  id: string;
  name: string;
  root: string;
  created_at: string;
  archived_at?: string | null;
  provider?: string | null;
  model?: string | null;
  review_provider?: string | null;
  review_model?: string | null;
};

export type ProjectModelPatch = {
  provider?: string | null;
  model?: string | null;
  review_provider?: string | null;
  review_model?: string | null;
};
export type Thread = { id: string; project_id: string; title: string | null; created_at: string; archived_at?: string | null };
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
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT,
  provider TEXT, model TEXT, review_provider TEXT, review_model TEXT
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT, created_at TEXT NOT NULL, archived_at TEXT
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
  readonly dataRoot: string;

  constructor(dbPath: string) {
    this.dataRoot = dbPath === ':memory:' ? '' : path.dirname(path.resolve(dbPath));
    if (this.dataRoot) fs.mkdirSync(this.dataRoot, { recursive: true });
    this.raw = new DatabaseSync(dbPath);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA);
    this.migrate();
  }

  /** Additive migrations for databases created by an older version of the schema. */
  private migrate(): void {
    const cols = this.raw.prepare('PRAGMA table_info(project_runs)').all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === 'model')) this.raw.exec('ALTER TABLE project_runs ADD COLUMN model TEXT');

    const projCols = this.raw.prepare('PRAGMA table_info(projects)').all() as unknown as { name: string }[];
    if (!projCols.some((c) => c.name === 'archived_at')) this.raw.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
    for (const col of ['provider', 'model', 'review_provider', 'review_model'] as const) {
      if (!projCols.some((c) => c.name === col)) this.raw.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`);
    }

    const threadCols = this.raw.prepare('PRAGMA table_info(threads)').all() as unknown as { name: string }[];
    if (!threadCols.some((c) => c.name === 'archived_at')) this.raw.exec('ALTER TABLE threads ADD COLUMN archived_at TEXT');
  }

  close(): void {
    this.raw.close();
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ---------------------------------------------------------------- projects
  createProject(id: string, name: string, root: string, models?: ProjectModelPatch): Project {
    const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
    const row: Project = {
      id,
      name,
      root,
      created_at: this.now(),
      archived_at: null,
      provider: clean(models?.provider),
      model: clean(models?.model),
      review_provider: clean(models?.review_provider),
      review_model: clean(models?.review_model),
    };
    this.raw
      .prepare(
        'INSERT INTO projects (id, name, root, created_at, archived_at, provider, model, review_provider, review_model) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)',
      )
      .run(id, name, root, row.created_at, row.provider ?? null, row.model ?? null, row.review_provider ?? null, row.review_model ?? null);
    return row;
  }

  setProjectModels(id: string, patch: ProjectModelPatch): Project | null {
    const cur = this.getProject(id);
    if (!cur) return null;
    const resolveField = (next: string | null | undefined, prev: string | null | undefined) =>
      next === undefined ? (prev ?? null) : next && next.trim() ? next.trim() : null;
    const provider = resolveField(patch.provider, cur.provider);
    const model = resolveField(patch.model, cur.model);
    const reviewProvider = resolveField(patch.review_provider, cur.review_provider);
    const reviewModel = resolveField(patch.review_model, cur.review_model);
    this.raw
      .prepare('UPDATE projects SET provider = ?, model = ?, review_provider = ?, review_model = ? WHERE id = ?')
      .run(provider, model, reviewProvider, reviewModel, id);
    return this.getProject(id);
  }

  listProjects(): Project[] {
    return this.raw.prepare('SELECT * FROM projects ORDER BY created_at').all() as unknown as Project[];
  }

  getProject(id: string): Project | null {
    return (this.raw.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project) ?? null;
  }

  setProjectArchived(id: string, archived: boolean): Project | null {
    if (!this.getProject(id)) return null;
    this.raw.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(archived ? this.now() : null, id);
    return this.getProject(id);
  }

  renameProject(id: string, name: string): Project | null {
    const clean = name.trim();
    if (!clean || !this.getProject(id)) return null;
    this.raw.prepare('UPDATE projects SET name = ? WHERE id = ?').run(clean, id);
    return this.getProject(id);
  }

  projectLastActivityMap(): Map<string, string> {
    const rows = this.raw
      .prepare(
        `SELECT p.id AS project_id,
                COALESCE(MAX(m.created_at), MAX(t.created_at), p.created_at) AS last_activity_at
         FROM projects p
         LEFT JOIN threads t ON t.project_id = p.id
         LEFT JOIN messages m ON m.thread_id = t.id
         GROUP BY p.id`,
      )
      .all() as unknown as { project_id: string; last_activity_at: string }[];
    return new Map(rows.map((r) => [r.project_id, r.last_activity_at]));
  }

  deleteProject(id: string): void {
    this.raw.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ---------------------------------------------------------------- threads
  createThread(projectId: string, title: string | null = null): Thread {
    const row: Thread = { id: randomUUID(), project_id: projectId, title, created_at: this.now(), archived_at: null };
    this.raw.prepare('INSERT INTO threads (id, project_id, title, created_at, archived_at) VALUES (?, ?, ?, ?, NULL)').run(row.id, row.project_id, row.title, row.created_at);
    return row;
  }

  listThreads(projectId?: string): Thread[] {
    if (projectId) return this.raw.prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as Thread[];
    return this.raw.prepare('SELECT * FROM threads ORDER BY created_at DESC').all() as unknown as Thread[];
  }

  getThread(id: string): Thread | null {
    return (this.raw.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as Thread) ?? null;
  }

  setThreadArchived(id: string, archived: boolean): Thread | null {
    if (!this.getThread(id)) return null;
    this.raw.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(archived ? this.now() : null, id);
    return this.getThread(id);
  }

  renameThread(id: string, title: string): Thread | null {
    const clean = title.trim();
    if (!clean || !this.getThread(id)) return null;
    this.raw.prepare('UPDATE threads SET title = ? WHERE id = ?').run(clean, id);
    return this.getThread(id);
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
  addRunDuration(projectId: string, threadId: string, elapsedMs: number, steps = 0, model: string | null = null): void {
    this.raw
      .prepare('INSERT INTO project_runs (project_id, thread_id, elapsed_ms, steps, created_at, model) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, threadId, Math.max(0, Math.round(elapsedMs)), steps, this.now(), model);
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
