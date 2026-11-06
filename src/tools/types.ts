// The tool contract shared by the chat orchestrator, a future CLI and an MCP server.

export type Policy = 'auto' | 'ask' | 'deny';

export type Artifact = {
  kind: 'image' | 'video' | 'audio' | 'text' | 'file';
  /** Path relative to the project root. */
  path: string;
  mime: string;
  note?: string;
};

export type ToolResult = {
  ok: boolean;
  /** What the model reads back. Keep it compact and factual. */
  summary: string;
  /** Structured facts (also shown in the UI). */
  data?: unknown;
  /** Files the UI can render; images are re-attached to the next model turn. */
  artifacts?: Artifact[];
  /** ElevenLabs credits spent by this call, if any. */
  credits?: number;
};

export type ToolContext = {
  projectId: string;
  /** The studio folder of the project: contains src/episodes, public/, out/. */
  projectRoot: string;
  dataRoot: string;
  /** Skill folder (the upstream what-if-animation repo) used to scaffold and to run its scripts. */
  skillDir: string | null;
  log: (line: string) => void;
  signal?: AbortSignal;
};

export type Tool = {
  name: string;
  description: string;
  schema: JsonSchema;
  policy: Policy;
  /** Whether a checkpoint (git commit) must be taken before running it. */
  mutating?: boolean;
  cost?: (input: Record<string, unknown>) => number;
  validate?: (input: Record<string, unknown>) => string | null;
  run: (input: any, ctx: ToolContext) => Promise<ToolResult>;
};

export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
};

/** Minimal JSON Schema validation: enough for tool inputs, no dependency, no surprises. */
export function validateSchema(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.enum && !schema.enum.some((v) => v === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected an object`);
        break;
      }
      const obj = value as Record<string, unknown>;
      for (const req of schema.required ?? []) {
        if (obj[req] === undefined) errors.push(`${path}.${req}: required`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined) errors.push(...validateSchema(sub, obj[key], `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!schema.properties || !(key in schema.properties)) errors.push(`${path}.${key}: unexpected property`);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected an array`);
        break;
      }
      if (schema.items) value.forEach((v, i) => errors.push(...validateSchema(schema.items!, v, `${path}[${i}]`)));
      break;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected a string`);
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected a number`);
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path}: expected an integer`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`);
      break;
  }
  return errors;
}
