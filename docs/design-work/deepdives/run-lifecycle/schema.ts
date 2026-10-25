// convex/schema.ts (excerpt) — run / turn / usage tables.
// roleV, effortV, agentModelOutputV are owned by other topics (03 / 05 / 10) and imported here.
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { roleV } from "./lib/roles"; // first scenario: "customer" | "provider" | "finance"
import { agentModelOutputV } from "./lib/protocolValidators"; // Convex mirror of 05's Zod agentModelOutput
import { effortV } from "./lib/modelConfig"; // "low" | "medium" | "high" | ...

export const RUN_STATUSES = [
  "negotiating",
  "pending_approval",
  "needs_input",
  "failed",
  "superseded",
  "cancelled",
  "confirmed",
] as const;
export const runStatusV = v.union(
  v.literal("negotiating"),
  v.literal("pending_approval"),
  v.literal("needs_input"),
  v.literal("failed"),
  v.literal("superseded"),
  v.literal("cancelled"),
  v.literal("confirmed"),
);

export const runTriggerV = v.union(
  v.literal("initial"), // first run in the room, started by a member
  v.literal("constraint_change"), // 09: bumpConstraints superseded the previous run (first scenario: budget change)
  v.literal("human_answer"), // 05/09: an answered humanRequest changed constraints
  v.literal("restart"), // a member started over after cancelled / failed(call cap)
);

export const runEndReasonV = v.union(
  v.literal("approved_and_executed"),
  v.literal("superseded_by_constraint_change"),
  v.literal("cancelled_by_member"),
  v.literal("turn_failed"),
  v.literal("call_cap_reached"),
  v.literal("room_closed"),
);

export const agentModeV = v.union(v.literal("live"), v.literal("stub"));

export const TURN_STATUSES = ["running", "succeeded", "invalid_output", "failed", "stale"] as const;
export const turnStatusV = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("invalid_output"),
  v.literal("failed"),
  v.literal("stale"),
);

export const turnErrorCodeV = v.union(
  // -> status "invalid_output", auto-retryable
  v.literal("schema_invalid"),
  v.literal("max_tokens"),
  v.literal("rules_rejected"),
  // -> status "failed", auto-retryable (lost action)
  v.literal("timeout"),
  v.literal("action_crashed"),
  // -> status "failed", NOT auto-retryable
  v.literal("api_error"), // SDK exhausted its own retries
  v.literal("refusal"),
  v.literal("bad_request"),
  v.literal("auth_error"),
  v.literal("agents_disabled"),
  v.literal("call_cap_reached"),
  v.literal("room_daily_cap"),
  v.literal("global_daily_cap"),
  v.literal("internal_error"),
  // -> status "stale"
  v.literal("run_superseded"),
  v.literal("run_cancelled"),
  v.literal("guard_rejected"),
);

export const runs = defineTable({
  roomId: v.id("rooms"),
  scenarioKey: v.string(),
  status: runStatusV,
  trigger: runTriggerV,
  agentMode: agentModeV, // snapshot of AGENT_MODE at start
  constraintsVersionAtStart: v.number(),
  round: v.number(), // 0-based
  maxRounds: v.number(), // snapshot from scenario config
  nextTurnSeq: v.number(), // step awaiting persistence
  callCount: v.number(), // attempt rows created (logical calls)
  maxCalls: v.number(), // snapshot of CALL_CAPS.perRunDefault or scenario override
  previousRunId: v.optional(v.id("runs")),
  supersededByRunId: v.optional(v.id("runs")),
  endedReason: v.optional(runEndReasonV),
  startedBy: v.union(
    v.object({ kind: v.literal("user"), userId: v.id("users") }),
    v.object({ kind: v.literal("system") }),
  ),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  updatedAt: v.number(), // patched by every completeTurn / failTurn to force OCC serialization
})
  .index("by_room_and_startedAt", ["roomId", "startedAt"])
  .index("by_status_and_updatedAt", ["status", "updatedAt"]); // ops: stuck runs

export const agentTurns = defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  turnSeq: v.number(), // step number; shared by parallel turns of the same step
  round: v.number(),
  role: roleV,
  attempt: v.number(), // 1-based within (runId, turnSeq, role)
  stepKind: v.union(v.literal("propose"), v.literal("evaluate")), // from 05 planAfterStep
  origin: v.union(
    v.literal("step_start"),
    v.literal("auto_retry"),
    v.object({ kind: v.literal("user_retry"), userId: v.id("users") }),
  ),
  status: turnStatusV,
  agentMode: agentModeV, // == run.agentMode
  constraintsVersion: v.number(), // == run.constraintsVersionAtStart (envelope snapshot)
  baseProposalId: v.optional(v.id("proposals")),
  baseProposalVersion: v.optional(v.number()),
  output: v.optional(agentModelOutputV), // validated output, private to this role (07)
  resultProposalId: v.optional(v.id("proposals")),
  errorCode: v.optional(turnErrorCodeV),
  dispatchRef: v.optional(v.string()), // v1: Id<"_scheduled_functions"> as string; workpool: workId
  createdAt: v.number(),
  deadlineAt: v.number(), // createdAt + WATCHDOG_DELAY_MS
  finishedAt: v.optional(v.number()),
})
  .index("by_run_and_turnSeq_and_role_and_attempt", ["runId", "turnSeq", "role", "attempt"])
  .index("by_room_and_mode_and_createdAt", ["roomId", "agentMode", "createdAt"])
  .index("by_status_and_deadlineAt", ["status", "deadlineAt"]);

export const modelCalls = defineTable({
  roomId: v.id("rooms"),
  runId: v.optional(v.id("runs")),
  turnId: v.optional(v.id("agentTurns")),
  callSite: v.union(v.literal("negotiation_turn"), v.literal("brief_extraction")),
  role: v.optional(roleV),
  attempt: v.optional(v.number()),
  mode: agentModeV,
  outcome: v.union(
    v.literal("accepted"),
    v.literal("invalid_output"),
    v.literal("failed"),
    v.literal("discarded_stale"),
  ),
  modelRequested: v.string(), // "claude-opus-5-5" or "stub:v1"
  modelActual: v.optional(v.string()), // msg.model (may differ when server-side fallback is on)
  effort: v.optional(effortV),
  maxTokens: v.number(),
  stopReason: v.optional(v.string()),
  requestId: v.optional(v.string()), // msg._request_id
  messageId: v.optional(v.string()), // msg.id
  inputTokens: v.optional(v.number()), // uncached remainder only
  cacheCreationInputTokens: v.optional(v.number()),
  cacheReadInputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()), // includes thinking
  thinkingTokens: v.optional(v.number()), // usage.output_tokens_details.thinking_tokens
  fallbackIterations: v.optional(v.number()), // usage.iterations.length when fallback is enabled
  latencyMs: v.number(), // wall clock of the SDK call (all HTTP attempts)
  errorCode: v.optional(turnErrorCodeV),
  httpStatus: v.optional(v.number()),
  day: v.string(), // UTC "YYYY-MM-DD"
  createdAt: v.number(),
})
  .index("by_turn", ["turnId"])
  .index("by_day", ["day"])
  .index("by_room_and_day", ["roomId", "day"]);

export const usageCounters = defineTable({
  key: v.string(), // "global:2026-10-24"; sharded form "global:2026-10-24:3" if contention shows up
  calls: v.number(),
}).index("by_key", ["key"]);

// rooms fields this topic relies on (owned by 03):
//   status: "open" | "closed"
//   currentRunId: v.optional(v.id("runs"))     -- latest run, any status
//   constraintsVersion: v.number()
//   currentProposalId: v.optional(v.id("proposals"))
