import { describe, it, expect } from "vitest";
import { Agent, defineTool, zod as z, defineVerifier } from "../src/index.js";

describe("Agent", () => {
  it("requires a name", () => {
    expect(() => new Agent({ name: "", instruction: "x" })).toThrow(/name/);
  });

  it("requires an instruction", () => {
    expect(
      () => new Agent({ name: "a" } as unknown as { name: string; instruction: string }),
    ).toThrow(/instruction/);
  });

  it("accepts a string instruction shorthand", () => {
    const a = new Agent({ name: "a", instruction: "Be helpful." });
    expect(a.instruction.system).toBe("Be helpful.");
    expect(a.instruction.examples).toBeUndefined();
  });

  it("accepts a structured instruction with examples", () => {
    const a = new Agent({
      name: "a",
      instruction: {
        system: "x",
        examples: [{ user: "u", assistant: "a" }],
      },
    });
    expect(a.instruction.examples).toHaveLength(1);
  });

  it("defaults tools, sub_agents, verifiers to []", () => {
    const a = new Agent({ name: "a", instruction: "x" });
    expect(a.tools).toEqual([]);
    expect(a.sub_agents).toEqual([]);
    expect(a.verifiers).toEqual([]);
  });

  it("defaults max_turns to 10", () => {
    const a = new Agent({ name: "a", instruction: "x" });
    expect(a.max_turns).toBe(10);
  });

  it("renders tool schemas for the model", () => {
    const tool = defineTool({
      name: "ping",
      description: "ping",
      input: z.object({ msg: z.string() }),
      async execute() {
        return "pong";
      },
    });
    const a = new Agent({ name: "a", instruction: "x", tools: [tool] });
    const schemas = a.toolSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("ping");
  });

  it("isSupervisor reflects sub_agents presence", () => {
    const child = new Agent({ name: "c", instruction: "x" });
    const parent = new Agent({ name: "p", instruction: "x", sub_agents: [child] });
    expect(parent.isSupervisor()).toBe(true);
    expect(child.isSupervisor()).toBe(false);
  });

  it("carries verifier kernels", () => {
    const v = defineVerifier({
      name: "always_pass",
      description: "",
      check: async () => ({ pass: true, issues: [] }),
    });
    const a = new Agent({ name: "a", instruction: "x", verifiers: [v] });
    expect(a.verifiers).toHaveLength(1);
  });
});
