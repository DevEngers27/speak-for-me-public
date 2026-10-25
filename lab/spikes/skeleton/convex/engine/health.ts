import { v } from "convex/values";
import { query } from "../_generated/server";
import { ENGINE_VERSION } from "@core/engine";
import { scopeChangePlugin } from "@core/scenarios/scope-change";
import { requireIdentity } from "./auth";

/** Public, unauthenticated liveness probe. Returns no user data. */
export const ping = query({
  args: {},
  returns: v.object({ ok: v.literal(true), engineVersion: v.string(), scenarios: v.array(v.string()) }),
  handler: async () => ({
    ok: true as const,
    engineVersion: ENGINE_VERSION,
    scenarios: [scopeChangePlugin.id],
  }),
});

/** Authenticated probe: proves the Clerk -> Convex identity path end to end. */
export const whoami = query({
  args: {},
  returns: v.object({ tokenIdentifier: v.string(), subject: v.string() }),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return { tokenIdentifier: identity.tokenIdentifier, subject: identity.subject };
  },
});
