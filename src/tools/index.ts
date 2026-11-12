import type { JsonSchema, Tool, ToolContext, ToolResult } from './types.js';
import { validateSchema } from './types.js';
import { fsTools } from './fs.js';
import { shotWords } from './shot-words.js';
import { stageShots } from './staging.js';
import { shellTools } from './shell.js';
import { whatifTools } from './whatif.js';

export type OpenAIishToolSchema = {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
};

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    this.add(...tools);
  }

  add(...tools: Tool[]): void {
    for (const t of tools) this.tools.set(t.name, t);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** The schema list handed to the model. Denied tools are not advertised. */
  schemas(): OpenAIishToolSchema[] {
    return this.list()
      .filter((t) => t.policy !== 'deny')
      .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  }

  /** Validate arguments, then run. Errors become a failed ToolResult instead of throwing at the agent loop. */
  async run(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) return { ok: false, summary: `unknown tool "${name}". Available: ${this.list().map((t) => t.name).join(', ')}` };
    const args = (input ?? {}) as Record<string, unknown>;
    const errors = validateSchema(tool.schema, args);
    if (tool.validate) {
      const extra = tool.validate(args);
      if (extra) errors.push(extra);
    }
    if (errors.length) return { ok: false, summary: `invalid arguments for ${name}:\n- ${errors.join('\n- ')}` };
    try {
      const result = await tool.run(args as never, ctx);
      return result;
    } catch (e) {
      return { ok: false, summary: `${name} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

export function defaultRegistry(): ToolRegistry {
  return new ToolRegistry([...fsTools, shotWords, stageShots, ...shellTools, ...whatifTools]);
}

export * from './types.js';
export { fsTools } from './fs.js';
export { shellTools } from './shell.js';
export { whatifTools } from './whatif.js';
