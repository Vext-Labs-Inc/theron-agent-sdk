// Extended-tool contract — the canonical home for the 5 tool schemas that the
// CLI and the VS Code extension were each re-declaring inline (MultiEdit,
// WebFetch, WebSearch, Task, TodoWrite). Same pattern as local-contract.ts: the
// PARAMETERS schemas live here once; surfaces import them and supply their own
// per-surface description string (or use the canonical one). This kills the
// drift that comes from maintaining identical JSON-schema in two places.

interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** The canonical parameters schema for each extended tool, keyed by tool name. */
export const EXTENDED_TOOL_PARAMETERS: Record<string, Record<string, unknown>> = {
  MultiEdit: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or cwd-relative path to the file." },
      edits: {
        type: "array",
        description: "Ordered list of edits. Applied in sequence; each edit sees the result of the previous ones.",
        items: {
          type: "object",
          properties: {
            old_string: { type: "string", description: "Exact substring to replace. Must be unique (or set replace_all=true)." },
            new_string: { type: "string", description: "Replacement text." },
            replace_all: { type: "boolean", description: "Replace all occurrences (default false)." },
          },
          required: ["old_string", "new_string"],
        },
      },
    },
    required: ["file_path", "edits"],
  },
  WebFetch: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch (http: or https: only)." },
    },
    required: ["url"],
  },
  WebSearch: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      max_results: { type: "number", description: "Maximum results to return (default 10, max 20)." },
    },
    required: ["query"],
  },
  Task: {
    type: "object",
    properties: {
      description: { type: "string", description: "Short label for the task (shown in terminal)." },
      prompt: { type: "string", description: "The full prompt to send the subagent." },
      timeout_seconds: { type: "number", description: "Aggregate wall-clock timeout (default 300)." },
    },
    required: ["description", "prompt"],
  },
  TodoWrite: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            activeForm: { type: "string" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
};

/** Canonical descriptions (surfaces may override per-surface). */
export const EXTENDED_TOOL_DESCRIPTIONS: Record<string, string> = {
  MultiEdit:
    "Apply multiple exact-substring replacements to a single file in one atomic operation. All edits are validated before any write occurs — a missing or ambiguous old_string fails the entire batch early. Use when you need to make several related edits to one file.",
  WebFetch:
    "Fetch a URL and return its text content (HTML stripped to prose). 15s timeout. Content is truncated to maxBytes. file://, localhost, and private IP ranges are rejected.",
  WebSearch:
    "Search the web via DuckDuckGo and return the top results as title + URL pairs. No API key required.",
  Task:
    "Spawn a bounded read-only research subagent. The subagent can only use Read/Grep/Glob/LS — no writes, no shell, no web. Times out after timeout_seconds (default 300). Use for parallel investigation or complex read-only research.",
  TodoWrite:
    "Maintain a structured task list for the current session. Replaces the full list with the provided array. Each item has content (string), status (pending/in_progress/completed), and optional activeForm.",
};

/** Which extended tools mutate state (parallel to MUTATING_LOCAL_TOOLS). */
export const MUTATING_EXTENDED_TOOLS = new Set<string>(["MultiEdit", "TodoWrite"]);

/**
 * Build the OpenAI-style tool schemas for the extended tools. Pass per-surface
 * description overrides; anything omitted falls back to the canonical description.
 * Parallel to buildLocalToolSchemas in local-contract.ts.
 */
export function buildExtendedToolSchemas(
  descriptions: Partial<Record<string, string>> = {},
): OpenAIToolSchema[] {
  return Object.keys(EXTENDED_TOOL_PARAMETERS).map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: descriptions[name] ?? EXTENDED_TOOL_DESCRIPTIONS[name] ?? "",
      parameters: EXTENDED_TOOL_PARAMETERS[name],
    },
  }));
}
