/**
 * basic-agent — 1 tool, calls the hosted Theron endpoint, streams to stdout.
 *
 * Run:
 *   THERON_API_KEY=... npx tsx examples/basic-agent.ts
 *
 * What this shows:
 *   - Define a tool with Zod (defineTool)
 *   - Build a one-line Agent
 *   - Drive it with Runner + theronAdapter against tryvext.com
 *   - Stream tokens to stdout via runner.on("agent_thinking")
 *
 * The hosted Theron endpoint does not return tool calls today, so the agent
 * answers from the conversation; the tool is included to show the contract.
 * Swap theronAdapter for openrouterAdapter to get real tool-call routing.
 */
import { Agent, Runner, defineTool, zod as z } from "../src/index.js";
import { theronAdapter } from "./adapters/theron.js";

const wordCount = defineTool({
  name: "word_count",
  description: "Count words in a passage. Returns { count }.",
  input: z.object({ text: z.string() }),
  async execute({ text }) {
    return { count: text.trim().split(/\s+/).filter(Boolean).length };
  },
});

const helper = new Agent({
  name: "helper",
  instruction:
    "Answer briefly. If the user gives a passage to count, call word_count.",
  tools: [wordCount],
});

async function main() {
  const runner = new Runner({
    model: theronAdapter({
      apiKey: process.env.THERON_API_KEY,
      surface: "marketing",
    }),
    default_model: "theron",
  });

  runner.on((event) => {
    if (event.type === "agent_thinking") process.stdout.write(event.delta);
    if (event.type === "agent_output") process.stdout.write("\n");
  });

  await runner.run(helper, "In one sentence, what is the Theron Council?");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
