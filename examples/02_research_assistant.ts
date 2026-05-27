/**
 * Sample agent 02: Research Assistant
 *
 * Answers a research question with web-fetched citations. Output is gated
 * by the citation_presence verifier kernel.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/02_research_assistant.ts
 *
 * What this demonstrates:
 *   - Verifier kernel composition (citation_presence)
 *   - Sub-tools that take web actions
 *   - Free verifier guarantees (no LLM "judge" cost; pure regex check)
 */

import { Agent, Runner, defineTool, zod as z, VerifierKernels } from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

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
  verifiers: [VerifierKernels.citationPresence],
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

  const result = await runner.run(
    researcher,
    "Did the Chinchilla paper overturn the 2020 scaling laws? Cite your sources.",
  );

  console.log("\n=== Answer ===");
  console.log(result.output);

  // result.verifier_results already includes the citation_presence outcome
  // (the Runner ran every verifier on the agent). This is just for display.
  for (const v of result.verifier_results) {
    console.log(`\n=== Verifier: ${v.kernel} ===`);
    console.log(`Pass: ${v.pass}`);
    if (!v.pass) console.log("Issues:", v.issues);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
