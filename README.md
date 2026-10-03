# Theron Agent SDK

> Build agents that work, with receipts you can verify. Any model. MIT.

[![npm](https://img.shields.io/npm/v/@vextlabs/theron-agent-sdk.svg)](https://www.npmjs.com/package/@vextlabs/theron-agent-sdk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-220%20passing-brightgreen.svg)](#tests)

```sh
npm install @vextlabs/theron-agent-sdk
```

```ts
import { Agent, Runner, theronAdapter } from "@vextlabs/theron-agent-sdk";

const agent = new Agent({ name: "helper", instruction: "Answer helpfully." });

// Requests go to <baseURL>/api/v1/chat/completions and include a council_mode field.
const runner = new Runner({
  model: theronAdapter({
    baseURL: "https://your-endpoint.example",
    apiKey: process.env.THERON_API_KEY,
  }),
  default_model: "your-model",
});
const result = await runner.run(agent, "What's 2+2?");
console.log(result.output);
```

```ts
// THERON_BASE_URL is used when baseURL and base are both omitted.
// An apiKey with no baseURL is sent to the host in THERON_BASE_URL.
const fromEnv = new Runner({
  model: theronAdapter({ apiKey: process.env.THERON_API_KEY }),
  default_model: "your-model",
});
```

There is no hosted default. Requires Node 20+. Swap in Anthropic, OpenAI, or your own endpoint by writing a `ModelAdapter`.

The ESM and CJS builds each export their own `MissingBaseURLError` class, so `instanceof` only matches the build you imported. If both builds can load in one process, check `err.name === "MissingBaseURLError"` instead.

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

## Why Theron Agent SDK

| | Theron Agent SDK | Claude Agent SDK | OpenAI Assistants | Vercel AI SDK |
|---|---|---|---|---|
| Multi-specialist deliberation | `Council` primitive with deterministic reconciliation | Sub-agents, you write the deliberation loop | Single assistant, you wire fan-out | Single model, you wire fan-out |
| Output verification before return | Built-in `VerifierKernels` (em-dash, AI-ism, arithmetic, citation) plus `defineVerifier` | Hooks pattern, you implement the checkers | None built-in | None built-in |
| Audit chain on every agent action | `Receipts` primitive: content-hashed, optionally ES256-signed, Merkle-anchorable via Stoa | None built-in | None built-in | None built-in |

The receipt chain is the differentiator. Every tool call, every Council vote, every output emits a content-hashed receipt you can sign with your own key and anchor in a daily Merkle root. When someone asks "did an AI do this," you hand them a document, not a vibe.

The SDK is model-agnostic. The verifier kernels and the receipt chain work the same whether you point at OpenRouter, Anthropic, OpenAI, or a local Ollama.

## The five primitives

| Primitive | What it is | Why it matters |
|---|---|---|
| `Agent` (composer) | A model + instruction + tools + sub-agents + verifier slugs | The 5-line agent. Every other framework starts here |
| `Runner` | The execution loop: LLM call + tool dispatch + verifier sweep + event stream | Pluggable `ModelAdapter` (OpenRouter, Anthropic, OpenAI, your own endpoint) |
| `Verifier` | Deterministic render-then-judge / regex / arithmetic / citation kernels | Fast, free, no second LLM call. Built-ins in `VerifierKernels` |
| `Receipts` | `ReceiptEmitter` + sinks. Stoa-shaped, content-hashed, optionally signed | Audit trail every external system can verify, no Vext lock-in |
| `Council` | N specialists + verifier kernels + a reconciler | Multi-specialist deliberation primitive |

Plus:
- `Session`: append-only event log + scoped state (checkpoint + time-travel debug)
- `Memory`: cross-session, durable knowledge (`InMemoryStore` ships; plug in pgvector / R2 / SQLite for production)
- `Tool`: typed function with auto-injected `ToolContext`; schema-from-Zod
- `MCPClient`: Model Context Protocol over HTTP/SSE; surfaces any MCP server as `Tool[]`

## Why a Council?

Every other agent framework binds to a model name string (`gpt-4o`, `claude-3-5-sonnet`). Theron Agent SDK binds to a Council of N specialists who deliberate and produce a reconciled answer.

```ts
// Standard agent: one model decides
const out = await runner.run(agent, "Review this PR for security risks");

// Council: three specialists deliberate, verifier kernels check, reconciler synthesizes
const out = await runner.runCouncil(council, "Review this PR for security risks");
// out.consensus === "ratified"  // all three agreed
// or out.consensus === "split"   // disagreements surfaced (don't hide them; show them to the user)
```

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

## Reasoning patterns & loop primitives

Framework- and provider-agnostic primitives for verifier/score-gated reasoning.
Each takes plain async functions (`generate` / `score` / `verify` / `critique`), so they work on any
model and compose anywhere.

```ts
import {
  selfConsistency,    // sample N paths → majority answer + agreement ratio
  bestOfN,            // verifier-guided best-of-N
  selfRefine,         // draft → critique → revise (early-exit when clean)
  treeOfThoughts,     // best-first branch / score / expand search
  chainOfVerification,// draft → verify claims independently → revise
  mixtureOfAgents,    // layered multi-agent propose → refine → aggregate
  reflexion,          // retry with accumulated verbal reflections (verbal RL)
  measureLift,        // measure a pattern's score-lift vs single-shot baseline
  verifiedRatchet,    // advance loop state ONLY on a confident verifier pass
  stepCountIs, verifierSatisfied, anyOf, allOf, // verifier-in-the-loop stop predicates
  runImprovementCycle,
  compactHistory,     // summarize-and-continue: run far past the context window
  runUntil,           // bounded, checkpointable long-horizon driver (run soo long)
} from "@vextlabs/theron-agent-sdk";

const { answer, consistency } = await selfConsistency({
  samples: 5,
  generate: (i) => model.complete(prompt, { seed: i }),
});
```

See [`examples/reasoning-patterns.ts`](examples/reasoning-patterns.ts) for all
seven patterns plus `measureLift` run end-to-end (offline, no API key).

## How this compares

| | Theron Agent SDK | Hermes-Agent | Claude Agent SDK | Google ADK | LangGraph |
|---|---|---|---|---|---|
| License | **MIT** | MIT | Apache 2.0 | Apache 2.0 | MIT |
| Multi-agent / Council | **Council primitive with a reconciler** | Sub-agents | Sub-agents | Multi-agent patterns | Supervisor / swarm |
| Verifier kernels | **Typed verifier kernels** | Skill assertions | Hooks pattern | User-implemented | User-implemented |
| Memory + Session | Session (event log) + Memory (cross-session, swappable backend) | Honcho dialectic | Hooks-based | ADK Memory | Checkpointer |
| Tool typing | **Zod schemas, validated I/O** | Function decorators | Pydantic schemas | Pydantic | Pydantic |
| Model-agnostic | Requests go to `<baseURL>/api/v1/chat/completions` and include a `council_mode` field | Yes, 200+ via OpenRouter | Claude-optimized | Gemini-optimized | Yes |
| Signed integrations | **Stoa cap protocol (ES256 receipts + Merkle anchor)** | MCP (no integrity) | MCP | MCP | Custom |

We're not trying to beat Hermes-Agent on community size or Claude Agent SDK on Claude-specific polish.

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
    // placeholder URL, replace with your sink
    httpReceiptSink({ url: "https://example.com/receipt-sink", token: process.env.STOA }),
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

## Runnable examples

The SDK ships with runnable examples in `examples/`. The agent examples call
openrouter.ai and need `OPENROUTER_API_KEY` plus network access; their tools are
mocked. `basic-agent.ts` instead posts to `<THERON_BASE_URL>/api/theron-chat-phased`
on an endpoint you provide. The pattern and loop examples run fully offline with
no key.

Examples ship as `.ts` only. They are not package exports: importing
`@vextlabs/theron-agent-sdk/examples/adapters/openrouter.js` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Run them from this repo with a relative import
such as `./adapters/openrouter.js` (tsx resolves the `.ts` file).

| Example | What it shows |
|---|---|
| `cyber-recon-bot.ts` | Multi-tool recon chain (subdomains → ports → TLS → tech). Every tool call emits a receipt. |
| `meeting-prep-bot.ts` | Calendar + docs + memory composition; produces a one-page meeting brief. |
| `support-triage-bot.ts` | Three-specialist Council (classifier + retriever + writer); routing decision emitted as a signable receipt. |
| `reasoning-patterns.ts` | All seven reasoning patterns end-to-end (self-consistency, best-of-N, self-refine, tree-of-thoughts, chain-of-verification, mixture-of-agents, reflexion), plus `measureLift`. **No key. Fully offline.** |
| `loop-primitives.ts` | Verified ratchet, `runImprovementCycle`, and verifier-in-the-loop stop predicates. **No key. Fully offline.** |

```sh
OPENROUTER_API_KEY=sk-or-... npm run example:cyber
OPENROUTER_API_KEY=sk-or-... npm run example:meeting
OPENROUTER_API_KEY=sk-or-... npm run example:support
# offline, no key needed:
npx tsx examples/reasoning-patterns.ts
npx tsx examples/loop-primitives.ts
```

## What this SDK is NOT

This package is the framework. It is intentionally NOT:

- A pre-trained model. Bring your own (OpenRouter / OpenAI / Anthropic / your own OSS base)
- A pre-built agent fleet. There are 11 runnable examples in `examples/`, 9 of them sample agents, to show you how to build, then you build your own
- A hosted runtime. Run it on your own infra (Node, Bun, Deno, serverless, container)

## Documentation

- [README](https://github.com/Vext-Labs-Inc/theron-agent-sdk#readme)
- [Changelog and migration notes](CHANGELOG.md)
- [Security policy](SECURITY.md)
- API reference: run `npm run docs` to generate it locally with TypeDoc.

## Tests

```sh
npm ci
npm test
```

The suite has 220 tests (Vitest).

## More from Vext Labs

The SDK is one corner of a larger surface. The full picture lives on the Vext Labs organization page: [github.com/Vext-Labs-Inc](https://github.com/Vext-Labs-Inc).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). We're particularly interested in:
- Model adapters (Anthropic Claude direct, AWS Bedrock, etc.)
- Verifier kernels for specific domains (SQL syntax check, K8s YAML lint, etc.)
- Memory backends (pgvector, sqlite-vec, R2)
- Persistence adapters for `Session` (Postgres, Redis, KV)

## License

MIT. See [LICENSE](LICENSE).

Built by [Vext Labs, Inc.](https://tryvext.com) (Maryland). Founder: Annalea Layton.
