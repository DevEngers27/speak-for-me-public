import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../schema';
import { modules } from '../../tests/convex-helpers/setup';
import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { MAX_CLOCK_JOB_READS, nextLocalMidnight, rollLocalDateTx, scheduleNextMidnight, todayInTimeZone } from './clock';

const now = Date.UTC(2026, 9, 25, 0, 30);
afterEach(() => { vi.useRealTimers(); });
async function fixture(status: Doc<'rooms'>['status'] = 'open', date = '2026-10-24') {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert('users', { tokenIdentifier: 'clock', displayName: 'Clock', isTestAccount: true, createdAt: now, updatedAt: now });
    const roomId = await ctx.db.insert('rooms', { title: 'Clock test', scenarioKey: 'scope_change', scenarioVersion: 1,
      status, localDate: date, timeZone: 'UTC', constraintsVersion: 1, writeSeq: 0,
      nextRunNo: 1, nextProposalVersion: 1, createdBy: userId, provenance: 'stub', createdAt: now });
    return { roomId, userId };
  });
  return { t, ...ids };
}
async function pendingFixture() {
  const f = await fixture();
  const { t, roomId, userId } = f;
  await t.run(async ctx => {
    await ctx.db.insert('ledgerEntries', { roomId, kind: 'baseline', amountCents: 0, recordedByUserId: userId, provenance: 'stub', createdAt: now });
    await ctx.db.insert('briefs', { roomId, role: 'customer', version: 1, hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-12-31' }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes: '' }, disclosures: {}, source: 'form', confirmedBy: userId, confirmedAt: now, provenance: 'stub' });
    await ctx.db.insert('briefs', { roomId, role: 'finance', version: 1, hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 1000 }, softFields: { schemaKey: 'scope_change.finance.v1', notes: '' }, disclosures: {}, source: 'form', confirmedBy: userId, confirmedAt: now, provenance: 'stub' });
    await ctx.db.insert('catalogItems', { roomId, itemKey: 'login', revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: 'Login', priceCents: 100, leadDays: 0, taskTemplates: [], confirmedBy: userId, confirmedAt: now, createdBy: userId, provenance: 'stub', createdAt: now });
    const runId = await ctx.db.insert('runs', { roomId, runNo: 1, status: 'pending_approval', cause: 'room_opened', constraintsVersionAtStart: 1,
      agentMode: 'stub', roundNo: 1, maxRounds: 4, roundsExtended: false, activeTurnSeq: null, nextTurnSeq: 1, attemptCount: 0, maxAttempts: 24,
      reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 1_000_000, provenance: 'stub', startedAt: now });
    const proposalId = await ctx.db.insert('proposals', { roomId, runId, version: 1, origin: 'agent', authorRole: 'provider', candidateKey: 'login@',
      terms: { itemKeys: ['login'], modifiers: [], amountCents: 100, deliveryDate: '2026-10-24' }, termsKey: 'clock-terms',
      lines: [{ itemKey: 'login', kind: 'item', revision: 1, title: 'Login', priceCents: 100, leadDays: 0 }], plannedTasks: [], requiredApprovals: [],
      createdAtConstraintsVersion: 1, status: 'active', statusChangedAt: now, provenance: 'stub', createdAt: now });
    await ctx.db.patch(runId, { currentProposalId: proposalId });
    await ctx.db.patch(roomId, { currentRunId: runId, nextRunNo: 2, nextProposalVersion: 2 });
  });
  return f;
}

describe('W2-3 clock', () => {
  it('CC-13 timezone conversion and midnight respect both DST transitions', () => {
    expect(todayInTimeZone(Date.UTC(2026, 9, 24, 1), 'America/Los_Angeles')).toBe('2026-10-23');
    const springStart = Date.UTC(2026, 2, 8, 8);
    const fallStart = Date.UTC(2026, 10, 1, 7);
    expect(nextLocalMidnight(springStart, 'America/Los_Angeles') - springStart).toBe(23 * 3_600_000);
    expect(nextLocalMidnight(fallStart, 'America/Los_Angeles') - fallStart).toBe(25 * 3_600_000);
    expect(nextLocalMidnight(now, 'UTC')).toBe(Date.UTC(2026, 9, 26));
  });
  it('CC-13 missing and terminal rooms are read-only', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    for (const status of ['executed', 'closed'] as const) {
      const { t, roomId } = await fixture(status);
      await t.mutation(internal.clock.rollLocalDate, { roomId });
      expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-24', writeSeq: 0, constraintsVersion: 1 });
    }
    const { t, roomId } = await fixture();
    await t.run(ctx => ctx.db.delete(roomId));
    await expect(t.mutation(internal.clock.rollLocalDate, { roomId })).resolves.toBeNull();
  });
  it('CC-13 same local date is idempotent without taking a write lock', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture('open', '2026-10-25');
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ writeSeq: 0 });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(1);
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(1);
  });
  it('CC-13 no verdict flip advances only localDate and schedules the next midnight', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture();
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', writeSeq: 1, constraintsVersion: 1 });
    expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(0);
    const scheduled = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.scheduledTime).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 26));
    expect(scheduled[0]!.scheduledTime).toBeLessThan(Date.UTC(2026, 9, 26) + 1000);
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ writeSeq: 1 });
  });
  it('CC-13 pending proposal date flip bumps once and never rematerializes its absolute delivery date', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await pendingFixture();
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 2 });
    const revisions = await t.run(ctx => ctx.db.query('constraintRevisions').collect());
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ cause: 'clock', localDate: '2026-10-25', sourceRefs: [{ kind: 'clock', localDate: '2026-10-25' }] });
    const old = await t.run(ctx => ctx.db.query('proposals').first());
    expect(old).toMatchObject({ status: 'stale', terms: { deliveryDate: '2026-10-24' } });
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(1);
  });
  it('CC-13 open request candidate time verdict flip supersedes the request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await pendingFixture();
    const requestId = await t.run(async ctx => {
      const room = (await ctx.db.get(roomId))!;
      const runId = room.currentRunId!;
      await ctx.db.patch(runId, { status: 'needs_input' });
      const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'customer')).first();
      await ctx.db.patch(brief!._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-10-24' } });
      return ctx.db.insert('humanRequests', { roomId, runId, kind: 'infeasible', toRole: 'customer', questionKey: 'clock', constraintsVersion: 1,
        options: [{ optionKey: 'A', templateKey: 'choose', effect: { type: 'choose_candidate', candidateKey: 'login' } },
          { optionKey: 'B', templateKey: 'extend', effect: { type: 'extend_deadline', date: '2026-10-24' } },
          { optionKey: 'C', templateKey: 'end', effect: { type: 'end_run' } }], status: 'open', expiresAt: now + 604800000, provenance: 'stub', createdAt: now });
    });
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ constraintsVersion: 2 });
    expect(await t.run(ctx => ctx.db.get(requestId))).toMatchObject({ status: 'superseded' });
  });
  it('RT-16 fan-out schedules only overdue open rooms without locking any room', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture();
    await t.mutation(internal.clock.rollLocalDate, {});
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-24', writeSeq: 0 });
    const scheduled = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.args).toEqual([{ roomId }]);
  });
  it('SM-22 room creation can register its exact next local midnight', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture('setup');
    await t.run(ctx => scheduleNextMidnight(ctx, roomId, 'UTC', now));
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(1);
  });
});


describe('W2-3 step 2b integration', () => {
  it('TC-RUN-17 turns.complete rolls date before G1–G3 and rejects the old attempt without storing raw output', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId, userId } = await pendingFixture();
    const { attemptId, runId, turnId } = await t.run(async ctx => {
      const room = (await ctx.db.get(roomId))!;
      const runId = room.currentRunId!;
      const turnId = await ctx.db.insert('turns', { roomId, runId, turnSeq: 1, roundNo: 1, role: 'provider', kind: 'propose', status: 'running',
        constraintsVersion: 1, candidateSnapshot: [{ optionKey: 'O1', candidateKey: 'login', itemKeys: ['login'], modifiers: [], amountCents: 100, deliveryDate: '2026-10-24' }],
        allowedActions: ['propose'], promptVersion: 'clock-integration', currentAttemptNo: 1, createdAt: now - 3600000 });
      await ctx.db.patch(runId, { activeTurnSeq: 1, nextTurnSeq: 2, attemptCount: 1 });
      const attemptId = await ctx.db.insert('attempts', { roomId, runId, turnId, attemptNo: 1, role: 'provider', origin: 'turn_start', status: 'running', provenance: 'stub',
        model: 'stub:v1', effort: 'medium', maxTokens: 16000, protocolVersion: '1', promptVersion: 'clock-integration', reservedDay: '2026-10-24', watchdogArmCount: 0,
        deadlineAt: now + 60000, reservedMicroUsd: 0, lateUsage: false, startedAt: now - 3600000 });
      return { attemptId, runId, turnId };
    });
    await t.mutation(internal.turns.complete, { attemptId, actorUserId: userId, move: { action: 'propose', optionKey: 'O1', rationale: '' },
      response: { usage: { inputTokens: 12, outputTokens: 6, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, thinkingTokens: 0 }, stopReason: 'end_turn', stopCategory: null,
        requestId: 'clock-request', messageId: 'clock-message', responseModel: 'stub:v1', rawText: 'PRIVATE_CLOCK_RAW_CANARY' }, schemaVersion: 'v1', latencyMs: 2 });
    const rows = await t.run(async ctx => ({ room: await ctx.db.get(roomId), attempt: await ctx.db.get(attemptId), turn: await ctx.db.get(turnId), run: await ctx.db.get(runId), raw: await ctx.db.query('rawOutputs').collect() }));
    expect(rows.room).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 2, writeSeq: 1 });
    expect(rows.room!.currentRunId).not.toBe(runId);
    expect(rows.run).toMatchObject({ status: 'superseded' });
    expect(rows.turn).toMatchObject({ status: 'stale' });
    expect(rows.attempt).toMatchObject({ status: 'stale', staleGuard: 'G1', lateUsage: true, usage: { inputTokens: 12, outputTokens: 6 } });
    expect(rows.attempt!.rawOutputRef).toBeUndefined();
    expect(rows.raw).toHaveLength(0);
  });

  for (const flips of [true, false]) {
    it(`SM-22 choose_candidate rolls before materialization: ${flips ? 'time verdict flip regenerates request' : 'still-valid choice uses new localDate'}`, async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      const { t, roomId, userId } = await pendingFixture();
      const requestId = await t.run(async ctx => {
        await ctx.db.insert('members', { roomId, userId, role: 'customer', displayName: 'Customer', joinedVia: 'creator', joinedAt: now });
        const room = (await ctx.db.get(roomId))!; const runId = room.currentRunId!;
        await ctx.db.patch(runId, { status: 'needs_input' });
        if (flips) {
          const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'customer')).first();
          await ctx.db.patch(brief!._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-10-24' } });
        }
        return ctx.db.insert('humanRequests', { roomId, runId, kind: 'infeasible', toRole: 'customer', questionKey: 'choose', constraintsVersion: 1,
          options: [{ optionKey: 'A', templateKey: 'choose', effect: { type: 'choose_candidate', candidateKey: 'login' } }, { optionKey: 'E', templateKey: 'end', effect: { type: 'end_run' } }],
          status: 'open', expiresAt: now + 604800000, provenance: 'stub', createdAt: now - 3600000 });
      });
      const customer = t.withIdentity({ tokenIdentifier: 'clock' });
      const result = await customer.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' });
      const rows = await t.run(async ctx => ({ room: await ctx.db.get(roomId), request: await ctx.db.get(requestId), proposals: await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', roomId)).collect() }));
      expect(rows.room).toMatchObject({ localDate: '2026-10-25', writeSeq: 1 });
      if (flips) {
        expect(result).toMatchObject({ outcome: 'regenerated' });
        expect(rows.room).toMatchObject({ constraintsVersion: 2 });
        expect(rows.request).toMatchObject({ status: 'superseded' });
        expect(rows.proposals).toHaveLength(1);
        expect(rows.proposals[0]).toMatchObject({ status: 'stale', terms: { deliveryDate: '2026-10-24' } });
      } else {
        expect(result).toMatchObject({ outcome: 'applied', effect: 'choose_candidate' });
        expect(rows.room).toMatchObject({ constraintsVersion: 1 });
        expect(rows.request).toMatchObject({ status: 'answered' });
        expect(rows.proposals.filter(p => p.origin === 'human_choice')).toHaveLength(1);
        expect(rows.proposals.find(p => p.origin === 'human_choice')).toMatchObject({ terms: { deliveryDate: '2026-10-25' } });
      }
    });
  }
});

describe('W2-3 fix round 2 clock regressions', () => {
  it('CC-13 F1 setup midnight advances without a bump and keeps exactly one successor', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture('setup');
    await t.run(async ctx => {
      await ctx.db.patch(roomId, { constraintsVersion: 0 });
      await scheduleNextMidnight(ctx, roomId, 'UTC', now - 86_400_000);
      // An old queued midnight job and a duplicate must not strand the chain.
      await ctx.scheduler.runAt(nextLocalMidnight(now, 'UTC'), internal.clock.rollLocalDate, { roomId });
    });
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    const room = await t.run(ctx => ctx.db.get(roomId));
    expect(room).toMatchObject({ status: 'setup', localDate: '2026-10-25', constraintsVersion: 0, writeSeq: 1 });
    expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('runs').collect())).toEqual([]);
    const successors = () => t.run(async ctx => (await ctx.db.system.query('_scheduled_functions').collect()).filter(job => job.state.kind === 'pending'));
    expect(await successors()).toHaveLength(1);
    expect((await successors())[0]!.scheduledTime).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 26));
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toEqual(room);
    expect(await successors()).toHaveLength(1);
    vi.setSystemTime(now + 86_400_000);
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-26', constraintsVersion: 0 });
    expect(await successors()).toHaveLength(1);
  });

  it('SM-22 F1 date rolls before readiness is evaluated after the stored deadline passed', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId, userId } = await pendingFixture();
    await t.run(async ctx => {
      const room = (await ctx.db.get(roomId))!;
      const run = (await ctx.db.get(room.currentRunId!))!;
      await ctx.db.delete(run.currentProposalId!); await ctx.db.delete(run._id);
      await ctx.db.patch(roomId, { status: 'setup', constraintsVersion: 0, currentRunId: undefined, nextRunNo: 1, nextProposalVersion: 1 });
      for (const role of ['customer', 'provider', 'finance'] as const) {
        const memberId = role === 'finance' ? userId : await ctx.db.insert('users', { tokenIdentifier: `setup|${role}`, displayName: role, isTestAccount: true, createdAt: now, updatedAt: now });
        await ctx.db.insert('members', { roomId, userId: memberId, role, displayName: role, joinedVia: 'creator', joinedAt: now });
      }
      await ctx.db.insert('briefs', { roomId, role: 'provider', version: 1, hardFields: { schemaKey: 'scope_change.provider.v1' }, softFields: { schemaKey: 'scope_change.provider.v1', notes: '' }, disclosures: {}, source: 'form', confirmedBy: userId, confirmedAt: now, provenance: 'stub' });
      const customer = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'customer')).first())!;
      await ctx.db.patch(customer._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-10-24' } });
    });
    const {openIfReady}=await import('./constraints');
    const {openRoomTx}=await import('../lib/db');
    await t.run(async ctx => {
      const tx=await openRoomTx(ctx,roomId,{allow:['setup']});
      const patch = vi.spyOn(ctx.db, 'patch');
      const query = vi.spyOn(ctx.db, 'query');
      try {
        await openIfReady({...ctx,tx},roomId,userId);
        const datePatch = patch.mock.calls.findIndex(call => call[0] === roomId && JSON.stringify(call[1]) === JSON.stringify({ localDate: '2026-10-25' }));
        const readinessRead = query.mock.calls.findIndex(call => call[0] === 'members');
        expect(datePatch).toBeGreaterThanOrEqual(0); expect(readinessRead).toBeGreaterThanOrEqual(0);
        expect(patch.mock.invocationCallOrder[datePatch]).toBeLessThan(query.mock.invocationCallOrder[readinessRead]!);
      } finally { patch.mockRestore(); query.mockRestore(); }
    });
    // Readiness uses W2-1's real helper; this regression asserts ordering only.
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', writeSeq: 1 });
  });

  it('SM-22 F1 setup date confirmation validates against the rolled date with one lock', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId, userId } = await fixture('setup');
    await t.run(async ctx => {
      await ctx.db.patch(roomId, { constraintsVersion: 0 });
      await ctx.db.insert('members', { roomId, userId, role: 'customer', displayName: 'Customer', joinedVia: 'creator', joinedAt: now });
      await ctx.db.insert('catalogItems', { roomId, itemKey: 'login', revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: 'Login', priceCents: 100, leadDays: 0, taskTemplates: [], confirmedBy: userId, confirmedAt: now, createdBy: userId, provenance: 'stub', createdAt: now });
    });
    const customer = t.withIdentity({ tokenIdentifier: 'clock' });
    const confirm = (deadline: string) => customer.mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: 0,
      hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline },
      softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes: '' }, disclosures: {} });
    await expect(confirm('2026-10-24')).rejects.toThrow('date.in_past');
    await expect(confirm('2026-10-26')).resolves.toMatchObject({ bumped: false, constraintsVersion: 0 });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 0, writeSeq: 1 });
  });

  for (const effect of [{ type: 'extend_deadline', date: '2026-10-24' }, { type: 'choose_candidate', candidateKey: 'login' }] as const) {
    it(`CC-13 F3 customer's ${effect.type} date flips despite finance's tight undisclosed cap`, async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      const { t, roomId } = await pendingFixture();
      const requestId = await t.run(async ctx => {
        const room = (await ctx.db.get(roomId))!; const runId = room.currentRunId!;
        await ctx.db.patch(runId, { status: 'needs_input' });
        const finance = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'finance')).first())!;
        const customer = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'customer')).first())!;
        await ctx.db.patch(finance._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 0 } });
        await ctx.db.patch(customer._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-10-24' } });
        return ctx.db.insert('humanRequests', { roomId, runId, kind: 'infeasible', toRole: 'customer', questionKey: 'date', constraintsVersion: 1,
          options: [{ optionKey: 'A', templateKey: 'date', effect }], status: 'open', expiresAt: now + 604800000, provenance: 'stub', createdAt: now });
      });
      await t.mutation(internal.clock.rollLocalDate, { roomId });
      expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 2 });
      expect(await t.run(ctx => ctx.db.get(requestId))).toMatchObject({ status: 'superseded' });
      expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toMatchObject([{ cause: 'clock' }]);
    });
  }

  it('CC-13 F3 customer private deadline expiry cannot flip a finance raise_cap request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await pendingFixture();
    const { requestId, runId } = await t.run(async ctx => {
      const room = (await ctx.db.get(roomId))!; const runId = room.currentRunId!;
      await ctx.db.patch(runId, { status: 'needs_input' });
      const customer = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'customer')).first())!;
      const finance = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'finance')).first())!;
      await ctx.db.patch(finance._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 50 } });
      await ctx.db.patch(customer._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-10-24' } });
      const requestId = await ctx.db.insert('humanRequests', { roomId, runId, kind: 'infeasible', toRole: 'finance', questionKey: 'cap', constraintsVersion: 1,
        options: [{ optionKey: 'A', templateKey: 'cap', effect: { type: 'raise_cap', amountCents: 1000 } }], status: 'open', expiresAt: now + 604800000, provenance: 'stub', createdAt: now });
      return { requestId, runId };
    });
    const { loadRuleInputForRole } = await import('./constraintInput');
    const financeView = await t.run(ctx => loadRuleInputForRole(ctx, roomId, 'finance', '2026-10-24'));
    expect(financeView).toMatchObject({ viewer: 'finance', capCents: 50 });
    expect(financeView.deadline).toBeUndefined(); expect(financeView.requiredItemKeys).toBeUndefined();
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 1, currentRunId: runId });
    expect(await t.run(ctx => ctx.db.get(requestId))).toMatchObject({ status: 'open' });
    expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('events').collect())).toEqual([]);
  });
});

describe('W2-3 fix round 3 scheduler regressions', () => {
  it('TC-RUN-17 F6 unchanged-date turn completion performs zero scheduler reads or writes with 300 unrelated jobs', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId, userId } = await pendingFixture();
    const attemptId = await t.run(async ctx => {
      const room = (await ctx.db.get(roomId))!; const runId = room.currentRunId!;
      await ctx.db.patch(roomId, { localDate: '2026-10-25' });
      const proposal = (await ctx.db.get((await ctx.db.get(runId))!.currentProposalId!))!;
      await ctx.db.patch(proposal._id, { terms: { ...proposal.terms, deliveryDate: '2026-10-26' } });
      const { _id, _creationTime, ...copy } = room; void _id; void _creationTime;
      const otherRoomId = await ctx.db.insert('rooms', { ...copy, currentRunId: undefined, title: 'Other room' });
      for (let i = 0; i < 300; i++) await ctx.scheduler.runAt(now + 86_400_000 + i, internal.clock.rollLocalDate, { roomId: otherRoomId });
      const turnId = await ctx.db.insert('turns', { roomId, runId, turnSeq: 1, roundNo: 1, role: 'provider', kind: 'propose', status: 'running', constraintsVersion: 1,
        candidateSnapshot: [{ optionKey: 'O1', candidateKey: 'login', itemKeys: ['login'], modifiers: [], amountCents: 100, deliveryDate: '2026-10-25' }],
        allowedActions: ['propose'], promptVersion: 'clock-integration', currentAttemptNo: 1, createdAt: now });
      await ctx.db.patch(runId, { activeTurnSeq: 1, nextTurnSeq: 2, attemptCount: 1 });
      return ctx.db.insert('attempts', { roomId, runId, turnId, attemptNo: 1, role: 'provider', origin: 'turn_start', status: 'running', provenance: 'stub',
        model: 'stub:v1', effort: 'medium', maxTokens: 16000, protocolVersion: '1', promptVersion: 'clock-integration', reservedDay: '2026-10-25', watchdogArmCount: 0,
        deadlineAt: now + 60000, reservedMicroUsd: 0, lateUsage: false, startedAt: now });
    });
    const before = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(before).toHaveLength(300);
    const { commitAttempt:completeTurn } = await import('./runs');
    await t.run(async ctx => {
      const reads = [vi.spyOn(ctx.db.system, 'query'), vi.spyOn(ctx.db.system, 'get')];
      const writes = [vi.spyOn(ctx.scheduler, 'runAt'), vi.spyOn(ctx.scheduler, 'runAfter'), vi.spyOn(ctx.scheduler, 'cancel')];
      try {
        await completeTurn(ctx, { attemptId, actorUserId: userId, move: { action: 'propose', optionKey: 'O1', rationale: '' },
          response: { usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, thinkingTokens: 0 },
            stopReason: 'end_turn', stopCategory: null, requestId: 'same-date', messageId: 'same-date', responseModel: 'stub:v1', rawText: '{}' }, schemaVersion: 'v1', latencyMs: 0 });
        for (const operation of [...reads, ...writes]) expect(operation).not.toHaveBeenCalled();
      } finally { for (const operation of [...reads, ...writes]) operation.mockRestore(); }
    });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toEqual(before);
    // The linked run is pending approval: this unchanged-date completion is rejected at G1, without touching timers.
    expect(await t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ status: 'stale', staleGuard:'G1', lateUsage: true });
  });

  it('CC-13 F6 a changed step-2b date queues only the single-room path, which registers one midnight successor', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture('setup');
    await t.run(async ctx => {
      const query = vi.spyOn(ctx.db.system, 'query');
      const runAt = vi.spyOn(ctx.scheduler, 'runAt');
      const runAfter = vi.spyOn(ctx.scheduler, 'runAfter');
      try {
        expect(await rollLocalDateTx(ctx, roomId)).toBe(true);
        expect(query).not.toHaveBeenCalled(); expect(runAt).not.toHaveBeenCalled();
        expect(runAfter).toHaveBeenCalledExactlyOnceWith(0, internal.clock.rollLocalDate, { roomId });
      } finally { query.mockRestore(); runAt.mockRestore(); runAfter.mockRestore(); }
    });
    const queued = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(queued).toHaveLength(1); expect(queued[0]!.scheduledTime).toBe(now);
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    const pending = await t.run(async ctx => (await ctx.db.system.query('_scheduled_functions').collect()).filter(job => job.state.kind === 'pending'));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.scheduledTime).toBeGreaterThanOrEqual(nextLocalMidnight(now, 'UTC'));
  });

  it('CC-13 F6 midnight registration bounds scheduler rows read despite unrelated history', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { t, roomId } = await fixture('setup', '2026-10-25');
    await t.run(async ctx => {
      const { _id, _creationTime, ...copy } = (await ctx.db.get(roomId))!; void _id; void _creationTime;
      const otherRoomId = await ctx.db.insert('rooms', { ...copy, title: 'Other room' });
      for (let i = 0; i < 300; i++) await ctx.scheduler.runAt(now + 86_400_000 + i, internal.clock.rollLocalDate, { roomId: otherRoomId });
    });
    let rowsRead = 0;
    function counted<T extends object>(query: T): T {
      return new Proxy(query, { get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (key === 'collect') return () => { throw new Error('unbounded scheduler scan'); };
        if (key === 'take') return async (limit: number) => {
          expect(limit).toBeLessThanOrEqual(MAX_CLOCK_JOB_READS);
          if (typeof value !== 'function') throw new Error('missing take');
          const rows = await Reflect.apply(value, target, [limit]) as unknown[];
          rowsRead += rows.length; return rows;
        };
        if (typeof value === 'function') return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, target, args);
          return result !== null && typeof result === 'object' ? counted(result) : result;
        };
        return value;
      } });
    }
    await t.run(async ctx => {
      const original = ctx.db.system.query;
      const tracked: typeof original = table => counted(original(table));
      const query = vi.spyOn(ctx.db.system, 'query').mockImplementation(tracked);
      try { await scheduleNextMidnight(ctx, roomId, 'UTC', now); }
      finally { query.mockRestore(); }
    });
    expect(rowsRead).toBe(MAX_CLOCK_JOB_READS);
    await t.mutation(internal.clock.rollLocalDate, { roomId });
    const ownPending = await t.run(async ctx => (await ctx.db.system.query('_scheduled_functions').collect()).filter(job => job.state.kind === 'pending' && job.args[0]?.roomId === roomId));
    expect(ownPending).toHaveLength(1);
  });
});
