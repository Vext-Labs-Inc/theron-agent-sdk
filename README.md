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

## What the SDK provides

| Capability | How it works in this SDK |
|---|---|
| Multi-specialist deliberation | `Council` runs N specialist agents, checks their outputs with verifier kernels, and combines them with a reconciler |
| Output verification | Built-in `VerifierKernels` (em-dash, AI-ism, arithmetic, citation) plus `defineVerifier` for your own checks |
| Action records | `Receipts`: content-hashed records of agent actions, with an optional detached signature from a `ReceiptSigner` you supply |
| Typed tools | Tools declare Zod input schemas |
| Model choice | Any provider, through a `ModelAdapter` |

Receipts are emitted by your code, for example from a `runner.on` handler on tool calls. Each receipt has a deterministic content hash, and you can sign it with your own key.

The verifier kernels and receipts do not depend on the model provider. They work the same with any `ModelAdapter`.

## The five primitives

| Primitive | What it is | Why it matters |
|---|---|---|
| `Agent` (composer) | A model + instruction + tools + sub-agents + verifier slugs | A basic agent takes about 5 lines |
| `Runner` | The execution loop: LLM call + tool dispatch + verifier sweep + event stream | Pluggable `ModelAdapter` (OpenRouter, Anthropic, OpenAI, your own endpoint) |
| `Verifier` | Deterministic render-then-judge / regex / arithmetic / citation kernels | Fast, free, no second LLM call. Built-ins in `VerifierKernels` |
| `Receipts` | `ReceiptEmitter` + sinks. Content-hashed, optionally signed | A record of agent actions that you store and sign with your own sinks and keys |
| `Council` | N specialists + verifier kernels + a reconciler | Multi-specialist deliberation primitive |

Plus:
- `Session`: append-only event log + scoped state (checkpoint + time-travel debug)
- `Memory`: cross-session, durable knowledge (`InMemoryStore` ships; plug in pgvector / R2 / SQLite for production)
- `Tool`: typed function with auto-injected `ToolContext`; schema-from-Zod
- `MCPClient`: Model Context Protocol over HTTP/SSE; surfaces any MCP server as `Tool[]`

## Why a Council?

`runner.run` sends a task to one agent. `runner.runCouncil` sends it to a Council of N specialists, whose outputs are checked and reconciled into one answer.

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

## Receipts: every agent action, signable

The `Receipts` primitive gives an agent action a portable, content-hashed,
optionally signed record. Sinks write receipts to memory, a JSONL file, or an
HTTP endpoint you provide. The in-memory sink works offline, for tests.

```ts
import {
  ReceiptEmitter, InMemoryReceiptSink, fileReceiptSink, httpReceiptSink,
} from "@vextlabs/theron-agent-sdk";

const receipts = new ReceiptEmitter({
  sinks: [
    new InMemoryReceiptSink(),
    fileReceiptSink("./receipts.jsonl"),
    // placeholder URL, replace with your sink
    httpReceiptSink({ url: "https://example.com/receipt-sink", token: process.env.RECEIPT_SINK_TOKEN }),
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
