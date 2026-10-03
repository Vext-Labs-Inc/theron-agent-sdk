import { describe, it, expect } from "vitest";
import {
  findToken,
  replaceToken,
  insertSigil,
  filterPalette,
  rewriteSkills,
  isDestructive,
} from "../src/index.js";

describe("composer.findToken (bug #2 — mid-message detection)", () => {
  it("detects a leading /token", () => {
    const t = findToken("/fact", 5)!;
    expect(t).toMatchObject({ sigil: "/", query: "fact", start: 0, end: 5 });
  });
  it("detects a MID-MESSAGE /token after a space (the bug)", () => {
    const t = findToken("hello /fac", 10)!;
    expect(t).toMatchObject({ sigil: "/", query: "fac", start: 6 });
  });
  it("does NOT match a slash inside a word or URL", () => {
    expect(findToken("and/or", 6)).toBeNull();
    expect(findToken("see http://x", 12)).toBeNull();
  });
  it("token ends at whitespace (no spanning)", () => {
    expect(findToken("/fact world", 11)).toBeNull(); // cursor past the space
  });
  it("also detects @ tokens", () => {
    expect(findToken("ping @ali", 9)!).toMatchObject({ sigil: "@", query: "ali" });
  });
});

describe("composer.replaceToken (bug #3 — preserve surrounding text)", () => {
  it("replaces only the token span, keeping text on both sides", () => {
    const text = "hello /fac world";
    const tok = findToken(text.slice(0, 10), 10)!; // token "/fac" at 6..10
    const out = replaceToken(text, tok, "fact-check");
    expect(out.text).toBe("hello /fact-check  world");
    expect(out.text.slice(0, out.cursor)).toBe("hello /fact-check ");
  });
});

describe("composer.insertSigil (bug #1 — never clobber typed text)", () => {
  it("inserts a slash at the cursor, preserving input", () => {
    const out = insertSigil("hello world", 11, "/");
    expect(out.text).toBe("hello world /");
    expect(out.cursor).toBe(13);
  });
  it("does not double-space when already after whitespace", () => {
    expect(insertSigil("hi ", 3, "/").text).toBe("hi /");
  });
});

describe("composer.filterPalette", () => {
  const items = [
    { name: "fact-check", description: "verify a claim" },
    { name: "format", description: "tidy code" },
    { name: "review", description: "fact review of a PR" },
  ];
  it("ranks prefix over substring over description", () => {
    const r = filterPalette(items, "fact");
    expect(r.map((x) => x.name)).toEqual(["fact-check", "review"]);
  });
  it("empty query keeps order", () => {
    expect(filterPalette(items, "").length).toBe(3);
  });
});

describe("composer.rewriteSkills (bug #4 — leading OR mid-message)", () => {
  const skills = [{ name: "fact-check", body: "Verify every claim with a source.", allowedTools: ["WebSearch"] }];
  it("rewrites a leading /skill", () => {
    const r = rewriteSkills("/fact-check the moon landing", skills);
    expect(r.text).toContain("Verify every claim");
    expect(r.text).toContain("the moon landing");
    expect(r.injected).toEqual(["fact-check"]);
    expect(r.pills[0]).toMatchObject({ kind: "skill", token: "fact-check" });
  });
  it("rewrites a MID-MESSAGE /skill (the bug the server missed)", () => {
    const r = rewriteSkills("please /fact-check this", skills);
    expect(r.text).toContain("Verify every claim");
    expect(r.injected).toEqual(["fact-check"]);
  });
  it("leaves unknown /commands untouched", () => {
    const r = rewriteSkills("/unknown thing", skills);
    expect(r.text).toBe("/unknown thing");
    expect(r.injected).toEqual([]);
  });
  it("includes the tool-preference note", () => {
    expect(rewriteSkills("/fact-check x", skills).text).toContain("Prefer these tools: WebSearch");
  });
});

describe("composer.isDestructive (bug #6 — guard chat reset)", () => {
  it("flags clear/new/reset, with or without slash", () => {
    expect(isDestructive("/clear")).toBe(true);
    expect(isDestructive("new")).toBe(true);
    expect(isDestructive("reset")).toBe(true);
    expect(isDestructive("help")).toBe(false);
  });
});
