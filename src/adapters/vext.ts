/**
 * Vext model adapter.
 *
 * `baseURL` is the OpenAI-style API root. `chat` POSTs to
 * `<baseURL>/chat/completions` after stripping trailing slashes from the path.
 * A `?query` or `#fragment` on the base is kept after the appended path, so
 * `https://x.example/openai/v1?api-version=1` posts to
 * `https://x.example/openai/v1/chat/completions?api-version=1`.
 * `https://api.openai.com/v1` posts to `https://api.openai.com/v1/chat/completions`.
 * An Ollama server uses `http://127.0.0.1:11434/v1`, which posts to
 * `http://127.0.0.1:11434/v1/chat/completions`.
 *
 * There is no hosted default. Pass `baseURL`, or set `VEXT_BASE_URL`
 * (`THERON_BASE_URL` is a deprecated fallback used only when `VEXT_BASE_URL`
 * is unset). When none of those is set, `chat` throws {@link MissingBaseURLError}
 * before any network call.
 *
 * Set `baseURL` together with `apiKey`. If `baseURL` is omitted, `VEXT_BASE_URL`
 * (or `THERON_BASE_URL`) is the host that receives the key.
 *
 *   import { Agent, Runner, createVextAdapter } from "@vextlabs/sdk";
 *
 *   const runner = new Runner({
 *     model: createVextAdapter({
 *       baseURL: "https://api.openai.com/v1",
 *       apiKey: process.env.VEXT_API_KEY,
 *     }),
 *     default_model: "gpt-4o-mini",
 *   });
 *
 * `model` is required. `council_mode` is sent only when `councilMode` is set.
 * `max_tokens` and `temperature` are sent only when passed to `chat`; there are
 * no SDK defaults, so the server's defaults apply. Streaming requests also send
 * `stream_options: { include_usage: true }` so token usage is reported.
 *
 * Tool calls keep the upstream `id` from both streamed and non-streamed
 * responses. Assistant turns are sent back with their `tool_calls`, and each
 * tool result is sent with its `tool_call_id`.
 */
import type { ModelMessage, ModelToolCall, ModelAdapter } from "../runtime/index.js";
import { MissingBaseURLError } from "../errors.js";

export { MissingBaseURLError } from "../errors.js";

const MISSING_MODEL_MESSAGE = "Missing model; pass model";

function configured(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnv(name: string): string | undefined {
  const proc = globalThis.process as { env?: Record<string, string | undefined> } | undefined;
  if (typeof proc === "undefined" || proc === null) return undefined;
  const env = proc.env;
  if (typeof env !== "object" || env === null) return undefined;
  const value = env[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * `baseURL`, then deprecated `base`, then `VEXT_BASE_URL`, then `THERON_BASE_URL`.
 * Read at call time so env set after construction is visible.
 */
function resolveBase(opts: VextAdapterOptions): string {
  const explicit =
    configured(opts.baseURL) ??
    configured(opts.base) ??
    configured(readEnv("VEXT_BASE_URL")) ??
    configured(readEnv("THERON_BASE_URL"));
  if (!explicit) throw new MissingBaseURLError();
  return explicit;
}

/**
 * Append `/chat/completions` to the base's path, keeping any `?query` or
 * `#fragment` (for example Azure's `?api-version=`) after it. Done on the raw
 * string rather than through `URL` so the caller's spelling is sent as given.
 */
function chatCompletionsURL(base: string): string {
  const cut = base.search(/[?#]/);
  const head = cut === -1 ? base : base.slice(0, cut);
  const tail = cut === -1 ? "" : base.slice(cut);
  return `${head.replace(/\/+$/, "")}/chat/completions${tail}`;
}

type WireMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; content: string; tool_call_id: string };

function toWire(messages: ModelMessage[]): WireMessage[] {
  return messages.map((m): WireMessage => {
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content === "" ? null : m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        })),
      };
    }
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
    return { role: m.role, content: m.content };
  });
}

/** The adapter instance returned by {@link createVextAdapter}. */
export type VextAdapter = ModelAdapter;

export interface VextAdapterOptions {
  /**
   * OpenAI-style API root. `chat` POSTs to `<baseURL>/chat/completions`
   * (trailing slashes on the path are stripped first; a `?query` or
   * `#fragment` is kept after the appended path).
   * `https://api.openai.com/v1` becomes `https://api.openai.com/v1/chat/completions`.
   * `http://127.0.0.1:11434/v1` becomes `http://127.0.0.1:11434/v1/chat/completions`.
   * Required unless `VEXT_BASE_URL` or the deprecated `THERON_BASE_URL` is set.
   * Set this together with `apiKey`; otherwise the env base decides where the key goes.
   */
  baseURL?: string;
  /**
   * @deprecated Use `baseURL`. Applied only when `baseURL` is unset, and still
   * ahead of `VEXT_BASE_URL`.
   */
  base?: string;
  /**
   * Bearer key. When set, it takes precedence over `tokenProvider`.
   * Set `baseURL` alongside this key. If `baseURL` is omitted, `VEXT_BASE_URL`
   * (then `THERON_BASE_URL`) decides which host receives it.
   */
  apiKey?: string;
  /**
   * Async bearer resolver, used only when `apiKey` is absent. When omitted,
   * no account token is attached. Pass `apiKey` or `tokenProvider` (for example
   * {@link resolveJuwelToken}) to authenticate the caller-supplied base.
   * Return undefined for no auth header.
   */
  tokenProvider?: () => Promise<string | undefined>;
  /**
   * Optional council mode, `"fast"` or `"full"`. Omitted from the request body
   * unless the caller sets it. There is no default.
   */
  councilMode?: "fast" | "full";
}

/** @deprecated Use {@link VextAdapterOptions}. */
export type TheronAdapterOptions = VextAdapterOptions;

/** Build a Vext adapter. `baseURL` is the OpenAI-style API root; requests go to `<baseURL>/chat/completions`. */
export function createVextAdapter(opts: VextAdapterOptions = {}): VextAdapter {
  return {
    name: "vext",
    async chat({ model, messages, tools, max_tokens, temperature, onDelta }) {
      const base = resolveBase(opts);
      if (typeof model !== "string" || model.trim() === "") {
        throw new Error(MISSING_MODEL_MESSAGE);
      }
      const url = chatCompletionsURL(base);
      const tokenProvider = opts.tokenProvider;

      // max_tokens and temperature are sent only when the caller sets them,
      // so the server's own defaults apply otherwise.
      const body: Record<string, unknown> = {
        model,
        messages: toWire(messages),
        stream: !!onDelta,
      };
      if (onDelta) body.stream_options = { include_usage: true };
      if (max_tokens !== undefined) body.max_tokens = max_tokens;
      if (temperature !== undefined) body.temperature = temperature;
      if (opts.councilMode) body.council_mode = opts.councilMode;
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        }));
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Resolution order: explicit apiKey > explicit tokenProvider > no auth.
      // The implicit account token is not a step in that order.
      let bearer = opts.apiKey;
      if (!bearer && tokenProvider) {
        try { bearer = await tokenProvider(); } catch { /* stay anonymous */ }
      }
      if (bearer) headers.Authorization = `Bearer ${bearer}`;

      // `redirect: "error"` refuses to follow a 3xx, including under fetch
      // polyfills whose default is to follow and replay Authorization.
      // Cloudflare Workers documents Request redirect as `follow`, `error`,
      // or `manual`, so `error` is supported there:
      // https://developers.cloudflare.com/workers/runtime-apis/request/
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
      });
      if (!res.ok) {
        throw new Error(`Vext ${res.status} (${url}): ${(await res.text().catch(() => "")).slice(0, 500)}`);
      }

      // Streaming path. OpenAI-style SSE deltas.
      if (onDelta && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let buf = "";
        const toolAcc: Record<number, { id?: string; name: string; args: string }> = {};
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const d = json.choices?.[0]?.delta;
              const delta = d?.content;
              if (delta) {
                onDelta(delta);
                content += delta;
              }
              // Accumulate streamed tool_calls (OpenAI sends them as indexed fragments). Without this,
              // every tool-using agent is broken: the model asks to call a tool and the SDK drops it.
              if (Array.isArray(d?.tool_calls)) {
                for (const tc of d.tool_calls as Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>) {
                  const i = typeof tc.index === "number" ? tc.index : 0;
                  (toolAcc[i] ??= { name: "", args: "" });
                  if (tc.id) toolAcc[i].id = tc.id;
                  if (tc.function?.name) toolAcc[i].name = tc.function.name;
                  if (tc.function?.arguments) toolAcc[i].args += tc.function.arguments;
                }
              }
              if (json.usage) {
                inputTokens = json.usage.prompt_tokens ?? inputTokens;
                outputTokens = json.usage.completion_tokens ?? outputTokens;
              }
            } catch {
              // ignore malformed SSE line
            }
          }
        }
        const tool_calls = Object.keys(toolAcc).length
          ? Object.values(toolAcc).map((t): ModelToolCall => ({
              ...(t.id ? { id: t.id } : {}),
              name: t.name,
              input: safeJson(t.args),
            }))
          : undefined;
        return { content, tool_calls, tokens: { input: inputTokens, output: outputTokens } };
      }

      // Non-streaming path.
      const json = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = json.choices?.[0]?.message ?? { content: "" };
      const tool_calls = msg.tool_calls?.map((tc): ModelToolCall => ({
        ...(tc.id ? { id: tc.id } : {}),
        name: tc.function.name,
        input: safeJson(tc.function.arguments),
      }));
      return {
        content: msg.content ?? "",
        tool_calls,
        tokens: {
          input: json.usage?.prompt_tokens ?? 0,
          output: json.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/** Convenience alias for {@link createVextAdapter}. */
export const vext = createVextAdapter;

/** @deprecated Use {@link createVextAdapter}. Same function reference. */
export const theronAdapter = createVextAdapter;

/** @deprecated Use {@link vext}. Same function reference. */
export const theron = vext;

export { resolveJuwelToken } from "./juwel_auth.js";

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
