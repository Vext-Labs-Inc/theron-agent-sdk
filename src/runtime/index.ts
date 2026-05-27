// Runner — drives the agent loop. Streams events. Checkpoints state.
//
// The Runner is the only place where the SDK touches an actual model.
// Everything upstream (Agent, Council, Tool, Verifier) is pure declaration.

import type { Agent, AgentResult } from "../agent/index.js";
import type { Council, CouncilOutput, CouncilSpecialistOutput } from "../council/index.js";
import type { Session } from "../session/index.js";
import type { Memory } from "../memory/index.js";
import type { ToolContext } from "../tools/index.js";
import type { VerifierResult } from "../verifiers/index.js";

/** Events the Runner emits as it executes. Subscribe via runner.on(). */
export type RunnerEvent =
  | { type: "agent_start"; agent: string; query: string }
  | { type: "agent_thinking"; agent: string; delta: string }
  | { type: "tool_call_start"; agent: string; tool: string; input: unknown }
  | { type: "tool_call_done"; agent: string; tool: string; output: unknown; ms: number }
  | { type: "verifier_run"; agent: string; kernel: string; result: VerifierResult }
  | { type: "agent_output"; agent: string; output: string }
  | { type: "council_start"; council: string; query: string }
  | { type: "specialist_done"; specialist: string; output: CouncilSpecialistOutput }
  | { type: "council_done"; council: string; output: CouncilOutput }
  | { type: "error"; agent: string; message: string };

/**
 * Model adapter — the function the Runner calls to talk to an LLM.
 *
 * Implement once per provider. Three reference adapters ship in
 * `examples/adapters/`: OpenRouter, OpenAI, Anthropic. Production users write
 * their own adapter for their preferred endpoint (Vext-hosted Theron, AWS
 * Bedrock, Cerebras, Groq, your own OSS endpoint).
 */
export interface ModelAdapter {
  name: string;
  /** Chat completion. Streams deltas via the optional `onDelta` callback. */
  chat(opts: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    max_tokens?: number;
    temperature?: number;
    onDelta?: (delta: string) => void;
  }): Promise<{
    content: string;
    tool_calls?: Array<{ name: string; input: unknown }>;
    tokens: { input: number; output: number };
  }>;
}

export interface RunnerConfig {
  /** The model adapter to use. */
  model: ModelAdapter;
  /** Default model identifier (e.g., "gpt-4o", "claude-3-5-sonnet"). */
  default_model: string;
  /** Optional Memory implementation. */
  memory?: Memory;
  /** Optional Session for event logging. */
  session?: Session;
  /** Optional tool execution context (cwd, yolo, tenant). */
  tool_context?: ToolContext;
}

/**
 * Runner — executes Agents and Councils.
 *
 * Minimal usage:
 *   const runner = new Runner({
 *     model: openrouterAdapter({ apiKey: process.env.OPENROUTER_API_KEY }),
 *     default_model: "openai/gpt-4o-mini",
 *   });
 *   const result = await runner.run(myAgent, "What's 2+2?");
 *
 * With a council:
 *   const result = await runner.runCouncil(myCouncil, "Review this PR");
 */
export class Runner {
  public readonly model: ModelAdapter;
  public readonly default_model: string;
  public readonly memory: Memory | undefined;
  public readonly session: Session | undefined;
  public readonly tool_context: ToolContext;
  private listeners: Array<(event: RunnerEvent) => void> = [];

  constructor(config: RunnerConfig) {
    if (!config.model) throw new Error("Runner requires a `model` adapter.");
    if (!config.default_model) throw new Error("Runner requires a `default_model` identifier.");
    this.model = config.model;
    this.default_model = config.default_model;
    this.memory = config.memory;
    this.session = config.session;
    this.tool_context = config.tool_context ?? { cwd: process.cwd(), yolo: false };
  }

  /** Subscribe to runner events for streaming UIs / observability. */
  on(handler: (event: RunnerEvent) => void): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  private emit(event: RunnerEvent): void {
    for (const h of this.listeners) h(event);
  }

  /**
   * Run a single agent on a query.
   *
   * Loop:
   *   1. Send messages + tool schemas to the model
   *   2. If model returns a tool call → execute the tool → append result to messages → repeat
   *   3. If model returns content + end_turn → finalize
   *   4. Run any registered verifier kernels on the final output
   *   5. Return the AgentResult
   */
  async run(agent: Agent, query: string): Promise<AgentResult> {
    const startedAt = Date.now();
    this.emit({ type: "agent_start", agent: agent.name, query });

    const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
      { role: "system", content: agent.instruction.system },
    ];
    for (const ex of agent.instruction.examples ?? []) {
      messages.push({ role: "user", content: ex.user });
      messages.push({ role: "assistant", content: ex.assistant });
    }
    messages.push({ role: "user", content: query });

    const toolCalls: Array<{ name: string; input: unknown; output: unknown }> = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let finalOutput = "";

    for (let turn = 0; turn < agent.max_turns; turn++) {
      const response = await this.model.chat({
        model: agent.model ?? this.default_model,
        messages,
        tools: agent.toolSchemas(),
        onDelta: (delta) => this.emit({ type: "agent_thinking", agent: agent.name, delta }),
      });
      tokensIn += response.tokens.input;
      tokensOut += response.tokens.output;

      if (response.tool_calls && response.tool_calls.length > 0) {
        // Push the assistant turn that requested the tool calls once,
        // then push one tool-result message per call.
        messages.push({ role: "assistant", content: response.content });
        for (const call of response.tool_calls) {
          const tool = agent.tools.find((t) => t.schema.name === call.name);
          if (!tool) {
            this.emit({
              type: "error",
              agent: agent.name,
              message: `Model called unknown tool: ${call.name}`,
            });
            messages.push({ role: "tool", content: `error: unknown tool ${call.name}` });
            continue;
          }
          this.emit({ type: "tool_call_start", agent: agent.name, tool: call.name, input: call.input });
          const t0 = Date.now();
          try {
            const output = await tool.execute(call.input, this.tool_context);
            const ms = Date.now() - t0;
            this.emit({ type: "tool_call_done", agent: agent.name, tool: call.name, output, ms });
            toolCalls.push({ name: call.name, input: call.input, output });
            messages.push({ role: "tool", content: JSON.stringify(output) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.emit({ type: "error", agent: agent.name, message: `Tool ${call.name} threw: ${msg}` });
            messages.push({ role: "tool", content: `error: ${msg}` });
          }
        }
        continue; // model gets to see tool results before producing final answer
      }

      finalOutput = response.content;
      messages.push({ role: "assistant", content: finalOutput });
      break;
    }

    this.emit({ type: "agent_output", agent: agent.name, output: finalOutput });

    // Run verifier kernels registered on the agent. Failures are reported but
    // do not throw — callers (or a Council) decide policy.
    const verifier_results: VerifierResult[] = [];
    for (const v of agent.verifiers) {
      try {
        const result = await v.check(finalOutput);
        verifier_results.push(result);
        this.emit({ type: "verifier_run", agent: agent.name, kernel: v.name, result });
      } catch (err) {
        this.emit({
          type: "error",
          agent: agent.name,
          message: `Verifier ${v.name} threw: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const latency_ms = Date.now() - startedAt;
    return {
      agent: agent.name,
      output: finalOutput,
      tool_calls: toolCalls,
      verifier_results,
      tokens_used: { input: tokensIn, output: tokensOut },
      cost_usd: 0, // adapter-specific; populated by adapter
      latency_ms,
    };
  }

  /**
   * Run a Council on a query.
   *
   * Fan out to all specialists in parallel (with timeout), gather outputs,
   * run council-level verifier kernels on each, and reconcile.
   */
  async runCouncil(council: Council, query: string): Promise<CouncilOutput> {
    const startedAt = Date.now();
    this.emit({ type: "council_start", council: council.name, query });

    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([
        p,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
      ]);

    const specialistResults = await Promise.all(
      council.specialists.map(async (spec) => {
        try {
          const result = await withTimeout(this.run(spec, query), council.specialist_timeout_ms);
          if (result === null) {
            this.emit({
              type: "error",
              agent: spec.name,
              message: `Specialist timed out after ${council.specialist_timeout_ms}ms`,
            });
            return null;
          }
          // Run council-level verifiers on each specialist output.
          const councilVerifierResults: VerifierResult[] = [];
          for (const v of council.verifiers) {
            try {
              const r = await v.check(result.output);
              councilVerifierResults.push(r);
              this.emit({ type: "verifier_run", agent: spec.name, kernel: v.name, result: r });
            } catch (err) {
              this.emit({
                type: "error",
                agent: spec.name,
                message: `Council verifier ${v.name} threw: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }
          const out: CouncilSpecialistOutput = {
            specialist: spec.name,
            output: result.output,
            claims: [], // claim extraction is the reconciler's job
            // AgentResult.verifier_results widens issues to unknown[]; at the
            // runtime layer we know every entry came from a Verifier.check()
            // call (which produces VerifierIssue[]), so the cast is sound.
            verifier_results: [
              ...(result.verifier_results as VerifierResult[]),
              ...councilVerifierResults,
            ],
            cost_usd: result.cost_usd,
            latency_ms: result.latency_ms,
          };
          this.emit({ type: "specialist_done", specialist: spec.name, output: out });
          return out;
        } catch (err) {
          this.emit({
            type: "error",
            agent: spec.name,
            message: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }),
    );

    const survivors = specialistResults.filter((s): s is CouncilSpecialistOutput => s !== null);
    const reconciled = await council.reconciler(survivors);

    const output: CouncilOutput = {
      answer: reconciled.answer,
      specialists: survivors,
      consensus: reconciled.consensus,
      disagreements: reconciled.disagreements,
      total_cost_usd: survivors.reduce((s, x) => s + x.cost_usd, 0),
      total_latency_ms: Date.now() - startedAt,
    };
    this.emit({ type: "council_done", council: council.name, output });
    return output;
  }
}
