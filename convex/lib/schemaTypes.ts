/** Stored document helpers and field registries for mutation facades (03 §3.3, 12). */
import type { Doc, TableNames } from "../_generated/dataModel";

export type StoredDoc<T extends TableNames> = Doc<T>;
export type InsertFields<T extends TableNames> = Omit<Doc<T>, "_id" | "_creationTime">;
export type RoomScopedTable = Exclude<TableNames, "users" | "opsFlags" | "spendCounters" | "rawOutputs">;
export type RoomDoc = Doc<"rooms">;
export type ProposalDoc = Doc<"proposals">;
export type ApprovalDoc = Doc<"approvals">;
export type Terms = ProposalDoc["terms"];
export type ProposalLine = ProposalDoc["lines"][number];
export type PlannedTask = ProposalDoc["plannedTasks"][number];
export type Candidate = Doc<"turns">["candidateSnapshot"][number];
export type AgentMove = NonNullable<Doc<"turns">["result"]>;
export type EventPayload = Doc<"events">["payload"];
export type EventActor = Doc<"events">["actor"];
export type EventRefs = Doc<"events">["refs"];
export type RestrictedRef = NonNullable<Doc<"events">["restrictedRef"]>;
export type RequestEffect = Doc<"humanRequests">["options"][number]["effect"];

export const MUTABLE_FIELDS = {
  users:         ["displayName", "isTestAccount", "updatedAt"],
  rooms:         ["status", "constraintsVersion", "localDate", "nextProposalVersion", "nextRunNo",
                  "writeSeq", "currentRunId", "executionId", "openedAt", "executedAt", "closedAt"],
  invites:       ["status", "acceptedBy", "acceptedAt"],
  runs:          ["status", "roundNo", "maxRounds", "roundsExtended", "activeTurnSeq", "nextTurnSeq",
                  "currentProposalId", "attemptCount", "reservedMicroUsd", "spentMicroUsd",
                  "endedReason", "lastFailure", "endedAt"],
  turns:         ["status", "currentAttemptNo", "waitingReason", "beginFnId", "result", "outcome", "completedAt"],
  attempts:      ["status", "actionFnId", "watchdogFnId", "watchdogArmCount", "deadlineAt",
                  "usage", "stopReason", "stopCategory", "requestId", "messageId", "responseModel",
                  "latencyMs", "costMicroUsd", "priceTableAsOf", "lateUsage", "errorCode", "issuePaths",
                  "staleGuard", "httpStatus", "retryAfterMs", "rationaleTruncated", "schemaVersion", "move", "outputBytes", "rawOutputRef", "finishedAt"],
  proposals:     ["status", "statusChangedAt"],
  humanRequests: ["status", "answeredBy", "answerOptionKey", "answeredAt", "closedReason", "closedAt"],
  tasks:         ["status", "doneByUserId", "doneAt"],
  opsFlags:      ["draining", "changedAt", "changedBy"],
  spendCounters: ["reservedMicroUsd", "spentMicroUsd", "attempts", "unknownCostAttempts"],
} as const;

// Type-check every field against the generated document, without widening literals.
type FieldRegistry = { [T in TableNames]?: readonly (keyof Doc<T>)[] };
export const MUTABLE_FIELD_NAMES = MUTABLE_FIELDS satisfies FieldRegistry;
export const APPEND_ONLY_TABLES = [
  "briefs", "sharedFacts", "catalogItems", "ledgerEntries", "constraintRevisions",
  "approvals", "executions", "changeOrders", "events",
] as const satisfies readonly TableNames[];
export { REDACTABLE_FIELDS } from "../../core/engine";
export const TERMS_KEY_FIELDS = ["proposals.terms.itemKeys", "proposals.terms.modifiers",
  "proposals.terms.deliveryDate", "proposals.terms.amountCents"] as const;
