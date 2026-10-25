import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "USER_NOT_PROVISIONED"
  | "NOT_FOUND"
  | "SIMULATED_FAILURE";

export function appError(code: AppErrorCode, message?: string): ConvexError<{
  code: AppErrorCode;
  message: string;
}> {
  return new ConvexError({ code, message: message ?? code });
}

/** Authentication: identity must exist. Authorization is a separate step. */
export async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw appError("UNAUTHENTICATED");
  return identity;
}

/** Map identity.tokenIdentifier (globally unique: iss + sub) to the users table. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (user === null) throw appError("USER_NOT_PROVISIONED");
  return user;
}
