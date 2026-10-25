import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireItemAccess } from "./lib/access";

export const add = mutation({
  args: { itemId: v.id("items"), body: v.string(), privateMemo: v.string() },
  returns: v.id("notes"),
  handler: async (ctx, { itemId, body, privateMemo }) => {
    const { token } = await requireItemAccess(ctx, itemId, "member");
    return await ctx.db.insert("notes", { itemId, authorToken: token, body, privateMemo });
  },
});

/**
 * Notes visible to owner and members. `privateMemo` is included ONLY for the
 * caller's own notes, and the projection is built field by field so a new
 * column on `notes` can never leak by default. `authorToken` is never returned.
 */
export const listForItem = query({
  args: { itemId: v.id("items") },
  returns: v.array(
    v.object({
      _id: v.id("notes"),
      body: v.string(),
      mine: v.boolean(),
      privateMemo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { itemId }) => {
    const { token } = await requireItemAccess(ctx, itemId, "member");
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
      .take(100);
    return notes.map((n) => {
      const mine = n.authorToken === token;
      return mine
        ? { _id: n._id, body: n.body, mine, privateMemo: n.privateMemo }
        : { _id: n._id, body: n.body, mine };
    });
  },
});
