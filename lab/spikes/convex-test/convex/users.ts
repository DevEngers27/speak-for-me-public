import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";

type IdentitySummary = {
  tokenIdentifier: string;
  subject: string;
  issuer: string;
  name?: string;
} | null;

const identitySummary = v.union(
  v.null(),
  v.object({
    tokenIdentifier: v.string(),
    subject: v.string(),
    issuer: v.string(),
    name: v.optional(v.string()),
  }),
);

/** Returns the raw identity summary, or null when unauthenticated. */
export const whoami = query({
  args: {},
  returns: identitySummary,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    return {
      tokenIdentifier: identity.tokenIdentifier,
      subject: identity.subject,
      issuer: identity.issuer,
      ...(identity.name !== undefined ? { name: identity.name } : {}),
    };
  },
});

/** Idempotent provisioning: one users row per tokenIdentifier. */
export const ensureUser = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing !== null) return existing._id;
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      ...(identity.name !== undefined ? { name: identity.name } : {}),
    });
  },
});

/** Does a public action's identity propagate into ctx.runQuery? */
export const whoamiViaAction = action({
  args: {},
  returns: v.object({ inAction: identitySummary, viaRunQuery: identitySummary }),
  handler: async (
    ctx,
  ): Promise<{ inAction: IdentitySummary; viaRunQuery: IdentitySummary }> => {
    const identity = await ctx.auth.getUserIdentity();
    const viaRunQuery: IdentitySummary = await ctx.runQuery(api.users.whoami, {});
    return {
      inAction:
        identity === null
          ? null
          : {
              tokenIdentifier: identity.tokenIdentifier,
              subject: identity.subject,
              issuer: identity.issuer,
            },
      viaRunQuery,
    };
  },
});
