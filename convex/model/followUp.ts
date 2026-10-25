import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { inheritProvenance } from '@core/engine';
import { appError } from '../lib/errors';
import { openRoomTx, createRoomTx } from '../lib/db';
import { nowMs, todayInTimeZone } from '../lib/time';
import { appendEvents } from './events';
import { addMember } from './members';
import { appendCatalogRow } from './catalog';

/** API-15: apply before every catalog append, including integration's confirm path. */
export async function assertCatalogNotDelivered(ctx: Pick<QueryCtx, 'db'>, room: Doc<'rooms'>, itemKeys: readonly string[]) {
  if (!room.followsExecutionId) return;
  const execution = await ctx.db.get(room.followsExecutionId);
  const proposal = execution ? await ctx.db.get(execution.proposalId) : null;
  if (!proposal) throw appError('internal');
  const duplicates = itemKeys.filter(key => proposal.terms.itemKeys.includes(key));
  if (duplicates.length) throw appError('item.duplicate', { itemKeys: [...new Set(duplicates)] });
}

export async function startFollowUpCore(ctx: MutationCtx, member: Doc<'members'>, executionId: Id<'executions'>) {
  const execution = await ctx.db.get(executionId);
  if (!execution || execution.roomId !== member.roomId) throw appError('auth.not_member');
  const room = await ctx.db.get(member.roomId);
  if (!room || room.status !== 'executed') throw appError('run.invalid_state', { guard: 'room_status' });
  const existing = await ctx.db.query('rooms').withIndex('by_followsExecutionId', q => q.eq('followsExecutionId', executionId)).take(2);
  if (existing.length > 1) throw appError('internal');
  if (existing[0]) return { roomId: existing[0]._id, created: false };
  const now = nowMs(ctx);
  const recent = await ctx.db.query('rooms').withIndex('by_createdBy', q => q.eq('createdBy', member.userId)).filter(q => q.gt(q.field('_creationTime'), now - 3_600_000)).take(10);
  if (recent.length >= 10) throw appError('run.rate_limited', { retryAfterMs: 3_600_000 });
  const tx = await openRoomTx(ctx, room._id, {allow:['executed']});
  const proposal = await ctx.db.get(execution.proposalId);
  if (!proposal) throw appError('internal');
  const localDate = todayInTimeZone(now, room.timeZone);
  const nextTx = await createRoomTx(ctx, {
    scenarioKey: room.scenarioKey, scenarioVersion: room.scenarioVersion,
    title: `${[...room.title].slice(0, 108).join('')} · follow-up`, timeZone: room.timeZone, localDate,
    status: 'setup', constraintsVersion: 0, nextProposalVersion: 1, nextRunNo: 1, writeSeq: 0,
    followsExecutionId: executionId, createdBy: member.userId, provenance: inheritProvenance(room.provenance, execution.provenance), createdAt: now,
  });
  const newRoom = nextTx.room;
  const roomId = newRoom._id;
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect();
  for (const seat of members) {
    await addMember(nextTx, {userId:seat.userId,role:seat.role,via:'follow_up'});
  }
  await appendEvents(nextTx,[{payload:{type:'room_created',scenarioKey:room.scenarioKey,scenarioVersion:room.scenarioVersion},actor:{kind:'user',role:member.role},actorUserId:member.userId},...members.map(seat=>({payload:{type:'member_joined' as const,role:seat.role},actor:{kind:'user' as const,role:member.role},actorUserId:member.userId}))]);
  const rows = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', room._id)).collect();
  const latest = new Map<string, Doc<'catalogItems'>>();
  for (const row of rows) {
    const previous = latest.get(row.itemKey);
    if (!previous || row.revision > previous.revision || row.revision === previous.revision && row.editNo > previous.editNo) latest.set(row.itemKey, row);
  }
  for (const row of latest.values()) {
    if (row.status !== 'confirmed' || proposal.terms.itemKeys.includes(row.itemKey)) continue;
    await appendCatalogRow(nextTx, {userId:member.userId,provenance:row.provenance}, {itemKey:row.itemKey,kind:row.kind,title:row.title,priceCents:row.priceCents,leadDays:row.leadDays,taskTemplates:row.taskTemplates}, undefined, 'draft');
  }
  await appendEvents(tx,[{payload:{type:'follow_up_started',followUpRoomId:roomId},actor:{kind:'user',role:member.role},actorUserId:member.userId}]);
  return { roomId, created: true };
}
