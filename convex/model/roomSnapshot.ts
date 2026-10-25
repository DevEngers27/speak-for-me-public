import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { reconcileRoom, type RoomSnapshot } from '@core/engine';
import { loadRuleInput, auditScenario } from './approvalHelpers';
import { appError } from '../lib/errors';
/** Indexed, read-only snapshot: no repairs and no cached finance counters. */
export async function loadRoomSnapshot(ctx: Pick<QueryCtx, 'db'>, roomId: Id<'rooms'>): Promise<RoomSnapshot> {
  const room = await ctx.db.get(roomId);
  if (!room) throw appError('auth.not_member');
  const [runs, proposals, members, briefs, catalogItems, ledgerEntries, executions, changeOrders, humanRequests] = await Promise.all([
    ctx.db.query('runs').withIndex('by_room_runNo', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('changeOrders').withIndex('by_room', q => q.eq('roomId', roomId)).collect(),
    ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', roomId)).collect(),
  ]);
  const approvals = (await Promise.all(proposals.map(p => ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', p._id)).collect()))).flat();
  const tasks = await ctx.db.query('tasks').withIndex('by_room_assignee', q => q.eq('roomId', roomId)).collect();
  return { room, runs, proposals, members, briefs, catalogItems, ledgerEntries, executions, changeOrders, humanRequests, approvals, tasks };
}

/** One shared read-only audit used by the query, reconcile and watchdog. */
export async function findRoomFindings(ctx: Pick<QueryCtx, 'db'>, roomId: Id<'rooms'>) {
  const snapshot = await loadRoomSnapshot(ctx, roomId);
  const room = await ctx.db.get(roomId);
  if (!room) return [];
  const loaded = await loadRuleInput(ctx as QueryCtx, room);
  return reconcileRoom(snapshot,{scenario:loaded.scenario??auditScenario,ruleInput:loaded.input});
}
