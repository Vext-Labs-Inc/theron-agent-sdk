import { describe, it, expect } from "vitest";
import {
  serializeMarkdownAgent,
  parseMarkdownAgent,
  slugifyAgentName,
  resolveAgentModel,
  AGENT_MODEL_TIERS,
} from "../src/index.js";

describe("slugifyAgentName", () => {
  it("lowercases, hyphenates, and strips junk", () => {
    expect(slugifyAgentName("Perf Reviewer")).toBe("perf-reviewer");
    expect(slugifyAgentName("  Code__Reviewer!! ")).toBe("code__reviewer");
    expect(slugifyAgentName("API Contract / Reviewer")).toBe("api-contract-reviewer");
  });
  it("collapses repeats and trims edge hyphens", () => {
    expect(slugifyAgentName("--a   b--")).toBe("a-b");
  });
  it("caps at 64 chars", () => {
    expect(slugifyAgentName("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });
  it("returns empty for non-alphanumeric input", () => {
    expect(slugifyAgentName("!!! ???")).toBe("");
  });
});

describe("resolveAgentModel", () => {
  it("maps tier names to concrete model ids", () => {
    expect(resolveAgentModel("fast")).toBe(AGENT_MODEL_TIERS.fast);
    expect(resolveAgentModel("deep")).toBe(AGENT_MODEL_TIERS.deep);
    expect(resolveAgentModel("reasoning")).toBe(AGENT_MODEL_TIERS.reasoning);
    expect(resolveAgentModel("DEEP")).toBe(AGENT_MODEL_TIERS.deep); // case-insensitive
  });
  it("passes raw model ids through unchanged", () => {
    expect(resolveAgentModel("fugu")).toBe("fugu");
    expect(resolveAgentModel("qwen/qwen3-coder")).toBe("qwen/qwen3-coder");
  });
  it("returns undefined for undefined", () => {
    expect(resolveAgentModel(undefined)).toBeUndefined();
  });
});

describe("serializeMarkdownAgent", () => {
  it("round-trips through parseMarkdownAgent", () => {
    const md = serializeMarkdownAgent({
      name: "code-reviewer",
      description: "Reviews a diff for bugs and cleanups. Use when the user wants a review.",
      system_prompt: "You are an elite read-only code reviewer.\n\nReturn findings with file:line.",
      model: "deep",
      tools: ["Read", "Grep", "Glob", "LS"],
      max_turns: 12,
    });
    const parsed = parseMarkdownAgent("code-reviewer.md", md);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("code-reviewer");
    expect(parsed!.name).toBe("code-reviewer");
    expect(parsed!.description).toContain("Reviews a diff");
    expect(parsed!.model).toBe("deep");
    expect(parsed!.tools).toEqual(["Read", "Grep", "Glob", "LS"]);
    expect(parsed!.max_turns).toBe(12);
    expect(parsed!.system_prompt).toContain("file:line");
  });

  it("omits optional fields cleanly when absent", () => {
    const md = serializeMarkdownAgent({
      name: "minimal",
      description: "A minimal agent with only required fields present here.",
      system_prompt: "Do the thing and report back.",
    });
    expect(md).not.toContain("model:");
    expect(md).not.toContain("tools:");
    expect(md).not.toContain("max_turns:");
    const parsed = parseMarkdownAgent("minimal.md", md);
    expect(parsed).not.toBeNull();
    expect(parsed!.model).toBeUndefined();
    expect(parsed!.tools).toBeUndefined();
  });

  it("survives a description with colons and quotes (single-line, quote-safe)", () => {
    const tricky = 'Reviews: APIs with "breaking" changes — versioning: semver.';
    const md = serializeMarkdownAgent({
      name: "api-reviewer",
      description: tricky,
      system_prompt: "Review the API contract.",
    });
    const parsed = parseMarkdownAgent("api-reviewer.md", md);
    expect(parsed).not.toBeNull();
    // colon preserved, interior double-quotes swapped to single, single line
    expect(parsed!.description).toContain("versioning: semver");
    expect(parsed!.description).not.toContain("\n");
  });

  it("collapses a multi-line description to one line", () => {
    const md = serializeMarkdownAgent({
      name: "multi",
      description: "line one\nline two\nline three of the description here.",
      system_prompt: "Body.",
    });
    const parsed = parseMarkdownAgent("multi.md", md);
    expect(parsed!.description).toBe("line one line two line three of the description here.");
  });

  it("a display name with trailing punctuation parses to a clean slug id matching the slugifier", () => {
    const display = "Perf Reviewer!";
    const slug = slugifyAgentName(display); // "perf-reviewer"
    const md = serializeMarkdownAgent({
      name: display,
      description: "An agent whose display name has trailing punctuation, to test id stability.",
      system_prompt: "Read-only. Report findings.",
    });
    const parsed = parseMarkdownAgent(`${slug}.md`, md);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(slug); // id derived from name === slug derived from name
    expect(parsed!.name).toBe(display); // display name preserved verbatim
    expect(parsed!.id.endsWith("-")).toBe(false);
  });

  it("throws on missing required fields", () => {
    expect(() => serializeMarkdownAgent({ name: "", description: "d", system_prompt: "s" })).toThrow();
    expect(() => serializeMarkdownAgent({ name: "n", description: "", system_prompt: "s" })).toThrow();
    expect(() => serializeMarkdownAgent({ name: "n", description: "d", system_prompt: "" })).toThrow();
  });

  it("floors a fractional max_turns and drops non-positive ones", () => {
    const md = serializeMarkdownAgent({
      name: "frac",
      description: "An agent used to test max_turns flooring behavior here.",
      system_prompt: "Body.",
      max_turns: 9.8,
    });
    expect(parseMarkdownAgent("frac.md", md)!.max_turns).toBe(9);

    const md2 = serializeMarkdownAgent({
      name: "zero",
      description: "An agent used to test non-positive max_turns dropping here.",
      system_prompt: "Body.",
      max_turns: 0,
    });
    expect(md2).not.toContain("max_turns:");
  });
});
