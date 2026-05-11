# Security Policy

## Reporting a vulnerability

Send vulnerability reports to **security@tryvext.com**.

Do **not** file a public GitHub issue, post to a forum, or tweet about an unpatched vulnerability.

We'll acknowledge receipt within 48 hours and aim to provide a fix or remediation plan within 14 days for high-severity issues.

## Scope

In scope:
- The SDK code in this repository (`@vextlabs/theron-agent-sdk`)
- The sample agents in `examples/`
- The OpenRouter / OpenAI model adapters shipped here

Out of scope (report to Vext separately):
- Vext-hosted Theron API (`api.tryvext.com`) — report to `security@tryvext.com` with subject `[hosted]`
- Stoa cap protocol — see [github.com/Vext-Labs-Inc/stoa/SECURITY.md](https://github.com/Vext-Labs-Inc/stoa/SECURITY.md)
- The proprietary 15 Layer-1 LoRAs, the 450+ Hive agents, the Theron-Base model — separate disclosure channel

## Threat model

The SDK is a framework — it executes whatever code the developer integrates. Some things are *intentional* and not vulnerabilities:

- Tools can execute arbitrary code on the host (that's their purpose). Sandboxing is the developer's responsibility; the SDK provides `ToolContext.yolo` as the affirmative consent flag.
- Verifier kernels can return false positives or false negatives — they're heuristics, not proofs.
- Model adapters call external services; rate limits + retries are the adapter's responsibility.

What WOULD be a vulnerability:
- Prompt injection that bypasses the verifier-kernel gating mechanism
- Tool-call schema validation failures that allow type confusion
- Memory backend allowing cross-tenant data leak
- Session event-log tampering that goes undetected
- Streaming-response parsing that triggers RCE on malformed SSE

If unclear whether something is in scope, ask. Don't sit on it.

## Acknowledgments

Researchers who report valid issues will be credited in the release notes (with permission). We don't currently have a bug bounty program; check back in 2026-Q3.
