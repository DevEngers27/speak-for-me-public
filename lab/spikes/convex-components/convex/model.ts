// Stub "model call". In production this would call @anthropic-ai/sdk (never here: no real API calls).
import { v } from "convex/values";
import { NonRetryableError } from "@convex-dev/workpool";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { vProposal } from "./schema";
import type { Proposal } from "./turns";

/** Simulates the action process dying without reporting back (chain watchdog path). */
export class LostError extends Error {
  constructor() {
    super("stub_lost");
    this.name = "LostError";
  }
}

export const vModelTurnResult = v.object({
  proposal: vProposal,
  constraintVersion: v.number(), // version of the context the model saw
  usage: v.object({ inputTokens: v.number(), outputTokens: v.number() }),
});
export type ModelTurnResult = {
  proposal: Proposal;
  constraintVersion: number;
  usage: { inputTokens: number; outputTokens: number };
};

export async function callModelTurnImpl(
  ctx: ActionCtx,
  { runId, turnIndex }: { runId: Id<"runs">; turnIndex: number },
): Promise<ModelTurnResult> {
  const c = await ctx.runQuery(internal.turns.loadTurnContext, { runId, turnIndex });
  const calls = await ctx.runMutation(internal.turns.bumpStubCall, { runId, key: c.key });
  const f = c.failEntry;
  if (f) {
    if (f.mode === "transient" && calls <= f.times) throw new Error(`stub_overloaded_529 (call ${calls})`);
    if (f.mode === "fatal") throw new NonRetryableError("stub_refusal");
    if (f.mode === "lost" && calls <= f.times) throw new LostError();
    if (f.mode === "budgetCutDuring" && calls === 1) {
      // A human cuts the budget while this model call is "in flight".
      await ctx.runMutation(internal.rooms.changeBudgetInternal, {
        roomId: c.roomId,
        budgetCents: Math.floor(c.budgetCents / 2),
      });
    }
  }
  const price = Math.min(c.budgetCents, 1_000_000 - c.round * 50_000);
  return {
    proposal: {
      role: c.role,
      action: c.isLast ? "recommend_accept" : c.round === 0 ? "propose" : "counter",
      priceCents: price,
      scopeItemIds: ["core", ...(c.round === 0 ? ["reporting"] : [])],
    },
    constraintVersion: c.constraintVersion,
    usage: { inputTokens: 1000, outputTokens: 200 },
  };
}

export const callModelTurn = internalAction({
  args: { runId: v.id("runs"), turnIndex: v.number() },
  returns: vModelTurnResult,
  handler: (ctx, args): Promise<ModelTurnResult> => callModelTurnImpl(ctx, args),
});
