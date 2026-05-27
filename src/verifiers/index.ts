// Verifier — typed kernels that check agent output before it leaves the graph.
//
// Verifiers are NOT another LLM call (that's slow, expensive, and itself
// hallucinates). They are small, deterministic, fast checkers:
//   - regex
//   - SMT / SAT
//   - SQL constraint
//   - hash-equal
//   - arithmetic recheck
//   - citation presence
//
// Verifier kernels are the primitive nobody else ships as first-class.

export interface VerifierIssue {
  /** Which verifier kernel raised this. */
  kernel: string;
  /** Severity. */
  severity: "error" | "warning" | "info";
  /** Human-readable message. */
  message: string;
  /** Optional pointer to the offending span in the output. */
  span?: { start: number; end: number };
}

export interface VerifierResult {
  kernel: string;
  pass: boolean;
  issues: VerifierIssue[];
  ms: number;
}

export interface Verifier {
  name: string;
  description: string;
  check(output: string, context?: unknown): Promise<VerifierResult>;
}

/**
 * defineVerifier — ergonomic verifier factory.
 *
 * Example:
 *   const noEmDashes = defineVerifier({
 *     name: "em_dash_check",
 *     description: "Block em-dashes in user-facing copy.",
 *     check: async (output) => {
 *       const issues = [...output.matchAll(/—/g)].map((m) => ({
 *         kernel: "em_dash_check",
 *         severity: "error" as const,
 *         message: "Em-dash detected",
 *         span: { start: m.index!, end: m.index! + 1 },
 *       }));
 *       return { pass: issues.length === 0, issues };
 *     },
 *   });
 */
export function defineVerifier(opts: {
  name: string;
  description: string;
  check: (output: string, context?: unknown) => Promise<{ pass: boolean; issues: VerifierIssue[] }>;
}): Verifier {
  return {
    name: opts.name,
    description: opts.description,
    async check(output, context) {
      const t0 = Date.now();
      const result = await opts.check(output, context);
      return { kernel: opts.name, pass: result.pass, issues: result.issues, ms: Date.now() - t0 };
    },
  };
}

// Built-in verifier kernels — composed or extended via defineVerifier.

export const VerifierKernels = {
  /** Block em-dashes (common AI tell). */
  emDash: defineVerifier({
    name: "em_dash_check",
    description: "Block em-dashes in output (common AI tell).",
    check: async (output: string) => {
      const matches = [...output.matchAll(/—/g)];
      const issues = matches.map((m) => ({
        kernel: "em_dash_check",
        severity: "error" as const,
        message: "Em-dash detected",
        span: { start: m.index!, end: m.index! + 1 },
      }));
      return { pass: issues.length === 0, issues };
    },
  }),

  /** Block common AI-ism words. Word-boundary aware to avoid false positives
   *  (e.g., "leverage" matches but not "delivered"). */
  aiIsm: defineVerifier({
    name: "ai_ism_check",
    description: "Block common AI-ism words.",
    check: async (output: string) => {
      const aiisms = ["delve", "tapestry", "leverage", "robust", "seamless", "navigate", "embark"];
      const issues: VerifierIssue[] = [];
      for (const w of aiisms) {
        const re = new RegExp(`\\b${w}\\b`, "gi");
        if (re.test(output)) {
          issues.push({
            kernel: "ai_ism_check",
            severity: "warning",
            message: `AI-ism detected: "${w}"`,
          });
        }
      }
      return { pass: issues.length === 0, issues };
    },
  }),

  /** Re-evaluate arithmetic claims like "X op Y = Z". */
  arithmetic: defineVerifier({
    name: "arithmetic_recheck",
    description: "Re-evaluate arithmetic in 'X op Y = Z' form.",
    check: async (output: string) => {
      const pattern = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;
      const issues: VerifierIssue[] = [];
      for (const m of output.matchAll(pattern)) {
        const a = parseFloat(m[1]);
        const op = m[2];
        const b = parseFloat(m[3]);
        const claimed = parseFloat(m[4]);
        const actual =
          op === "+" ? a + b
          : op === "-" ? a - b
          : op === "*" ? a * b
          : op === "/" ? (b === 0 ? NaN : a / b)
          : NaN;
        if (!Number.isFinite(actual) || Math.abs(actual - claimed) > 1e-6) {
          issues.push({
            kernel: "arithmetic_recheck",
            severity: "error",
            message: `Claimed ${a} ${op} ${b} = ${claimed}; actual ${Number.isFinite(actual) ? actual : "undefined"}`,
          });
        }
      }
      return { pass: issues.length === 0, issues };
    },
  }),

  /** Require at least one citation pattern ([N], (Author Year), https://...). */
  citationPresence: defineVerifier({
    name: "citation_presence",
    description: "Require at least one citation in output.",
    check: async (output: string) => {
      const patterns = [/\[\d+\]/, /\([A-Z][a-z]+(?: et al\.?)? \d{4}\)/, /https?:\/\//];
      const found = patterns.some((p) => p.test(output));
      const issues: VerifierIssue[] = found
        ? []
        : [
            {
              kernel: "citation_presence",
              severity: "error",
              message: "No citation found. Expected one of: [N], (Author YEAR), or a URL.",
            },
          ];
      return { pass: found, issues };
    },
  }),
};
