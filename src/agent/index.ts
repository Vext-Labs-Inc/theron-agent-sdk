// Agent — the smallest unit. A model + an instruction + tools + optional
// sub-agents + optional verifier kernels. The 5-line agent pattern.

import type { Tool, ToolSchema } from "../tools/index.js";
import type { Verifier } from "../verifiers/index.js";

export interface AgentInstruction {
  /** System prompt or persona instruction. */
  system: string;
  /** Optional few-shot exemplars. */
  examples?: { user: string; assistant: string }[];
}

export interface AgentConfig {
  /** Display name. Used for logging + routing. */
  name: string;
  /** Model identifier. Defaults to whatever the Runner is configured for.
   *  Examples: "gpt-4o", "claude-3-5-sonnet", "theron-base-v8@cyber". */
  model?: string;
  /** Instructions to the model. Either a string (shorthand for {system: ...})
   *  or a full AgentInstruction object. */
  instruction: string | AgentInstruction;
  /** Tools the agent may call. */
  tools?: Tool[];
  /** Sub-agents the agent may delegate to. */
  sub_agents?: Agent[];
  /** Verifier kernels that run against the final output. Failures are
   *  reported in AgentResult.verifier_results but do not throw — callers
   *  decide how to react. Use Council if you want gating + reconciliation. */
  verifiers?: Verifier[];
  /** Optional max-turn cap. Defaults to runner default. */
  max_turns?: number;
}

export interface AgentResult {
  agent: string;
  output: string;
  tool_calls: Array<{ name: string; input: unknown; output: unknown }>;
  verifier_results: Array<{ kernel: string; pass: boolean; issues: unknown[]; ms: number }>;
  tokens_used: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
}

/**
 * The Agent primitive.
 *
 * Minimal usage:
 *   const a = new Agent({ name: "helper", instruction: "You are helpful." });
 *
 * With tools + verifiers:
 *   const a = new Agent({
 *     name: "researcher",
 *     instruction: "Answer with citations.",
 *     tools: [webSearch, fetchUrl],
 *     verifiers: [VerifierKernels.citationPresence],
 *   });
 */
export class Agent {
  public readonly name: string;
  public readonly model: string | undefined;
  public readonly instruction: AgentInstruction;
  public readonly tools: Tool[];
  public readonly sub_agents: Agent[];
  public readonly verifiers: Verifier[];
  public readonly max_turns: number;

  constructor(config: AgentConfig) {
    if (!config.name) throw new Error("Agent requires a `name`.");
    if (!config.instruction) throw new Error(`Agent "${config.name}" requires an \`instruction\`.`);
    this.name = config.name;
    this.model = config.model;
    this.instruction =
      typeof config.instruction === "string"
        ? { system: config.instruction }
        : config.instruction;
    this.tools = config.tools ?? [];
    this.sub_agents = config.sub_agents ?? [];
    this.verifiers = config.verifiers ?? [];
    this.max_turns = config.max_turns ?? 10;
  }

  /**
   * Render the tools as JSON schemas for the model — the agent's own tools
   * PLUS one `delegate_to_<sub-agent>` tool per declared sub-agent, so a
   * supervisor can actually hand work to its specialists. The Runner routes
   * those delegate calls back into `runner.run(subAgent, task)`.
   */
  toolSchemas(): ToolSchema[] {
    const own = this.tools.map((t) => t.schema);
    const delegates: ToolSchema[] = this.sub_agents.map((sa) => ({
      name: subAgentToolName(sa.name),
      description:
        `Delegate a self-contained subtask to the "${sa.name}" sub-agent and ` +
        `get back its result. ${sa.instruction.system.slice(0, 200)}`,
      input_schema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: `The subtask for the "${sa.name}" sub-agent to perform, stated as a complete, standalone instruction.`,
          },
        },
        required: ["task"],
      },
    }));
    return [...own, ...delegates];
  }

  /** Resolve a delegate tool-call name back to the sub-agent it targets. */
  findSubAgent(toolName: string): Agent | undefined {
    return this.sub_agents.find((sa) => subAgentToolName(sa.name) === toolName);
  }

  /** True if the agent has any sub-agents (i.e., this is a supervisor). */
  isSupervisor(): boolean {
    return this.sub_agents.length > 0;
  }
}

/** Canonical tool name a supervisor uses to delegate to a sub-agent. */
export function subAgentToolName(name: string): string {
  return `delegate_to_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown agent-type loader.
//
// Mirrors Claude Code's `.claude/agents/<name>.md` convention so agent
// definitions are portable between tools. A Markdown file with YAML
// frontmatter defines an agent type:
//
//   ---
//   name: code-reviewer
//   description: Reviews code for bugs and style issues.
//   model: deepseek/deepseek-v3.2
//   tools:
//     - Read
//     - Grep
//     - Glob
//   max_turns: 15
//   ---
//   You are a meticulous code reviewer. Focus on correctness bugs, security
//   issues, and cleanups. Cite file:line for every finding.
//
// The frontmatter is the metadata; the body (after the second `---`) is the
// system prompt. Files are loaded from `~/.theron/agents/*.md` (global) and
// `.theron/agents/*.md` (project-local), with project-local taking
// precedence on name collisions.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkdownAgentType {
  /** Unique slug derived from the filename or frontmatter `name`. */
  id: string;
  /** Display name from frontmatter. */
  name: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** Model identifier from frontmatter (optional). */
  model?: string;
  /** Tool name allowlist from frontmatter (optional). */
  tools?: string[];
  /** Max turns from frontmatter (optional, defaults to 10). */
  max_turns?: number;
  /** System prompt — the Markdown body after frontmatter. */
  system_prompt: string;
  /** Source file path. */
  source: string;
}

/** Parse a single Markdown agent file into a MarkdownAgentType. */
export function parseMarkdownAgent(filename: string, content: string): MarkdownAgentType | null {
  // Extract YAML frontmatter between leading `---` fences.
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();
  if (!body) return null;

  // Minimal YAML parser — handles flat key: value pairs and `- item` lists.
  // We avoid a full YAML dependency for the SDK; the frontmatter shape is
  // intentionally simple.
  const fields: Record<string, unknown> = {};
  let currentKey = '';
  for (const line of frontmatter.split('\n')) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      const existing = fields[currentKey];
      if (Array.isArray(existing)) {
        existing.push(listMatch[1].trim());
      } else {
        fields[currentKey] = [listMatch[1].trim()];
      }
      continue;
    }
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      currentKey = key;
      // Strip surrounding quotes if present.
      fields[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  const name = String(fields.name || '').trim();
  if (!name) return null;

  // Derive id from filename (without extension) if no explicit name, else
  // slugify the name. The slug rule MUST match slugifyAgentName() (trim edge
  // hyphens + cap at 64) so a file authored by AgentCreate (filename = slug)
  // parses back to the SAME id, even for a display name with trailing
  // punctuation (e.g. "Perf Reviewer!" → file perf-reviewer.md → id
  // perf-reviewer, not perf-reviewer-).
  const baseFilename = filename.replace(/\.md$/i, '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const id =
    name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64) ||
    baseFilename;

  return {
    id,
    name,
    description: String(fields.description || ''),
    model: fields.model ? String(fields.model) : undefined,
    tools: Array.isArray(fields.tools) ? fields.tools.map(String) : undefined,
    max_turns: fields.max_turns ? parseInt(String(fields.max_turns), 10) || undefined : undefined,
    system_prompt: body,
    source: filename,
  };
}

/**
 * Load all Markdown agent types from a directory.
 * Returns an array of parsed agent types, or an empty array if the
 * directory doesn't exist or can't be read. Never throws.
 */
export async function loadMarkdownAgents(dir: string): Promise<MarkdownAgentType[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  try {
    const entries = await fs.readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));
    const results: MarkdownAgentType[] = [];
    for (const file of mdFiles) {
      try {
        const fullPath = path.join(dir, file);
        const content = await fs.readFile(fullPath, 'utf8');
        const parsed = parseMarkdownAgent(file, content);
        if (parsed) results.push(parsed);
      } catch {
        // Skip unreadable files.
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Load Markdown agents from both global (~/.theron/agents) and project-local
 * (.theron/agents) directories. Project-local takes precedence on id
 * collisions. Never throws.
 */
export async function loadAllMarkdownAgents(projectDir?: string): Promise<MarkdownAgentType[]> {
  const os = await import('node:os');
  const path = await import('node:path');
  const home = os.homedir();
  const globalDir = path.join(home, '.theron', 'agents');
  const localDir = projectDir
    ? path.join(projectDir, '.theron', 'agents')
    : path.join(process.cwd(), '.theron', 'agents');

  const [globalAgents, localAgents] = await Promise.all([
    loadMarkdownAgents(globalDir),
    loadMarkdownAgents(localDir),
  ]);

  // Merge: local overrides global on id collisions.
  const byId = new Map<string, MarkdownAgentType>();
  for (const a of globalAgents) byId.set(a.id, a);
  for (const a of localAgents) byId.set(a.id, a);
  return [...byId.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent authoring — the inverse of the parser, so an agent can create its OWN
// agents at runtime by writing a `.theron/agents/<name>.md` file.
//
// `serializeMarkdownAgent` produces frontmatter + body that round-trips cleanly
// through `parseMarkdownAgent`. The frontmatter is deliberately flat (the SDK's
// minimal YAML parser only handles `key: value` and `- item` lists), so we keep
// every scalar single-line and quote-safe.
// ─────────────────────────────────────────────────────────────────────────────

/** Model tiers for the JUWEL fleet — the single source of truth so bundled and
 *  user-authored agents route to the same real upstreams. `fast`/`deep` map to
 *  Sakana Fugu (falls back to OpenRouter fail-open server-side); `reasoning`
 *  picks a chain-of-thought specialist on OpenRouter. Use a tier name OR a raw
 *  model id in an agent's `model` field — both flow straight to /api/cli/chat. */
export const AGENT_MODEL_TIERS = {
  fast: 'fugu',
  deep: 'fugu-ultra',
  reasoning: 'deepseek/deepseek-r1-distill-llama-70b',
} as const;

export type AgentModelTier = keyof typeof AGENT_MODEL_TIERS;

/** Resolve a tier name (`fast`/`deep`/`reasoning`) to its concrete model id.
 *  A value that isn't a known tier is returned unchanged — so a raw model id
 *  (e.g. `fugu`, `qwen/qwen3-coder`) passes through untouched. */
export function resolveAgentModel(modelOrTier: string | undefined): string | undefined {
  if (!modelOrTier) return undefined;
  const tier = modelOrTier.trim().toLowerCase();
  return (AGENT_MODEL_TIERS as Record<string, string>)[tier] ?? modelOrTier;
}

/** Slugify an arbitrary name into a safe agent id / filename stem:
 *  lowercase, hyphen-separated, alphanumerics + hyphens only. */
export function slugifyAgentName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export interface AgentDefinitionInput {
  /** Display name — also slugified into the id / filename. */
  name: string;
  /** One-line description (WHAT it does + WHEN to use it). */
  description: string;
  /** The system prompt — becomes the Markdown body. */
  system_prompt: string;
  /** Optional model id or tier name (`fast`/`deep`/`reasoning`). */
  model?: string;
  /** Optional tool-name allowlist. */
  tools?: string[];
  /** Optional max-turn cap. */
  max_turns?: number;
}

/** Make a scalar safe for the flat frontmatter (single line, no quote breakage). */
function yamlScalar(value: string): string {
  const oneLine = String(value).replace(/\s*\n+\s*/g, ' ').trim();
  // The parser strips ONE surrounding quote pair but does not unescape, so we
  // swap interior double-quotes for single-quotes to keep a clean round-trip.
  const safe = oneLine.replace(/"/g, "'");
  return `"${safe}"`;
}

/**
 * Serialize an agent definition into a Markdown file body (frontmatter + system
 * prompt) that `parseMarkdownAgent` can read back. Throws only if `name`,
 * `description`, or `system_prompt` is empty — the caller validates first.
 */
export function serializeMarkdownAgent(def: AgentDefinitionInput): string {
  const name = String(def.name || '').trim();
  const description = String(def.description || '').trim();
  const systemPrompt = String(def.system_prompt || '').trim();
  if (!name) throw new Error('serializeMarkdownAgent: `name` is required.');
  if (!description) throw new Error('serializeMarkdownAgent: `description` is required.');
  if (!systemPrompt) throw new Error('serializeMarkdownAgent: `system_prompt` is required.');

  const lines: string[] = ['---'];
  lines.push(`name: ${name}`);
  lines.push(`description: ${yamlScalar(description)}`);
  if (def.model && String(def.model).trim()) {
    lines.push(`model: ${String(def.model).trim()}`);
  }
  const tools = Array.isArray(def.tools) ? def.tools.map((t) => String(t).trim()).filter(Boolean) : [];
  if (tools.length > 0) {
    lines.push('tools:');
    for (const t of tools) lines.push(`  - ${t}`);
  }
  if (typeof def.max_turns === 'number' && Number.isFinite(def.max_turns) && def.max_turns > 0) {
    lines.push(`max_turns: ${Math.floor(def.max_turns)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(systemPrompt);
  lines.push('');
  return lines.join('\n');
}
