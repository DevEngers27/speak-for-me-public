import { v } from "convex/values";
import { agentMessageBody, roomStatus } from "./schema";
import { mutation } from "./_generated/server";

/**
 * Deliberately loose args (v.any()) so the test can push bad documents to the
 * DB layer and observe whether SCHEMA validation (not arg validation) rejects.
 */
export const insertRoomUnchecked = mutation({
  args: { doc: v.any() },
  returns: v.id("rooms"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("rooms", args.doc);
  },
});

export const patchRoomUnchecked = mutation({
  args: { roomId: v.id("rooms"), patch: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("rooms", args.roomId, args.patch);
    return null;
  },
});

export const insertApprovalUnchecked = mutation({
  args: { doc: v.any() },
  returns: v.id("approvals"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("approvals", args.doc);
  },
});

export const insertAgentMessageUnchecked = mutation({
  args: { doc: v.any() },
  returns: v.id("agentMessages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentMessages", args.doc);
  },
});

/** Strict args: argument validation happens before the handler runs. */
export const setRoomStatusStrict = mutation({
  args: { roomId: v.id("rooms"), status: roomStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("rooms", args.roomId, { status: args.status });
    return null;
  },
});

export const postAgentMessageStrict = mutation({
  args: { roomId: v.id("rooms"), body: agentMessageBody },
  returns: v.id("agentMessages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentMessages", { roomId: args.roomId, body: args.body });
  },
});

/** Returns a value violating its own `returns` validator. */
export const badReturn = mutation({
  args: {},
  returns: v.number(),
  handler: async () => {
    return "not a number" as unknown as number;
  },
});

/** `undefined` cannot cross the function-arg boundary, so unset inside the handler. */
export const unsetRoomField = mutation({
  args: { roomId: v.id("rooms"), field: v.union(v.literal("note"), v.literal("archivedAt")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("rooms", args.roomId, { [args.field]: undefined });
    return null;
  },
});
