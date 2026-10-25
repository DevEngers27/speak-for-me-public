import { v } from "convex/values";
import { approvalDecision } from "./schema";
import { mutation, query } from "./_generated/server";
import { appError, requireUser } from "./lib/auth";

/**
 * Upsert keyed by (proposalId, userId) through index by_proposal_user.
 * This is the ONLY code path that writes approvals; `.unique()` doubles as an
 * invariant detector (throws if a duplicate ever slipped in).
 */
export const setApproval = mutation({
  args: { proposalId: v.id("proposals"), decision: approvalDecision },
  returns: v.object({
    approvalId: v.id("approvals"),
    outcome: v.union(v.literal("inserted"), v.literal("updated"), v.literal("unchanged")),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const proposal = await ctx.db.get("proposals", args.proposalId);
    if (proposal === null) throw appError("NOT_FOUND", "proposal");
    const room = await ctx.db.get("rooms", proposal.roomId);
    if (room === null) throw appError("NOT_FOUND", "room");

    const existing = await ctx.db
      .query("approvals")
      .withIndex("by_proposal_user", (q) =>
        q.eq("proposalId", args.proposalId).eq("userId", user._id),
      )
      .unique();

    if (existing === null) {
      const approvalId = await ctx.db.insert("approvals", {
        proposalId: args.proposalId,
        userId: user._id,
        decision: args.decision,
        constraintVersion: room.constraintVersion,
        revision: 1,
      });
      await ctx.db.insert("events", {
        kind: "approval.inserted",
        roomId: room._id,
        payload: { approvalId, decision: args.decision },
      });
      return { approvalId, outcome: "inserted" as const, revision: 1 };
    }

    if (
      existing.decision === args.decision &&
      existing.constraintVersion === room.constraintVersion
    ) {
      return { approvalId: existing._id, outcome: "unchanged" as const, revision: existing.revision };
    }

    const revision = existing.revision + 1;
    await ctx.db.patch("approvals", existing._id, {
      decision: args.decision,
      constraintVersion: room.constraintVersion,
      revision,
    });
    await ctx.db.insert("events", {
      kind: "approval.updated",
      roomId: room._id,
      payload: { approvalId: existing._id, decision: args.decision, revision },
    });
    return { approvalId: existing._id, outcome: "updated" as const, revision };
  },
});

export const listForProposal = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("approvals")
      .withIndex("by_proposal_user", (q) => q.eq("proposalId", args.proposalId))
      .take(50);
  },
});
