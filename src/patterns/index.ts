export interface SelfConsistencyOptions<T> {
  samples: number;
  generate: (i: number) => Promise<T> | T;
  key?: (value: T) => string;
}

export interface SelfConsistencyResult<T> {
  answer: T;
  consistency: number;
  votes: number;
  total: number;
  clusters: Array<{ key: string; count: number; sample: T }>;
}

/** Sample N reasoning paths and return the majority-consistent answer. */
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
    consistency: Math.round((winner.count / total) * 1e3) / 1e3,
    votes: winner.count,
    total,
    clusters: ranked,
  };
}

export interface BestOfNOptions<T> {
  n: number;
  generate: (i: number) => Promise<T> | T;
  score: (value: T, i: number) => Promise<number> | number;
}

export interface BestOfNResult<T> {
  best: T;
  score: number;
  index: number;
  scores: number[];
}

/** Generate N candidates, score each, return the highest-scoring one. */
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

const DEFAULT_CLEAN = /\b(no (issues|problems|flaws|changes)|looks good|lgtm|nothing to (fix|improve))\b/i;

export interface SelfRefineOptions<T> {
  draft: () => Promise<T> | T;
  critique: (value: T, iter: number) => Promise<string> | string;
  revise: (value: T, critique: string, iter: number) => Promise<T> | T;
  maxIters?: number;
  isClean?: (critique: string) => boolean;
}

export interface SelfRefineResult<T> {
  answer: T;
  iterations: number;
  revised: number;
  trace: Array<{ iter: number; critique: string; revised: boolean }>;
}

/** Draft, critique, revise — stopping early when the critique is clean. */
export async function selfRefine<T>(opts: SelfRefineOptions<T>): Promise<SelfRefineResult<T>> {
  const maxIters = Math.max(1, Math.floor(opts.maxIters ?? 2));
  const isClean = opts.isClean ?? ((c: string) => DEFAULT_CLEAN.test(c));
  let value = await opts.draft();
  const trace: Array<{ iter: number; critique: string; revised: boolean }> = [];
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

export interface TreeOfThoughtsOptions<T> {
  breadth: number;
  depth: number;
  expand: (path: T[], b: number) => Promise<T> | T;
  score: (candidate: T, path: T[]) => Promise<number> | number;
  synthesize?: (path: T[]) => Promise<T> | T;
}

export interface TreeOfThoughtsResult<T> {
  answer: T;
  path: Array<{ thought: T; score: number }>;
}

/** Greedy best-first search: keep the single highest-scored thought at each depth. */
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

export interface ChainOfVerificationOptions<T> {
  draft: () => Promise<T> | T;
  planChecks: (draft: T) => Promise<string[]> | string[];
  answerCheck: (question: string) => Promise<string> | string;
  revise: (draft: T, checks: Array<{ q: string; a: string }>) => Promise<T> | T;
}

export interface ChainOfVerificationResult<T> {
  answer: T;
  checks: Array<{ q: string; a: string }>;
}

/** Draft, check claims independently, then revise. */
export async function chainOfVerification<T>(
  opts: ChainOfVerificationOptions<T>,
): Promise<ChainOfVerificationResult<T>> {
  const draft = await opts.draft();
  const questions = (await opts.planChecks(draft)) ?? [];
  const checks: Array<{ q: string; a: string }> = [];
  for (const q of questions) {
    checks.push({ q, a: String(await opts.answerCheck(q)) });
  }
  const answer = checks.length ? await opts.revise(draft, checks) : draft;
  return { answer, checks };
}

export interface ReflexionOptions<T> {
  maxAttempts: number;
  attempt: (reflections: string[], i: number) => Promise<T> | T;
  evaluate: (result: T, i: number) => Promise<{ success: boolean; feedback: string }> | { success: boolean; feedback: string };
  reflect: (result: T, feedback: string, i: number) => Promise<string> | string;
}

export interface ReflexionResult<T> {
  answer: T;
  attempts: number;
  succeeded: boolean;
  reflections: string[];
}

/** Attempt, evaluate, reflect, and retry until success or the attempt budget. */
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

export interface MixtureOfAgentsOptions {
  agents: number;
  layers: number;
  propose: (agent: number) => Promise<string> | string;
  refine?: (agent: number, others: string[], layer: number) => Promise<string> | string;
  aggregate: (finalLayer: string[]) => Promise<string> | string;
}

export interface MixtureOfAgentsResult {
  answer: string;
  layerOutputs: string[][];
}

/** Layered mixture of agents: propose, refine across layers, then aggregate. */
export async function mixtureOfAgents(opts: MixtureOfAgentsOptions): Promise<MixtureOfAgentsResult> {
  const agents = Math.max(1, Math.floor(opts.agents));
  const layers = Math.max(1, Math.floor(opts.layers));
  const layerOutputs: string[][] = [];
  let current: string[] = [];
  for (let a = 0; a < agents; a++) current.push(String(await opts.propose(a)));
  layerOutputs.push([...current]);
  for (let layer = 2; layer <= layers; layer++) {
    if (!opts.refine) break;
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

export interface MeasureLiftOptions<Task> {
  tasks: Task[];
  baseline: (task: Task, index: number) => Promise<string> | string;
  treatment: (task: Task, index: number) => Promise<string> | string;
  score: (task: Task, output: string, index: number) => Promise<number> | number;
}

export interface MeasureLiftResult<Task> {
  n: number;
  baselineMean: number;
  treatmentMean: number;
  lift: number;
  winRate: number;
  perTask: Array<{ task: Task; baseline: number; treatment: number; delta: number }>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 1e3) / 1e3;

/** Measure a pattern's score lift over a baseline on a task set. */
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
