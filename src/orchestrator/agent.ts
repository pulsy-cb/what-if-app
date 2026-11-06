import type { Bus } from './bus.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Approvals } from './approvals.js';
import type { ToolRegistry, ToolResult, ToolContext } from '../tools/index.js';
import type { Provider } from './providers/types.js';
import { buildMessages, toolMessageContent } from './context.js';

export type AgentDeps = {
  db: Db;
  bus: Bus;
  config: Config;
  registry: ToolRegistry;
  approvals: Approvals;
  provider: () => Provider;
};

const IMAGE_PATH = /\.(png|jpe?g|webp)$/i;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One user turn: the agent loops (model -> tool calls -> results) until it stops asking for tools. */
export async function runTurn(deps: AgentDeps, threadId: string, signal: AbortSignal): Promise<void> {
  const { db, bus, config, registry } = deps;
  const thread = db.getThread(threadId);
  if (!thread) throw new Error(`unknown thread ${threadId}`);
  const project = db.getProject(thread.project_id);
  if (!project) throw new Error(`thread ${threadId} has no project`);

  const ctx: ToolContext = {
    projectId: project.id,
    projectRoot: project.root,
    dataRoot: config.dataRoot,
    skillDir: config.skillDir,
    log: (line) => bus.emit(threadId, 'log', { line }),
    signal,
  };

  let provider: Provider;
  try {
    provider = deps.provider();
  } catch (e) {
    const message = `Configuration du modèle: ${errText(e)}`;
    const id = db.addMessage(threadId, 'assistant', message);
    bus.emit(threadId, 'assistant_message', { id, text: message });
    bus.emit(threadId, 'turn_end', { steps: 0, aborted: false });
    return;
  }

  bus.emit(threadId, 'turn_start', { provider: provider.label, model: provider.model, project: project.id });

  try {
    for (let step = 0; step < config.maxSteps; step++) {
      if (signal.aborted) {
        bus.emit(threadId, 'turn_end', { steps: step, aborted: true });
        return;
      }
      bus.emit(threadId, 'thinking', { step: step + 1 });
      const messages = buildMessages({ projectRoot: project.root, history: db.listMessages(threadId), maxChars: config.contextChars });
      const res = await provider.chat({
        messages,
        tools: registry.schemas(),
        signal,
        onText: (delta) => bus.emit(threadId, 'assistant_delta', { text: delta }),
      });

      const assistantId = db.addMessage(
        threadId,
        'assistant',
        res.text,
        res.toolCalls.length ? { toolCalls: res.toolCalls } : undefined,
      );
      bus.emit(threadId, 'assistant_message', { id: assistantId, text: res.text, toolCalls: res.toolCalls });

      if (!res.toolCalls.length) {
        bus.emit(threadId, 'turn_end', { steps: step + 1, aborted: false });
        return;
      }

      const producedImages: string[] = [];
      for (const call of res.toolCalls) {
        const tool = registry.get(call.name);
        const started = Date.now();
        bus.emit(threadId, 'tool_call', {
          id: call.id,
          name: call.name,
          input: call.args,
          policy: tool?.policy ?? 'deny',
          mustAsk: tool?.policy === 'ask',
        });

        let result: ToolResult;
        if (!tool) {
          result = { ok: false, summary: `unknown tool "${call.name}"` };
        } else if (tool.policy === 'deny') {
          result = { ok: false, summary: `tool "${call.name}" is disabled by policy` };
        } else {
          let decision: string = 'approved';
          if (tool.policy === 'ask') {
            decision = await deps.approvals.request(threadId, call.name, call.args, config.approvalTimeoutMs, signal);
          }
          if (decision !== 'approved') {
            result = {
              ok: false,
              summary:
                decision === 'timeout'
                  ? `no answer from the user, ${call.name} was not run`
                  : `the user refused ${call.name}; propose another approach or ask why`,
            };
          } else {
            if (tool.mutating) {
              const checkpoint = await registry.run('git', { action: 'checkpoint', message: `agent: before ${call.name}` }, ctx);
              bus.emit(threadId, 'checkpoint', { tool: call.name, ok: checkpoint.ok, summary: checkpoint.summary });
            }
            result = await registry.run(call.name, call.args, ctx);
          }
        }

        const durationMs = Date.now() - started;
        db.addMessage(threadId, 'tool', toolMessageContent(result), {
          toolCallId: call.id,
          name: call.name,
          ok: result.ok,
          artifacts: result.artifacts ?? [],
          credits: result.credits ?? 0,
        });
        if (result.credits) db.addCredits(project.id, threadId, call.name, result.credits);
        bus.emit(threadId, 'tool_result', {
          id: call.id,
          name: call.name,
          ok: result.ok,
          summary: result.summary,
          artifacts: result.artifacts ?? [],
          credits: result.credits ?? 0,
          durationMs,
        });

        for (const a of result.artifacts ?? []) {
          if (a.kind === 'image' && IMAGE_PATH.test(a.path)) producedImages.push(a.path);
        }
      }

      if (producedImages.length) {
        // Multimodal feedback: the model gets the images it just produced on the next step.
        const unique = [...new Set(producedImages)].slice(0, 3);
        db.addMessage(threadId, 'user', `Artefacts produits — regarde-les (view_image si besoin): ${unique.join(', ')}`, { images: unique });
        bus.emit(threadId, 'artifacts', { images: unique });
      }
    }
    const note = `Limite de ${config.maxSteps} étapes atteinte: je m'arrête ici. Dis-moi comment continuer.`;
    const id = db.addMessage(threadId, 'assistant', note);
    bus.emit(threadId, 'assistant_message', { id, text: note });
    bus.emit(threadId, 'turn_end', { steps: config.maxSteps, aborted: false, limitReached: true });
  } catch (e) {
    const message = `Erreur: ${errText(e)}`;
    const id = db.addMessage(threadId, 'assistant', message);
    bus.emit(threadId, 'error', { message });
    bus.emit(threadId, 'assistant_message', { id, text: message });
    bus.emit(threadId, 'turn_end', { steps: 0, aborted: signal.aborted });
  }
}
