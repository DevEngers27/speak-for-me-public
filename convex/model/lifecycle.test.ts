import { openRoomTx } from './runtimeTx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { drainDue, expectNoFailedScheduled, advanceScheduledTo } from '../../tests/convex-helpers/scheduler';
import { WATCHDOG_FIRST_MS, ACTION_WALL_MAX_MS, CALL_DEADLINE_MS } from '@core/engine';
import { openIfReady, withConstraintChange, MAX_REACT_DEPTH, bump } from './runs';

import { livenessFindings } from '../testing';
import { trackLiveness } from '../../tests/convex-helpers/setup';
const zero = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
export const response = { usage: { ...zero, inputTokens: 100, outputTokens: 20 }, stopReason: 'end_turn', stopCategory: null, requestId: 'req-test', messageId: 'msg-test', responseModel: 'test', rawText: 'PRIVATE-MODEL-RAW' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
export async function activeAttempt(s: Awaited<ReturnType<typeof seedRoom>>) { return (await s.t.run(ctx => ctx.db.query('attempts').withIndex('by_room', q => q.eq('roomId', s.roomId)).order('desc').first()))!; }

describe('scheduler lifecycle', () => {
  it('04-M2 F1–F4 third confirmation opens at cv 1 and run 1 in the same mutation', async () => {
    const s = await seedRoom({ until: 'setup' });
    await s.t.run(async ctx => {
      const finance = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'finance')).first();
      const tx = await openRoomTx(ctx, s.roomId, ['setup'], s.users[2]!);
      await ctx.db.delete(finance!._id);
      expect(await openIfReady(tx)).toBe(false);
      const { _id, _creationTime, ...record } = finance!; void _id; void _creationTime;
      await ctx.db.insert('briefs', record);
      expect(await openIfReady(tx)).toBe(true);
    });
    const room = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
    expect(room).toMatchObject({ status: 'open', constraintsVersion: 1, nextRunNo: 2 });
    expect(await s.t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(1);
    const run = await s.t.run(ctx => ctx.db.get(room.currentRunId!));
    expect(run).toMatchObject({ status: 'negotiating', constraintsVersionAtStart: 1, runNo: 1, activeTurnSeq: 1 });
    expect(await s.t.run(ctx => livenessFindings(ctx, s.roomId))).toEqual([]);
    trackLiveness(s.t, s.roomId);
  });
  it('RT-03 one scheduling seam creates exactly one action and one later watchdog', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    const scheduled = await s.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(scheduled.filter(job=>job.name!=='clock:rollLocalDate')).toHaveLength(2);
    expect(scheduled.find(f => f._id === a.watchdogFnId)!.scheduledTime - scheduled.find(f => f._id === a.actionFnId)!.scheduledTime).toBe(WATCHDOG_FIRST_MS);
    expect(CALL_DEADLINE_MS).toBeLessThan(ACTION_WALL_MAX_MS);
    expect(ACTION_WALL_MAX_MS).toBeLessThan(WATCHDOG_FIRST_MS);
    await expect(s.t.mutation(internal.turns.beginAttempt, { turnId: a.turnId, origin: 'turn_start', actorUserId: null })).rejects.toThrow(/internal/);
    expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(1);
  });
  it('CE-036 stub chain evaluates serially and stops at pending_approval without approvals', async () => {
    const s = await seedRoom();
    for (let i = 0; i < 5; i++) await drainDue(s.t);
    const turns = await s.t.run(ctx => ctx.db.query('turns').collect());
    expect(turns.map(t => [t.role, t.status])).toEqual([['provider', 'completed'], ['customer', 'completed'], ['finance', 'completed']]);
    const room = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
    expect(await s.t.run(ctx => ctx.db.get(room.currentRunId!))).toMatchObject({ status: 'pending_approval', activeTurnSeq: null });
    expect(await s.t.run(ctx => ctx.db.query('approvals').collect())).toEqual([]);
    await expectNoFailedScheduled(s.t);
  });
  it('RT-01 G1 stale completion writes usage once and never creates proposals', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    await s.as('customer').mutation(api.runs.cancel, { runId: a.runId });
    const before = await s.t.run(ctx => ctx.db.query('events').collect());
    const args = { attemptId: a._id, actorUserId: null, move: { action: 'propose' as const, optionKey: 'O1', rationale: 'private' }, response, schemaVersion: 'test', latencyMs: 1 };
    await s.t.mutation(internal.turns.complete, args);
    await s.t.mutation(internal.turns.complete, { ...args, response: { ...response, usage: { ...zero, inputTokens: 999 } } });
    expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'stale', staleGuard: 'G1', usage: response.usage });
    expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('rawOutputs').collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('events').collect())).toHaveLength(before.length + 1);
  });
  it('RT-01 G2 mismatch replaces the stale turn through reconcile', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    await s.t.run(ctx => ctx.db.patch(a.runId, { activeTurnSeq: 999 }));
    await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 1 });
    expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'stale', staleGuard: 'G2' });
    expect(await s.t.run(ctx => ctx.db.query('turns').collect())).toHaveLength(2);
  });
  it('CE-127 G3 drift replaces run and loadTurnContext returns null', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    await s.t.run(ctx => ctx.db.patch(s.roomId, { constraintsVersion: 2 }));
    expect(await s.t.query(internal.agents.loadTurnContext, { attemptId: a._id })).toBeNull();
    await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'stale_context' }, latencyMs: 0 });
    expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'superseded' });
    expect(await s.t.run(ctx => ctx.db.query('runs').collect())).toHaveLength(2);
  });
  it('LV-1 reconcile repairs a stranded negotiating run', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    await s.t.run(ctx => ctx.db.patch(a._id, { status: 'error' }));
    expect((await s.t.run(ctx => livenessFindings(ctx, s.roomId))).map(f => f.invariant)).toContain('LV-1');
    expect(await s.t.mutation(internal.runs.reconcile, { runId: a.runId })).toBe('redispatched');
    expect(await s.t.run(ctx => livenessFindings(ctx, s.roomId))).toEqual([]);
  });
  it('09-9.4 unchanged projection writes no revision and depth limit rolls back', async () => {
    const s = await seedRoom();
    await s.t.run(async ctx => {
      const tx = await openRoomTx(ctx, s.roomId, ['open']);
      expect(await withConstraintChange(tx, { cause: 'catalog_changed' }, async () => [])).toEqual({ changed: false, constraintsVersion: 1 });
    });
    await expect(s.t.run(async ctx => bump(await openRoomTx(ctx, s.roomId, ['open']), { cause: 'catalog_changed', sourceRefs: [], depth: MAX_REACT_DEPTH }))).rejects.toThrow(/constraints.react_depth_exceeded/);
    expect(await s.t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(1);
  });
  it('SM-29 forceClose cancels without creator identity and is idempotent', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    expect(await s.t.mutation(internal.rooms.forceClose, { roomId: s.roomId, reason: 'not logged' })).toEqual({ status: 'closed' });
    expect(await s.t.mutation(internal.rooms.forceClose, { roomId: s.roomId, reason: 'again' })).toEqual({ status: 'unchanged' });
    expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'canceled', endedReason: 'room_closed' });
  });
  it('CE-126 refusal creates exactly one private agent_failed request', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'refused', errorCode: 'output.refusal', response }, latencyMs: 1 });
    const requests = await s.t.run(ctx => ctx.db.query('humanRequests').collect());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'agent_failed', toRole: 'provider', status: 'open' });
    expect(requests[0]!.options.map(o => o.effect.type)).toEqual(['retry_turn', 'end_run']);
  });
  it('CE-139 expired request ends the run without closing the room', async () => {
    const s = await seedRoom({ capCents: 100000 });
    const request = (await s.t.run(ctx => ctx.db.query('humanRequests').first()))!;
    vi.setSystemTime(request.expiresAt);
    expect(await s.t.mutation(internal.humanRequests.expireDue, { requestId: request._id })).toBeNull();
    expect(await s.t.run(ctx => ctx.db.get(request.runId))).toMatchObject({ status: 'ended_no_agreement', endedReason: 'request_expired' });
    expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ status: 'open' });
  });
  it('RT-02 watchdog re-arms pending action at most three times', async () => {
    const s = await seedRoom(); const a = await activeAttempt(s);
    for (let i = 1; i <= 3; i++) { await s.t.mutation(internal.agents.watchdog, { attemptId: a._id }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ watchdogArmCount: i, status: 'running' }); }
    await s.t.mutation(internal.agents.watchdog, { attemptId: a._id });
    expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'timeout', errorCode: 'watchdog_timeout' });
    await advanceScheduledTo(s.t, Date.now() + 2000);
    await expectNoFailedScheduled(s.t);
  });
});
it.each(['negotiating', 'pending_approval', 'needs_input', 'executed', 'superseded', 'ended_no_agreement', 'canceled'] as const)('09-9.5 dispose %s', async status => {
  const { disposeCurrentRun } = await import('./runs');
  const s = await seedRoom(); const a = await activeAttempt(s);
  await s.t.run(async ctx => {
    await ctx.db.patch(a.runId, { status });
    const tx = await openRoomTx(ctx, s.roomId, ['open']);
    const result = await disposeCurrentRun(tx, 'constraints_changed');
    if (['negotiating', 'pending_approval', 'needs_input'].includes(status)) {
      expect(result).toHaveProperty('runId', a.runId);
      expect(await ctx.db.get(a.runId)).toMatchObject({ status: 'superseded', activeTurnSeq: null });
      expect(await ctx.db.get(a.turnId)).toMatchObject({ status: 'stale' });
    } else {
      expect(result).toEqual({}); expect(await ctx.db.get(a.runId)).toMatchObject({ status });
    }
  });
});
it('10.9 reconcile noop and repeated G0 commit do not increment the room write lock', async () => {
  const s = await seedRoom(); const a = await activeAttempt(s);
  const before = (await s.t.run(ctx => ctx.db.get(s.roomId)))!.writeSeq;
  expect(await s.t.mutation(internal.runs.reconcile, { runId: a.runId })).toBe('noop');
  expect((await s.t.run(ctx => ctx.db.get(s.roomId)))!.writeSeq).toBe(before);
  const args = { attemptId: a._id, actorUserId: null, move: { action: 'propose' as const, optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 };
  await s.t.mutation(internal.turns.complete, args);
  const after = (await s.t.run(ctx => ctx.db.get(s.roomId)))!.writeSeq;
  await s.t.mutation(internal.turns.complete, args);
  expect((await s.t.run(ctx => ctx.db.get(s.roomId)))!.writeSeq).toBe(after);
});
it('INV-66 agent stub proposals remain marked stub in an otherwise live room', async () => {
  const s = await seedRoom(); const a = await activeAttempt(s);
  await s.t.run(ctx => ctx.db.patch(s.roomId, { provenance: 'live' }));
  await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  expect(await s.t.run(ctx => ctx.db.query('proposals').first())).toMatchObject({ provenance: 'stub' });
});
it('INV-SM-08 replacing a stale turn terminalizes its old running attempt', async () => {
  const s = await seedRoom(); const a = await activeAttempt(s);
  await s.t.run(ctx => ctx.db.patch(a.turnId, { status: 'stale' }));
  expect(await s.t.mutation(internal.runs.reconcile, { runId: a.runId })).toBe('replaced');
  expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'stale' });
  expect((await s.t.run(ctx => ctx.db.query('attempts').collect())).filter(a => a.status === 'running')).toHaveLength(1);
});
