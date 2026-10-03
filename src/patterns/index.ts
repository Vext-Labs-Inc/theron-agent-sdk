// patterns/index.ts — reasoning patterns as framework-agnostic primitives.
//
// The server-side hive runs these as loops; this module generalizes them
// for ANY SDK user, on ANY provider. Each primitive takes provider-agnostic
// async functions (generate / score / verify / critique) and returns a typed,
// auditable result. No public agent SDK ships verifier/score-gated reasoning
// patterns — self-consistency voting, verifier-guided best-of-N, iterative
// self-refine — as first-class composable primitives; these do.
//
// Pure orchestration: no network, no model lock-in, no global state. Deterministic
// given deterministic inputs (no Math.random), so they are trivially testable.

// ── Self-consistency: sample N reasoning paths, take the majority answer ──────

export interface SelfConsistencyOptions<T> {
  /** How many independent samples to draw (clamped to >= 1). */
  samples: number;
  /** Produce sample `i` (0-based). Vary your prompt/temperature by `i`. */
  generate: (i: number) => Promise<T> | T;
  /** Cluster key for "same answer" — defaults to JSON of the value. Provide a
   *  normalizer (e.g. lowercase/trim) for free-text answers. */
  key?: (value: T) => string;
}

export interface SelfConsistencyResult<T> {
  /** The majority-consistent answer. */
  answer: T;
  /** Agreement ratio of the winning cluster in [0,1] — a reliability signal. */
  consistency: number;
  /** Votes for the winner. */
  votes: number;
  /** Total samples that produced a value. */
  total: number;
  /** All clusters, most-voted first. */
  clusters: Array<{ key: string; count: number; sample: T }>;
}

/** Sample N reasoning paths and return the majority-consistent answer plus the
 *  agreement ratio (Self-Consistency; Wang et al., 2022). */
export async function selfConsistency<T>(opts: SelfConsistencyOptions<T>): Promise<SelfConsistencyResult<T>> {
  const n = Math.max(1, Math.floor(opts.samples));
  const keyOf = opts.key ?? ((v: T) => JSON.stringify(v));
  const clusters = new Map<string, { count: number; sample: T }>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = await opts.generate(i);
    if (v === undefined || v === null) continue;
    total += 1;
    const k = keyOf(v);
    const c = clusters.get(k) ?? { count: 0, sample: v };
    c.count += 1;
    clusters.set(k, c);
  }
  if (total === 0) throw new Error("selfConsistency: generate produced no values");
  const ranked = [...clusters.entries()]
    .map(([key, { count, sample }]) => ({ key, count, sample }))
    .sort((a, b) => b.count - a.count);
  const winner = ranked[0];
  return {
    answer: winner.sample,
    consistency: Math.round((winner.count / total) * 1000) / 1000,
    votes: winner.count,
    total,
    clusters: ranked,
  };
}

// ── Best-of-N: generate N candidates, keep the highest-scored ────────────────

export interface BestOfNOptions<T> {
  /** How many candidates to generate (clamped to >= 1). */
  n: number;
  generate: (i: number) => Promise<T> | T;
  /** Score a candidate — higher is better (e.g. a verifier confidence). */
  score: (value: T, i: number) => Promise<number> | number;
}

export interface BestOfNResult<T> {
  best: T;
  score: number;
  index: number;
  scores: number[];
}

/** Verifier-guided best-of-N: generate N candidates, score each, return the
 *  highest-scoring one. The score function is where you plug a verifier. */
export async function bestOfN<T>(opts: BestOfNOptions<T>): Promise<BestOfNResult<T>> {
  const n = Math.max(1, Math.floor(opts.n));
  let best: { value: T; score: number; index: number } | null = null;
  const scores: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = await opts.generate(i);
    const s = await opts.score(v, i);
    scores.push(s);
    if (!best || s > best.score) best = { value: v, score: s, index: i };
  }
  if (!best) throw new Error("bestOfN: generate produced no candidates");
  return { best: best.value, score: best.score, index: best.index, scores };
}

// ── Self-refine: draft → critique → revise, early-exit when clean ────────────

export interface SelfRefineOptions<T> {
  draft: () => Promise<T> | T;
  /** Critique the current value — return concrete flaws (or a clean signal). */
  critique: (value: T, iter: number) => Promise<string> | string;
  /** Revise the value to address the critique. */
  revise: (value: T, critique: string, iter: number) => Promise<T> | T;
  /** Max critique→revise iterations (default 2, clamped to >= 1). */
  maxIters?: number;
  /** Return true when a critique signals "nothing to fix" — stops early
   *  (saves work). Default: matches "no issues"/"looks good"/"lgtm". */
  isClean?: (critique: string) => boolean;
}

export interface SelfRefineResult<T> {
  answer: T;
  iterations: number;
  revised: number;
  trace: Array<{ iter: number; critique: string; revised: boolean }>;
}

const DEFAULT_CLEAN = /\b(no (issues|problems|flaws|changes)|looks good|lgtm|nothing to (fix|improve))\b/i;

/** Iteratively self-correct: draft, critique, revise — stopping early when the
 *  critique is clean (Self-Refine; Madaan et al., 2023). */
export async function selfRefine<T>(opts: SelfRefineOptions<T>): Promise<SelfRefineResult<T>> {
  const maxIters = Math.max(1, Math.floor(opts.maxIters ?? 2));
  const isClean = opts.isClean ?? ((c: string) => DEFAULT_CLEAN.test(c));
  let value = await opts.draft();
  const trace: SelfRefineResult<T>["trace"] = [];
  let revised = 0;
  for (let iter = 1; iter <= maxIters; iter++) {
    const critique = String(await opts.critique(value, iter));
    if (isClean(critique)) {
      trace.push({ iter, critique, revised: false });
      break;
    }
    value = await opts.revise(value, critique, iter);
    revised += 1;
    trace.push({ iter, critique, revised: true });
  }
  return { answer: value, iterations: trace.length, revised, trace };
}

// ── Tree-of-thoughts: best-first branch/score/expand search ──────────────────

export interface TreeOfThoughtsOptions<T> {
  /** Candidate thoughts explored per depth step; the single best is retained
   *  (greedy, not a beam width). Clamped to >= 1. */
  breadth: number;
  /** Search depth (clamped to >= 1). */
  depth: number;
  /** Produce branch `b` of the current path. */
  expand: (path: T[], b: number) => Promise<T> | T;
  /** Score a candidate thought given the path so far — higher is better. */
  score: (candidate: T, path: T[]) => Promise<number> | number;
  /** Turn the winning path into a final answer (default: the last thought). */
  synthesize?: (path: T[]) => Promise<T> | T;
}

export interface TreeOfThoughtsResult<T> {
  answer: T;
  path: Array<{ thought: T; score: number }>;
}

/** GREEDY best-first reasoning search (NOT beam search): at each depth, expand
 *  `breadth` candidate thoughts, keep ONLY the single highest-scored, and continue
 *  for `depth` steps, then synthesize the winning path. `breadth` controls how many
 *  candidates are explored per step (one is retained) — it is not a beam width.
 *  Inspired by Tree of Thoughts (Yao et al., 2023). */
export async function treeOfThoughts<T>(opts: TreeOfThoughtsOptions<T>): Promise<TreeOfThoughtsResult<T>> {
  const breadth = Math.max(1, Math.floor(opts.breadth));
  const depth = Math.max(1, Math.floor(opts.depth));
  const path: T[] = [];
  const scored: Array<{ thought: T; score: number }> = [];
  for (let d = 0; d < depth; d++) {
    let best: { thought: T; score: number } | null = null;
    for (let b = 0; b < breadth; b++) {
      const cand = await opts.expand(path, b);
      const s = await opts.score(cand, path);
      if (!best || s > best.score) best = { thought: cand, score: s };
    }
    if (!best) break;
    path.push(best.thought);
    scored.push(best);
  }
  const answer = opts.synthesize ? await opts.synthesize(path) : path[path.length - 1];
  return { answer, path: scored };
}

// ── Chain-of-verification: draft → verify claims → revise ────────────────────

export interface ChainOfVerificationOptions<T> {
  draft: () => Promise<T> | T;
  /** Verification questions probing the draft's claims. */
  planChecks: (draft: T) => Promise<string[]> | string[];
  /** Answer one verification question INDEPENDENTLY (no sight of the draft). */
  answerCheck: (question: string) => Promise<string> | string;
  /** Revise the draft to drop/correct claims the checks didn't support. */
  revise: (draft: T, checks: Array<{ q: string; a: string }>) => Promise<T> | T;
}

export interface ChainOfVerificationResult<T> {
  answer: T;
  checks: Array<{ q: string; a: string }>;
}

/** Draft → generate verification questions → answer each independently →
 *  revise. Targeted hallucination reduction (Chain-of-Verification; Dhuliawala
 *  et al., 2023). */
export async function chainOfVerification<T>(opts: ChainOfVerificationOptions<T>): Promise<ChainOfVerificationResult<T>> {
  const draft = await opts.draft();
  const questions = (await opts.planChecks(draft)) ?? [];
  const checks: Array<{ q: string; a: string }> = [];
  for (const q of questions) {
    checks.push({ q, a: String(await opts.answerCheck(q)) });
  }
  const answer = checks.length ? await opts.revise(draft, checks) : draft;
  return { answer, checks };
}

// ── Reflexion: retry with accumulated verbal reflections on failure ──────────

export interface ReflexionOptions<T> {
  /** Max attempts (clamped to >= 1). */
  maxAttempts: number;
  /** Attempt the task, with prior verbal reflections available as context. */
  attempt: (reflections: string[], i: number) => Promise<T> | T;
  /** Did the attempt succeed? Return success + feedback for reflection. */
  evaluate: (result: T, i: number) => Promise<{ success: boolean; feedback: string }> | { success: boolean; feedback: string };
  /** Write a verbal reflection on the failure to carry into the next attempt. */
  reflect: (result: T, feedback: string, i: number) => Promise<string> | string;
}

export interface ReflexionResult<T> {
  answer: T;
  attempts: number;
  succeeded: boolean;
  /** The verbal reflections accumulated across failed attempts. */
  reflections: string[];
}

/** Verbal reinforcement: attempt → evaluate → reflect → retry, carrying the
 *  accumulated reflections into each next attempt; stops on success or attempt
 *  budget (Reflexion; Shinn et al., 2023). It carries outcome feedback
 *  (success or failure) into the next attempt. */
export async function reflexion<T>(opts: ReflexionOptions<T>): Promise<ReflexionResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts));
  const reflections: string[] = [];
  let last!: T;
  for (let i = 0; i < maxAttempts; i++) {
    last = await opts.attempt(reflections, i);
    const { success, feedback } = await opts.evaluate(last, i);
    if (success) return { answer: last, attempts: i + 1, succeeded: true, reflections };
    if (i < maxAttempts - 1) reflections.push(String(await opts.reflect(last, feedback, i)));
  }
  return { answer: last, attempts: maxAttempts, succeeded: false, reflections };
}

// ── Mixture-of-Agents: layered multi-agent propose → refine → aggregate ──────

export interface MixtureOfAgentsOptions {
  /** Number of proposer agents per layer (clamped to >= 1). */
  agents: number;
  /** Refinement layers — layer 1 proposes, layers 2..L refine (clamped to >= 1). */
  layers: number;
  /** Layer-1 proposal from agent `a`. Vary persona/temperature by `a`. */
  propose: (agent: number) => Promise<string> | string;
  /** Refine agent `a`'s answer given the OTHER agents' prior-layer answers.
   *  Optional: only called for layers >= 2, so single-layer (propose → aggregate)
   *  usage need not supply it. */
  refine?: (agent: number, others: string[], layer: number) => Promise<string> | string;
  /** Synthesize the final layer's answers into one. */
  aggregate: (finalLayer: string[]) => Promise<string> | string;
}

export interface MixtureOfAgentsResult {
  answer: string;
  /** Each layer's per-agent outputs (layerOutputs[0] = layer 1 proposals). */
  layerOutputs: string[][];
}

/** Layered Mixture-of-Agents: N agents propose, then refine while seeing each
 *  other's answers across L layers, then an aggregator synthesizes the best
 *  (Mixture-of-Agents; ICLR 2025). Diverse perspectives + cross-refinement. */
export async function mixtureOfAgents(opts: MixtureOfAgentsOptions): Promise<MixtureOfAgentsResult> {
  const agents = Math.max(1, Math.floor(opts.agents));
  const layers = Math.max(1, Math.floor(opts.layers));
  const layerOutputs: string[][] = [];

  // Layer 1 — independent proposals.
  let current: string[] = [];
  for (let a = 0; a < agents; a++) current.push(String(await opts.propose(a)));
  layerOutputs.push([...current]);

  // Layers 2..L — each agent refines seeing the others' prior-layer answers.
  for (let layer = 2; layer <= layers; layer++) {
    if (!opts.refine) break; // no refiner supplied → stop after layer 1 (propose-only)
    const next: string[] = [];
    for (let a = 0; a < agents; a++) {
      const others = current.filter((_, i) => i !== a);
      next.push(String(await opts.refine(a, others, layer)));
    }
    current = next;
    layerOutputs.push([...current]);
  }

  const answer = String(await opts.aggregate(current));
  return { answer, layerOutputs };
}

// ── measureLift: does a pattern/loop actually beat the baseline? ──────────────
// The empirical backbone of "the system is the moat, not raw scale": prove a
// pattern helps by MEASURING its score lift over a single-shot baseline on a
// task set, rather than asserting it. Pure + deterministic given deterministic
// inputs — no benchmark framework required.

export interface MeasureLiftOptions<Task> {
  /** The evaluation task set. */
  tasks: Task[];
  /** The control: produce an output for a task (e.g. a single-shot answer). */
  baseline: (task: Task, index: number) => Promise<string> | string;
  /** The treatment: produce an output via a pattern/loop (e.g. selfConsistency). */
  treatment: (task: Task, index: number) => Promise<string> | string;
  /** Score an output for a task in [0,1] — higher is better (your verifier). */
  score: (task: Task, output: string, index: number) => Promise<number> | number;
}

export interface MeasureLiftResult<Task> {
  n: number;
  baselineMean: number;
  treatmentMean: number;
  /** treatmentMean − baselineMean. Positive = the pattern helped. */
  lift: number;
  /** Fraction of tasks where treatment scored strictly higher than baseline. */
  winRate: number;
  perTask: Array<{ task: Task; baseline: number; treatment: number; delta: number }>;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Measure a pattern/loop's score lift over a baseline on a task set. Returns
 *  mean scores, the lift (treatment − baseline), the win-rate, and per-task
 *  deltas — the evidence that the harness beats single-shot. */
export async function measureLift<Task>(opts: MeasureLiftOptions<Task>): Promise<MeasureLiftResult<Task>> {
  const perTask: MeasureLiftResult<Task>["perTask"] = [];
  const baseScores: number[] = [];
  const treatScores: number[] = [];
  let wins = 0;
  for (let i = 0; i < opts.tasks.length; i++) {
    const task = opts.tasks[i];
    const bOut = await opts.baseline(task, i);
    const tOut = await opts.treatment(task, i);
    const b = await opts.score(task, bOut, i);
    const t = await opts.score(task, tOut, i);
    baseScores.push(b);
    treatScores.push(t);
    if (t > b) wins += 1;
    perTask.push({ task, baseline: round(b), treatment: round(t), delta: round(t - b) });
  }
  const baselineMean = round(mean(baseScores));
  const treatmentMean = round(mean(treatScores));
  return {
    n: opts.tasks.length,
    baselineMean,
    treatmentMean,
    lift: round(treatmentMean - baselineMean),
    winRate: opts.tasks.length ? round(wins / opts.tasks.length) : 0,
    perTask,
  };
}
