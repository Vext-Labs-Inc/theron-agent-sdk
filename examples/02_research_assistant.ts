/**
 * Sample agent 02: Research Assistant
 *
 * Answers a research question with web-fetched citations. Output is gated
 * by the citation_presence verifier kernel.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-... tsx examples/02_research_assistant.ts
 *
 * What this demonstrates:
 *   - Verifier kernel composition (citation_presence)
 *   - Sub-tools that take web actions
 *   - Free verifier guarantees (no LLM "judge" cost; pure regex check)
 */

import { Agent, Runner, defineTool, zod as z, VerifierKernels } from "../src/index.js";
import { openrouterAdapter } from "../examples/_adapters/openrouter.js";

const webSearch = defineTool({
  name: "web_search",
  description: "Search the web. Returns titles + URLs + snippets.",
  input: z.object({ query: z.string() }),
  async execute({ query }) {
    // In production: call a real search API (Tavily, Serper, etc.).
    // For the sample: return fixed mock results.
    return {
      query,
      results: [
        {
          title: "Chinchilla scaling laws",
          url: "https://arxiv.org/abs/2203.15556",
          snippet: "Hoffmann et al. 2022 — compute-optimal model + token ratio.",
        },
        {
          title: "Scaling Laws for Neural Language Models",
          url: "https://arxiv.org/abs/2001.08361",
          snippet: "Kaplan et al. 2020 — original power-law claims.",
        },
      ],
    };
  },
});

const researcher = new Agent({
  name: "research-assistant",
  instruction: `You are a careful research assistant. Answer the user's question
with citations. Every factual claim must reference a source from web_search.
Format citations inline as [N] with a numbered references list at the end.`,
  tools: [webSearch],
  verifiers: ["citation_presence"],
});

async function main() {
  const runner = new Runner({
    model: openrouterAdapter({ apiKey: process.env.OPENROUTER_API_KEY! }),
    default_model: "openai/gpt-4o-mini",
  });

  // Run the agent
  const result = await runner.run(
    researcher,
    "Did the Chinchilla paper overturn the 2020 scaling laws? Cite your sources.",
  );

  console.log("\n=== Answer ===");
  console.log(result.output);

  // Apply the citation_presence verifier to the output
  const verifierResult = await VerifierKernels.citationPresence.check(result.output);
  console.log(`\n=== Verifier: citation_presence ===`);
  console.log(`Pass: ${verifierResult.pass}`);
  if (!verifierResult.pass) {
    console.log("Issues:", verifierResult.issues);
  }
}

main().catch(console.error);
