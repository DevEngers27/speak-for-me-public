/** Read-only rolling buckets; successful command events are the counting source. */
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { appError } from './errors';
import { nowMs } from './time';

export type RateBucket = {
  kind: 'room_create'; actorUserId: Id<'users'>;
} | {
  kind: 'constraint_writes' | 'soft_writes'; actorUserId: Id<'users'>; roomId: Id<'rooms'>;
} | {
  kind: string; roomId: Id<'rooms'>; actorUserId?: Id<'users'>;
  afterCommitTs?:Doc<'events'>['commitTs']; windowMs: number; limit: number; matches: (payload: Doc<'events'>['payload']) => boolean;
};
const HOUR = 3_600_000;
function isConstraintWrite(payload: Doc<'events'>['payload']): boolean {
  return ['brief_confirmed', 'catalog_item_confirmed', 'catalog_item_retired', 'run_renegotiation_requested', 'human_request_answered'].includes(payload.type)
    || (payload.type === 'run_started' && payload.cause === 'manual_start');
}
/** Distinct commits, not event rows: a batch command consumes one slot. */
export async function assertWithinRate(ctx: MutationCtx, bucket: RateBucket): Promise<void> {
  const now = nowMs(ctx);
  if (bucket.kind === 'room_create' && !('roomId' in bucket)) {
    const rooms = await ctx.db.query('rooms').withIndex('by_createdBy', q => q.eq('createdBy', bucket.actorUserId).gt('_creationTime', now - HOUR)).order('desc').take(10);
    if (rooms.length >= 10) throw appError('run.rate_limited', {retryAfterMs: Math.max(1, Math.ceil(rooms[rooms.length - 1]!._creationTime + HOUR - now))});
    return;
  }
  if (!('roomId' in bucket)) throw new TypeError('Missing room bucket');
  const custom = 'matches' in bucket;
  const windowMs = custom ? bucket.windowMs : HOUR;
  const limit = custom ? bucket.limit : bucket.kind === 'soft_writes' ? 30 : 6;
  const matches = custom ? bucket.matches : bucket.kind === 'soft_writes' ? (p: Doc<'events'>['payload']) => p.type === 'brief_soft_updated' : isConstraintWrite;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('Invalid rate bucket');
  const rows = bucket.kind === 'soft_writes' && !custom
    ? await ctx.db.query('events').withIndex('by_room_actor',q=>q.eq('roomId',bucket.roomId).eq('actorUserId',bucket.actorUserId).eq('rateUser','soft_writes').gt('_creationTime',now-HOUR)).order('desc').take(30)
    : bucket.actorUserId
    ? await ctx.db.query('events').withIndex('by_room_actor', q => q.eq('roomId', bucket.roomId).eq('actorUserId', bucket.actorUserId)).filter(q => q.gt(q.field('_creationTime'), now - windowMs)).collect()
    : await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', bucket.roomId)).filter(q => q.gt(q.field('_creationTime'), now - windowMs)).collect();
  const commits = new Map<Doc<'events'>['commitTs'], number>();
  for (const row of rows) if ((!custom||bucket.afterCommitTs===undefined||row.commitTs>bucket.afterCommitTs)&&matches(row.payload)) commits.set(row.commitTs, Math.min(commits.get(row.commitTs) ?? Infinity, row._creationTime));
  if (commits.size >= limit) {
    const times = [...commits.values()].sort((a, b) => b - a);
    // If historical data exceeds the cap, enough commits must expire to free a slot.
    throw appError('run.rate_limited', {retryAfterMs: Math.max(1, Math.ceil(times[limit - 1]! + windowMs - now))});
  }
}
