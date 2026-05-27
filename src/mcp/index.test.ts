// Unit tests for MCPClient. Mocks the global fetch — no live network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MCPClient, collectMcpTools } from "./index.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchHandler = (
  input: FetchInput,
  init: FetchInit,
) => Promise<Response> | Response;

const realFetch = globalThis.fetch;

function withFetch(handler: FetchHandler, fn: () => Promise<void>): Promise<void> {
  (globalThis as { fetch: typeof fetch }).fetch = handler as typeof fetch;
  return fn().finally(() => {
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  });
}

function rpcOk(result: unknown, id: number | string = 1): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("MCPClient.slug must match the safe pattern", () => {
  assert.throws(
    () =>
      new MCPClient({
        name: "Bad",
        slug: "BAD SLUG",
        url: "https://example.com/mcp",
      }),
    /must match/,
  );
});

test("MCPClient.listTools initializes then fetches the catalog", async () => {
  const calls: Array<{ method: string }> = [];
  await withFetch(
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method: string;
      };
      calls.push({ method: body.method });
      if (body.method === "initialize") return rpcOk({}, 1);
      if (body.method === "notifications/initialized") return rpcOk({}, 2);
      if (body.method === "tools/list")
        return rpcOk(
          {
            tools: [
              {
                name: "create_issue",
                description: "Open a GitHub issue.",
                inputSchema: {
                  type: "object",
                  properties: { title: { type: "string" } },
                },
              },
            ],
          },
          3,
        );
      return new Response("{}", { status: 500 });
    },
    async () => {
      const c = new MCPClient({
        name: "GitHub",
        slug: "github",
        url: "https://mcp.github.example/sse",
      });
      const tools = await c.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, "create_issue");
      assert.ok(calls.some((x) => x.method === "initialize"));
      assert.ok(calls.some((x) => x.method === "tools/list"));
    },
  );
});

test("MCPClient.asTools namespaces tool names with the slug", async () => {
  await withFetch(
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      if (body.method === "tools/list")
        return rpcOk({ tools: [{ name: "query", description: "Run SQL." }] });
      return rpcOk({});
    },
    async () => {
      const c = new MCPClient({
        name: "Postgres",
        slug: "postgres",
        url: "https://mcp.example/sse",
      });
      const tools = await c.asTools();
      assert.equal(tools[0].schema.name, "postgres__query");
      assert.match(tools[0].schema.description, /\[Postgres\]/);
    },
  );
});

test("MCPClient.callTool returns concatenated text payload", async () => {
  await withFetch(
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      if (body.method === "tools/call")
        return rpcOk({
          content: [
            { type: "text", text: "row 1" },
            { type: "text", text: "row 2" },
          ],
        });
      return rpcOk({});
    },
    async () => {
      const c = new MCPClient({
        name: "PG",
        slug: "pg",
        url: "https://mcp.example/sse",
      });
      const text = await c.callTool("query", { sql: "select 1" });
      assert.equal(text, "row 1\nrow 2");
    },
  );
});

test("MCPClient.rpc surfaces JSON-RPC errors as Error", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "method not found" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    async () => {
      const c = new MCPClient({
        name: "X",
        slug: "x",
        url: "https://mcp.example/sse",
      });
      await assert.rejects(() => c.listTools(), /method not found/);
    },
  );
});

test("MCPClient handles SSE-framed responses", async () => {
  await withFetch(
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      if (body.method === "tools/list") {
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "ping" }] },
        });
        return new Response(`data: ${payload}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return rpcOk({});
    },
    async () => {
      const c = new MCPClient({
        name: "S",
        slug: "s",
        url: "https://mcp.example/sse",
      });
      const tools = await c.listTools();
      assert.equal(tools[0].name, "ping");
    },
  );
});

test("collectMcpTools tolerates one server failing", async () => {
  const goodClient = new MCPClient({
    name: "Good",
    slug: "good",
    url: "https://good.example/sse",
  });
  const badClient = new MCPClient({
    name: "Bad",
    slug: "bad",
    url: "https://bad.example/sse",
  });
  await withFetch(
    async (input, init) => {
      const url = String(input);
      if (url.includes("bad.example"))
        throw new Error("network down");
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      if (body.method === "tools/list")
        return rpcOk({ tools: [{ name: "ok" }] });
      return rpcOk({});
    },
    async () => {
      const tools = await collectMcpTools([goodClient, badClient]);
      assert.equal(tools.length, 1);
      assert.equal(tools[0].schema.name, "good__ok");
    },
  );
});
