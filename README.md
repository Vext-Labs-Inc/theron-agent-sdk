# Vext SDK

> Build agents that work, with receipts you can verify. Any model. MIT.

[![npm](https://img.shields.io/npm/v/@vextlabs/sdk.svg)](https://www.npmjs.com/package/@vextlabs/sdk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-243%20passing-brightgreen.svg)](#tests)

```sh
npm i @vextlabs/sdk
```

`@vextlabs/sdk` is not yet published; current published package is `@vextlabs/theron-agent-sdk`.

`baseURL` is the OpenAI-style API root. The adapter POSTs to `<baseURL>/chat/completions` after stripping trailing slashes. `https://api.openai.com/v1` posts to `https://api.openai.com/v1/chat/completions`. An Ollama server is `http://127.0.0.1:11434/v1`, which posts to `http://127.0.0.1:11434/v1/chat/completions`. There is no hosted default. Set `baseURL` together with `apiKey`. If you omit `baseURL`, `VEXT_BASE_URL` chooses the host that receives the key (`THERON_BASE_URL` is a deprecated fallback; `VEXT_BASE_URL` wins when both are set). `model` is required. `council_mode` is sent only when you set `councilMode`.

```sh
export VEXT_BASE_URL=https://your-endpoint.example
export VEXT_API_KEY=...
```

```ts
import { Agent, Runner, createVextAdapter } from "@vextlabs/sdk";

const agent = new Agent({ name: "helper", instruction: "Answer helpfully." });
const runner = new Runner({
  model: createVextAdapter({
    baseURL: process.env.VEXT_BASE_URL,
    apiKey: process.env.VEXT_API_KEY,
  }),
  default_model: "your-model",
});
const result = await runner.run(agent, "What's 2+2?");
console.log(result.output);
```

That is a runnable agent in a few lines. Requires Node 20+. `createVextAdapter` POSTs to `<baseURL>/chat/completions`. Pass `baseURL` next to `apiKey` in the example above; otherwise `VEXT_BASE_URL` decides where that key is sent. `theronAdapter` and `import "@vextlabs/sdk/adapters/theron"` still work; they are deprecated aliases of `createVextAdapter` and `@vextlabs/sdk/adapters/vext`.

---

## 15-line Council

```ts
import { Agent, Council, Runner, VerifierKernels } from "@vextlabs/sdk";

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

## Why Vext

| | Vext SDK | Claude Agent SDK | OpenAI Assistants | Vercel AI SDK |
|---|---|---|---|---|
| Multi-specialist deliberation | `Council` primitive with deterministic reconciliation | Sub-agents, you write the deliberation loop | Single assistant, you wire fan-out | Single model, you wire fan-out |
| Output verification before return | Built-in `VerifierKernels` (em-dash, AI-ism, arithmetic, citation) plus `defineVerifier` | Hooks pattern, you implement the checkers | None built-in | None built-in |
| Audit chain on every agent action | `Receipts` primitive: content-hashed, optionally ES256-signed, Merkle-anchorable via Stoa | None built-in | None built-in | None built-in |

Every tool call, Council vote, and output can emit a content-hashed receipt that you sign with your own key and anchor in a daily Merkle root. When someone asks whether an AI produced a result, the receipts are the record you can show them.

The verifier kernels and the receipt chain do not depend on a vendor. Point `createVextAdapter` at an OpenAI-style API root (`<baseURL>/chat/completions`), such as `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`.

## The five primitives

| Primitive | What it is | Why it matters |
|---|---|---|
| `Agent` (composer) | A model + instruction + tools + sub-agents + verifier slugs | The 5-line agent, where most frameworks start |
| `Runner` | The execution loop: LLM call + tool dispatch + verifier sweep + event stream | Pluggable `ModelAdapter` (OpenRouter, Anthropic, OpenAI, your own endpoint) |
| `Verifier` | Deterministic render-then-judge / regex / arithmetic / citation kernels | Fast, free, no second LLM call. Built-ins live in `VerifierKernels` |
| `Receipts` | `ReceiptEmitter` + sinks: Stoa-shaped, content-hashed, optionally signed | Audit trail every external system can verify, no Vext lock-in |
| `Council` | N specialists + verifier kernels + a reconciler | Multi-specialist deliberation as a built-in primitive |

Plus:
- `Session`: append-only event log + scoped state (checkpoint + time-travel debug)
- `Memory`: cross-session, durable knowledge (`InMemoryStore` ships; plug in pgvector / R2 / SQLite for production)
- `Tool`: typed function with auto-injected `ToolContext`; schema-from-Zod
- `MCPClient`: Model Context Protocol over HTTP/SSE; surfaces any MCP server as `Tool[]`

## Why a Council?

Every other agent framework binds to a model name string (`gpt-4o`, `claude-3-5-sonnet`). The Vext SDK binds to a Council of N specialists who deliberate and produce a reconciled answer.

```ts
// Standard agent: one model decides
const out = await runner.run(agent, "Review this PR for security risks");

// Council: three specialists deliberate, verifier kernels check, reconciler synthesizes
const out = await runner.runCouncil(council, "Review this PR for security risks");
// out.consensus === "ratified"  (all three agreed)
// or out.consensus === "split"   (disagreements surfaced; show them to the user)
```

**The Council primitive runs in this process.** Three agents deliberate, verifier kernels check their output, and a reconciler merges the result. To call a remote model, pass `createVextAdapter` a `baseURL` such as `https://api.openai.com/v1`. The adapter POSTs to `<baseURL>/chat/completions`. Set that `baseURL` together with `apiKey`.

## Verifier kernels: fast, deterministic, free

Verifier kernels are NOT another LLM call. They're small typed checkers that run after your agent produces output:

```ts
import { VerifierKernels, defineVerifier } from "@vextlabs/sdk";

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
Each takes plain async functions (`generate` / `score` / `verify` / `critique`),
so they work with any model and compose with the rest of your code.

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
} from "@vextlabs/sdk";

const { answer, consistency } = await selfConsistency({
  samples: 5,
  generate: (i) => model.complete(prompt, { seed: i }),
});
```

See [`examples/reasoning-patterns.ts`](examples/reasoning-patterns.ts) for all
five run end-to-end (offline, no API key).

## How this compares

| | Vext SDK | Hermes-Agent | Claude Agent SDK | Google ADK | LangGraph |
|---|---|---|---|---|---|
| License | **MIT** | MIT | Apache 2.0 | Apache 2.0 | MIT |
| Multi-agent / Council | **Built-in primitive with reconciler** | Sub-agents | Sub-agents | Multi-agent patterns | Supervisor / swarm |
| Verifier kernels | **Built-in typed kernels** | Skill assertions | Hooks pattern | User-implemented | User-implemented |
| Memory + Session | Session (event log) + Memory (cross-session, swappable backend) | Honcho dialectic | Hooks-based | ADK Memory | Checkpointer |
| Tool typing | **Zod schemas, validated I/O** | Function decorators | Pydantic schemas | Pydantic | Pydantic |
| Model calls | **POST `<baseURL>/chat/completions`** | Yes, 200+ via OpenRouter | Claude-optimized | Gemini-optimized | Yes |
| Signed integrations | **Stoa cap protocol (ES256 receipts + Merkle anchor)** | MCP (no integrity) | MCP | MCP | Custom |

This package includes a Council primitive, typed verifier kernels, and signed receipts.

## Receipts: every agent action, signable

The `Receipts` primitive gives every agent action a portable, content-hashed,
optionally signed record. Receipts are shaped to drop straight into a Stoa
sink, but the SDK runs offline with an in-memory sink for tests.

```ts
import {
  ReceiptEmitter, InMemoryReceiptSink, fileReceiptSink, httpReceiptSink,
} from "@vextlabs/sdk";

const receipts = new ReceiptEmitter({
  sinks: [
    new InMemoryReceiptSink(),
    fileReceiptSink("./receipts.jsonl"),
    httpReceiptSink({ url: "https://receipts.example/sink", token: process.env.STOA }),
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
mocked. The pattern and loop examples run fully offline with no key.

| Example | What it shows |
|---|---|
| `cyber-recon-bot.ts` | Multi-tool recon chain (subdomains → ports → TLS → tech). Every tool call emits a receipt. |
| `meeting-prep-bot.ts` | Calendar + docs + memory composition; produces a one-page meeting brief. |
| `support-triage-bot.ts` | Three-specialist Council (classifier + retriever + writer); routing decision emitted as a signable receipt. |
| `reasoning-patterns.ts` | All five reasoning patterns end-to-end (self-consistency, best-of-N, self-refine, tree-of-thoughts, chain-of-verification). **No key, fully offline.** |
| `loop-primitives.ts` | Verified ratchet, `runImprovementCycle`, and verifier-in-the-loop stop predicates. **No key, fully offline.** |

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
- A pre-built agent fleet. There are 3 sample agents in `examples/` to show you how to build, then you build your own
- A hosted runtime. Run it on your own infra. Node 20+ tested; other runtimes untested

This package does not host a model endpoint. Pass `baseURL` (the OpenAI-style API root; `/chat/completions` is appended to its path, and a `?query` such as `?api-version=` is kept) together with `apiKey`. The adapter sends `max_tokens` and `temperature` only when you pass them to `chat`; otherwise the server's defaults apply.

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

The suite has 243 tests (Vitest).

## More from Vext Labs

The SDK is one corner of a larger surface. The full picture lives on the Vext Labs organization page: [github.com/Vext-Labs-Inc](https://github.com/Vext-Labs-Inc). Company site: [vextlabs.ai](https://vextlabs.ai).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). We're particularly interested in:
- Model adapters (Anthropic Claude direct, AWS Bedrock, etc.)
- Verifier kernels for specific domains (SQL syntax check, K8s YAML lint, etc.)
- Memory backends (pgvector, sqlite-vec, R2)
- Persistence adapters for `Session` (Postgres, Redis, KV)

## License

MIT. See [LICENSE](LICENSE).

Built by [Vext Labs, Inc.](https://vextlabs.ai) (Maryland). Founder: Annalea Layton.
