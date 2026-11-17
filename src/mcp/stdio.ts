#!/usr/bin/env node
/**
 * Stdio MCP Server for What If Studio (`whatif-studio`).
 *
 * Bridges Antigravity (`agy`) CLI — and its Independent Reviewer subagents — directly to the
 * running Studio container (`http://127.0.0.1:3000`), giving native host `agy` sessions:
 *   - 100% of the Studio's tools, TypeScript/SSR/layout audits, `:8005` TTS/ASR, and Modal cloud rendering,
 *   - zero cold `agy -p` subprocess overhead,
 *   - automatic translation of container `/data/projects/...` paths into real host paths so `agy` and its
 *     Reviewer subagent can `read_file` contact sheets (`sheet-*.jpg`) and high-res stills (`S*.png`) directly.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultRegistry } from '../tools/index.js';
import { listMcpTools, type McpToolResponse } from './service.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST_DATA_DIR = process.env.WHATIF_HOST_DATA || path.join(APP_ROOT, 'data');

function readDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch {
    /* optional .env */
  }
  return out;
}

const dotEnv = readDotEnv(path.join(APP_ROOT, '.env'));
const STUDIO_PORT = Number(process.env.WHATIF_PORT || dotEnv.WHATIF_PORT || 3000);
const STUDIO_HOST = process.env.WHATIF_STUDIO_HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.WHATIF_AUTH_TOKEN || dotEnv.WHATIF_AUTH_TOKEN || '';

function toHostPath(containerPath: string, containerDataRoot = '/data'): string {
  const cleanRoot = containerDataRoot.replace(/\/+$/, '') || '/data';
  if (containerPath === cleanRoot) return HOST_DATA_DIR;
  if (containerPath.startsWith(`${cleanRoot}/`)) {
    return path.join(HOST_DATA_DIR, containerPath.slice(cleanRoot.length + 1));
  }
  return containerPath;
}

function rewriteContainerPaths(text: string, containerDataRoot = '/data'): string {
  const cleanRoot = containerDataRoot.replace(/\/+$/, '') || '/data';
  if (!cleanRoot || cleanRoot === HOST_DATA_DIR) return text;
  const escaped = cleanRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}(?=/|\\b)`, 'g'), HOST_DATA_DIR);
}

function httpJson<T>(method: 'GET' | 'POST', urlPath: string, body?: unknown, timeoutMs = 3_660_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const headers: Record<string, string | number> = {
      Accept: 'application/json',
      Origin: `http://${STUDIO_HOST}:${STUDIO_PORT}`,
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    if (AUTH_TOKEN) {
      headers['X-Whatif-Token'] = AUTH_TOKEN;
    }

    const req = http.request(
      {
        hostname: STUDIO_HOST,
        port: STUDIO_PORT,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Studio HTTP ${res.statusCode} on ${urlPath}: ${raw.slice(0, 400)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch (err) {
            reject(new Error(`Invalid JSON from Studio on ${urlPath}: ${(err as Error).message}`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Studio request timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchToolsList() {
  try {
    const remote = await httpJson<{ tools: ReturnType<typeof listMcpTools> }>('GET', '/api/mcp-tools', undefined, 5_000);
    if (Array.isArray(remote?.tools) && remote.tools.length) return remote.tools;
  } catch {
    /* fallback to compiled local tool schemas if container is restarting */
  }
  return listMcpTools(defaultRegistry());
}

function dockerExecFallback(name: string, args: Record<string, unknown>, timeoutMs = 3_660_000): Promise<McpToolResponse & { dataRoot?: string }> {
  const container = process.env.WHATIF_CONTAINER_NAME || 'what-if-app-studio-1';
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'node', '/app/dist/mcp/docker-exec.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`docker exec fallback timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (c) => outChunks.push(c as Buffer));
    child.stderr.on('data', (c) => errChunks.push(c as Buffer));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const marker = stdout.split('\n').filter((l) => l.startsWith('RESULT_MCP_JSON:')).pop();
      if (marker) {
        try {
          resolve(JSON.parse(marker.slice('RESULT_MCP_JSON:'.length)));
          return;
        } catch (err) {
          reject(err);
          return;
        }
      }
      reject(new Error(`docker exec fallback exited ${code}: ${Buffer.concat(errChunks).toString('utf8').slice(0, 400)}`));
    });
    child.stdin.write(JSON.stringify({ name, arguments: args }));
    child.stdin.end();
  });
}

async function executeStudioTool(name: string, args: Record<string, unknown>) {
  try {
    let resp: McpToolResponse & { dataRoot?: string };
    try {
      resp = await httpJson<McpToolResponse & { dataRoot?: string }>('POST', '/api/mcp-tool', {
        name,
        arguments: args,
      });
    } catch (httpErr) {
      const em = httpErr instanceof Error ? httpErr.message : String(httpErr);
      if (/HTTP 404/.test(em)) {
        resp = await dockerExecFallback(name, args);
      } else {
        throw httpErr;
      }
    }
    const containerDataRoot = resp.dataRoot || '/data';
    const hostProjectRoot = resp.projectRoot ? toHostPath(resp.projectRoot, containerDataRoot) : '';

    const extraLines: string[] = [];
    if (hostProjectRoot) {
      extraLines.push(`hostProjectRoot: ${hostProjectRoot}`);
    }
    const dataObj = resp.data && typeof resp.data === 'object' ? (resp.data as Record<string, unknown>) : null;
    if (hostProjectRoot && dataObj && Array.isArray(dataObj.relativeImagePaths)) {
      const hostImages = dataObj.relativeImagePaths.map((rel) => path.join(hostProjectRoot, String(rel)));
      extraLines.push(`hostImagePaths (inspect with read_file):\n${hostImages.map((p) => `- ${p}`).join('\n')}`);
    }
    if (hostProjectRoot && Array.isArray(resp.artifacts) && resp.artifacts.length) {
      const hostArts = resp.artifacts.slice(0, 20).map((a) => path.join(hostProjectRoot, a.path));
      extraLines.push(`hostArtifacts:\n${hostArts.map((p) => `- ${p}`).join('\n')}`);
    }

    const summaryText = rewriteContainerPaths(resp.summary || '', containerDataRoot);
    const fullText = [summaryText, ...extraLines].filter(Boolean).join('\n\n');

    return {
      isError: !resp.ok,
      content: [{ type: 'text', text: fullText }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `Failed to reach What If Studio container on http://${STUDIO_HOST}:${STUDIO_PORT} (${msg}).\n` +
            `Make sure the Studio container is running (` +
            `cd ${APP_ROOT} && docker compose up -d` +
            `).`,
        },
      ],
    };
  }
}

type FramingMode = 'newline' | 'content-length';
let responseFraming: FramingMode = 'newline';

function sendJsonRpc(msg: Record<string, unknown>): void {
  const json = JSON.stringify(msg);
  if (responseFraming === 'content-length') {
    const byteLen = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function handleJsonRpcMessage(msg: any): Promise<void> {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      const clientProto = String(params?.protocolVersion ?? '2024-11-05');
      const supported = ['2025-06-18', '2025-03-26', '2024-11-05'];
      const protocolVersion = supported.includes(clientProto) ? clientProto : '2024-11-05';
      if (!isNotification) {
        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'whatif-studio', version: '1.0.0' },
          },
        });
      }
      return;
    }

    if (method === 'ping') {
      if (!isNotification) sendJsonRpc({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      const tools = await fetchToolsList();
      if (!isNotification) {
        sendJsonRpc({ jsonrpc: '2.0', id, result: { tools } });
      }
      return;
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name ?? '');
      const toolArgs = params?.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
      const result = await executeStudioTool(toolName, toolArgs);
      if (!isNotification) {
        sendJsonRpc({ jsonrpc: '2.0', id, result });
      }
      return;
    }

    if (method === 'resources/list') {
      if (!isNotification) sendJsonRpc({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    }

    if (method === 'prompts/list') {
      if (!isNotification) sendJsonRpc({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return;
    }

    if (!isNotification) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${String(method)}` },
      });
    }
  } catch (err) {
    if (!isNotification) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

let buffer = Buffer.alloc(0);

function drainBuffer(): void {
  while (buffer.length > 0) {
    // Skip leading CR/LF whitespace between frames
    let start = 0;
    while (start < buffer.length && (buffer[start] === 0x0d || buffer[start] === 0x0a || buffer[start] === 0x20 || buffer[start] === 0x09)) {
      start++;
    }
    if (start > 0) buffer = buffer.subarray(start);
    if (!buffer.length) return;

    // 1) Content-Length header framing
    if (buffer.subarray(0, 15).toString('ascii').toLowerCase().startsWith('content-length:')) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      const altEnd = headerEnd < 0 ? buffer.indexOf('\n\n') : -1;
      const sepIdx = headerEnd >= 0 ? headerEnd : altEnd;
      const sepLen = headerEnd >= 0 ? 4 : 2;
      if (sepIdx < 0) return; // wait for full header
      const headerStr = buffer.subarray(0, sepIdx).toString('ascii');
      const m = /content-length:\s*(\d+)/i.exec(headerStr);
      if (!m) {
        buffer = buffer.subarray(sepIdx + sepLen);
        continue;
      }
      const len = Number(m[1]);
      if (buffer.length < sepIdx + sepLen + len) return; // wait for body
      const bodyStr = buffer.subarray(sepIdx + sepLen, sepIdx + sepLen + len).toString('utf8');
      buffer = buffer.subarray(sepIdx + sepLen + len);
      responseFraming = 'content-length';
      try {
        const parsed = JSON.parse(bodyStr);
        void handleJsonRpcMessage(parsed);
      } catch {
        /* ignore malformed frame */
      }
      continue;
    }

    // 2) Standard MCP newline-delimited JSON framing
    const nl = buffer.indexOf(0x0a);
    if (nl < 0) return; // wait for newline
    const line = buffer.subarray(0, nl).toString('utf8').trim();
    buffer = buffer.subarray(nl + 1);
    if (!line) continue;
    responseFraming = 'newline';
    try {
      const parsed = JSON.parse(line);
      void handleJsonRpcMessage(parsed);
    } catch {
      /* ignore malformed line */
    }
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
});

process.stdin.resume();
