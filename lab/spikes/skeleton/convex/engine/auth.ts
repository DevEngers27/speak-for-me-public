import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { QueryCtx } from "../_generated/server";

/**
 * Authentication gate for every public engine function. Fails closed:
 * no identity -> ConvexError("UNAUTHENTICATED"). Room-level authorization
 * (membership + role) is a separate check layered on top of this.
 */
export async function requireIdentity(ctx: Pick<QueryCtx, "auth">): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED" as const });
  }
  return identity;
}
