import { v } from "convex/values";
import { query } from "./_generated/server";

/** Echo the caller's identity (or null) so tests can check what the backend sees. */
export const whoami = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ tokenIdentifier: v.string(), subject: v.string(), issuer: v.string() }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    return {
      tokenIdentifier: identity.tokenIdentifier,
      subject: identity.subject,
      issuer: identity.issuer,
    };
  },
});
