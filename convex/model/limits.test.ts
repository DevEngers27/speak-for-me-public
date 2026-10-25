import { openRoomTx } from './runtimeTx';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { bump } from './runs';

import { drainDue } from '../../tests/convex-helpers/scheduler';
import { canonicalJson } from '@core/engine';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('TC-RUN-26 system run cap stores a wakeup and reconcile cannot bypass it', async () => {
  const s = await seedRoom();
  for (let i = 0; i < 6; i++) await s.t.run(async ctx => bump(await openRoomTx(ctx, s.roomId, ['open']), { cause: 'catalog_changed', sourceRefs: [] }));
  const room = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
  const run = (await s.t.run(ctx => ctx.db.get(room.currentRunId!)))!;
  const turn = (await s.t.run(ctx => ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).first()))!;
  expect(run).toMatchObject({ attemptCount: 0, status: 'negotiating', runNo: 7 });
  expect(turn.waitingReason).toBe('run_cap'); expect(turn.beginFnId).toBeTruthy();
  expect(await s.t.mutation(internal.runs.reconcile, { runId: run._id })).toBe('noop');
  expect(await s.t.run(ctx => ctx.db.get(run._id))).toMatchObject({ attemptCount: 0 });
});
it('RT-11 D06 keeps the same pending proposal and later renegotiation allocates v2', async () => {
  const s = await seedRoom(); await drainDue(s.t);
  const before = (await s.t.run(ctx => ctx.db.query('proposals').first()))!;
  await s.t.run(async ctx => bump(await openRoomTx(ctx, s.roomId, ['open']), { cause: 'catalog_changed', sourceRefs: [] }));
  const room = (await s.t.run(ctx => ctx.db.get(s.roomId)))!;
  const kept = (await s.t.run(ctx => ctx.db.get(room.currentRunId!)))!;
  expect(kept).toMatchObject({ status: 'pending_approval', currentProposalId: before._id });
  expect(room.nextProposalVersion).toBe(2);
  await s.as('customer').mutation(api.runs.requestRenegotiation, { roomId: s.roomId, expectedRunId: kept._id });
  await drainDue(s.t);
  const proposals = await s.t.run(ctx => ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', s.roomId)).collect());
  expect(proposals.map(p => p.version)).toEqual([1, 2]);
  expect(proposals[0]!.status).toBe('superseded');
  expect(proposals[1]!.termsKey).toBe(canonicalJson(proposals[1]!.terms));
  expect(await s.t.run(ctx => ctx.db.get(proposals[1]!.runId))).toMatchObject({ status: 'pending_approval' });
});
it('RT-08 live reservation is released once and late usage settles the reserved UTC day', async () => {
  vi.stubEnv('AGENT_MODE', 'live');
  const s = await seedRoom();
  const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  expect(a.reservedMicroUsd).toBeGreaterThan(0);
  await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'error', errorCode: 'transport', response: null }, latencyMs: 0 });
  const counter = (await s.t.run(ctx => ctx.db.query('spendCounters').first()))!;
  expect(counter).toMatchObject({ reservedMicroUsd: 0, spentMicroUsd: 0, unknownCostAttempts: 1 });
  vi.setSystemTime(Date.now() + 86400000);
  const response = { usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, thinkingTokens: 0 }, stopReason: 'end_turn', stopCategory: null, requestId: null, messageId: null, responseModel: 'claude-opus-5-5', rawText: 'late' };
  for (let i = 0; i < 2; i++) await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'propose', optionKey: 'O1', rationale: '' }, response, schemaVersion: 'test', latencyMs: 0 });
  const settled = (await s.t.run(ctx => ctx.db.get(counter._id)))!;
  expect(settled).toMatchObject({ day: '2026-10-24', reservedMicroUsd: 0, spentMicroUsd: 800, unknownCostAttempts: 0 });
  expect(await s.t.run(ctx => ctx.db.query('spendCounters').collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query('rawOutputs').collect())).toHaveLength(0);
});
it('RT-15 live run dollar limit becomes rounds_exhausted without another attempt', async () => {
  vi.stubEnv('AGENT_MODE', 'live');
  const s = await seedRoom(); const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.run(async ctx => { await ctx.db.patch(a._id, { status: 'error' }); await ctx.db.patch(a.runId, { spendCapMicroUsd: 0, reservedMicroUsd: 0 }); });
  expect(await s.t.mutation(internal.turns.beginAttempt, { turnId: a.turnId, origin: 'auto_retry', actorUserId: null })).toEqual({ kind: 'limit', cause: 'spend_limit' });
  const r = (await s.t.run(ctx => ctx.db.query('humanRequests').first()))!;
  expect(r.questionKey).toContain('spend_limit'); expect(r.options.map(o => o.effect.type)).not.toContain('retry_turn');
});
it('TC-INJ-03 raw outputs are UTF-8 bounded and never exposed in views', async () => {
  const s = await seedRoom(); const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  const response = { usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, stopReason: 'refusal', stopCategory: 'safety', requestId: null, messageId: null, responseModel: null, rawText: '🧪'.repeat(20000) };
  await s.t.mutation(internal.turns.fail, { attemptId: a._id, actorUserId: null, outcome: { kind: 'refused', errorCode: 'output.refusal', response }, latencyMs: 0 });
  const raw = (await s.t.run(ctx => ctx.db.query('rawOutputs').first()))!;
  expect(new TextEncoder().encode(raw.text).length).toBeLessThanOrEqual(65536); expect(raw.truncated).toBe(true);
  for (const role of ['customer', 'provider', 'finance'] as const) expect(JSON.stringify(await s.as(role).query(api.rooms.view, { roomId: s.roomId }))).not.toContain('🧪');
});
