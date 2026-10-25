import { v } from "convex/values";
import { internalMutation } from "./lib/functions";
import { opsLog } from "./lib/opsLog";
import { deleteNonLiveRooms } from "./lib/resetRooms";
import { runSeedChain } from "./lib/seedChain";
import { assertTier } from "./lib/config";
import { roleV } from "./lib/validators";

/** Dev / preview / test only. One transaction. Default terminal state is open + run 1. */
export const fromFixture = internalMutation("seed.fromFixture")({
  args: {
    fixtureKey: v.optional(v.string()),
    stopBeforeRole: v.optional(v.union(roleV, v.null())),
  },
  returns: v.object({ roomId: v.id("rooms") }),
  handler: async (ctx, args) => await runSeedChain(ctx, args),
});

export const reset = internalMutation("seed.reset")({
  args: {
    confirmDeployment: v.string(),
    fixtureKey: v.union(v.string(), v.null()),
  },
  returns: v.object({
    roomsDeleted: v.number(),
    rowsDeleted: v.number(),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await assertTier(ctx, ["dev", "preview", "test"], { confirmDeployment: args.confirmDeployment });
    const result = await deleteNonLiveRooms(ctx);
    opsLog(ctx.log, "seed_reset", { count: result.rowsDeleted });
    return result;
  },
});
