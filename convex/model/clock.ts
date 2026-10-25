import {nowMs, todayInTimeZone} from '../lib/time';
export {todayInTimeZone} from '../lib/time';
import { getFunctionName } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { bump,makeConstraintTx } from './constraints';
import type {RoomCtx} from '../lib/db';
import {rollLocalDateWith} from './clockDate';

/** Find the first instant of the next local date; handles 23/25h DST days and
 * zones whose civil midnight is skipped. No fixed UTC offset is assumed. */
export function nextLocalMidnight(now: number, timeZone: string): number {
  const today = todayInTimeZone(now, timeZone);
  let low = Math.floor(now);
  let high = low + 48 * 3_600_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (todayInTimeZone(middle, timeZone) <= today) low = middle;
    else high = middle;
  }
  return high;
}

// Temporary bound until 03 supplies an owned per-room clockFnId (needs ruling).
export const MAX_CLOCK_JOB_READS = 64;

export async function scheduleNextMidnight(ctx: MutationCtx, roomId: Id<'rooms'>, timeZone: string, now = nowMs(ctx)): Promise<void> {
  // Stable sub-second jitter spreads rooms without nondeterministic random state.
  const jitter = [...roomId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 1_000;
  const scheduledTime = nextLocalMidnight(now, timeZone) + jitter;
  const name = getFunctionName(internal.clock.rollLocalDate);
  // Cold path only (rooms.create / clock.rollLocalDate). Bound rows read, not
  // merely matching rows returned: filtering before take could scan history.
  // The creation-time index lets us inspect the newest jobs first.
  const jobs = await ctx.db.system.query('_scheduled_functions')
    .withIndex('by_creation_time').order('desc').take(MAX_CLOCK_JOB_READS);
  let successor = false;
  for (const job of jobs) {
    const args: unknown = job.args[0];
    if (job.name !== name || job.state.kind !== 'pending' || typeof args !== 'object' || args === null || !('roomId' in args) || args.roomId !== roomId) continue;
    if (!successor && job.scheduledTime === scheduledTime) successor = true;
    else await ctx.scheduler.cancel(job._id);
  }
  if (!successor) await ctx.scheduler.runAt(scheduledTime, internal.clock.rollLocalDate, { roomId });
}

/** Public clock facade supplies the authoritative constraint lifecycle callback. */
export async function rollLocalDateTx(ctx: MutationCtx|RoomCtx, roomId: Id<'rooms'>, now = nowMs(ctx), lockHeld = false, options: { midnightPath?: boolean } = {}): Promise<boolean> {
  return rollLocalDateWith(async (roomCtx, id, today) => {
    await bump(makeConstraintTx(roomCtx, id), { cause: 'clock', sourceRefs: [{ kind: 'clock', localDate: today }], depth: 0 });
  }, ctx, roomId, now, lockHeld, options);
}
