// MCPClient — speaks the Model Context Protocol over streamable HTTP / SSE.
//
// MCP is an open standard for "plug an app into an agent". A user (or another
// agent) connects an MCP server URL; the client fetches its tool catalog
// (`tools/list`) and dispatches calls (`tools/call`). Tools are exposed to the
// LLM as ordinary function-call schemas namespaced `<server-slug>__<tool>`.
//
// Transport: streamable HTTP (JSON or SSE response). stdio is out of scope for
// this client — for stdio servers, run them behind an HTTP proxy.
//
// Theron SDK is model-agnostic: this client only knows how to fetch + parse
// JSON-RPC envelopes. It hands the resulting tool catalog to the Runner via
// `asTools()`, where it becomes a normal Tool[] the LLM can call.
//
// The Theron-Cloud equivalent lives in marketing/api/_lib/mcp.ts and supplies
// per-user MCP connections via KV storage. Both implementations speak the same
// wire protocol; this one ships open-core so SDK users can plug arbitrary MCP
// servers into their own agents.

import type { Tool, ToolContext, ToolSchema } from "../tools/index.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 12_000;

export interface McpServerConfig {
  /** Display label ("Linear", "GitHub", ...). */
  name: string;
  /** Stable slug used in the namespaced tool name (matches /^[a-z0-9_-]+$/). */
  slug: string;
  /** Streamable-HTTP MCP server URL. */
  url: string;
  /** Optional bearer token; sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Per-call timeout. Default 12s. */
  timeout_ms?: number;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * MCPClient — one instance per connected MCP server.
 *
 * Example:
 *   const client = new MCPClient({
 *     name: "Linear",
 *     slug: "linear",
 *     url: "https://mcp.linear.app/sse",
 *     token: process.env.LINEAR_MCP_TOKEN,
 *   });
 *   const tools = await client.asTools();
 *   // tools[0].schema.name === "linear__create_issue"
 *   await runner.run(agent, { query: "open a ticket about X", tools });
 */
export class MCPClient {
  readonly config: McpServerConfig;
  private initialized = false;
  private toolCache: McpTool[] | null = null;

  constructor(config: McpServerConfig) {
    if (!/^[a-z0-9_-]+$/.test(config.slug)) {
      throw new Error(
        `MCPClient slug "${config.slug}" must match /^[a-z0-9_-]+$/`,
      );
    }
    this.config = { timeout_ms: DEFAULT_TIMEOUT_MS, ...config };
  }

  /** Fetch the server's tool catalog. Cached for the lifetime of the client. */
  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    if (this.toolCache) return this.toolCache;
    await this.ensureInitialized(signal);
    const result = (await this.rpc("tools/list", {}, signal)) as
      | { tools?: McpTool[] }
      | undefined;
    this.toolCache = Array.isArray(result?.tools) ? result!.tools : [];
    return this.toolCache;
  }

  /** Call a tool by its bare (non-namespaced) name. Returns the text payload. */
  async callTool(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<string> {
    await this.ensureInitialized(signal);
    const result = (await this.rpc(
      "tools/call",
      { name, arguments: args },
      signal,
    )) as { content?: Array<{ type: string; text?: string }> } | undefined;
    const blocks = Array.isArray(result?.content) ? result!.content : [];
    const text = blocks
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || JSON.stringify(result ?? {}).slice(0, 4000);
  }

  /**
   * Return the server's tool catalog as SDK Tool[] objects, namespaced so they
   * compose with tools from other sources without colliding.
   *
   * Pass these directly to a Runner. The Runner sees standard SDK tools; it
   * never has to know MCP existed.
   */
  async asTools(signal?: AbortSignal): Promise<Tool[]> {
    const raw = await this.listTools(signal);
    return raw.map((t) => this.toSdkTool(t));
  }

  /** Health-check: returns toolCount on success, throws on failure. */
  async probe(signal?: AbortSignal): Promise<{ toolCount: number }> {
    const tools = await this.listTools(signal);
    return { toolCount: tools.length };
  }

  // -------------------------------------------------------------- internals

  private toSdkTool(raw: McpTool): Tool {
    const ns = `${this.config.slug}__${raw.name}`
      .slice(0, 64)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const schema: ToolSchema = {
      name: ns,
      description: `[${this.config.name}] ${raw.description || raw.name}`,
      input_schema:
        (raw.inputSchema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
    };
    const client = this;
    return {
      schema,
      async execute(input: unknown, _ctx: ToolContext): Promise<string> {
        return client.callTool(raw.name, input);
      },
    };
  }

  private async ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    await this.rpc(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "theron-agent-sdk", version: "0.1" },
      },
      signal,
    );
    // notifications/initialized is fire-and-forget per spec.
    this.rpc("notifications/initialized", {}, signal).catch(() => undefined);
    this.initialized = true;
  }

  private async rpc(
    method: string,
    params: unknown,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      this.config.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    );
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort();
      else externalSignal.addEventListener("abort", () => ac.abort());
    }
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now() + Math.floor(Math.random() * 1000),
      method,
      params,
    };
    try {
      const r = await fetch(this.config.url, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.config.token
            ? { Authorization: `Bearer ${this.config.token}` }
            : {}),
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        throw new Error(
          `mcp http ${r.status} on ${method}: ${errText.slice(0, 200)}`,
        );
      }
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("text/event-stream")) {
        const text = await r.text();
        const m = text.match(/data:\s*(\{[\s\S]*?\})\s*\n/);
        if (!m) throw new Error("mcp sse stream had no data event");
        const env = JSON.parse(m[1]) as JsonRpcResponse;
        if (env.error) throw new Error(`mcp error: ${env.error.message}`);
        return env.result;
      }
      const env = (await r.json()) as JsonRpcResponse;
      if (env.error) throw new Error(`mcp error: ${env.error.message}`);
      return env.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Combine multiple MCP clients into a single namespaced Tool[]. Use when an
 * agent should see every tool from every connected server in one call.
 *
 *   const tools = await collectMcpTools([github, postgres, docker]);
 *   await runner.run(agent, { query, tools });
 */
export async function collectMcpTools(
  clients: MCPClient[],
  signal?: AbortSignal,
): Promise<Tool[]> {
  const lists = await Promise.all(
    clients.map(async (c) => {
      try {
        return await c.asTools(signal);
      } catch (err) {
        console.warn(`[mcp] ${c.config.slug} listTools failed:`, err);
        return [] as Tool[];
      }
    }),
  );
  return lists.flat();
}
