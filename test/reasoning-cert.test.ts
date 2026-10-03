import { describe, it, expect } from "vitest";
import {
  certifyArithmetic,
  verifyReasoningCertificate,
  ReceiptEmitter,
  InMemoryReceiptSink,
} from "../src/index.js";

describe("ReasoningCertificate (arithmetic tier)", () => {
  it("PASS on correct arithmetic", async () => {
    const cert = await certifyArithmetic("The total is 2 + 2 = 4 and 10 * 3 = 30.");
    expect(cert.verdict).toBe("PASS");
    expect(cert.tier).toBe("arithmetic");
    expect(cert.certifies).toBe("arithmetic_correct");
    expect(cert.does_not_certify).toBeTruthy(); // mandatory honesty field
  });

  it("FAIL on wrong arithmetic", async () => {
    const cert = await certifyArithmetic("Trust me, 2 + 2 = 5.");
    expect(cert.verdict).toBe("FAIL");
    expect(cert.verdict_detail).toMatch(/actual 4/);
  });

  it("ABSTAIN on prose with no arithmetic (the G1 fix — never stamp prose PASS)", async () => {
    const cert = await certifyArithmetic("The contract looks fine and the vibes are good.");
    expect(cert.verdict).toBe("ABSTAIN");
    expect(cert.certifies).toBe("nothing");
  });

  it("offline re-check reproduces the verdict and binds to the claim", async () => {
    const claim = "Sum check: 7 + 8 = 15.";
    const cert = await certifyArithmetic(claim);
    const ok = await verifyReasoningCertificate(cert, claim);
    expect(ok.ok).toBe(true);
    // tampering the claim text must break the bind (hash mismatch)
    const bad = await verifyReasoningCertificate(cert, "Sum check: 7 + 8 = 16.");
    expect(bad.ok).toBe(false);
  });

  it("is SEALED into the receipt content_hash (tampering the cert changes the hash)", async () => {
    const emitter = new ReceiptEmitter({ sinks: [new InMemoryReceiptSink()] });
    const claim = "9 * 9 = 81";
    const cert = await certifyArithmetic(claim);
    const r1 = await emitter.emit({ cap: "agent.run", input: { q: claim }, output: claim, metadata: { reasoning_cert: cert } });
    // flip the sealed verdict → content_hash must differ
    const r2 = await emitter.emit({
      cap: "agent.run", input: { q: claim }, output: claim,
      metadata: { reasoning_cert: { ...cert, verdict: "FAIL" } },
    });
    expect(r1.content_hash).not.toBe(r2.content_hash);
  });
});
