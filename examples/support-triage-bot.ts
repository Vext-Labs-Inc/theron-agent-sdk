/**
 * Sample agent: support-triage-bot
 *
 * Triages an inbound support ticket: classifies it (bug / feature-request /
 * billing / how-to), pulls related past tickets, decides routing (engineering
 * queue / billing queue / docs queue), and writes a one-paragraph reply
 * draft. Demonstrates a Council pattern — three specialists (classifier,
 * retriever, writer) deliberate to produce the final routing decision.
 *
 * Ships with mock ticket + KB stores so it runs offline.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/support-triage-bot.ts
 *
 * What this demonstrates:
 *   - Council primitive used for routing (not just deliberation)
 *   - Verifier kernels enforcing the response style
 *   - Receipts: the routing decision is signed so a downstream router can
 *     prove an agent (not a human) made the call
 */

import {
  Agent,
  Council,
  Runner,
  defineTool,
  zod as z,
  VerifierKernels,
  ReceiptEmitter,
  InMemoryReceiptSink,
} from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

// --- Tools (ticket + KB) ----------------------------------------------------

const fetchTicket = defineTool({
  name: "fetch_ticket",
  description: "Fetch a support ticket by id.",
  input: z.object({ ticket_id: z.string() }),
  async execute({ ticket_id }) {
    return {
      ticket_id,
      subject: "Login redirects to /404 after upgrade",
      body:
        "Upgraded to v0.4.2 last night. Login works, but the post-login " +
        "redirect lands on /404. Worked fine on v0.4.1. Three of my " +
        "teammates hit it too.",
      reporter: "u_8821",
      plan: "team",
    };
  },
});

const similarTickets = defineTool({
  name: "similar_tickets",
  description: "Find past tickets with similar symptoms.",
  input: z.object({ query: z.string() }),
  async execute({ query }) {
    return {
      query,
      hits: [
        {
          id: "t_771",
          subject: "Redirect breaks after v0.4 upgrade",
          status: "resolved",
          resolution: "Fix shipped in v0.4.3; ask user to upgrade.",
        },
      ],
    };
  },
});

const kbLookup = defineTool({
  name: "kb_lookup",
  description: "Search the support knowledge base.",
  input: z.object({ topic: z.string() }),
  async execute({ topic }) {
    return {
      topic,
      articles: [
        {
          title: "Login redirect troubleshooting",
          url: "https://docs.example.com/kb/login-redirect",
        },
      ],
    };
  },
});

// --- Specialists ------------------------------------------------------------

const classifier = new Agent({
  name: "classifier",
  instruction: `You classify a support ticket into one of: bug, feature-request, billing, how-to.
Output a single JSON object: {"class": "...", "confidence": 0-1, "rationale": "..."}.
Do not use em-dashes or AI-isms.`,
  tools: [fetchTicket],
});

const retriever = new Agent({
  name: "retriever",
  instruction: `You find prior context for a support ticket. Call similar_tickets and kb_lookup.
Output a single JSON object: {"similar_ticket_ids": [...], "kb_urls": [...], "notes": "..."}.
Do not use em-dashes or AI-isms.`,
  tools: [fetchTicket, similarTickets, kbLookup],
});

const writer = new Agent({
  name: "writer",
  instruction: `You write a one-paragraph reply draft for the ticket reporter.
Be direct. Lead with what they should do. End with what we will do.
Do not use em-dashes or AI-isms. Length: 60-100 words.`,
  tools: [fetchTicket],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
});

const triageCouncil = new Council({
  name: "support-triage",
  specialists: [classifier, retriever, writer],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm],
  specialist_timeout_ms: 25_000,
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
    actor: triageCouncil.name,
  });

  runner.on(async (event) => {
    if (event.type === "council_done") {
      // The routing decision is the headline event — sign it so the queue
      // router downstream can prove an agent made the call.
      await receipts.emit({
        cap: "support.triage.route",
        input: { council: event.council },
        output: {
          answer: event.output.answer,
          consensus: event.output.consensus,
          specialists: event.output.specialists.map((s) => s.specialist),
        },
        metadata: {
          total_cost_usd: event.output.total_cost_usd,
          total_latency_ms: event.output.total_latency_ms,
        },
      });
    }
  });

  const out = await runner.runCouncil(
    triageCouncil,
    "Triage ticket t_902 and produce a routing decision + reply draft.",
  );

  console.log("\n=== Consensus ===", out.consensus);
  console.log("\n=== Answer ===\n" + out.answer);
  console.log(`\n=== Receipts: ${sink.list().length} ===`);
  for (const r of sink.list()) {
    console.log(`  ${r.cap} → ${r.content_hash.slice(0, 12)}…`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
