# Contributing to Theron Agent SDK

Thanks for considering a contribution. The SDK is MIT-licensed and built to grow with the community.

## Quick start

```sh
git clone https://github.com/Vext-Labs-Inc/theron-agent-sdk
cd theron-agent-sdk
npm install
npm run build
npm test
```

## What we welcome

**High-leverage contributions:**

- **Model adapters** — new providers (AWS Bedrock, Cerebras, Groq, your own OSS endpoint). Adapter shape is in [src/runtime/index.ts](src/runtime/index.ts).
- **Verifier kernels** — domain-specific deterministic checkers. SQL syntax, K8s YAML lint, Lean proof check, etc. See [src/verifiers/index.ts](src/verifiers/index.ts) for the contract.
- **Memory backends** — pgvector, sqlite-vec, Cloudflare D1, Upstash Vector. See [src/memory/index.ts](src/memory/index.ts).
- **Session persistence** — Postgres, Redis, R2. See [src/session/index.ts](src/session/index.ts).
- **Sample agents** — new patterns that show off the SDK well. Drop one in `examples/` with a README of its own.
- **Docs improvements** — better quick-starts, migration guides, comparison content.

**Less helpful right now:**

- Refactors-for-refactor's-sake on the core primitives — they're stable.
- Hosted-runtime features — that's Vext's managed product, kept proprietary by design.
- Pre-trained adapter weights — separate licensing concern; submit those to the Vext managed plan.

## The bar

Every PR should:
1. Pass `npm run build` (TypeScript clean)
2. Pass `npm test`
3. Include or update a sample / doc demonstrating the change
4. Have a clear, descriptive title — no "fix bug" or "update code"
5. Reference the issue it addresses (if any)

For new primitives, the bar is higher — open an issue first to discuss before opening a PR. The five primitives (Agent, Council, Session, Memory, Tool) are the public surface; adding a sixth requires consensus.

## Code style

- TypeScript strict mode, no `any` unless commented why.
- One file per primitive (mirror the existing layout).
- Comments explain WHY, not WHAT. Identifiers should make WHAT obvious.
- No em-dashes in source comments (we eat our own dogfood — see `VerifierKernels.emDash`).
- No "AI-ism" words ("delve", "tapestry", "leverage", etc.) — see `VerifierKernels.aiIsm`.

## Issue triage

Issues are triaged weekly by the maintainers. We tag:
- `good first issue` — small, well-scoped, well-suited for first-time contributors
- `help wanted` — we want this fixed but don't have bandwidth this cycle
- `wontfix` — out of scope or against the architecture; comment explains why
- `discussion` — needs design input before code

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md). Do not file a public issue; email `security@tryvext.com`.

## Code of conduct

Be kind. Be specific. Cite sources. No personal attacks. No spam. Maintainers may close issues / PRs / discussions that violate this at their discretion.

## Releases

Releases are tagged via `git tag v0.X.Y && git push --tags`. Maintainers cut releases; contributors don't need to.

## Questions

- General questions: open a Discussion on GitHub
- Bugs: open an Issue
- Vext managed Theron / hosted runtime / enterprise: `info@tryvext.com`
- Security: `security@tryvext.com`

---

Maintained by [Vext Labs, Inc.](https://tryvext.com).
