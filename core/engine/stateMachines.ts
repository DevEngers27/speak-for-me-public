/**
 * Stored state values, terminal sets, and transition tables for every state machine
 * in canon §1.3 and design doc 04 (§4.1.2, §4.2–4.9).
 *
 * Pure TypeScript: zero runtime dependencies.
 */

export class EngineInvariantError extends Error {
  override readonly name = "EngineInvariantError";
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: string, details?: Readonly<Record<string, unknown>>) {
    const suffix = details ? ` (${JSON.stringify(details)})` : "";
    super(`Engine invariant violated: ${code}${suffix}`);
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// 1. Room (04 §4.2 M1–M6)
// ---------------------------------------------------------------------------

export const ROOM_STATUSES = ["setup", "open", "executed", "closed"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROOM_TERMINAL: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  "executed",
  "closed",
]);

export const ROOM_TRANSITIONS: Readonly<Record<RoomStatus | "none", readonly RoomStatus[]>> = {
  none: ["setup"],
  setup: ["open", "closed"],
  open: ["executed", "closed"],
  executed: [],
  closed: [],
};

// ---------------------------------------------------------------------------
// 2. Run (04 §4.1.2, §4.3.2 R1–R19)
// ---------------------------------------------------------------------------

export const RUN_STATUSES = [
  "negotiating",
  "pending_approval",
  "needs_input",
  "executed",
  "superseded",
  "ended_no_agreement",
  "canceled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "executed",
  "superseded",
  "ended_no_agreement",
  "canceled",
]);

/**
 * Run transitions (04 §4.3.2 R1–R19), including R4 (`negotiating -> negotiating`
 * when advancing to the next turn/round) and R19 (`needs_input -> needs_input`
 * when regenerating a human request after an infeasible candidate choice).
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus | "none", readonly RunStatus[]>> = {
  none: ["negotiating", "pending_approval", "needs_input"],
  negotiating: ["negotiating", "pending_approval", "needs_input", "superseded", "canceled"],
  pending_approval: ["executed", "negotiating", "needs_input", "superseded", "canceled"],
  needs_input: [
    "needs_input",
    "negotiating",
    "pending_approval",
    "superseded",
    "ended_no_agreement",
    "canceled",
  ],
  executed: [],
  superseded: [],
  ended_no_agreement: [],
  canceled: [],
};

// ---------------------------------------------------------------------------
// 3. Turn (04 §4.4 U1–U6)
// ---------------------------------------------------------------------------

export const TURN_STATUSES = ["scheduled", "running", "completed", "failed", "stale"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export const TURN_TERMINAL: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  "completed",
  "failed",
  "stale",
]);

export const TURN_TRANSITIONS: Readonly<Record<TurnStatus | "none", readonly TurnStatus[]>> = {
  none: ["scheduled"],
  scheduled: ["running", "failed", "stale"],
  running: ["completed", "failed", "stale"],
  completed: [],
  failed: [],
  stale: [],
};

// ---------------------------------------------------------------------------
// 4. Attempt (04 §4.5.1 A1–A7)
// ---------------------------------------------------------------------------

export const ATTEMPT_STATUSES = [
  "running",
  "completed",
  "invalid_output",
  "timeout",
  "error",
  "refused",
  "stale",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_TERMINAL: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "completed",
  "invalid_output",
  "timeout",
  "error",
  "refused",
  "stale",
]);

export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptStatus | "none", readonly AttemptStatus[]>> = {
  none: ["running"],
  running: ["completed", "invalid_output", "timeout", "error", "refused", "stale"],
  completed: [],
  invalid_output: [],
  timeout: [],
  error: [],
  refused: [],
  stale: [],
};

// ---------------------------------------------------------------------------
// 5. Proposal (04 §4.6 P1–P6)
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  "active",
  "executed",
  "superseded",
  "rejected",
  "stale",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Note: `stale` is non-terminal within a bump transaction because P5 allows `stale -> active`. */
export const PROPOSAL_TERMINAL: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>([
  "executed",
  "superseded",
  "rejected",
]);

export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus | "none", readonly ProposalStatus[]>> = {
  none: ["active"],
  active: ["executed", "superseded", "rejected", "stale"],
  stale: ["active"],
  executed: [],
  superseded: [],
  rejected: [],
};

// ---------------------------------------------------------------------------
// 6. Approval Decision (04 §4.7)
// ---------------------------------------------------------------------------

export const APPROVAL_DECISION_STATUSES = ["approve", "reject", "withdraw"] as const;
export const APPROVAL_DECISIONS = APPROVAL_DECISION_STATUSES;
export const DECISION_STATUSES = APPROVAL_DECISION_STATUSES;
export const APPROVAL_STATUSES = APPROVAL_DECISION_STATUSES;

export type ApprovalDecision = (typeof APPROVAL_DECISION_STATUSES)[number];
export type ApprovalDecisionStatus = ApprovalDecision;
export type DecisionStatus = ApprovalDecision;

/** On a given proposal, `reject` is final and cannot be withdrawn or overridden (canon D02, 04 §4.7.2). */
export const APPROVAL_DECISION_TERMINAL: ReadonlySet<ApprovalDecision> = new Set<ApprovalDecision>([
  "reject",
]);
export const DECISION_TERMINAL = APPROVAL_DECISION_TERMINAL;
export const APPROVAL_TERMINAL = APPROVAL_DECISION_TERMINAL;

/**
 * Append transitions for a member's latest decision on a proposal (04 §4.7.2):
 * - `none` (pending): may append `approve` or `reject` (withdrawing with no prior approve is a no-op).
 * - `approve` (`effective` or `stale_approve`): may re-approve after bump (`approve`), change mind (`reject`), or `withdraw`.
 * - `withdraw` (`withdrawn`): may subsequently `approve` or `reject`.
 * - `reject`: terminal on that proposal.
 */
export const APPROVAL_DECISION_TRANSITIONS: Readonly<
  Record<ApprovalDecision | "none", readonly ApprovalDecision[]>
> = {
  none: ["approve", "reject"],
  approve: ["approve", "reject", "withdraw"],
  withdraw: ["approve", "reject"],
  reject: [],
};
export const DECISION_TRANSITIONS = APPROVAL_DECISION_TRANSITIONS;
export const APPROVAL_TRANSITIONS = APPROVAL_DECISION_TRANSITIONS;

// ---------------------------------------------------------------------------
// 7. HumanRequest (04 §4.8.1 H1–H4)
// ---------------------------------------------------------------------------

export const HUMAN_REQUEST_STATUSES = ["open", "answered", "expired", "superseded"] as const;
export const REQUEST_STATUSES = HUMAN_REQUEST_STATUSES;

export type HumanRequestStatus = (typeof HUMAN_REQUEST_STATUSES)[number];
export type RequestStatus = HumanRequestStatus;

export const HUMAN_REQUEST_TERMINAL: ReadonlySet<HumanRequestStatus> = new Set<HumanRequestStatus>([
  "answered",
  "expired",
  "superseded",
]);
export const REQUEST_TERMINAL = HUMAN_REQUEST_TERMINAL;

export const HUMAN_REQUEST_TRANSITIONS: Readonly<
  Record<HumanRequestStatus | "none", readonly HumanRequestStatus[]>
> = {
  none: ["open"],
  open: ["answered", "expired", "superseded"],
  answered: [],
  expired: [],
  superseded: [],
};
export const REQUEST_TRANSITIONS = HUMAN_REQUEST_TRANSITIONS;

// ---------------------------------------------------------------------------
// 8. CatalogItem (04 §4.9 C1–C3)
// ---------------------------------------------------------------------------

export const CATALOG_ITEM_STATUSES = ["draft", "confirmed", "retired"] as const;
export const CATALOG_STATUSES = CATALOG_ITEM_STATUSES;

export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number];
export type CatalogStatus = CatalogItemStatus;

export const CATALOG_ITEM_TERMINAL: ReadonlySet<CatalogItemStatus> = new Set<CatalogItemStatus>([
  "retired",
]);
export const CATALOG_TERMINAL = CATALOG_ITEM_TERMINAL;

export const CATALOG_ITEM_TRANSITIONS: Readonly<
  Record<CatalogItemStatus | "none", readonly CatalogItemStatus[]>
> = {
  none: ["draft", "confirmed"],
  draft: ["confirmed"],
  confirmed: ["retired"],
  retired: [],
};
export const CATALOG_TRANSITIONS = CATALOG_ITEM_TRANSITIONS;

// ---------------------------------------------------------------------------
// 9. Task (04 §4.9 T1–T2)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["done"]);

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus | "none", readonly TaskStatus[]>> = {
  none: ["open"],
  open: ["done"],
  done: [],
};

// ---------------------------------------------------------------------------
// Unified machine registry & transition assertion (04 §4.1.2)
// ---------------------------------------------------------------------------

export const TRANSITIONS = {
  room: ROOM_TRANSITIONS,
  run: RUN_TRANSITIONS,
  turn: TURN_TRANSITIONS,
  attempt: ATTEMPT_TRANSITIONS,
  proposal: PROPOSAL_TRANSITIONS,
  approvalDecision: APPROVAL_DECISION_TRANSITIONS,
  approval: APPROVAL_DECISION_TRANSITIONS,
  decision: APPROVAL_DECISION_TRANSITIONS,
  humanRequest: HUMAN_REQUEST_TRANSITIONS,
  request: HUMAN_REQUEST_TRANSITIONS,
  catalogItem: CATALOG_ITEM_TRANSITIONS,
  catalog: CATALOG_ITEM_TRANSITIONS,
  task: TASK_TRANSITIONS,
} as const;

export type Machine = keyof typeof TRANSITIONS;

export type To<M extends Machine> = Exclude<keyof (typeof TRANSITIONS)[M], "none"> & string;
export type From<M extends Machine> = keyof (typeof TRANSITIONS)[M] & string;

export function canTransition<M extends Machine>(m: M, from: From<M>, to: To<M>): boolean {
  const table = TRANSITIONS[m] as Readonly<Record<string, readonly string[]>> | undefined;
  if (!table) return false;
  const allowed = Object.hasOwn(table, from) ? table[from] : undefined;
  return Array.isArray(allowed) && allowed.includes(to);
}

export function assertTransition<M extends Machine>(m: M, from: From<M>, to: To<M>): void {
  if (!canTransition(m, from, to)) {
    throw new EngineInvariantError("state.illegal_transition", { m, from, to });
  }
}
