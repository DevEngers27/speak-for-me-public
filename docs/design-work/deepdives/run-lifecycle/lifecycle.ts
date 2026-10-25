// convex/agentRuntime/lifecycle.ts — internal helpers used by mutations (sketch; names are final, bodies are illustrative).
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { CALL_CAPS, TURN_BUDGET, WATCHDOG_DELAY_MS } from "./budget";
import {
  ACTIVE_RUN_STATUSES, ERROR_POLICY, TURN_ACCEPTING_RUN_STATUSES,
  assertRunTransition, assertTurnTransition, type TurnErrorCode,
} from "../lib/state";
import { planFirstStep, planAfterStep, type StepPlan } from "../engine/protocol"; // 05
import { appendEvent } from "../engine/events"; // 03/07
import { utcDay } from "../lib/time";

type Room = Doc<"rooms">; type Run = Doc<"runs">; type Turn = Doc<"agentTurns">;

export function agentModeFromEnv(): "live" | "stub" {
  return process.env.AGENT_MODE === "live" ? "live" : "stub"; // pending check: env access in mutations
}
export function liveAgentsEnabled(): boolean {
  return process.env.AGENTS_ENABLED === "true";
}

// ---------- guards (D2) ----------
export type GuardResult =
  | { ok: true; run: Run; room: Room }
  | { ok: false; code: "turn_not_running" | "guard_rejected"; failed: "G0" | "G1" | "G2" | "G3" };

export async function checkPersistGuards(ctx: MutationCtx, turn: Turn): Promise<GuardResult> {
  if (turn.status !== "running") return { ok: false, code: "turn_not_running", failed: "G0" };
  const run = (await ctx.db.get("runs", turn.runId))!;
  const room = (await ctx.db.get("rooms", turn.roomId))!;
  if (room.currentRunId !== run._id || !TURN_ACCEPTING_RUN_STATUSES.has(run.status))
    return { ok: false, code: "guard_rejected", failed: "G1" };
  if (run.nextTurnSeq !== turn.turnSeq) return { ok: false, code: "guard_rejected", failed: "G2" };
  if (room.constraintsVersion !== run.constraintsVersionAtStart)
    return { ok: false, code: "guard_rejected", failed: "G3" };
  return { ok: true, run, room };
}

// ---------- caps (D4) ----------
export async function reserveCall(ctx: MutationCtx, run: Run): Promise<TurnErrorCode | null> {
  if (run.callCount >= run.maxCalls) return "call_cap_reached";
  if (run.agentMode === "live") {
    if (!liveAgentsEnabled()) return "agents_disabled";
    const day = utcDay(Date.now());
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const todays = await ctx.db.query("agentTurns")
      .withIndex("by_room_and_mode_and_createdAt", (q) =>
        q.eq("roomId", run.roomId).eq("agentMode", "live").gte("createdAt", dayStart))
      .take(CALL_CAPS.perRoomPerDay + 1);
    if (todays.length >= CALL_CAPS.perRoomPerDay) return "room_daily_cap";
    const key = `global:${day}`;
    const counter = await ctx.db.query("usageCounters").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if ((counter?.calls ?? 0) >= CALL_CAPS.globalPerDay) return "global_daily_cap";
    if (counter) await ctx.db.patch("usageCounters", counter._id, { calls: counter.calls + 1 });
    else await ctx.db.insert("usageCounters", { key, calls: 1 });
  }
  await ctx.db.patch("runs", run._id, { callCount: run.callCount + 1, updatedAt: Date.now() });
  return null;
}

// ---------- dispatch seam (D1: the only function that changes when moving to workpool) ----------
export async function scheduleAttempt(ctx: MutationCtx, turnId: Id<"agentTurns">, delayMs: number) {
  const fnId = await ctx.scheduler.runAfter(delayMs, internal.agentRuntime.runTurn, { turnId });
  await ctx.scheduler.runAfter(delayMs + WATCHDOG_DELAY_MS, internal.agentRuntime.turnWatchdog, { turnId });
  await ctx.db.patch("agentTurns", turnId, { dispatchRef: fnId as string });
}

export async function createAttempt(
  ctx: MutationCtx, run: Run,
  slot: { turnSeq: number; role: Turn["role"]; stepKind: Turn["stepKind"]; base?: { id: Id<"proposals">; version: number } },
  attempt: number, origin: Turn["origin"], delayMs = 0,
): Promise<{ turnId: Id<"agentTurns"> } | { capError: TurnErrorCode }> {
  const capError = await reserveCall(ctx, run);
  if (capError) return { capError };
  const now = Date.now();
  const turnId = await ctx.db.insert("agentTurns", {
    roomId: run.roomId, runId: run._id, turnSeq: slot.turnSeq, round: run.round, role: slot.role,
    attempt, stepKind: slot.stepKind, origin, status: "running", agentMode: run.agentMode,
    constraintsVersion: run.constraintsVersionAtStart,
    baseProposalId: slot.base?.id, baseProposalVersion: slot.base?.version,
    createdAt: now, deadlineAt: now + delayMs + WATCHDOG_DELAY_MS,
  });
  await scheduleAttempt(ctx, turnId, delayMs);
  return { turnId };
}

/** Starts every slot of a step. A cap error fails the run (no throw, so failRun is not rolled back). */
export async function beginStep(ctx: MutationCtx, run: Run, plan: StepPlan): Promise<{ ok: true } | { ok: false; code: TurnErrorCode }> {
  for (const role of plan.roles) {
    const r = await createAttempt(ctx, await reload(ctx, run),
      { turnSeq: run.nextTurnSeq, role, stepKind: plan.stepKind, base: plan.base }, 1, "step_start");
    if ("capError" in r) {
      // Slots already dispatched in this step are marked stale; their actions early-out in loadTurnContext.
      await failRun(ctx, run._id, r.capError);
      return { ok: false, code: r.capError };
    }
  }
  return { ok: true };
}

// ---------- run-level helpers ----------
export async function startRunInternal(ctx: MutationCtx, a: {
  room: Room; trigger: Run["trigger"]; startedBy: Run["startedBy"]; previousRunId?: Id<"runs">;
  scenario: { key: string; maxRounds: number; maxCalls?: number };
}): Promise<Id<"runs">> {
  const now = Date.now();
  const runId = await ctx.db.insert("runs", {
    roomId: a.room._id, scenarioKey: a.scenario.key, status: "negotiating", trigger: a.trigger,
    agentMode: agentModeFromEnv(), constraintsVersionAtStart: a.room.constraintsVersion,
    round: 0, maxRounds: a.scenario.maxRounds, nextTurnSeq: 0, callCount: 0,
    maxCalls: a.scenario.maxCalls ?? CALL_CAPS.perRunDefault, previousRunId: a.previousRunId,
    startedBy: a.startedBy, startedAt: now, updatedAt: now,
  });
  await ctx.db.patch("rooms", a.room._id, { currentRunId: runId });
  await appendEvent(ctx, { roomId: a.room._id, action: "run_started", runId, actorType: a.startedBy.kind === "user" ? "user" : "system" });
  const run = (await ctx.db.get("runs", runId))!;
  const first = await planFirstStep(ctx, run); // 05: may short-circuit to needs_input without any model call
  if (first.kind === "step") await beginStep(ctx, run, first.plan);
  else await applyDecision(ctx, run, first);
  return runId;
}

/** Called by 09 bumpConstraints in the same mutation, BEFORE starting the replacement run. */
export async function supersedeRun(ctx: MutationCtx, room: Room) {
  if (!room.currentRunId) return;
  const run = (await ctx.db.get("runs", room.currentRunId))!;
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return;
  assertRunTransition(run.status, "superseded");
  await ctx.db.patch("runs", run._id, { status: "superseded", endedReason: "superseded_by_constraint_change", endedAt: Date.now(), updatedAt: Date.now() });
  await staleRunningTurns(ctx, run._id, "run_superseded");
}

export async function staleRunningTurns(ctx: MutationCtx, runId: Id<"runs">, code: "run_superseded" | "run_cancelled") {
  const turns = await ctx.db.query("agentTurns")
    .withIndex("by_run_and_turnSeq_and_role_and_attempt", (q) => q.eq("runId", runId)).collect(); // bounded by maxCalls
  for (const t of turns) if (t.status === "running") {
    assertTurnTransition("running", "stale");
    await ctx.db.patch("agentTurns", t._id, { status: "stale", errorCode: code, finishedAt: Date.now() });
  }
}

/**
 * 08 (rejection: pending_approval -> negotiating, next round) and 05 (answer without constraint change:
 * needs_input -> negotiating) re-enter negotiation on the SAME run. nextTurnSeq was already advanced
 * by the completeTurn that closed the previous step, so it is not touched here.
 */
export async function resumeRun(ctx: MutationCtx, runId: Id<"runs">, cause: "rejected" | "request_answered") {
  const run = (await ctx.db.get("runs", runId))!;
  const nextRound = cause === "rejected" ? run.round + 1 : run.round;
  if (cause === "rejected" && nextRound >= run.maxRounds) {
    return applyDecision(ctx, run, { kind: "needs_input", reason: "rounds_exhausted" }); // pending_approval -> needs_input
  }
  assertRunTransition(run.status, "negotiating");
  await ctx.db.patch("runs", run._id, { status: "negotiating", round: nextRound, updatedAt: Date.now() });
  const fresh = (await ctx.db.get("runs", runId))!;
  const next = await planFirstStep(ctx, fresh);
  if (next.kind === "step") await beginStep(ctx, fresh, next.plan); else await applyDecision(ctx, fresh, next);
}

export async function failRun(ctx: MutationCtx, runId: Id<"runs">, code: TurnErrorCode) {
  const run = (await ctx.db.get("runs", runId))!;
  if (run.status === "failed") return;
  assertRunTransition(run.status, "failed");
  await ctx.db.patch("runs", runId, {
    status: "failed", endedReason: code === "call_cap_reached" ? "call_cap_reached" : "turn_failed", updatedAt: Date.now(),
  });
  await appendEvent(ctx, { roomId: run.roomId, action: "turn_failed", runId, reasonCode: code, actorType: "system" });
}

/** Applies a non-step decision from 05: await_approval or needs_input (humanRequest creation is 05/09's helper). */
export declare function applyDecision(ctx: MutationCtx, run: Run, d: Exclude<Awaited<ReturnType<typeof planAfterStep>>, { kind: "step" }>): Promise<void>;
async function reload(ctx: MutationCtx, run: Run) { return (await ctx.db.get("runs", run._id))!; }
void TURN_BUDGET; void utcDay;
