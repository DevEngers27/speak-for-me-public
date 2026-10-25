import { openRoomTx } from '../../convex/model/runtimeTx';
import { expect, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import { script, scriptedSuccess } from './scriptedModel';
import { customRequest } from './request.fixture';
import { seedRoom } from './seedRoom.fixture';
import { drainDue, expectNoFailedScheduled, advanceScheduledTo } from './scheduler';
import { openIfReady, openHumanRequestTx, createTurnTx } from '../../convex/model/runs';

import { livenessFindings } from '../../convex/testing';
import { WATCHDOG_FIRST_MS } from '@core/engine';
const usage = { inputTokens: 100, outputTokens: 10, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
const response = { usage, stopReason: 'end_turn', stopCategory: null, requestId: null, messageId: null, responseModel: 'test', rawText: 'PRIVATE_RAW CANARY-RAT-provider' };
type Seed = Awaited<ReturnType<typeof seedRoom>>;
const attempt = async (s: Seed) => (await s.t.run(ctx => ctx.db.query('attempts').withIndex('by_room', q => q.eq('roomId', s.roomId)).order('desc').first()))!;
const request = async (s: Seed) => (await s.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', s.roomId).eq('status', 'open')).first()))!;
async function refusal(s: Seed) { const a = await attempt(s); await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'refused', errorCode: 'output.refusal', response }, latencyMs: 0 }); return a; }
async function complete(s: Seed, optionKey = 'O1', rationale = '') { const a = await attempt(s); await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey, rationale }, response, schemaVersion: 'test', latencyMs: 0 }); return a; }
async function settled() { const s = await seedRoom(); await drainDue(s.t); return s; }
const bodies: Record<string, () => Promise<void>> = {
  'CE-036': async () => { const s = await settled(); expect(await s.t.run(ctx => ctx.db.query('approvals').collect())).toEqual([]); expect(await s.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ status: 'pending_approval' }); expect((await s.t.run(ctx => ctx.db.query('turns').collect())).map(t => t.role)).toEqual(['provider', 'customer', 'finance']); },
  'INV-67': async () => { const s = await seedRoom(); const a = await attempt(s); const first = await s.as('customer').mutation(api.runs.start, { roomId: s.roomId }); const second = await s.as('finance').mutation(api.runs.start, { roomId: s.roomId }); expect(first).toEqual(second); expect(first).toMatchObject({ created: false, runId: a.runId }); expect(await s.t.run(ctx => ctx.db.query('runs').collect())).toHaveLength(1); },
  'CE-133': async () => { const s = await settled(); const before = await s.t.run(ctx => ctx.db.query('events').collect()); expect(await s.as('provider').mutation(api.runs.start, { roomId: s.roomId })).toMatchObject({ created: false, status: 'pending_approval' }); expect(await s.t.run(ctx => ctx.db.query('events').collect())).toHaveLength(before.length); },
  'CE-068': async () => { const s = await seedRoom(); const a = await attempt(s); await expect(s.as('customer').mutation(api.runs.requestRenegotiation, { roomId: s.roomId, expectedRunId: a.runId })).rejects.toThrow(/run.invalid_state/); await expect(s.as('provider').mutation(api.runs.requestRenegotiation, { roomId: s.roomId, expectedRunId: a.runId })).rejects.toThrow(/auth.not_creator/); expect(await s.t.run(ctx => ctx.db.query('runs').collect())).toHaveLength(1); },
  'INV-75': async () => { const s = await seedRoom({ until: 'setup' }); await s.t.run(async ctx => openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!))); expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ status: 'open', constraintsVersion: 1, nextRunNo: 2 }); expect(await s.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ runNo: 1, cause: 'room_opened', constraintsVersionAtStart: 1 }); },
  'CE-146': async () => { const s = await seedRoom({ until: 'setup' }); vi.stubEnv('AGENT_MODE', 'live'); await s.t.run(async ctx => { await ctx.db.insert('opsFlags', { key: 'global', draining: true, changedAt: Date.now(), changedBy: null }); await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!)); }); expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ status: 'open', constraintsVersion: 1 }); expect(await s.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ status: 'negotiating' }); expect(await s.t.run(ctx => ctx.db.query('turns').first())).toMatchObject({ waitingReason: 'draining' }); expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(0); },
  'INV-69': async () => { const s = await seedRoom(); const a = await attempt(s); await s.as('customer').mutation(api.runs.cancel, { runId: a.runId }); await complete(s); await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response: { ...response, usage: { ...usage, inputTokens: 999 } }, schemaVersion: 'test', latencyMs: 0 }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'stale', staleGuard: 'G1', usage }); expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0); expect(await s.t.run(ctx => ctx.db.query('rawOutputs').collect())).toHaveLength(0); },
  'CE-123': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'timeout', errorCode: 'watchdog_timeout', response: null }, latencyMs: 0 }); await s.t.mutation(internal.turns.beginAttempt, { turnId: a.turnId, origin: 'auto_retry', actorUserId: null }); await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'timeout', usage, lateUsage: true }); expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0); },
  'CE-127': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.run(ctx => ctx.db.patch(s.roomId, { constraintsVersion: 2 })); expect(await s.t.query(internal.agents.loadTurnContext, { attemptId: a._id })).toBeNull(); await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'stale_context' }, latencyMs: 0 }); expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'superseded' }); expect(await s.t.run(ctx => ctx.db.query('runs').collect())).toHaveLength(2); },
  'INV-70': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.run(ctx => ctx.db.patch(a._id, { status: 'error' })); expect((await s.t.run(ctx => livenessFindings(ctx, s.roomId))).map(f => f.invariant)).toContain('LV-1'); expect(await s.t.mutation(internal.runs.reconcile, { runId: a.runId })).toBe('redispatched'); expect(await s.t.run(ctx => livenessFindings(ctx, s.roomId))).toEqual([]); },
  'INV-71': async () => { const s = await seedRoom(); const a = await attempt(s); const fns = await s.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect()); expect(fns.filter(job=>job.name!=='clock:rollLocalDate')).toHaveLength(2); expect(fns.find(f => f._id === a.watchdogFnId)!.scheduledTime - fns.find(f => f._id === a.actionFnId)!.scheduledTime).toBe(WATCHDOG_FIRST_MS); for (let i = 1; i <= 3; i++) { await s.t.mutation(internal.agents.watchdog, { attemptId: a._id }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ watchdogArmCount: i }); } await s.t.mutation(internal.agents.watchdog, { attemptId: a._id }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'timeout', errorCode: 'watchdog_timeout' }); },
  'CE-125': async () => { const s = await seedRoom(); const a = await complete(s); const before = await s.t.run(ctx => ctx.db.query('attempts').collect()); await s.t.mutation(internal.agents.watchdog, { attemptId: a._id }); expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toEqual(before); },
  'CE-126': async () => { const s = await seedRoom(); await refusal(s); expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(1); expect(await request(s)).toMatchObject({ kind: 'agent_failed', toRole: 'provider' }); },
  'CE-135': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.run(async ctx => { await ctx.db.patch(a._id, { status: 'error' }); await ctx.db.patch(a.runId, { attemptCount: 18 }); }); expect(await s.t.mutation(internal.turns.beginAttempt, { turnId: a.turnId, origin: 'auto_retry', actorUserId: null })).toEqual({ kind: 'limit', cause: 'call_limit' }); const r = await request(s); expect(r).toMatchObject({ kind: 'rounds_exhausted', toRole: 'customer' }); expect(r.options.some(o => o.effect.type === 'retry_turn' || o.effect.type === 'keep_as_is')).toBe(false); },
  'CE-136': async () => { const s = await seedRoom(); const a = await attempt(s); vi.spyOn(console, 'log').mockImplementation(() => {}); await s.t.mutation(internal.ops.setDraining, { draining: true, reason: 'test' }); await complete(s); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'completed' }); const settledState = await seedRoom({ until: 'setup' }); await settledState.t.run(async ctx => { await ctx.db.insert('opsFlags', { key: 'global', draining: true, changedAt: Date.now(), changedBy: null }); await ctx.db.patch(settledState.roomId, { status: 'open' }); }); await expect(settledState.as('customer').mutation(api.runs.start, { roomId: settledState.roomId })).rejects.toThrow(/run.draining/); },
  'CE-137': async () => { vi.stubEnv('AGENT_MODE', 'live'); const s = await seedRoom({ until: 'setup' }); await s.t.run(async ctx => { await ctx.db.insert('spendCounters', { scope: 'global', day: '2026-10-24', reservedMicroUsd: 0, spentMicroUsd: 5_000_000, attempts: 1, unknownCostAttempts: 0 }); await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!)); }); expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(0); expect(await s.t.run(ctx => ctx.db.query('turns').first())).toMatchObject({ waitingReason: 'spend_deferred' }); },
  'INV-34': async () => { const s = await seedRoom(); const a = await refusal(s); await expect(s.t.run(async ctx => { const tx = await openRoomTx(ctx, s.roomId, ['open']); await openHumanRequestTx(tx, a.runId, { kind: 'agent_failed', toRole: 'provider', sourceTurnId: a.turnId }); })).rejects.toThrow(/internal/); const rows = await s.t.run(ctx => ctx.db.query('humanRequests').collect()); expect(rows).toHaveLength(1); expect(rows[0]!.options.some(o => o.effect.type === 'end_run')).toBe(true); },
  'CE-138': async () => { const s = await seedRoom({ capCents: 100000 }); expect(await request(s)).toMatchObject({ status: 'open', kind: 'infeasible' }); expect(await s.t.run(ctx => livenessFindings(ctx, s.roomId))).toEqual([]); },
  'CE-139': async () => { const s = await seedRoom({ capCents: 100000 }); const r = await request(s); vi.setSystemTime(r.expiresAt); expect(await s.t.mutation(internal.humanRequests.expireDue, { requestId: r._id })).toBeNull(); expect(await s.t.mutation(internal.humanRequests.expireDue, { requestId: r._id })).toBeNull(); expect(await s.t.run(ctx => ctx.db.get(r.runId))).toMatchObject({ status: 'ended_no_agreement' }); },
  'CE-140': async () => { const s = await seedRoom(); const a = await refusal(s); const r = await request(s); const retry = r.options.find(o => o.effect.type === 'retry_turn')!; expect(await s.as('provider').mutation(api.humanRequests.answer, { requestId: r._id, optionKey: retry.optionKey })).toMatchObject({ outcome: 'applied' }); expect(await s.as('provider').mutation(api.humanRequests.answer, { requestId: r._id, optionKey: retry.optionKey })).toEqual({ outcome: 'already_answered' }); const turns = await s.t.run(ctx => ctx.db.query('turns').collect()); expect(turns).toHaveLength(2); expect(turns[1]).toMatchObject({ retryOfTurnId: a.turnId }); },
  'INV-76': async () => { const s = await seedRoom(); const a = await refusal(s); const r = await request(s); await s.as('customer').mutation(api.runs.cancel, { runId: a.runId }); expect(await s.t.run(ctx => ctx.db.get(r._id))).toMatchObject({ status: 'superseded', closedReason: 'run_canceled' }); expect(await s.as('customer').mutation(api.runs.cancel, { runId: a.runId })).toEqual({ status: 'unchanged' }); },
  'INV-41': async () => { const s = await seedRoom(); const a = await complete(s, 'O99'); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'invalid_output', errorCode: 'action.option_not_in_snapshot' }); expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0); expect(await s.t.run(ctx => ctx.db.get(a.turnId))).toMatchObject({ waitingReason: 'backoff' }); },
  'CE-077': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'refused', errorCode: 'output.refusal', response: { ...response, rawText: '{half' } }, latencyMs: 0 }); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'refused', usage }); expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0); },
  'CE-079': async () => { const s = await seedRoom(); await complete(s); const turn = await s.t.run(ctx => ctx.db.query('turns').order('desc').first()); expect(turn).toMatchObject({ role: 'customer', candidateSnapshot: [] }); expect(turn!.allowedActions).not.toContain('counter'); },
  'CE-085': async () => { const s = await seedRoom(); const a = await complete(s, 'O1', 'x'.repeat(1500)); expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ rationaleTruncated: true }); expect((await s.t.run(ctx => ctx.db.get(a.turnId)))!.result!.rationale).toHaveLength(1200); expect(JSON.stringify(await s.t.run(ctx => ctx.db.query('events').collect()), (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('x'.repeat(100)); },
  'INV-36': async () => { const s = await settled(); const p = (await s.t.run(ctx => ctx.db.query('proposals').first()))!; expect(p.terms.deliveryDate).toBe('2026-10-27'); vi.setSystemTime(Date.now() + 86400000); expect((await s.t.run(ctx => ctx.db.get(p._id)))!.terms).toEqual(p.terms); },
  'CE-007': async () => { const s = await seedRoom(); await refusal(s); const r = await request(s); const before = await s.t.run(ctx => ctx.db.query('events').collect()); await expect(s.as('customer').mutation(api.humanRequests.answer, { requestId: r._id, optionKey: 'A' })).rejects.toThrow(/auth.role_forbidden/); expect(await s.t.run(ctx => ctx.db.query('events').collect())).toHaveLength(before.length); },
  'CE-009': async () => { const s = await seedRoom(); await refusal(s); const provider = await s.as('finance').query(api.rooms.view, { roomId: s.roomId }); expect(JSON.stringify(provider)).not.toMatch(/PRIVATE|errorCode|usage|rawOutput/); },
  'INV-66': async () => { const s = await seedRoom(); const a = await attempt(s); const context = await s.t.query(internal.agents.loadTurnContext, { attemptId: a._id }); const text = JSON.stringify(context); expect(text).not.toContain('PRIVATE-CUSTOMER'); expect(text).not.toContain('PRIVATE-FINANCE'); expect(text).toContain('PRIVATE-PROVIDER'); expect(text).not.toMatch(/capCents|headroomCents/); },
  'CE-033': async () => { const s = await seedRoom(); await refusal(s); const view = await s.as('customer').query(api.rooms.view, { roomId: s.roomId }); expect(view!.run!.attemptStatus).toBeNull(); expect(view!.run!.waiting).toBeNull(); expect(JSON.stringify(view)).not.toContain('output.refusal'); },
  'INV-64': async () => { const s = await seedRoom(); const a = await refusal(s); await s.t.run(async ctx => { const r = await ctx.db.query('humanRequests').first(); await ctx.db.patch(r!._id, { toRole: 'finance' }); }); const view = await s.as('provider').query(api.rooms.view, { roomId: s.roomId }); expect(view!.openRequest).toEqual({ mine: false, kind: 'run_waiting' }); expect(view!.run!.activeRole).toBeNull(); expect(JSON.stringify(view)).not.toMatch(/agent_failed|toRole|failureKind|PRIVATE_RAW/); expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'needs_input' }); },
  'CE-160': async () => { const s = await settled(); await expectNoFailedScheduled(s.t); const jobs = await s.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect()); expect(jobs.filter(j => j.name === 'agents:runAttempt')).toHaveLength(3); },
  'CE-161': async () => { const s = await seedRoom(); const a = await attempt(s); await s.t.run(ctx => ctx.db.patch(a._id, { status: 'error' })); expect(await s.t.mutation(internal.runs.reconcile, { runId: a.runId })).toBe('redispatched'); expect(await s.t.run(ctx => livenessFindings(ctx, s.roomId))).toEqual([]); },
};
// Different rows use the same assertions only when they describe the same invariant.
bodies['INV-72'] = bodies['CE-135']!;
bodies['INV-65'] = bodies['CE-139']!;



export function runtimeCase(id: string) { return async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev');
  try { if (!bodies[id]) throw new Error(`Missing runtime case ${id}`); await bodies[id]!(); }
  finally { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); }
}; }
bodies['CE-007'] = async () => {
  const s = await seedRoom({ capCents: 100000 }); const r = await request(s);
  expect(r).toMatchObject({ kind: 'infeasible', toRole: 'finance' });
  expect(r.options.some(o => o.effect.type === 'raise_cap')).toBe(true);
  expect(JSON.stringify(r.options)).not.toContain('requiredItemKeys');
};
bodies['CE-085'] = async () => {
  const s = await seedRoom(); const a = await attempt(s);
  const context = await s.t.query(internal.agents.loadTurnContext, { attemptId: a._id });
  expect(context).not.toBeNull(); expect(JSON.parse(JSON.stringify(context))).toEqual(context);
  expect(JSON.stringify(context)).not.toMatch(/\$defs|safeParse|jsonSchema/);
};
bodies['CE-087'] = async () => {
  const s = await seedRoom({ until: 'setup' });
  await s.t.run(async ctx => {
    const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'customer')).first())!;
    await ctx.db.patch(b._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['audit'], deadline: '2026-11-24' } });
    await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!));
  });
  expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(0);
  expect(await request(s)).toMatchObject({ kind: 'infeasible' });
};
bodies['CE-092'] = async () => {
  const s = await seedRoom();
  await s.t.run(async ctx => { const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'customer')).first())!;
    await ctx.db.patch(b._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['audit'], deadline: '2026-11-24' } });
  });
  const a = await complete(s);
  expect(await s.t.run(ctx => ctx.db.get(a.turnId))).toMatchObject({ outcome: { blockedCandidateKey: 'sso_login' } });
  expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0);
  expect((await s.t.run(ctx => ctx.db.query('turns').collect())).some(t => t.kind === 'evaluate')).toBe(false);
};
bodies['INV-64'] = async () => { const s = await seedRoom({ capCents: 100000 }); expect(await request(s)).toMatchObject({ kind: 'infeasible', status: 'open' }); expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toEqual([]); expect(await s.t.run(ctx => ctx.db.query('executions').collect())).toEqual([]); };
bodies['INV-66'] = async () => { const s = await seedRoom(); vi.stubEnv('AGENTS_ENABLED', 'false'); vi.stubEnv('AGENT_MODE', 'live'); vi.spyOn(console, 'log').mockImplementation(() => {}); await s.t.mutation(internal.ops.setDraining, { draining: true, reason: 'test' }); await drainDue(s.t); expect(await s.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ agentMode: 'stub', status: 'pending_approval' }); expect((await s.t.run(ctx => ctx.db.query('proposals').first()))!.provenance).toBe('stub'); };
bodies['CE-157'] = bodies['INV-66']!;
bodies['CE-033'] = async () => { const s = await seedRoom({ capCents: 100000 }); const r = await request(s); expect(r.toRole).toBe('finance'); const view = await s.as('provider').query(api.rooms.view, { roomId: s.roomId }); expect(view!.openRequest).toEqual({ mine: false, kind: 'run_waiting' }); expect(JSON.stringify({run:view!.run,openRequest:view!.openRequest})).not.toMatch(/finance|infeasible|raise_cap|amountCents/); };
bodies['CE-009'] = async () => {
  const s = await seedRoom(); const a = await attempt(s);
  await s.t.run(async ctx => {
    const turn = (await ctx.db.get(a.turnId))!; await ctx.db.patch(a._id, { status: 'completed' });
    await ctx.db.patch(turn._id, { status: 'completed', result: { action: 'propose', optionKey: 'O1', rationale: '' } });
    const { _id, _creationTime, ...record } = turn; void _id; void _creationTime;
    for (let i = 2; i <= 4; i++) await ctx.db.insert('turns', { ...record, turnSeq: i, status: 'completed', currentAttemptNo: 0, result: { action: 'propose', optionKey: `O${i}`, rationale: '' } });
    await ctx.db.patch(a.runId, { nextTurnSeq: 5, activeTurnSeq: null });
    expect(await createTurnTx(await openRoomTx(ctx, s.roomId, ['open']), a.runId, { role: 'provider', kind: 'propose' })).toBeNull();
  });
  expect((await request(s)).questionKey).toContain('no_candidates');
  expect(await s.t.run(ctx => ctx.db.query('attempts').collect())).toHaveLength(1);
};
bodies['CE-160'] = async () => {
  script.enqueue(new Error('unused scripted response'));
  const stub = await settled();
  expect(await stub.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ status: 'pending_approval' });
  expect(script.recorded).toHaveLength(0);
  expect(() => script.assertEmpty()).toThrow(/Unconsumed/);
  script.reset();
  vi.stubEnv('AGENT_MODE', 'live'); vi.stubEnv('ANTHROPIC_API_KEY', 'scripted-key');
  script.enqueue(scriptedSuccess({ action: 'propose', optionKey: 'O1', rationale: '' }), scriptedSuccess({ action: 'recommend_accept', proposalVersion: 1, rationale: '' }), scriptedSuccess({ action: 'recommend_accept', proposalVersion: 1, rationale: '' }));
  const s = await seedRoom(); await drainDue(s.t);
  script.assertEmpty(); expect(script.recorded).toHaveLength(3);
  expect(await s.t.run(ctx => ctx.db.query('runs').first())).toMatchObject({ status: 'pending_approval' });
};
bodies['CE-161'] = async () => {
  const s = await seedRoom(); await drainDue(s.t);
  const attempts = await s.t.run(ctx => ctx.db.query('attempts').collect());
  expect(attempts).toHaveLength(3); expect(attempts.every(a => a.status === 'completed' && a.watchdogArmCount === 0)).toBe(true);
  const jobs = await s.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
  expect(jobs.filter(j => j.name === 'agents:watchdog').every(j => j.state.kind === 'pending')).toBe(true);
};
bodies['CE-061'] = async () => {
  const s = await customRequest({ type: 'disclose', field: 'requiredItemKeys', toRoles: ['provider'] }, 'customer', 'clarify');
  await s.answer(); expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ constraintsVersion: 1 });
  expect(await s.t.run(ctx => ctx.db.query('sharedFacts').first())).toMatchObject({ audience: ['provider'], value: { kind: 'itemKeys', itemKeys: ['sso_login'] } });
};
bodies['CE-142'] = async () => {
  const s = await customRequest({ type: 'keep_as_is' }, 'customer', 'rounds_exhausted');
  await s.t.run(async ctx => { const r = (await ctx.db.get(s.requestId))!; await ctx.db.patch(r.runId, { roundsExtended: true, maxRounds: 4, roundNo: 4 }); await ctx.db.patch(r._id, { questionKey: 'request.rounds_exhausted.rounds' }); });
  await s.answer(); const r = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  expect(await s.t.run(ctx => ctx.db.get(r.runId))).toMatchObject({ status: 'ended_no_agreement', maxRounds: 4 });
};
bodies['CE-144'] = async () => {
  const s = await customRequest({ type: 'choose_candidate', candidateKey: 'sso_login' }, 'customer', 'rounds_exhausted');
  await s.t.run(async ctx => { const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'finance')).first())!; await ctx.db.patch(b._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 100000 } }); });
  expect(await s.answer()).toMatchObject({ outcome: 'regenerated' });
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'superseded', answerOptionKey: 'A', closedReason: 'regenerated' });
  expect((await s.t.run(ctx => ctx.db.query('humanRequests').collect())).filter(r => r.status === 'open')).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0);
};
bodies['CE-134'] = async () => {
  const s = await seedRoom({ until: 'setup' }); await s.t.run(ctx => ctx.db.patch(s.roomId, { status: 'open' }));
  for (let i = 0; i < 6; i++) { const r = await s.as('customer').mutation(api.runs.start, { roomId: s.roomId }); await s.as('customer').mutation(api.runs.cancel, { runId: r.runId }); }
  const before = await s.t.run(ctx => ctx.db.query('events').collect());
  await expect(s.as('customer').mutation(api.runs.start, { roomId: s.roomId })).rejects.toThrow(/run.rate_limited/);
  expect(await s.t.run(ctx => ctx.db.query('events').collect())).toEqual(before);
};
bodies['CE-080'] = async () => {
  const s = await seedRoom(); const a = await attempt(s);
  await s.t.run(async ctx => { await ctx.db.patch(a.runId, { roundNo: 3 }); await ctx.db.patch(a.turnId, { roundNo: 3 }); });
  await complete(s);
  let next = await attempt(s);
  await s.t.mutation(internal.turns.complete, { attemptId: next._id, actorUserId: null, move: { action: 'reject', proposalVersion: 1, reasonKey: 'preference_not_met', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  next = await attempt(s);
  await s.t.mutation(internal.turns.complete, { attemptId: next._id, actorUserId: null, move: { action: 'recommend_accept', proposalVersion: 1, rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  expect(await request(s)).toMatchObject({ kind: 'rounds_exhausted' });
  expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'needs_input' });
};
// W2-4: remaining disclosure rows exercise role-scoped planning with peer hooks.
bodies['INV-12'] = async () => {
  const s = await seedRoom({ capCents: 100000 });
  const view = await s.as('provider').query(api.rooms.view, { roomId: s.roomId });
  expect(view!.openRequest).toEqual({ mine: false, kind: 'run_waiting' });
  for (const event of await s.t.run(ctx => ctx.db.query('events').collect())) {
    expect(event).not.toHaveProperty('visibility');
    expect(JSON.stringify(event.payload)).not.toMatch(/PRIVATE|capCents|headroomCents|infeasible|toRole/);
  }
};
bodies['CE-008'] = async () => {
  const options: unknown[] = [];
  for (const capCents of [100000, 110000]) {
    const s = await seedRoom({ until: 'setup', capCents });
    await s.t.run(async ctx => {
      const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'customer')).first())!;
      await ctx.db.patch(b._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['audit', 'sso_login'], deadline: '2026-11-24' } });
      await ctx.db.insert('catalogItems', { roomId: s.roomId, itemKey: 'audit', revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: 'Audit', priceCents: 30000, leadDays: 40, taskTemplates: [], confirmedBy: s.users[1]!, confirmedAt: Date.now(), createdBy: s.users[1]!, provenance: 'stub', createdAt: Date.now() });
      await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!));
    });
    const r = await request(s); expect(r.toRole).toBe('customer');
    expect(r.options.some(o => o.effect.type === 'drop_items')).toBe(true);
    options.push(r.options);
  }
  expect(options[0]).toEqual(options[1]);
};
bodies['CE-171'] = async () => {
  const s = await seedRoom({ until: 'setup' });
  await s.t.run(async ctx => {
    const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', s.roomId).eq('role', 'customer')).first())!;
    await ctx.db.patch(b._id, { softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: ['audit'], notes: '' } });
    await ctx.db.insert('catalogItems', { roomId: s.roomId, itemKey: 'audit', revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: 'Audit', priceCents: 10000, leadDays: 2, taskTemplates: [], confirmedBy: s.users[1]!, confirmedAt: Date.now(), createdBy: s.users[1]!, provenance: 'stub', createdAt: Date.now() });
    await ctx.db.insert('sharedFacts', { roomId: s.roomId, fromRole: 'customer', field: 'requiredItemKeys', seq: 1, value: { kind: 'itemKeys', itemKeys: ['sso_login'] }, audience: ['provider'], briefVersion: 1, source: 'manual', createdBy: s.users[0]!, provenance: 'stub', createdAt: Date.now() });
    await ctx.db.insert('sharedFacts', { roomId: s.roomId, fromRole: 'finance', field: 'headroomCents', seq: 1, value: { kind: 'cents', cents: 100000 }, audience: ['customer'], briefVersion: 1, source: 'ledger', createdBy: s.users[2]!, provenance: 'stub', createdAt: Date.now() });
    await openIfReady(await openRoomTx(ctx, s.roomId, ['setup'], s.users[0]!));
  });
  await complete(s);
  const a = await attempt(s); const turn = (await s.t.run(ctx => ctx.db.get(a.turnId)))!;
  expect(turn.role).toBe('customer'); expect(turn.candidateSnapshot.length).toBeGreaterThan(0);
  expect(turn.candidateSnapshot.every(c => c.amountCents <= 100000)).toBe(true);
  const counter = turn.candidateSnapshot.find(c => c.itemKeys.includes('audit'))!;
  await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'counter', optionKey: counter.optionKey, baseProposalVersion: 1, rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  expect(await s.t.run(ctx => ctx.db.get(turn._id))).toMatchObject({ outcome: { candidateKey: counter.candidateKey } });
  for (let i = 0; i < 10; i++) {
    const jobs = await s.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    const pending = jobs.filter(j => j.name === 'agents:runAttempt' && j.state.kind === 'pending');
    if (!pending.length) break;
    await advanceScheduledTo(s.t, Math.max(Date.now(), Math.min(...pending.map(j => j.scheduledTime))));
    await drainDue(s.t);
  }
  const publicHistory = await s.as('provider').query(api.rooms.view, { roomId: s.roomId });
  expect(publicHistory!.proposalHistory![0]!.amountCents).toBe(90000);
};

export const runtimeCaseIds = Object.keys(bodies);
