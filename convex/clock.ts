import {nowMs} from './lib/time';
import { v } from 'convex/values';
import { sysMutation } from './lib/functions';
import { internal } from './_generated/api';
import { rollLocalDateTx, scheduleNextMidnight, todayInTimeZone } from './model/clock';

/** Per-room midnight jobs plus hourly fan-out fallback (12 §12.20). */
export const rollLocalDate = sysMutation('clock.rollLocalDate')({
  args: { roomId: v.optional(v.id('rooms')) },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    const now = nowMs(ctx);
    if (roomId) {
      await rollLocalDateTx(ctx, roomId, now, false, { midnightPath: true });
      const room = await ctx.db.get(roomId);
      if (room && (room.status === 'setup' || room.status === 'open')) {
        await scheduleNextMidnight(ctx, roomId, room.timeZone, now);
      }
    } else {
      const rooms = (await Promise.all((['setup', 'open'] as const).map(status =>
        ctx.db.query('rooms').withIndex('by_status', q => q.eq('status', status)).collect()))).flat();
      for (const room of rooms) {
        if (todayInTimeZone(now, room.timeZone) > room.localDate) {
          await ctx.scheduler.runAfter(0, internal.clock.rollLocalDate, { roomId: room._id });
        }
      }
    }
    return null;
  },
});
