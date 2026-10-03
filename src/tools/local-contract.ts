/** OpenAI-compatible function tool definition. */
export interface LocalToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Canonical JSON-Schema `parameters` objects for the 7 shared local tools.
 *
 * Descriptions of the tool itself stay per-surface. These parameters blocks
 * are the shared contract.
 */
export const LOCAL_TOOL_PARAMETERS: Record<string, Record<string, unknown>> = {
  Read: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or relative path to the file." },
      offset: { type: "number", description: "Optional 1-indexed line to start reading from." },
      limit: { type: "number", description: "Optional max lines to read." },
    },
    required: ["file_path"],
  },
  Write: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string", description: "Full file contents — overwrites whatever was there." },
    },
    required: ["file_path", "content"],
  },
  Edit: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean", default: false },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  Bash: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout: { type: "number", description: "Timeout in ms (default 120000, max 600000)." },
      description: { type: "string", description: "Short label for what the command does, shown to the user." },
    },
    required: ["command"],
  },
  Glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob like 'src/**/*.ts'." },
      path: { type: "string", description: "Root directory to search from. Defaults to the working directory." },
    },
    required: ["pattern"],
  },
  Grep: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern (ripgrep syntax). Use fixed_strings for a literal search." },
      path: { type: "string", description: "Optional file or directory to limit the search." },
      glob: { type: "string", description: "Optional glob filter, e.g. '*.ts' or 'src/**/*.tsx'." },
      type: { type: "string", description: "Optional file-type filter (ripgrep --type), e.g. 'ts', 'py', 'rust'. More efficient than glob for language filters." },
      case_insensitive: { type: "boolean", default: false, description: "Case-insensitive match." },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "What to return: 'content' = matching lines with file:line (default), 'files_with_matches' = just the file paths, 'count' = per-file match counts.",
        default: "content",
      },
      context_lines: { type: "number", description: "Lines of context to show before AND after each match (ripgrep -C). Only applies to output_mode 'content'." },
      multiline: { type: "boolean", default: false, description: "Allow the pattern to span line boundaries (ripgrep --multiline; '.' matches newlines)." },
      fixed_strings: { type: "boolean", default: false, description: "Treat the pattern as a literal string, not a regex (ripgrep -F)." },
    },
    required: ["pattern"],
  },
  LS: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to list. Defaults to the working directory." },
      show_hidden: { type: "boolean", default: false, description: "Include dotfiles (.env, .gitignore, .github, etc.) in the listing." },
      recursive: { type: "boolean", default: false, description: "List subdirectories recursively (up to `depth` levels)." },
      depth: { type: "number", description: "Max recursion depth when recursive=true (default 3)." },
    },
  },
};

/** Registry order for the 7 shared local tools. */
export const LOCAL_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"] as const;

/**
 * Tools that can mutate the user's machine.
 *
 * Surfaces that add their own tools should extend this set locally rather than
 * modifying it here.
 */
export const MUTATING_LOCAL_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "Bash"]);

/**
 * Build the full OpenAI-style tool schema array for the 7 local tools.
 *
 * Each surface supplies its own `descriptions` map (keyed by tool name) so
 * the prose stays per-runtime. A missing description defaults to an empty string.
 */
export function buildLocalToolSchemas(descriptions: Record<string, string>): LocalToolDef[] {
  return LOCAL_TOOL_NAMES.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: descriptions[name] ?? "",
      parameters: LOCAL_TOOL_PARAMETERS[name],
    },
  }));
}
