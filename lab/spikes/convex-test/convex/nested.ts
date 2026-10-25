import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

export const innerWritesThenThrows = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.db.insert("events", { kind: "nested.inner" });
    throw new Error("inner failure (expected)");
  },
});

/**
 * Convex 1.48: ctx.runMutation inside a mutation runs a sub-transaction.
 * Documented: if the sub-mutation throws, its writes roll back while the
 * caller may catch and continue.
 */
export const outerCatchesInner = mutation({
  args: { rethrow: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    await ctx.db.insert("events", { kind: "nested.outer.before" });
    try {
      await ctx.runMutation(internal.nested.innerWritesThenThrows, {});
    } catch (e) {
      if (args.rethrow) throw e;
      await ctx.db.insert("events", { kind: "nested.outer.after" });
      return "caught";
    }
    return "not-thrown";
  },
});
