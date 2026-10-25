// ENGINE A: hand-rolled ctx.scheduler chain + attempts table + watchdog.
import { v, ConvexError } from "convex/values";
import { NonRetryableError } from "@convex-dev/workpool";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CHAIN_MAX_ATTEMPTS, TURN_TIMEOUT_MS, backoffMs, limiter, ROUNDS_MAX } from "./lib";
import { ROLES, vFailPlanEntry, vProposal } from "./schema";
import { commitTurnLogic, STALE_CODES } from "./turns";
import { callModelTurnImpl, LostError } from "./model";
import { cancelIfUnfinished, finishRun } from "./rooms";

async function scheduleAttempt(ctx: MutationCtx, runId: Id<"runs">, turnIndex: number, attempt: number, delayMs: number) {
  const attemptId = await ctx.db.insert("attempts", { runId, turnIndex, attempt, status: "inFlight" });
  // Atomic with this mutation: if it rolls back, nothing is scheduled.
  const actionFnId = await ctx.scheduler.runAfter(delayMs, internal.chain.turnAction, { attemptId });
  const watchdogFnId = await ctx.scheduler.runAfter(delayMs + TURN_TIMEOUT_MS, internal.chain.watchdog, { attemptId });
  await ctx.db.patch(attemptId, { actionFnId, watchdogFnId });
}

export const startRun = mutation({
  args: { roomId: v.id("rooms"), rounds: v.number(), failPlan: v.optional(v.array(vFailPlanEntry)) },
  handler: async (ctx, { roomId, rounds, failPlan }): Promise<Id<"runs">> => {
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > ROUNDS_MAX) throw new ConvexError("invalid_rounds");
    const room = await ctx.db.get(roomId);
    if (!room) throw new ConvexError("room_not_found");
    if (room.activeRunId) throw new ConvexError("run_already_active"); // single-writer uniqueness via OCC
    await limiter.limit(ctx, "runStartsPerRoom", { key: roomId, throws: true });
    const runId = await ctx.db.insert("runs", {
      roomId, engine: "chain", constraintVersion: room.constraintVersion, rounds,
      status: "running", nextTurnIndex: 0, failPlan: failPlan ?? [],
    });
    await ctx.db.patch(roomId, { activeRunId: runId });
    await scheduleAttempt(ctx, runId, 0, 1, 0);
    return runId;
  },
});

export const getAttempt = internalQuery({
  args: { attemptId: v.id("attempts") },
  handler: (ctx, { attemptId }) => ctx.db.get(attemptId),
});

export const turnAction = internalAction({
  args: { attemptId: v.id("attempts") },
  handler: async (ctx, { attemptId }) => {
    const a = await ctx.runQuery(internal.chain.getAttempt, { attemptId });
    if (!a || a.status !== "inFlight") return;
    try {
      const out = await callModelTurnImpl(ctx, { runId: a.runId, turnIndex: a.turnIndex });
      await ctx.runMutation(internal.chain.reportAttempt, {
        attemptId, outcome: { kind: "ok", proposal: out.proposal, constraintVersion: out.constraintVersion },
      });
    } catch (e) {
      if (e instanceof LostError) return; // simulate a crashed action: nobody reports; watchdog must
      await ctx.runMutation(internal.chain.reportAttempt, {
        attemptId,
        outcome: { kind: "error", message: String((e as Error).message), retryable: !(e instanceof NonRetryableError) },
      });
    }
  },
});

const vOutcome = v.union(
  v.object({ kind: v.literal("ok"), proposal: vProposal, constraintVersion: v.number() }),
  v.object({ kind: v.literal("error"), message: v.string(), retryable: v.boolean() }),
);

async function handleFailure(
  ctx: MutationCtx, a: Doc<"attempts">, run: Doc<"runs">, message: string, retryable: boolean,
  status: "failed" | "timedOut",
) {
  await ctx.db.patch(a._id, { status, error: message });
  if (run.status !== "running") return;
  if (retryable && a.attempt < CHAIN_MAX_ATTEMPTS) {
    await scheduleAttempt(ctx, run._id, a.turnIndex, a.attempt + 1, backoffMs(a.attempt));
  } else {
    await finishRun(ctx, run, "failed", `turn_${a.turnIndex}_${status}:${message}`);
  }
}

export const reportAttempt = internalMutation({
  args: { attemptId: v.id("attempts"), outcome: vOutcome },
  handler: async (ctx, { attemptId, outcome }) => {
    const a = await ctx.db.get(attemptId);
    if (!a) return;
    if (a.status !== "inFlight") {
      // Late result (timed out or canceled): drop, keep an audit row.
      await ctx.db.insert("rejections", { runId: a.runId, turnIndex: a.turnIndex, reasonCode: `late_attempt_${a.status}` });
      return;
    }
    const run = (await ctx.db.get(a.runId))!;
    await cancelIfUnfinished(ctx, a.watchdogFnId);
    if (outcome.kind === "error") return handleFailure(ctx, a, run, outcome.message, outcome.retryable, "failed");
    const r = await commitTurnLogic(ctx, {
      runId: a.runId, turnIndex: a.turnIndex, constraintVersion: outcome.constraintVersion, proposal: outcome.proposal,
    });
    if (!r.ok) {
      await ctx.db.patch(a._id, { status: "stale", error: r.reasonCode });
      if (!STALE_CODES.has(r.reasonCode)) await finishRun(ctx, run, "failed", r.reasonCode);
      return;
    }
    await ctx.db.patch(a._id, { status: "succeeded" });
    const next = a.turnIndex + 1;
    await ctx.db.patch(run._id, { nextTurnIndex: next });
    if (next >= run.rounds * ROLES.length) await finishRun(ctx, run, "completed", "all_turns_committed");
    else await scheduleAttempt(ctx, run._id, next, 1, 0);
  },
});

export const watchdog = internalMutation({
  args: { attemptId: v.id("attempts") },
  handler: async (ctx, { attemptId }) => {
    const a = await ctx.db.get(attemptId);
    if (!a || a.status !== "inFlight") return;
    const run = (await ctx.db.get(a.runId))!;
    await handleFailure(ctx, a, run, "turn_timeout", true, "timedOut");
  },
});
