// Theron Agent SDK — public surface.
//
// The minimum import to build an agent:
//   import { Agent, Council, Tool, Runner } from "@vextlabs/theron-agent-sdk";

export {
  AGENT_MODEL_TIERS,
  Agent,
  loadAllMarkdownAgents,
  loadMarkdownAgents,
  parseMarkdownAgent,
  resolveAgentModel,
  serializeMarkdownAgent,
  slugifyAgentName,
  subAgentToolName,
} from "./agent/index.js";
export type {
  AgentConfig,
  AgentDefinitionInput,
  AgentInstruction,
  AgentModelTier,
  AgentResult,
  MarkdownAgentType,
} from "./agent/index.js";

export { Council, sentenceClaimExtractor } from "./council/index.js";
export type { ClaimExtractor, CouncilConfig, CouncilOutput, Reconciler } from "./council/index.js";

export { Session } from "./session/index.js";
export type { SessionEvent, SessionConfig } from "./session/index.js";

export { Memory, InMemoryStore } from "./memory/index.js";
export type { MemoryQuery, MemoryRecord } from "./memory/index.js";

export { defineTool } from "./tools/index.js";
export type { Tool, ToolContext, ToolSchema } from "./tools/index.js";
export { zod } from "./tools/index.js";

export { defineVerifier, VerifierKernels } from "./verifiers/index.js";
export type { Verifier, VerifierResult, VerifierIssue } from "./verifiers/index.js";

export { Runner, LocalCloudSession, LocalCloudSessionProvider } from "./runtime/index.js";
export type {
  ModelAdapter,
  RunnerEvent,
  RunnerConfig,
  RunOptions,
  CloudExecOptions,
  CloudExecResult,
  CloudSession,
  CloudSessionProvider,
} from "./runtime/index.js";

export { MCPClient, collectMcpTools } from "./mcp/index.js";
export type { McpServerConfig, McpTool } from "./mcp/index.js";

export { resolveJuwelToken, theron, theronAdapter } from "./adapters/theron.js";
export type { TheronAdapterOptions } from "./adapters/theron.js";

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

export {
  allOf,
  anyOf,
  boundWorkingSet,
  compactHistory,
  costUsdAtLeast,
  runImprovementCycle,
  runUntil,
  stepCountIs,
  verifiedRatchet,
  verifierSatisfied,
} from "./loop/index.js";
export type {
  BoundWorkingSetResult,
  ChatMessage,
  CompactHistoryOptions,
  CompactHistoryResult,
  ImprovementCycleSpec,
  ImprovementResult,
  LoopState,
  Ratchet,
  RatchetDecision,
  RatchetVerdict,
  RunUntilOptions,
  RunUntilResult,
  StopPredicate,
  WorkingItem,
} from "./loop/index.js";

export {
  bestOfN,
  chainOfVerification,
  measureLift,
  mixtureOfAgents,
  reflexion,
  selfConsistency,
  selfRefine,
  treeOfThoughts,
} from "./patterns/index.js";
export type {
  BestOfNOptions,
  BestOfNResult,
  ChainOfVerificationOptions,
  ChainOfVerificationResult,
  MeasureLiftOptions,
  MeasureLiftResult,
  MixtureOfAgentsOptions,
  MixtureOfAgentsResult,
  ReflexionOptions,
  ReflexionResult,
  SelfConsistencyOptions,
  SelfConsistencyResult,
  SelfRefineOptions,
  SelfRefineResult,
  TreeOfThoughtsOptions,
  TreeOfThoughtsResult,
} from "./patterns/index.js";

export {
  parseMarkdownSkill,
  loadMarkdownSkills,
  loadAllMarkdownSkills,
} from "./skills/index.js";
export type { MarkdownSkill } from "./skills/index.js";

export {
  LOCAL_TOOL_PARAMETERS,
  LOCAL_TOOL_NAMES,
  MUTATING_LOCAL_TOOLS,
  buildLocalToolSchemas,
} from "./tools/local-contract.js";
export type { LocalToolDef } from "./tools/local-contract.js";

export {
  EXTENDED_TOOL_PARAMETERS,
  EXTENDED_TOOL_DESCRIPTIONS,
  MUTATING_EXTENDED_TOOLS,
  buildExtendedToolSchemas,
} from "./tools/extended-contract.js";

export { certifyArithmetic, verifyReasoningCertificate } from "./reasoning-cert/index.js";
export type { ReasoningCertificate, ReasoningTier } from "./reasoning-cert/index.js";

export {
  findToken,
  replaceToken,
  insertSigil,
  filterPalette,
  rewriteSkills,
  DESTRUCTIVE_SLASH,
  isDestructive,
} from "./composer/index.js";
export type {
  ComposerPill,
  ComposerToken,
  PaletteItem,
  Sigil,
  SkillLike,
  SkillRewrite,
} from "./composer/index.js";

// Matches the constant shipped in the 0.4.1 bundle. package.json is 0.4.1.
export const VERSION = "0.3.2";
