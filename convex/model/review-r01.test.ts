import { appendEvents, openRoomTx } from './runtimeTx';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import { api, internal } from '../_generated/api';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { customRequest } from '../../tests/convex-helpers/request.fixture';
import { trackLiveness } from '../../tests/convex-helpers/setup';

import { beginAttemptTx, createTurnTx, exclusions, openHumanRequestTx, openIfReady, reconcileRun, startRunTx, withConstraintChange } from './runs';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
type Seed = Awaited<ReturnType<typeof seedRoom>>;
async function addItem(ctx: MutationCtx, s: Seed, itemKey: string) {
  await ctx.db.insert('catalogItems', { roomId: s.roomId, itemKey, revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: itemKey, priceCents: 1000, leadDays: 1, taskTemplates: [], confirmedBy: s.users[1]!, confirmedAt: Date.now(), createdBy: s.users[1]!, provenance: 'stub', createdAt: Date.now() });
}
async function events(s: Seed) { return s.t.run(ctx => ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', s.roomId)).collect()); }
async function oneWrite(s: Seed, action: () => Promise<unknown>) {
  const before = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
  const oldEvents = new Set((await events(s)).map(e => e._id));
  const result = await action();
  const after = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
  const added = (await events(s)).filter(e => !oldEvents.has(e._id));
  expect(after.writeSeq - before.writeSeq).toBe(1);
  expect(new Set(added.map(e => e.commitTs)).size).toBe(1);
  expect(added.map(e => e.seq)).toEqual(added.map((_, i) => i));
  return { result, added };
}
const zeroUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
const response = { usage: zeroUsage, rawText: '', stopReason: 'end_turn', stopCategory: null, requestId: null, messageId: null, responseModel: 'stub:v1' };

it.each(['active', 'stale', 'withdrawn'] as const)('W2-4-r01 F1 R20 uses %s disclosure state and never reoffers an answered disclosure', async state => {
  const s = await seedRoom({ until: 'setup' });
  await s.t.run(async ctx => {
    const brief = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'customer')).first())!;
    const hardFields = { schemaKey: 'scope_change.customer.v1' as const, requiredItemKeys: ['missing'], deadline: '2026-10-23' };
    await ctx.db.patch(brief._id, { hardFields });
    if (state === 'stale') {
      const { _id, _creationTime, ...copy } = brief; void _id; void _creationTime;
      await ctx.db.insert('briefs', { ...copy, hardFields, version: 2 });
    }
    await ctx.db.insert('sharedFacts', { roomId: s.roomId, fromRole: 'customer', field: 'requiredItemKeys', seq: 1, value: state === 'withdrawn' ? null : { kind: 'itemKeys', itemKeys: ['missing'] }, audience: state === 'withdrawn' ? [] : ['finance'], briefVersion: 1, source: 'manual', createdBy: s.users[0]!, provenance: 'stub', createdAt: Date.now() });
    // W2-1 materializes explicit withdrawal rows when the new brief removes its disclosure.
    if(state==='stale')await ctx.db.insert('sharedFacts',{roomId:s.roomId,fromRole:'customer',field:'requiredItemKeys',seq:2,value:null,audience:[],briefVersion:2,source:'brief_confirm',createdBy:s.users[0]!,provenance:'stub',createdAt:Date.now()});
    await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!));
  });
  const request = (await s.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', s.roomId).eq('status', 'open')).unique()))!;
  expect(request.toRole).toBe('customer');
  const required = request.options.find(o => o.effect.type === 'disclose' && o.effect.field === 'requiredItemKeys');
  expect(Boolean(required)).toBe(state !== 'active');
  const disclose = request.options.find(o => o.effect.type === 'disclose')!;
  expect(disclose).toBeDefined();
  await s.as('customer').mutation(api.humanRequests.answer, { requestId: request._id, optionKey: disclose.optionKey });
  const next = (await s.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', s.roomId).eq('status', 'open')).unique()))!;
  expect(next._id).not.toBe(request._id);
  const effect = disclose.effect;
  if (effect.type !== 'disclose') throw new Error('Expected disclosure');
  expect(next.options.some(o => o.effect.type === 'disclose' && o.effect.field === effect.field && o.effect.toRoles.includes('finance'))).toBe(false);
  expect((await s.t.run(ctx => ctx.db.get(s.roomId)))!.constraintsVersion).toBe(1);
  trackLiveness(s.t, s.roomId);
});

it.each(['rounds_exhausted', 'agent_escalated'] as const)('W2-4-r01 F1 %s prioritizes the active passing candidate and forwards escalation context', async kind => {
  const s = await seedRoom();
  const first = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.mutation(internal.turns.complete, { attemptId: first._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  const requestId = await s.t.run(async ctx => {
    await addItem(ctx, s, 'aaa'); await addItem(ctx, s, 'bbb');
    const evaluation = (await ctx.db.query('attempts').withIndex('by_run', q => q.eq('runId', first.runId)).order('desc').first())!;
    await ctx.db.patch(evaluation._id, { status: 'error' });
    await ctx.db.patch(evaluation.turnId, { status: 'failed' });
    return openHumanRequestTx(await openRoomTx(ctx, s.roomId, ['open']), first.runId, { kind, toRole: kind === 'agent_escalated' ? 'provider' : 'customer', ...(kind === 'agent_escalated' ? { escalation: { kind: 'needs_tradeoff', toRole: 'customer' } as const } : {}) });
  });
  const request = (await s.t.run(ctx => ctx.db.get(requestId)))!;
  expect(request.toRole).toBe('customer');
  expect(request.options[0]!.effect).toEqual({ type: 'choose_candidate', candidateKey: 'sso_login' });
  expect(request.options.filter(o => o.effect.type === 'choose_candidate')).toHaveLength(3);
});

it('W2-4-r01 F1 R19 exclusions accumulate across requests and future snapshots', async () => {
  const s = await customRequest({ type: 'choose_candidate', candidateKey: 'sso_login' }, 'customer', 'rounds_exhausted');
  await s.t.run(async ctx => {
    await addItem(ctx, s, 'aaa'); await addItem(ctx, s, 'bbb');
    const finance = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'finance')).first())!;
    await ctx.db.patch(finance._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 100000 } });
  });
  const first = await oneWrite(s, s.answer);
  expect(first.result).toMatchObject({ outcome: 'regenerated' });
  expect(first.added.map(e => e.payload.type)).toEqual(['human_request_answered', 'human_request_closed', 'human_request_opened']);
  const next = (await s.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', s.roomId).eq('status', 'open')).unique()))!;
  expect(next.options.some(o => o.effect.type === 'choose_candidate' && o.effect.candidateKey === 'sso_login')).toBe(false);
  const secondChoice = next.options.find(o => o.effect.type === 'choose_candidate' && o.effect.candidateKey === 'aaa+sso_login')!;
  expect(secondChoice).toBeDefined();
  await s.as('customer').mutation(api.humanRequests.answer, { requestId: next._id, optionKey: secondChoice.optionKey });
  const latest = (await s.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', s.roomId).eq('status', 'open')).unique()))!;
  const failed = ['sso_login', 'aaa+sso_login'];
  expect(latest.options.some(o => o.effect.type === 'choose_candidate' && failed.includes(o.effect.candidateKey))).toBe(false);
  await s.t.run(async ctx => {
    const ex = await exclusions(ctx, latest.runId);
    expect(new Set(ex.failedChoices)).toEqual(new Set(failed));
    const finance = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'finance')).first())!;
    await ctx.db.patch(finance._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 200000 } });
    await ctx.db.patch(latest._id, { status: 'superseded', closedReason: 'run_canceled' });
    await ctx.db.patch(latest.runId, { status: 'negotiating' });
    const turnId = await createTurnTx(await openRoomTx(ctx, s.roomId, ['open']), latest.runId, { role: 'provider', kind: 'propose' });
    expect(turnId).not.toBeNull();
    const turn = (await ctx.db.get(turnId!))!;
    expect(turn.candidateSnapshot.length).toBeGreaterThan(0);
    expect(turn.candidateSnapshot.some(c => failed.includes(c.candidateKey))).toBe(false);
  });
});

it.each(['agent_failed', 'agent_escalated'] as const)('W2-4-r02 F2 provider sees its own %s request and actionable phase', async kind => {
  const s = await customRequest({ type: 'end_run' }, 'provider', kind);
  const view = (await s.as('provider').query(api.rooms.view, { roomId: s.roomId }))!;
  expect(view.run).toMatchObject({ status: 'needs_input', activeRole: 'provider' });
  expect(view.header.phase).toMatchObject({ phase: 'needs_input', you: true });
  expect(view.openRequest).toMatchObject({ mine: true, requestId: s.requestId, kind });
});
it('W2-4-r02 F2 masks only a nonrecipient provider and leaves absent buyer requests null', async () => {
  const s = await customRequest({ type: 'end_run' }, 'finance');
  const provider = (await s.as('provider').query(api.rooms.view, { roomId: s.roomId }))!;
  expect(provider.run).toMatchObject({ status: 'run_waiting', activeRole: null });
  expect(provider.header.phase).toMatchObject({ phase: 'needs_input', you: false });
  expect(provider.openRequest).toEqual({ mine: false, kind: 'run_waiting' });
  await s.t.run(ctx => ctx.db.patch(s.requestId, { status: 'superseded' }));
  for (const role of ['customer', 'finance'] as const) {
    const view = (await s.as(role).query(api.rooms.view, { roomId: s.roomId }))!;
    expect(view.run!.status).toBe('needs_input'); expect(view.openRequest).toBeNull();
    expect(view.header.phase.phase).not.toBe('run_waiting');
  }
  await s.t.run(ctx => ctx.db.patch(s.requestId, { status: 'open' }));
});

it.each(['executed', 'closed'] as const)('W2-4-r03 F3 cancel rejects %s room before terminal-run idempotency without writes', async status => {
  const s = await seedRoom({ track: false });
  const run = (await s.t.run(ctx => ctx.db.query('runs').first()))!;
  await s.t.run(async ctx => { await ctx.db.patch(s.roomId, { status }); await ctx.db.patch(run._id, { status: status === 'executed' ? 'executed' : 'canceled', activeTurnSeq: null }); });
  const before = await s.t.run(async ctx => ({ room: await ctx.db.get(s.roomId), run: await ctx.db.get(run._id), events: await ctx.db.query('events').collect() }));
  await expect(s.as('customer').mutation(api.runs.cancel, { runId: run._id })).rejects.toThrow(/room_status/);
  expect(await s.t.run(async ctx => ({ room: await ctx.db.get(s.roomId), run: await ctx.db.get(run._id), events: await ctx.db.query('events').collect() }))).toEqual(before);
});

it('Claude i01 F4 setup write and opening share one lock and one event sequence', async () => {
  const s = await seedRoom({ until: 'setup' });
  const result = await oneWrite(s, () => s.t.run(async ctx => {
    const tx = await openRoomTx(ctx, s.roomId, ['setup'], s.users[2]!);
    await withConstraintChange(tx, { cause: 'brief_confirmed' }, async () => { await appendEvents(tx, [{ type: 'brief_confirmed', role: 'finance', version: 1, hardChanged: true }]); return []; });
  }));
  expect(result.added[0]!.payload.type).toBe('brief_confirmed');
  expect(result.added.some(e => e.payload.type === 'room_opened')).toBe(true);
  expect(result.added.some(e => e.payload.type === 'run_started')).toBe(true);
  trackLiveness(s.t, s.roomId);
});
it.each(['answer', 'retryTurn'] as const)('Claude i01 F4 %s acquires exactly one lock and keeps event sequence contiguous', async entry => {
  const s = await customRequest({ type: 'retry_turn' }, 'provider');
  const request = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  const result = await oneWrite(s, () => entry === 'answer' ? s.answer() : s.as('provider').mutation(api.runs.retryTurn, { runId: request.runId }));
  expect(result.added.some(e => e.payload.type === 'turn_scheduled')).toBe(true);
  if (entry === 'answer') {
    const room = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
    expect(await s.answer()).toEqual({ outcome: 'already_answered' });
    expect((await s.t.run(ctx => ctx.db.get(s.roomId)))!.writeSeq).toBe(room.writeSeq);
  }
});

it('Claude i02 F5 only user-origin startRunTx may reuse a live run', async () => {
  const s = await seedRoom();
  const run = (await s.t.run(ctx => ctx.db.query('runs').first()))!;
  await s.t.run(async ctx => { const tx = await openRoomTx(ctx, s.roomId, ['open']); expect(await startRunTx(tx, { cause: 'manual_start', origin: 'user' })).toMatchObject({ runId: run._id, created: false }); });
  const before = await events(s);
  await expect(s.t.run(async ctx => startRunTx(await openRoomTx(ctx, s.roomId, ['open']), { cause: 'constraints_changed', origin: 'system' }))).rejects.toThrow(/internal/);
  expect(await events(s)).toEqual(before);
  expect(await s.t.run(ctx => ctx.db.query('runs').collect())).toHaveLength(1);
});
it('Claude i03 F6 duplicate request insertion throws; failed-turn reconcile owns its explicit noop', async () => {
  const s = await customRequest({ type: 'retry_turn' }, 'provider');
  const request = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  const before = await events(s);
  await expect(s.t.run(async ctx => openHumanRequestTx(await openRoomTx(ctx, s.roomId, ['open']), request.runId, { kind: 'rounds_exhausted', toRole: 'customer' }))).rejects.toThrow(/internal/);
  expect(await events(s)).toEqual(before);
  await s.t.run(async ctx => {
    const source = (await ctx.db.get(request.sourceTurnId!))!;
    await ctx.db.patch(request.runId, { status: 'negotiating', activeTurnSeq: source.turnSeq });
    const tx = await openRoomTx(ctx, s.roomId, ['open']);
    expect(await reconcileRun(tx, request.runId)).toBe('noop');
    await ctx.db.patch(request.runId, { status: 'needs_input', activeTurnSeq: null });
  });
  expect(await events(s)).toEqual(before);
  expect(await s.t.run(ctx => ctx.db.query('humanRequests').collect())).toHaveLength(1);
});

it('Claude i06 F8 B4a emits one turn_failed and one needs_input transition', async () => {
  const s = await seedRoom();
  const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.run(async ctx => {
    await ctx.db.patch(a._id, { status: 'error' });
    const { _id, _creationTime, ...copy } = a; void _id; void _creationTime;
    await ctx.db.insert('attempts', { ...copy, attemptNo: 2, status: 'error' });
    await ctx.db.patch(a.turnId, { currentAttemptNo: 2 });
  });
  const { added, result } = await oneWrite(s, () => s.t.mutation(internal.turns.beginAttempt, { turnId: a.turnId, origin: 'auto_retry', actorUserId: null }));
  expect(result).toEqual({ kind: 'limit', cause: 'turn_attempts' });
  expect(added.map(e => e.payload.type)).toEqual(['turn_failed', 'run_needs_input', 'human_request_opened']);
  expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ lastFailure: { code: 'turn_attempt_limit' } });
});
it.each(['G1', 'G2', 'G3'] as const)('Claude i06 F8 B2 emits its %s stale transition event', async guard => {
  const s = await seedRoom();
  const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  const before = new Set((await events(s)).map(e => e._id));
  await s.t.run(async ctx => {
    await ctx.db.patch(a._id, { status: 'error' });
    if (guard === 'G1') await ctx.db.patch(a.runId, { status: 'superseded' });
    else if (guard === 'G2') await ctx.db.patch(a.runId, { activeTurnSeq: 99 });
    else await ctx.db.patch(a.turnId, { constraintsVersion: 0 });
    const tx = await openRoomTx(ctx, s.roomId, ['open']);
    expect(await beginAttemptTx(tx, a.turnId, { origin: 'auto_retry', delayMs: 0 })).toEqual({ kind: 'stale' });
    const stale = (await ctx.db.get(a.turnId))!;
    expect(stale.status).toBe('stale');
    // Restore the deliberately corrupted fixture after checking the transition.
    await ctx.db.patch(a.runId, { status: 'negotiating', activeTurnSeq: stale.turnSeq });
    await reconcileRun(tx, a.runId);
  });
  const rejected = (await events(s)).filter(e => !before.has(e._id) && e.payload.type === 'turn_rejected_stale');
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.payload).toMatchObject({ guard });
});
it('Claude i06 F8 R21 opens the next request without a duplicate run_needs_input event', async () => {
  const s = await customRequest({ type: 'pass_to_next', toRole: 'finance' }, 'customer', 'infeasible');
  const { added } = await oneWrite(s, s.answer);
  expect(added.map(e => e.payload.type)).toEqual(['human_request_answered', 'human_request_opened']);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'answered' });
});
