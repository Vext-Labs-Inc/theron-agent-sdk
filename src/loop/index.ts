// Loop — verifier-in-the-loop stop predicates and the verified ratchet.
//
// WHY THIS MODULE EXISTS
// ----------------------
// Every public agent SDK (OpenAI Agents SDK, LangGraph, Anthropic Claude Agent
// SDK, AutoGen, CrewAI) treats loop termination as a scalar: a max-step count,
// a timeout, or an LLM "I am done" signal. None of them make the verifier a
// first-class typed gate on loop progression.
//
// The verified ratchet is the core primitive missing from all of them:
//   - Loop state may advance ONLY when a parameter-free verifier confirms the
//     candidate output is correct.
//   - Confidence is explicit and required — not a subjective LLM self-report.
//   - The decision is typed and auditable; every advance/hold carries a reason.
//
// This mirrors the server-side Agent R&D Loop shipped in Vext's own
// continual-improvement pipeline (CIP) where weight updates are committed only
// on verified ratchet passes.

import type { VerifierResult } from "../verifiers/index.js";

// ---------------------------------------------------------------------------
// LoopState — the observable snapshot at each loop iteration.
// ---------------------------------------------------------------------------

/**
 * Snapshot of agent-loop state at a given step. Passed to every StopPredicate
 * so predicates compose without coupling to the outer loop implementation.
 */
export interface LoopState {
  /** Zero-indexed iteration count. */
  step: number;
  /** Cumulative cost incurred so far, in USD. */
  cost_usd: number;
  /** The agent's latest output string. */
  output: string;
  /**
   * All verifier results collected so far.
   * Present when the caller runs verifiers; absent when running without them.
   */
  verifier_results?: VerifierResult[];
}

// ---------------------------------------------------------------------------
// StopPredicate — composable termination signals.
// ---------------------------------------------------------------------------

/**
 * A pure function that returns `true` when the loop SHOULD STOP.
 *
 * Predicates are composable via anyOf / allOf. They receive the full LoopState
 * so callers can build rich multi-factor stop conditions without modifying the
 * loop implementation.
 *
 * No public agent SDK ships a typed, composable, verifier-aware stop-predicate
 * as a first-class primitive — this is that primitive.
 */
export type StopPredicate = (s: LoopState) => boolean;

/**
 * Stop when the loop has completed exactly `n` steps (step index reaches n).
 *
 * Because step is zero-indexed, stepCountIs(3) fires after steps 0, 1, 2 — i.e.
 * when the loop is about to execute its 4th iteration.
 *
 * @param n - Maximum number of completed steps before stopping.
 */
export function stepCountIs(n: number): StopPredicate {
  return (s) => s.step >= n;
}

/**
 * Stop when the cumulative cost has reached or exceeded `min` USD.
 *
 * This is the budget-exhausted stop signal — use it in anyOf() or allOf()
 * alongside other predicates to cap agent spend.
 *
 * @param min - Budget floor after which the loop must stop.
 */
export function costUsdAtLeast(min: number): StopPredicate {
  return (s) => s.cost_usd >= min;
}

/**
 * Stop when the named verifier has produced a passing result.
 *
 * No public agent SDK makes verifier satisfaction a first-class loop-termination
 * condition. This is the bridge: the loop runs until a trusted, parameter-free
 * checker (not the LLM's self-report) confirms the output is correct.
 *
 * Returns `true` (stop) when ANY result in `verifier_results` whose
 * `kernel === kernelName` has `pass === true`.
 * Returns `false` (keep going) if the kernel has not run yet or has not passed.
 *
 * @param kernelName - The `VerifierResult.kernel` name to match.
 */
export function verifierSatisfied(kernelName: string): StopPredicate {
  return (s) => {
    if (!s.verifier_results) return false;
    return s.verifier_results.some((r) => r.kernel === kernelName && r.pass === true);
  };
}

/**
 * Stop when ANY of the provided predicates returns `true`.
 *
 * Useful for "stop on the first exit condition" semantics — e.g. stop if the
 * verifier passes OR if the budget is exhausted, whichever comes first.
 *
 * @param preds - One or more StopPredicates to OR together.
 */
export function anyOf(...preds: StopPredicate[]): StopPredicate {
  return (s) => preds.some((p) => p(s));
}

/**
 * Stop when ALL of the provided predicates return `true`.
 *
 * Useful for "stop only when every condition is satisfied simultaneously" —
 * e.g. stop when the verifier passes AND at least one step has been taken.
 *
 * @param preds - One or more StopPredicates to AND together.
 */
export function allOf(...preds: StopPredicate[]): StopPredicate {
  return (s) => preds.every((p) => p(s));
}

// ---------------------------------------------------------------------------
// RatchetVerdict — the typed output of a verifier judgment.
// ---------------------------------------------------------------------------

/**
 * A structured verdict emitted by a verifier or judge function.
 *
 * 'sufficient' means the candidate output meets the correctness bar for the
 * ratchet to advance. Any other string (including 'insufficient') causes the
 * ratchet to hold.
 *
 * `confidence` is a [0,1] float. The verified ratchet uses this to gate
 * advancement — a high-confidence insufficient is just as much a hold signal
 * as a low-confidence sufficient. Explicit confidence prevents the LLM
 * self-assessment problem: the model cannot softly claim it is done.
 *
 * `source` is optional provenance — which kernel, model, or tool produced the
 * verdict. Included in audit logs.
 */
export interface RatchetVerdict {
  verdict: "sufficient" | "insufficient" | string;
  confidence: number;
  source?: string;
}

// ---------------------------------------------------------------------------
// RatchetDecision — the ratchet's typed output.
// ---------------------------------------------------------------------------

/**
 * The ratchet's typed decision: advance the loop state, or hold.
 *
 * `advance === true` means the candidate output has been verified correct and
 * the loop may commit this state and move to the next phase.
 *
 * `reason` is a human-readable string that explains WHY the ratchet
 * advanced or held. This is surfaced in receipts and audit logs so the
 * decision is not a black box.
 */
export interface RatchetDecision {
  advance: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Ratchet — the typed gate function.
// ---------------------------------------------------------------------------

/**
 * A Ratchet is a pure function that maps a RatchetVerdict (or undefined, if no
 * verifier ran yet) to a RatchetDecision.
 *
 * The verified ratchet is the primitive that no public agent SDK ships:
 *   - Loop state advances ONLY on a proven verifier pass.
 *   - The confidence threshold is explicit and configured at construction time.
 *   - An absent verdict is treated as hold, not as pass — absence of proof is
 *     not proof of absence.
 *
 * This matches the server-side improvement loop, where weight commits require
 * a verifier pass + confidence >= threshold before the ratchet clicks forward.
 */
export type Ratchet = (v: RatchetVerdict | undefined) => RatchetDecision;

/**
 * verifiedRatchet — the canonical loop gate.
 *
 * Returns a Ratchet that advances ONLY when:
 *   1. A verdict is present (not undefined).
 *   2. verdict.verdict === 'sufficient'.
 *   3. verdict.confidence >= minConfidence (default 0.6).
 *
 * Any other combination produces { advance: false } with an honest reason.
 *
 * WHY DEFAULT 0.6?
 * A confidence of 0.6 is the minimum that meaningfully separates "I think
 * this is right" from a coin flip. For high-stakes agentic actions raise it
 * to 0.8 or 0.9; for iterative drafting 0.6 is a reasonable starting point.
 *
 * WHY NOT LET THE LLM DECIDE?
 * LLMs are systematically overconfident. A parameter-free verifier + explicit
 * numeric threshold is auditable, reproducible, and falsifiable. The model
 * cannot talk its way past the gate.
 *
 * @param opts.minConfidence - Confidence floor. Default 0.6.
 */
export function verifiedRatchet(opts?: { minConfidence?: number }): Ratchet {
  const threshold = opts?.minConfidence ?? 0.6;
  return (v) => {
    if (v === undefined) {
      return { advance: false, reason: "no verdict" };
    }
    if (v.verdict !== "sufficient") {
      return {
        advance: false,
        reason: `verdict '${v.verdict}' is not 'sufficient'${v.source ? ` (source: ${v.source})` : ""}`,
      };
    }
    if (v.confidence < threshold) {
      return {
        advance: false,
        reason: `verdict is 'sufficient' but confidence ${v.confidence.toFixed(3)} < threshold ${threshold.toFixed(3)}`,
      };
    }
    return {
      advance: true,
      reason: `verified sufficient at confidence ${v.confidence.toFixed(3)} >= ${threshold.toFixed(3)}${v.source ? ` (source: ${v.source})` : ""}`,
    };
  };
}

// ---------------------------------------------------------------------------
// ImprovementCycle — propose → trial → verify → ratchet.
// ---------------------------------------------------------------------------

/**
 * Specification for a single improvement cycle.
 *
 * A cycle is one atomic unit of the agent's inner loop:
 *   1. propose()   — generate a candidate (e.g. a new model output, a plan, a patch).
 *   2. trial(p)    — execute/evaluate the candidate (e.g. run tests, score output).
 *   3. verify(p,t) — produce a RatchetVerdict judging whether the trial result meets the bar.
 *   4. ratchet(v)  — gate advancement; only commits if the verdict passes.
 *
 * This is a pure orchestration contract: no networking, no model calls. The
 * caller supplies every async function, keeping the primitive testable and
 * framework-agnostic.
 *
 * No public agent SDK exposes this propose→trial→verify→ratchet cycle as a
 * typed, composable primitive with a verifier gate at step 3. That is the gap
 * this fills.
 */
export interface ImprovementCycleSpec<P, T> {
  /** Generate a candidate proposal. */
  propose: () => Promise<P> | P;
  /** Execute / evaluate the proposal, producing trial evidence. */
  trial: (proposal: P) => Promise<T> | T;
  /**
   * Judge the proposal against the trial result.
   * Must return a RatchetVerdict — not a boolean, so confidence is always
   * surfaced rather than buried inside the verifier implementation.
   */
  verify: (proposal: P, trial: T) => Promise<RatchetVerdict> | RatchetVerdict;
  /**
   * The ratchet to use. Defaults to verifiedRatchet() (minConfidence 0.6).
   * Supply a custom Ratchet to adjust the threshold or plug in domain-specific
   * gate logic.
   */
  ratchet?: Ratchet;
}

/**
 * The result of a completed improvement cycle.
 *
 * All four artefacts are returned so the caller can log them to a receipt,
 * feed the decision back into the outer loop, or surface the reason to the user.
 */
export interface ImprovementResult<P, T> {
  proposal: P;
  trial: T;
  verdict: RatchetVerdict;
  decision: RatchetDecision;
}

/**
 * runImprovementCycle — execute one propose → trial → verify → ratchet cycle.
 *
 * This is the pure orchestration primitive for verified agent improvement. It
 * is intentionally thin: no retry logic, no outer loop, no networking. The
 * caller decides what to do with the ImprovementResult (advance, retry,
 * escalate, receipt it).
 *
 * Example:
 *   const result = await runImprovementCycle({
 *     propose: () => model.draft(prompt),
 *     trial: (draft) => runner.execute(draft),
 *     verify: (draft, output) => mathVerifier.score(draft, output),
 *   });
 *   if (result.decision.advance) commitToWeights(result.proposal);
 *
 * @param spec - The ImprovementCycleSpec describing all four phases.
 * @returns ImprovementResult containing all artefacts from the cycle.
 */
export async function runImprovementCycle<P, T>(
  spec: ImprovementCycleSpec<P, T>,
): Promise<ImprovementResult<P, T>> {
  const ratchet = spec.ratchet ?? verifiedRatchet();
  const proposal = await spec.propose();
  const trial = await spec.trial(proposal);
  const verdict = await spec.verify(proposal, trial);
  const decision = ratchet(verdict);
  return { proposal, trial, verdict, decision };
}

// ── Long-horizon: context compaction + a bounded, checkpointable driver ──────
// "Run soo long, hold soo much context": the two primitives a long-running agent
// needs. compactHistory keeps context bounded (summarize-and-continue); runUntil
// drives many steps with a hard cap, a stop predicate, and a checkpoint hook for
// durable resume. Both pure + provider-agnostic (you supply summarize/step).

export interface ChatMessage {
  role: string;
  content: string;
}

export interface CompactHistoryOptions {
  messages: ChatMessage[];
  /** Keep the most recent N messages verbatim (default 6). */
  keepRecent?: number;
  /** Summarize the older messages into one string. Provider-agnostic. */
  summarize: (older: ChatMessage[]) => Promise<string> | string;
  /** Only compact when total content chars exceed this (default 0 = compact
   *  whenever there is more history than keepRecent). */
  maxChars?: number;
  /** Role to attach the summary message under. Default 'system'. Set to 'user'
   *  for providers (e.g. Anthropic) that reject a second system message. */
  summaryRole?: "system" | "user";
}

export interface CompactHistoryResult {
  /** The compacted message list: [summary-as-system, ...recent] when compacted. */
  messages: ChatMessage[];
  compacted: boolean;
  summary?: string;
  /** How many older messages were folded into the summary. */
  droppedCount: number;
}

const SUMMARY_PREFIX = '[Summary of earlier conversation]';

/** Summarize-and-continue: fold older messages into one summary while keeping the
 *  most recent verbatim — so a conversation/loop can run far past the context
 *  window. No-op (compacted:false) when history is already small. */
export async function compactHistory(opts: CompactHistoryOptions): Promise<CompactHistoryResult> {
  const keepRecent = Math.max(1, Math.floor(opts.keepRecent ?? 6));
  const msgs = opts.messages ?? [];
  const totalChars = msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const maxChars = opts.maxChars ?? 0;
  // Nothing to fold, or still under the char budget → pass through unchanged.
  if (msgs.length <= keepRecent || (maxChars > 0 && totalChars <= maxChars)) {
    return { messages: msgs, compacted: false, droppedCount: 0 };
  }
  const older = msgs.slice(0, msgs.length - keepRecent);
  const recent = msgs.slice(msgs.length - keepRecent);
  const summary = String(await opts.summarize(older));
  const summaryRole = opts.summaryRole ?? 'system';
  return {
    messages: [{ role: summaryRole, content: `${SUMMARY_PREFIX}\n${summary}` }, ...recent],
    compacted: true,
    summary,
    droppedCount: older.length,
  };
}

export interface RunUntilOptions<S> {
  /** Initial loop state. */
  initial: S;
  /** One step: given the current state + index, produce the next state. */
  step: (state: S, i: number) => Promise<S> | S;
  /** Stop when this returns true (checked AFTER each step). */
  stopWhen: (state: S, i: number) => boolean;
  /** Hard ceiling on steps (the long-horizon safety net). Default 100. */
  maxSteps?: number;
  /** Optional checkpoint hook after each step — persist state for durable resume. */
  onCheckpoint?: (state: S, i: number) => Promise<void> | void;
}

export interface RunUntilResult<S> {
  state: S;
  steps: number;
  stopped: 'predicate' | 'maxSteps';
}

/** Drive a long-horizon loop: run `step` repeatedly until `stopWhen` holds or
 *  `maxSteps` is hit, checkpointing after each step. The bounded, resumable core
 *  of a long-running agent (pair `step` with compactHistory to stay in budget). */
export async function runUntil<S>(opts: RunUntilOptions<S>): Promise<RunUntilResult<S>> {
  const maxSteps = Math.max(1, Math.floor(opts.maxSteps ?? 100));
  let state = opts.initial;
  for (let i = 0; i < maxSteps; i++) {
    state = await opts.step(state, i);
    if (opts.onCheckpoint) await opts.onCheckpoint(state, i);
    if (opts.stopWhen(state, i)) return { state, steps: i + 1, stopped: 'predicate' };
  }
  return { state, steps: maxSteps, stopped: 'maxSteps' };
}

// ── boundWorkingSet: keep a long agent's working memory bounded ──────────────
// The third long-horizon primitive (with compactHistory + runUntil): cap a set
// of working items by importance + recency so it never outgrows the context
// window. Pinned items are never dropped (load-bearing); the rest are kept by
// highest score, ties broken by most-recent. Pure + provider-agnostic.

export interface WorkingItem {
  /** Lower = older (insertion order / step index). */
  seq: number;
  /** Importance in [0,1] — higher is kept preferentially. */
  importance?: number;
  /** Pinned items are never evicted (e.g. the goal, a committed decision). */
  pinned?: boolean;
}

export interface BoundWorkingSetResult<T> {
  kept: T[];
  evicted: T[];
}

/** Keep at most `max` items: all pinned, then the highest-importance (ties → most
 *  recent), preserving original order in the output. The bounded-working-set
 *  primitive for long-running agents — drop the least useful, never the pinned. */
export function boundWorkingSet<T extends WorkingItem>(items: T[], max: number): BoundWorkingSetResult<T> {
  const cap = Math.max(0, Math.floor(max));
  if (items.length <= cap) return { kept: items, evicted: [] };
  const pinned = items.filter((i) => i.pinned);
  const rest = items.filter((i) => !i.pinned);
  const slots = Math.max(0, cap - pinned.length);
  // Rank the unpinned by importance desc, then recency (higher seq) desc.
  const ranked = [...rest].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || b.seq - a.seq);
  const keepRest = new Set(ranked.slice(0, slots));
  const kept = items.filter((i) => i.pinned || keepRest.has(i)); // preserve original order
  const evicted = items.filter((i) => !i.pinned && !keepRest.has(i));
  return { kept, evicted };
}
