// Vext SDK. Public surface (npm package @vextlabs/sdk).
//
// The minimum import to build an agent:
//   import { Agent, Council, Tool, Runner } from "@vextlabs/sdk";
//
// Five primitives + the runtime. Everything else is built on these.

export { Agent, subAgentToolName } from "./agent/index.js";
export type { AgentConfig, AgentInstruction, AgentResult, MarkdownAgentType } from "./agent/index.js";
export { parseMarkdownAgent, loadMarkdownAgents, loadAllMarkdownAgents } from "./agent/index.js";
// Agent authoring + model-fleet routing — let an agent create its own agents.
export {
  serializeMarkdownAgent,
  slugifyAgentName,
  resolveAgentModel,
  AGENT_MODEL_TIERS,
} from "./agent/index.js";
export type { AgentDefinitionInput, AgentModelTier } from "./agent/index.js";

export { parseMarkdownSkill, loadMarkdownSkills, loadAllMarkdownSkills } from "./skills/index.js";
export type { MarkdownSkill } from "./skills/index.js";

export { Council, sentenceClaimExtractor } from "./council/index.js";
export type { CouncilConfig, CouncilOutput, Reconciler, ClaimExtractor } from "./council/index.js";

export { Session } from "./session/index.js";
export type { SessionEvent, SessionConfig } from "./session/index.js";

export { Memory, InMemoryStore } from "./memory/index.js";
export type { MemoryQuery, MemoryRecord } from "./memory/index.js";

export { defineTool } from "./tools/index.js";
export type { Tool, ToolContext, ToolSchema } from "./tools/index.js";
export { zod } from "./tools/index.js";

export { LOCAL_TOOL_PARAMETERS, LOCAL_TOOL_NAMES, MUTATING_LOCAL_TOOLS, buildLocalToolSchemas } from "./tools/local-contract.js";
export {
  EXTENDED_TOOL_PARAMETERS,
  EXTENDED_TOOL_DESCRIPTIONS,
  MUTATING_EXTENDED_TOOLS,
  buildExtendedToolSchemas,
} from "./tools/extended-contract.js";
export type { LocalToolDef } from "./tools/local-contract.js";

export { defineVerifier, VerifierKernels } from "./verifiers/index.js";
export type { Verifier, VerifierResult, VerifierIssue } from "./verifiers/index.js";

// Reasoning Certificate — sound, offline-verifiable proof that a CLAIM is correct
// (not just that an action happened), sealed into the receipt's content_hash.
export { certifyArithmetic, verifyReasoningCertificate } from "./reasoning-cert/index.js";
export type { ReasoningCertificate, ReasoningTier } from "./reasoning-cert/index.js";

// Composer contract — the single source of truth for slash/at token handling
// (mid-message detection, cursor-aware replace, skill rewrite, pills) so the
// VS Code/CLI/OS composers stop reimplementing it and growing the same bugs.
export {
  findToken,
  replaceToken,
  insertSigil,
  filterPalette,
  rewriteSkills,
  isDestructive,
  DESTRUCTIVE_SLASH,
} from "./composer/index.js";
export type {
  Sigil,
  ComposerToken,
  PaletteItem,
  ComposerPill,
  SkillLike,
  SkillRewrite,
} from "./composer/index.js";

export { Runner } from "./runtime/index.js";
export type {
  ModelAdapter,
  ModelMessage,
  ModelToolCall,
  RunnerEvent,
  RunnerConfig,
  RunOptions,
} from "./runtime/index.js";

export { LocalCloudSession, LocalCloudSessionProvider } from "./runtime/cloud-session.js";
export type {
  CloudSession,
  CloudSessionProvider,
  CloudExecResult,
  CloudExecOptions,
} from "./runtime/cloud-session.js";

export { MCPClient, collectMcpTools } from "./mcp/index.js";
export type { McpServerConfig, McpTool } from "./mcp/index.js";

// `baseURL` is the OpenAI-style API root. Requests go to `<baseURL>/chat/completions`.
// Set `baseURL` together with `apiKey`. If `baseURL` is omitted, `VEXT_BASE_URL`
// decides where the key is sent. There is no hosted default.
// `theronAdapter` / `theron` / `TheronAdapterOptions` are deprecated aliases of
// the Vext names and are the same references.
export {
  MissingBaseURLError,
  createVextAdapter,
  vext,
  theronAdapter,
  theron,
} from "./adapters/vext.js";
export type { VextAdapter, VextAdapterOptions, TheronAdapterOptions } from "./adapters/vext.js";
// Account token helper. Not attached implicitly: pass it as `tokenProvider`
// if you want `JUWEL_TOKEN` or ~/.juwel/config.json sent to your base.
export { resolveJuwelToken } from "./adapters/juwel_auth.js";

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
  stepCountIs,
  costUsdAtLeast,
  verifierSatisfied,
  anyOf,
  allOf,
  verifiedRatchet,
  runImprovementCycle,
  compactHistory,
  runUntil,
  boundWorkingSet,
} from "./loop/index.js";
export type {
  LoopState,
  StopPredicate,
  RatchetVerdict,
  RatchetDecision,
  Ratchet,
  ImprovementCycleSpec,
  ImprovementResult,
  ChatMessage,
  CompactHistoryOptions,
  CompactHistoryResult,
  RunUntilOptions,
  RunUntilResult,
  WorkingItem,
  BoundWorkingSetResult,
} from "./loop/index.js";

export {
  selfConsistency,
  bestOfN,
  selfRefine,
  treeOfThoughts,
  chainOfVerification,
  mixtureOfAgents,
  reflexion,
  measureLift,
} from "./patterns/index.js";
export type {
  SelfConsistencyOptions,
  SelfConsistencyResult,
  BestOfNOptions,
  BestOfNResult,
  SelfRefineOptions,
  SelfRefineResult,
  TreeOfThoughtsOptions,
  TreeOfThoughtsResult,
  ChainOfVerificationOptions,
  ChainOfVerificationResult,
  MixtureOfAgentsOptions,
  MixtureOfAgentsResult,
  ReflexionOptions,
  ReflexionResult,
  MeasureLiftOptions,
  MeasureLiftResult,
} from "./patterns/index.js";

export const VERSION = "0.3.2";
