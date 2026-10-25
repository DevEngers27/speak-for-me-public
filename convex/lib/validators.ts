import { ATTEMPT_ERROR_CODES, type AttemptErrorCode } from '../../core/engine';
/**
 * Convex validators derived from the canonical `core/engine/*` arrays,
 * with compile-time bidirectional type-equality assertions (03 §3.2, §3.4; 04 §4.1.2; 06 §6.2).
 */
import { type Infer, v } from "convex/values";
import { z } from "zod";
import {
  ERROR_CODES,
  ESCALATE_KINDS,
  type EscalateKind,
  MODEL_ACTIONS,
  type ModelAction,
  ROLES,
  type Role,
  TURN_KINDS,
  type TurnKind,
} from "../../core/engine";
import { REASON_CODES, type ReasonCode } from "../../core/engine";
import {
  APPROVAL_DECISION_STATUSES,
  type ApprovalDecision,
  ATTEMPT_STATUSES,
  type AttemptStatus,
  CATALOG_ITEM_STATUSES,
  type CatalogItemStatus,
  HUMAN_REQUEST_STATUSES,
  type HumanRequestStatus,
  PROPOSAL_STATUSES,
  type ProposalStatus,
  ROOM_STATUSES,
  type RoomStatus,
  RUN_STATUSES,
  type RunStatus,
  TASK_STATUSES,
  type TaskStatus,
  TURN_STATUSES,
  type TurnStatus,
} from "../../core/engine";

/**
 * Derives a `v.union(v.literal(...), ...)` validator directly from a `readonly [string, string, ...]`
 * tuple while preserving the exact union of string literal types for `Infer<...>`.
 */
export function literalUnionValidator<const T extends readonly [string, string, ...string[]]>(
  values: T,
) {
  const [first, second, ...rest] = values;
  return v.union(
    v.literal(first as T[number]),
    v.literal(second as T[number]),
    ...rest.map((item) => v.literal(item as T[number])),
  );
}

// ---------------------------------------------------------------------------
// Reason code validator (06 §6.2, 03 §3.4)
// ---------------------------------------------------------------------------

export const reasonCodeV = literalUnionValidator(REASON_CODES);
export const vReasonCode = reasonCodeV;

// ---------------------------------------------------------------------------
// State machine status validators (04 §4.1.2, canon §1.3)
// ---------------------------------------------------------------------------

export const roomStatusV = literalUnionValidator(ROOM_STATUSES);
export const runStatusV = literalUnionValidator(RUN_STATUSES);
export const turnStatusV = literalUnionValidator(TURN_STATUSES);
export const attemptStatusV = literalUnionValidator(ATTEMPT_STATUSES);
export const proposalStatusV = literalUnionValidator(PROPOSAL_STATUSES);

export const approvalDecisionV = literalUnionValidator(APPROVAL_DECISION_STATUSES);
export const decisionV = approvalDecisionV;

export const humanRequestStatusV = literalUnionValidator(HUMAN_REQUEST_STATUSES);
export const requestStatusV = humanRequestStatusV;

export const catalogItemStatusV = literalUnionValidator(CATALOG_ITEM_STATUSES);
export const catalogStatusV = catalogItemStatusV;

export const taskStatusV = literalUnionValidator(TASK_STATUSES);

// ---------------------------------------------------------------------------
// Action, role & turn-kind validators (canon §1.4, 03 §3.4)
// ---------------------------------------------------------------------------

export const roleV = literalUnionValidator(ROLES);
export const turnKindV = literalUnionValidator(TURN_KINDS);
export const modelActionV = literalUnionValidator(MODEL_ACTIONS);
export const agentActionV = modelActionV;
export const escalateKindV = literalUnionValidator(ESCALATE_KINDS);

// ---------------------------------------------------------------------------
// Bidirectional compile-time type-equality assertions
// ---------------------------------------------------------------------------

export type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type Expect<T extends true> = T;

type _ReasonCodeSync = Expect<Equals<Infer<typeof reasonCodeV>, ReasonCode>>;
type _RoomStatusSync = Expect<Equals<Infer<typeof roomStatusV>, RoomStatus>>;
type _RunStatusSync = Expect<Equals<Infer<typeof runStatusV>, RunStatus>>;
type _TurnStatusSync = Expect<Equals<Infer<typeof turnStatusV>, TurnStatus>>;
type _AttemptStatusSync = Expect<Equals<Infer<typeof attemptStatusV>, AttemptStatus>>;
type _ProposalStatusSync = Expect<Equals<Infer<typeof proposalStatusV>, ProposalStatus>>;
type _ApprovalDecisionSync = Expect<Equals<Infer<typeof approvalDecisionV>, ApprovalDecision>>;
type _HumanRequestStatusSync = Expect<Equals<Infer<typeof humanRequestStatusV>, HumanRequestStatus>>;
type _CatalogItemStatusSync = Expect<Equals<Infer<typeof catalogItemStatusV>, CatalogItemStatus>>;
type _TaskStatusSync = Expect<Equals<Infer<typeof taskStatusV>, TaskStatus>>;
type _RoleSync = Expect<Equals<Infer<typeof roleV>, Role>>;
type _TurnKindSync = Expect<Equals<Infer<typeof turnKindV>, TurnKind>>;
type _ModelActionSync = Expect<Equals<Infer<typeof modelActionV>, ModelAction>>;
type _EscalateKindSync = Expect<Equals<Infer<typeof escalateKindV>, EscalateKind>>;

export const VALIDATOR_TYPE_ASSERTIONS: readonly [
  _ReasonCodeSync,
  _RoomStatusSync,
  _RunStatusSync,
  _TurnStatusSync,
  _AttemptStatusSync,
  _ProposalStatusSync,
  _ApprovalDecisionSync,
  _HumanRequestStatusSync,
  _CatalogItemStatusSync,
  _TaskStatusSync,
  _RoleSync,
  _TurnKindSync,
  _ModelActionSync,
  _EscalateKindSync,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true] as const;

// Convex v.string has no regex refinement. Writes must call parseItemKey as
// well as declaring itemKeyV; this is the semantic boundary shared by fixtures.
export const itemKeyV = v.string();
export { assertItemKey as parseItemKey } from '../../core/engine';
export const errorCodeV = literalUnionValidator(ERROR_CODES);

// W1-1F: aliases and Zod enums share the same canonical tuples.
export const vErrorCode = errorCodeV;
export const zReasonCode = z.enum(REASON_CODES);
export const zErrorCode = z.enum(ERROR_CODES);
export const attemptErrorCodeV = literalUnionValidator(ATTEMPT_ERROR_CODES);
const attemptErrorCodeMatches: Expect<Equals<Infer<typeof attemptErrorCodeV>, AttemptErrorCode>> = true;
void attemptErrorCodeMatches;

import {RATE_USER_BUCKETS,BRIEF_SOURCES} from '../../core/engine';
export const rateUserV=literalUnionValidator(RATE_USER_BUCKETS);
export const briefSourceV=literalUnionValidator(BRIEF_SOURCES);
