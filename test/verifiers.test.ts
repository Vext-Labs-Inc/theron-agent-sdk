import { describe, it, expect } from "vitest";
import { defineVerifier, VerifierKernels } from "../src/index.js";

describe("defineVerifier", () => {
  it("wraps check() and tracks elapsed ms", async () => {
    const v = defineVerifier({
      name: "len_le_100",
      description: "output must be <= 100 chars",
      check: async (output) => {
        const issues =
          output.length > 100
            ? [
                {
                  kernel: "len_le_100",
                  severity: "error" as const,
                  message: `length ${output.length} > 100`,
                },
              ]
            : [];
        return { pass: issues.length === 0, issues };
      },
    });
    const ok = await v.check("short");
    expect(ok.pass).toBe(true);
    expect(ok.issues).toEqual([]);
    expect(ok.ms).toBeGreaterThanOrEqual(0);

    const fail = await v.check("x".repeat(101));
    expect(fail.pass).toBe(false);
    expect(fail.issues).toHaveLength(1);
  });
});

describe("VerifierKernels.emDash", () => {
  it("passes when no em-dash", async () => {
    const r = await VerifierKernels.emDash.check("All good here.");
    expect(r.pass).toBe(true);
  });
  it("fails when em-dash present", async () => {
    const r = await VerifierKernels.emDash.check("This is a tell—definitely AI.");
    expect(r.pass).toBe(false);
    expect(r.issues[0].message).toMatch(/Em-dash/);
  });
});

describe("VerifierKernels.aiIsm", () => {
  it("flags an AI-ism", async () => {
    const r = await VerifierKernels.aiIsm.check("Let me delve into this.");
    expect(r.pass).toBe(false);
    expect(r.issues.some((i) => i.message.includes("delve"))).toBe(true);
  });
  it("does not flag a non-AI-ism", async () => {
    const r = await VerifierKernels.aiIsm.check("A plain English sentence.");
    expect(r.pass).toBe(true);
  });
});

describe("VerifierKernels.arithmetic", () => {
  it("passes correct arithmetic", async () => {
    const r = await VerifierKernels.arithmetic.check("2 + 2 = 4 and 10 / 2 = 5.");
    expect(r.pass).toBe(true);
  });
  it("flags incorrect arithmetic", async () => {
    const r = await VerifierKernels.arithmetic.check("2 + 2 = 5.");
    expect(r.pass).toBe(false);
    expect(r.issues[0].message).toMatch(/actual 4/);
  });
  it("flags division by zero", async () => {
    const r = await VerifierKernels.arithmetic.check("10 / 0 = 0.");
    expect(r.pass).toBe(false);
  });
});

describe("VerifierKernels.citationPresence", () => {
  it("passes with a URL citation", async () => {
    const r = await VerifierKernels.citationPresence.check(
      "See https://example.com for details.",
    );
    expect(r.pass).toBe(true);
  });
  it("passes with a bracketed [N] citation", async () => {
    const r = await VerifierKernels.citationPresence.check("As shown in [1].");
    expect(r.pass).toBe(true);
  });
  it("fails with no citation", async () => {
    const r = await VerifierKernels.citationPresence.check("Trust me.");
    expect(r.pass).toBe(false);
  });
});
