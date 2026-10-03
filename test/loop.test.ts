import { describe, it, expect, vi } from "vitest";
import {
  stepCountIs,
  costUsdAtLeast,
  verifierSatisfied,
  anyOf,
  allOf,
  verifiedRatchet,
  runImprovementCycle,
  compactHistory,
  runUntil,
  boundWorkingSet,
} from "../src/index.js";
import type { LoopState, RatchetVerdict, ImprovementCycleSpec } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helper — build a LoopState with sensible defaults.
// ---------------------------------------------------------------------------
function makeState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    step: 0,
    cost_usd: 0,
    output: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// stepCountIs
// ---------------------------------------------------------------------------
describe("stepCountIs", () => {
  it("does not stop before n steps", () => {
    const pred = stepCountIs(3);
    expect(pred(makeState({ step: 0 }))).toBe(false);
    expect(pred(makeState({ step: 2 }))).toBe(false);
  });

  it("stops when step === n", () => {
    const pred = stepCountIs(3);
    expect(pred(makeState({ step: 3 }))).toBe(true);
  });

  it("stops when step > n", () => {
    const pred = stepCountIs(3);
    expect(pred(makeState({ step: 10 }))).toBe(true);
  });

  it("stops immediately for stepCountIs(0)", () => {
    expect(stepCountIs(0)(makeState({ step: 0 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// costUsdAtLeast — the budget-exhaustion StopPredicate (true = stop)
// ---------------------------------------------------------------------------
describe("costUsdAtLeast", () => {
  it("does not stop while cost is under budget", () => {
    const pred = costUsdAtLeast(5.0);
    expect(pred(makeState({ cost_usd: 0 }))).toBe(false);
    expect(pred(makeState({ cost_usd: 4.99 }))).toBe(false);
  });

  it("stops when cost meets the floor", () => {
    const pred = costUsdAtLeast(5.0);
    expect(pred(makeState({ cost_usd: 5.0 }))).toBe(true);
    expect(pred(makeState({ cost_usd: 99.0 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifierSatisfied
// ---------------------------------------------------------------------------
describe("verifierSatisfied", () => {
  it("returns false when verifier_results is absent", () => {
    const pred = verifierSatisfied("arithmetic_recheck");
    expect(pred(makeState())).toBe(false);
  });

  it("returns false when the named kernel is not present", () => {
    const pred = verifierSatisfied("arithmetic_recheck");
    const state = makeState({
      verifier_results: [
        { kernel: "em_dash_check", pass: true, issues: [], ms: 1 },
      ],
    });
    expect(pred(state)).toBe(false);
  });

  it("returns false when the named kernel is present but failed", () => {
    const pred = verifierSatisfied("arithmetic_recheck");
    const state = makeState({
      verifier_results: [
        { kernel: "arithmetic_recheck", pass: false, issues: [], ms: 1 },
      ],
    });
    expect(pred(state)).toBe(false);
  });

  it("returns true when the named kernel passed", () => {
    const pred = verifierSatisfied("arithmetic_recheck");
    const state = makeState({
      verifier_results: [
        { kernel: "em_dash_check", pass: false, issues: [], ms: 1 },
        { kernel: "arithmetic_recheck", pass: true, issues: [], ms: 2 },
      ],
    });
    expect(pred(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// anyOf / allOf
// ---------------------------------------------------------------------------
describe("anyOf", () => {
  it("returns false when no predicate fires", () => {
    const pred = anyOf(stepCountIs(10), costUsdAtLeast(100));
    expect(pred(makeState({ step: 0, cost_usd: 0 }))).toBe(false);
  });

  it("returns true when the first predicate fires", () => {
    const pred = anyOf(stepCountIs(0), costUsdAtLeast(100));
    expect(pred(makeState({ step: 0 }))).toBe(true);
  });

  it("returns true when the second predicate fires", () => {
    const pred = anyOf(stepCountIs(10), costUsdAtLeast(1));
    expect(pred(makeState({ step: 0, cost_usd: 5 }))).toBe(true);
  });

  it("returns true when both predicates fire", () => {
    const pred = anyOf(stepCountIs(0), costUsdAtLeast(0));
    expect(pred(makeState({ step: 0, cost_usd: 0 }))).toBe(true);
  });
});

describe("allOf", () => {
  it("returns false when neither predicate fires", () => {
    const pred = allOf(stepCountIs(10), costUsdAtLeast(100));
    expect(pred(makeState({ step: 0, cost_usd: 0 }))).toBe(false);
  });

  it("returns false when only one predicate fires", () => {
    const pred = allOf(stepCountIs(0), costUsdAtLeast(100));
    expect(pred(makeState({ step: 0, cost_usd: 0 }))).toBe(false);
  });

  it("returns true when all predicates fire", () => {
    const pred = allOf(stepCountIs(0), costUsdAtLeast(0));
    expect(pred(makeState({ step: 0, cost_usd: 0 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifiedRatchet
// ---------------------------------------------------------------------------
describe("verifiedRatchet", () => {
  it("holds when verdict is undefined (no verdict)", () => {
    const ratchet = verifiedRatchet();
    const d = ratchet(undefined);
    expect(d.advance).toBe(false);
    expect(d.reason).toBe("no verdict");
  });

  it("holds when verdict is 'insufficient'", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "insufficient", confidence: 0.9 };
    const d = ratchet(v);
    expect(d.advance).toBe(false);
    expect(d.reason).toMatch(/insufficient/);
  });

  it("holds when verdict is 'sufficient' but confidence is below default threshold (0.6)", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "sufficient", confidence: 0.59 };
    const d = ratchet(v);
    expect(d.advance).toBe(false);
    expect(d.reason).toMatch(/confidence/);
    expect(d.reason).toMatch(/0\.590/);
  });

  it("advances when verdict is 'sufficient' at exactly the default threshold (0.6)", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "sufficient", confidence: 0.6 };
    const d = ratchet(v);
    expect(d.advance).toBe(true);
    expect(d.reason).toMatch(/sufficient/);
    expect(d.reason).toMatch(/0\.600/);
  });

  it("advances when verdict is 'sufficient' above the default threshold", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "sufficient", confidence: 0.95 };
    const d = ratchet(v);
    expect(d.advance).toBe(true);
  });

  it("respects a custom minConfidence option", () => {
    const ratchet = verifiedRatchet({ minConfidence: 0.85 });
    const below: RatchetVerdict = { verdict: "sufficient", confidence: 0.84 };
    const above: RatchetVerdict = { verdict: "sufficient", confidence: 0.85 };
    expect(ratchet(below).advance).toBe(false);
    expect(ratchet(above).advance).toBe(true);
  });

  it("includes source in reason when present", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "sufficient", confidence: 0.8, source: "math_verifier" };
    const d = ratchet(v);
    expect(d.advance).toBe(true);
    expect(d.reason).toMatch(/math_verifier/);
  });

  it("handles an arbitrary non-sufficient verdict string", () => {
    const ratchet = verifiedRatchet();
    const v: RatchetVerdict = { verdict: "pending", confidence: 1.0 };
    const d = ratchet(v);
    expect(d.advance).toBe(false);
    expect(d.reason).toMatch(/pending/);
  });
});

// ---------------------------------------------------------------------------
// runImprovementCycle
// ---------------------------------------------------------------------------
describe("runImprovementCycle", () => {
  it("advances when verify returns sufficient at sufficient confidence", async () => {
    const spec: ImprovementCycleSpec<string, number> = {
      propose: () => "draft output",
      trial: (p) => p.length,
      verify: (_p, _t) => ({ verdict: "sufficient", confidence: 0.9 }),
    };
    const result = await runImprovementCycle(spec);
    expect(result.proposal).toBe("draft output");
    expect(result.trial).toBe(12);
    expect(result.verdict.verdict).toBe("sufficient");
    expect(result.decision.advance).toBe(true);
  });

  it("does not advance when verify returns insufficient", async () => {
    const spec: ImprovementCycleSpec<string, number> = {
      propose: () => "weak draft",
      trial: (p) => p.length,
      verify: (_p, _t) => ({ verdict: "insufficient", confidence: 0.99 }),
    };
    const result = await runImprovementCycle(spec);
    expect(result.decision.advance).toBe(false);
    expect(result.decision.reason).toMatch(/insufficient/);
  });

  it("does not advance when confidence is below threshold", async () => {
    const spec: ImprovementCycleSpec<string, string> = {
      propose: async () => "output",
      trial: async (p) => p.toUpperCase(),
      verify: async (_p, _t) => ({ verdict: "sufficient", confidence: 0.3 }),
    };
    const result = await runImprovementCycle(spec);
    expect(result.decision.advance).toBe(false);
    expect(result.decision.reason).toMatch(/confidence/);
  });

  it("uses a custom ratchet when provided", async () => {
    // Supply a custom ratchet that always advances regardless of verdict.
    const alwaysAdvance = (_v: RatchetVerdict | undefined) => ({
      advance: true,
      reason: "custom ratchet always advances",
    });

    const spec: ImprovementCycleSpec<string, string> = {
      propose: () => "proposal",
      trial: (p) => p,
      verify: () => ({ verdict: "insufficient", confidence: 0.0 }),
      ratchet: alwaysAdvance,
    };
    const result = await runImprovementCycle(spec);
    expect(result.decision.advance).toBe(true);
    expect(result.decision.reason).toMatch(/custom ratchet/);
  });

  it("supports async propose and trial", async () => {
    const propose = vi.fn().mockResolvedValue({ id: 42 });
    const trial = vi.fn().mockResolvedValue("trial-result");
    const verify = vi.fn().mockResolvedValue({
      verdict: "sufficient",
      confidence: 0.75,
      source: "mock_verifier",
    });

    const result = await runImprovementCycle({ propose, trial, verify });

    expect(propose).toHaveBeenCalledOnce();
    expect(trial).toHaveBeenCalledWith({ id: 42 });
    expect(verify).toHaveBeenCalledWith({ id: 42 }, "trial-result");
    expect(result.decision.advance).toBe(true);
    expect(result.verdict.source).toBe("mock_verifier");
  });

  it("surfaces trial and proposal even on a non-advancing cycle", async () => {
    const spec: ImprovementCycleSpec<number, number> = {
      propose: () => 7,
      trial: (n) => n * 2,
      verify: () => ({ verdict: "insufficient", confidence: 0.5 }),
    };
    const result = await runImprovementCycle(spec);
    expect(result.proposal).toBe(7);
    expect(result.trial).toBe(14);
    expect(result.decision.advance).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compactHistory — summarize-and-continue (long context)
// ---------------------------------------------------------------------------
describe("compactHistory", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `msg ${i}` }));

  it("folds older messages into a summary, keeps the recent verbatim", async () => {
    const r = await compactHistory({ messages: mk(10), keepRecent: 3, summarize: (older) => `summary of ${older.length}` });
    expect(r.compacted).toBe(true);
    expect(r.droppedCount).toBe(7);
    expect(r.messages.length).toBe(4); // 1 summary + 3 recent
    expect(r.messages[0].role).toBe("system");
    expect(r.messages[0].content).toContain("summary of 7");
    expect(r.messages[r.messages.length - 1].content).toBe("msg 9"); // most recent kept
  });

  it("is a no-op when history is already small", async () => {
    const r = await compactHistory({ messages: mk(3), keepRecent: 6, summarize: () => "x" });
    expect(r.compacted).toBe(false);
    expect(r.droppedCount).toBe(0);
    expect(r.messages.length).toBe(3);
  });

  it("respects a maxChars budget (no compaction under budget)", async () => {
    const r = await compactHistory({ messages: mk(10), keepRecent: 2, maxChars: 100000, summarize: () => "x" });
    expect(r.compacted).toBe(false); // total chars well under 100k
  });
});

// ---------------------------------------------------------------------------
// runUntil — bounded, checkpointable long-horizon driver
// ---------------------------------------------------------------------------
describe("runUntil", () => {
  it("runs until the stop predicate holds, checkpointing each step", async () => {
    const checkpoints: number[] = [];
    const r = await runUntil<number>({
      initial: 0,
      step: (s) => s + 1,
      stopWhen: (s) => s >= 5,
      onCheckpoint: (s) => { checkpoints.push(s); },
    });
    expect(r.state).toBe(5);
    expect(r.steps).toBe(5);
    expect(r.stopped).toBe("predicate");
    expect(checkpoints).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at maxSteps if the predicate never holds (long-horizon safety net)", async () => {
    const r = await runUntil<number>({ initial: 0, step: (s) => s + 1, stopWhen: () => false, maxSteps: 3 });
    expect(r.steps).toBe(3);
    expect(r.stopped).toBe("maxSteps");
    expect(r.state).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// boundWorkingSet — bounded working memory for long agents
// ---------------------------------------------------------------------------
describe("boundWorkingSet", () => {
  it("is a no-op under the cap", () => {
    const items = [{ seq: 1 }, { seq: 2 }];
    const r = boundWorkingSet(items, 5);
    expect(r.kept).toHaveLength(2);
    expect(r.evicted).toHaveLength(0);
  });

  it("keeps highest-importance items, evicts the rest, preserves order", () => {
    const items = [
      { seq: 1, importance: 0.1 },
      { seq: 2, importance: 0.9 },
      { seq: 3, importance: 0.5 },
    ];
    const r = boundWorkingSet(items, 2);
    expect(r.kept.map((i) => i.seq)).toEqual([2, 3]); // 0.9 + 0.5 kept, original order
    expect(r.evicted.map((i) => i.seq)).toEqual([1]); // lowest importance dropped
  });

  it("never evicts pinned items (load-bearing)", () => {
    const items = [
      { seq: 1, importance: 0.0, pinned: true }, // low importance but pinned
      { seq: 2, importance: 0.9 },
      { seq: 3, importance: 0.8 },
    ];
    const r = boundWorkingSet(items, 1);
    expect(r.kept.some((i) => i.seq === 1)).toBe(true); // pinned survives the cap
  });

  it("breaks importance ties by recency (higher seq kept)", () => {
    const items = [
      { seq: 1, importance: 0.5 },
      { seq: 2, importance: 0.5 },
    ];
    const r = boundWorkingSet(items, 1);
    expect(r.kept.map((i) => i.seq)).toEqual([2]); // most recent of the tie
  });
});
