import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

export const appendEvent = internalMutation({
  args: { roomId: v.id("rooms"), kind: v.string() },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("events", { kind: args.kind, roomId: args.roomId });
  },
});

/**
 * Two independent transactions from one action. If the action throws between
 * them, step1 stays committed: actions are NOT transactional.
 */
export const twoStepAction = action({
  args: { roomId: v.id("rooms"), failBetween: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(internal.actions.appendEvent, { roomId: args.roomId, kind: "step1" });
    if (args.failBetween) throw new Error("boom between mutations");
    await ctx.runMutation(internal.actions.appendEvent, { roomId: args.roomId, kind: "step2" });
    return null;
  },
});
