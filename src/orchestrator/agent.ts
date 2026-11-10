import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Bus } from './bus.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Approvals } from './approvals.js';
import type { ToolRegistry, ToolResult, ToolContext } from '../tools/index.js';
import type { Provider } from './providers/types.js';
import { activeEpisodeSlug, buildMessages, pipelineTodo, shotWordFrames, toolMessageContent } from './context.js';
import { clearReviewBlock, extractReviewShotIds, formatReviewFeedback, reviewEpisodeBoard } from './reviewer.js';
import { pickImages } from './image-pick.js';

export type AgentDeps = {
  db: Db;
  bus: Bus;
  config: Config;
  registry: ToolRegistry;
  approvals: Approvals;
  provider: () => Provider;
  reviewProvider?: () => Provider | null;
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

  const turnStartedAt = Date.now();
  const finishTurn = (steps: number, aborted: boolean, limitReached = false) => {
    const elapsedMs = Math.max(0, Date.now() - turnStartedAt);
    db.addRunDuration(project.id, threadId, elapsedMs, steps, provider.model);
    const timing = db.projectTiming(project.id);
    try {
      const slug = activeEpisodeSlug(project.root, db.listMessages(threadId));
      if (slug) {
        const repPath = path.join(project.root, 'out', slug, 'report.json');
        if (fs.existsSync(repPath)) {
          const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
          rep.agent_elapsed_seconds = Number((elapsedMs / 1000).toFixed(1));
          rep.agent_total_seconds = Number((timing.totalMs / 1000).toFixed(1));
          fs.writeFileSync(repPath, JSON.stringify(rep, null, 1) + '\n');
        }
      }
    } catch {
      /* ignore */
    }
    bus.emit(threadId, 'turn_end', {
      steps,
      aborted,
      limitReached,
      elapsedMs,
      totalProjectMs: timing.totalMs,
    });
  };

  bus.emit(threadId, 'turn_start', {
    provider: provider.label,
    model: provider.model,
    project: project.id,
    startedAt: turnStartedAt,
  });

  try {
    let ranPipeline = false;
    let nudges = 0;
    let lastTodoKey = '';
    let emptyTurns = 0;
    let lastFailSig = '';
    let consecutiveFails = 0;
    let checkpointedThisTurn = false;
    let reviewRounds = 0;
    // an expensive step failing again with the same error will fail a third time: stop instead of burning hours
    const expensiveFails = new Map<string, number>();

    for (let step = 0; step < config.maxSteps; step++) {
      if (signal.aborted) {
        finishTurn(step, true);
        return;
      }
      bus.emit(threadId, 'thinking', { step: step + 1 });
      const history = db.listMessages(threadId);
      const messages = buildMessages({ projectRoot: project.root, history, maxChars: config.contextChars });
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
          ? `[orchestrateur] L'appel d'outil "${res.truncatedToolCall}" a été coupé par la limite de tokens (sortie trop volumineuse en un seul appel). Pour écrire shots.tsx sur un épisode long, écris d'abord l'en-tête et les 6-8 premiers plans avec write_file ({ path, content }), puis ajoute les plans suivants par lots de 6-8 avec write_file ({ path, content, append: true }). Reprends immédiatement.`
          : `[orchestrateur] Réponse coupée par le budget de tokens (${provider.model}, WHATIF_MAX_TOKENS=${config.maxTokens}). Ne réfléchis pas trop longtemps avant d'agir : écris shots.tsx par lots de 6-8 plans avec write_file (puis append: true pour la suite).`;
        bus.emit(threadId, 'notice', { text: note });
        db.addMessage(threadId, 'user', note);
        if (emptyTurns <= 5) continue;
        finishTurn(step + 1, false);
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
        const todo = pipelineTodo(project.root, history);
        const todoKey = todo.join(',');
        if (todoKey !== lastTodoKey) {
          lastTodoKey = todoKey;
          nudges = 0;
        }
        const firstUserMsg = [...history].reverse().find((m) => m.role === 'user' && !m.content.startsWith('[orchestrateur]'));
        const isPureQuestion =
          !ranPipeline &&
          firstUserMsg &&
          /\?\s*$/.test(firstUserMsg.content.trim()) &&
          !/\b(continue|lance|fais|crée|creer|génère|genere|run|render|stills|épisode|episode|vidéo|video)\b/i.test(firstUserMsg.content);

        if (!isPureQuestion && (ranPipeline || todo.length > 0) && todo.length && nudges < 6) {
          nudges++;
          const nudge =
            `[orchestrateur] La chaîne n'est pas terminée (étapes restantes : ${todo.join(', ')}). ` +
            `Appelle directement l'outil suivant maintenant (pour un shots.tsx de plus de 10 plans, écris-le par lots de 6-8 plans avec write_file puis write_file { append: true }).`;
          db.addMessage(threadId, 'user', nudge);
          bus.emit(threadId, 'notice', { text: nudge });
          continue;
        }
        finishTurn(step + 1, false);
        return;
      }

      emptyTurns = 0;
      const curTodoKey = pipelineTodo(project.root, history).join(',');
      if (curTodoKey !== lastTodoKey) {
        lastTodoKey = curTodoKey;
        nudges = 0;
      }

      const producedImages: string[] = [];
      // a user message between two tool results of one assistant turn is rejected by OpenAI-style APIs: hold them until all results are in
      const heldNotes: string[] = [];
      // shots the model just asked to re-render (stills S3 S7): those are the images worth showing back
      const askedShots = res.toolCalls.flatMap((c) => (Array.isArray(c.args?.args) ? (c.args.args as unknown[]) : []).map(String).filter((a) => /^S\d+$/i.test(a)));

      // Check if all tool calls in this step are read-only auto tools so we can run them in parallel
      const allReadOnlyAuto =
        res.toolCalls.length > 1 &&
        res.toolCalls.every((c) => {
          const t = registry.get(c.name);
          return t && t.policy === 'auto' && !t.mutating;
        });

      if (allReadOnlyAuto) {
        const started = Date.now();
        for (const call of res.toolCalls) {
          bus.emit(threadId, 'tool_call', {
            id: call.id,
            name: call.name,
            input: call.args,
            policy: 'auto',
            mustAsk: false,
          });
        }
        const results = await Promise.all(res.toolCalls.map((call) => registry.run(call.name, call.args, ctx)));
        const durationMs = Date.now() - started;
        for (let i = 0; i < res.toolCalls.length; i++) {
          const call = res.toolCalls[i]!;
          const result = results[i]!;
          db.addMessage(threadId, 'tool', toolMessageContent(result), {
            toolCallId: call.id,
            name: call.name,
            ok: result.ok,
            artifacts: result.artifacts ?? [],
            credits: result.credits ?? 0,
          });
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
      } else {
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
              // Take one git checkpoint per turn (or before pipeline runs) instead of on every chunked write_file append
              const isAppendChunk = call.name === 'write_file' && call.args?.append === true;
              if (tool.mutating && !isAppendChunk && !checkpointedThisTurn) {
                checkpointedThisTurn = true;
                const checkpoint = await registry.run('git', { action: 'checkpoint', message: `agent: before ${call.name}` }, ctx);
                bus.emit(threadId, 'checkpoint', { tool: call.name, ok: checkpoint.ok, summary: checkpoint.summary });
              }
              if (call.name === 'whatif_run') {
                ranPipeline = true;
                checkpointedThisTurn = false;
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

          // Stop expensive Modal/FFmpeg retries on repeated runtime crashes/timeouts,
          // but do NOT count fast local pre-flight checks ("cannot run ... yet") where Modal never ran.
          const isLocalPrecheck = /cannot run \w+ yet/i.test(result.summary);
          if (!result.ok && !isLocalPrecheck && call.name === 'whatif_run' && ['render', 'master', 'stills'].includes(String(call.args?.step ?? ''))) {
            const stage = String(call.args.step);
            const errLines = result.summary.split('\n').filter((l) => l.trim());
            const firstErrIdx = errLines.findIndex((l) => /error|failed|cannot/i.test(l));
            const rawCause =
              firstErrIdx >= 0
                ? errLines.slice(firstErrIdx, firstErrIdx + 2).join(' | ')
                : (errLines[0] ?? '');
            const cause = /\(timeout\)/.test(result.summary) ? 'timeout' : rawCause.replace(/\d+/g, '#').slice(0, 200);
            const key = `${stage}:${cause}`;
            const n = (expensiveFails.get(key) ?? 0) + 1;
            expensiveFails.set(key, n);
            if (n >= (stage === 'stills' ? 3 : 2)) {
              const stop =
                `[orchestrateur] « ${stage} » a échoué ${n} fois avec la même cause (${cause}). Je m'arrête au lieu de relancer : ` +
                `corrige la cause (ou signale-la à l'utilisateur) avant de relancer ${stage}.`;
              heldNotes.push(stop);
              bus.emit(threadId, 'notice', { text: stop });
              for (const note of heldNotes) db.addMessage(threadId, 'user', note);
              const id = db.addMessage(threadId, 'assistant', `Arrêt : ${stage} échoue toujours pour la même raison (${cause}).`);
              bus.emit(threadId, 'assistant_message', { id, text: `Arrêt : ${stage} échoue toujours pour la même raison (${cause}).` });
              finishTurn(step + 1, false, true);
              return;
            }
          }
          // Loop-breaker: track repeated identical tool failures (full args hash so multi-edit changes past 240 chars aren't conflated)
          if (!result.ok) {
            const argsHash = crypto.createHash('sha1').update(JSON.stringify(call.args ?? {})).digest('hex');
            const sig = `${call.name}:${argsHash}`;
            if (sig === lastFailSig) {
              consecutiveFails++;
            } else {
              lastFailSig = sig;
              consecutiveFails = 1;
            }
            if (consecutiveFails >= 3) {
              const loopNote =
                `[orchestrateur] L'appel "${call.name}" a échoué ${consecutiveFails} fois de suite avec exactement les mêmes arguments. ` +
                `Ne relance PAS le même appel tel quel : corrige la cause exacte (ou utilise edit_shot / read_file sur le bloc concerné).`;
              heldNotes.push(loopNote);
              bus.emit(threadId, 'notice', { text: loopNote });
              if (consecutiveFails >= 5) {
                for (const n of heldNotes) db.addMessage(threadId, 'user', n);
                const firstLine = (result.summary ?? '').split('\n')[0] ?? 'erreur répétée';
                const stopMsg = `Arrêt : l'outil "${call.name}" a échoué ${consecutiveFails} fois de suite avec des arguments identiques (${firstLine}).`;
                const id = db.addMessage(threadId, 'assistant', stopMsg);
                bus.emit(threadId, 'assistant_message', { id, text: stopMsg });
                finishTurn(step + 1, false, true);
                return;
              }
            }
          } else {
            lastFailSig = '';
            consecutiveFails = 0;
          }

          for (const a of result.artifacts ?? []) {
            if (a.kind === 'image' && IMAGE_PATH.test(a.path)) producedImages.push(a.path);
          }

          // Independent Reviewer gate after storyboard generation (`whatif_run { step: "board" }`)
          if (
            call.name === 'whatif_run' &&
            String(call.args?.step ?? '') === 'board' &&
            result.ok
          ) {
            const epSlug = String(call.args?.episode ?? '').trim();
            if (epSlug) {
              try {
                const prevRev = JSON.parse(fs.readFileSync(path.join(project.root, 'out', epSlug, 'review.json'), 'utf8'));
                if (prevRev?.blocking && typeof prevRev.round === 'number' && prevRev.round > reviewRounds) {
                  reviewRounds = prevRev.round;
                }
              } catch {
                /* no prior blocking review */
              }
            }
            const reviewer = reviewRounds < config.reviewMaxRounds && deps.reviewProvider ? deps.reviewProvider() : null;
            if (epSlug && !reviewer) clearReviewBlock(project.root, epSlug);
            if (reviewer && epSlug) {
              reviewRounds++;
              const revId = `review-${step}-${reviewRounds}`;
              const revStart = Date.now();
              bus.emit(threadId, 'tool_call', {
                id: revId,
                name: 'reviewer',
                input: {
                  episode: epSlug,
                  round: reviewRounds,
                  mode: reviewRounds > 1 ? 'delta' : 'global',
                  model: reviewer.model,
                },
                policy: 'auto',
                mustAsk: false,
              });
              try {
                const report = await reviewEpisodeBoard(reviewer, project.root, epSlug, signal, {
                  round: reviewRounds,
                  final: reviewRounds >= config.reviewMaxRounds,
                });
                const affected = [
                  ...new Set(
                    report.issues
                      .filter((i) => i.severity === 'error')
                      .flatMap((i) => extractReviewShotIds(i.shot)),
                  ),
                ];
                const feedback = formatReviewFeedback(report, epSlug, shotWordFrames(project.root, epSlug, affected));
                bus.emit(threadId, 'tool_result', {
                  id: revId,
                  name: 'reviewer',
                  ok: report.pass,
                  summary: feedback,
                  artifacts: [{ kind: 'file', path: `out/${epSlug}/review.json`, mime: 'application/json' }],
                  credits: 0,
                  durationMs: Date.now() - revStart,
                });
                heldNotes.push(feedback);
              } catch (revErr) {
                clearReviewBlock(project.root, epSlug);
                bus.emit(threadId, 'tool_result', {
                  id: revId,
                  name: 'reviewer',
                  ok: true,
                  summary: `Reviewer skipped (${errText(revErr)})`,
                  artifacts: [],
                  credits: 0,
                  durationMs: Date.now() - revStart,
                });
              }
            }
          }
        }
      }

      for (const n of heldNotes) db.addMessage(threadId, 'user', n);

      if (producedImages.length) {
        // Multimodal feedback: the model gets the images it just produced on the next step.
        const unique = pickImages(producedImages, askedShots, 3);
        db.addMessage(threadId, 'user', `Artefacts produits — regarde-les (view_image si besoin): ${unique.join(', ')}`, { images: unique });
        bus.emit(threadId, 'artifacts', { images: unique });
      }
    }
    const note = `Limite de ${config.maxSteps} étapes atteinte: je m'arrête ici. Dis-moi comment continuer.`;
    const id = db.addMessage(threadId, 'assistant', note);
    bus.emit(threadId, 'assistant_message', { id, text: note });
    finishTurn(config.maxSteps, false, true);
  } catch (e) {
    const message = `Erreur: ${errText(e)}`;
    const id = db.addMessage(threadId, 'assistant', message);
    bus.emit(threadId, 'error', { message });
    bus.emit(threadId, 'assistant_message', { id, text: message });
    finishTurn(0, signal.aborted, false);
  }
}
