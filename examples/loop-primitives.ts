/**
 * Sample: Loop primitives
 *
 * Demonstrates the verified-ratchet + verifier-in-the-loop primitives — the
 * governance layer for agent loops. A loop's state advances ONLY on a confident
 * verifier pass; stop predicates terminate the loop on verifier/cost/step
 * conditions.
 *
 * Offline + deterministic — no API key. Swap the mock judges for real verifiers.
 *
 * Run:
 *   npx tsx examples/loop-primitives.ts
 */

import {
  verifiedRatchet,
  runImprovementCycle,
  verifierSatisfied,
  stepCountIs,
  anyOf,
  type LoopState,
} from "../src/index.js";

async function main() {
  // 1) verifiedRatchet — advance ONLY on a confident "sufficient" verdict.
  const ratchet = verifiedRatchet({ minConfidence: 0.6 });
  console.log("ratchet (0.9 sufficient):", ratchet({ verdict: "sufficient", confidence: 0.9 }));
  console.log("ratchet (0.5 sufficient):", ratchet({ verdict: "sufficient", confidence: 0.5 }));
  console.log("ratchet (insufficient):", ratchet({ verdict: "insufficient", confidence: 0.9 }));

  // 2) runImprovementCycle — propose → trial → verify → ratchet, in one call.
  const cycle = await runImprovementCycle<string, { ok: boolean }>({
    propose: () => "a candidate improvement",
    trial: (proposal) => ({ ok: proposal.length > 0 }),
    verify: (_p, trial) => ({ verdict: trial.ok ? "sufficient" : "insufficient", confidence: 0.8 }),
  });
  console.log("cycle decision:", cycle.decision, "| advanced:", cycle.decision.advance);

  // 3) stop predicates — terminate a loop on verifier / step conditions.
  const stop = anyOf(verifierSatisfied("citation"), stepCountIs(5));
  const stateA: LoopState = { step: 2, cost_usd: 0.01, output: "draft", verifier_results: [{ kernel: "citation", pass: true, issues: [], ms: 1 }] };
  const stateB: LoopState = { step: 2, cost_usd: 0.01, output: "draft", verifier_results: [{ kernel: "citation", pass: false, issues: [], ms: 1 }] };
  console.log("stop when citation passes:", stop(stateA)); // true — verifier satisfied
  console.log("stop when citation fails @ step 2:", stop(stateB)); // false — keep going
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
