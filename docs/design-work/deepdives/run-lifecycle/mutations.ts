// convex/agentRuntime.ts (mutations part, sketch). Public = needs identity; internal = scheduler/action only.
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { TURN_BUDGET } from "./agentRuntime/budget";
import { ERROR_POLICY, ACTIVE_RUN_STATUSES, assertRunTransition, assertTurnTransition, type TurnErrorCode } from "./lib/state";
import {
  checkPersistGuards, createAttempt, failRun, startRunInternal, staleRunningTurns, applyDecision, beginStep,
} from "./agentRuntime/lifecycle";
import { requireRoomMember } from "./lib/authz"; // 07
import { validateAgentOutput } from "./engine/rules"; // 06
import { persistTurnOutput, planAfterStep } from "./engine/protocol"; // 05
import { assertRoomReadyForRun, getScenario } from "./engine/scenario"; // 06/14
import { appendEvent } from "./engine/events";
import { insertModelCall, usageV } from "./agentRuntime/usage";
import { agentModelOutputV } from "./lib/protocolValidators";
import { turnErrorCodeV } from "./schema";

// ---------- public ----------
export const startRun = mutation({
  args: { roomId: v.id("rooms") },
  returns: v.object({ runId: v.id("runs"), created: v.boolean() }),
  handler: async (ctx, { roomId }) => {
    const { room, user } = await requireRoomMember(ctx, roomId); // any member role may start
    if (room.status !== "open") throw new Error("ROOM_CLOSED");
    if (room.currentRunId) {
      const cur = (await ctx.db.get("runs", room.currentRunId))!;
      if (ACTIVE_RUN_STATUSES.has(cur.status)) return { runId: cur._id, created: false }; // idempotent
    }
    await assertRoomReadyForRun(ctx, room); // 06: required briefs confirmed, catalog present, etc.
    const scenario = getScenario(room.scenarioKey);
    const runId = await startRunInternal(ctx, {
      room, trigger: room.currentRunId ? "restart" : "initial", startedBy: { kind: "user", userId: user._id },
      previousRunId: room.currentRunId, scenario,
    });
    return { runId, created: true };
  },
});

export const retryTurn = mutation({
  args: { runId: v.id("runs") },
  returns: v.object({ retried: v.number() }),
  handler: async (ctx, { runId }) => {
    const run = (await ctx.db.get("runs", runId))!;
    const { room, user } = await requireRoomMember(ctx, run.roomId);
    if (room.currentRunId !== runId) throw new Error("RUN_NOT_CURRENT");
    if (run.status !== "failed") return { retried: 0 }; // idempotent: already negotiating again
    const latest = await latestAttemptsOfStep(ctx, run);
    const toRetry = latest.filter((t) => t.status === "failed" || t.status === "invalid_output");
    if (toRetry.length === 0) return { retried: 0 };
    assertRunTransition("failed", "negotiating");
    await ctx.db.patch("runs", runId, { status: "negotiating", endedReason: undefined, updatedAt: Date.now() });
    let n = 0;
    for (const t of toRetry) {
      const fresh = (await ctx.db.get("runs", runId))!;
      const r = await createAttempt(ctx, fresh, { turnSeq: t.turnSeq, role: t.role, stepKind: t.stepKind,
        base: t.baseProposalId ? { id: t.baseProposalId, version: t.baseProposalVersion! } : undefined },
        t.attempt + 1, { kind: "user_retry", userId: user._id });
      if ("capError" in r) { await failRun(ctx, runId, r.capError); return { retried: n }; }
      n++;
    }
    return { retried: n };
  },
});

export const cancelRun = mutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = (await ctx.db.get("runs", runId))!;
    const { user } = await requireRoomMember(ctx, run.roomId);
    if (!ACTIVE_RUN_STATUSES.has(run.status)) return null; // idempotent
    assertRunTransition(run.status, "cancelled");
    await ctx.db.patch("runs", runId, { status: "cancelled", endedReason: "cancelled_by_member", endedAt: Date.now(), updatedAt: Date.now() });
    await staleRunningTurns(ctx, runId, "run_cancelled");
    // 05/09 helper: cancel open humanRequests of this run. No scheduler.cancel (D7).
    await appendEvent(ctx, { roomId: run.roomId, action: "run_cancelled", runId, actorType: "user", actorUserId: user._id });
    return null;
  },
});

// ---------- internal: called by runTurn action ----------
export const completeTurn = internalMutation({
  args: { turnId: v.id("agentTurns"), output: agentModelOutputV, usage: usageV },
  returns: v.null(),
  handler: async (ctx, { turnId, output, usage }) => {
    const turn = (await ctx.db.get("agentTurns", turnId))!;
    const g = await checkPersistGuards(ctx, turn);
    if (!g.ok) return discardStale(ctx, turn, g.failed, usage);
    const verdict = await validateAgentOutput(ctx, { turn, run: g.run, room: g.room, output }); // 06, deterministic
    if (!verdict.ok) return handleTurnFailure(ctx, turn, "rules_rejected", usage, verdict.reasonCode);
    assertTurnTransition("running", "succeeded");
    const resultProposalId = await persistTurnOutput(ctx, { turn, run: g.run, room: g.room, output: verdict.normalized }); // 05: may append a proposal
    await ctx.db.patch("agentTurns", turnId, { status: "succeeded", output: verdict.normalized, resultProposalId, finishedAt: Date.now() });
    await insertModelCall(ctx, turn, usage, "accepted");
    await ctx.db.patch("runs", g.run._id, { updatedAt: Date.now() }); // force OCC conflict between parallel completions
    await maybeAdvance(ctx, (await ctx.db.get("runs", g.run._id))!);
    return null;
  },
});

export const failTurn = internalMutation({
  args: { turnId: v.id("agentTurns"), errorCode: turnErrorCodeV, usage: v.optional(usageV), httpStatus: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { turnId, errorCode, usage }) => {
    const turn = (await ctx.db.get("agentTurns", turnId))!;
    const g = await checkPersistGuards(ctx, turn);
    if (!g.ok) return discardStale(ctx, turn, g.failed, usage);
    return handleTurnFailure(ctx, turn, errorCode, usage);
  },
});

// ---------- internal: watchdog (scheduled mutation => exactly once, scheduler.d.ts:18-19) ----------
export const turnWatchdog = internalMutation({
  args: { turnId: v.id("agentTurns") },
  returns: v.null(),
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.status !== "running") return null; // normal case: already terminal
    let code: TurnErrorCode = "timeout";
    if (turn.dispatchRef) {
      const sf = await ctx.db.system.get("_scheduled_functions", turn.dispatchRef as any); // pending check: id cast
      if (sf?.state.kind === "failed") code = "action_crashed";
    }
    const g = await checkPersistGuards(ctx, turn);
    if (!g.ok) return discardStale(ctx, turn, g.failed, undefined);
    return handleTurnFailure(ctx, turn, code, undefined);
  },
});

// ---------- shared ----------
async function handleTurnFailure(ctx: MutationCtx, turn: Doc<"agentTurns">, code: TurnErrorCode, usage?: any, reasonCode?: string) {
  const policy = ERROR_POLICY[code];
  assertTurnTransition("running", policy.status);
  await ctx.db.patch("agentTurns", turn._id, { status: policy.status, errorCode: code, finishedAt: Date.now() });
  if (usage) await insertModelCall(ctx, turn, usage, policy.status === "invalid_output" ? "invalid_output" : "failed");
  const run = (await ctx.db.get("runs", turn.runId))!;
  await ctx.db.patch("runs", run._id, { updatedAt: Date.now() });
  const mayAuto = policy.autoRetry && turn.origin !== "auto_retry" && TURN_BUDGET.appAutoRetries >= 1;
  if (mayAuto) {
    const r = await createAttempt(ctx, (await ctx.db.get("runs", run._id))!,
      { turnSeq: turn.turnSeq, role: turn.role, stepKind: turn.stepKind,
        base: turn.baseProposalId ? { id: turn.baseProposalId, version: turn.baseProposalVersion! } : undefined },
      turn.attempt + 1, "auto_retry", TURN_BUDGET.appRetryDelayMs);
    if (!("capError" in r)) return null;
    code = r.capError;
  }
  await failRun(ctx, run._id, code); // reasonCode (06) goes into the turn_failed event payload
  void reasonCode;
  return null;
}

async function discardStale(ctx: MutationCtx, turn: Doc<"agentTurns">, failed: "G0" | "G1" | "G2" | "G3", usage?: any) {
  if (failed !== "G0") {
    assertTurnTransition("running", "stale");
    await ctx.db.patch("agentTurns", turn._id, { status: "stale", errorCode: "guard_rejected", finishedAt: Date.now() });
    await appendEvent(ctx, { roomId: turn.roomId, action: "turn_rejected_stale", runId: turn.runId, reasonCode: failed, actorType: "system" });
  }
  if (usage) await insertModelCall(ctx, turn, usage, "discarded_stale"); // late cost is still recorded (D6)
  return null;
}

async function latestAttemptsOfStep(ctx: MutationCtx, run: Doc<"runs">) {
  const rows = await ctx.db.query("agentTurns")
    .withIndex("by_run_and_turnSeq_and_role_and_attempt", (q) => q.eq("runId", run._id).eq("turnSeq", run.nextTurnSeq))
    .collect();
  const byRole = new Map<string, Doc<"agentTurns">>();
  for (const r of rows) if ((byRole.get(r.role)?.attempt ?? 0) < r.attempt) byRole.set(r.role, r);
  return [...byRole.values()];
}

/** Step completes only when the latest attempt of EVERY slot succeeded; then advance exactly once. */
async function maybeAdvance(ctx: MutationCtx, run: Doc<"runs">) {
  const latest = await latestAttemptsOfStep(ctx, run);
  if (latest.some((t) => t.status !== "succeeded")) return;
  const decision = await planAfterStep(ctx, run, latest); // 05: step | await_approval | needs_input
  const advanced = { nextTurnSeq: run.nextTurnSeq + 1, updatedAt: Date.now() };
  if (decision.kind === "step") {
    await ctx.db.patch("runs", run._id, { ...advanced, round: decision.round, status: "negotiating" });
    await beginStep(ctx, (await ctx.db.get("runs", run._id))!, decision.plan);
  } else {
    await ctx.db.patch("runs", run._id, advanced);
    await applyDecision(ctx, (await ctx.db.get("runs", run._id))!, decision); // -> pending_approval | needs_input
  }
}
