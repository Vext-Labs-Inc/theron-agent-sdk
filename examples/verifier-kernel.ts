/**
 * verifier-kernel — define a custom verifier, attach it to an agent,
 * watch the refutation flow.
 *
 * The custom kernel here flags any claim of the form "X happened in YEAR"
 * where YEAR < 1900 or YEAR > current year. Cheap, deterministic, and runs
 * in milliseconds. Verifiers do NOT call another LLM — they're the answer
 * to "LLM-judge is slow, expensive, and hallucinates."
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/verifier-kernel.ts
 *
 * What this shows:
 *   - defineVerifier — the factory for custom kernels
 *   - Attaching a verifier to an Agent (vs a Council)
 *   - The "issues" payload that surfaces on refutation
 *   - That a failed verifier does NOT throw — callers decide policy
 */
import {
  Agent,
  Runner,
  defineVerifier,
  VerifierKernels,
} from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

const currentYear = new Date().getFullYear();

const plausibleYear = defineVerifier({
  name: "plausible_year",
  description:
    "Flag claims with year numbers outside [1900, current year]. " +
    "Catches hallucinated historical dates and future-dated claims.",
  check: async (output) => {
    const pattern = /\b(\d{4})\b/g;
    const issues = [];
    for (const m of output.matchAll(pattern)) {
      const y = parseInt(m[1], 10);
      if (y < 1900 || y > currentYear) {
        issues.push({
          kernel: "plausible_year",
          severity: "error" as const,
          message: `Year ${y} is implausible (expected 1900..${currentYear}).`,
          span: { start: m.index!, end: m.index! + m[1].length },
        });
      }
    }
    return { pass: issues.length === 0, issues };
  },
});

const historian = new Agent({
  name: "historian",
  instruction:
    "You answer history questions in 2-3 sentences. Always include the " +
    "year a key event happened. Be concise.",
  verifiers: [
    plausibleYear,
    VerifierKernels.emDash,
    VerifierKernels.aiIsm,
  ],
});

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY (https://openrouter.ai/keys) and rerun.");
    process.exit(1);
  }

  const runner = new Runner({
    model: openrouterAdapter({ apiKey }),
    default_model: "openai/gpt-4o-mini",
  });

  runner.on((event) => {
    if (event.type === "agent_thinking") process.stdout.write(event.delta);
    if (event.type === "verifier_run") {
      const { kernel, result } = event;
      const tag = result.pass ? "PASS" : "FAIL";
      console.log(`\n[${tag}] ${kernel} (${result.ms}ms)`);
      for (const issue of result.issues) {
        console.log(`  - ${issue.severity}: ${issue.message}`);
      }
    }
  });

  const result = await runner.run(
    historian,
    "When did the first programmable digital computer come online? Answer with a year.",
  );

  console.log("\n--- Final output ---");
  console.log(result.output);

  const failed = result.verifier_results.filter((v) => !v.pass);
  if (failed.length > 0) {
    console.log(`\nRefutations: ${failed.map((v) => v.kernel).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll verifier kernels passed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
