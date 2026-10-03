export interface OpenAIToolSchema {
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
      agent_type: {
        type: "string",
        description: "Optional named subagent persona (e.g. 'code-reviewer', 'security-auditor', 'codebase-explorer'). Resolved local-first from the agent library (~/.theron/agents, .theron/agents, and the bundled set), then the agent catalog. Sets the subagent's system prompt, model, turn cap, and tool scope. Call Task with no agent_type for a generic read-only research subagent.",
      },
      timeout_seconds: { type: "number", description: "Aggregate wall-clock timeout (default 300)." },
    },
    required: ["description", "prompt"],
  },
  AgentCreate: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name (e.g. 'Performance Reviewer') — automatically slugified for the id and filename (e.g. 'performance-reviewer'). You may also pass a kebab-case slug directly." },
      description: { type: "string", description: "One line: WHAT the agent does and WHEN to use it. Keyword-rich so it auto-selects." },
      system_prompt: { type: "string", description: "The agent's full system prompt — its role, method, output contract, and constraints." },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Optional read-only tool allowlist — a subset of Read, Grep, Glob, LS. Omit for all four.",
      },
      model: { type: "string", description: "Optional model id or tier: 'fast' (Fugu), 'deep' (Fugu-Ultra), 'reasoning' (CoT specialist), or a raw model id." },
      max_turns: { type: "number", description: "Optional max turns for the subagent (default 10)." },
    },
    required: ["name", "description", "system_prompt"],
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
  MultiEdit: "Apply multiple exact-substring replacements to a single file in one atomic operation. All edits are validated before any write occurs — a missing or ambiguous old_string fails the entire batch early. Use when you need to make several related edits to one file.",
  WebFetch: "Fetch a URL and return its text content (HTML stripped to prose). 15s timeout. Content is truncated to maxBytes. file://, localhost, and private IP ranges are rejected.",
  WebSearch: "Search the web via DuckDuckGo and return the top results as title + URL pairs. No API key required.",
  Task: "Spawn a bounded read-only subagent. The subagent runs its own multi-turn loop using only Read/Grep/Glob/LS — no writes, no shell, no web — and returns its findings. Pass agent_type to use a named specialist persona (e.g. code-reviewer, security-auditor, bug-hunter); omit it for a generic researcher. Safe to spawn several for parallel investigation. Times out after timeout_seconds (default 300).",
  AgentCreate: 'Define a new named subagent and make it usable immediately. Writes a portable Markdown agent definition to .theron/agents/<name>.md and registers it, so the next Task(agent_type:"<name>") can dispatch to it. Use when a recurring kind of investigation/review deserves a reusable specialist. Subagents are read-only (Read/Grep/Glob/LS).',
  TodoWrite: "Maintain a structured task list for the current session. Replaces the full list with the provided array. Each item has content (string), status (pending/in_progress/completed), and optional activeForm.",
};

/** Which extended tools mutate state. AgentCreate writes a file, so it is gated like a write. */
export const MUTATING_EXTENDED_TOOLS = new Set(["MultiEdit", "TodoWrite", "AgentCreate"]);

/**
 * Build the OpenAI-style tool schemas for the extended tools. Pass per-surface
 * description overrides; anything omitted falls back to the canonical description.
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
