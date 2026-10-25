// frontend-ia/view-models.ts
// View-model return validators for public queries consumed by the frontend.
// Table and field names follow the review findings (F03/F08/F09); final names come from 03-schema.
// Every public query declares `returns` with these validators. Role-sensitive parts are
// discriminated unions so a provider object cannot carry budget amounts at the type level.

import { v, type Infer } from "convex/values";

export const roleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));
export const approvalKindV = v.union(v.literal("terms"), v.literal("budget"));

// UI phase is DERIVED (see projection.ts derivePhase); it is never stored.
export const roomPhaseV = v.union(
  v.literal("setup"), // members or required briefs/budget missing
  v.literal("negotiating"), // an active run is queued or drafting
  v.literal("needs_input"), // an open humanRequest blocks progress
  v.literal("awaiting_approval"), // current proposal executable, approvals missing
  v.literal("blocked"), // current proposal exists but is not executable and no run/request is active
  v.literal("executed"), // current round executed
  v.literal("closed"),
);

// Reason codes come from 06; the frontend only maps them to per-audience copy (copy.ts).
export const reasonCodeV = v.string();

export const versionTagV = v.object({
  proposalVersion: v.union(v.number(), v.null()),
  constraintsVersion: v.number(),
});

// ---------- todos ----------
export const todoKindV = v.union(
  v.literal("join_room"),
  v.literal("confirm_brief"),
  v.literal("confirm_budget"), // finance has not confirmed a budget yet
  v.literal("review_extraction"),
  v.literal("answer_request"),
  v.literal("decide_proposal"),
  v.literal("redecide_proposal"), // my earlier decision no longer applies
  v.literal("confirm_offer"), // provider has draft offers not confirmed
  v.literal("retry_run"), // run failed and viewer may retry
);
export const todoV = v.object({
  kind: todoKindV,
  priority: v.number(), // lower = more urgent; frontend sorts only
  refs: v.object({
    proposalId: v.optional(v.id("proposals")),
    proposalVersion: v.optional(v.number()),
    requestId: v.optional(v.id("humanRequests")),
    runId: v.optional(v.id("runs")),
  }),
});

// ---------- proposal card ----------
export const lineItemV = v.object({
  itemKey: v.string(),
  label: v.string(), // from scenario catalog
  status: v.union(v.literal("included"), v.literal("deferred")),
});
export const sourceRefV = v.object({
  kind: v.union(v.literal("offer"), v.literal("catalog"), v.literal("brief_fact")),
  label: v.string(), // e.g. "Provider offer phase-1 v2 (confirmed 2026-10-20)"
  version: v.number(),
  isSimulated: v.boolean(),
});
export const checkResultV = v.object({
  ruleKey: v.string(),
  passed: v.boolean(),
  reasonCode: v.union(reasonCodeV, v.null()),
  // params are already audience-projected by the server; no other party's private values
  params: v.record(v.string(), v.union(v.string(), v.number())),
});
export const recordsPreviewV = v.object({
  changeOrderTitle: v.string(),
  taskCount: v.number(),
  myTaskTitles: v.array(v.string()),
  // present only for viewers allowed to see commitment amounts
  commitmentCents: v.optional(v.number()),
});
export const myAgentSuggestionV = v.object({
  action: v.union(v.literal("recommend_accept"), v.literal("recommend_reject")),
  proposalVersion: v.number(),
  rationale: v.string(), // own-side only (F05.3)
  turnId: v.id("agentTurns"),
  isSimulated: v.boolean(), // stub turn
});
export const proposalCardV = v.object({
  proposalId: v.id("proposals"),
  version: v.number(),
  basedOnConstraintsVersion: v.number(),
  checkedAgainstConstraintsVersion: v.number(), // == room.constraintsVersion at query time
  originLabel: v.string(), // "Agent negotiation, round 2" | "Seeded fixture (simulated)"
  isSimulated: v.boolean(),
  publicSummary: v.string(), // template-generated only (F05.3)
  items: v.array(lineItemV),
  additionalCostCents: v.number(), // the proposal price is public once referenced
  deliveryDate: v.string(), // ISO date-only "YYYY-MM-DD"; never parse with new Date()
  sources: v.array(sourceRefV),
  diffFromPrevious: v.union(
    v.null(),
    v.object({ previousVersion: v.number(), changes: v.array(v.string()) }),
  ),
  checks: v.array(checkResultV),
  isExecutable: v.boolean(),
  blockedReasonCodes: v.array(reasonCodeV),
  recordsPreview: recordsPreviewV,
  myDecision: v.object({
    kind: approvalKindV, // which button: "Accept terms" vs "Approve budget commitment"
    canDecide: v.boolean(),
    disabledReasonCode: v.union(v.string(), v.null()),
    current: v.union(v.literal("approve"), v.literal("reject"), v.null()),
  }),
  myAgentSuggestion: v.union(myAgentSuggestionV, v.null()),
});

export const proposalRowV = v.object({
  proposalId: v.id("proposals"),
  version: v.number(),
  basedOnConstraintsVersion: v.number(),
  itemsSummary: v.string(),
  additionalCostCents: v.number(),
  deliveryDate: v.string(),
  rowStatus: v.union(
    v.literal("current"),
    v.literal("executed"),
    v.literal("superseded"),
    v.literal("blocked"),
  ),
  statusReasonCode: v.union(reasonCodeV, v.null()),
  // buyer-side only: total committed after this proposal, per disclosure matrix (07)
  totalAfterCents: v.optional(v.number()),
});

// ---------- approvals ----------
export const approvalSlotStateV = v.union(
  v.literal("pending"),
  v.literal("approved"), // approve on current proposal + current constraints
  v.literal("rejected"), // reject on current proposal + current constraints
  v.literal("stale_approved"), // latest decision was approve, but on an older proposal/constraints
  v.literal("stale_rejected"),
);
export const approvalSlotV = v.object({
  role: roleV,
  kind: approvalKindV,
  displayName: v.union(v.string(), v.null()), // null if seat not yet joined
  isMe: v.boolean(),
  state: approvalSlotStateV,
  lastDecision: v.union(
    v.null(),
    v.object({
      decision: v.union(v.literal("approve"), v.literal("reject")),
      proposalVersion: v.number(),
      constraintsVersion: v.number(),
      decidedAt: v.number(),
      staleBecause: v.union(
        v.null(),
        v.literal("constraints_changed"),
        v.literal("newer_proposal"),
      ),
      // reject reason template key; free text only to the decider and room per 08
      reasonKey: v.union(v.string(), v.null()),
    }),
  ),
});
export const approvalPanelV = v.object({
  proposalVersion: v.union(v.number(), v.null()),
  constraintsVersion: v.number(),
  slots: v.array(approvalSlotV), // one per REQUIRED_APPROVER_ROLES snapshot on the proposal
  allApproved: v.boolean(),
});

// ---------- budget (discriminated by visibility; see 07) ----------
export const budgetViewV = v.union(
  v.object({ visibility: v.literal("unset") }), // finance has not confirmed a budget yet
  v.object({
    visibility: v.literal("amounts"),
    capCents: v.number(),
    committedCents: v.number(),
    proposalCents: v.union(v.number(), v.null()),
    totalAfterCents: v.union(v.number(), v.null()),
    headroomCents: v.number(), // cap - committed (may be 0)
    shortfallCents: v.union(v.number(), v.null()), // > 0 only when over cap
    status: v.union(v.literal("within"), v.literal("over"), v.literal("no_proposal")),
    canEdit: v.boolean(), // finance only
  }),
  v.object({
    visibility: v.literal("verdict"), // provider
    status: v.union(v.literal("within"), v.literal("over"), v.literal("no_proposal")),
  }),
);

// ---------- run, requests, facts, participants ----------
export const runStatusV = v.object({
  runId: v.id("runs"),
  round: v.number(),
  status: v.union(
    v.literal("queued"),
    v.literal("drafting"),
    v.literal("awaiting_human"),
    v.literal("failed"),
    v.literal("completed"),
    v.literal("superseded"),
  ),
  trigger: v.string(), // "briefs_confirmed" | "budget_change" | "rejection" | "human_answer" ...
  activeRole: v.union(roleV, v.null()), // whose agent is drafting now
  turnsCompleted: v.number(),
  maxTurns: v.number(),
  staleTurnsDiscarded: v.number(),
  canRetry: v.boolean(),
  isSimulated: v.boolean(), // stub mode
  startedAt: v.number(),
});
export const requestOptionV = v.object({
  optionKey: v.string(),
  label: v.string(), // template output; may contain the target's own private numbers
  mode: v.union(v.literal("apply"), v.literal("edit_brief"), v.literal("decline")),
  consequences: v.array(v.string()), // template output
  changesConstraints: v.boolean(),
  editTarget: v.optional(v.string()), // brief section anchor for edit_brief
});
export const requestViewV = v.union(
  v.object({
    kind: v.literal("mine"),
    requestId: v.id("humanRequests"),
    question: v.string(),
    contextLines: v.array(v.string()),
    options: v.array(requestOptionV),
    openedAt: v.number(),
    expiresAt: v.union(v.number(), v.null()),
    constraintsVersion: v.number(),
  }),
  v.object({
    kind: v.literal("waiting"),
    requestId: v.id("humanRequests"),
    targetRole: roleV,
    openedAt: v.number(),
  }),
);
export const sharedFactV = v.object({
  ownerRole: roleV,
  field: v.string(), // fixed vocabulary from scenario (F07.7)
  label: v.string(),
  value: v.string(), // already formatted for display
  briefVersion: v.number(),
});
export const participantV = v.object({
  role: roleV,
  displayName: v.union(v.string(), v.null()),
  joined: v.boolean(),
  isMe: v.boolean(),
  briefVersion: v.union(v.number(), v.null()),
  briefConfirmedAt: v.union(v.number(), v.null()),
});
export const constraintChangeV = v.object({
  toVersion: v.number(),
  fromVersion: v.number(),
  changedAt: v.number(),
  byRole: roleV,
  source: v.union(
    v.literal("budget"),
    v.literal("brief"),
    v.literal("offer"),
    v.literal("request_answer"),
  ),
  invalidatedSlots: v.array(roleV), // whose latest approval stopped applying
  proposalNowBlocked: v.boolean(),
});

// ---------- aggregate ----------
export const roomViewV = v.union(
  v.null(), // unauthenticated, not a member, or not found: indistinguishable on purpose
  v.object({
    viewer: v.object({
      role: roleV,
      displayName: v.string(),
      isOwner: v.boolean(),
    }),
    room: v.object({
      roomId: v.id("rooms"),
      title: v.string(),
      goal: v.string(),
      scenarioKey: v.string(),
      isSimulated: v.boolean(),
      round: v.number(),
    }),
    versions: versionTagV,
    phase: roomPhaseV,
    phaseReasonCodes: v.array(reasonCodeV),
    todos: v.array(todoV),
    currentProposal: v.union(proposalCardV, v.null()),
    proposalHistory: v.array(proposalRowV), // newest first, capped (e.g. 20)
    approvals: approvalPanelV,
    budget: budgetViewV,
    run: v.union(runStatusV, v.null()),
    requests: v.array(requestViewV),
    sharedFacts: v.array(sharedFactV),
    participants: v.array(participantV),
    lastConstraintChange: v.union(constraintChangeV, v.null()),
    execution: v.union(
      v.null(),
      v.object({ changeOrderId: v.id("changeOrders"), proposalVersion: v.number(), executedAt: v.number() }),
    ),
  }),
);

export type RoomView = NonNullable<Infer<typeof roomViewV>>;
export type BudgetView = Infer<typeof budgetViewV>;
export type ApprovalSlot = Infer<typeof approvalSlotV>;
export type Todo = Infer<typeof todoV>;
export type RequestView = Infer<typeof requestViewV>;
