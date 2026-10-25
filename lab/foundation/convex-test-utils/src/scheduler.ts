import { getFunctionName, type FunctionReference, type GenericDataModel } from "convex/server";
import { afterEach, beforeEach, vi } from "vitest";
import type { TestAccessor } from "./identities";

/** States of a `_scheduled_functions` document. */
export type ScheduledState = "pending" | "inProgress" | "success" | "failed" | "canceled";

/** A simplified view of one `_scheduled_functions` row. */
export interface ScheduledJob {
  id: string;
  /** Function path, e.g. `"items:archive"` (same format as `getFunctionName`). */
  name: string;
  state: ScheduledState;
  scheduledTime: number;
  completedTime: number | undefined;
  args: unknown[];
}

/**
 * Register `vi.useFakeTimers()` before and `vi.useRealTimers()` after every
 * test in the current file / describe block. Call at module or describe level.
 */
export function useFakeTimersForEachTest(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Read every `_scheduled_functions` row, optionally filtered by function. */
export async function listScheduled<DM extends GenericDataModel>(
  t: TestAccessor<DM>,
  filter?: { fn?: FunctionReference<"mutation" | "action", "public" | "internal">; state?: ScheduledState },
): Promise<ScheduledJob[]> {
  const rows = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
  const wanted = filter?.fn === undefined ? undefined : getFunctionName(filter.fn);
  return rows
    .map(
      (row): ScheduledJob => ({
        id: row._id,
        name: row.name,
        state: row.state.kind,
        scheduledTime: row.scheduledTime,
        completedTime: row.completedTime,
        args: row.args,
      }),
    )
    .filter((job) => (wanted === undefined || job.name === wanted) && (filter?.state === undefined || job.state === filter.state));
}

export interface DrainOptions {
  /** Passed to convex-test; guards against functions that reschedule forever. Default 100. */
  maxIterations?: number;
  /** Timer advancer. Default `vi.runAllTimers`. */
  advanceTimers?: () => void;
  /**
   * Throw if any job that ran during the drain ended `failed`. Default true:
   * a scheduled failure is otherwise only a `console.error` in convex-test.
   */
  failOnFailedJobs?: boolean;
  /**
   * Throw if jobs are still `pending` afterwards. Default true. convex-test
   * silently skips jobs scheduled under REAL timers whose real-clock time has
   * not arrived; this turns that silent skip into a visible error.
   */
  requireEmptyQueue?: boolean;
}

export interface DrainReport {
  /** Jobs that were pending/inProgress before (or created during) the drain and are now terminal. */
  ran: ScheduledJob[];
  failed: ScheduledJob[];
  stillPending: ScheduledJob[];
}

const describeJobs = (jobs: ScheduledJob[]): string =>
  jobs.map((j) => `${j.name}#${j.id}(${j.state})`).join(", ");

/**
 * Run every scheduled function, including ones scheduled by scheduled
 * functions, then report what ran. Requires fake timers to be active.
 */
export async function drainScheduled<DM extends GenericDataModel>(
  t: TestAccessor<DM>,
  options: DrainOptions = {},
): Promise<DrainReport> {
  if (!vi.isFakeTimers()) {
    throw new Error(
      "drainScheduled: fake timers are not active. Call vi.useFakeTimers() (or useFakeTimersForEachTest()) first.",
    );
  }
  const before = new Map((await listScheduled(t)).map((job) => [job.id, job.state]));
  await t.finishAllScheduledFunctions(
    options.advanceTimers ?? (() => vi.runAllTimers()),
    options.maxIterations ?? 100,
  );
  const after = await listScheduled(t);
  const terminal = new Set<ScheduledState>(["success", "failed", "canceled"]);
  const ran = after.filter((job) => {
    const prev = before.get(job.id);
    const wasOpen = prev === undefined || prev === "pending" || prev === "inProgress";
    return wasOpen && terminal.has(job.state);
  });
  const failed = ran.filter((job) => job.state === "failed");
  const stillPending = after.filter((job) => job.state === "pending" || job.state === "inProgress");
  if ((options.failOnFailedJobs ?? true) && failed.length > 0) {
    throw new Error(`drainScheduled: scheduled function(s) failed: ${describeJobs(failed)}`);
  }
  if ((options.requireEmptyQueue ?? true) && stillPending.length > 0) {
    throw new Error(
      `drainScheduled: job(s) still pending after drain (scheduled under real timers?): ${describeJobs(stillPending)}`,
    );
  }
  return { ran, failed, stillPending };
}

/**
 * Advance fake time by `ms` and wait for the functions that became due to
 * finish. Use for "nothing happens before the delay, it happens exactly at
 * the delay" assertions. Functions those functions schedule are NOT run unless
 * they are also due within the same advance.
 */
export async function advanceScheduledBy<DM extends GenericDataModel>(
  t: TestAccessor<DM>,
  ms: number,
): Promise<void> {
  if (!vi.isFakeTimers()) {
    throw new Error("advanceScheduledBy: fake timers are not active. Call vi.useFakeTimers() first.");
  }
  if (!Number.isFinite(ms) || ms < 0) throw new Error("advanceScheduledBy: ms must be a finite number >= 0");
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

/**
 * Advance fake time to the absolute timestamp `at` (ms since epoch, as in
 * `ScheduledJob.scheduledTime`) and wait for functions due by then.
 *
 * Prefer this over `advanceScheduledBy(delay)` for boundary assertions:
 * convex-test pins each transaction's clock to max(fake now, last commit
 * time), so under frozen fake timers a job scheduled with `runAfter(delay)`
 * can be due a millisecond or two AFTER `Date.now() + delay`. Reading the
 * job's own `scheduledTime` makes the boundary exact.
 */
export async function advanceScheduledTo<DM extends GenericDataModel>(
  t: TestAccessor<DM>,
  at: number,
): Promise<void> {
  if (!vi.isFakeTimers()) {
    throw new Error("advanceScheduledTo: fake timers are not active. Call vi.useFakeTimers() first.");
  }
  const delta = at - Date.now();
  if (delta < 0) throw new Error(`advanceScheduledTo: ${at} is ${-delta}ms in the past`);
  await advanceScheduledBy(t, delta);
}

/** Throw unless no scheduled function is pending or in progress. */
export async function expectNoPendingScheduled<DM extends GenericDataModel>(t: TestAccessor<DM>): Promise<void> {
  const open = (await listScheduled(t)).filter((job) => job.state === "pending" || job.state === "inProgress");
  if (open.length > 0) throw new Error(`expectNoPendingScheduled: open job(s): ${describeJobs(open)}`);
}
