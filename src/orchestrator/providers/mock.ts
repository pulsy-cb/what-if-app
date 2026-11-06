import type { Provider } from './types.js';

/**
 * Offline provider used by the tests and the demo: it plays a fixed two-step script so the whole
 * loop (stream -> tool calls -> approval -> results -> answer) can be exercised without a key.
 */
export function mockProvider(model = 'mock'): Provider {
  return {
    id: 'mock',
    label: 'mock (offline, scripted)',
    model,
    async chat(req) {
      const used = req.messages
        .filter((m) => m.role === 'assistant' && 'toolCalls' in m)
        .flatMap((m) => ('toolCalls' in m ? m.toolCalls ?? [] : []))
        .map((c) => c.name);
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');

      if (!used.includes('repo_map')) {
        req.onText?.('Je regarde la structure du projet.');
        return { text: 'Je regarde la structure du projet.', toolCalls: [{ id: 'mock-1', name: 'repo_map', args: {} }] };
      }
      if (!used.includes('write_file')) {
        const note = `# Agent notes\n\n- first pass: repository mapped\n- request: ${(lastUser && 'content' in lastUser ? lastUser.content : '').slice(0, 400)}\n`;
        req.onText?.('Je consigne la demande dans NOTES.md.');
        return {
          text: 'Je consigne la demande dans NOTES.md.',
          toolCalls: [{ id: 'mock-2', name: 'write_file', args: { path: 'NOTES.md', content: note } }],
        };
      }
      const text = 'Terminé : structure lue, NOTES.md écrit. (provider mock, aucune requête réseau)';
      req.onText?.(text);
      return { text, toolCalls: [] };
    },
  };
}
