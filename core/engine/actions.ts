/**
 * Model action enum, payload shapes per role × turn kind (canon §1.4, 05 §5.3),
 * and runtime allow-list `actionAllowed(role, turnKind, action)`.
 *
 * Pure TypeScript: zero runtime dependencies.
 */

export const ROLES = ["customer", "provider", "finance"] as const;
export type Role = (typeof ROLES)[number];
export type RoleKey = Role;

export const TURN_KINDS = ["propose", "evaluate"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export const MODEL_ACTIONS = [
  "propose",
  "counter",
  "clarify",
  "recommend_accept",
  "reject",
  "escalate",
] as const;
export const AGENT_ACTIONS = MODEL_ACTIONS;

export type ModelAction = (typeof MODEL_ACTIONS)[number];
export type AgentAction = ModelAction;

export const ESCALATE_KINDS = ["infeasible", "needs_tradeoff"] as const;
export type EscalateKind = (typeof ESCALATE_KINDS)[number];

// ---------------------------------------------------------------------------
// Action payload shapes (canon §1.4)
// ---------------------------------------------------------------------------

export interface ProposeAction {
  readonly action: "propose";
  readonly optionKey: string;
  readonly rationale: string;
}

export interface CounterAction {
  readonly action: "counter";
  readonly optionKey: string;
  readonly baseProposalVersion: number;
  readonly rationale: string;
}

export interface ClarifyAction<TRole extends string = Role, TTopic extends string = string> {
  readonly action: "clarify";
  readonly toRole: TRole;
  readonly topicKey: TTopic;
  readonly rationale: string;
}

export interface RecommendAcceptAction {
  readonly action: "recommend_accept";
  readonly proposalVersion: number;
  readonly rationale: string;
}

/** Provider in a `propose` turn may only reject with `reasonKey: 'cannot_deliver'` (canon §1.4, 05 §5.3.1). */
export interface ProviderProposeRejectAction {
  readonly action: "reject";
  readonly proposalVersion: number | null;
  readonly reasonKey: "cannot_deliver";
  readonly rationale: string;
}

/** Evaluator in an `evaluate` turn rejects a specific `proposalVersion`. */
export interface EvaluateRejectAction<TReason extends string = string> {
  readonly action: "reject";
  readonly proposalVersion: number;
  readonly reasonKey: TReason;
  readonly rationale: string;
}

export interface RejectAction<TReason extends string = string> {
  readonly action: "reject";
  readonly proposalVersion: number | null;
  readonly reasonKey: TReason;
  readonly rationale: string;
}

export interface EscalateAction<TRole extends string = Role> {
  readonly action: "escalate";
  readonly kind: EscalateKind;
  readonly toRole: TRole;
  readonly rationale: string;
}

/** Union of all model turn actions (canon §1.4). */
export type AgentModelOutput =
  | ProposeAction
  | CounterAction
  | ClarifyAction
  | RecommendAcceptAction
  | RejectAction
  | EscalateAction;

export type AgentMove = AgentModelOutput;

/** Root wrapper required by structured-output JSON Schema (canon §1.4, D09). */
export interface AgentModelOutputRoot<T extends AgentModelOutput = AgentModelOutput> {
  readonly turn: T;
}

// ---------------------------------------------------------------------------
// Narrowed payload shapes per role × turn kind (canon §1.4, 05 §5.3.2)
// ---------------------------------------------------------------------------

export type ProviderProposeOutput =
  | ProposeAction
  | ClarifyAction
  | ProviderProposeRejectAction
  | EscalateAction;

export type CustomerEvaluateOutput =
  | RecommendAcceptAction
  | CounterAction
  | ClarifyAction
  | EvaluateRejectAction
  | EscalateAction;

export type FinanceEvaluateOutput =
  | RecommendAcceptAction
  | ClarifyAction
  | EvaluateRejectAction
  | EscalateAction;

export interface ActionPayloadByRoleAndTurn {
  readonly provider: {
    readonly propose: ProviderProposeOutput;
    readonly evaluate: never;
  };
  readonly customer: {
    readonly propose: never;
    readonly evaluate: CustomerEvaluateOutput;
  };
  readonly finance: {
    readonly propose: never;
    readonly evaluate: FinanceEvaluateOutput;
  };
}

export type AllowedOutputFor<R extends Role, K extends TurnKind> = ActionPayloadByRoleAndTurn[R][K];

// ---------------------------------------------------------------------------
// Runtime allow-list (canon §1.4, 05 §5.3.2)
// ---------------------------------------------------------------------------

export const BASE_ACTIONS: Readonly<
  Record<Role, Readonly<Record<TurnKind, readonly ModelAction[]>>>
> = {
  provider: {
    propose: ["propose", "clarify", "reject", "escalate"],
    evaluate: [],
  },
  customer: {
    propose: [],
    evaluate: ["recommend_accept", "counter", "reject", "clarify", "escalate"],
  },
  finance: {
    propose: [],
    evaluate: ["recommend_accept", "reject", "clarify", "escalate"],
  },
};

const MODEL_ACTION_SET: ReadonlySet<string> = new Set<string>(MODEL_ACTIONS);

export function isModelAction(value: unknown): value is ModelAction {
  return typeof value === "string" && MODEL_ACTION_SET.has(value);
}

export interface ActionAllowedOptions {
  /** Optional `reasonKey` check for `reject` (provider propose turn only allows `'cannot_deliver'`). */
  readonly reasonKey?: string;
}

/**
 * Runtime allow-list check for `(role, turnKind, action)` per canon §1.4:
 * - `provider` + `propose`: `propose`, `clarify`, `reject` (`cannot_deliver`), `escalate`
 * - `customer` + `evaluate`: `recommend_accept`, `counter`, `reject`, `clarify`, `escalate`
 * - `finance` + `evaluate`: `recommend_accept`, `reject`, `clarify`, `escalate` (finance cannot `counter`)
 * - All other `(role, turnKind)` combinations: `false`.
 */
export function actionAllowed(
  role: Role,
  turnKind: TurnKind,
  action: ModelAction,
  options?: ActionAllowedOptions,
): boolean {
  const byTurn = Object.hasOwn(BASE_ACTIONS, role) ? BASE_ACTIONS[role] : undefined;
  if (!byTurn) return false;
  const allowed = Object.hasOwn(byTurn, turnKind) ? byTurn[turnKind] : undefined;
  if (!allowed || !allowed.includes(action)) return false;

  if (
    action === "reject" &&
    role === "provider" &&
    turnKind === "propose" &&
    options?.reasonKey !== undefined
  ) {
    return options.reasonKey === "cannot_deliver";
  }

  return true;
}

/** Returns the static list of allowed actions for `(role, turnKind)`. */
export function allowedActionsFor(role: Role, turnKind: TurnKind): readonly ModelAction[] {
  const byTurn = Object.hasOwn(BASE_ACTIONS, role) ? BASE_ACTIONS[role] : undefined;
  if (!byTurn) return [];
  return Object.hasOwn(byTurn, turnKind) ? byTurn[turnKind] : [];
}
