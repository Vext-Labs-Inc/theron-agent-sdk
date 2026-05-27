import { describe, it, expect } from "vitest";
import { Agent, Council } from "../src/index.js";

const stubAgent = (name: string) => new Agent({ name, instruction: "x" });

describe("Council", () => {
  it("requires a name", () => {
    expect(
      () =>
        new Council({
          name: "",
          specialists: [stubAgent("a")],
        }),
    ).toThrow(/name/);
  });

  it("requires at least one specialist", () => {
    expect(() => new Council({ name: "c", specialists: [] })).toThrow(/specialist/);
  });

  it("defaults verifiers + timeout", () => {
    const c = new Council({ name: "c", specialists: [stubAgent("a")] });
    expect(c.verifiers).toEqual([]);
    expect(c.specialist_timeout_ms).toBeGreaterThan(0);
    expect(typeof c.reconciler).toBe("function");
  });

  it("default reconciler returns a single specialist verbatim when alone", async () => {
    const c = new Council({ name: "c", specialists: [stubAgent("a")] });
    const out = await c.reconciler([
      {
        specialist: "a",
        output: "lone wolf",
        claims: [],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
    ]);
    expect(out.consensus).toBe("ratified");
    expect(out.answer).toBe("lone wolf");
  });

  it("default reconciler ratifies unanimous claims", async () => {
    const c = new Council({
      name: "c",
      specialists: [stubAgent("a"), stubAgent("b"), stubAgent("c")],
    });
    const out = await c.reconciler([
      {
        specialist: "a",
        output: "x",
        claims: [{ text: "the sky is blue", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
      {
        specialist: "b",
        output: "x",
        claims: [{ text: "the sky is blue", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
      {
        specialist: "c",
        output: "x",
        claims: [{ text: "the sky is blue", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
    ]);
    expect(out.consensus).toBe("ratified");
    expect(out.answer).toContain("the sky is blue");
  });

  it("default reconciler surfaces minority dissent as split", async () => {
    const c = new Council({
      name: "c",
      specialists: [stubAgent("a"), stubAgent("b"), stubAgent("c")],
    });
    const out = await c.reconciler([
      {
        specialist: "a",
        output: "x",
        claims: [{ text: "majority", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
      {
        specialist: "b",
        output: "x",
        claims: [{ text: "majority", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
      {
        specialist: "c",
        output: "x",
        claims: [{ text: "dissent", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
    ]);
    expect(out.consensus).toBe("split");
    expect(out.disagreements?.[0].claim).toBe("dissent");
    expect(out.disagreements?.[0].specialists_for).toEqual(["c"]);
  });

  it("default reconciler reports refuted when no claim crosses majority", async () => {
    const c = new Council({
      name: "c",
      specialists: [stubAgent("a"), stubAgent("b")],
    });
    const out = await c.reconciler([
      {
        specialist: "a",
        output: "x",
        claims: [{ text: "alpha", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
      {
        specialist: "b",
        output: "y",
        claims: [{ text: "beta", confidence: 1, type: "f" }],
        verifier_results: [],
        cost_usd: 0,
        latency_ms: 0,
      },
    ]);
    expect(out.consensus).toBe("split");
  });

  it("default reconciler returns 'refuted' for zero specialists", async () => {
    const c = new Council({ name: "c", specialists: [stubAgent("a")] });
    const out = await c.reconciler([]);
    expect(out.consensus).toBe("refuted");
  });

  it("deliberate() without runner throws a guidance error", async () => {
    const c = new Council({ name: "c", specialists: [stubAgent("a")] });
    await expect(c.deliberate("anything")).rejects.toThrow(/Runner/);
  });
});
