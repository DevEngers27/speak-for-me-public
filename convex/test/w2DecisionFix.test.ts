import { makeFunctionReference as importRef } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness, recordRef } from '../../tests/convex-helpers/w2Execution.fixture';
import { recordDecisionCore } from '../approvals';
import type { Id } from '../_generated/dataModel';
import { ExecutionPlanError } from '@core/engine';
import * as engine from '@core/engine';
import * as logger from '../lib/opsLog';
import { withSanitizedErrors } from '../lib/errors';

type H = Awaited<ReturnType<typeof harness>>;
afterEach(() => vi.restoreAllMocks());
async function state(h: H) { return h.t.run(async ctx => ({ room: await ctx.db.get(h.roomId), approvals: await ctx.db.query('approvals').collect(), events: await ctx.db.query('events').collect(), executions: await ctx.db.query('executions').collect(), ledger: await ctx.db.query('ledgerEntries').collect(), orders: await ctx.db.query('changeOrders').collect(), tasks: await ctx.db.query('tasks').collect() })); }
const logs = () => vi.spyOn(logger, 'publicOpsLog').mockImplementation(() => undefined);
const viewRef = importRef<'query', { roomId: Id<'rooms'> }, unknown>('rooms:view');

describe('W2-2 F2/F3 decision response and read-only replay', () => {
  it('TC-VER-11 F2 withdraw returns the post-write missing roles including the caller', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    expect(await h.as('customer').mutation(recordRef, h.args('withdraw'))).toEqual({ status: 'recorded', decision: 'withdraw', missingRoles: ['customer', 'finance'] });
    expect(await h.approve('finance')).toMatchObject({ status: 'recorded', missingRoles: ['customer'] });
    expect(await h.approve('customer')).toMatchObject({ status: 'executed' });
  });
  it('TC-VER-11 F3 incomplete approve replay skips S11 and the write lock even when checks fail [construct]', async () => {
    const h = await harness(); await h.approve('customer');
    await h.t.run(async ctx => { const b = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).unique(); await ctx.db.patch(b!._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 479999 } }); });
    const before = await state(h); const spy = logs();
    expect(await h.approve('customer')).toEqual({ status: 'unchanged' });
    expect(await state(h)).toEqual(before); expect(spy).not.toHaveBeenCalled();
  });
  it('F3 complete replay still runs checks and converges to execution [construct]', async () => {
    const h = await harness();
    await h.t.run(async ctx => { for (const role of ['customer', 'provider', 'finance'] as const) await ctx.db.insert('approvals', { roomId: h.roomId, proposalId: h.proposalId, runId: h.runId, userId: h.users[role], role, kind: role === 'finance' ? 'budget' : 'terms', decision: 'approve', seq: 1, boundConstraintsVersion: 1, boundTermsKey: h.termsKey, decidedAt: 1 }); });
    expect(await h.approve('customer')).toMatchObject({ status: 'executed' });
  });
});

describe('W2-2 F4 closed public diagnostics', () => {
  it('08-S11 failed checks log the public identifier and preserve not_executable wire code', async () => {
    const h = await harness(); await h.t.run(async ctx => { const b = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).unique(); await ctx.db.patch(b!._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 479999 } }); });
    const spy = logs(); const before = await state(h);
    await expect(h.approve('provider')).rejects.toThrow('approval.not_executable');
    expect(spy).toHaveBeenCalledWith('approval.not_executable', { fn: 'approvals.record' });
    expect(spy).not.toHaveBeenCalledWith('unhandled', expect.anything()); expect(await state(h)).toEqual(before);
  });
  it('08-X2 duplicate room execution logs before the final vote rolls back [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    await h.t.run(ctx => ctx.db.insert('executions', { roomId: h.roomId, runId: h.runId, proposalId: h.proposalId, proposalVersion: 1, executionKey: `exec:${h.proposalId}`, constraintsVersion: 1, termsKey: h.termsKey, approvalIds: [], executedByUserId: h.users.customer, scenarioKey: 'scope_change', scenarioVersion: 1, amountCents: 80000, committedBeforeCents: 400000, committedAfterCents: 480000, capCentsAtExecution: 480000, provenance: 'live', executedAt: 1 }));
    const before = await state(h); const spy = logs(); await expect(h.approve('finance')).rejects.toThrow('internal');
    expect(spy).toHaveBeenCalledWith('invariant.room_already_executed', { fn: 'approvals.record' }); expect(await state(h)).toEqual(before); h.expectFindings(['R2', 'R6', 'R7', 'R11']);
  });
  it('08-X3 duplicate execution key logs before rolling back [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider'); const before = await state(h); const spy = logs();
    await expect(h.t.run(async ctx => {
      const db = new Proxy(ctx.db, { get(target, key) {
        if (key !== 'query') return Reflect.get(target, key);
        return (table: 'executions') => { const query = target.query(table); if (table !== 'executions') return query;
          return new Proxy(query, { get(q, prop) { if (prop !== 'withIndex') return Reflect.get(q, prop); return (index: string, range: never) => index === 'by_executionKey' ? { take: async () => [{ _id: 'injected-key-hit' }] } : query.withIndex(index as 'by_room', range); } }); };
      } });
      const member = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', h.roomId).eq('userId', h.users.finance)).unique();
      return recordDecisionCore({ ...ctx, db } as typeof ctx, member!, h.args());
    })).rejects.toThrow('internal');
    expect(spy).toHaveBeenCalledWith('invariant.duplicate_execution', { fn: 'approvals.record' }); expect(await state(h)).toEqual(before);
  });
  it('08-X1 bypassed currentness guard logs without leaving the final vote [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider'); const before = await state(h); const spy = logs();
    await expect(h.t.run(async ctx => {
      // Body load, lock load, and facade refresh precede the independent X0 reread.
      let roomReads = 0;
      const db = new Proxy(ctx.db, { get(target, key) {
        if (key !== 'get') return Reflect.get(target, key);
        return async (id: Id<'rooms'>) => { const value = await target.get(id); if (id === h.roomId && ++roomReads === 4) return { ...value, currentRunId: undefined }; return value; };
      } });
      const member = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', h.roomId).eq('userId', h.users.finance)).unique();
      return recordDecisionCore({ ...ctx, db } as typeof ctx, member!, h.args());
    })).rejects.toThrow('internal');
    expect(spy).toHaveBeenCalledWith('invariant.guard_bypassed', { fn: 'approvals.record' }); expect(await state(h)).toEqual(before);
  });
  it('F4 ApprovalInvariantError is caught and logged by recordDecisionCore [construct]', async () => {
    const h = await harness(); await h.approve('customer');
    await h.t.run(async ctx => { const a = await ctx.db.query('approvals').unique(); const { _id, _creationTime, ...fields } = a!; void _id; void _creationTime; await ctx.db.insert('approvals', fields); });
    const before = await state(h); const spy = logs(); await expect(h.approve('provider')).rejects.toThrow('internal');
    expect(spy).toHaveBeenCalledWith('invariant.guard_bypassed', { fn: 'approvals.record' }); expect(spy).not.toHaveBeenCalledWith('unhandled', expect.anything()); expect(await state(h)).toEqual(before); h.expectFindings(['R1', 'R11']);
  });
  it('F4 ExecutionPlanError is caught and logged in the execution transaction', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider'); const before = await state(h); const spy = logs();
    const plan = vi.spyOn(engine, 'planExecutionRecords').mockImplementationOnce(() => { throw new ExecutionPlanError('PRIVATE_EXCEPTION_MUST_NOT_LOG'); });
    try { await expect(h.approve('finance')).rejects.toThrow('internal'); } finally { plan.mockRestore(); }
    expect(spy.mock.calls).toEqual([['invariant.guard_bypassed', { fn: 'approvals.record' }]]); expect(await state(h)).toEqual(before);
    expect(await h.approve('finance')).toMatchObject({ status: 'executed' });
  });
  it('08-X14 open request is logged then superseded by execution [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    const requestId = await h.t.run(ctx => ctx.db.insert('humanRequests', { roomId: h.roomId, runId: h.runId, kind: 'rounds_exhausted', toRole: 'customer', questionKey: 'rounds_exhausted', constraintsVersion: 1, options: [{ optionKey: 'A', templateKey: 'end_run', effect: { type: 'end_run' } }], status: 'open', expiresAt: 2, provenance: 'live', createdAt: 1 }));
    const spy = logs(); await h.approve('finance'); expect(spy).toHaveBeenCalledWith('invariant.open_request_at_execution', { fn: 'approvals.record' }); expect((await h.t.run(ctx => ctx.db.get(requestId)))?.status).toBe('superseded');
  });
  it.each(['vacant', 'self_conflict'] as const)('F4 %s approval slot logs a closed view diagnostic [construct]', async kind => {
    const h = await harness(); await h.t.run(async ctx => { const member = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', h.roomId).eq('role', kind === 'vacant' ? 'provider' : 'finance')).unique(); if (kind === 'vacant') await ctx.db.delete(member!._id); else await ctx.db.patch(member!._id, { userId: h.users.provider }); });
    const spy = logs(); expect(await h.as('customer').query(viewRef, { roomId: h.roomId })).not.toBeNull(); expect(spy).toHaveBeenCalledWith(kind === 'vacant' ? 'view.vacant_slot' : 'approval.self_conflict', { fn: 'rooms.view' });
  });
  it('F4 unexpected boundary errors log only the closed function/class fields', async () => {
    const spy = logs(); await expect(withSanitizedErrors('rooms.view', async () => { throw new Error('PRIVATE_EXCEPTION_MUST_NOT_LOG'); })).rejects.toThrow('internal'); expect(spy.mock.calls).toEqual([['unhandled', { fn: 'rooms.view', errorClass: 'Other' }]]);
  });
});
