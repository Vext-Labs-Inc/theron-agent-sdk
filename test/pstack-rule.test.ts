import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rulePath = resolve(root, ".cursor/rules/pstack.mdc");
const contributingPath = resolve(root, "CONTRIBUTING.md");
const templatePath = resolve(root, ".github/pull_request_template.md");

const read = (p: string) => readFileSync(p, "utf8");

function frontmatter(text: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : "";
}

describe("PSTACK / Vstack rule file", () => {
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
    "## Keep PSTACK out of product copy",
    "## Cursor plugin concepts",
  ])("keeps the section heading %s", (heading) => {
    const lines = read(rulePath).split(/\r?\n/);
    expect(lines).toContain(heading);
  });

  it("states the receipt requirements", () => {
    const text = read(rulePath);
    for (const term of ["Exact command", "pass / fail / skipped / total", "no live surface touched", "Rollback"]) {
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
  it("has the PSTACK / Vstack section pointing at the rule file", () => {
    const text = read(contributingPath);
    expect(text.split(/\r?\n/)).toContain("## PSTACK / Vstack (default for every agent)");
    expect(text).toContain(".cursor/rules/pstack.mdc");
  });
});

describe("PR template receipt block", () => {
  it("exists with the receipt checklist fields", () => {
    expect(existsSync(templatePath)).toBe(true);
    const text = read(templatePath);
    expect(text).toContain("## PSTACK / Vstack receipt");
    for (const field of [
      "Lane / orchestrator",
      "Claim ceiling",
      "Blast radius",
      "Test counts before",
      "Test counts after",
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
