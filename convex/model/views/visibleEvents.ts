import type {MemberCtx} from '../../lib/functions';

/** Exclude owner-only guidance before pagination or latest-activity selection. */
export function visibleEvents(ctx: MemberCtx) {
  return ctx.db.query('events')
    .withIndex('by_room_order', q => q.eq('roomId', ctx.room._id))
    .filter(q => q.or(
      q.neq(q.field('payload.type'), 'brief_soft_updated'),
      q.eq(q.field('actorUserId'), ctx.viewer.userId),
    ));
}
