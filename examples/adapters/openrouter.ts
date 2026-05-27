/**
 * OpenRouter ModelAdapter — works against 200+ models for free-tier users.
 *
 * Used by the sample agents in the SDK. Production users should write their
 * own adapter for their preferred provider (OpenAI direct, Anthropic, Vext
 * managed Theron, etc.).
 */
import type { ModelAdapter } from "../../src/runtime/index.js";

type ToolCallChunk = {
  index?: number;
  function?: { name?: string; arguments?: string };
};

export function openrouterAdapter(opts: {
  apiKey: string;
  siteName?: string;
  siteUrl?: string;
}): ModelAdapter {
  if (!opts.apiKey) {
    throw new Error(
      "openrouterAdapter: `apiKey` is required. Get a key at https://openrouter.ai/keys.",
    );
  }
  return {
    name: "openrouter",
    async chat({ model, messages, tools, max_tokens, temperature, onDelta }) {
      const body: Record<string, unknown> = {
        model,
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
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          ...(opts.siteUrl ? { "HTTP-Referer": opts.siteUrl } : {}),
          ...(opts.siteName ? { "X-Title": opts.siteName } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(
          `OpenRouter request failed (HTTP ${res.status}). Check your API key and model name. Response: ${bodyText.slice(0, 500)}`,
        );
      }

      if (onDelta && res.body) {
        // Streaming path — parse SSE, accumulate tool-call fragments.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        let inputTokens = 0;
        let outputTokens = 0;
        const toolCallBuffer = new Map<number, { name: string; argsText: string }>();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;
              if (delta?.content) {
                onDelta(delta.content);
                content += delta.content;
              }
              const toolCalls: ToolCallChunk[] | undefined = delta?.tool_calls;
              if (toolCalls) {
                for (const tc of toolCalls) {
                  const idx = tc.index ?? 0;
                  const cur = toolCallBuffer.get(idx) ?? { name: "", argsText: "" };
                  if (tc.function?.name) cur.name = tc.function.name;
                  if (tc.function?.arguments) cur.argsText += tc.function.arguments;
                  toolCallBuffer.set(idx, cur);
                }
              }
              if (json.usage) {
                inputTokens = json.usage.prompt_tokens ?? inputTokens;
                outputTokens = json.usage.completion_tokens ?? outputTokens;
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
        const tool_calls = Array.from(toolCallBuffer.values())
          .filter((c) => c.name)
          .map((c) => ({ name: c.name, input: safeJsonParse(c.argsText) }));
        return {
          content,
          ...(tool_calls.length > 0 ? { tool_calls } : {}),
          tokens: { input: inputTokens, output: outputTokens },
        };
      }

      // Non-streaming path.
      const json = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{ function: { name: string; arguments: string } }>;
          };
        }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };
      const msg = json.choices[0].message;
      const tool_calls = msg.tool_calls?.map((tc) => ({
        name: tc.function.name,
        input: safeJsonParse(tc.function.arguments),
      }));
      return {
        content: msg.content ?? "",
        ...(tool_calls && tool_calls.length > 0 ? { tool_calls } : {}),
        tokens: { input: json.usage.prompt_tokens, output: json.usage.completion_tokens },
      };
    },
  };
}

function safeJsonParse(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
