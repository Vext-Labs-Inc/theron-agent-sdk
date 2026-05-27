import { describe, it, expect } from "vitest";
import {
  ReceiptEmitter,
  InMemoryReceiptSink,
  type Receipt,
  type ReceiptSigner,
} from "../src/receipts/index.js";

describe("ReceiptEmitter", () => {
  it("rejects construction with no sinks", () => {
    expect(() => new ReceiptEmitter({ sinks: [] })).toThrow(/at least one sink/i);
  });

  it("emits a receipt to every sink", async () => {
    const a = new InMemoryReceiptSink();
    const b = new InMemoryReceiptSink();
    const emitter = new ReceiptEmitter({ sinks: [a, b], issuer: "did:web:test" });
    await emitter.emit({
      cap: "agent.run",
      input: { q: "hi" },
      output: { answer: "ok" },
    });
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(1);
    expect(a.list()[0].cap).toBe("agent.run");
    expect(a.list()[0].issuer).toBe("did:web:test");
  });

  it("derives a stable content_hash from payload", async () => {
    const sink = new InMemoryReceiptSink();
    const emitter = new ReceiptEmitter({ sinks: [sink] });
    const r1 = await emitter.emit({
      cap: "x", input: { a: 1, b: 2 }, output: { z: 9 },
    });
    const r2 = await emitter.emit({
      // key reorder must not change the hash (canonicalization)
      cap: "x", input: { b: 2, a: 1 }, output: { z: 9 },
    });
    expect(r1.content_hash).toBe(r2.content_hash);
    expect(r1.id).not.toBe(r2.id); // ids still unique
  });

  it("applies a signer when provided", async () => {
    const sink = new InMemoryReceiptSink();
    const signer: ReceiptSigner = {
      algorithm: "HMAC-SHA256",
      issuer: "did:web:test",
      async sign(_receipt: Receipt) {
        return "test-signature";
      },
    };
    const emitter = new ReceiptEmitter({ sinks: [sink], signer });
    const r = await emitter.emit({
      cap: "agent.run", input: {}, output: {},
    });
    expect(r.signature).toBe("test-signature");
    expect(r.issuer).toBe("did:web:test");
  });

  it("swallows sink errors so the agent loop never breaks", async () => {
    const failing = {
      name: "failing",
      async emit() { throw new Error("boom"); },
    };
    const ok = new InMemoryReceiptSink();
    const emitter = new ReceiptEmitter({ sinks: [failing, ok] });
    await expect(
      emitter.emit({ cap: "x", input: {}, output: {} }),
    ).resolves.toBeDefined();
    expect(ok.list()).toHaveLength(1);
  });

  it("ulid id sorts lexicographically by emission time", async () => {
    const sink = new InMemoryReceiptSink();
    const emitter = new ReceiptEmitter({ sinks: [sink] });
    const r1 = await emitter.emit({ cap: "x", input: {}, output: {} });
    await new Promise((res) => setTimeout(res, 5));
    const r2 = await emitter.emit({ cap: "x", input: {}, output: {} });
    expect(r1.id < r2.id).toBe(true);
  });
});
