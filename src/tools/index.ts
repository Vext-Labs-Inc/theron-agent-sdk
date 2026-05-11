// Tool — a typed function with an auto-injected ToolContext.
//
// We use Zod for schema validation so that schema-from-signature is automatic
// and tool-call I/O is type-safe end-to-end.

import { z } from "zod";

export interface ToolContext {
  /** Current working directory (for file-system tools). */
  cwd: string;
  /** Whether to auto-approve potentially destructive operations. */
  yolo: boolean;
  /** Session identifier (for memory + audit logging). */
  session_id?: string;
  /** Tenant identifier (for multi-tenant deployments). */
  tenant_id?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON schema describing the input shape. */
  input_schema: Record<string, unknown>;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  schema: ToolSchema;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

/**
 * defineTool — ergonomic tool factory.
 *
 * Pass a Zod schema for input + an async execute fn. The schema is converted
 * to JSON-schema automatically and used to validate tool-call args.
 *
 * Example:
 *   const greet = defineTool({
 *     name: "greet",
 *     description: "Greet a person by name.",
 *     input: z.object({ name: z.string() }),
 *     async execute({ name }) {
 *       return `Hello, ${name}!`;
 *     },
 *   });
 */
export function defineTool<TSchema extends z.ZodTypeAny, TOutput>(opts: {
  name: string;
  description: string;
  input: TSchema;
  execute: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<TOutput>;
}): Tool<z.infer<TSchema>, TOutput> {
  return {
    schema: {
      name: opts.name,
      description: opts.description,
      input_schema: zodToJsonSchema(opts.input),
    },
    async execute(input, ctx) {
      const parsed = opts.input.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Tool ${opts.name} received invalid input: ${parsed.error.message}`,
        );
      }
      return opts.execute(parsed.data, ctx);
    },
  };
}

// Minimal Zod → JSON Schema converter. Production users can swap in
// `zod-to-json-schema` for a complete implementation.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional)) required.push(key);
    }
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  return { type: "string" };
}

export { z as zod };
