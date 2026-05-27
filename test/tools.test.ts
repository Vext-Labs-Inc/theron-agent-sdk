import { describe, it, expect } from "vitest";
import { defineTool, zod as z } from "../src/index.js";

describe("defineTool", () => {
  it("returns a tool with schema + execute", async () => {
    const tool = defineTool({
      name: "greet",
      description: "greet a person",
      input: z.object({ name: z.string() }),
      async execute({ name }) {
        return `Hello, ${name}!`;
      },
    });
    expect(tool.schema.name).toBe("greet");
    expect(tool.schema.description).toBe("greet a person");
    const out = await tool.execute({ name: "Annalea" }, { cwd: ".", yolo: false });
    expect(out).toBe("Hello, Annalea!");
  });

  it("rejects names that don't match OpenAI/Anthropic regex", () => {
    expect(() =>
      defineTool({
        name: "bad name",
        description: "",
        input: z.object({}),
        async execute() {
          return null;
        },
      }),
    ).toThrow(/invalid/);
    expect(() =>
      defineTool({
        name: "1bad",
        description: "",
        input: z.object({}),
        async execute() {
          return null;
        },
      }),
    ).toThrow(/invalid/);
  });

  it("emits a JSON-schema object with required keys", () => {
    const t = defineTool({
      name: "do",
      description: "",
      input: z.object({
        required_str: z.string(),
        opt_num: z.number().optional(),
        list: z.array(z.string()),
        kind: z.enum(["a", "b"]),
        flag: z.boolean(),
      }),
      async execute() {
        return null;
      },
    });
    const schema = t.schema.input_schema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties.required_str.type).toBe("string");
    expect(schema.properties.opt_num.type).toBe("number");
    expect(schema.properties.list.type).toBe("array");
    expect(schema.properties.kind).toMatchObject({ type: "string", enum: ["a", "b"] });
    expect(schema.properties.flag.type).toBe("boolean");
    expect(schema.required).toContain("required_str");
    expect(schema.required).not.toContain("opt_num");
  });

  it("rejects invalid input at runtime with a structured error", async () => {
    const t = defineTool({
      name: "demand_int",
      description: "",
      input: z.object({ n: z.number() }),
      async execute({ n }) {
        return n * 2;
      },
    });
    await expect(
      t.execute({ n: "oops" } as unknown as { n: number }, { cwd: ".", yolo: false }),
    ).rejects.toThrow(/demand_int.*invalid input/);
  });
});
