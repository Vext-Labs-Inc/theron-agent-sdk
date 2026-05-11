/**
 * OpenRouter ModelAdapter — works against 200+ models for free-tier users.
 *
 * Used by the sample agents in the SDK. Production users should write their
 * own adapter for their preferred provider (OpenAI direct, Anthropic, Vext
 * managed Theron, etc.).
 */
import type { ModelAdapter } from "../../src/runtime/index.js";

export function openrouterAdapter(opts: { apiKey: string; siteName?: string; siteUrl?: string }): ModelAdapter {
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
        throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      }
      if (onDelta && res.body) {
        // Streaming path — parse SSE
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        let inputTokens = 0;
        let outputTokens = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                onDelta(delta);
                content += delta;
              }
              if (json.usage) {
                inputTokens = json.usage.prompt_tokens ?? inputTokens;
                outputTokens = json.usage.completion_tokens ?? outputTokens;
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
        return { content, tokens: { input: inputTokens, output: outputTokens } };
      }
      // Non-streaming path
      const json = await res.json() as {
        choices: Array<{ message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };
      const msg = json.choices[0].message;
      const tool_calls = msg.tool_calls?.map((tc) => ({
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}"),
      }));
      return {
        content: msg.content ?? "",
        tool_calls,
        tokens: { input: json.usage.prompt_tokens, output: json.usage.completion_tokens },
      };
    },
  };
}
