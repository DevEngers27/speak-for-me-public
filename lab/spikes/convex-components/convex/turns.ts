// Engine-agnostic turn logic: context load, deterministic validation, stale rejection, commit.
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ROLES, vProposal, type Role } from "./schema";
import type { Infer } from "convex/values";

export type Proposal = Infer<typeof vProposal>;
export const turnRole = (turnIndex: number): Role => ROLES[turnIndex % ROLES.length];
export const turnRound = (turnIndex: number): number => Math.floor(turnIndex / ROLES.length);

export const STALE_CODES = new Set(["run_not_running", "constraint_version_stale"]);
export type CommitResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reasonCode: string };

export const loadTurnContext = internalQuery({
  args: { runId: v.id("runs"), turnIndex: v.number() },
  handler: async (ctx, { runId, turnIndex }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run_not_found");
    const room = await ctx.db.get(run.roomId);
    if (!room) throw new Error("room_not_found");
    const key = `${turnRound(turnIndex)}:${turnRole(turnIndex)}`;
    return {
      roomId: room._id,
      runStatus: run.status,
      budgetCents: room.budgetCents,
      constraintVersion: room.constraintVersion,
      role: turnRole(turnIndex),
      round: turnRound(turnIndex),
      isLast: turnIndex === run.rounds * ROLES.length - 1,
      key,
      failEntry: run.failPlan.find((f) => f.key === key) ?? null,
    };
  },
});

export const bumpStubCall = internalMutation({
  args: { runId: v.id("runs"), key: v.string() },
  handler: async (ctx, { runId, key }): Promise<number> => {
    const row = await ctx.db
      .query("stubCalls")
      .withIndex("by_run_key", (q) => q.eq("runId", runId).eq("key", key))
      .unique();
    if (!row) {
      await ctx.db.insert("stubCalls", { runId, key, calls: 1 });
      return 1;
    }
    await ctx.db.patch(row._id, { calls: row.calls + 1 });
    return row.calls + 1;
  },
});

async function reject(ctx: MutationCtx, runId: Id<"runs">, turnIndex: number, reasonCode: string): Promise<CommitResult> {
  await ctx.db.insert("rejections", { runId, turnIndex, reasonCode });
  return { ok: false, reasonCode };
}

/** Single write entry for turn results. Idempotent on (runId, turnIndex). */
export async function commitTurnLogic(
  ctx: MutationCtx,
  a: { runId: Id<"runs">; turnIndex: number; constraintVersion: number; proposal: Proposal },
): Promise<CommitResult> {
  const run = await ctx.db.get(a.runId);
  if (!run || run.status !== "running") return reject(ctx, a.runId, a.turnIndex, "run_not_running");
  const room = await ctx.db.get(run.roomId);
  if (!room) throw new Error("room_not_found");
  if (room.constraintVersion !== a.constraintVersion || run.constraintVersion !== a.constraintVersion) {
    return reject(ctx, a.runId, a.turnIndex, "constraint_version_stale");
  }
  const existing = await ctx.db
    .query("turns")
    .withIndex("by_run_turn", (q) => q.eq("runId", a.runId).eq("turnIndex", a.turnIndex))
    .unique();
  if (existing) return { ok: true, duplicate: true };
  if (a.turnIndex > 0) {
    const prev = await ctx.db
      .query("turns")
      .withIndex("by_run_turn", (q) => q.eq("runId", a.runId).eq("turnIndex", a.turnIndex - 1))
      .unique();
    if (!prev) return reject(ctx, a.runId, a.turnIndex, "turn_out_of_order");
  }
  // Deterministic validation: never trust model-declared numbers.
  const p = a.proposal;
  if (p.role !== turnRole(a.turnIndex)) return reject(ctx, a.runId, a.turnIndex, "role_mismatch");
  if (!Number.isInteger(p.priceCents) || p.priceCents < 0) return reject(ctx, a.runId, a.turnIndex, "invalid_amount");
  if (p.priceCents > room.budgetCents) return reject(ctx, a.runId, a.turnIndex, "over_budget");
  await ctx.db.insert("turns", {
    runId: a.runId,
    turnIndex: a.turnIndex,
    round: turnRound(a.turnIndex),
    role: p.role,
    constraintVersion: a.constraintVersion,
    proposal: p,
  });
  return { ok: true, duplicate: false };
}

export const commitTurn = internalMutation({
  args: { runId: v.id("runs"), turnIndex: v.number(), constraintVersion: v.number(), proposal: vProposal },
  handler: (ctx, args): Promise<CommitResult> => commitTurnLogic(ctx, args),
});
