# Theron Agent SDK

> Build agents that work, with receipts you can verify. Any model. MIT.

[![npm](https://img.shields.io/npm/v/@vextlabs/theron-agent-sdk.svg)](https://www.npmjs.com/package/@vextlabs/theron-agent-sdk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-64%20passing-brightgreen.svg)](#tests)

```sh
npm install @vextlabs/theron-agent-sdk
```

```ts
import { Agent, Runner } from "@vextlabs/theron-agent-sdk";
import { openrouterAdapter } from "@vextlabs/theron-agent-sdk/examples/adapters/openrouter.js";

const agent = new Agent({ name: "helper", instruction: "Answer helpfully." });
const runner = new Runner({ model: openrouterAdapter({ apiKey: process.env.OPENROUTER_API_KEY! }), default_model: "openai/gpt-4o-mini" });
const result = await runner.run(agent, "What's 2+2?");
console.log(result.output);
```

That is a runnable agent in five lines. Requires Node 20+. An `OPENROUTER_API_KEY` gets you 200+ models through one adapter; swap in Anthropic, OpenAI, or your own OSS endpoint by writing a 30-line `ModelAdapter`.

---

## 15-line Council

```ts
import { Agent, Council, Runner, VerifierKernels } from "@vextlabs/theron-agent-sdk";

const engineer = new Agent({ name: "engineer", instruction: "Answer from a backend reliability perspective." });
const security = new Agent({ name: "security", instruction: "Answer from a threat-model perspective." });
const product  = new Agent({ name: "product",  instruction: "Answer from a user-impact perspective." });

const council = new Council({
  name: "engineering-review",
  specialists: [engineer, security, product],
  verifiers: [VerifierKernels.emDash, VerifierKernels.aiIsm, VerifierKernels.citationPresence],
});

const result = await runner.runCouncil(council, "Should we store API keys in localStorage?");
console.log(result.answer);             // synthesized answer
console.log(result.consensus);          // "ratified" | "split" | "refuted"
console.log(result.disagreements);      // surfaced if specialists disagreed
```

## Why Theron

| | Theron Agent SDK | Claude Agent SDK | OpenAI Assistants | Vercel AI SDK |
|---|---|---|---|---|
| Multi-specialist deliberation | First-class `Council` primitive with deterministic reconciliation | Sub-agents, you write the deliberation loop | Single assistant, you wire fan-out | Single model, you wire fan-out |
| Output verification before return | Built-in `VerifierKernels` (em-dash, AI-ism, arithmetic, citation) plus `defineVerifier` | Hooks pattern, you implement the checkers | None built-in | None built-in |
| Audit chain on every agent action | `Receipts` primitive: content-hashed, optionally ES256-signed, Merkle-anchorable via Stoa | None built-in | None built-in | None built-in |

The receipt chain is the differentiator. Every tool call, every Council vote, every output emits a content-hashed receipt you can sign with your own key and anchor in a daily Merkle root. When someone asks "did an AI do this," you hand them a document, not a vibe.

The SDK is model-agnostic. The verifier kernels and the receipt chain work the same whether you point at OpenRouter, Anthropic, OpenAI, a local Ollama, or the hosted Theron substrate.

## The five primitives

| Primitive | What it is | Why it matters |
|---|---|---|
| `Agent` (composer) | A model + instruction + tools + sub-agents + verifier slugs | The 5-line agent — every other framework starts here |
| `Runner` | The execution loop — LLM call + tool dispatch + verifier sweep + event stream | Pluggable `ModelAdapter` (OpenRouter, Anthropic, OpenAI, your own endpoint) |
| `Verifier` | Deterministic render-then-judge / regex / arithmetic / citation kernels | Fast, free, no second LLM call — built-ins in `VerifierKernels` |
| `Receipts` | `ReceiptEmitter` + sinks — Stoa-shaped, content-hashed, optionally signed | Audit trail every external system can verify, no Vext lock-in |
| `Council` | N specialists + verifier kernels + a reconciler | Multi-specialist deliberation as a first-class primitive |

Plus:
- `Session` — append-only event log + scoped state (checkpoint + time-travel debug)
- `Memory` — cross-session, durable knowledge (`InMemoryStore` ships; plug in pgvector / R2 / SQLite for production)
- `Tool` — typed function with auto-injected `ToolContext`; schema-from-Zod
- `MCPClient` — Model Context Protocol over HTTP/SSE; surfaces any MCP server as `Tool[]`

## Why a Council?

Every other agent framework binds to a model name string (`gpt-4o`, `claude-3-5-sonnet`). Theron Agent SDK binds to a Council of N specialists who deliberate and produce a reconciled answer.

```ts
// Standard agent — one model decides
const out = await runner.run(agent, "Review this PR for security risks");

// Council — three specialists deliberate, verifier kernels check, reconciler synthesizes
const out = await runner.runCouncil(council, "Review this PR for security risks");
// out.consensus === "ratified"  — all three agreed
// or out.consensus === "split"   — disagreements surfaced (don't hide them — show them to the user)
```

**The Council primitive doesn't require Vext's managed substrate.** You can run a Council of three generic OpenRouter agents and the SDK handles the deliberation + verifier dispatch + reconciliation locally.

When you upgrade to Vext-managed Theron, the same Council code points at our 15 trained Layer-1 LoRA specialists — same SDK surface, dramatically better per-domain output.

## Verifier kernels: fast, deterministic, free

Verifier kernels are NOT another LLM call. They're small typed checkers that run after your agent produces output:

```ts
import { VerifierKernels, defineVerifier } from "@vextlabs/theron-agent-sdk";

// Built-in kernels
VerifierKernels.emDash         // block em-dashes (AI tell)
VerifierKernels.aiIsm          // block "delve", "tapestry", "leverage", etc.
VerifierKernels.arithmetic     // re-evaluate "X op Y = Z" claims
VerifierKernels.citationPresence  // require at least one citation

// Roll your own
const noProfanity = defineVerifier({
  name: "no_profanity",
  description: "Block profanity in customer-facing output.",
  check: async (output) => {
    const bad = ["badword1", "badword2"];
    const issues = bad
      .filter((w) => output.toLowerCase().includes(w))
      .map((w) => ({ kernel: "no_profanity", severity: "error" as const, message: `profanity: ${w}` }));
    return { pass: issues.length === 0, issues };
  },
});
```

Every kernel runs in milliseconds. Pure regex / arithmetic / hash-equal. **No additional LLM cost.**

## How this compares

| | Theron Agent SDK | Hermes-Agent | Claude Agent SDK | Google ADK | LangGraph |
|---|---|---|---|---|---|
| License | **MIT** | MIT | Apache 2.0 | Apache 2.0 | MIT |
| Multi-agent / Council | **First-class primitive with reconciler** | Sub-agents | Sub-agents | Multi-agent patterns | Supervisor / swarm |
| Verifier kernels | **First-class typed kernels** | Skill assertions | Hooks pattern | User-implemented | User-implemented |
| Memory + Session | Session (event log) + Memory (cross-session, swappable backend) | Honcho dialectic | Hooks-based | ADK Memory | Checkpointer |
| Tool typing | **Zod schemas, validated I/O** | Function decorators | Pydantic schemas | Pydantic | Pydantic |
| Model-agnostic | **Yes — any OpenAI-compatible endpoint** | Yes — 200+ via OpenRouter | Claude-optimized | Gemini-optimized | Yes |
| Signed integrations | **Stoa cap protocol (ES256 receipts + Merkle anchor)** | MCP (no integrity) | MCP | MCP | Custom |
| Managed substrate path | [Vext Theron — 15-specialist Council + per-tenant LoRA tuning](https://theron.tryvext.com) | Nous Portal | Anthropic API | Vertex AI | LangGraph Cloud |

We're not trying to beat Hermes-Agent on community size or Claude Agent SDK on Claude-specific polish. We're shipping the three primitives nobody else ships first-class: **Council + Verifier kernels + Signed integrations.** Plus the optional managed substrate where you get our trained specialists.

## Receipts: every agent action, signable

The `Receipts` primitive gives every agent action a portable, content-hashed,
optionally signed record. Receipts are shaped to drop straight into a Stoa
sink, but the SDK runs offline with an in-memory sink for tests.

```ts
import {
  ReceiptEmitter, InMemoryReceiptSink, fileReceiptSink, httpReceiptSink,
} from "@vextlabs/theron-agent-sdk";

const receipts = new ReceiptEmitter({
  sinks: [
    new InMemoryReceiptSink(),
    fileReceiptSink("./receipts.jsonl"),
    httpReceiptSink({ url: "https://stoa.tryvext.com/sink", token: process.env.STOA }),
  ],
  issuer: "did:web:acme.com",
  actor: "support-triage-bot",
});

runner.on(async (event) => {
  if (event.type === "tool_call_done") {
    await receipts.emit({
      cap: `vext.${event.tool}`,
      input: { tool: event.tool },
      output: event.output,
    });
  }
});
```

Every receipt has a deterministic `content_hash` (sorted-key SHA-256). Provide
a `ReceiptSigner` to attach an ES256 / Ed25519 / HMAC detached signature.

## Three sample agents

The SDK ships with three runnable sample agents in `examples/`. None require
external network credentials — every tool is mocked so the agents run offline
against any OpenRouter-compatible model.

| Example | What it shows |
|---|---|
| `cyber-recon-bot.ts` | Multi-tool recon chain (subdomains → ports → TLS → tech). Every tool call emits a receipt. |
| `meeting-prep-bot.ts` | Calendar + docs + memory composition; produces a one-page meeting brief. |
| `support-triage-bot.ts` | Three-specialist Council (classifier + retriever + writer); routing decision emitted as a signable receipt. |

```sh
OPENROUTER_API_KEY=sk-or-... npm run example:cyber
OPENROUTER_API_KEY=sk-or-... npm run example:meeting
OPENROUTER_API_KEY=sk-or-... npm run example:support
```

## What this SDK is NOT

This package is the framework. It is intentionally NOT:

- A pre-trained model — bring your own (OpenRouter / OpenAI / Anthropic / your own OSS base)
- A pre-built agent fleet — there are 3 sample agents in `examples/` to show you how to build, then you build your own
- A hosted runtime — run it on your own infra (Node, Bun, Deno, serverless, container)

If you want the trained 15-specialist Council, the 450+ curated industry-pack worker agents, the auto-improving Meta agents, or per-tenant overnight LoRA tuning — that's [Vext's managed Theron](https://theron.tryvext.com). The SDK is free; the substrate is the product.

## Documentation

- [Docs site](https://tryvext.com/adk)
- [Architecture](./docs/architecture.md)
- [API reference](./docs/api.md)
- [Migration guide (from LangChain / CrewAI / AutoGen)](./docs/migration.md)
- [Stoa cap protocol](https://github.com/Vext-Labs-Inc/stoa)

## More from Vext Labs

The SDK is one corner of a larger surface. The full picture lives on the Vext Labs organization page: [github.com/Vext-Labs-Inc](https://github.com/Vext-Labs-Inc). Theron the product is at [theron.tryvext.com](https://theron.tryvext.com).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). We're particularly interested in:
- Model adapters (Anthropic Claude direct, AWS Bedrock, etc.)
- Verifier kernels for specific domains (SQL syntax check, K8s YAML lint, etc.)
- Memory backends (pgvector, sqlite-vec, R2)
- Persistence adapters for `Session` (Postgres, Redis, KV)

## License

MIT — see [LICENSE](LICENSE).

Built by [Vext Labs, Inc.](https://tryvext.com) (Maryland). Founder: Annalea Layton.

---

*The framework is yours forever. The moat is the substrate underneath.*
