// Hive SDK — public surface.
//
// The minimum import to build an agent:
//   import { Agent, Council, Tool, Runner } from "@vextlabs/hive-sdk";
//
// Five primitives + the runtime. Everything else is built on these.

export { Agent } from "./agent/index.js";
export type { AgentConfig, AgentInstruction, AgentResult } from "./agent/index.js";

export { Council } from "./council/index.js";
export type { CouncilConfig, CouncilOutput, Reconciler } from "./council/index.js";

export { Session } from "./session/index.js";
export type { SessionEvent, SessionConfig } from "./session/index.js";

export { Memory } from "./memory/index.js";
export type { MemoryQuery, MemoryRecord } from "./memory/index.js";

export { Tool, defineTool } from "./tools/index.js";
export type { ToolContext, ToolSchema } from "./tools/index.js";

export { Verifier, defineVerifier, VerifierKernels } from "./verifiers/index.js";
export type { VerifierResult, VerifierIssue } from "./verifiers/index.js";

export { Runner } from "./runtime/index.js";
export type { RunnerEvent, RunnerConfig } from "./runtime/index.js";

export const VERSION = "0.1.0-alpha";
