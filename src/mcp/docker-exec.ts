#!/usr/bin/env node
/**
 * Zero-downtime helper executed via `docker exec -i what-if-app-studio-1 node /app/dist/mcp/docker-exec.js`
 * when the live container has not yet been restarted onto the HTTP `/api/mcp-tool` build (e.g. while other
 * episodes are actively rendering).
 */
import { loadConfig } from '../orchestrator/config.js';
import { Db } from '../orchestrator/db.js';
import { Bus } from '../orchestrator/bus.js';
import { defaultRegistry } from '../tools/index.js';
import { callMcpTool } from './service.js';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const config = loadConfig();
  const db = new Db(config.dbPath);
  const bus = new Bus();
  const registry = defaultRegistry();
  try {
    const res = await callMcpTool(
      { db, bus, config, registry },
      String(body.name ?? ''),
      body.arguments && typeof body.arguments === 'object' ? (body.arguments as Record<string, unknown>) : {},
    );
    process.stdout.write(`\nRESULT_MCP_JSON:${JSON.stringify({ ...res, dataRoot: config.dataRoot })}\n`);
  } finally {
    try {
      db.raw.close();
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
