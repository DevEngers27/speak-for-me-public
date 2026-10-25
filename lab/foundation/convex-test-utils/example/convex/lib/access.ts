import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Example-only error codes; the engine will define its own.
export type ExampleErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

export function fail(code: ExampleErrorCode): never {
  throw new ConvexError({ code });
}

export async function requireToken(ctx: QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) fail("UNAUTHENTICATED");
  return identity.tokenIdentifier;
}

export type AccessLevel = "owner" | "member";

/** Load an item and require the caller to be its owner (or, for "member", owner or member). */
export async function requireItemAccess(
  ctx: QueryCtx,
  itemId: Id<"items">,
  level: AccessLevel,
): Promise<{ token: string; item: Doc<"items">; isOwner: boolean }> {
  const token = await requireToken(ctx);
  const item = await ctx.db.get(itemId);
  if (item === null) fail("NOT_FOUND");
  const isOwner = item.ownerToken === token;
  if (isOwner) return { token, item, isOwner };
  if (level === "owner") fail("FORBIDDEN");
  const membership = await ctx.db
    .query("itemMembers")
    .withIndex("by_itemId_and_memberToken", (q) => q.eq("itemId", itemId).eq("memberToken", token))
    .unique();
  if (membership === null) fail("FORBIDDEN");
  return { token, item, isOwner };
}
