import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from '../schema';
import { modules } from '../../tests/convex-helpers/setup';
import { openRoomTx, type RoomTx } from './db';
import type { Id } from '../_generated/dataModel';

async function fixture(status: 'setup' | 'executed' | 'closed' = 'setup') {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert('users', { tokenIdentifier: 'test|alice', displayName: 'Alice', isTestAccount: true, createdAt: 1, updatedAt: 1 });
    const roomId = await ctx.db.insert('rooms', {
      scenarioKey: 'scope_change', scenarioVersion: 1, title: 'Room', timeZone: 'UTC', localDate: '2026-10-24',
      status, constraintsVersion: 0, nextProposalVersion: 1, nextRunNo: 1, writeSeq: 0,
      createdBy: userId, provenance: 'live', createdAt: 1,
    });
    return { userId, roomId };
  });
  return { t, ...ids };
}

test('03-3.3 openRoomTx increments writeSeq and exposes the updated room', async () => {
  const { t, roomId } = await fixture();
  await t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, { allow: ['setup'] });
    expect(tx.room.writeSeq).toBe(1);
    expect((await ctx.db.get(roomId))!.writeSeq).toBe(1);
  });
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(1);
});

test('03-3.3 RoomTx.patch rejects a non-whitelisted field', async () => {
  const { t, roomId } = await fixture();
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, { allow: ['setup'] });
    await tx.patch('rooms', roomId, { title: 'changed' } as never);
  })).rejects.toThrow('Non-whitelisted field');
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(0);
});

test.each(['executed', 'closed'] as const)('SC-T5 %s room rejects a setup write with no changes', async status => {
  const { t, roomId } = await fixture(status);
  await expect(t.run(async ctx => { await openRoomTx(ctx, roomId, { allow: ['setup'] }); })).rejects.toThrow(/run.invalid_state/);
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(0);
});

test('SC-T5 explicit executed exception permits a transaction', async () => {
  const { t, roomId } = await fixture('executed');
  await t.run(async ctx => {
    expect((await openRoomTx(ctx, roomId, { allow: ['executed'] })).room.writeSeq).toBe(1);
  });
});

test('03-3.3 RoomTx rejects cross-room inserts and patches', async () => {
  const { t, roomId, userId } = await fixture();
  const otherRoom = await t.run(async ctx => {
    const room = (await ctx.db.get(roomId))!;
    const { _id, _creationTime, ...fields } = room;
    void _id; void _creationTime;
    return await ctx.db.insert('rooms', fields);
  });
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, { allow: ['setup'] });
    await tx.insert('members', { roomId: otherRoom, userId, role: 'customer', displayName: 'Alice', joinedVia: 'creator', joinedAt: 1 });
  })).rejects.toThrow('Cross-room insert');
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, { allow: ['setup'] });
    await tx.patch('rooms', otherRoom, { localDate: '2026-10-25' });
  })).rejects.toThrow('Cross-room patch');
});

test('03-3.3 RoomTx refuses append-only patches even after a type cast', async () => {
  const { t, roomId } = await fixture();
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, { allow: ['setup'] });
    await tx.patch('briefs' as never, roomId as never, {});
  })).rejects.toThrow('Not a mutable room table');
});

// Compile-time SC-T5 controls: a raw mutation context is not a RoomTx;
// append-only tables and immutable fields cannot enter the facade.
function typeControls(tx: RoomTx, roomId: Id<'rooms'>) {
  // @ts-expect-error title is immutable
  void tx.patch('rooms', roomId, { title: 'changed' });
  // @ts-expect-error append-only table
  void tx.patch('briefs', '' as Id<'briefs'>, {});
  // @ts-expect-error RoomTx cannot be fabricated without its private brand
  const forged: RoomTx = { room: tx.room, insert: tx.insert, patch: tx.patch };
  void forged;
}
void typeControls;

// W2-1: append, rate, and state helpers share the same production RoomTx.
import { appendEvents } from '../model/events';
import { assertWithinRate } from './rateLimit';
import { setStatus } from './status';

test('INV-56 appendEvents allocates seq across calls and inherits provenance', async () => {
  const {t, roomId} = await fixture();
  await t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await appendEvents(tx, [{payload: {type: 'baseline_recorded'}, actor: {kind: 'system'}}]);
    await appendEvents(tx, [{payload: {type: 'baseline_recorded'}, actor: {kind: 'system'}}, {payload: {type: 'room_closed'}, actor: {kind: 'system'}}]);
  });
  const rows = await t.run(async ctx => await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', roomId)).collect());
  expect(rows.map(row => row.seq)).toEqual([0, 1, 2]);
  expect(new Set(rows.map(row => row.commitTs)).size).toBe(1);
  expect(typeof rows[0]!.commitTs).toBe('bigint');
  expect(rows.every(row => row.provenance === 'live')).toBe(true);
});
test('INV-56 appendEvents rejects a nonmember user actor without persisting rows', async () => {
  const {t, roomId, userId} = await fixture();
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await appendEvents(tx, [{payload: {type: 'baseline_recorded'}, actor: {kind: 'user', role: 'finance'}, actorUserId: userId}]);
  })).rejects.toThrow(/internal/);
  expect(await t.run(async ctx => await ctx.db.query('events').collect())).toEqual([]);
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(0);
});
test('INV-56 appendEvents rejects a restricted reference outside the room', async () => {
  const {t, roomId, userId} = await fixture();
  const baselineId = await t.run(async ctx => {
    const room = (await ctx.db.get(roomId))!;
    const {_id, _creationTime, ...fields} = room; void _id; void _creationTime;
    const other = await ctx.db.insert('rooms', fields);
    return await ctx.db.insert('ledgerEntries', {roomId: other, kind: 'baseline', amountCents: 0, recordedByUserId: userId, provenance: 'live', createdAt: 1});
  });
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await appendEvents(tx, [{payload: {type: 'baseline_recorded'}, actor: {kind: 'system'}, restrictedRef: {table: 'ledgerEntries', id: baselineId}}]);
  })).rejects.toThrow(/internal/);
  expect(await t.run(async ctx => await ctx.db.query('events').collect())).toEqual([]);
});
test('12.2 constraint_writes counts distinct commits and excludes non-command events', async () => {
  const {t, roomId, userId} = await fixture();
  await t.run(async ctx => {
    await ctx.db.insert('members', {roomId, userId, role: 'finance', displayName: 'Alice', joinedVia: 'creator', joinedAt: 1});
  });
  const writeBatch = async () => await t.run(async ctx => {
    await assertWithinRate(ctx, {kind: 'constraint_writes', roomId, actorUserId: userId});
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await appendEvents(tx, Array.from({length: 3}, () => ({payload: {type: 'brief_confirmed' as const, role: 'finance' as const, version: 1, hardChanged: true}, actor: {kind: 'user' as const, role: 'finance' as const}, actorUserId: userId})));
  });
  for (let i = 0; i < 6; i++) await writeBatch();
  await expect(writeBatch()).rejects.toThrow(/run.rate_limited/);
  const rows = await t.run(async ctx => await ctx.db.query('events').collect());
  expect(rows).toHaveLength(18);
  expect(new Set(rows.map(row => row.commitTs)).size).toBe(6);
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(6);
  // A different configurable bucket has its own counting predicate.
  await t.run(async ctx => await assertWithinRate(ctx, {kind: 'run_starts', roomId, limit: 1, windowMs: 86400000, matches: payload => payload.type === 'run_started'}));
});
test('04-4.1.2 setStatus asserts source state and legal transition', async () => {
  const {t, roomId} = await fixture();
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await setStatus({...ctx, tx}, 'rooms', roomId, 'open', 'closed');
  })).rejects.toThrow('State changed');
  await expect(t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await setStatus({...ctx, tx}, 'rooms', roomId, 'setup', 'executed');
  })).rejects.toThrow('state.illegal_transition');
  await t.run(async ctx => {
    const tx = await openRoomTx(ctx, roomId, {allow: ['setup']});
    await setStatus({...ctx, tx}, 'rooms', roomId, 'setup', 'closed', {closedAt: 1});
    await appendEvents(tx, [{payload: {type: 'room_closed'}, actor: {kind: 'system'}}]);
  });
  expect(await t.run(async ctx => await ctx.db.get(roomId))).toMatchObject({status: 'closed', writeSeq: 1, closedAt: 1});
});

test('12.2 room_create limits each actor to ten rooms per rolling hour', async () => {
  const {t, roomId, userId} = await fixture();
  await t.run(async ctx => {
    const {_id, _creationTime, ...fields} = (await ctx.db.get(roomId))!;
    void _id; void _creationTime;
    for (let i = 0; i < 9; i++) await ctx.db.insert('rooms', fields);
  });
  await expect(t.run(async ctx => await assertWithinRate(ctx, {kind: 'room_create', actorUserId: userId}))).rejects.toThrow(/run.rate_limited/);
  expect(await t.run(async ctx => (await ctx.db.query('rooms').collect()).length)).toBe(10);
});
