import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVextAdapter } from "../src/adapters/vext.js";
import { Agent, Runner, defineTool, zod as z, type ModelAdapter } from "../src/index.js";

type WireToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string } };
type WireMessage = { role: string; content: unknown; tool_calls?: WireToolCall[]; tool_call_id?: string };
type WireBody = {
  model: string;
  messages: WireMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  max_tokens?: number;
  temperature?: number;
  tools?: unknown[];
};

const CALL_ID = "call_upstream_abc123";

/** Mirrors an OpenAI-style server's validation of tool-call ids. */
function validate(body: WireBody): string | null {
  const open = new Set<string>();
  for (const m of body.messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (typeof tc.id !== "string" || tc.id === "") return "Missing parameter 'tool_calls[].id'";
        if (tc.type !== "function") return "Missing parameter 'tool_calls[].type'";
        open.add(tc.id);
      }
    }
    if (m.role === "tool") {
      if (typeof m.tool_call_id !== "string" || m.tool_call_id === "") {
        return "Missing parameter 'tool_call_id'";
      }
      if (!open.has(m.tool_call_id)) {
        return "Invalid parameter: messages with role 'tool' must be a response to a preceding message with 'tool_calls'";
      }
    }
  }
  return null;
}

function sse(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}

function strictServer() {
  const bodies: WireBody[] = [];
  const urls: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      urls.push(req.url ?? "");
      const body = JSON.parse(raw) as WireBody;
      bodies.push(body);
      const problem = validate(body);
      if (problem) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: problem, type: "invalid_request_error" } }));
        return;
      }
      const hasToolResult = body.messages.some((m) => m.role === "tool");
      if (body.stream) {
        if (!hasToolResult) {
          sse(res, [
            { choices: [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: CALL_ID, type: "function", function: { name: "add", arguments: "" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":2,' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
          ]);
        } else {
          sse(res, [
            { choices: [{ delta: { role: "assistant", content: "The sum " } }] },
            { choices: [{ delta: { content: "is 5." } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
          ]);
        }
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          hasToolResult
            ? {
                choices: [{ message: { role: "assistant", content: "The sum is 5." }, finish_reason: "stop" }],
                usage: { prompt_tokens: 20, completion_tokens: 5 },
              }
            : {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [{ id: CALL_ID, type: "function", function: { name: "add", arguments: '{"a":2,"b":3}' } }],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 4 },
              },
        ),
      );
    });
  });
  return new Promise<{ origin: string; bodies: WireBody[]; urls: string[]; close: () => Promise<void> }>(
    (resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          origin: `http://127.0.0.1:${port}`,
          bodies,
          urls,
          close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        });
      });
    },
  );
}

function addAgent() {
  const add = defineTool({
    name: "add",
    description: "Add two numbers",
    input: z.object({ a: z.number(), b: z.number() }),
    execute: async ({ a, b }) => ({ sum: a + b }),
  });
  return new Agent({ name: "calc", instruction: "Use the add tool.", tools: [add] });
}

/** The Runner always streams; drop onDelta to drive the adapter's non-stream path. */
function nonStreaming(inner: ModelAdapter): ModelAdapter {
  return { name: inner.name, chat: ({ onDelta: _onDelta, ...rest }) => inner.chat(rest) };
}

const savedVext = process.env.VEXT_BASE_URL;
const savedTheron = process.env.THERON_BASE_URL;
beforeEach(() => {
  delete process.env.VEXT_BASE_URL;
  delete process.env.THERON_BASE_URL;
});
afterEach(() => {
  if (savedVext === undefined) delete process.env.VEXT_BASE_URL;
  else process.env.VEXT_BASE_URL = savedVext;
  if (savedTheron === undefined) delete process.env.THERON_BASE_URL;
  else process.env.THERON_BASE_URL = savedTheron;
});

describe("tool calls against a strict OpenAI-style server", () => {
  it.each([
    ["stream", true],
    ["non-stream", false],
  ])("completes a two-turn tool run with ids carried end to end (%s)", async (_label, stream) => {
    const srv = await strictServer();
    try {
      const adapter = createVextAdapter({ baseURL: `${srv.origin}/v1`, apiKey: "k" });
      const runner = new Runner({ model: stream ? adapter : nonStreaming(adapter), default_model: "m" });
      const result = await runner.run(addAgent(), "What is 2+3?");

      expect(result.output).toBe("The sum is 5.");
      expect(result.tool_calls).toEqual([{ name: "add", input: { a: 2, b: 3 }, output: { sum: 5 } }]);
      expect(result.tokens_used).toEqual({ input: 30, output: 9 });
      expect(srv.bodies).toHaveLength(2);
      expect(srv.bodies.every((b) => b.stream === stream)).toBe(true);

      const second = srv.bodies[1].messages;
      const assistant = second.find((m) => m.role === "assistant");
      expect(assistant).toEqual({
        role: "assistant",
        content: null,
        tool_calls: [{ id: CALL_ID, type: "function", function: { name: "add", arguments: '{"a":2,"b":3}' } }],
      });
      const tool = second.find((m) => m.role === "tool");
      expect(tool).toEqual({ role: "tool", content: '{"sum":5}', tool_call_id: CALL_ID });
    } finally {
      await srv.close();
    }
  });

  it.each([
    ["stream", true],
    ["non-stream", false],
  ])("the strict server rejects a tool message without tool_call_id (%s)", async (_label, stream) => {
    const srv = await strictServer();
    try {
      const adapter = createVextAdapter({ baseURL: srv.origin });
      const err = await adapter
        .chat({
          model: "m",
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "", tool_calls: [{ id: CALL_ID, name: "add", input: {} }] },
            { role: "tool", content: "{}" } as never,
          ],
          ...(stream ? { onDelta: () => {} } : {}),
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("400");
      expect((err as Error).message).toContain("Missing parameter 'tool_call_id'");
    } finally {
      await srv.close();
    }
  });

  it("synthesizes matching ids when the adapter reports none", async () => {
    const seen: Parameters<ModelAdapter["chat"]>[0]["messages"][] = [];
    let n = 0;
    const adapter: ModelAdapter = {
      name: "no-ids",
      async chat({ messages }) {
        seen.push(structuredClone(messages));
        n += 1;
        return n === 1
          ? { content: "", tool_calls: [{ name: "add", input: { a: 1, b: 1 } }, { name: "add", input: { a: 2, b: 2 } }], tokens: { input: 0, output: 0 } }
          : { content: "done", tokens: { input: 0, output: 0 } };
      },
    };
    const result = await new Runner({ model: adapter, default_model: "m" }).run(addAgent(), "go");
    expect(result.output).toBe("done");
    const msgs = seen[1];
    const assistant = msgs.find((m) => m.role === "assistant");
    const ids = assistant && assistant.role === "assistant" ? assistant.tool_calls?.map((c) => c.id) : [];
    expect(ids).toEqual(["call_0_0", "call_0_1"]);
    const toolIds = msgs.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : []));
    expect(toolIds).toEqual(["call_0_0", "call_0_1"]);
  });
});
