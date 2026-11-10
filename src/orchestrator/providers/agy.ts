import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeJson, type ChatMessage, type ChatRequest, type ChatResult, type Provider, type ToolCall, type ToolSchema } from './types.js';

export type AgyOptions = {
  model: string;
  agyBin?: string;
  env?: NodeJS.ProcessEnv;
};

const AGENT_TURN_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'Message ou explication destinée à l’utilisateur (chaîne vide si tu enchaînes directement les appels d’outils).',
    },
    toolCalls: {
      type: 'array',
      description: 'Liste ordonnée des outils What-If Studio à exécuter maintenant ([] si le tour est terminé).',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom exact de l’outil dans ORCHESTRATOR TOOLS.' },
          argsJson: { type: 'string', description: 'Objet JSON sérialisé (ex. "{\\"step\\":\\"stills\\"}") respectant parameters.' },
        },
        required: ['name', 'argsJson'],
      },
    },
  },
  required: ['text', 'toolCalls'],
} as const;

const AGENT_TURN_SCHEMA_STR = JSON.stringify(AGENT_TURN_SCHEMA);
const MAX_INLINE_PROMPT_BYTES = 75_000;

const AGY_MODEL_ALIASES: Record<string, string> = {
  '3.8-flash-medium': 'gemini-3.8-flash-medium',
  '3-8-flash-medium': 'gemini-3.8-flash-medium',
  'flash-medium': 'gemini-3.8-flash-medium',
  '3.8-flash-low': 'gemini-3.8-flash-low',
  '3.8-flash-high': 'gemini-3.8-flash-high',
  'carbon-low': 'gemini-4-carbon-low',
  '4-carbon-low': 'gemini-4-carbon-low',
  'carbon-medium': 'gemini-4-carbon-medium',
  '4-carbon-medium': 'gemini-4-carbon-medium',
  'carbon-high': 'gemini-4-carbon-high',
  '4-carbon-high': 'gemini-4-carbon-high',
  'argon-low': 'gemini-4-argon-low',
  '4-argon-low': 'gemini-4-argon-low',
  'argon-medium': 'gemini-4-argon-medium',
  '4-argon-medium': 'gemini-4-argon-medium',
  'argon-high': 'gemini-4-argon-high',
  '4-argon-high': 'gemini-4-argon-high',
};

/** Normalize user-friendly Antigravity model labels ("3.8 flash medium", "carbon low", "aragon low/medium") to canonical agy IDs. */
export function normalizeAgyModel(raw: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\b(google|antigravity|agy)\b/g, '')
    .replace(/[()_]+/g, ' ')
    .trim()
    .replace(/\baragon\b/g, 'argon')
    .replace(/[\s/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned) return 'gemini-3.8-flash-medium';
  return AGY_MODEL_ALIASES[cleaned] ?? cleaned;
}

export function resolveAgyBinary(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.WHATIF_AGY_BIN,
    '/usr/local/bin/agy',
    path.join(os.homedir(), '.local', 'bin', 'agy'),
  ].filter((c): c is string => Boolean(c && c.trim()));

  for (const c of candidates) {
    if (c.includes('/')) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {
        continue;
      }
    }
  }
  const pathDirs = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const binName = explicit && !explicit.includes('/') ? explicit : 'agy';
  for (const dir of pathDirs) {
    const full = path.join(dir, binName);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      /* next */
    }
  }
  return null;
}

export function hasAgyCli(explicit?: string): boolean {
  return resolveAgyBinary(explicit) !== null;
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

export function buildAgyPrompt(messages: ChatMessage[], tools: ToolSchema[], tmpDir: string): { cliPrompt: string; imageCount: number } {
  const systemBlocks: string[] = [];
  const turns: string[] = [];
  let imageCount = 0;

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) systemBlocks.push(m.content.trim());
      continue;
    }
    if (m.role === 'user') {
      const imgNotes: string[] = [];
      for (const img of m.images ?? []) {
        imageCount++;
        const imgPath = path.join(tmpDir, `attached_${imageCount}.${extForMime(img.mime)}`);
        fs.writeFileSync(imgPath, Buffer.from(img.data, 'base64'));
        imgNotes.push(`[Image jointe #${imageCount}: ${imgPath} — utilise read_file sur ce chemin exact pour inspecter l'image avant de répondre]`);
      }
      turns.push(`[USER]\n${[m.content, ...imgNotes].filter(Boolean).join('\n\n')}`);
      continue;
    }
    if (m.role === 'assistant') {
      const parts: string[] = [];
      if (m.content) parts.push(m.content);
      if (m.toolCalls?.length) {
        parts.push(
          `[TOOL CALLS REQUESTED]\n` +
            m.toolCalls.map((tc) => `- ${tc.name} (id=${tc.id}): ${JSON.stringify(tc.args ?? {})}`).join('\n'),
        );
      }
      if (parts.length) turns.push(`[ASSISTANT]\n${parts.join('\n')}`);
      continue;
    }
    if (m.role === 'tool') {
      turns.push(`[TOOL RESULT: ${m.name} (id=${m.toolCallId})]\n${m.content}`);
    }
  }

  const sections: string[] = [];
  if (systemBlocks.length) {
    sections.push(`# SYSTEM INSTRUCTIONS\n\n${systemBlocks.join('\n\n')}`);
  }
  if (turns.length) {
    sections.push(`# CONVERSATION TRANSCRIPT\n\n${turns.join('\n\n---\n\n')}`);
  }
  if (tools.length > 0) {
    const toolSpecs = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    sections.push(
      `# ORCHESTRATOR TOOLS\n\n` +
        `${JSON.stringify(toolSpecs, null, 2)}\n\n` +
        `# OUTPUT PROTOCOL (STRICT)\n` +
        `- Tu pilotes l'orchestrateur What-If Studio. N'utilise AUCUN outil interne d'édition ou de terminal d'Antigravity (write_to_file, replace_file_content, run_command, browser_*, etc.).\n` +
        `- Seul read_file est autorisé UNIQUEMENT pour lire les éventuels fichiers temporaires situés dans ${tmpDir} (images jointes ou conversation.md).\n` +
        `- Pour exécuter une action What-If Studio (${tools.map((t) => t.function.name).join(', ')}), déclare-la dans "toolCalls" sous la forme { "name": "<nom>", "argsJson": "<objet JSON sérialisé>" }.\n` +
        `- "argsJson" DOIT être une chaîne JSON valide représentant un objet conforme à "parameters".\n` +
        `- Quand tu as terminé et qu'aucun outil supplémentaire n'est requis, renvoie "toolCalls": [] et ta réponse finale dans "text".`,
    );
  } else if (imageCount > 0) {
    sections.push(
      `# CONSIGNE D'INSPECTION VISUELLE\n` +
        `Utilise read_file pour ouvrir chacune des ${imageCount} image(s) jointe(s) dans ${tmpDir} avant de formuler ta réponse finale. N'utilise aucun outil d'écriture ou de terminal.`,
    );
  }

  const fullPrompt = sections.join('\n\n====================\n\n');
  if (Buffer.byteLength(fullPrompt, 'utf8') <= MAX_INLINE_PROMPT_BYTES) {
    return { cliPrompt: fullPrompt, imageCount };
  }
  const convFile = path.join(tmpDir, 'conversation.md');
  fs.writeFileSync(convFile, fullPrompt, 'utf8');
  return {
    cliPrompt:
      `Lis intégralement le fichier ${convFile} avec read_file (en plusieurs tranches StartLine/EndLine si nécessaire pour tout lire jusqu'à la fin), ` +
      (imageCount > 0 ? `inspecte aussi avec read_file les images jointes dans ${tmpDir}, ` : '') +
      `puis réponds strictement selon les instructions et le schéma demandés à la fin de ${convFile}.`,
    imageCount,
  };
}

export function agyProvider(opts: AgyOptions): Provider {
  const modelId = normalizeAgyModel(opts.model);
  return {
    id: 'agy',
    label: 'Google Antigravity (AGY)',
    model: modelId,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const bin = resolveAgyBinary(opts.agyBin);
      if (!bin) {
        throw new Error(
          `Binaire Google Antigravity (agy) introuvable : vérifie que ~/.local/bin/agy est installé (ou monté dans /usr/local/bin/agy en Docker).`,
        );
      }

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-agy-'));
      try {
        const { cliPrompt } = buildAgyPrompt(req.messages, req.tools, tmpDir);
        const args = ['--disable-slash-commands', '--model', modelId, '--output-format', 'stream-json'];
        if (req.tools.length > 0) {
          args.push('--json-schema', AGENT_TURN_SCHEMA_STR);
        }
        args.push(`--print=${cliPrompt}`);

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          ...opts.env,
          PATH: `${process.env.PATH ?? ''}:/usr/local/bin:${path.join(os.homedir(), '.local', 'bin')}`,
        };

        return await new Promise<ChatResult>((resolve, reject) => {
          let settled = false;
          const finishErr = (err: Error) => {
            if (settled) return;
            settled = true;
            reject(err);
          };
          const finishOk = (res: ChatResult) => {
            if (settled) return;
            settled = true;
            resolve(res);
          };

          const child = spawn(bin, args, {
            cwd: tmpDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
          });

          const onAbort = () => {
            child.kill('SIGTERM');
            finishErr(new Error('aborted'));
          };
          if (req.signal?.aborted) {
            onAbort();
            return;
          }
          req.signal?.addEventListener('abort', onAbort, { once: true });

          let stdoutBuf = '';
          let stderrBuf = '';
          let streamedText = '';
          let finalEvent: any = null;

          const checkAuthPrompt = (chunkStr: string) => {
            if (/Authentication required\. Please visit the URL to log in/i.test(chunkStr)) {
              child.kill('SIGTERM');
              finishErr(
                new Error(
                  `Session Google Antigravity (agy) non connectée dans cet environnement : lance « docker compose exec studio agy acp --login » (en Docker) ou « agy acp --login » (sur l'hôte) une seule fois pour authentifier ton compte Google.`,
                ),
              );
              return true;
            }
            return false;
          };

          const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) return;
            const ev = safeJson(trimmed);
            if (!ev) return;
            if (ev.event === 'step_update' && req.tools.length === 0) {
              const delta = ev.step_update?.text_delta;
              if (typeof delta === 'string' && delta) {
                streamedText += delta;
                req.onText?.(delta);
              }
            } else if (ev.event === 'result') {
              finalEvent = ev.result;
            }
          };

          child.stdout.on('data', (chunk: Buffer) => {
            const str = chunk.toString('utf8');
            if (checkAuthPrompt(str)) return;
            stdoutBuf += str;
            let nl: number;
            while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
              const line = stdoutBuf.slice(0, nl);
              stdoutBuf = stdoutBuf.slice(nl + 1);
              handleLine(line);
            }
          });

          child.stderr.on('data', (chunk: Buffer) => {
            const str = chunk.toString('utf8');
            if (checkAuthPrompt(str)) return;
            stderrBuf += str;
          });

          child.on('error', (err) => {
            req.signal?.removeEventListener('abort', onAbort);
            finishErr(err);
          });

          child.on('close', (code) => {
            req.signal?.removeEventListener('abort', onAbort);
            if (settled) return;
            if (stdoutBuf.trim()) handleLine(stdoutBuf);

            if (finalEvent?.status === 'ERROR') {
              finishErr(new Error(`agy (${modelId}): ${finalEvent.error || stderrBuf.trim() || `exit ${code}`}`));
              return;
            }
            if (!finalEvent && code !== 0) {
              finishErr(new Error(`agy (${modelId}) failed (exit ${code}): ${(stderrBuf || stdoutBuf).trim().slice(0, 500)}`));
              return;
            }

            const usage = finalEvent?.usage;
            if (req.tools.length === 0) {
              const fullText = typeof finalEvent?.response === 'string' ? finalEvent.response : streamedText;
              if (!streamedText && fullText) req.onText?.(fullText);
              finishOk({
                text: fullText,
                toolCalls: [],
                usage,
                finishReason: 'stop',
              });
              return;
            }

            const structured =
              finalEvent?.structured_output && typeof finalEvent.structured_output === 'object'
                ? finalEvent.structured_output
                : safeJson(String(finalEvent?.response ?? ''));
            if (!structured || typeof structured !== 'object') {
              const fallbackText = String(finalEvent?.response ?? '').trim();
              if (fallbackText) req.onText?.(fallbackText);
              finishOk({
                text: fallbackText,
                toolCalls: [],
                usage,
                finishReason: 'stop',
              });
              return;
            }

            const text = typeof structured.text === 'string' ? structured.text : '';
            if (text) req.onText?.(text);

            const toolCalls: ToolCall[] = [];
            let truncatedToolCall: string | undefined;
            const rawCalls = Array.isArray(structured.toolCalls) ? structured.toolCalls : [];
            for (const rc of rawCalls) {
              const name = String(rc?.name ?? '').trim();
              if (!name) continue;
              const rawArgs = rc?.argsJson;
              let parsedArgs: any = null;
              if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
                parsedArgs = rawArgs;
              } else if (typeof rawArgs === 'string') {
                parsedArgs = rawArgs.trim() === '' ? {} : safeJson(rawArgs);
              }
              if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
                truncatedToolCall = name;
                continue;
              }
              toolCalls.push({
                id: `agy_${randomUUID().slice(0, 8)}`,
                name,
                args: parsedArgs as Record<string, unknown>,
              });
            }

            finishOk({
              text,
              toolCalls,
              usage,
              finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
              ...(truncatedToolCall ? { truncatedToolCall } : {}),
            });
          });
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}
