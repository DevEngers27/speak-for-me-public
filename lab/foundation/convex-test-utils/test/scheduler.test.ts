import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../example/convex/_generated/api";
import {
  advanceScheduledBy,
  advanceScheduledTo,
  drainScheduled,
  expectNoPendingScheduled,
  listScheduled,
  useFakeTimersForEachTest,
} from "../src";
import { makeT, seedItem, withRole } from "./fixtures";

describe("with fake timers", () => {
  useFakeTimersForEachTest();

  test("drainScheduled runs mutation -> action -> mutation -> delayed mutation chains", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const owner = withRole(t, "owner");
    await owner.mutation(api.items.requestProcessing, { itemId });
    expect(await listScheduled(t, { state: "pending" })).toHaveLength(1);

    const report = await drainScheduled(t);
    expect(report.ran.map((j) => `${j.name}:${j.state}`)).toEqual([
      "items:process:success",
      "items:archive:success",
    ]);
    expect(report.failed).toEqual([]);
    expect(await owner.query(api.items.get, { itemId })).toMatchObject({
      processed: true,
      status: "archived",
    });
    await expectNoPendingScheduled(t);
  });

  test("advanceScheduledTo: nothing before the due time, done exactly at it", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const owner = withRole(t, "owner");
    await owner.mutation(api.items.scheduleArchive, { itemId, delayMs: 5_000 });
    const [job] = await listScheduled(t, { fn: internal.items.archive });

    await advanceScheduledTo(t, job!.scheduledTime - 1);
    expect(await listScheduled(t, { fn: internal.items.archive })).toMatchObject([{ state: "pending" }]);
    expect((await owner.query(api.items.get, { itemId })).status).toBe("active");

    await advanceScheduledTo(t, job!.scheduledTime);
    expect(await listScheduled(t, { fn: internal.items.archive })).toMatchObject([{ state: "success" }]);
    expect((await owner.query(api.items.get, { itemId })).status).toBe("archived");
  });

  test("advanceScheduledBy moves relative time; due time may drift past now+delay", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const owner = withRole(t, "owner");
    const before = Date.now();
    await owner.mutation(api.items.scheduleArchive, { itemId, delayMs: 1_000 });
    const [job] = await listScheduled(t);
    expect(job).toMatchObject({ name: "items:archive", state: "pending", args: [{ itemId }] });
    // Observed: convex-test pins transaction time to max(fake now, last commit ts),
    // so after earlier commits in the same frozen millisecond the job is due at
    // now + delay + (a few ms). Never assert exact equality with now + delay;
    // use advanceScheduledTo(job.scheduledTime) for exact boundaries.
    const drift = job!.scheduledTime - before - 1_000;
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThan(50); // grows with commits made while the fake clock is frozen

    await advanceScheduledBy(t, 1_000 + drift);
    expect((await owner.query(api.items.get, { itemId })).status).toBe("archived");
  });

  test("a failed scheduled function is surfaced, not just logged", async () => {
    const t = makeT();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await withRole(t, "owner").mutation(api.items.scheduleExplosion, {});
    await expect(drainScheduled(t)).rejects.toThrow(/items:explode#.*\(failed\)/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  test("failOnFailedJobs: false returns the failure in the report instead", async () => {
    const t = makeT();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await withRole(t, "owner").mutation(api.items.scheduleExplosion, {});
    const report = await drainScheduled(t, { failOnFailedJobs: false });
    expect(report.failed.map((j) => j.name)).toEqual(["items:explode"]);
    errorSpy.mockRestore();
  });
});

describe("guards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("drainScheduled / advanceScheduledBy refuse to run without fake timers", async () => {
    const t = makeT();
    await expect(drainScheduled(t)).rejects.toThrow(/fake timers are not active/);
    await expect(advanceScheduledBy(t, 10)).rejects.toThrow(/fake timers are not active/);
  });

  test("jobs scheduled under real timers with a future time are reported, not silently skipped", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    await withRole(t, "owner").mutation(api.items.scheduleArchive, { itemId, delayMs: 60_000 });
    vi.useFakeTimers();
    await expect(drainScheduled(t)).rejects.toThrow(/still pending after drain/);
    const report = await drainScheduled(t, { requireEmptyQueue: false });
    expect(report.stillPending.map((j) => j.name)).toEqual(["items:archive"]);
    await expect(expectNoPendingScheduled(t)).rejects.toThrow(/open job/);
  });
});
