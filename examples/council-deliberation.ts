/**
 * council-deliberation — 3 specialists + reconciler on a hard problem.
 *
 * Three generic agents (Engineer, Security, Product) deliberate. Verifier
 * kernels run across every output. The default deterministic reconciler
 * collapses agreeing claims; disagreements surface as a split consensus.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/council-deliberation.ts
 *
 * Why OpenRouter and not the Theron adapter here? Council deliberation needs
 * three independent specialist calls. Local dev against OpenRouter gives you
 * that for ~$0.001/run. In production, point the Runner at theronAdapter and
 * the Vext-hosted council answers all three roles with trained LoRAs.
 */
import { Agent, Council, Runner, VerifierKernels } from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

const engineer = new Agent({
  name: "engineer",
  instruction:
    "You are a senior backend engineer. Answer from a system-design and " +
    "reliability perspective. Be specific about trade-offs. Cite RFCs and " +
    "public benchmarks where applicable.",
});

const security = new Agent({
  name: "security",
  instruction:
    "You are an application-security engineer. Answer from a threat-model " +
    "and attack-surface perspective. Flag anything that could be exploited. " +
    "Cite OWASP / CWE / CVE where applicable.",
});

const product = new Agent({
  name: "product",
  instruction:
    "You are a product manager. Answer from a user-impact and adoption " +
    "perspective. Be specific about who this helps, who it doesn't, and " +
    "what could backfire.",
});

const council = new Council({
  name: "engineering-review",
  specialists: [engineer, security, product],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
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
    if (event.type === "specialist_done") {
      console.log(`\n--- ${event.specialist} ---`);
      console.log(event.output.output.slice(0, 280) + "...");
    }
    if (event.type === "council_done") {
      console.log(`\n=== Council answer (${event.output.consensus}) ===`);
      console.log(event.output.answer);
      const splits = event.output.disagreements ?? [];
      if (splits.length > 0) {
        console.log(`\n=== Disagreements (${splits.length}) ===`);
        for (const d of splits) {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
