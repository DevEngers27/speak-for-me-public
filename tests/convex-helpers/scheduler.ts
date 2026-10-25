import type { TestConvex } from 'convex-test';
import type schema from '../../convex/schema';
import { expect, vi } from 'vitest';
function testNow(){const now=vi.getMockedSystemTime();if(!now)throw new Error('Scheduler helpers require fake timers');return now.getTime();}
export type RuntimeTest = TestConvex<typeof schema>;
/** Advance only the requested horizon; watchdog chains must never drain all timers. */
export async function drainDue(t: RuntimeTest, maxIterations = 50) {
  for (let i = 0; i < maxIterations; i++) {
    // Fake timers schedule a newly-created zero-delay timer at the next millisecond.
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    const due = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    if (!due.some(f => f.state.kind === 'pending' && f.scheduledTime <= testNow())) { await expectNoFailedScheduled(t); return; }
  }
  throw new Error('drainDue: scheduler did not settle');
}
export async function advanceScheduledTo(t: RuntimeTest, at: number) {
  if (at < testNow()) throw new Error('Cannot move scheduled time backwards');
  await vi.advanceTimersByTimeAsync(at - testNow());
  await t.finishInProgressScheduledFunctions();
}
export async function expectNoFailedScheduled(t: RuntimeTest) {
  const rows = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
  expect(rows.filter(r => r.state.kind === 'failed')).toEqual([]);
}
