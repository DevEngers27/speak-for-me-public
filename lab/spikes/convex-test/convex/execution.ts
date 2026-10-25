import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { appError, requireUser } from "./lib/auth";

/**
 * Single write entry point for executions. "Query by index, then insert" in one
 * mutation: a repeated call with the same operationId returns the existing row.
 * Under real concurrency this relies on OCC (the index range read is in the read
 * set); convex-test runs functions serially and cannot exercise that path.
 */
export const executeProposal = mutation({
  args: {
    proposalId: v.id("proposals"),
    operationId: v.string(),
    // Spike-only: throw after all writes to prove the mutation is atomic.
    simulateFailureAfterWrites: v.optional(v.boolean()),
  },
  returns: v.object({ executionId: v.id("executions"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const existing = await ctx.db
      .query("executions")
      .withIndex("by_operationId", (q) => q.eq("operationId", args.operationId))
      .unique();
    if (existing !== null) {
      return { executionId: existing._id, created: false };
    }

    const proposal = await ctx.db.get("proposals", args.proposalId);
    if (proposal === null) throw appError("NOT_FOUND", "proposal");

    const executionId = await ctx.db.insert("executions", {
      operationId: args.operationId,
      proposalId: proposal._id,
      executedBy: user._id,
    });
    await ctx.db.insert("commitments", {
      executionId,
      amountCents: proposal.terms.priceCents,
    });
    await ctx.db.insert("events", {
      kind: "execution.created",
      roomId: proposal.roomId,
      payload: { executionId, operationId: args.operationId },
    });

    if (args.simulateFailureAfterWrites === true) {
      throw appError("SIMULATED_FAILURE", "after writes");
    }
    return { executionId, created: true };
  },
});
