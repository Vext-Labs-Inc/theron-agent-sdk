import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rulePath = resolve(root, ".cursor/rules/verification-receipt.mdc");
const contributingPath = resolve(root, "CONTRIBUTING.md");
const templatePath = resolve(root, ".github/pull_request_template.md");

const read = (p: string) => readFileSync(p, "utf8");

function frontmatter(text: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : "";
}

describe("Verification receipt rule file", () => {
  it("exists", () => {
    expect(existsSync(rulePath)).toBe(true);
  });

  it("is always applied", () => {
    expect(frontmatter(read(rulePath))).toMatch(/^alwaysApply:\s*true\s*$/m);
  });

  it.each([
    "## One orchestrator, narrow lanes",
    "## Every unit ends in a check",
    "## Receipts and the claim ceiling",
    "## Where checks run",
    "## Real checks in this repo",
    "## Keep process vocabulary out of product copy",
    "## No regressions",
  ])("keeps the section heading %s", (heading) => {
    const lines = read(rulePath).split(/\r?\n/);
    expect(lines).toContain(heading);
  });

  it("states the receipt requirements", () => {
    const text = read(rulePath);
    for (const term of [
      "Exact command",
      "pass / fail / skipped / total",
      "the expected number is 0",
      "no live surface touched",
      "Rollback",
      "One orchestrator owns the task",
      "Prove it works",
    ]) {
      expect(text).toContain(term);
    }
    expect(text).toMatch(/GitHub Actions is not the merge gate/);
  });

  it("does not require Cursor or pin npm test to a specific runner", () => {
    const text = read(rulePath);
    expect(text).toContain("locally in any editor or in Cursor");
    expect(text).not.toMatch(/Checks run in Cursor/);
    expect(text).not.toContain("vitest run");
  });
});

describe("CONTRIBUTING pointer", () => {
  it("has the Verification receipt section pointing at the rule file", () => {
    const text = read(contributingPath);
    expect(text.split(/\r?\n/)).toContain("## Verification receipt (default for every agent)");
    expect(text).toContain(".cursor/rules/verification-receipt.mdc");
  });
});

describe("PR template receipt block", () => {
  it("exists with the receipt checklist fields", () => {
    expect(existsSync(templatePath)).toBe(true);
    const text = read(templatePath);
    expect(text).toContain("## Verification receipt");
    for (const field of [
      "Lane / orchestrator",
      "Claim ceiling",
      "Blast radius",
      "Test counts before",
      "Test counts after",
      "Tests deleted or skipped",
      "Rollback",
    ]) {
      expect(text).toContain(`**${field}`);
    }
  });

  it("marks the receipt optional for external contributors and uses placeholder counts", () => {
    const text = read(templatePath);
    expect(text).toContain("Optional for external contributors");
    expect(text).toContain("<pass> / <fail> / <skip>");
    expect(text).not.toMatch(/\b\d+ \/ \d+ \/ \d+ \/ \d+\b/);
  });
});
