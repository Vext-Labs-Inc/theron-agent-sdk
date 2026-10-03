/**
 * basic-agent: 1 tool, calls chat completions, streams to stdout.
 *
 * `baseURL` is the OpenAI-style API root. The adapter POSTs to
 * `<baseURL>/chat/completions`. OpenAI: `https://api.openai.com/v1`.
 * Ollama: `http://127.0.0.1:11434/v1`. Set `baseURL` (or `VEXT_BASE_URL`)
 * together with the API key. There is no hosted default.
 *
 * Run:
 *   VEXT_BASE_URL=https://your-endpoint.example VEXT_API_KEY=... npx tsx examples/basic-agent.ts
 *
 * `THERON_BASE_URL` is a deprecated fallback used only when `VEXT_BASE_URL` is unset.
 *
 * What this shows:
 *   - Define a tool with Zod (defineTool)
 *   - Build a one-line Agent
 *   - Drive it with Runner + createVextAdapter
 *   - Stream tokens to stdout via runner.on("agent_thinking")
 */
import { Agent, Runner, createVextAdapter, defineTool, zod as z } from "../src/index.js";

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
  const baseURL = process.env.VEXT_BASE_URL ?? process.env.THERON_BASE_URL;
  if (!baseURL) {
    throw new Error("No hosted default endpoint; pass baseURL or set VEXT_BASE_URL");
  }
  const runner = new Runner({
    model: createVextAdapter({
      baseURL,
      apiKey: process.env.VEXT_API_KEY ?? process.env.THERON_API_KEY,
    }),
    default_model: "your-model",
  });

  runner.on((event) => {
    if (event.type === "agent_thinking") process.stdout.write(event.delta);
    if (event.type === "agent_output") process.stdout.write("\n");
  });

  await runner.run(helper, "In one sentence, what is a council of specialists?");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
