// Theron Agent SDK — public surface.
//
// The minimum import to build an agent:
//   import { Agent, Council, Tool, Runner } from "@vextlabs/theron-agent-sdk";
//
// Five primitives + the runtime. Everything else is built on these.

export { Agent } from "./agent/index.js";
export type { AgentConfig, AgentInstruction, AgentResult } from "./agent/index.js";

export { Council } from "./council/index.js";
export type { CouncilConfig, CouncilOutput, Reconciler } from "./council/index.js";

export { Session } from "./session/index.js";
export type { SessionEvent, SessionConfig } from "./session/index.js";

export { Memory, InMemoryStore } from "./memory/index.js";
export type { MemoryQuery, MemoryRecord } from "./memory/index.js";

export { defineTool } from "./tools/index.js";
export type { Tool, ToolContext, ToolSchema } from "./tools/index.js";
export { zod } from "./tools/index.js";

export { defineVerifier, VerifierKernels } from "./verifiers/index.js";
export type { Verifier, VerifierResult, VerifierIssue } from "./verifiers/index.js";

export { Runner } from "./runtime/index.js";
export type { ModelAdapter, RunnerEvent, RunnerConfig } from "./runtime/index.js";

export { MCPClient, collectMcpTools } from "./mcp/index.js";
export type { McpServerConfig, McpTool } from "./mcp/index.js";

export {
  ReceiptEmitter,
  InMemoryReceiptSink,
  fileReceiptSink,
  httpReceiptSink,
} from "./receipts/index.js";
export type {
  Receipt,
  ReceiptInput,
  ReceiptSink,
  ReceiptSigner,
  ReceiptEmitterConfig,
} from "./receipts/index.js";

export const VERSION = "0.1.0";
