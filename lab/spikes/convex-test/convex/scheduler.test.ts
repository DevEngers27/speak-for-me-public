import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  countRows,
  expectAppError,
  log,
  makeT,
  rejectionOf,
  scheduledJobs,
  seed,
  type T,
} from "./test.helpers";

async function counter(t: T, name: string) {
  return await t.run(
    async (ctx) =>
      (await ctx.db.query("counters").withIndex("by_name", (q) => q.eq("name", name)).unique())
        ?.value ?? 0,
  );
}

describe("(c) scheduler in convex-test", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("scheduled ACTION runs only when drained; no auth inside; runMutation commits", async () => {
    const t = makeT();
    const { alice, roomId } = await seed(t);
    const { runId, jobId } = await alice.mutation(api.runs.startRun, { roomId });

    // Not executed synchronously with the scheduling mutation.
    const before = await t.run((ctx) => ctx.db.get("runs", runId));
    const jobBefore = (await scheduledJobs(t)).find((j) => j._id === jobId);
    log("run status right after startRun", before?.status);
    log("job right after startRun", { name: jobBefore?.name, state: jobBefore?.state });
    expect(before?.status).toBe("queued");
    expect(jobBefore?.state.kind).toBe("pending");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await t.run((ctx) => ctx.db.get("runs", runId));
    const jobAfter = (await scheduledJobs(t)).find((j) => j._id === jobId);
    log("run after drain", { status: after?.status, output: after?.output, observedIdentity: after?.observedIdentity });
    log("job after drain", jobAfter?.state);
    expect(after).toMatchObject({ status: "succeeded", output: "STUB(Scope change)" });
    expect(after?.observedIdentity).toBeNull(); // scheduled fns do not inherit caller auth
    expect(jobAfter?.state.kind).toBe("success");
  });

  test("scheduled MUTATION with delay: advanceTimersByTime + finishInProgressScheduledFunctions", async () => {
    const t = makeT();
    const alice = t.withIdentity({ subject: "user_alice" });
    const jobId = await alice.mutation(api.runs.scheduleBump, { name: "b", delayMs: 60_000 });

    vi.advanceTimersByTime(59_999);
    await t.finishInProgressScheduledFunctions();
    expect(await counter(t, "b")).toBe(0);
    expect((await scheduledJobs(t)).find((j) => j._id === jobId)?.state.kind).toBe("pending");

    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    expect(await counter(t, "b")).toBe(1);
    const job = (await scheduledJobs(t)).find((j) => j._id === jobId);
    log("delayed mutation job", { state: job?.state, scheduledTimeMinusCreation: (job?.scheduledTime ?? 0) - (job?._creationTime ?? 0) });
    expect(job?.state.kind).toBe("success");
    const identityEvent = await t.run((ctx) =>
      ctx.db.query("events").withIndex("by_kind", (q) => q.eq("kind", "bump.identity")).unique(),
    );
    log("identity seen inside scheduled mutation", identityEvent?.payload);
    expect(identityEvent?.payload).toEqual({ identity: null });
  });

  test("finishAllScheduledFunctions drains chains (fn schedules fn)", async () => {
    const t = makeT();
    await t.mutation(api.runs.startChain, { depth: 3 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counter(t, "chain")).toBe(4);
    const jobs = await scheduledJobs(t);
    log("chain job states", jobs.map((j) => `${j.name}:${j.state.kind}`));
    expect(jobs).toHaveLength(4);
  });

  test("mutation that throws after runAfter: run row AND schedule are rolled back", async () => {
    const t = makeT();
    const { alice, roomId } = await seed(t);
    const err = await rejectionOf(
      alice.mutation(api.runs.startRun, { roomId, failAfterSchedule: true }),
    );
    expectAppError(err, "SIMULATED_FAILURE");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    log("after failed startRun", { runs: await countRows(t, "runs"), jobs: (await scheduledJobs(t)).length });
    expect(await countRows(t, "runs")).toBe(0);
    expect(await scheduledJobs(t)).toHaveLength(0);
  });

  test("failing scheduled action ends in state failed (no retry in convex-test)", async () => {
    const t = makeT();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobId = await t.mutation(api.runs.scheduleFailingAction, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const job = (await scheduledJobs(t)).find((j) => j._id === jobId);
    log("failing action job", job?.state);
    log("console.error calls", errSpy.mock.calls.length);
    expect(job?.state.kind).toBe("failed");
    errSpy.mockRestore();
  });

  test("ctx.scheduler.cancel before due time -> state canceled, never runs", async () => {
    const t = makeT();
    const jobId = await t.mutation(api.runs.scheduleBump, { name: "c", delayMs: 60_000 });
    await t.mutation(api.runs.cancelJob, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counter(t, "c")).toBe(0);
    expect((await scheduledJobs(t)).find((j) => j._id === jobId)?.state.kind).toBe("canceled");
  });

  test("internal functions are directly callable from tests; stale commit rejected", async () => {
    const t = makeT();
    const { alice, roomId } = await seed(t);
    const { runId } = await alice.mutation(api.runs.startRun, { roomId, delayMs: 10_000 });
    // Simulate the action having marked the run as running for attempt 1.
    const marked = await t.mutation(internal.runs.markRunning, {
      runId,
      attempt: 1,
      observedIdentity: null,
    });
    expect(marked).toEqual({ title: "Scope change" });
    // A late commit from an old attempt must be rejected.
    expect(
      await t.mutation(internal.runs.commitRunResult, { runId, attempt: 0, output: "old" }),
    ).toBe(false);
    expect(
      await t.mutation(internal.runs.commitRunResult, { runId, attempt: 1, output: "ok" }),
    ).toBe(true);
    // When the scheduled action finally fires, markRunning sees status!=queued -> no-op.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const run = await t.run((ctx) => ctx.db.get("runs", runId));
    expect(run).toMatchObject({ status: "succeeded", output: "ok" });
  });
});

describe("(c') runAfter(0) with REAL timers", () => {
  test("drained by finishAllScheduledFunctions even though fake timers were off at schedule time", async () => {
    const t = makeT();
    const { alice, roomId } = await seed(t);
    const { runId } = await alice.mutation(api.runs.startRun, { roomId });
    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    const run = await t.run((ctx) => ctx.db.get("runs", runId));
    expect(run?.status).toBe("succeeded");
  });
});
