import { describe, it, expect } from "vitest";
import { selfConsistency, bestOfN, selfRefine, treeOfThoughts, chainOfVerification, mixtureOfAgents, reflexion, measureLift } from "../src/patterns/index.js";
import * as rootExports from "../src/index.js";

describe("reflexion", () => {
  it("retries with accumulated reflections until success", async () => {
    const seenReflections: string[][] = [];
    const r = await reflexion<string>({
      maxAttempts: 4,
      attempt: (reflections) => {
        seenReflections.push([...reflections]);
        return `attempt-with-${reflections.length}-reflections`;
      },
      // Succeed once we have 2 reflections carried in.
      evaluate: (result) => ({ success: result.includes("2-reflections"), feedback: "try again" }),
      reflect: (_r, fb, i) => `reflection ${i}: ${fb}`,
    });
    expect(r.succeeded).toBe(true);
    expect(r.attempts).toBe(3); // 0 refl, 1 refl, 2 refl → success on the 3rd
    expect(r.reflections).toHaveLength(2);
    expect(seenReflections[2]).toEqual(["reflection 0: try again", "reflection 1: try again"]);
  });
  it("stops at the attempt budget and reports failure honestly", async () => {
    const r = await reflexion<number>({
      maxAttempts: 2,
      attempt: () => 0,
      evaluate: () => ({ success: false, feedback: "nope" }),
      reflect: () => "reflected",
    });
    expect(r.succeeded).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.reflections).toHaveLength(1); // no reflection after the final attempt
  });
});

describe("mixtureOfAgents", () => {
  it("proposes, refines across layers seeing peers, and aggregates", async () => {
    const seen: string[][] = [];
    const r = await mixtureOfAgents({
      agents: 3,
      layers: 2,
      propose: (a) => `p${a}`,
      refine: (a, others) => {
        seen.push(others);
        return `r${a}(${others.join(",")})`;
      },
      aggregate: (finalLayer) => `agg[${finalLayer.join("|")}]`,
    });
    expect(r.layerOutputs).toHaveLength(2); // layer 1 + layer 2
    expect(r.layerOutputs[0]).toEqual(["p0", "p1", "p2"]);
    // Each refiner saw the OTHER two agents' layer-1 answers (not its own).
    expect(seen[0]).toEqual(["p1", "p2"]);
    expect(r.answer).toContain("agg[");
  });
  it("with a single layer, aggregates the proposals directly", async () => {
    const r = await mixtureOfAgents({
      agents: 2,
      layers: 1,
      propose: (a) => `p${a}`,
      refine: () => "should not run",
      aggregate: (f) => f.join("+"),
    });
    expect(r.layerOutputs).toHaveLength(1);
    expect(r.answer).toBe("p0+p1");
  });
});

describe("measureLift", () => {
  it("quantifies a treatment's score lift + win-rate over a baseline", async () => {
    // Treatment scores higher on every task → positive lift, 100% win-rate.
    const r = await measureLift<number>({
      tasks: [1, 2, 3, 4],
      baseline: () => "weak",
      treatment: () => "strong",
      score: (_t, out) => (out === "strong" ? 0.9 : 0.4),
    });
    expect(r.n).toBe(4);
    expect(r.baselineMean).toBeCloseTo(0.4, 3);
    expect(r.treatmentMean).toBeCloseTo(0.9, 3);
    expect(r.lift).toBeCloseTo(0.5, 3);
    expect(r.winRate).toBe(1);
    expect(r.perTask).toHaveLength(4);
  });
  it("reports zero lift + per-task deltas when treatment doesn't help", async () => {
    const r = await measureLift<number>({
      tasks: [1, 2],
      baseline: () => "x",
      treatment: () => "x",
      score: () => 0.7,
    });
    expect(r.lift).toBe(0);
    expect(r.winRate).toBe(0);
    expect(r.perTask.every((p) => p.delta === 0)).toBe(true);
  });
  it("handles an empty task set without crashing", async () => {
    const r = await measureLift<number>({ tasks: [], baseline: () => "", treatment: () => "", score: () => 0 });
    expect(r.n).toBe(0);
    expect(r.lift).toBe(0);
    expect(r.winRate).toBe(0);
  });
});

describe("pattern surface drift guard", () => {
  it("exports exactly the expected set of pattern functions (no silent add/drop)", async () => {
    const mod = (await import("../src/patterns/index.js")) as Record<string, unknown>;
    const fns = Object.keys(mod).filter((k) => typeof mod[k] === "function").sort();
    expect(fns).toEqual(
      ["bestOfN", "chainOfVerification", "measureLift", "mixtureOfAgents", "reflexion", "selfConsistency", "selfRefine", "treeOfThoughts"].sort(),
    );
  });
});

describe("public export surface (regression guard for the packaging fix)", () => {
  it("re-exports all 5 reasoning patterns from the package root", () => {
    for (const name of ["selfConsistency", "bestOfN", "selfRefine", "treeOfThoughts", "chainOfVerification", "mixtureOfAgents", "reflexion", "measureLift"] as const) {
      expect(typeof (rootExports as Record<string, unknown>)[name], name).toBe("function");
    }
  });
  it("re-exports the loop primitives from the package root", () => {
    for (const name of ["verifiedRatchet", "runImprovementCycle", "stepCountIs", "verifierSatisfied", "anyOf", "allOf", "compactHistory", "runUntil", "boundWorkingSet"] as const) {
      expect(typeof (rootExports as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});

describe("selfConsistency", () => {
  it("returns the majority answer + agreement ratio", async () => {
    const seq = ["42", "42", "7", "42", "7"];
    const r = await selfConsistency({ samples: 5, generate: (i) => seq[i] });
    expect(r.answer).toBe("42");
    expect(r.votes).toBe(3);
    expect(r.total).toBe(5);
    expect(r.consistency).toBeCloseTo(0.6, 3);
    expect(r.clusters[0].count).toBe(3);
  });
  it("uses a custom key for free-text clustering", async () => {
    const seq = ["The answer is 9.", "the answer is 9", "nope"];
    const r = await selfConsistency({
      samples: 3,
      generate: (i) => seq[i],
      key: (v) => v.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(),
    });
    expect(r.votes).toBe(2);
  });
  it("throws if nothing is produced", async () => {
    await expect(selfConsistency<string | null>({ samples: 2, generate: () => null })).rejects.toThrow();
  });
});

describe("bestOfN", () => {
  it("returns the highest-scored candidate", async () => {
    const r = await bestOfN({ n: 4, generate: (i) => `cand${i}`, score: (_v, i) => i * 0.1 });
    expect(r.index).toBe(3);
    expect(r.best).toBe("cand3");
    expect(r.scores).toEqual([0, 0.1, 0.2, 0.30000000000000004]);
  });
  it("supports async scorers (e.g. a verifier)", async () => {
    const r = await bestOfN({ n: 3, generate: (i) => i, score: async (v) => (v === 1 ? 1 : 0) });
    expect(r.best).toBe(1);
    expect(r.score).toBe(1);
  });
});

describe("selfRefine", () => {
  it("drafts, critiques, revises, and early-exits when clean", async () => {
    let n = 0;
    const r = await selfRefine<string>({
      draft: () => "draft",
      critique: () => (n++ === 0 ? "flaw: missing detail" : "no issues"),
      revise: (v, c) => `${v}+fixed`,
      maxIters: 3,
    });
    expect(r.answer).toBe("draft+fixed");
    expect(r.revised).toBe(1);
    expect(r.iterations).toBe(2); // one revise, then a clean critique stops it
  });
  it("stops at maxIters if never clean", async () => {
    const r = await selfRefine<number>({
      draft: () => 0,
      critique: () => "still flawed",
      revise: (v) => v + 1,
      maxIters: 3,
    });
    expect(r.answer).toBe(3);
    expect(r.revised).toBe(3);
    expect(r.iterations).toBe(3);
  });
});

describe("treeOfThoughts", () => {
  it("keeps the best-scored branch at each depth and synthesizes the path", async () => {
    // expand returns branch index as the thought; score prefers higher index.
    const r = await treeOfThoughts<number>({
      breadth: 3,
      depth: 2,
      expand: (_path, b) => b,
      score: (cand) => cand, // higher branch = better
      synthesize: (path) => path.reduce((a, b) => a + b, 0),
    });
    expect(r.path.length).toBe(2);
    expect(r.path.every((p) => p.thought === 2)).toBe(true); // best branch each depth
    expect(r.answer).toBe(4); // 2 + 2
  });
  it("defaults synthesis to the last thought", async () => {
    const r = await treeOfThoughts<string>({ breadth: 2, depth: 1, expand: (_p, b) => `b${b}`, score: (c) => (c === "b1" ? 1 : 0) });
    expect(r.answer).toBe("b1");
  });
});

describe("chainOfVerification", () => {
  it("drafts, verifies each claim independently, then revises", async () => {
    const r = await chainOfVerification<string>({
      draft: () => "draft with claims",
      planChecks: () => ["is X true?", "is Y true?"],
      answerCheck: (q) => `checked: ${q}`,
      revise: (_d, checks) => `revised over ${checks.length} checks`,
    });
    expect(r.checks).toHaveLength(2);
    expect(r.checks[0].a).toContain("checked");
    expect(r.answer).toBe("revised over 2 checks");
  });
  it("returns the draft unchanged when there are no checks", async () => {
    const r = await chainOfVerification<string>({
      draft: () => "solid draft",
      planChecks: () => [],
      answerCheck: () => "n/a",
      revise: () => "should not run",
    });
    expect(r.answer).toBe("solid draft");
    expect(r.checks).toEqual([]);
  });
});
