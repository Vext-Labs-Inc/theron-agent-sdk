/**
 * Sample: Reasoning patterns
 *
 * Demonstrates the framework-agnostic reasoning-pattern primitives — the
 * SDK-side counterparts of Theron's server Hive loops. No API key needed: this
 * example uses a deterministic mock "model" so it runs offline and its output is
 * stable. Swap the mock for any provider call (OpenRouter, Anthropic, OpenAI,
 * a local model) and the patterns are unchanged.
 *
 * Run:
 *   npx tsx examples/reasoning-patterns.ts
 *
 * What this demonstrates:
 *   - selfConsistency  — sample N paths, take the majority answer
 *   - bestOfN          — verifier-guided best-of-N
 *   - selfRefine       — draft → critique → revise (early-exit when clean)
 *   - treeOfThoughts   — best-first branch/score/expand search
 *   - chainOfVerification — draft → verify claims independently → revise
 */

import {
  selfConsistency,
  bestOfN,
  selfRefine,
  treeOfThoughts,
  chainOfVerification,
  mixtureOfAgents,
  reflexion,
  measureLift,
} from "../src/index.js";

// A stand-in "model". Replace with a real provider call in production.
async function mockModel(prompt: string): Promise<string> {
  if (prompt.includes("critique")) return prompt.includes("v2") ? "no issues" : "flaw: be more specific";
  if (prompt.includes("verify:")) return "supported";
  // A slightly noisy answerer so self-consistency has a majority to find.
  const answers = ["42", "42", "41", "42"];
  return answers[prompt.length % answers.length];
}

async function main() {
  // 1) Self-consistency — majority vote across samples (3 of 4 agree on "42").
  const sampled = ["42", "42", "41", "42"];
  const sc = await selfConsistency({
    samples: 4,
    generate: (i) => sampled[i],
  });
  console.log(`selfConsistency → "${sc.answer}" (agreement ${sc.consistency})`);

  // 2) Best-of-N — pick the highest-scored candidate (score = your verifier).
  const bo = await bestOfN({
    n: 3,
    generate: (i) => `candidate ${i}`,
    score: (_v, i) => i / 10, // stand-in verifier confidence
  });
  console.log(`bestOfN → "${bo.best}" (score ${bo.score})`);

  // 3) Self-refine — iterate until the critique is clean.
  const sr = await selfRefine<string>({
    draft: () => "v1 draft",
    critique: (v) => mockModel(`critique ${v}`),
    revise: () => "v2 draft",
    maxIters: 3,
  });
  console.log(`selfRefine → "${sr.answer}" (${sr.revised} revision(s))`);

  // 4) Tree-of-thoughts — best-first search over reasoning branches.
  const tot = await treeOfThoughts<number>({
    breadth: 3,
    depth: 2,
    expand: (_path, b) => b,
    score: (cand) => cand,
    synthesize: (path) => path.reduce((a, b) => a + b, 0),
  });
  console.log(`treeOfThoughts → ${tot.answer} (path ${tot.path.map((p) => p.thought).join("→")})`);

  // 5) Chain-of-verification — verify the draft's claims, then revise.
  const cov = await chainOfVerification<string>({
    draft: () => "the draft answer",
    planChecks: () => ["verify: claim A", "verify: claim B"],
    answerCheck: (q) => mockModel(q),
    revise: (_d, checks) => `revised after ${checks.length} checks`,
  });
  console.log(`chainOfVerification → "${cov.answer}"`);

  // 5b) Mixture-of-agents — layered multi-agent propose → refine → aggregate.
  const moa = await mixtureOfAgents({
    agents: 3,
    layers: 2,
    propose: (a) => `agent${a}'s take`,
    refine: (a, others) => `agent${a} refined (saw ${others.length} peers)`,
    aggregate: (final) => `consensus of ${final.length}`,
  });
  console.log(`mixtureOfAgents → "${moa.answer}" (${moa.layerOutputs.length} layers)`);

  // 5c) Reflexion — retry with accumulated reflections until success.
  const refl = await reflexion<string>({
    maxAttempts: 4,
    attempt: (reflections) => `attempt with ${reflections.length} reflection(s)`,
    evaluate: (r) => ({ success: r.includes("2 reflection"), feedback: "not yet" }),
    reflect: (_r, fb, i) => `lesson ${i}: ${fb}`,
  });
  console.log(`reflexion → "${refl.answer}" (succeeded ${refl.succeeded} in ${refl.attempts} attempts)`);

  // 6) measureLift — prove a pattern beats single-shot on a task set.
  //    Baseline: one noisy sample. Treatment: self-consistency over 5 samples.
  //    Scorer: 1.0 if the answer is the correct "42", else 0.
  const tasks = [0, 1, 2, 3, 4, 5]; // 6 tasks (seeds)
  const noisy = (seed: number) => (["42", "42", "41", "42", "40", "42"][seed % 6]);
  const lift = await measureLift<number>({
    tasks,
    baseline: (t) => noisy(t), // single shot
    treatment: async (t) => (await selfConsistency({ samples: 5, generate: (i) => noisy(t + i) })).answer,
    score: (_t, out) => (out === "42" ? 1 : 0),
  });
  console.log(
    `measureLift → baseline ${lift.baselineMean} vs treatment ${lift.treatmentMean} ` +
      `(lift ${lift.lift >= 0 ? "+" : ""}${lift.lift}, win-rate ${lift.winRate})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
