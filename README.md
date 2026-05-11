# Theron Agent SDK

> Build agents with a council, verifier kernels, and signed integrations. **Any model. MIT.**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/Vext-Labs-Inc/theron-agent-sdk/releases)

Theron Agent SDK is the open-source agent development kit from [Vext Labs](https://tryvext.com). It ships the three primitives every other framework expects you to build yourself:

- **Council** — multi-specialist deliberation as a first-class primitive, with deterministic reconciliation (no LLM-judge required)
- **Verifier kernels** — typed, fast, deterministic output checkers (regex / arithmetic / citation / domain-specific) that run before output leaves the graph
- **Stoa-signed integrations** — every SaaS call carries an ES256-signed receipt and a daily Merkle anchor, so your agents have an audit trail that holds up under regulated scrutiny

Build any agent against any model. The SDK is free forever.

To run agents on Vext's managed 15-specialist Council with per-tenant LoRA tuning that improves overnight on your data → sign up at [theron.tryvext.com](https://theron.tryvext.com).

---

## Install

```sh
# Install directly from GitHub (alpha — current install path)
npm install github:Vext-Labs-Inc/theron-agent-sdk
```

```sh
# Coming with v0.2 (stable API):
# npm install @vextlabs/theron-agent-sdk
```

Requires Node 20+.

> The alpha installs from GitHub directly so we can iterate on the API without semver churn on npm. We'll publish to npm at v0.2 once the surface stabilizes.

## 5-line agent

```ts
import { Agent, Runner } from "@vextlabs/theron-agent-sdk";
// During alpha, the OpenRouter adapter is shipped in examples/. Copy it into
// your project, or use any OpenAI-compatible adapter you already have.
import { openrouterAdapter } from "./adapters/openrouter.js";

const agent = new Agent({ name: "helper", instruction: "Answer helpfully." });
const runner = new Runner({
  model: openrouterAdapter({ apiKey: process.env.OPENROUTER_API_KEY! }),
  default_model: "openai/gpt-4o-mini",
});
const result = await runner.run(agent, "What's 2+2?");
console.log(result.output);
```

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

## The five primitives

| Primitive | What it is | Why it matters |
|---|---|---|
| `Agent` | A model + instruction + tools + sub-agents + verifier slugs | The 5-line agent — every other framework starts here |
| `Council` | N specialists + verifier kernels + a reconciler | Multi-specialist deliberation as a first-class primitive (the Hive differentiator) |
| `Session` | Append-only event log + scoped state | Checkpoint + time-travel debug |
| `Memory` | Cross-session, durable knowledge with semantic search | Plug in any backend (pgvector, R2, SQLite) |
| `Tool` | Typed function with auto-injected `ToolContext` | Schema-from-signature via Zod, validated I/O |

Plus:
- `Verifier` (+ built-in `VerifierKernels`) — deterministic output checks that aren't another LLM call
- `Runner` — the execution loop; streams events; checkpoints state; pluggable model adapter

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

## Verifier kernels — fast, deterministic, free

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
