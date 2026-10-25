/**
 * Example functions loaded only by convex-test from outside the functions directory.
 * Module path when registered as `./test/example.fixture.ts` is `test/example.fixture`.
 */
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../../convex/_generated/dataModel";
import { internalMutation, mutation } from "../../convex/_generated/server";

const applyRenameRef = makeFunctionReference<"mutation", { userId: Id<"users">; displayName: string }>(
  "test/example.fixture:applyRename",
) as unknown as FunctionReference<"mutation", "internal", { userId: Id<"users">; displayName: string }>;

const boomRef = makeFunctionReference<"mutation", Record<string, never>>("test/example.fixture:boom") as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>
>;

export const scheduleRename = mutation({
  args: { userId: v.id("users"), displayName: v.string(), delayMs: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new ConvexError({ code: "UNAUTHENTICATED" as const });
    await ctx.scheduler.runAfter(args.delayMs, applyRenameRef, { userId: args.userId, displayName: args.displayName });
    return null;
  },
});

export const applyRename = internalMutation({
  args: { userId: v.id("users"), displayName: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { displayName: args.displayName });
    return null;
  },
});

export const scheduleBoom = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new ConvexError({ code: "UNAUTHENTICATED" as const });
    await ctx.scheduler.runAfter(0, boomRef, {});
    return null;
  },
});

export const boom = internalMutation({
  args: {},
  returns: v.null(),
  handler: async () => {
    throw new Error("scheduled boom");
  },
});

/** Query-then-insert: one users row per tokenIdentifier. Repeats return the existing id. */
export const ensureUser = mutation({
  args: { tokenIdentifier: v.string(), isTestAccount: v.boolean(), createdAt: v.number(), updatedAt: v.number(), displayName: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
    if (existing !== null) return existing._id;
    return await ctx.db.insert("users", args);
  },
});

/** Same key, but a repeat is `item.duplicate` instead of returning the existing id. */
export const claimUser = mutation({
  args: { tokenIdentifier: v.string(), isTestAccount: v.boolean(), createdAt: v.number(), updatedAt: v.number(), displayName: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
    if (existing !== null) throw new ConvexError({ code: "item.duplicate" as const });
    return await ctx.db.insert("users", args);
  },
});
