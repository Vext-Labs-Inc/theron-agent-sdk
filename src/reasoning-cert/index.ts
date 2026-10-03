import { VerifierKernels } from "../verifiers/index.js";

export type ReasoningTier =
  | "arithmetic"
  | "cas_algebra"
  | "smt_z3"
  | "lean4_proof"
  | "test_suite"
  | "source_presence";

export interface ReasoningCertificate {
  /** The checker class. Each is a different execution class from the model. */
  tier: ReasoningTier;
  /** What to re-run to check this, e.g. "js_runtime" | "z3:4.13" | "lean4:4.9". */
  oracle_id: string;
  oracle_version: string;
  /** sha256 of the canonical claim text fed to the checker (binds the cert to the claim). */
  claim_input_hash: string;
  verdict: "PASS" | "FAIL" | "ABSTAIN";
  verdict_detail: string;
  /** What this cert proves. */
  certifies: string;
  /** What this cert does not prove. Prevents over-reading the badge. */
  does_not_certify: string;
  oracle_ts: number;
}

const ARITH = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;

async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return "sha256:" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Certify the arithmetic claims in `text` via JS re-computation.
 * Returns PASS only if every "A op B = C" in the text re-computes; FAIL if any is
 * wrong; ABSTAIN when there is no arithmetic claim to check.
 */
export async function certifyArithmetic(text: string): Promise<ReasoningCertificate> {
  const claim = String(text ?? "");
  const matched = [...claim.matchAll(ARITH)].length;
  const res = await VerifierKernels.arithmetic.check(claim);
  const verdict = matched === 0 ? "ABSTAIN" : res.pass ? "PASS" : "FAIL";
  return {
    tier: "arithmetic",
    oracle_id: "js_runtime",
    oracle_version: typeof process !== "undefined" && process.version ? process.version : "webcrypto",
    claim_input_hash: await sha256Hex(claim),
    verdict,
    verdict_detail:
      matched === 0
        ? "no 'A op B = C' arithmetic claim found — nothing certified"
        : res.pass
          ? `${matched} arithmetic claim(s) re-computed and match`
          : res.issues.map((i) => i.message).join("; "),
    certifies: verdict === "PASS" ? "arithmetic_correct" : verdict === "FAIL" ? "arithmetic_incorrect" : "nothing",
    does_not_certify: "any reasoning, fact, or step beyond the literal 'A op B = C' arithmetic re-check",
    oracle_ts: Math.floor(Date.now() / 1000),
  };
}

/**
 * Offline, vendor-independent re-check. Re-runs the same deterministic checker on the
 * claim text and confirms it reproduces the certificate's verdict and that the claim
 * text matches `claim_input_hash`.
 */
export async function verifyReasoningCertificate(
  cert: ReasoningCertificate,
  claimText: string,
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (cert.tier !== "arithmetic") {
    reasons.push(`offline re-check for tier '${cert.tier}' is not implemented in Slice 0 (arithmetic only)`);
    return { ok: false, reasons };
  }
  const claim = String(claimText ?? "");
  const hashOk = (await sha256Hex(claim)) === cert.claim_input_hash;
  if (!hashOk) reasons.push("claim_input_hash does not match the provided claim text");
  const recomputed = await certifyArithmetic(claim);
  const verdictOk = recomputed.verdict === cert.verdict;
  if (!verdictOk) reasons.push(`re-computed verdict ${recomputed.verdict} != certificate ${cert.verdict}`);
  return { ok: hashOk && verdictOk, reasons };
}
