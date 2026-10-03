// Tool — a typed function with an auto-injected ToolContext.
//
// We use Zod for schema validation so that schema-from-signature is automatic
// and tool-call I/O is type-safe end-to-end.

import { z } from "zod";

export interface ToolContext {
  /** Current working directory (for file-system tools). */
  cwd: string;
  /** Whether to auto-approve potentially destructive operations.
   *  Default `false`. The SDK does NOT enforce sandboxing — tool authors are
   *  responsible for honoring this flag when their tool can mutate state. */
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
 * to JSON-schema automatically and used to validate tool-call args at runtime.
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
 *
 * On invalid input, throws an Error with a structured message that includes
 * the tool name + Zod's parse issues — surface this to your end user.
 */
export function defineTool<TSchema extends z.ZodTypeAny, TOutput>(opts: {
  name: string;
  description: string;
  input: TSchema;
  execute: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<TOutput>;
}): Tool<z.infer<TSchema>, TOutput> {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(opts.name)) {
    throw new Error(
      `Tool name "${opts.name}" is invalid. Must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ for OpenAI/Anthropic tool-call compatibility.`,
    );
  }
  return {
    schema: {
      name: opts.name,
      description: opts.description,
      input_schema: zodToJsonSchema(opts.input),
    },
    async execute(input, ctx) {
      const parsed = opts.input.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new Error(`Tool "${opts.name}" received invalid input: ${issues}`);
      }
      return opts.execute(parsed.data, ctx);
    },
  };
}

// Minimal Zod → JSON Schema converter. Covers the common shapes the SDK's own
// samples need. Production users can swap in `zod-to-json-schema` for full
// coverage (enums, unions, discriminated unions, refinements, etc.).
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = (schema as z.ZodTypeAny & { _def?: { description?: string } })._def?.description;
  const withDesc = (s: Record<string, unknown>) => (description ? { ...s, description } : s);
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) {
    const innerType = schema._def.innerType as z.ZodTypeAny;
    const inner = zodToJsonSchema(innerType);
    let def: unknown;
    try {
      def = schema._def.defaultValue?.();
    } catch {
      def = undefined;
    }
    return withDesc(def === undefined ? inner : { ...inner, default: def });
  }
  if (schema instanceof z.ZodNullable) {
    return withDesc({ ...zodToJsonSchema(schema.unwrap()), nullable: true });
  }
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape)) {
      const field = value as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(field);
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return withDesc({ type: "object", properties, ...(required.length > 0 ? { required } : {}) });
  }
  if (schema instanceof z.ZodString) return withDesc({ type: "string" });
  if (schema instanceof z.ZodNumber) return withDesc({ type: "number" });
  if (schema instanceof z.ZodBoolean) return withDesc({ type: "boolean" });
  if (schema instanceof z.ZodArray) return withDesc({ type: "array", items: zodToJsonSchema(schema.element) });
  if (schema instanceof z.ZodEnum) return withDesc({ type: "string", enum: schema.options });
  if (schema instanceof z.ZodLiteral) {
    const val = schema.value;
    const t = typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string";
    return withDesc({ type: t, enum: [val] });
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options as z.ZodTypeAny[];
    return withDesc({ anyOf: options.map((o) => zodToJsonSchema(o)) });
  }
  if (schema instanceof z.ZodRecord) {
    const valueType = schema._def.valueType as z.ZodTypeAny | undefined;
    return withDesc({
      type: "object",
      additionalProperties: valueType ? zodToJsonSchema(valueType) : true,
    });
  }
  return withDesc({ type: "string" });
}

export { z as zod };
