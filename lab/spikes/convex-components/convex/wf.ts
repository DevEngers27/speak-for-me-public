// ENGINE B: @convex-dev/workflow. The handler only orchestrates; it must be deterministic.
import { v, ConvexError } from "convex/values";
import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { limiter, ROUNDS_MAX, TURN_RETRY, workflow } from "./lib";
import { ROLES, vFailPlanEntry } from "./schema";
import { finishRun } from "./rooms";
import type { CommitResult } from "./turns";

type WfResult = { outcome: string; committedTurns: number };

export const negotiation = workflow.define({
  args: { runId: v.id("runs"), rounds: v.number() },
  returns: v.object({ outcome: v.string(), committedTurns: v.number() }),
  handler: async (step, { runId, rounds }): Promise<WfResult> => {
    const total = rounds * ROLES.length;
    for (let turnIndex = 0; turnIndex < total; turnIndex++) {
      // Action step: model call. Retried with backoff+jitter by workpool; NonRetryableError skips retries.
      // If retries are exhausted this throws and (uncaught) ends the workflow as failed -> onComplete.
      const out = await step.runAction(
        internal.model.callModelTurn,
        { runId, turnIndex },
        { retry: TURN_RETRY, name: `turn_${turnIndex}_model` },
      );
      // Mutation step: deterministic validation + stale rejection + commit (exactly-once).
      const r: CommitResult = await step.runMutation(
        internal.turns.commitTurn,
        { runId, turnIndex, constraintVersion: out.constraintVersion, proposal: out.proposal },
        { inline: true, name: `turn_${turnIndex}_commit` },
      );
      if (!r.ok) return { outcome: r.reasonCode, committedTurns: turnIndex };
    }
    return { outcome: "completed", committedTurns: total };
  },
});

export const startRun = mutation({
  args: { roomId: v.id("rooms"), rounds: v.number(), failPlan: v.optional(v.array(vFailPlanEntry)) },
  handler: async (ctx, { roomId, rounds, failPlan }): Promise<Id<"runs">> => {
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > ROUNDS_MAX) throw new ConvexError("invalid_rounds");
    const room = await ctx.db.get(roomId);
    if (!room) throw new ConvexError("room_not_found");
    if (room.activeRunId) throw new ConvexError("run_already_active");
    await limiter.limit(ctx, "runStartsPerRoom", { key: roomId, throws: true });
    const runId = await ctx.db.insert("runs", {
      roomId, engine: "workflow", constraintVersion: room.constraintVersion, rounds,
      status: "running", nextTurnIndex: 0, failPlan: failPlan ?? [],
    });
    await ctx.db.patch(roomId, { activeRunId: runId });
    const workflowId: WorkflowId = await workflow.start(ctx, internal.wf.negotiation, { runId, rounds }, {
      onComplete: internal.wf.onRunComplete,
      context: { runId },
    });
    await ctx.db.patch(runId, { workflowId });
    return runId;
  },
});

export const onRunComplete = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: v.object({ runId: v.id("runs") }) },
  handler: async (ctx, { result, context }) => {
    const run = await ctx.db.get(context.runId);
    if (!run || run.status !== "running") return; // already canceled by a constraint change
    if (result.kind === "success") {
      const r = result.returnValue as WfResult;
      await finishRun(ctx, run, r.outcome === "completed" ? "completed" : "failed", r.outcome);
    } else if (result.kind === "failed") {
      await finishRun(ctx, run, "failed", `workflow_failed:${result.error}`);
    } else {
      await finishRun(ctx, run, "canceled", "workflow_canceled");
    }
  },
});
