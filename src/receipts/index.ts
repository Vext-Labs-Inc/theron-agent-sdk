// Receipts — emit Stoa-shaped receipts for any agent action.
//
// A receipt is a portable, signable record of "this agent did this thing at
// this time, with these inputs, and got this output." The shape mirrors the
// public Stoa cap-protocol envelope so receipts from this SDK can be POSTed
// straight into a Stoa-conformant receipt sink (or batched + anchored via a
// daily Merkle root) without translation.
//
// This module ships open: emitter, in-memory sink, JSONL file sink, HTTP sink,
// and a deterministic content hash. Signing keys + receipt-sink endpoint URLs
// are caller-supplied (BYOK). Vext's hosted Stoa sink + key issuance is the
// upgrade path; this SDK does not require it.

export interface ReceiptInput {
  /** Stable capability identifier. Examples: "agent.run", "council.deliberate",
   *  "vext.calendar.list_events", "vext.github.create_pr". Free-form; pick a
   *  reverse-DNS-ish scheme so receipts cluster by domain. */
  cap: string;
  /** Inputs the agent saw. Hashed into the content_hash. */
  input: unknown;
  /** Outputs the agent produced. Hashed into the content_hash. */
  output: unknown;
  /** Actor — who/what produced this. Free-form: agent name, council name,
   *  user id, tenant. */
  actor?: string;
  /** Optional session id for correlation with a Session log. */
  session_id?: string;
  /** Optional tenant id for multi-tenant deployments. */
  tenant_id?: string;
  /** Optional metadata. Hashed into content_hash. */
  metadata?: Record<string, unknown>;
}

export interface Receipt {
  /** Schema version. */
  v: "stoa.receipt.v1";
  /** ULID-shaped id. */
  id: string;
  /** Capability the receipt covers. */
  cap: string;
  /** Issuer DID or label. Defaults to "did:web:local". Production users set
   *  this to their issuer DID (did:web:tryvext.com, did:web:acme.com, ...). */
  issuer: string;
  /** Actor — who/what produced this. */
  actor?: string;
  /** Unix ms timestamp. */
  ts: number;
  /** Session correlation id. */
  session_id?: string;
  /** Tenant id. */
  tenant_id?: string;
  /** SHA-256 hex of canonical(input + output + metadata). Lets downstream
   *  systems verify the receipt without seeing the payload. */
  content_hash: string;
  /** Inline payload. Implementations MAY null this out before transmission
   *  if the sink already has the data; the content_hash is the source of
   *  truth. */
  payload: {
    input: unknown;
    output: unknown;
    metadata?: Record<string, unknown>;
  };
  /** Optional detached signature (base64). Populated by a signer. The SDK
   *  ships an unsigned receipt by default; plug a signer into the emitter
   *  to populate this. ES256 over canonical(receipt without `signature`)
   *  is the canonical scheme. */
  signature?: string;
}

/** A sink receives receipts and persists / forwards them. */
export interface ReceiptSink {
  name: string;
  emit(receipt: Receipt): Promise<void>;
}

/** A signer turns an unsigned receipt into a signed one. Implementations:
 *  ES256 (default Stoa scheme), Ed25519, HMAC-SHA256 (for internal flows). */
export interface ReceiptSigner {
  algorithm: "ES256" | "Ed25519" | "HMAC-SHA256" | string;
  issuer: string;
  sign(receipt: Receipt): Promise<string>;
}

export interface ReceiptEmitterConfig {
  /** Sinks the emitter writes to. Multiple sinks fan out in parallel. */
  sinks: ReceiptSink[];
  /** Optional signer. If provided, every receipt is signed before sink emit. */
  signer?: ReceiptSigner;
  /** Default issuer if no signer is configured. Defaults to "did:web:local". */
  issuer?: string;
  /** Default actor. Overridable per-emit. */
  actor?: string;
  /** Default tenant id. Overridable per-emit. */
  tenant_id?: string;
}

/**
 * ReceiptEmitter — the main primitive callers use.
 *
 * Minimal usage:
 *   const receipts = new ReceiptEmitter({ sinks: [new InMemoryReceiptSink()] });
 *   await receipts.emit({
 *     cap: "agent.run",
 *     actor: "code-reviewer",
 *     input: { query: "review PR 42" },
 *     output: { review: "LGTM with two nits" },
 *   });
 *
 * Wire into a Runner via the runner.on() callback:
 *   runner.on(async (event) => {
 *     if (event.type === "agent_output") {
 *       await receipts.emit({ cap: "agent.run", actor: event.agent,
 *                             input: { agent: event.agent }, output: event.output });
 *     }
 *   });
 */
export class ReceiptEmitter {
  public readonly sinks: ReceiptSink[];
  public readonly signer: ReceiptSigner | undefined;
  public readonly issuer: string;
  public readonly actor: string | undefined;
  public readonly tenant_id: string | undefined;

  constructor(config: ReceiptEmitterConfig) {
    if (!config.sinks || config.sinks.length === 0) {
      throw new Error("ReceiptEmitter requires at least one sink.");
    }
    this.sinks = config.sinks;
    this.signer = config.signer;
    this.issuer = config.signer?.issuer ?? config.issuer ?? "did:web:local";
    this.actor = config.actor;
    this.tenant_id = config.tenant_id;
  }

  async emit(input: ReceiptInput): Promise<Receipt> {
    const ts = Date.now();
    const payload = {
      input: input.input,
      output: input.output,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };
    const content_hash = await sha256Hex(canonicalize(payload));
    let receipt: Receipt = {
      v: "stoa.receipt.v1",
      id: ulid(),
      cap: input.cap,
      issuer: this.issuer,
      actor: input.actor ?? this.actor,
      ts,
      session_id: input.session_id,
      tenant_id: input.tenant_id ?? this.tenant_id,
      content_hash,
      payload,
    };
    if (this.signer) {
      const signature = await this.signer.sign(receipt);
      receipt = { ...receipt, signature };
    }
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.emit(receipt);
        } catch (err) {
          // Sink failures must never block the agent loop. Surface to stderr
          // so operators see them; production users should wire structured
          // logging into their sink wrapper.
          // eslint-disable-next-line no-console
          console.warn(`[receipts] sink "${sink.name}" failed:`, err);
        }
      }),
    );
    return receipt;
  }
}

/** In-memory sink — for tests + ephemeral inspection. */
export class InMemoryReceiptSink implements ReceiptSink {
  public readonly name = "in-memory";
  private readonly records: Receipt[] = [];

  async emit(receipt: Receipt): Promise<void> {
    this.records.push(receipt);
  }

  list(): readonly Receipt[] {
    return this.records;
  }

  clear(): void {
    this.records.length = 0;
  }
}

/**
 * JSONL file sink — appends each receipt as a single JSON line to `path`.
 * Lazily imports `node:fs/promises` so the SDK stays bundleable for non-Node
 * runtimes (Workers, Deno). Throws on use outside Node.
 */
export function fileReceiptSink(path: string): ReceiptSink {
  return {
    name: `file:${path}`,
    async emit(receipt) {
      const fs = await import("node:fs/promises");
      await fs.appendFile(path, JSON.stringify(receipt) + "\n", "utf8");
    },
  };
}

/**
 * HTTP sink — POSTs each receipt to a Stoa-conformant sink URL. The URL must
 * accept `application/json` and return 2xx on accept.
 */
export function httpReceiptSink(opts: {
  url: string;
  token?: string;
  timeout_ms?: number;
}): ReceiptSink {
  const timeout_ms = opts.timeout_ms ?? 5000;
  return {
    name: `http:${new URL(opts.url).host}`,
    async emit(receipt) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout_ms);
      try {
        const res = await fetch(opts.url, {
          method: "POST",
          signal: ac.signal,
          headers: {
            "Content-Type": "application/json",
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          },
          body: JSON.stringify(receipt),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `http sink ${opts.url} returned ${res.status}: ${text.slice(0, 200)}`,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// -------------------------------------------------------------- internals

/** Canonical JSON — sorted keys, no insignificant whitespace. Required for a
 *  deterministic content_hash that round-trips across implementations. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

/** SHA-256 → lower-case hex, via WebCrypto (available in Node 20+, Workers,
 *  Deno, modern browsers). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Crockford-base32 ULID. 26 chars, sortable, monotonic enough at ms
 *  resolution for the SDK's purposes. Falls back to `rcpt_<rand>_<ts>` on
 *  exotic runtimes without crypto.getRandomValues. */
function ulid(): string {
  const ts = Date.now();
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let tsPart = "";
  let t = ts;
  for (let i = 9; i >= 0; i--) {
    tsPart = ALPHABET[t % 32] + tsPart;
    t = Math.floor(t / 32);
  }
  let randPart = "";
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < 16; i++) randPart += ALPHABET[bytes[i] % 32];
  } else {
    for (let i = 0; i < 16; i++)
      randPart += ALPHABET[Math.floor(Math.random() * 32)];
  }
  return tsPart + randPart;
}
