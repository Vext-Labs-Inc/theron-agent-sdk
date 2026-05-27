/**
 * Sample agent: cyber-recon-bot
 *
 * Reconnaissance agent for authorized security testing. Given a target
 * hostname, plans a passive-recon chain (subdomain enumeration → port
 * surface → TLS posture → tech fingerprint) and produces a structured
 * report.
 *
 * SCOPE: ships with mock tools so it runs without external credentials and
 * cannot accidentally hit a real target. Wire your own subfinder / naabu /
 * httpx / nuclei back-ends behind the same defineTool signatures for
 * production use. Always confirm written authorization before pointing this
 * at a real host.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/cyber-recon-bot.ts
 *
 * What this demonstrates:
 *   - Multi-tool agent with a tool-call loop (Runner re-enters until end_turn)
 *   - Verifier kernels gating output style (no em-dashes, no AI-isms)
 *   - Receipts: every tool call + the final report is emitted to a sink so
 *     a downstream auditor can replay what the agent did
 */

import {
  Agent,
  Runner,
  defineTool,
  zod as z,
  VerifierKernels,
  ReceiptEmitter,
  InMemoryReceiptSink,
} from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

// --- Tools (mocked so the sample runs offline) ------------------------------

const enumerateSubdomains = defineTool({
  name: "enumerate_subdomains",
  description: "Passive subdomain enumeration (CT logs / wordlist).",
  input: z.object({ host: z.string() }),
  async execute({ host }) {
    return {
      host,
      subdomains: [`api.${host}`, `www.${host}`, `staging.${host}`],
    };
  },
});

const portScan = defineTool({
  name: "port_scan",
  description: "Top-100 TCP port surface for a host.",
  input: z.object({ host: z.string() }),
  async execute({ host }) {
    return { host, open: [80, 443, 22] };
  },
});

const tlsPosture = defineTool({
  name: "tls_posture",
  description: "TLS version + cert issuer + expiry + cipher suite.",
  input: z.object({ host: z.string(), port: z.number().optional() }),
  async execute({ host, port }) {
    return {
      host,
      port: port ?? 443,
      tls_version: "TLS 1.3",
      issuer: "Let's Encrypt R3",
      expires_in_days: 27,
      ciphers_offered: ["TLS_AES_256_GCM_SHA384"],
    };
  },
});

const techFingerprint = defineTool({
  name: "tech_fingerprint",
  description: "Detect web server + framework + CDN from HTTP headers.",
  input: z.object({ host: z.string() }),
  async execute({ host }) {
    return {
      host,
      server: "nginx/1.25.3",
      framework: "Next.js 14",
      cdn: "Cloudflare",
    };
  },
});

// --- Agent ------------------------------------------------------------------

const reconBot = new Agent({
  name: "cyber-recon-bot",
  instruction: `You are a passive reconnaissance agent operating under written authorization.

Workflow:
  1. enumerate_subdomains on the target host
  2. For each discovered subdomain, port_scan + tls_posture + tech_fingerprint
  3. Produce a structured report:
     ## Subdomains
     ## Port surface
     ## TLS posture (flag expiry < 30 days)
     ## Tech stack
     ## Findings worth a deeper look

Rules:
  - Passive only. Never call active exploitation tools.
  - One bullet per finding. No filler. No em-dashes or AI-isms.`,
  tools: [enumerateSubdomains, portScan, tlsPosture, techFingerprint],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
});

// --- Main -------------------------------------------------------------------

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

  const sink = new InMemoryReceiptSink();
  const receipts = new ReceiptEmitter({
    sinks: [sink],
    issuer: "did:web:local",
    actor: reconBot.name,
  });

  // Emit a receipt for every tool call + the final agent output. Downstream
  // auditors can replay what the agent saw and said.
  runner.on(async (event) => {
    if (event.type === "tool_call_done") {
      await receipts.emit({
        cap: `recon.${event.tool}`,
        input: { tool: event.tool },
        output: event.output,
      });
    }
    if (event.type === "agent_output") {
      await receipts.emit({
        cap: "agent.run",
        input: { agent: event.agent },
        output: event.output,
      });
    }
  });

  const result = await runner.run(reconBot, "Recon example.com");
  console.log("\n=== Report ===\n" + result.output);
  console.log(`\n=== Receipts emitted: ${sink.list().length} ===`);
  for (const r of sink.list()) {
    console.log(`  ${r.cap} (${r.content_hash.slice(0, 12)}…)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
