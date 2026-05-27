import { describe, it, expect } from "vitest";
import {
  Agent,
  Runner,
  defineTool,
  defineVerifier,
  zod as z,
  VerifierKernels,
} from "../src/index.js";
import { fakeAdapter } from "./_helpers/fakeAdapter.js";

describe("Runner.run", () => {
  it("rejects when constructed without a model", () => {
    expect(
      () => new Runner({} as unknown as { model: unknown; default_model: string }),
    ).toThrow(/model/);
  });

  it("runs a single agent against a scripted reply and returns AgentResult", async () => {
    const adapter = fakeAdapter(["Hello back."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({ name: "echo", instruction: "Echo." });

    const result = await runner.run(agent, "Hello.");
    expect(result.agent).toBe("echo");
    expect(result.output).toBe("Hello back.");
    expect(result.tool_calls).toEqual([]);
    expect(result.tokens_used.output).toBeGreaterThan(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("emits agent_thinking + agent_output events", async () => {
    const adapter = fakeAdapter(["Streamed reply."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({ name: "a", instruction: "x" });

    const events: string[] = [];
    runner.on((e) => events.push(e.type));
    await runner.run(agent, "go");

    expect(events).toContain("agent_start");
    expect(events).toContain("agent_thinking");
    expect(events).toContain("agent_output");
  });

  it("executes a tool call returned by the model, then asks again", async () => {
    const addTool = defineTool({
      name: "add",
      description: "add two numbers",
      input: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        return { sum: a + b };
      },
    });

    const adapter = fakeAdapter([
      {
        content: "calling add",
        tool_calls: [{ name: "add", input: { a: 2, b: 3 } }],
      },
      "The answer is 5.",
    ]);

    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({ name: "mather", instruction: "x", tools: [addTool] });

    const result = await runner.run(agent, "what is 2+3?");
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe("add");
    expect(result.tool_calls[0].output).toEqual({ sum: 5 });
    expect(result.output).toBe("The answer is 5.");
  });

  it("surfaces tool errors as messages instead of throwing", async () => {
    const boom = defineTool({
      name: "boom",
      description: "always throws",
      input: z.object({}),
      async execute() {
        throw new Error("kaboom");
      },
    });
    const adapter = fakeAdapter([
      { content: "", tool_calls: [{ name: "boom", input: {} }] },
      "recovered",
    ]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({ name: "a", instruction: "x", tools: [boom] });

    const errors: string[] = [];
    runner.on((e) => {
      if (e.type === "error") errors.push(e.message);
    });

    const result = await runner.run(agent, "go");
    expect(result.output).toBe("recovered");
    expect(errors.some((m) => m.includes("kaboom"))).toBe(true);
  });

  it("emits an error event when the model calls an unknown tool", async () => {
    const adapter = fakeAdapter([
      { content: "", tool_calls: [{ name: "ghost", input: {} }] },
      "done",
    ]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({ name: "a", instruction: "x" });

    const errors: string[] = [];
    runner.on((e) => {
      if (e.type === "error") errors.push(e.message);
    });

    const result = await runner.run(agent, "go");
    expect(result.output).toBe("done");
    expect(errors.some((m) => m.includes("unknown tool"))).toBe(true);
  });

  it("runs verifier kernels after the final output", async () => {
    const adapter = fakeAdapter(["Plain text, no em-dashes."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({
      name: "a",
      instruction: "x",
      verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
    });

    const result = await runner.run(agent, "go");
    expect(result.verifier_results).toHaveLength(2);
    expect(result.verifier_results.every((v) => v.pass)).toBe(true);
  });

  it("collects verifier issues without throwing on refutation", async () => {
    const adapter = fakeAdapter(["AI tell — em-dash here."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const agent = new Agent({
      name: "a",
      instruction: "x",
      verifiers: [VerifierKernels.emDash],
    });
    const result = await runner.run(agent, "go");
    expect(result.verifier_results[0].pass).toBe(false);
    expect(result.verifier_results[0].issues.length).toBeGreaterThan(0);
  });

  it("on() returns an unsubscribe", async () => {
    const adapter = fakeAdapter(["x"]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });

    let count = 0;
    const off = runner.on(() => count++);
    off();

    const agent = new Agent({ name: "a", instruction: "x" });
    await runner.run(agent, "go");
    expect(count).toBe(0);
  });
});

describe("Runner.runCouncil", () => {
  it("fans out to specialists and surfaces each one's output", async () => {
    const adapter = fakeAdapter(["same answer.", "same answer.", "same answer."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const { Council } = await import("../src/index.js");

    const a = new Agent({ name: "a", instruction: "x" });
    const b = new Agent({ name: "b", instruction: "x" });
    const c = new Agent({ name: "c", instruction: "x" });

    const council = new Council({ name: "test", specialists: [a, b, c] });
    const out = await runner.runCouncil(council, "Q");

    // Runner emits specialists with claims:[] (claim extraction is reconciler
    // territory). The default deterministic reconciler therefore sees no
    // claims to merge and returns "refuted" - documented behavior.
    expect(out.specialists).toHaveLength(3);
    expect(out.specialists.every((s) => s.output === "same answer.")).toBe(true);
    expect(out.consensus).toBe("refuted");
  });

  it("respects a custom reconciler", async () => {
    const adapter = fakeAdapter(["one.", "two.", "three."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const { Council } = await import("../src/index.js");

    const seen: string[] = [];
    const council = new Council({
      name: "test",
      specialists: [
        new Agent({ name: "a", instruction: "x" }),
        new Agent({ name: "b", instruction: "x" }),
        new Agent({ name: "c", instruction: "x" }),
      ],
      reconciler: async (specs) => {
        for (const s of specs) seen.push(s.output);
        return { answer: "custom", consensus: "ratified" };
      },
    });
    const out = await runner.runCouncil(council, "Q");
    expect(out.answer).toBe("custom");
    expect(seen).toHaveLength(3);
  });

  it("uses a custom verifier on each specialist output", async () => {
    const adapter = fakeAdapter(["ok.", "ok.", "ok."]);
    const runner = new Runner({ model: adapter, default_model: "fake-model" });
    const { Council } = await import("../src/index.js");
    let calls = 0;
    const v = defineVerifier({
      name: "count",
      description: "",
      check: async () => {
        calls++;
        return { pass: true, issues: [] };
      },
    });

    const council = new Council({
      name: "t",
      specialists: [
        new Agent({ name: "a", instruction: "x" }),
        new Agent({ name: "b", instruction: "x" }),
        new Agent({ name: "c", instruction: "x" }),
      ],
      verifiers: [v],
    });
    await runner.runCouncil(council, "Q");
    expect(calls).toBe(3);
  });
});
