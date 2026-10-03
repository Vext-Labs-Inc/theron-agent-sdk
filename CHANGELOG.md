# Changelog

All notable changes to `@vextlabs/theron-agent-sdk` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2026-10-03

### Breaking
- **No hosted default.** `theronAdapter` throws `MissingBaseURLError` (`No hosted default endpoint; pass baseURL`) before any network call when neither `baseURL`, `base`, nor `THERON_BASE_URL` is set. The previous default host is not contacted.

### Security
- **Implicit account token is never sent.** `theronAdapter` no longer reads `JUWEL_TOKEN` or `~/.juwel/config.json` on its own, so that token is not attached. An explicit `apiKey` or `tokenProvider` is still sent to the caller-supplied base.
- **Adapter fetch does not follow redirects.** `theronAdapter` sets `redirect: "error"`, so a 302 or 307 cannot replay `Authorization` to another origin, including under fetch polyfills that follow by default. Cloudflare Workers supports `redirect: "error"` (`follow`, `error`, or `manual`).
- **Session shells are allowlist-only.** `LocalCloudSession.exec` copies an allowlist from `process.env` (`PATH`, `HOME`, `LANG`, `TERM`, and similar locale and temp variables) and then `options.env`. There is no second deny-list pass. `JUWEL_TOKEN` and names ending in `_TOKEN`, `_KEY`, or `_SECRET` are not inherited. `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `npm_config_*`, `SSH_AUTH_SOCK`, `NVM_*`, `XDG_*`, and `VIRTUAL_ENV` are not inherited either. Pass any of those through `options.env`.

### Migration
- Migration: pass baseURL (or set THERON_BASE_URL) and apiKey/tokenProvider; pass resolveJuwelToken as tokenProvider to keep the old token behaviour. `resolveJuwelToken` is exported from the package root and from `./adapters/theron`.

## [0.4.1] - 2026-10-03

### Changed
- Public source tree synced to the published 0.4.1 package. `package.json` version set to 0.4.1.

## [0.4.0]

### Note
- This repository has no 0.4.0 commit. History jumps from 0.1.0 to the 0.4.1 source sync.

## [0.3.2] - 2026-06-27

### Added
- **Agent authoring primitives** — `serializeMarkdownAgent()` (the inverse of `parseMarkdownAgent`, so a host can let an agent write its own `.theron/agents/<name>.md`), `slugifyAgentName()`, `resolveAgentModel()`, and the `AGENT_MODEL_TIERS` fleet map (`fast`→fugu, `deep`→fugu-ultra, `reasoning`→a CoT specialist) — the single source of truth for subagent model routing.
- **Extended tool contract** — `Task` now carries an `agent_type` parameter (named subagent personas), and a new canonical `AgentCreate` schema lets a surface expose runtime agent authoring. `AgentCreate` is registered in `MUTATING_EXTENDED_TOOLS` (it writes a file).

## [0.3.1] - 2026-06-26

### Added
- **Sub-agent delegation actually executes.** A supervisor `Agent` with `sub_agents` now exposes one `delegate_to_<name>` tool per sub-agent (via `toolSchemas()`), and the `Runner` routes those calls back into `runner.run(subAgent, task)`, threading the abort signal — hierarchical multi-agent graphs work end-to-end instead of `sub_agents` being a silent no-op. New export `subAgentToolName`.
- **On-disk SKILL.md loader** — `parseMarkdownSkill` / `loadMarkdownSkills` / `loadAllMarkdownSkills` (+ `MarkdownSkill` type) load user/project skills from `~/.theron/skills/*.md` and `<project>/.theron/skills/*.md` (also `<name>/SKILL.md` dirs), with project-local overriding global. Mirrors the markdown-agent loader; consumed by both the CLI and VS Code surfaces.
- **`AbortSignal` cancellation** — `Runner.run`/`runCouncil` accept `{ signal }` (new `RunOptions`); the loop checks it each turn and emits an `aborted` event; `ModelAdapter.chat` gains an optional `signal` to forward to `fetch`.
- **Cost accounting** — `ModelAdapter.chat` may return `cost_usd`; the Runner sums it into `AgentResult.cost_usd`, so `costUsdAtLeast` and budget-stop now work.
- **`max_turns_exhausted` event** — emitted when the loop runs out of turns without a final answer (instead of silently returning `""`).
- **Council `claimExtractor`** — opt-in extractor (e.g. exported `sentenceClaimExtractor`) so the deterministic reconciler can ratify cross-specialist claims; default behavior unchanged.
- **`compactHistory({ summaryRole })`** — attach the summary under `user` instead of `system` for providers that reject a second system message.

### Changed
- **Parallel tool dispatch.** Multiple tool calls in a single turn now execute concurrently (`Promise.all`) with results appended in call order — turn latency drops from sum-of-tools to slowest-tool.
- **Robust Zod → JSON Schema.** The converter now handles unions, literals, records, nullables, defaults, enums, and `.describe()` annotations (and excludes default-valued fields from `required`) instead of silently emitting `{type:"string"}`.
- **MCP single-flight init.** Concurrent `listTools`/`callTool` callers share one in-flight `initialize` handshake (no duplicate sessions); a failed init is retryable.

## [0.3.0] - 2026-06-13

### Added
- **`patterns`** primitives: framework-agnostic, verifier/score-gated reasoning patterns as composable functions: `selfConsistency` (sample N paths, then majority answer + agreement ratio), `bestOfN` (verifier-guided best-of-N), `selfRefine` (draft, critique, revise, early-exit when clean), `treeOfThoughts` (best-first branch/score/expand search), `chainOfVerification` (draft, verify claims independently, revise), `mixtureOfAgents` (layered multi-agent propose, refine with peer outputs, aggregate), `reflexion` (retry with accumulated verbal reflections from outcome feedback). Provider-agnostic (take async `generate`/`score`/`verify`/`critique` fns); pure, deterministic, zero-network.
- **`measureLift`**: measure a pattern/loop's score lift + win-rate over a single-shot baseline on a task set, so the effect can be measured rather than asserted. Pure; no benchmark framework required.
- **`loop`** primitives: `verifiedRatchet` (advance only on a confident verifier pass), verifier-in-the-loop `stopWhen` predicates (`stepCountIs`/`costUsdAtLeast`/`verifierSatisfied`/`anyOf`/`allOf`), `runImprovementCycle`.
- **Long-horizon primitives** — `compactHistory` (summarize-and-continue: fold older messages into a summary, keep recent verbatim, so a conversation/loop runs far past the context window), `runUntil` (a bounded, checkpointable long-horizon driver: run `step` until a predicate holds or `maxSteps`, with an `onCheckpoint` hook for durable resume), and `boundWorkingSet` (keep a long agent's working memory bounded by importance + recency; pinned items never evicted). Provider-agnostic + pure. The "run soo long, hold soo much context" kit.

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
