import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.js';
import { Db } from './db.js';
import { Bus } from './bus.js';
import { Approvals } from './approvals.js';
import { defaultRegistry, type ToolContext, type ToolRegistry } from '../tools/index.js';
import { PROVIDER_PRESETS, providerConfig, resolveProvider } from './providers/index.js';
import { runTurn } from './agent.js';
import { mimeOf, safeJoin, walk } from '../tools/paths.js';

const MAX_BODY = 12 * 1024 * 1024;

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(buf);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

export type App = {
  server: http.Server;
  db: Db;
  bus: Bus;
  config: Config;
  registry: ToolRegistry;
  approvals: Approvals;
  close: () => Promise<void>;
};

export function createApp(config: Config = loadConfig()): App {
  const db = new Db(config.dbPath);
  const bus = new Bus();
  const registry = defaultRegistry();
  const approvals = new Approvals(db, bus);
  const running = new Map<string, AbortController>();

  const toolContext = (projectId: string, threadId: string, signal?: AbortSignal): ToolContext => {
    const project = db.getProject(projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    return {
      projectId,
      projectRoot: project.root,
      dataRoot: config.dataRoot,
      skillDir: config.skillDir,
      log: (line) => bus.emit(threadId, 'log', { line }),
      signal,
    };
  };

  const authorised = (url: URL, req: http.IncomingMessage): boolean => {
    if (!config.authToken) return true;
    const header = req.headers['x-whatif-token'];
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return url.searchParams.get('token') === config.authToken || header === config.authToken || bearer === config.authToken;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method ?? 'GET';

    try {
      if (pathname.startsWith('/api/')) {
        if (!authorised(url, req)) return json(res, 401, { error: 'unauthorized' });
        return await api(method, pathname, url, req, res);
      }
      return serveStatic(pathname, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) json(res, 500, { error: message });
      else res.end();
    }
  });

  // ---------------------------------------------------------------- static
  function serveStatic(pathname: string, res: http.ServerResponse): void {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let abs = path.join(config.webDir, rel);
    if (!abs.startsWith(config.webDir)) return json(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) abs = path.join(config.webDir, 'index.html');
    if (!fs.existsSync(abs)) return json(res, 404, { error: 'not found' });
    const data = fs.readFileSync(abs);
    res.writeHead(200, { 'content-type': `${mimeOf(abs)}; charset=utf-8`, 'cache-control': 'no-cache' });
    res.end(data);
  }

  // ---------------------------------------------------------------- api
  async function api(method: string, pathname: string, url: URL, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parts = pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[1] === 'health') return json(res, 200, { ok: true, skillDir: config.skillDir, node: process.version });

    // ---- settings
    if (parts[1] === 'settings') {
      if (method === 'GET') {
        const cfg = providerConfig(db);
        return json(res, 200, {
          provider: cfg.provider,
          baseURL: cfg.baseURL,
          model: cfg.model,
          hasKey: Boolean(cfg.apiKey),
          presets: PROVIDER_PRESETS,
          skillDir: config.skillDir,
          maxSteps: config.maxSteps,
        });
      }
      if (method === 'POST') {
        const body = await readJson(req);
        for (const key of ['provider', 'baseURL', 'model'] as const) {
          if (typeof body[key] === 'string' && body[key]) db.setSetting(key, body[key]);
        }
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) db.setSetting('apiKey', body.apiKey.trim());
        if (body.clearKey === true) db.setSetting('apiKey', '');
        return json(res, 200, { ok: true });
      }
    }

    // ---- providers (models you can pick, for the UI)
    if (parts[1] === 'presets') return json(res, 200, PROVIDER_PRESETS);

    // ---- projects
    if (parts[1] === 'projects') {
      if (method === 'GET' && parts.length === 2) {
        return json(res, 200, db.listProjects().map((p) => ({ ...p, credits: db.creditsSpent(p.id) })));
      }
      if (method === 'POST' && parts.length === 2) {
        const body = await readJson(req);
        const name = String(body.name ?? body.id ?? 'projet');
        const id = slugify(String(body.id ?? name));
        if (db.getProject(id)) return json(res, 409, { error: `project ${id} already exists` });
        const root = path.join(config.projectsDir, id);
        let toolResult = null;
        if (body.episode) {
          fs.mkdirSync(root, { recursive: true });
          toolResult = await registry.run(
            'whatif_new',
            { episode: String(body.episode), force: true },
            { projectId: id, projectRoot: root, dataRoot: config.dataRoot, skillDir: config.skillDir, log: () => {} },
          );
        } else {
          fs.mkdirSync(root, { recursive: true });
          if (!fs.existsSync(path.join(root, 'PROJECT.md'))) {
            fs.writeFileSync(path.join(root, 'PROJECT.md'), `# ${name}\n\n- created ${new Date().toISOString()}\n`);
          }
        }
        const project = db.createProject(id, name, root);
        bus.emit('global', 'projects_changed', { id });
        return json(res, 201, { project, tool: toolResult });
      }
      if (method === 'GET' && parts[2] && parts[3] === 'files') {
        const project = db.getProject(parts[2]);
        if (!project) return json(res, 404, { error: 'no such project' });
        return json(res, 200, { files: walk(project.root, { maxFiles: 800 }) });
      }
      if (method === 'GET' && parts[2] && parts[3] === 'credits') {
        return json(res, 200, { credits: db.creditsSpent(parts[2]) });
      }
    }

    // ---- threads
    if (parts[1] === 'threads') {
      if (method === 'GET' && parts.length === 2) {
        return json(res, 200, db.listThreads(url.searchParams.get('projectId') ?? undefined));
      }
      if (method === 'POST' && parts.length === 2) {
        const body = await readJson(req);
        const project = db.getProject(String(body.projectId ?? ''));
        if (!project) return json(res, 400, { error: 'unknown project' });
        const thread = db.createThread(project.id, body.title ? String(body.title) : null);
        return json(res, 201, thread);
      }
      const threadId = parts[2];
      const thread = threadId ? db.getThread(threadId) : null;
      if (threadId && !thread) return json(res, 404, { error: 'no such thread' });

      if (method === 'GET' && parts[3] === 'messages') {
        const messages = db.listMessages(threadId!).map((m) => ({ ...m, payload: m.payload ? JSON.parse(m.payload) : null }));
        return json(res, 200, { thread, messages, pending: db.pendingApprovals(threadId!), running: running.has(threadId!) });
      }

      if (method === 'POST' && parts[3] === 'messages') {
        if (running.has(threadId!)) return json(res, 409, { error: 'the agent is already running on this thread' });
        const body = await readJson(req);
        const text = String(body.text ?? '').trim();
        if (!text) return json(res, 400, { error: 'empty message' });
        const id = db.addMessage(threadId!, 'user', text);
        bus.emit(threadId!, 'user_message', { id, text });
        if (!thread!.title) {
          db.raw.prepare('UPDATE threads SET title = ? WHERE id = ?').run(text.slice(0, 80), threadId!);
        }
        const controller = new AbortController();
        running.set(threadId!, controller);
        void runTurn(
          { db, bus, config, registry, approvals, provider: () => resolveProvider(db) },
          threadId!,
          controller.signal,
        ).finally(() => running.delete(threadId!));
        return json(res, 202, { ok: true });
      }

      if (method === 'POST' && parts[3] === 'stop') {
        running.get(threadId!)?.abort();
        return json(res, 200, { ok: true });
      }

      if (method === 'GET' && parts[3] === 'events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        const write = (e: { seq: number; type: string; data: unknown }) => {
          res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
        };
        write({ seq: 0, type: 'hello', data: { threadId, running: running.has(threadId!) } });
        for (const e of bus.replay(threadId!)) write(e);
        const unsubscribe = bus.subscribe(threadId!, write);
        const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => {
          clearInterval(ping);
          unsubscribe();
        });
        return;
      }
    }

    // ---- approvals
    if (parts[1] === 'approvals' && parts[2] && method === 'POST') {
      const body = await readJson(req);
      const row = db.getApproval(parts[2]);
      if (!row) return json(res, 404, { error: 'no such approval' });
      const accepted = approvals.decide(parts[2], body.approve === true);
      return json(res, 200, { ok: accepted, decision: body.approve === true ? 'approved' : 'denied' });
    }

    // ---- files (artifacts) with Range support for video
    if (parts[1] === 'file' && method === 'GET') {
      const project = db.getProject(url.searchParams.get('project') ?? '');
      if (!project) return json(res, 404, { error: 'unknown project' });
      const rel = url.searchParams.get('path') ?? '';
      let abs: string;
      try {
        abs = safeJoin(project.root, rel);
      } catch {
        return json(res, 403, { error: 'forbidden path' });
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return json(res, 404, { error: 'no such file' });
      const stat = fs.statSync(abs);
      const type = mimeOf(abs);
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : stat.size - 1;
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        });
        fs.createReadStream(abs, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' });
      fs.createReadStream(abs).pipe(res);
      return;
    }

    json(res, 404, { error: `no route for ${method} ${pathname}` });
  }

  const close = async () => {
    for (const c of running.values()) c.abort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  };

  return { server, db, bus, config, registry, approvals, close };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp(config);
  await new Promise<void>((resolve) => app.server.listen(config.port, config.host, resolve));
  const skill = config.skillDir ? config.skillDir : '(not found — set WHATIF_SKILL_DIR)';
  console.log(`what-if-app  http://${config.host}:${config.port}`);
  console.log(`  data      ${config.dataRoot}`);
  console.log(`  skill     ${skill}`);
  console.log(`  provider  ${providerConfig(app.db).provider} / ${providerConfig(app.db).model}`);
  const shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) void main();
