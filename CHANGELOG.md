# Changelog

All notable changes to `@vextlabs/theron-agent-sdk` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-23

First stable npm release. The five primitives and the runtime ship under the
`@vextlabs/theron-agent-sdk` name with no API breaks expected through the 0.1
line.

### Added (v0.1.0 release polish)
- **`Receipts`** primitive: `ReceiptEmitter` + `InMemoryReceiptSink` + `fileReceiptSink` + `httpReceiptSink` + `ReceiptSigner` interface. Stoa-shaped receipts (`stoa.receipt.v1`) with deterministic SHA-256 content hash, ULID ids, optional detached signature. Importable as `@vextlabs/theron-agent-sdk/receipts` for tree-shake.
- **Three sample agents** that ship in `examples/`:
  - `cyber-recon-bot.ts` — passive recon (subdomains → ports → TLS → tech), receipts per tool call.
  - `meeting-prep-bot.ts` — one-page meeting brief from calendar + docs + memory.
  - `support-triage-bot.ts` — three-specialist Council that classifies + retrieves + drafts a reply, with the routing decision emitted as a signable receipt.
- New tests at `test/receipts.test.ts` cover canonicalization, signing, sink fan-out, ULID ordering, and sink-failure isolation.

### Added
- **`Agent`** primitive: model + instruction + tools + sub-agents + verifier kernels.
- **`Council`** primitive: N specialists + verifier kernels + reconciler. Built-in deterministic claim-merge reconciler; bring your own for semantic merging.
- **`Session`** primitive: append-only event log + scoped state, with `toJSON` / `fromJSON` for persistence.
- **`Memory`** primitive with `InMemoryStore` reference implementation. Tenant-scoped; ready to swap in pgvector, R2, SQLite, etc.
- **`defineTool`** factory backed by Zod schemas (auto-converts to JSON schema for OpenAI/Anthropic-style tool calls).
- **`defineVerifier`** factory + `VerifierKernels.{emDash, aiIsm, arithmetic, citationPresence}` built-ins.
- **`Runner`** with pluggable `ModelAdapter` interface. Streams events (`agent_thinking`, `tool_call_*`, `verifier_run`, `council_done`, etc.). Supports per-specialist timeouts in `runCouncil`.
- **Reference adapters** in `examples/adapters/`:
  - `openrouter.ts` — works against 200+ models with SSE streaming + tool-call buffering.
  - `theron.ts` — points at the hosted Vext Theron endpoint at `tryvext.com/api/theron-chat-phased`.
- **Three runnable examples**: `basic-agent.ts`, `council-deliberation.ts`, `verifier-kernel.ts`.
- **MCP client** at `@vextlabs/theron-agent-sdk/mcp` — `MCPClient` speaks the Model Context Protocol over streamable HTTP / SSE. `collectMcpTools()` collapses multiple servers into one namespaced `Tool[]`. Tests land in v0.1.x.

### Build & tooling
- Switched build from `tsc` to **`tsup`**. Emits ESM + CJS + `.d.ts` for every entry point. Tree-shakeable.
- Added **`vitest`** test suite with 58 tests covering the 5 primitives + runtime + built-in kernels.
- Added **`@vitest/coverage-v8`** with thresholds at 80% lines / 80% functions / 70% branches; current coverage 95%+ lines.
- Added **`typedoc`** for API reference generation (`npm run docs`); output lands in `docs/`.

### Notes
- Runner's `runCouncil` passes `claims: []` to the reconciler — claim extraction is the reconciler's job. The default deterministic reconciler therefore returns `refuted` for generic prose; swap in a semantic reconciler or a claim-extracting one for production deliberation.
- The MCP subpath is excluded from the 80% coverage threshold pending dedicated tests.

## [0.1.0-alpha] - 2026-05-12

Pre-release. SDK surface defined under five primitives; `tsc` build; node `--test` harness; sample agents under numeric prefixes (`01_*`, `02_*`, `03_*`).

[0.1.0]: https://github.com/Vext-Labs-Inc/theron-agent-sdk/releases/tag/v0.1.0
[0.1.0-alpha]: https://github.com/Vext-Labs-Inc/theron-agent-sdk/releases/tag/v0.1.0-alpha
