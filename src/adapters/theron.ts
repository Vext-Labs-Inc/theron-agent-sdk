/**
 * Theron ModelAdapter — first-class, built-in. Drives the Vext-hosted Theron
 * council so agents you build with this SDK run on Theron's substrate (the
 * trained specialists + verifier kernels), not a single foundation model.
 *
 *   import { Agent, Runner, theronAdapter } from "@vextlabs/theron-agent-sdk";
 *
 *   const runner = new Runner({
 *     model: theronAdapter({ apiKey: process.env.THERON_API_KEY }),
 *     default_model: "theron-council",
 *   });
 *
 * Talks to the OpenAI-compatible council endpoint
 * (`<base>/api/v1/chat/completions`), so tool-calling and streaming work the
 * same way they do for the OpenAI/OpenRouter reference adapters — unlike the
 * older phased-SSE example, which could not call tools.
 */
import type { ModelAdapter } from "../runtime/index.js";
import { resolveJuwelToken } from "./juwel_auth.js";

const DEFAULT_BASE = "https://itstheron.com";

/** Exact origins that may receive the implicit account token. Do not add hosts. */
const IMPLICIT_TOKEN_ORIGINS = new Set<string>([new URL(DEFAULT_BASE).origin]);

function allowsImplicitToken(base: string): boolean {
  try {
    return IMPLICIT_TOKEN_ORIGINS.has(new URL(base).origin);
  } catch {
    return false;
  }
}

export interface TheronAdapterOptions {
  /** Endpoint base. Defaults to the hosted council at itstheron.com. */
  base?: string;
  /** Vext / Theron bearer key. Optional for free-tier LLM caps; required for
   *  anything privileged. When set, it takes precedence over `tokenProvider`. */
  apiKey?: string;
  /** Async bearer resolver, used only when `apiKey` is absent. When omitted,
   *  `resolveJuwelToken` (JUWEL_TOKEN env, then ~/.juwel/config.json) runs only
   *  if the effective base origin is the default hosted origin. A custom `base`
   *  does not receive that implicit token. Pass `apiKey` or `tokenProvider` to
   *  authenticate any other base. Return undefined for no auth header. */
  tokenProvider?: () => Promise<string | undefined>;
  /** Council mode: "fast" (cheaper cascade) or "full" (deep). Default "fast". */
  councilMode?: "fast" | "full";
}

/** Build a first-class Theron adapter. Alias: `theron`. */
export function theronAdapter(opts: TheronAdapterOptions = {}): ModelAdapter {
  const base = (opts.base ?? DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/api/v1/chat/completions`;
  const councilMode = opts.councilMode ?? "fast";
  const tokenProvider = opts.tokenProvider ?? (allowsImplicitToken(base) ? resolveJuwelToken : undefined);

  return {
    name: "theron",
    async chat({ model, messages, tools, max_tokens, temperature, onDelta }) {
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
      // Resolution order: explicit apiKey > explicit tokenProvider > implicit
      // account token on the default origin only > anonymous (no auth header).
      // A static apiKey never triggers the provider.
      let bearer = opts.apiKey;
      if (!bearer && tokenProvider) {
        try { bearer = await tokenProvider(); } catch { /* stay anonymous */ }
      }
      if (bearer) headers.Authorization = `Bearer ${bearer}`;

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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
