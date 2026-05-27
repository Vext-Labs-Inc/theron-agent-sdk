/**
 * Sample agent 01: Code Reviewer
 *
 * Reviews a diff and produces structured feedback. Works against any
 * OpenRouter-compatible model — no Vext API key needed.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/01_code_reviewer.ts
 *
 * What this demonstrates:
 *   - The 5-line agent pattern (Agent + tools + Runner)
 *   - Tool definition via defineTool + Zod schema
 *   - Streaming via runner.on("agent_thinking", ...)
 *   - Verifier kernels gating the final output (no extra LLM cost)
 */

import { Agent, Runner, defineTool, zod as z, VerifierKernels } from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

const readDiff = defineTool({
  name: "read_diff",
  description: "Read the unified-diff of a PR. For demo: returns a fixed diff.",
  input: z.object({ pr_url: z.string().url() }),
  async execute({ pr_url }) {
    // In production: fetch the diff from GitHub API.
    // For the sample: return a fixed diff that contains a deliberate
    // SQL-injection regression the reviewer should catch.
    return {
      pr_url,
      diff: `
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,7 +10,7 @@ export async function login(username: string, password: string) {
-  const user = await db.users.findOne({ username });
+  const user = await db.query(\`SELECT * FROM users WHERE username = '\${username}'\`);
   if (!user) return null;
   if (user.password === password) return user;
   return null;
}
`.trim(),
    };
  },
});

const reviewer = new Agent({
  name: "code-reviewer",
  instruction: `You are a senior code reviewer. Read the diff and identify:
1. Security issues (SQL injection, auth bypass, etc.) — severity HIGH if present
2. Bug risks (null deref, race conditions, etc.) — severity MEDIUM
3. Style or clarity issues — severity LOW

Output a structured review with file:line references and one-line explanations per issue.
Do not use em-dashes or AI-ism words.`,
  tools: [readDiff],
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
    if (event.type === "agent_thinking") process.stdout.write(event.delta);
    if (event.type === "tool_call_start") console.log(`\n→ ${event.tool}(${JSON.stringify(event.input)})`);
    if (event.type === "agent_output") console.log(`\n\n=== Review ===\n${event.output}`);
    if (event.type === "verifier_run" && !event.result.pass) {
      console.log(`\n[verifier ${event.kernel}] ${event.result.issues.length} issue(s)`);
    }
  });

  const result = await runner.run(reviewer, "Review https://github.com/example/repo/pull/42");
  const failed = result.verifier_results.filter((v) => !v.pass);
  if (failed.length > 0) {
    console.log(`\nVerifier failures: ${failed.map((v) => v.kernel).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
