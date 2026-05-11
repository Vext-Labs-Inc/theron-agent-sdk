/**
 * Sample agent 03: Council of Three — deliberation with verifier kernels.
 *
 * Three generic agents (Engineer, Security, Product) deliberate on a question.
 * Outputs are checked by verifier kernels before reconciliation.
 *
 * This is the 15-line Council pattern — the Hive moat in a single example.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-... tsx examples/03_council_of_three.ts
 *
 * What this demonstrates:
 *   - Council primitive (the flagship Hive SDK feature)
 *   - Multi-specialist deliberation
 *   - Verifier kernels applied across the council
 *   - Reconciler (deterministic claim-merge by default)
 */

import { Agent, Council, Runner, VerifierKernels } from "../src/index.js";
import { openrouterAdapter } from "../examples/_adapters/openrouter.js";

const engineer = new Agent({
  name: "engineer",
  instruction: `You are a senior backend engineer. Answer from a system-design + reliability perspective.
Be specific about trade-offs. Cite RFCs / specs / public benchmarks where applicable.
Do not use em-dashes or AI-ism words.`,
});

const security = new Agent({
  name: "security",
  instruction: `You are an application-security engineer. Answer from a threat-model + attack-surface perspective.
Flag anything that could be exploited. Cite OWASP / CWE / CVE where applicable.
Do not use em-dashes or AI-ism words.`,
});

const product = new Agent({
  name: "product",
  instruction: `You are a product manager. Answer from a user-impact + adoption perspective.
Be specific about who this helps, who it doesn't, and what could backfire.
Do not use em-dashes or AI-ism words.`,
});

const council = new Council({
  name: "engineering-review",
  specialists: [engineer, security, product],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
  // No reconciler specified → defaults to deterministic claim-merge.
});

async function main() {
  const runner = new Runner({
    model: openrouterAdapter({ apiKey: process.env.OPENROUTER_API_KEY! }),
    default_model: "openai/gpt-4o-mini",
  });

  runner.on((event) => {
    if (event.type === "specialist_done") {
      console.log(`\n--- ${event.specialist} ---`);
      console.log(event.output.output.slice(0, 300) + "...");
    }
    if (event.type === "council_done") {
      console.log(`\n=== Council answer (${event.output.consensus}) ===`);
      console.log(event.output.answer);
      if (event.output.disagreements && event.output.disagreements.length > 0) {
        console.log(`\n=== Disagreements ===`);
        for (const d of event.output.disagreements) {
          console.log(`Claim: "${d.claim}"`);
          console.log(`  for:     ${d.specialists_for.join(", ")}`);
          console.log(`  against: ${d.specialists_against.join(", ")}`);
        }
      }
    }
  });

  await runner.runCouncil(
    council,
    "Should we let users store API keys in localStorage instead of a cookie?",
  );
}

main().catch(console.error);
