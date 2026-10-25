import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "../tests/convex-helpers/setup";

afterEach(() => vi.restoreAllMocks());
it("12.20 setDraining(false) schedules livenessSweep", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.ops.setDraining, { draining: true, reason: "release" });
  expect(first.draining).toBe(true);
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  await t.mutation(internal.ops.setDraining, { draining: false, reason: "done" });
  await t.mutation(internal.ops.setDraining, { draining: true, reason: "again" });
  const flags = await t.run(ctx => ctx.db.query("opsFlags").collect());
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ key: "global", draining: true, changedBy: null });
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0]).toMatchObject({ name: "ops:livenessSweep", args: [{}], state: { kind: "pending" } });
});
it("12.20 activeAttemptCount empty deployment returns zeros", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(internal.ops.activeAttemptCount, {})).resolves.toEqual({ runningLive: 0, runningStub: 0, negotiatingRuns: 0 });
});
it("12.20 livenessSweep empty deployment is a noop", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(internal.ops.livenessSweep, {})).resolves.toEqual({ scheduled: 0, stuckAttempts: 0 });
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
});

it("12.20 sweep fans out negotiating runs and overdue running attempts only", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "test|ops", displayName: "Ops", isTestAccount: true, createdAt: 0, updatedAt: 0 });
    const roomId = await ctx.db.insert("rooms", {
      scenarioKey: "scope_change", scenarioVersion: 1, title: "Ops", timeZone: "UTC", localDate: "2026-10-24",
      status: "open", constraintsVersion: 1, nextProposalVersion: 1, nextRunNo: 2, writeSeq: 0, createdBy: userId, provenance: "stub", createdAt: 0,
    });
    const run = {
      roomId, runNo: 1, status: "negotiating" as const, cause: "room_opened" as const, constraintsVersionAtStart: 1,
      agentMode: "stub" as const, roundNo: 1, maxRounds: 3, roundsExtended: false, activeTurnSeq: 1, nextTurnSeq: 2,
      attemptCount: 1, maxAttempts: 18, reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 1000, provenance: "stub" as const, startedAt: 0,
    };
    const runId = await ctx.db.insert("runs", run);
    await ctx.db.insert("runs", { ...run, runNo: 2, status: "needs_input", activeTurnSeq: null });
    const turnId = await ctx.db.insert("turns", {
      roomId, runId, turnSeq: 1, roundNo: 1, role: "provider", kind: "propose", status: "running", constraintsVersion: 1,
      candidateSnapshot: [], allowedActions: [], promptVersion: "test", currentAttemptNo: 1, createdAt: 0,
    });
    const attempt = {
      roomId, runId, turnId, attemptNo: 1, role: "provider" as const, origin: "turn_start" as const, status: "running" as const,
      provenance: "live" as const, model: "test", effort: "medium", maxTokens: 16000, protocolVersion: "test", promptVersion: "test",
      reservedDay: "2026-10-24", watchdogArmCount: 0, deadlineAt: Date.now() - 60_001, reservedMicroUsd: 0, lateUsage: false, startedAt: 0,
    };
    const overdue = await ctx.db.insert("attempts", attempt);
    await ctx.db.insert("attempts", { ...attempt, attemptNo: 2, provenance: "stub", deadlineAt: Date.now() + 1000 });
    await ctx.db.insert("attempts", { ...attempt, attemptNo: 3, status: "stale" });
    return { runId, overdue };
  });
  await expect(t.query(internal.ops.activeAttemptCount, {})).resolves.toEqual({ runningLive: 1, runningStub: 1, negotiatingRuns: 1 });
  await expect(t.mutation(internal.ops.livenessSweep, {})).resolves.toEqual({ scheduled: 1, stuckAttempts: 1 });
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.map(s => ({ name: s.name, args: s.args }))).toEqual(expect.arrayContaining([
    { name: "runs:reconcile", args: [{ runId: ids.runId }] },
    { name: "agents:watchdog", args: [{ attemptId: ids.overdue }] },
  ]));
  expect(scheduled).toHaveLength(2);
});

it("12.20 setDraining internal failure rolls back flags and scheduling", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    for (let i = 0; i < 2; i++) await ctx.db.insert("opsFlags", { key: "global", draining: true, changedAt: i, changedBy: null });
  });
  await expect(t.mutation(internal.ops.setDraining, { draining: false, reason: "release" })).rejects.toThrow(/internal/);
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  expect((await t.run(ctx => ctx.db.query("opsFlags").collect())).every(f => f.draining)).toBe(true);
});
