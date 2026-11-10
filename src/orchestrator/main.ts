import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.js';
import { Db } from './db.js';
import { Bus } from './bus.js';
import { Approvals } from './approvals.js';
import { defaultRegistry, type ToolContext, type ToolRegistry } from '../tools/index.js';
import {
  PROVIDER_MODEL_CATALOG,
  PROVIDER_PRESETS,
  hasAgyCli,
  hasCodexAuth,
  providerConfig,
  resolveProvider,
  resolveReviewProvider,
  reviewProviderConfig,
} from './providers/index.js';
import { runTurn } from './agent.js';
import { mimeOf, safeJoin, walk } from '../tools/paths.js';

function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
  const running = new Map<string, { controller: AbortController; startedAt: number }>();

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
    const header = String(req.headers['x-whatif-token'] ?? '');
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const qToken = url.searchParams.get('token') ?? '';
    return (
      (header.length > 0 && safeTokenEqual(header, config.authToken)) ||
      (bearer.length > 0 && safeTokenEqual(bearer, config.authToken)) ||
      (qToken.length > 0 && safeTokenEqual(qToken, config.authToken))
    );
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
    const webRoot = path.resolve(config.webDir);
    let abs = path.resolve(webRoot, rel);
    if (abs !== webRoot && !abs.startsWith(webRoot + path.sep)) return json(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      // Return 404 for missing asset extensions (.js, .css, .png, etc.), only SPA-fallback extensionless routes
      if (path.extname(rel)) return json(res, 404, { error: 'not found' });
      abs = path.join(webRoot, 'index.html');
    }
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
        const revCfg = reviewProviderConfig(db);
        const codexReady = hasCodexAuth();
        const agyReady = hasAgyCli();
        return json(res, 200, {
          provider: cfg.provider,
          baseURL: cfg.baseURL,
          model: cfg.model,
          hasKey: cfg.provider === 'codex' ? codexReady : cfg.provider === 'agy' ? agyReady : Boolean(cfg.apiKey),
          codexReady,
          agyReady,
          reviewer: revCfg ? { provider: revCfg.provider, model: revCfg.model, baseURL: revCfg.baseURL } : null,
          presets: PROVIDER_PRESETS,
          catalog: PROVIDER_MODEL_CATALOG,
          skillDir: config.skillDir,
          maxSteps: config.maxSteps,
        });
      }
      if (method === 'POST') {
        const body = await readJson(req);
        for (const key of ['provider', 'baseURL', 'model', 'reviewProvider', 'reviewBaseURL', 'reviewModel', 'reviewerEnabled'] as const) {
          if (typeof body[key] === 'string') db.setSetting(key, body[key].trim());
        }
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) db.setSetting('apiKey', body.apiKey.trim());
        if (body.clearKey === true) db.setSetting('apiKey', '');
        if (typeof body.reviewApiKey === 'string' && body.reviewApiKey.trim()) db.setSetting('reviewApiKey', body.reviewApiKey.trim());
        return json(res, 200, { ok: true });
      }
    }

    // ---- providers (models you can pick, for the UI)
    if (parts[1] === 'presets') return json(res, 200, PROVIDER_PRESETS);

    // ---- projects
    if (parts[1] === 'projects') {
      const enrichProject = (p: ReturnType<typeof db.listProjects>[number], activityMap?: Map<string, string>) => {
        const pThreads = db.listThreads(p.id);
        const activeRun = pThreads.map((t) => running.get(t.id)).find(Boolean) ?? null;
        const timing = db.projectTiming(p.id);
        const archivedThreadCount = pThreads.filter((t) => Boolean(t.archived_at)).length;
        const effAgent = providerConfig(db, p);
        const effRev = reviewProviderConfig(db, p);
        return {
          ...p,
          archived_at: p.archived_at ?? null,
          provider: p.provider ?? null,
          model: p.model ?? null,
          review_provider: p.review_provider ?? null,
          review_model: p.review_model ?? null,
          effectiveModel: {
            provider: effAgent.provider,
            model: effAgent.model,
            reviewProvider: effRev?.provider ?? null,
            reviewModel: effRev?.model ?? null,
          },
          lastActivityAt: activityMap?.get(p.id) ?? p.created_at,
          threadCount: pThreads.length - archivedThreadCount,
          archivedThreadCount,
          credits: db.creditsSpent(p.id),
          running: Boolean(activeRun),
          startedAt: activeRun?.startedAt ?? null,
          elapsedMs: timing.totalMs,
          lastRunMs: timing.lastRunMs,
        };
      };

      if (method === 'GET' && parts.length === 2) {
        const activityMap = db.projectLastActivityMap();
        return json(
          res,
          200,
          db.listProjects().map((p) => enrichProject(p, activityMap)),
        );
      }
      if (
        (method === 'PATCH' && parts.length === 3 && parts[2]) ||
        (method === 'POST' && parts.length === 4 && parts[2] && parts[3] === 'archive')
      ) {
        const projectId = parts[2];
        let project = db.getProject(projectId);
        if (!project) return json(res, 404, { error: 'no such project' });
        const body = await readJson(req);
        if (typeof body.name === 'string' && body.name.trim()) {
          project = db.renameProject(projectId, body.name) ?? project;
        }
        if (typeof body.archived === 'boolean') {
          project = db.setProjectArchived(projectId, body.archived) ?? project;
        }
        if ('provider' in body || 'model' in body || 'reviewProvider' in body || 'reviewModel' in body || 'review_provider' in body || 'review_model' in body) {
          project =
            db.setProjectModels(projectId, {
              ...('provider' in body ? { provider: body.provider == null ? null : String(body.provider) } : {}),
              ...('model' in body ? { model: body.model == null ? null : String(body.model) } : {}),
              ...('reviewProvider' in body || 'review_provider' in body
                ? { review_provider: (body.reviewProvider ?? body.review_provider) == null ? null : String(body.reviewProvider ?? body.review_provider) }
                : {}),
              ...('reviewModel' in body || 'review_model' in body
                ? { review_model: (body.reviewModel ?? body.review_model) == null ? null : String(body.reviewModel ?? body.review_model) }
                : {}),
            }) ?? project;
        }
        bus.emit('global', 'projects_changed', { id: projectId });
        return json(res, 200, enrichProject(project, db.projectLastActivityMap()));
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
            {
              episode: String(body.episode),
              force: true,
              ...(body.video ? { video: String(body.video) } : {}),
              ...(body.aspect ? { aspect: String(body.aspect) } : {}),
            },
            { projectId: id, projectRoot: root, dataRoot: config.dataRoot, skillDir: config.skillDir, log: () => {} },
          );
        } else {
          fs.mkdirSync(root, { recursive: true });
          if (!fs.existsSync(path.join(root, 'PROJECT.md'))) {
            fs.writeFileSync(path.join(root, 'PROJECT.md'), `# ${name}\n\n- created ${new Date().toISOString()}\n`);
          }
        }
        const project = db.createProject(id, name, root, {
          provider: typeof body.provider === 'string' ? body.provider : null,
          model: typeof body.model === 'string' ? body.model : null,
          review_provider: typeof body.reviewProvider === 'string' ? body.reviewProvider : null,
          review_model: typeof body.reviewModel === 'string' ? body.reviewModel : null,
        });
        bus.emit('global', 'projects_changed', { id });
        return json(res, 201, { project: enrichProject(project, db.projectLastActivityMap()), tool: toolResult });
      }
      if (method === 'GET' && parts[2] && parts[3] === 'files') {
        const project = db.getProject(parts[2]);
        if (!project) return json(res, 404, { error: 'no such project' });
        return json(res, 200, { files: walk(project.root, { maxFiles: 800 }) });
      }
      if (method === 'GET' && parts[2] && parts[3] === 'artifacts') {
        const project = db.getProject(parts[2]);
        if (!project) return json(res, 404, { error: 'no such project' });
        // walk() skips out/ on purpose (build output, not source): the deliverables need their own listing
        const outDir = path.join(project.root, 'out');
        const files = fs.existsSync(outDir)
          ? walk(outDir, { maxFiles: 400, includeBinary: true, maxBytes: 300 * 1024 * 1024 })
              .filter((rel) => /\.(mp4|jpg|jpeg|png|wav|json)$/i.test(rel))
              .map((rel) => {
                const st = fs.statSync(path.join(outDir, rel));
                return { path: `out/${rel}`, name: path.basename(rel), size: st.size, mtime: st.mtimeMs };
              })
              .sort((a, b) => b.mtime - a.mtime)
          : [];
        return json(res, 200, { files });
      }
      if (method === 'GET' && parts[2] && parts[3] === 'credits') {
        return json(res, 200, { credits: db.creditsSpent(parts[2]) });
      }
    }

    // ---- threads
    if (parts[1] === 'threads') {
      if (method === 'GET' && parts.length === 2) {
        const list = db.listThreads(url.searchParams.get('projectId') ?? undefined);
        return json(res, 200, list.map((t) => ({ ...t, archived_at: t.archived_at ?? null, running: running.has(t.id) })));
      }
      if (method === 'POST' && parts.length === 2) {
        const body = await readJson(req);
        const project = db.getProject(String(body.projectId ?? ''));
        if (!project) return json(res, 400, { error: 'unknown project' });
        const thread = db.createThread(project.id, body.title ? String(body.title) : null);
        return json(res, 201, { ...thread, archived_at: thread.archived_at ?? null, running: false });
      }
      const threadId = parts[2];
      let thread = threadId ? db.getThread(threadId) : null;
      if (threadId && !thread) return json(res, 404, { error: 'no such thread' });

      if (
        (method === 'PATCH' && parts.length === 3 && threadId) ||
        (method === 'POST' && parts.length === 4 && threadId && parts[3] === 'archive')
      ) {
        const body = await readJson(req);
        if (typeof body.title === 'string' && body.title.trim()) {
          thread = db.renameThread(threadId, body.title) ?? thread;
        }
        if (typeof body.archived === 'boolean') {
          thread = db.setThreadArchived(threadId, body.archived) ?? thread;
        }
        return json(res, 200, { ...thread!, archived_at: thread!.archived_at ?? null, running: running.has(threadId) });
      }

      if (method === 'GET' && parts[3] === 'messages') {
        const messages = db.listMessages(threadId!).map((m) => ({ ...m, payload: m.payload ? JSON.parse(m.payload) : null }));
        const activeRun = running.get(threadId!);
        const timing = db.projectTiming(thread!.project_id);
        return json(res, 200, {
          thread,
          messages,
          pending: db.pendingApprovals(threadId!),
          running: Boolean(activeRun),
          startedAt: activeRun?.startedAt ?? null,
          elapsedMs: timing.totalMs,
          lastRunMs: timing.lastRunMs,
        });
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
        const startedAt = Date.now();
        running.set(threadId!, { controller, startedAt });
        void runTurn(
          {
            db,
            bus,
            config,
            registry,
            approvals,
            provider: () => resolveProvider(db, db.getProject(thread!.project_id)),
            reviewProvider: () => resolveReviewProvider(db, db.getProject(thread!.project_id)),
          },
          threadId!,
          controller.signal,
        ).finally(() => running.delete(threadId!));
        return json(res, 202, { ok: true, startedAt });
      }

      if (method === 'POST' && parts[3] === 'stop') {
        running.get(threadId!)?.controller.abort();
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
        const activeRun = running.get(threadId!);
        const timing = db.projectTiming(thread!.project_id);
        write({
          seq: 0,
          type: 'hello',
          data: {
            threadId,
            running: Boolean(activeRun),
            startedAt: activeRun?.startedAt ?? null,
            elapsedMs: timing.totalMs,
            lastRunMs: timing.lastRunMs,
          },
        });
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

    // ---- pending approvals (a reload used to lose the buttons while the run stayed blocked)
    if (parts[1] === 'approvals' && method === 'GET') {
      const threadId = url.searchParams.get('thread') ?? '';
      const rows = threadId ? db.pendingApprovals(threadId) : db.pendingApprovalsAll();
      return json(
        res,
        200,
        rows.map((a) => ({ id: a.id, threadId: a.thread_id, tool: a.tool, input: JSON.parse(a.input) })),
      );
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
    for (const c of running.values()) c.controller.abort();
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
