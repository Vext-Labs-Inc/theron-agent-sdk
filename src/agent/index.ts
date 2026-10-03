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

  /** Render the tools as JSON schemas for the model. */
  toolSchemas(): ToolSchema[] {
    return this.tools.map((t) => t.schema);
  }

  /** True if the agent has any sub-agents (i.e., this is a supervisor). */
  isSupervisor(): boolean {
    return this.sub_agents.length > 0;
  }
}
