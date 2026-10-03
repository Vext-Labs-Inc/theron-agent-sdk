// Council — N specialists deliberate, verifier kernels check, reconciler
// produces the final answer.
//
// Specialists return answers. Verifier kernels check those answers.
// A reconciler merges them into one result.

import type { Agent } from "../agent/index.js";
import type { Verifier, VerifierResult } from "../verifiers/index.js";

/** Output of a single specialist's turn before reconciliation. */
export interface CouncilSpecialistOutput {
  specialist: string;
  output: string;
  claims: Array<{ text: string; confidence: number; type: string }>;
  verifier_results: VerifierResult[];
  cost_usd: number;
  latency_ms: number;
}

/** Final synthesized output after reconciliation. */
export interface CouncilOutput {
  /** The synthesized final answer. */
  answer: string;
  /** Per-specialist outputs (visible if you want to surface deliberation). */
  specialists: CouncilSpecialistOutput[];
  /** Whether the council reached consensus or surfaced a disagreement. */
  consensus: "ratified" | "split" | "refuted";
  /** If split: what the disagreement was about. */
  disagreements?: Array<{ claim: string; specialists_for: string[]; specialists_against: string[] }>;
  /** Aggregated cost + latency. */
  total_cost_usd: number;
  total_latency_ms: number;
}

/**
 * A reconciler synthesizes N specialist outputs into one answer.
 *
 * Two kinds:
 *   - Deterministic reconcilers (regex / SMT / voting) — fast, cheap, no LLM
 *   - LLM reconcilers (a dedicated reconciler model): better synthesis,
 *     more expensive
 *
 * The default is a deterministic claim-merging reconciler.
 */
export type Reconciler = (specialists: CouncilSpecialistOutput[]) => Promise<{
  answer: string;
  consensus: "ratified" | "split" | "refuted";
  disagreements?: CouncilOutput["disagreements"];
}>;

export interface CouncilConfig {
  /** Display name for the council. */
  name: string;
  /** The specialists that will deliberate. Order doesn't matter. */
  specialists: Agent[];
  /** Verifier kernels run against each specialist output before reconciliation. */
  verifiers?: Verifier[];
  /** How to synthesize the specialist outputs. Defaults to deterministic claim-merge. */
  reconciler?: Reconciler;
  /** Optional timeout per specialist (ms). Slow specialists are dropped. */
  specialist_timeout_ms?: number;
  /**
   * Optional claim extractor. The default deterministic reconciler votes over
   * the per-specialist `claims` arrays — with no extractor those arrays are
   * empty and the reconciler can only fall back to the first specialist's
   * output ("refuted"). Supply an extractor (e.g. a sentence splitter, or a
   * structured parser keyed on your specialists' output format) to enable
   * real cross-specialist ratification. See `sentenceClaimExtractor`.
   */
  claimExtractor?: ClaimExtractor;
}

/** Turn a specialist's raw output into a list of claims for voting. */
export type ClaimExtractor = (
  output: string,
) => Array<{ text: string; confidence: number; type: string }>;

/**
 * A simple, dependency-free claim extractor: split the output into sentences
 * and treat each as an assertion at full confidence. Paraphrase-insensitive
 * (the default reconciler matches claim text exactly, lowercased), so it
 * ratifies only verbatim-agreeing claims — good enough for short, factual
 * specialist answers; swap in a semantic extractor for prose.
 */
export const sentenceClaimExtractor: ClaimExtractor = (output) =>
  output
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, confidence: 1, type: "assertion" }));

/**
 * The Council primitive.
 *
 * Minimal usage:
 *   const c = new Council({
 *     name: "engineering-review",
 *     specialists: [cyberAgent, codeAgent, archAgent],
 *   });
 *   const result = await runner.runCouncil(c, "Review this PR for security risks");
 *
 * With verifier kernels:
 *   const c = new Council({
 *     name: "math-proof",
 *     specialists: [mathAgent, reasoningAgent, verifierAgent],
 *     verifiers: [VerifierKernels.arithmetic, VerifierKernels.citationPresence],
 *   });
 */
export class Council {
  public readonly name: string;
  public readonly specialists: Agent[];
  public readonly verifiers: Verifier[];
  public readonly reconciler: Reconciler;
  public readonly specialist_timeout_ms: number;
  public readonly claimExtractor: ClaimExtractor | undefined;

  constructor(config: CouncilConfig) {
    if (!config.name) throw new Error("Council requires a `name`.");
    if (!config.specialists || config.specialists.length === 0) {
      throw new Error(`Council "${config.name}" requires at least one specialist.`);
    }
    this.name = config.name;
    this.specialists = config.specialists;
    this.verifiers = config.verifiers ?? [];
    this.reconciler = config.reconciler ?? deterministicClaimMerge;
    this.specialist_timeout_ms = config.specialist_timeout_ms ?? 30_000;
    this.claimExtractor = config.claimExtractor;
  }

  /**
   * Convenience entry point — pointed at the Runner you've already constructed.
   * Most users will call `runner.runCouncil(council, query)` directly; this
   * exists for symmetry with `agent.run`-style ergonomics in user code.
   */
  async deliberate(_query: string): Promise<CouncilOutput> {
    throw new Error(
      "Council.deliberate() requires a Runner. Use:\n" +
        "  const runner = new Runner({ ... });\n" +
        "  const result = await runner.runCouncil(council, query);\n" +
        "See: https://github.com/Vext-Labs-Inc/theron-agent-sdk/blob/main/examples/03_council_of_three.ts",
    );
  }
}

/**
 * Default reconciler — deterministic claim-merge.
 *
 * Strategy:
 *   1. Collect claims from all specialists.
 *   2. If every specialist agrees, ratify.
 *   3. Strict majority (> N/2) ratifies the claim silently.
 *   4. Minority dissent (< majority) is surfaced as a disagreement.
 *   5. Final answer = ratified claims joined; surface disagreements alongside.
 *
 * No LLM call. Fast (< 5ms). Deterministic. Auditable.
 *
 * Note: "ratified" here means "the council aligned" — either unanimous or
 * strict-majority. "split" means at least one claim had minority dissent.
 * "refuted" means nothing crossed the majority threshold.
 */
const deterministicClaimMerge: Reconciler = async (specialists) => {
  if (specialists.length === 0) {
    return { answer: "(no specialists responded)", consensus: "refuted" };
  }
  if (specialists.length === 1) {
    return { answer: specialists[0].output, consensus: "ratified" };
  }
  // Claim-text-equal grouping. Production callers should plug in a semantic
  // clustering reconciler for paraphrase-tolerant matching.
  const claimMap = new Map<string, string[]>();
  for (const s of specialists) {
    for (const c of s.claims) {
      const key = c.text.toLowerCase().trim();
      if (!claimMap.has(key)) claimMap.set(key, []);
      claimMap.get(key)!.push(s.specialist);
    }
  }
  const ratified: string[] = [];
  const disagreements: NonNullable<CouncilOutput["disagreements"]> = [];
  // Strict majority: more than half. For 3 specialists, that's ≥ 2.
  const majorityThreshold = specialists.length / 2;
  for (const [claim, voters] of claimMap.entries()) {
    if (voters.length === specialists.length) {
      ratified.push(claim);
    } else if (voters.length > majorityThreshold) {
      ratified.push(claim);
    } else {
      disagreements.push({
        claim,
        specialists_for: voters,
        specialists_against: specialists
          .map((s) => s.specialist)
          .filter((n) => !voters.includes(n)),
      });
    }
  }
  const answer = ratified.join(" ") || specialists[0].output;
  const consensus: CouncilOutput["consensus"] =
    disagreements.length > 0 ? "split" : ratified.length > 0 ? "ratified" : "refuted";
  return { answer, consensus, disagreements: disagreements.length > 0 ? disagreements : undefined };
};
