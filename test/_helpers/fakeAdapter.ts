import type { ModelAdapter } from "../../src/runtime/index.js";

type ChatArgs = Parameters<ModelAdapter["chat"]>[0];

/**
 * fakeAdapter — scripted ModelAdapter for tests.
 *
 * Pass an array of responses; each chat() call returns the next one in order.
 * Each response can be:
 *   - a plain string (returned as content, no tool calls)
 *   - an object that mirrors the real adapter return shape
 *   - a function that receives the chat args and returns either of the above
 */
export type FakeResponse =
  | string
  | {
      content: string;
      tool_calls?: Array<{ name: string; input: unknown }>;
      tokens?: { input: number; output: number };
    }
  | ((args: ChatArgs) => string | {
      content: string;
      tool_calls?: Array<{ name: string; input: unknown }>;
      tokens?: { input: number; output: number };
    });

export function fakeAdapter(responses: FakeResponse[]): ModelAdapter & {
  calls: ChatArgs[];
} {
  const calls: ChatArgs[] = [];
  let i = 0;
  return {
    name: "fake",
    calls,
    async chat(args) {
      calls.push(args);
      if (i >= responses.length) {
        throw new Error(
          `fakeAdapter exhausted after ${responses.length} calls; ` +
            `received call #${i + 1}. Add another response to the script.`,
        );
      }
      const r = responses[i++];
      const resolved = typeof r === "function" ? r(args) : r;
      if (typeof resolved === "string") {
        args.onDelta?.(resolved);
        return {
          content: resolved,
          tokens: { input: 1, output: resolved.length },
        };
      }
      if (resolved.content) args.onDelta?.(resolved.content);
      return {
        content: resolved.content,
        ...(resolved.tool_calls ? { tool_calls: resolved.tool_calls } : {}),
        tokens: resolved.tokens ?? { input: 1, output: resolved.content.length },
      };
    },
  };
}
