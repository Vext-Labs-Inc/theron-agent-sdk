# Changelog

All notable changes to `@vextlabs/sdk` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking
- **No hosted default.** `createVextAdapter` (deprecated alias `theronAdapter`) does not call a hosted endpoint. `baseURL` is the OpenAI-style API root. `chat` POSTs to `<baseURL>/chat/completions` (trailing slashes on the path stripped; a `?query` or `#fragment` on `baseURL`, such as Azure's `?api-version=`, is kept after the appended path). `https://api.openai.com/v1` posts to `https://api.openai.com/v1/chat/completions`. `http://127.0.0.1:11434/v1` posts to `http://127.0.0.1:11434/v1/chat/completions`. `chat` throws `MissingBaseURLError` with the message `No hosted default endpoint; pass baseURL or set VEXT_BASE_URL` when `baseURL`, the deprecated `base` option, `VEXT_BASE_URL`, and `THERON_BASE_URL` are all unset. The throw happens before any network call. `VEXT_BASE_URL` wins over `THERON_BASE_URL` when both are set. `baseURL` wins over `base` and over both env vars. Set `baseURL` together with `apiKey`; if `baseURL` is omitted, the env base decides where the key is sent.
- **No default model, and no default `council_mode`.** `chat` throws `Missing model; pass model` when `model` is missing or blank. `council_mode` is included in the JSON body only when the caller sets `councilMode`.
- **Package name.** The npm package is `@vextlabs/sdk`. Primary exports are `createVextAdapter`, `vext`, `VextAdapter`, and `VextAdapterOptions`, plus the `@vextlabs/sdk/adapters/vext` subpath. `theronAdapter`, `theron`, `TheronAdapterOptions`, and `@vextlabs/sdk/adapters/theron` remain as deprecated aliases. Root and subpath bundles share one `MissingBaseURLError` class via build splitting.
- **No `max_tokens` or `temperature` defaults.** The adapter sends `max_tokens` and `temperature` only when the caller passes them to `chat`. The previous `2048` and `0.2` defaults are gone, so the server's defaults apply.
- **`ModelAdapter` messages carry tool-call ids.** `chat` now receives `ModelMessage[]`: an assistant turn that requested tools has `tool_calls` (each with an `id`), and a tool result has `tool_call_id`. Adapters should return the upstream `id` on each tool call; the `Runner` synthesizes one when an adapter does not.
- **Implicit account token is not sent.** The adapter does not read `JUWEL_TOKEN` or `~/.juwel/config.json` unless the caller passes that resolver as `tokenProvider`. An explicit `apiKey` or `tokenProvider` is still sent to the caller-supplied base.

### Fixed
- **Tool use against OpenAI-style servers.** The `Runner` sent the assistant turn without `tool_calls` and each tool result without `tool_call_id`, and the adapter dropped the upstream ids, so strict servers answered the second turn of a tool run with `400 Missing parameter 'tool_call_id'`. Ids from non-stream responses and stream deltas are now kept and sent back.
- **Streamed token usage.** Streaming requests send `stream_options: { include_usage: true }`, so servers that only report usage on request now do.

Known issue: published 0.4.1's default host redirects and the follow-on chat completions route returns 404. This release does not call that host.

### Security
- **Adapter fetch does not follow redirects.** `createVextAdapter` sets `redirect: "error"`, so a 302 or 307 cannot replay `Authorization` to another origin, including under fetch polyfills that follow by default. Cloudflare Workers supports this mode: the Request `redirect` option is `follow`, `error`, or `manual` ([Workers Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/), reviewed 2026-07-02).
- **Session shells are allowlist-only.** `LocalCloudSession.exec` copies `PATH`, `HOME`, `LANG`, `LANGUAGE`, `LC_ALL`, `LC_CTYPE`, `TERM`, `TZ`, `TMPDIR`, `TMP`, `TEMP`, `SHELL`, `USER`, and `LOGNAME` from `process.env`, then copies `options.env` as given. There is no second deny-list pass. Parent variables that are not on the allowlist are not inherited, including `JUWEL_TOKEN`, names ending in `_TOKEN`, `_KEY`, or `_SECRET`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `npm_config_*`, `SSH_AUTH_SOCK`, `NVM_*`, `XDG_*`, and `VIRTUAL_ENV`. Pass any of those through `options.env` when a command needs them.

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
- **`patterns`** primitives: framework-agnostic, verifier/score-gated reasoning patterns: `selfConsistency` (sample N paths, majority answer + agreement ratio), `bestOfN` (verifier-guided best-of-N), `selfRefine` (draft, critique, revise, early-exit when clean), `treeOfThoughts` (best-first branch/score/expand search), `chainOfVerification` (draft, verify claims independently, revise; hallucination reduction), `mixtureOfAgents` (layered multi-agent propose, refine-seeing-peers, aggregate), `reflexion` (retry with accumulated verbal reflections; learns from outcome feedback). Provider-agnostic (take async `generate`/`score`/`verify`/`critique` fns); pure, deterministic, zero-network. The SDK-side counterparts of the server-side hive loops.
- **`measureLift`**: measure a pattern/loop's score lift + win-rate over a single-shot baseline on a task set. Use it to measure whether the harness beats single-shot. Pure; no benchmark framework required.
- **`loop`** primitives: `verifiedRatchet` (advance only on a confident verifier pass), verifier-in-the-loop `stopWhen` predicates (`stepCountIs`/`costUsdAtLeast`/`verifierSatisfied`/`anyOf`/`allOf`), `runImprovementCycle`.
- **Long-horizon primitives** — `compactHistory` (summarize-and-continue: fold older messages into a summary, keep recent verbatim, so a conversation/loop runs far past the context window), `runUntil` (a bounded, checkpointable long-horizon driver: run `step` until a predicate holds or `maxSteps`, with an `onCheckpoint` hook for durable resume), and `boundWorkingSet` (keep a long agent's working memory bounded by importance + recency; pinned items never evicted). Provider-agnostic + pure. The "run soo long, hold soo much context" kit.

## [0.1.0] - 2026-05-23

First stable npm release. The five primitives and the runtime ship under the
`@vextlabs/sdk` name (published then as `@vextlabs/theron-agent-sdk`) with no API breaks expected through the 0.1
line.

### Added (v0.1.0 release polish)
- **`Receipts`** primitive: `ReceiptEmitter` + `InMemoryReceiptSink` + `fileReceiptSink` + `httpReceiptSink` + `ReceiptSigner` interface. Stoa-shaped receipts (`stoa.receipt.v1`) with deterministic SHA-256 content hash, ULID ids, optional detached signature. Importable as `@vextlabs/sdk/receipts` for tree-shake.
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
  - `adapters/vext`: adapter that POSTs to `<baseURL>/chat/completions`. Callers pass an OpenAI-style `baseURL`. There is no hosted default.
- **Three runnable examples**: `basic-agent.ts`, `council-deliberation.ts`, `verifier-kernel.ts`.
- **MCP client** at `@vextlabs/sdk/mcp`. `MCPClient` speaks the Model Context Protocol over streamable HTTP / SSE. `collectMcpTools()` collapses multiple servers into one namespaced `Tool[]`. Tests land in v0.1.x.

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
