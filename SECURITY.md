# Security Policy

## Reporting a vulnerability

Email vulnerability reports to **juwel@vextlabs.ai** with the subject line `Security`.

Do not file a public GitHub issue, post to a forum, or post on social media about an unpatched vulnerability.

We'll acknowledge receipt within 48 hours and aim to provide a fix or remediation plan within 14 days for high-severity issues.

## Scope

In scope: this package, `@vextlabs/sdk`, meaning the code in this repository, including the sample agents and model adapters in `examples/`.

Not vulnerabilities on their own:

- Tools running code on the host. That is what tools do. Sandboxing is up to the developer; `ToolContext.yolo` is the explicit consent flag.
- Verifier kernel false positives or false negatives. The kernels are heuristics, not proofs.
- Rate limits and retries for external services called by a model adapter. Those are the adapter's job.

Examples of what would be a vulnerability:

- Prompt injection that bypasses verifier-kernel gating
- Tool-call schema validation failures that allow type confusion
- A memory backend leaking data across tenants
- Undetected tampering with the session event log
- Code execution triggered by malformed SSE in streaming-response parsing

If you are not sure whether something is in scope, email us and ask.

## Acknowledgments

With your permission, we credit researchers who report valid issues in the release notes. There is no bug bounty program.
