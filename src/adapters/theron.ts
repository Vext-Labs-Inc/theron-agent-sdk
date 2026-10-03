/**
 * Theron ModelAdapter. Bring your own endpoint (any OpenAI-compatible URL).
 *
 * There is no hosted default. Pass `baseURL` (or the existing `base` option),
 * or set `THERON_BASE_URL`. When none of those is set, `chat` throws
 * {@link MissingBaseURLError} before any network call.
 *
 *   import { Agent, Runner, theronAdapter } from "@vextlabs/theron-agent-sdk";
 *
 *   const runner = new Runner({
 *     model: theronAdapter({
 *       baseURL: "https://your-endpoint.example",
 *       apiKey: process.env.THERON_API_KEY,
 *     }),
 *     default_model: "theron-council",
 *   });
 *
 * Talks to `<base>/api/v1/chat/completions`, so tool-calling and streaming work
 * the same way they do for the OpenAI/OpenRouter reference adapters.
 */
import type { ModelAdapter } from "../runtime/index.js";
import { resolveJuwelToken } from "./juwel_auth.js";

/**
 * Origins that may receive the implicit account token (`JUWEL_TOKEN` or
 * `~/.juwel/config.json`). Empty on purpose: that token is never attached.
 * An explicit `apiKey` or `tokenProvider` is still sent to the caller base.
 */
const IMPLICIT_TOKEN_ORIGINS = new Set<string>();

const MISSING_BASE_URL_MESSAGE = "No hosted default endpoint; pass baseURL";

/** Thrown when a chat call has no base option and no `THERON_BASE_URL`. */
export class MissingBaseURLError extends Error {
  constructor() {
    super(MISSING_BASE_URL_MESSAGE);
    this.name = "MissingBaseURLError";
  }
}

function allowsImplicitToken(base: string): boolean {
  try {
    return IMPLICIT_TOKEN_ORIGINS.has(new URL(base).origin);
  } catch {
    return false;
  }
}

function configured(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * `baseURL`, then `base`, then `THERON_BASE_URL`.
 * Read at call time so an env var set after construction is visible.
 */
function resolveBase(opts: TheronAdapterOptions): string {
  const explicit =
    configured(opts.baseURL) ??
    configured(opts.base) ??
    configured(process.env.THERON_BASE_URL);
  if (!explicit) throw new MissingBaseURLError();
  return explicit.replace(/\/$/, "");
}

export interface TheronAdapterOptions {
  /**
   * Endpoint origin. Requests are sent to `<baseURL>/api/v1/chat/completions`.
   * Required unless `base` or `THERON_BASE_URL` is set. Wins over both.
   */
  baseURL?: string;
  /**
   * Endpoint base. Same role as `baseURL`. Used when `baseURL` is unset, and
   * still ahead of `THERON_BASE_URL`.
   */
  base?: string;
  /** Bearer key. When set, it takes precedence over `tokenProvider`. */
  apiKey?: string;
  /**
   * Async bearer resolver, used only when `apiKey` is absent. When omitted,
   * no implicit account token is attached: the allow-origin set is empty, so
   * `JUWEL_TOKEN` and `~/.juwel/config.json` are not sent anywhere. Pass
   * `apiKey` or `tokenProvider` (for example {@link resolveJuwelToken}) to
   * authenticate the caller-supplied base. Return undefined for no auth header.
   */
  tokenProvider?: () => Promise<string | undefined>;
  /** Council mode: "fast" (cheaper cascade) or "full" (deep). Default "fast". */
  councilMode?: "fast" | "full";
}

/** Build a first-class Theron adapter. Alias: `theron`. */
export function theronAdapter(opts: TheronAdapterOptions = {}): ModelAdapter {
  const councilMode = opts.councilMode ?? "fast";

  return {
    name: "theron",
    async chat({ model, messages, tools, max_tokens, temperature, onDelta }) {
      const base = resolveBase(opts);
      const url = `${base}/api/v1/chat/completions`;
      const tokenProvider = opts.tokenProvider ?? (allowsImplicitToken(base) ? resolveJuwelToken : undefined);

      const body: Record<string, unknown> = {
        model: model || "theron-council",
        council_mode: councilMode,
        messages,
        max_tokens: max_tokens ?? 2048,
        temperature: temperature ?? 0.2,
        stream: !!onDelta,
      };
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
      // or `manual`, so `error` is supported there. `follow` forwards
      // Authorization across hosts (page updated 2026-07-02):
      // https://developers.cloudflare.com/workers/runtime-apis/request/
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
      });
      if (!res.ok) {
        throw new Error(`Theron ${res.status} (${url}): ${(await res.text().catch(() => "")).slice(0, 500)}`);
      }

      // Streaming path — OpenAI-style SSE deltas.
      if (onDelta && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let buf = "";
        const toolAcc: Record<number, { name: string; args: string }> = {};
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
                for (const tc of d.tool_calls as Array<{ index?: number; function?: { name?: string; arguments?: string } }>) {
                  const i = typeof tc.index === "number" ? tc.index : 0;
                  (toolAcc[i] ??= { name: "", args: "" });
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
          ? Object.values(toolAcc).map((t) => ({ name: t.name, input: safeJson(t.args) }))
          : undefined;
        return { content, tool_calls, tokens: { input: inputTokens, output: outputTokens } };
      }

      // Non-streaming path.
      const json = (await res.json()) as {
        choices: Array<{
          message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = json.choices?.[0]?.message ?? { content: "" };
      const tool_calls = msg.tool_calls?.map((tc) => ({
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

/** Convenience alias matching the docs voice (`theron({...})`). */
export const theron = theronAdapter;

// Re-export the JUWEL token provider so consumers of the `./adapters/theron`
// subpath can supply / inspect the default `tokenProvider`.
export { resolveJuwelToken } from "./juwel_auth.js";

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
