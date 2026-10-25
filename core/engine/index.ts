// Framework-free engine core: types, plugin contract, pure rules.
// MUST NOT import from convex/, next, react, or @clerk/*. Enforced by eslint.
export const ENGINE_VERSION = "0.0.0";

export type {
  CatalogDecl,
  ClarifyTopicDecl,
  FieldDecl,
  HumanReasonKeyDecl,
  ProtocolDecl,
  ReadinessGap,
  RelaxCtx,
  RelaxEntry,
  RoleDecl,
  RuleDocs,
  ScenarioFixture,
  ScenarioPlugin,
  StubInput,
  TemplateRegistry,
} from "./plugin";
export { defineScenario, SCENARIO_KEY_PATTERN } from "./plugin";

export * from "./money";
export * from "./dates";
export * from "./actions";
export * from "./reasonCodes";
export * from "./stateMachines";
export * from "./canonicalJson";
export * from "./keys";
export * from "./projection";
export * from "./result";
export * from "./strictSchema";
export type {
  CandidateDraft,
  CatalogRow,
  CatalogTitle,
  CheckCtx,
  CheckDecl,
  CheckOutcome,
  CheckResult,
  Effect,
  Evaluation,
  HumanRequestKind,
  ItemKey,
  Line,
  Materialized,
  ProposalLike,
  RequestOption,
  RuleInputBase,
  SnapshotItem,
  Terms,
  View,
} from "./rules";
export {
  ApprovalInvariantError,
  buildHumanRequests,
  CHECK_ORDER,
  checkBudget,
  checkProposal,
  claimMismatch,
  evaluateApprovalSet,
  hardProjection,
  IntegrityError,
  isExecutable,
  latestDecisionsByUser,
  materializeTerms,
  passesChecks,
  PluginContractError,
  projectEvaluation,
  staleSource,
  validateCapChange,
  type ApprovalKind,
  type ApprovalRow,
  type ApprovalSetResult,
  type BudgetResult,
  type Decision,
  type EnumerateOpts,
  type EvaluationView,
  type HumanRequestDraft,
  type MemberRow,
  type ProjectedCheck,
  type RequiredApproval,
  type SlotState,
} from "./rules";
export * from "./agentContext";
export * from "./events";
export {
  assertOptionsProjected,
  DISCLOSURE,
  projectEngineRequestOptions,
  projectRequestOptions,
  ROLES,
  type RequestOptionView,
} from "./disclosure";
export * as disclosure from "./disclosure";
export * as publicText from "./publicText";

export { EVENT_FIELDS } from "./events";
export type { EventPayload } from "./events";

// Keep the legacy matrix export intact; family projections have a distinct namespace.
export * as privacy from "./disclosure";
export { buildAgentContext } from "./agentContext";
export type { AgentView } from "./agentContext";
export { isEventPayload, isRestrictedRef } from "./events";
export { REDACTABLE_FIELDS } from "./events";
export { allowedActions } from "./protocol";

export {
  enumerateCandidates,
  isOptionKey,
  isRoleView,
  materializeSelectedOption,
  normalizeCatalogRow,
  resolveOptionKey,
  resolveOptionKeyWithReason,
  viewFor,
} from "./candidates";
export type {
  CandidateSnapshotEntry,
  CandidateSnapshotResult,
  CatalogRowInput,
  EnumerateCandidatesOptions,
  FullViewInput,
  MaterializeOptionResult,
  ResolveOptionKeyResult,
  RoleDisclosures,
  ScenarioCandidateSlice,
  ScenarioMaterializeSlice,
  ScenarioViewSlice,
  StubDecideInput,
} from "./candidates";

// --- W2-6 BEGIN ---
export const ENGINE_CANARY = "__SFM_ENGINE_CANARY__";
export {
  APP_NAME,
  countCodePoints,
  isValidCatalogTitle,
  TEXT_LIMITS,
} from "./ui";
// --- W2-6 END ---
// W2-2: approval and execution transaction primitives.
export { committedCents, computeChangeOrderChain } from './ledger';
export type { ChangeOrderChain, LedgerEntryLite } from './ledger';
export { planExecutionRecords, ExecutionPlanError, MAX_TASKS_PER_EXECUTION } from './executionPlan';
// End W2-2.
// W2-2: read-only invariant auditing.
export { reconcileRoom } from './reconcile';
export type { RoomSnapshot, Finding, ReconcileCode } from './reconcile';
// End W2-2 invariant auditing.

// W2-2: execution provenance follows the strictest source.
// End W2-2 provenance.
// W2-2: protocol planner used by the local reject handoff seam.
export { buildHumanRequests as buildProtocolHumanRequests } from './protocol/humanRequests';
// End W2-2 protocol seam.
// W2-3: authoritative rule exports above also serve constraint orchestration.
// W2-3: use W1-4F's field and role projection at the L1 query boundary.
export { projectForRole as projectDTOForRole, projectSharedFacts, projectChecks } from './disclosure';
// W2-4: scheduler protocol and pure runtime contracts.
export { resolveRound, buildHumanRequests as planHumanRequests, answerEffect, canExtendRound } from './protocol';
export type { Evaluation as RoundEvaluation, RoundDecision, RequestContext } from './protocol';
export { decideRetry } from './runtime/retryPolicy';
export * from './runtime/budget';
export * from "./attemptErrors";

// --- W2-5 START ---
export {
  ALLOWED_PROPS,
  buildTurnSpec,
  computeTurnAllowedActions,
  ESCALATION_KINDS,
  listAllTurnSpecVariants,
  listWarmTurnSpecs,
  makeOptionKeys,
  OPTION_KEY_RE,
  PROTOCOL_VERSION,
  RATIONALE_MAX_CODEPOINTS,
  turnSpecKey,
} from "./protocol/turnSpec";
export type {
  AgentClarifyTurn,
  AgentCounterTurn,
  AgentEscalateTurn,
  AgentProposeTurn,
  AgentRecommendAcceptTurn,
  AgentRejectTurn,
  AgentTurn,
  AgentTurnEnvelope,
  BuildTurnSpecInput,
  ClarifyTargetSpec,
  EscalationKind,
  TurnSpec,
} from "./protocol/turnSpec";

export {
  classifyResponseCore,
  MOVE_ISSUE_CODES,
  normalizeRationale,
  sanitizeIssuePath,
  validateMoveSemantics,
} from "./protocol/semantics";
export type {
  ClassifiedResponse,
  ClassifierUsage,
  MoveIssue,
  MoveIssueCode,
  OutputValidationCode,
  RawClassifierInput,
  TurnParseResult,
  TurnSemanticsView,
} from "./protocol/semantics";

export {
  buildTurnSnapshot,
  excludedCandidateKeys,
} from "./protocol/snapshot";
export type {
  BuildTurnSnapshotParams,
  ProposalExclusionRow,
  ProviderTurnFeedback,
  RunExclusionsInput,
  TurnSnapshotOutput,
} from "./protocol/snapshot";

export {
  DEFAULT_ROLE_CHARTERS,
  PROMPT_VERSION,
  PROTOCOL_CHARTER,
  renderPrompt,
  sanitizeUntrustedString,
} from "./protocol/prompt";
export type {
  AgentTurnInput,
  PromptBlock,
  RenderedPrompt,
  ScenarioPromptPack,
  SystemBlock,
  UserBlock,
} from "./protocol/prompt";
// --- W2-5 END ---


// W2-1: provenance inheritance (03 §3.3.3).
export { inheritProvenance } from './provenance';
export type { Provenance } from './provenance';


// W2-1: shared pure room presentation derivation.
export {derivePhase,deriveTodos,deriveInboxSection} from './phase';
export type {PhaseInput,PhaseView,Todo} from './phase';

// W1-1F: approval and run-aware action contracts for downstream barrel-only callers.
export { isCurrentForApproval, allApproved, canExecuteNow, type ExecutableResult } from './rules';
export { MAX_PROPOSALS_PER_ROLE_PER_RUN, type ActionCtx } from './protocol';
export * from "./attemptErrors";

export { turnInstruction, type TurnInstructionInput } from './protocol';
