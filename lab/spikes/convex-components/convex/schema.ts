import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vRole = v.union(
  v.literal("customer"),
  v.literal("provider"),
  v.literal("finance"),
);
export const ROLES = ["customer", "provider", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const vRunStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

// Stub-model behaviour plan, keyed by `${round}:${role}`. Test-only knob.
export const vFailMode = v.union(
  v.literal("transient"), // throw a retryable error `times` times
  v.literal("fatal"), // throw a non-retryable error (e.g. refusal / schema)
  v.literal("lost"), // chain only: action "dies" without reporting (watchdog path)
  v.literal("budgetCutDuring"), // cut budget while the model call is in flight
);
export const vFailPlanEntry = v.object({
  key: v.string(),
  mode: vFailMode,
  times: v.number(),
});

export const vProposal = v.object({
  role: vRole,
  action: v.union(v.literal("propose"), v.literal("counter"), v.literal("recommend_accept")),
  priceCents: v.number(),
  scopeItemIds: v.array(v.string()),
});

export default defineSchema({
  rooms: defineTable({
    name: v.string(),
    budgetCents: v.number(),
    constraintVersion: v.number(),
    activeRunId: v.optional(v.id("runs")),
  }),
  runs: defineTable({
    roomId: v.id("rooms"),
    engine: v.union(v.literal("chain"), v.literal("workflow")),
    constraintVersion: v.number(),
    rounds: v.number(),
    status: vRunStatus,
    // next turn to execute (chain engine bookkeeping); workflow keeps it in its journal
    nextTurnIndex: v.number(),
    workflowId: v.optional(v.string()),
    failPlan: v.array(vFailPlanEntry),
    endReason: v.optional(v.string()),
  }).index("by_room", ["roomId"]),
  // One row per *attempt* of a turn (chain engine). Workflow engine keeps attempts in workpool.
  attempts: defineTable({
    runId: v.id("runs"),
    turnIndex: v.number(),
    attempt: v.number(),
    status: v.union(
      v.literal("inFlight"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("timedOut"),
      v.literal("stale"),
      v.literal("canceled"),
    ),
    actionFnId: v.optional(v.id("_scheduled_functions")),
    watchdogFnId: v.optional(v.id("_scheduled_functions")),
    retrierRunId: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_run_turn", ["runId", "turnIndex", "attempt"])
    .index("by_retrier_run", ["retrierRunId"]),
  // Committed, validated turn output (append-only). Shared by both engines.
  turns: defineTable({
    runId: v.id("runs"),
    turnIndex: v.number(),
    round: v.number(),
    role: vRole,
    constraintVersion: v.number(),
    proposal: vProposal,
  }).index("by_run_turn", ["runId", "turnIndex"]),
  // Rejections and usage of discarded results (stale/invalid), for audit.
  rejections: defineTable({
    runId: v.id("runs"),
    turnIndex: v.number(),
    reasonCode: v.string(),
  }).index("by_run", ["runId"]),
  // Stub bookkeeping: how many times the stub model was invoked per key.
  stubCalls: defineTable({ runId: v.id("runs"), key: v.string(), calls: v.number() }).index(
    "by_run_key",
    ["runId", "key"],
  ),
});
