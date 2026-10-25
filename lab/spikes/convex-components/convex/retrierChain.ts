// ENGINE C (middle ground): scheduler-style chain, but per-turn retries delegated to action-retrier.
import { v, ConvexError } from "convex/values";
import { onCompleteValidator } from "@convex-dev/action-retrier";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { limiter, retrier, ROUNDS_MAX } from "./lib";
import { ROLES, vFailPlanEntry } from "./schema";
import { commitTurnLogic, STALE_CODES } from "./turns";
import { finishRun } from "./rooms";
import type { ModelTurnResult } from "./model";

async function scheduleTurn(ctx: MutationCtx, runId: Id<"runs">, turnIndex: number) {
  const retrierRunId = await retrier.run(ctx, internal.model.callModelTurn, { runId, turnIndex }, {
    onComplete: internal.retrierChain.onTurnComplete,
  });
  // onComplete carries no user context -> correlate through our own table.
  await ctx.db.insert("attempts", { runId, turnIndex, attempt: 1, status: "inFlight", retrierRunId });
}

export const startRun = mutation({
  args: { roomId: v.id("rooms"), rounds: v.number(), failPlan: v.optional(v.array(vFailPlanEntry)) },
  handler: async (ctx, { roomId, rounds, failPlan }): Promise<Id<"runs">> => {
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > ROUNDS_MAX) throw new ConvexError("invalid_rounds");
    const room = await ctx.db.get(roomId);
    if (!room) throw new ConvexError("room_not_found");
    if (room.activeRunId) throw new ConvexError("run_already_active");
    await limiter.limit(ctx, "runStartsPerRoom", { key: roomId, throws: true });
    const runId = await ctx.db.insert("runs", {
      roomId, engine: "chain", constraintVersion: room.constraintVersion, rounds,
      status: "running", nextTurnIndex: 0, failPlan: failPlan ?? [],
    });
    await ctx.db.patch(roomId, { activeRunId: runId });
    await scheduleTurn(ctx, runId, 0);
    return runId;
  },
});

export const onTurnComplete = internalMutation({
  args: onCompleteValidator,
  handler: async (ctx, { runId: retrierRunId, result }) => {
    const a = await ctx.db
      .query("attempts")
      .withIndex("by_retrier_run", (q) => q.eq("retrierRunId", retrierRunId))
      .unique();
    if (!a || a.status !== "inFlight") return;
    const run = (await ctx.db.get(a.runId))!;
    if (result.type === "canceled") return void (await ctx.db.patch(a._id, { status: "canceled" }));
    if (result.type === "failed") {
      await ctx.db.patch(a._id, { status: "failed", error: result.error });
      if (run.status === "running") await finishRun(ctx, run, "failed", `turn_${a.turnIndex}_failed:${result.error}`);
      return;
    }
    const out = result.returnValue as ModelTurnResult; // returnValue is v.any(): re-validate in real code
    const r = await commitTurnLogic(ctx, {
      runId: a.runId, turnIndex: a.turnIndex, constraintVersion: out.constraintVersion, proposal: out.proposal,
    });
    // NOTE: calling retrier.cleanup(ctx, runId) here throws "Run ... hasn't completed" (measured): the run is
    // only marked complete after onComplete returns, and the thrown error is swallowed+logged by the
    // component -> the whole chain silently stalls. Rely on the 7-day auto cleanup instead.
    if (!r.ok) {
      await ctx.db.patch(a._id, { status: "stale", error: r.reasonCode });
      if (!STALE_CODES.has(r.reasonCode)) await finishRun(ctx, run, "failed", r.reasonCode);
      return;
    }
    await ctx.db.patch(a._id, { status: "succeeded" });
    const next = a.turnIndex + 1;
    await ctx.db.patch(run._id, { nextTurnIndex: next });
    if (next >= run.rounds * ROLES.length) await finishRun(ctx, run, "completed", "all_turns_committed");
    else await scheduleTurn(ctx, run._id, next);
  },
});
