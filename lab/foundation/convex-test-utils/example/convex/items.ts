import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { fail, requireItemAccess, requireToken } from "./lib/access";

const createResult = v.object({ created: v.boolean(), itemId: v.id("items") });

/**
 * Single write entry point for items. One item per (owner, key):
 * read the key through the index with `.unique()` and insert only if absent,
 * all inside this one mutation.
 */
export const create = mutation({
  args: { key: v.string(), title: v.string() },
  returns: createResult,
  handler: async (ctx, { key, title }) => {
    const ownerToken = await requireToken(ctx);
    const existing = await ctx.db
      .query("items")
      .withIndex("by_ownerToken_and_key", (q) => q.eq("ownerToken", ownerToken).eq("key", key))
      .unique();
    if (existing !== null) return { created: false, itemId: existing._id };
    const itemId = await ctx.db.insert("items", { ownerToken, key, title, status: "active" });
    return { created: true, itemId };
  },
});

export const rename = mutation({
  args: { itemId: v.id("items"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId, title }) => {
    await requireItemAccess(ctx, itemId, "owner");
    await ctx.db.patch(itemId, { title });
    return null;
  },
});

/** Same dedup pattern for memberships: one row per (item, memberToken). */
export const addMember = mutation({
  args: { itemId: v.id("items"), memberToken: v.string() },
  returns: v.object({ created: v.boolean(), membershipId: v.id("itemMembers") }),
  handler: async (ctx, { itemId, memberToken }) => {
    await requireItemAccess(ctx, itemId, "owner");
    const existing = await ctx.db
      .query("itemMembers")
      .withIndex("by_itemId_and_memberToken", (q) => q.eq("itemId", itemId).eq("memberToken", memberToken))
      .unique();
    if (existing !== null) return { created: false, membershipId: existing._id };
    const membershipId = await ctx.db.insert("itemMembers", { itemId, memberToken });
    return { created: true, membershipId };
  },
});

/** Owner or member. Returns an explicit projection (allowlist), never the raw doc. */
export const get = query({
  args: { itemId: v.id("items") },
  returns: v.object({
    _id: v.id("items"),
    title: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    isOwner: v.boolean(),
    processed: v.boolean(),
  }),
  handler: async (ctx, { itemId }) => {
    const { item, isOwner } = await requireItemAccess(ctx, itemId, "member");
    return {
      _id: item._id,
      title: item.title,
      status: item.status,
      isOwner,
      processed: item.processedAt !== undefined,
    };
  },
});

/** Schedule archiving after `delayMs`. Authorization happens HERE, before scheduling. */
export const scheduleArchive = mutation({
  args: { itemId: v.id("items"), delayMs: v.number() },
  returns: v.id("_scheduled_functions"),
  handler: async (ctx, { itemId, delayMs }): Promise<Id<"_scheduled_functions">> => {
    await requireItemAccess(ctx, itemId, "owner");
    if (!Number.isFinite(delayMs) || delayMs < 0) fail("FORBIDDEN");
    return await ctx.scheduler.runAfter(delayMs, internal.items.archive, { itemId });
  },
});

export const archive = internalMutation({
  args: { itemId: v.id("items") },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (item !== null && item.status !== "archived") await ctx.db.patch(itemId, { status: "archived" });
    return null;
  },
});

/** State change + start of background work in one mutation (atomic pair). */
export const requestProcessing = mutation({
  args: { itemId: v.id("items") },
  returns: v.null(),
  handler: async (ctx, { itemId }): Promise<null> => {
    await requireItemAccess(ctx, itemId, "owner");
    await ctx.scheduler.runAfter(0, internal.items.process, { itemId });
    return null;
  },
});

/** Background step. Stands in for slow external work; there is no real I/O here. */
export const process = internalAction({
  args: { itemId: v.id("items") },
  returns: v.null(),
  handler: async (ctx, { itemId }): Promise<null> => {
    await ctx.runMutation(internal.items.markProcessed, { itemId, at: Date.now() });
    return null;
  },
});

/** Commit the background result, then schedule a follow-up (a 2-hop chain). */
export const markProcessed = internalMutation({
  args: { itemId: v.id("items"), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, at }): Promise<null> => {
    await ctx.db.patch(itemId, { processedAt: at });
    await ctx.scheduler.runAfter(60_000, internal.items.archive, { itemId });
    return null;
  },
});

/** Always throws; used to show that scheduled failures are surfaced by drainScheduled. */
export const explode = internalMutation({
  args: {},
  returns: v.null(),
  handler: async () => {
    throw new Error("intentional failure");
  },
});

export const scheduleExplosion = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    await requireToken(ctx);
    await ctx.scheduler.runAfter(0, internal.items.explode, {});
    return null;
  },
});
