/** Lifecycle commands carry their caller's single room write facade. */
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { openRoomTx as lockRoom, type RoomTx as WriteTx } from '../lib/db';
import { appendEvents as append } from './events';
import { setStatus as transition } from '../lib/status';
import { assertWithinRate as assertRate } from '../lib/rateLimit';
import type { EventPayload } from '../lib/schemaTypes';
export type RoomTx = {ctx: MutationCtx; tx: WriteTx; room: WriteTx['room']; actorUserId: Id<'users'> | null};
export function bindRoomTx(ctx: MutationCtx, tx: WriteTx, actorUserId: Id<'users'> | null = null): RoomTx { return {ctx, tx, room: tx.room, actorUserId}; }
export async function openRoomTx(ctx: MutationCtx, roomId: Id<'rooms'>, allow: readonly Doc<'rooms'>['status'][], actorUserId: Id<'users'> | null = null) { return bindRoomTx(ctx, await lockRoom(ctx, roomId, {allow}), actorUserId); }
export async function appendEvents(tx: RoomTx, payloads: readonly EventPayload[], refs: Doc<'events'>['refs'] = {}, restrictedRef?: Doc<'events'>['restrictedRef']) {
  await append(tx.tx, payloads.map(payload => ({payload, refs, actor:{kind:'system' as const}, ...(tx.actorUserId ? {actorUserId:tx.actorUserId} : {}), ...(restrictedRef ? {restrictedRef} : {})})));
}
type StatusTable = 'rooms'|'runs'|'turns'|'attempts'|'proposals'|'humanRequests';
type Change = {[T in StatusTable]:{table:T;id:Id<T>;patch:import('../lib/db').MutablePatch<T>}}[StatusTable];
export async function setStatus(tx:RoomTx,c:Change) {
  const row=await tx.ctx.db.get(c.id);if(!row)throw new TypeError('Missing transition target');
  const {status,...extra}=c.patch;
  if(status===undefined||status===row.status) { await tx.tx.patch(c.table,c.id,extra as never);return; }
  await transition({...tx.ctx,tx:tx.tx},c.table,c.id,row.status as never,status as never,extra as never);
}
export async function assertWithinRate(ctx:MutationCtx,roomId:Id<'rooms'>,actorUserId:Id<'users'>|null,runStarts=false) {
  if(actorUserId)await assertRate(ctx,{kind:'constraint_writes',roomId,actorUserId});
  if(runStarts)await assertRate(ctx,{kind:'run_starts',roomId,windowMs:86400000,limit:6,matches:p=>p.type==='run_started'});
}
