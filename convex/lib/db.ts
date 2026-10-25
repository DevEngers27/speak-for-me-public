/** W2-1: room-scoped write facade (03 §3.3). */
import type { WithoutSystemFields } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { appError } from './errors';
import { nowMs } from './time';
import { APPEND_ONLY_TABLES, MUTABLE_FIELDS } from './schemaTypes';
import type { RoomScopedTable } from './schemaTypes';

export { MUTABLE_FIELDS };
export const APPEND_ONLY = APPEND_ONLY_TABLES;
type MutableRoomTable = Extract<keyof typeof MUTABLE_FIELDS, RoomScopedTable>;
export type MutablePatch<T extends MutableRoomTable> = Partial<Pick<Doc<T>, Extract<(typeof MUTABLE_FIELDS)[T][number], keyof Doc<T>>>>;
const roomTxBrand: unique symbol = Symbol('RoomTx');
export type RoomTx = {
  readonly [roomTxBrand]: true;
  readonly room: Readonly<Doc<'rooms'>>;
  insert<T extends Exclude<RoomScopedTable, 'rooms'> | 'rawOutputs'>(table: T, doc: WithoutSystemFields<Doc<T>>): Promise<Id<T>>;
  patch<T extends MutableRoomTable>(table: T, id: Id<T>, fields: MutablePatch<T>): Promise<void>;
};
export type RoomCtx = MutationCtx & { readonly tx: RoomTx };

const eventSequences = new WeakMap<object, Map<string, number>>();
const txState = new WeakMap<RoomTx, { ctx: MutationCtx; seq: number; now: number }>();
/** Read-only capabilities for appendEvents; raw writes stay in this facade. */
export function eventWriteContext(tx: RoomTx) {
  const state = txState.get(tx);
  if (!state) throw new TypeError('Unknown RoomTx');
  return {
    db: state.ctx.db as import('../_generated/server').QueryCtx['db'],
    createdAt: state.now,
    // Convex resolves this sentinel at commit; it is never returned to clients.
    commitTs: state.ctx.db.vars.commitTs,
    nextSeq: () => {
      let rooms = eventSequences.get(state.ctx.db);
      if (!rooms) { rooms = new Map(); eventSequences.set(state.ctx.db, rooms); }
      const seq = rooms.get(tx.room._id) ?? 0;
      rooms.set(tx.room._id, seq + 1);
      return seq;
    },
  };
}

/** Global users exception: unique writer remains model/users.ts. */
export async function patchUser(ctx: MutationCtx, id: Id<'users'>, fields: Partial<Pick<Doc<'users'>, (typeof MUTABLE_FIELDS)['users'][number]>>): Promise<void> {
  if (Object.keys(fields).some(field => !(MUTABLE_FIELDS.users as readonly string[]).includes(field))) throw new TypeError('Non-whitelisted field');
  await ctx.db.patch(id, fields);
}

const WRITE_ONCE = new Set([
  'usage', 'stopReason', 'stopCategory', 'requestId', 'messageId', 'responseModel',
  'latencyMs', 'costMicroUsd', 'priceTableAsOf',
]);

export async function openRoomTx(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  opts: { allow: readonly Doc<'rooms'>['status'][] },
): Promise<RoomTx> {
  const before = await ctx.db.get(roomId);
  if (!before) throw appError('auth.not_member');
  if (!opts.allow.includes(before.status)) throw appError('run.invalid_state', { guard: 'room_status' });
  await ctx.db.patch(roomId, { writeSeq: before.writeSeq + 1 });
  const room = await ctx.db.get(roomId);
  if (!room) throw appError('internal');
  return makeRoomTx(ctx, room);
}

/** New-room insertion itself is the genesis lock; its stored writeSeq starts at 0. */
export async function createRoomTx(ctx: MutationCtx, fields: WithoutSystemFields<Doc<'rooms'>>): Promise<RoomTx> {
  if(fields.status !== 'setup' || fields.writeSeq !== 0) throw new TypeError('Invalid room genesis');
  const id=await ctx.db.insert('rooms',fields);
  const room=await ctx.db.get(id);
  if(!room) throw appError('internal');
  return makeRoomTx(ctx,room);
}
function makeRoomTx(ctx: MutationCtx, room: Doc<'rooms'>): RoomTx {
  const roomId=room._id;
  const tx: RoomTx = Object.freeze({
    [roomTxBrand]: true as const,
    room: Object.freeze(room),
    async insert<T extends Exclude<RoomScopedTable, 'rooms'> | 'rawOutputs'>(table: T, doc: WithoutSystemFields<Doc<T>>): Promise<Id<T>> {
      if (['users', 'rooms', 'opsFlags', 'spendCounters'].includes(table)) throw new TypeError('Not a room child table');
      if (!('roomId' in doc) || doc.roomId !== roomId) throw new TypeError('Cross-room insert');
      return await ctx.db.insert(table, doc);
    },
    async patch<T extends MutableRoomTable>(table: T, id: Id<T>, fields: MutablePatch<T>): Promise<void> {
      // Check again at runtime: casts and JavaScript callers cannot widen the policy.
      if (!Object.hasOwn(MUTABLE_FIELDS, table) || ['users', 'opsFlags', 'spendCounters'].includes(table)) throw new TypeError('Not a mutable room table');
      const allowed: readonly string[] = MUTABLE_FIELDS[table];
      if (Object.keys(fields).some(field => !allowed.includes(field))) throw new TypeError('Non-whitelisted field');
      if (ctx.db.normalizeId(table, id) !== id) throw new TypeError('Wrong table id');
      const row = await ctx.db.get(id);
      if (!row || (table === 'rooms' ? id !== roomId : !('roomId' in row) || row.roomId !== roomId)) throw new TypeError('Cross-room patch');
      if (table === 'attempts') {
        const current = row as unknown as Record<string, unknown>;
        if (Object.keys(fields).some(field => WRITE_ONCE.has(field) && current[field] !== undefined)) throw new TypeError('Write-once field');
      }
      await ctx.db.patch(id, fields as Partial<Doc<T>>);
    },
  });
  txState.set(tx, { ctx, seq: 0, now: nowMs(ctx) });
  return tx;
}

// W2-4: global scheduler accounting has no room scope; its writes still use this facade.
type GlobalTable='opsFlags'|'spendCounters'|'rawOutputs';
export async function insertGlobal<T extends GlobalTable>(ctx:MutationCtx,table:T,fields:WithoutSystemFields<Doc<T>>):Promise<Id<T>> {
  if(!['opsFlags','spendCounters','rawOutputs'].includes(table))throw new TypeError('Not a scheduler global table');
  return ctx.db.insert(table,fields);
}
export async function patchGlobal<T extends 'opsFlags'|'spendCounters'>(ctx:MutationCtx,table:T,id:Id<T>,fields:Partial<Pick<Doc<T>,Extract<(typeof MUTABLE_FIELDS)[T][number],keyof Doc<T>>>>):Promise<void> {
  if(!['opsFlags','spendCounters'].includes(table)||Object.keys(fields).some(key=>!(MUTABLE_FIELDS[table] as readonly string[]).includes(key)))throw new TypeError('Non-whitelisted global field');
  if(ctx.db.normalizeId(table,id)!==id||!await ctx.db.get(id))throw new TypeError('Missing global row');
  await ctx.db.patch(id,fields as Partial<Doc<T>>);
}

/** D18 reset/retention exception: deletion never changes retained domain history. */
export async function deleteMaintenanceRow(ctx: MutationCtx, id: Id<import('../_generated/dataModel').TableNames>): Promise<void> {
  await ctx.db.delete(id);
}
/** §3.16.2 redaction exception to immutable history, limited to approved fields. */
export async function redactField<T extends 'users' | 'members' | 'invites' | 'rooms' | 'briefs' | 'approvals'>(ctx: MutationCtx, id: Id<T>, fields: Partial<Doc<T>>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.some(key => !['displayName', 'invitedEmail', 'title', 'softFields', 'note'].includes(key))) throw new TypeError('Invalid redaction');
  await ctx.db.patch(id, fields);
}
