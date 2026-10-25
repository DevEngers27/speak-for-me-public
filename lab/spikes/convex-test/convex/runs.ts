import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { appError, requireUser } from "./lib/auth";

/** Offline stand-in for a model call. Never touches the network. */
function stubModel(roomTitle: string): string {
  return `STUB(${roomTitle})`;
}

/**
 * State transition + start external work in ONE mutation:
 * insert run(queued) and runAfter(delayMs, internal.runs.executeRunAction).
 * If the mutation throws after scheduling, the schedule must vanish with it.
 */
export const startRun = mutation({
  args: {
    roomId: v.id("rooms"),
    delayMs: v.optional(v.number()),
    failAfterSchedule: v.optional(v.boolean()),
  },
  returns: v.object({ runId: v.id("runs"), jobId: v.id("_scheduled_functions") }),
  // Explicit return type breaks the api <-> module inference cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"runs">; jobId: Id<"_scheduled_functions"> }> => {
    const user = await requireUser(ctx);
    const runId = await ctx.db.insert("runs", {
      roomId: args.roomId,
      status: "queued",
      attempt: 1,
      actorUserId: user._id, // pass actor explicitly; scheduled fns have no auth
    });
    const jobId = await ctx.scheduler.runAfter(
      args.delayMs ?? 0,
      internal.runs.executeRunAction,
      { runId, attempt: 1 },
    );
    if (args.failAfterSchedule === true) throw appError("SIMULATED_FAILURE", "after schedule");
    return { runId, jobId };
  },
});

export const executeRunAction = internalAction({
  args: { runId: v.id("runs"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    const room: { title: string } | null = await ctx.runMutation(internal.runs.markRunning, {
      runId: args.runId,
      attempt: args.attempt,
      observedIdentity: identity?.tokenIdentifier ?? null,
    });
    if (room === null) return null; // stale: run no longer queued
    const output = stubModel(room.title);
    await ctx.runMutation(internal.runs.commitRunResult, {
      runId: args.runId,
      attempt: args.attempt,
      output,
    });
    return null;
  },
});

export const markRunning = internalMutation({
  args: {
    runId: v.id("runs"),
    attempt: v.number(),
    observedIdentity: v.union(v.string(), v.null()),
  },
  returns: v.union(v.null(), v.object({ title: v.string() })),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (run === null || run.status !== "queued" || run.attempt !== args.attempt) return null;
    const room = await ctx.db.get("rooms", run.roomId);
    if (room === null) return null;
    await ctx.db.patch("runs", run._id, {
      status: "running",
      observedIdentity: args.observedIdentity,
    });
    return { title: room.title };
  },
});

/** Commit with stale rejection: only accepted if still running the same attempt. */
export const commitRunResult = internalMutation({
  args: { runId: v.id("runs"), attempt: v.number(), output: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (run === null || run.status !== "running" || run.attempt !== args.attempt) return false;
    await ctx.db.patch("runs", run._id, { status: "succeeded", output: args.output });
    return true;
  },
});

// ---- scheduled MUTATION path + chains + failure + cancel ----

async function bump(ctx: MutationCtx, name: string): Promise<number> {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
  if (row === null) {
    await ctx.db.insert("counters", { name, value: 1 });
    return 1;
  }
  await ctx.db.patch("counters", row._id, { value: row.value + 1 });
  return row.value + 1;
}

export const scheduleBump = mutation({
  args: { name: v.string(), delayMs: v.number() },
  returns: v.id("_scheduled_functions"),
  handler: async (ctx, args): Promise<Id<"_scheduled_functions">> => {
    return await ctx.scheduler.runAfter(args.delayMs, internal.runs.bumpCounter, {
      name: args.name,
    });
  },
});

export const bumpCounter = internalMutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    await bump(ctx, args.name);
    await ctx.db.insert("events", {
      kind: "bump.identity",
      payload: { identity: identity?.tokenIdentifier ?? null },
    });
    return null;
  },
});

/** Each link schedules the next one, 1 minute later, until depth reaches 0. */
export const chain = internalMutation({
  args: { depth: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await bump(ctx, "chain");
    if (args.depth > 0) {
      await ctx.scheduler.runAfter(60_000, internal.runs.chain, { depth: args.depth - 1 });
    }
    return null;
  },
});

export const startChain = mutation({
  args: { depth: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.runs.chain, { depth: args.depth });
    return null;
  },
});

export const failingAction = internalAction({
  args: {},
  returns: v.null(),
  handler: async (): Promise<null> => {
    throw new Error("scheduled action failure (expected in test)");
  },
});

export const scheduleFailingAction = mutation({
  args: {},
  returns: v.id("_scheduled_functions"),
  handler: async (ctx): Promise<Id<"_scheduled_functions">> => {
    return await ctx.scheduler.runAfter(0, internal.runs.failingAction, {});
  },
});

export const cancelJob = mutation({
  args: { jobId: v.id("_scheduled_functions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.cancel(args.jobId);
    return null;
  },
});
