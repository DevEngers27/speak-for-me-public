// Rooms + the constraint-change entry point that cancels the active run (both engines).
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./lib";
import { retrier } from "./lib";
import type { RunId } from "@convex-dev/action-retrier";

export const createRoom = mutation({
  args: { name: v.string(), budgetCents: v.number() },
  handler: (ctx, a) => ctx.db.insert("rooms", { ...a, constraintVersion: 1 }),
});

/**
 * Cancel a scheduled function only if it has not started. Canceling a finished one throws; canceling an
 * in-progress action does not stop it (only what it schedules) and convex-test 0.0.65 rejects it with an
 * invariant error, so in-flight work is handled by stale rejection instead.
 */
export async function cancelIfUnfinished(ctx: MutationCtx, id: Id<"_scheduled_functions"> | undefined) {
  if (!id) return;
  const sf = await ctx.db.system.get(id);
  if (sf && sf.state.kind === "pending") {
    await ctx.scheduler.cancel(id);
  }
}

export async function finishRun(
  ctx: MutationCtx,
  run: Doc<"runs">,
  status: "completed" | "failed" | "canceled",
  endReason: string,
) {
  await ctx.db.patch(run._id, { status, endReason });
  const room = await ctx.db.get(run.roomId);
  if (room?.activeRunId === run._id) await ctx.db.patch(room._id, { activeRunId: undefined });
}

async function cancelActiveRun(ctx: MutationCtx, run: Doc<"runs">, reason: string) {
  if (run.status !== "running") return;
  await finishRun(ctx, run, "canceled", reason);
  if (run.engine === "workflow" && run.workflowId) {
    // Halts the workflow; an in-flight step.runAction keeps running but its result is dropped.
    await workflow.cancel(ctx, run.workflowId as any);
    return;
  }
  // chain / retrier-chain: cancel not-yet-started work, mark in-flight attempts canceled.
  const attempts = await ctx.db
    .query("attempts")
    .withIndex("by_run_turn", (q) => q.eq("runId", run._id))
    .collect();
  for (const a of attempts) {
    if (a.status !== "inFlight") continue;
    await cancelIfUnfinished(ctx, a.actionFnId);
    await cancelIfUnfinished(ctx, a.watchdogFnId);
    if (a.retrierRunId) await retrier.cancel(ctx, a.retrierRunId as RunId);
    await ctx.db.patch(a._id, { status: "canceled" });
  }
}

async function changeBudgetImpl(ctx: MutationCtx, roomId: Id<"rooms">, budgetCents: number) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("room_not_found");
  await ctx.db.patch(roomId, { budgetCents, constraintVersion: room.constraintVersion + 1 });
  if (room.activeRunId) {
    const run = await ctx.db.get(room.activeRunId);
    if (run) await cancelActiveRun(ctx, run, "budget_changed");
  }
}

export const changeBudget = mutation({
  args: { roomId: v.id("rooms"), budgetCents: v.number() },
  handler: (ctx, a) => changeBudgetImpl(ctx, a.roomId, a.budgetCents),
});
export const changeBudgetInternal = internalMutation({
  args: { roomId: v.id("rooms"), budgetCents: v.number() },
  handler: (ctx, a) => changeBudgetImpl(ctx, a.roomId, a.budgetCents),
});
