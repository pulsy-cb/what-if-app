import type { Bus } from './bus.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Approvals } from './approvals.js';
import type { ToolRegistry, ToolResult, ToolContext } from '../tools/index.js';
import type { Provider } from './providers/types.js';
import { buildMessages, pipelineTodo, toolMessageContent } from './context.js';

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
    let ranPipeline = false;
    let nudges = 0;
    let emptyTurns = 0;
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

      if (!res.toolCalls.length && (res.truncatedToolCall || res.finishReason === 'length' || !res.text.trim())) {
        // An empty reply or a tool call cut off by max_tokens ("length"): do not pollute the DB with an empty
        // assistant row; nudge the model to write large files (like shots.tsx with 15-36 shots) in smaller batches.
        emptyTurns++;
        const note = res.truncatedToolCall
          ? `L'appel d'outil "${res.truncatedToolCall}" a été coupé par la limite de tokens (sortie trop volumineuse en un seul appel). Pour écrire shots.tsx sur un épisode long, écris d'abord l'en-tête et les 6-8 premiers plans avec write_file ({ path, content }), puis ajoute les plans suivants par lots de 6-8 avec write_file ({ path, content, append: true }). Reprends immédiatement.`
          : `Réponse coupée par le budget de tokens (${provider.model}, WHATIF_MAX_TOKENS=${config.maxTokens}). Ne réfléchis pas trop longtemps avant d'agir : écris shots.tsx par lots de 6-8 plans avec write_file (puis append: true pour la suite).`;
        bus.emit(threadId, 'notice', { text: note });
        db.addMessage(threadId, 'system', note);
        if (emptyTurns <= 6) continue;
        bus.emit(threadId, 'turn_end', { steps: step + 1, aborted: false });
        return;
      }

      const assistantId = db.addMessage(
        threadId,
        'assistant',
        res.text,
        res.toolCalls.length ? { toolCalls: res.toolCalls } : undefined,
      );
      bus.emit(threadId, 'assistant_message', { id: assistantId, text: res.text, toolCalls: res.toolCalls });

      if (!res.toolCalls.length) {
        // An episode with remaining pipeline steps (whether started in this turn or resumed via "continue")
        // should not stop halfway just because the model printed a transitional sentence ("Now the shots file...").
        const todo = pipelineTodo(project.root);
        if ((ranPipeline || todo.length > 0) && todo.length && nudges < 10) {
          nudges++;
          const nudge =
            `La chaîne n'est pas terminée (étapes restantes : ${todo.join(', ')}). ` +
            `Appelle directement l'outil suivant maintenant (pour un shots.tsx de plus de 10 plans, écris-le par lots de 6-8 plans avec write_file puis write_file { append: true }).`;
          db.addMessage(threadId, 'system', nudge);
          bus.emit(threadId, 'notice', { text: nudge });
          continue;
        }
        bus.emit(threadId, 'turn_end', { steps: step + 1, aborted: false });
        return;
      }

      emptyTurns = 0;
      nudges = 0;

      const producedImages: string[] = [];
      for (const call of res.toolCalls) {
        const tool = registry.get(call.name);
        const started = Date.now();
        bus.emit(threadId, 'tool_call', {
          id: call.id,
          name: call.name,
          input: call.args,
          policy: tool?.policy ?? 'deny',
          mustAsk: tool?.policy === 'ask' && config.approvalsMode !== 'off',
        });

        let result: ToolResult;
        if (!tool) {
          result = { ok: false, summary: `unknown tool "${call.name}"` };
        } else if (tool.policy === 'deny') {
          result = { ok: false, summary: `tool "${call.name}" is disabled by policy` };
        } else {
          let decision: string = 'approved';
          const gated =
            config.approvalsMode === 'all' || (config.approvalsMode === 'pipeline' && tool.policy === 'ask');
          if (tool.policy === 'ask' && gated) {
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
            if (call.name === 'whatif_run') ranPipeline = true;
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
