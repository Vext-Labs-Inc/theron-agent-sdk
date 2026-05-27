/**
 * Theron ModelAdapter — talks to the Vext-hosted council at
 * https://tryvext.com/api/theron-chat-phased.
 *
 * Same OpenAI-compatible adapter shape as openrouter.ts. Use this when you
 * want the SDK to drive the Vext Council with its trained specialists and
 * verifier kernels instead of a single foundation model.
 *
 * Tool-calling is NOT yet exposed by the hosted Theron endpoint, so this
 * adapter ignores any `tools` argument and returns only `content` + a
 * synthetic token count. The SDK's tool-call loop is still exercised when
 * you swap in OpenRouter / OpenAI / Anthropic adapters for local dev.
 */
import type { ModelAdapter } from "../../src/runtime/index.js";

type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export function theronAdapter(opts: {
  /** Endpoint base. Defaults to tryvext.com. */
  base?: string;
  /** Vext API key, if you have one. Owner key is fine. Optional for OSS demo. */
  apiKey?: string;
  /** Which surface to advertise. Affects the Theron system prompt. */
  surface?: "marketing" | "theron" | "aeos-personal" | "aeos-company";
}): ModelAdapter {
  const base = (opts.base ?? "https://tryvext.com").replace(/\/$/, "");
  return {
    name: "theron",
    async chat({ messages, onDelta }: {
      messages: ChatMessage[];
      tools?: ToolDef[];
      onDelta?: (delta: string) => void;
    }) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

      const res = await fetch(`${base}/api/theron-chat-phased`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          surface: opts.surface ?? "theron",
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Theron request failed (HTTP ${res.status}). Endpoint: ${base}/api/theron-chat-phased. Response: ${text.slice(0, 500)}`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let buf = "";
      let currentEvent: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            if (currentEvent === "token" && typeof json.t === "string") {
              content += json.t;
              onDelta?.(json.t);
            } else if (currentEvent === "final" && typeof json.text === "string") {
              content = json.text;
            }
          } catch {
            // skip malformed event
          }
        }
      }

      // The phased endpoint does not return real token counts. We synthesize
      // a rough estimate from character length (4 chars ≈ 1 token).
      const approxTokens = Math.ceil(content.length / 4);
      return {
        content,
        tokens: { input: 0, output: approxTokens },
      };
    },
  };
}
