import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/index.js";

describe("InMemoryStore", () => {
  it("assigns an id on set and retrieves by it", async () => {
    const m = new InMemoryStore();
    const r = await m.set({
      key: "k", value: "v",
      created_at: 0, last_accessed_at: 0,
    });
    expect(r.id).toBeTruthy();
    const got = await m.get(r.id);
    expect(got?.value).toBe("v");
  });

  it("respects an explicit id", async () => {
    const m = new InMemoryStore();
    const r = await m.set({
      id: "fixed",
      key: "k", value: "v",
      created_at: 0, last_accessed_at: 0,
    });
    expect(r.id).toBe("fixed");
  });

  it("filters by tenant_id", async () => {
    const m = new InMemoryStore();
    await m.set({
      key: "k", value: "a", tenant_id: "t1",
      created_at: 0, last_accessed_at: 0,
    });
    await m.set({
      key: "k", value: "b", tenant_id: "t2",
      created_at: 0, last_accessed_at: 0,
    });
    const results = await m.query({ tenant_id: "t1" });
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe("a");
  });

  it("filters by exact key", async () => {
    const m = new InMemoryStore();
    await m.set({
      key: "alpha", value: "1",
      created_at: 0, last_accessed_at: 0,
    });
    await m.set({
      key: "beta", value: "2",
      created_at: 0, last_accessed_at: 0,
    });
    const results = await m.query({ key: "beta" });
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe("2");
  });

  it("filters by tags (any-match)", async () => {
    const m = new InMemoryStore();
    await m.set({
      key: "k", value: "a", tags: ["red", "blue"],
      created_at: 0, last_accessed_at: 0,
    });
    await m.set({
      key: "k", value: "b", tags: ["green"],
      created_at: 0, last_accessed_at: 0,
    });
    const reds = await m.query({ tags: ["red"] });
    expect(reds).toHaveLength(1);
    expect(reds[0].value).toBe("a");
  });

  it("semantic_query is a substring fallback", async () => {
    const m = new InMemoryStore();
    await m.set({
      key: "k", value: "the quick brown fox",
      created_at: 0, last_accessed_at: 0,
    });
    await m.set({
      key: "k", value: "lazy dog",
      created_at: 0, last_accessed_at: 0,
    });
    const r = await m.query({ semantic_query: "brown" });
    expect(r).toHaveLength(1);
    expect(r[0].value).toContain("brown");
  });

  it("respects limit", async () => {
    const m = new InMemoryStore();
    for (let i = 0; i < 5; i++) {
      await m.set({
        key: "k", value: String(i),
        created_at: i, last_accessed_at: i,
      });
    }
    const r = await m.query({ limit: 2 });
    expect(r).toHaveLength(2);
  });

  it("delete removes a record", async () => {
    const m = new InMemoryStore();
    const r = await m.set({
      key: "k", value: "v",
      created_at: 0, last_accessed_at: 0,
    });
    await m.delete(r.id);
    expect(await m.get(r.id)).toBeUndefined();
  });

  it("get() bumps last_accessed_at", async () => {
    const m = new InMemoryStore();
    const r = await m.set({
      key: "k", value: "v",
      created_at: 1, last_accessed_at: 1,
    });
    const before = r.last_accessed_at;
    // Wait a tick so the timestamp can advance.
    await new Promise((res) => setTimeout(res, 2));
    await m.get(r.id);
    const after = (await m.get(r.id))!.last_accessed_at;
    expect(after).toBeGreaterThan(before);
  });
});
