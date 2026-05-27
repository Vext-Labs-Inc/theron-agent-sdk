/**
 * Sample agent: meeting-prep-bot
 *
 * Generates a one-page prep brief for an upcoming meeting from a calendar
 * event + linked docs. Demonstrates how to wire Memory (prior notes about
 * the attendees) into an agent loop.
 *
 * Ships with mock calendar + docs tools so it runs offline. Swap in a real
 * Google Calendar / Outlook adapter and a real docs source for production.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/meeting-prep-bot.ts
 *
 * What this demonstrates:
 *   - Tool composition (calendar.list_events + docs.fetch + memory.lookup)
 *   - Memory primitive: prior knowledge of attendees informs the brief
 *   - Receipts: every external read carries a cap that names the surface
 */

import {
  Agent,
  Runner,
  defineTool,
  zod as z,
  VerifierKernels,
  InMemoryStore,
  ReceiptEmitter,
  InMemoryReceiptSink,
} from "../src/index.js";
import { openrouterAdapter } from "./adapters/openrouter.js";

// --- Memory (seeded with prior context about an attendee) ------------------

const memory = new InMemoryStore();
await memory.set({
  key: "person:dana",
  value:
    "Dana runs platform infra. Cares about p99 latency, hates flaky tests, " +
    "previously asked for a SLO dashboard in our last 1:1.",
  tags: ["person", "platform"],
  created_at: Date.now(),
  last_accessed_at: Date.now(),
});

// --- Tools ------------------------------------------------------------------

const listEvents = defineTool({
  name: "calendar_list_events",
  description: "List upcoming calendar events for the next N hours.",
  input: z.object({ hours_ahead: z.number() }),
  async execute({ hours_ahead }) {
    return {
      events: [
        {
          id: "evt_001",
          title: "Q3 planning sync",
          start: new Date(Date.now() + 3_600_000).toISOString(),
          end: new Date(Date.now() + 5_400_000).toISOString(),
          attendees: ["dana@example.com", "anna@example.com"],
          linked_docs: ["doc_42"],
          horizon_hours: hours_ahead,
        },
      ],
    };
  },
});

const fetchDoc = defineTool({
  name: "docs_fetch",
  description: "Fetch the body text of a linked doc.",
  input: z.object({ doc_id: z.string() }),
  async execute({ doc_id }) {
    return {
      doc_id,
      title: "Q3 platform roadmap (draft)",
      body:
        "Three bets: (a) SLO dashboards, (b) flake-detection in CI, " +
        "(c) cost-per-tenant reporting. Open question: do we own (c) or " +
        "punt to finance.",
    };
  },
});

const recallPerson = defineTool({
  name: "memory_recall_person",
  description: "Look up prior notes about a person by email or handle.",
  input: z.object({ handle: z.string() }),
  async execute({ handle }) {
    const key = `person:${handle.split("@")[0]}`;
    const hits = await memory.query({ key });
    return { handle, notes: hits.map((h) => h.value) };
  },
});

// --- Agent ------------------------------------------------------------------

const prepBot = new Agent({
  name: "meeting-prep-bot",
  instruction: `You write a one-page prep brief for an upcoming meeting.

Workflow:
  1. calendar_list_events for the next 4 hours
  2. For each event, docs_fetch every linked doc
  3. For each attendee, memory_recall_person
  4. Produce a brief:
     ## Meeting
     ## Attendees (one line each: role + recent context from memory)
     ## Docs (3-bullet TLDR per doc)
     ## Questions to raise (3 max, prioritized)
     ## Decisions to push for (1-3)

Rules:
  - One page max.
  - No filler. No em-dashes or AI-isms.`,
  tools: [listEvents, fetchDoc, recallPerson],
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
    actor: prepBot.name,
  });

  runner.on(async (event) => {
    if (event.type === "tool_call_done") {
      // Cap names are reverse-DNS-ish so receipts cluster cleanly per surface.
      const cap =
        event.tool === "calendar_list_events"
          ? "vext.calendar.list_events"
          : event.tool === "docs_fetch"
            ? "vext.docs.fetch"
            : "vext.memory.recall";
      await receipts.emit({
        cap,
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

  const result = await runner.run(prepBot, "Prep me for everything in the next 4 hours.");
  console.log("\n=== Brief ===\n" + result.output);
  console.log(`\n=== Receipts: ${sink.list().length} ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
