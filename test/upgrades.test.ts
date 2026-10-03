import { describe, it, expect } from "vitest";
import { Agent, subAgentToolName } from "../src/agent/index.js";
import { Runner } from "../src/runtime/index.js";
import type { RunnerEvent } from "../src/runtime/index.js";
import { defineTool, zod as z } from "../src/tools/index.js";
import { parseMarkdownSkill } from "../src/skills/index.js";
import { compactHistory } from "../src/loop/index.js";
import { fakeAdapter } from "./_helpers/fakeAdapter.js";

const runnerWith = (responses: Parameters<typeof fakeAdapter>[0]) =>
  new Runner({ model: fakeAdapter(responses), default_model: "fake" });

describe("Runner: parallel tool dispatch", () => {
  it("executes multiple tool calls from one turn and preserves order", async () => {
    const order: string[] = [];
    const mk = (name: string, delay: number) =>
      defineTool({
        name,
        description: name,
        input: z.object({}),
        async execute() {
          await new Promise((r) => setTimeout(r, delay));
          order.push(name);
          return `${name}-done`;
        },
      });
    // a is slow, b is fast — if they ran sequentially, order would be [a,b];
    // running concurrently, b finishes first.
    const agent = new Agent({ name: "multi", instruction: "x", tools: [mk("a", 30), mk("b", 1)] });
    const runner = runnerWith([
      { content: "", tool_calls: [{ name: "a", input: {} }, { name: "b", input: {} }] },
      "final",
    ]);
    const result = await runner.run(agent, "go");
    expect(result.output).toBe("final");
    // both tools ran
    expect(result.tool_calls.map((t) => t.name).sort()).toEqual(["a", "b"]);
    // concurrency proof: fast tool completed before slow tool
    expect(order).toEqual(["b", "a"]);
  });
});

describe("Runner: cost accounting", () => {
  it("sums adapter-reported cost_usd into the result", async () => {
    const agent = new Agent({ name: "c", instruction: "x" });
    const runner = runnerWith([{ content: "hi", cost_usd: 0.0021 }]);
    const result = await runner.run(agent, "go");
    expect(result.cost_usd).toBeCloseTo(0.0021, 6);
  });
});

describe("Runner: max_turns exhaustion event", () => {
  it("emits max_turns_exhausted when the loop never produces a final answer", async () => {
    const tool = defineTool({
      name: "spin",
      description: "spin",
      input: z.object({}),
      async execute() {
        return "again";
      },
    });
    const agent = new Agent({ name: "loop", instruction: "x", tools: [tool], max_turns: 2 });
    // every turn only ever calls the tool, never finalizes
    const runner = runnerWith([
      { content: "", tool_calls: [{ name: "spin", input: {} }] },
      { content: "", tool_calls: [{ name: "spin", input: {} }] },
    ]);
    const events: RunnerEvent[] = [];
    runner.on((e) => events.push(e));
    await runner.run(agent, "go");
    expect(events.some((e) => e.type === "max_turns_exhausted")).toBe(true);
  });
});

describe("Runner: AbortSignal", () => {
  it("stops the loop when the signal is already aborted", async () => {
    const agent = new Agent({ name: "a", instruction: "x" });
    const runner = runnerWith(["should-not-be-reached"]);
    const events: RunnerEvent[] = [];
    runner.on((e) => events.push(e));
    const ac = new AbortController();
    ac.abort();
    const result = await runner.run(agent, "go", { signal: ac.signal });
    expect(result.output).toBe("");
    expect(events.some((e) => e.type === "aborted")).toBe(true);
  });
});

describe("Runner: sub-agent delegation", () => {
  it("routes a delegate_to_<sub> call into the sub-agent and returns its output", async () => {
    const sub = new Agent({ name: "researcher", instruction: "you research" });
    const supervisor = new Agent({ name: "lead", instruction: "you lead", sub_agents: [sub] });

    // supervisor schema must advertise the delegate tool
    const names = supervisor.toolSchemas().map((s) => s.name);
    expect(names).toContain(subAgentToolName("researcher"));

    const runner = runnerWith([
      // supervisor turn: delegate
      { content: "", tool_calls: [{ name: subAgentToolName("researcher"), input: { task: "find X" } }] },
      // sub-agent turn: produce its answer
      "research result: X is 42",
      // supervisor turn: finalize using the sub-agent result
      "Final: X is 42",
    ]);
    const result = await runner.run(supervisor, "lead the work");
    expect(result.output).toBe("Final: X is 42");
    expect(result.tool_calls[0].output).toContain("X is 42");
  });
});

describe("zodToJsonSchema robustness", () => {
  it("handles union, literal, record, nullable, default, enum, and descriptions", () => {
    const tool = defineTool({
      name: "rich",
      description: "rich schema",
      input: z.object({
        mode: z.enum(["a", "b"]).describe("the mode"),
        either: z.union([z.string(), z.number()]),
        kind: z.literal("fixed"),
        bag: z.record(z.number()),
        maybe: z.string().nullable(),
        n: z.number().default(5),
        name: z.string(),
      }),
      async execute() {
        return "ok";
      },
    });
    const props = tool.schema.input_schema.properties as Record<string, Record<string, unknown>>;
    expect(props.mode).toEqual({ type: "string", enum: ["a", "b"], description: "the mode" });
    expect(props.either).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(props.kind).toEqual({ type: "string", enum: ["fixed"] });
    expect((props.bag as { type: string }).type).toBe("object");
    expect((props.maybe as { nullable: boolean }).nullable).toBe(true);
    expect((props.n as { default: unknown }).default).toBe(5);
    // default-valued + optional fields are not required; the rest are
    const required = tool.schema.input_schema.required as string[];
    expect(required).toContain("name");
    expect(required).not.toContain("n"); // has a default → not required
    expect(required).toContain("maybe"); // nullable ≠ optional: must be present, may be null
  });
});

describe("parseMarkdownSkill", () => {
  it("parses frontmatter (name/description/allowed-tools/model) and body", () => {
    const md = [
      "---",
      "name: My Skill",
      "description: does a thing",
      "allowed-tools: Read, Grep",
      "model: z-ai/glm-5.2",
      "---",
      "Do the thing carefully.",
    ].join("\n");
    const skill = parseMarkdownSkill("my-skill.md", md);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("does a thing");
    expect(skill!.allowedTools).toEqual(["Read", "Grep"]);
    expect(skill!.model).toBe("z-ai/glm-5.2");
    expect(skill!.body).toContain("Do the thing");
  });

  it("returns null without frontmatter or body", () => {
    expect(parseMarkdownSkill("x.md", "just text")).toBeNull();
    expect(parseMarkdownSkill("x.md", "---\nname: a\n---\n")).toBeNull();
  });
});

describe("compactHistory summaryRole", () => {
  it("attaches the summary under the requested role", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const r = await compactHistory({ messages, keepRecent: 2, summarize: () => "SUM", summaryRole: "user" });
    expect(r.compacted).toBe(true);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content).toContain("SUM");
  });
});
