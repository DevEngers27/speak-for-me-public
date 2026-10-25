import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { customRequest } from '../../tests/convex-helpers/request.fixture';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('12.14 raise_cap answers first then bumps once with request and brief source refs', async () => {
  const s = await seedRoom({ capCents: 100000 });
  const r = (await s.t.run(ctx => ctx.db.query('humanRequests').first()))!;
  const option = r.options.find(o => o.effect.type === 'raise_cap')!;
  const result = await s.as('finance').mutation(api.humanRequests.answer, { requestId: r._id, optionKey: option.optionKey });
  expect(result).toMatchObject({ outcome: 'applied', constraintsVersion: 2 });
  expect(await s.t.run(ctx => ctx.db.get(r._id))).toMatchObject({ status: 'answered' });
  expect((await s.t.run(ctx => ctx.db.query('constraintRevisions').order('desc').first()))!.sourceRefs.map(r => r.kind)).toEqual(['humanRequest', 'brief']);
});
it('12.14 drop_items cannot remove all required items and rolls back the answer', async () => {
  const s = await customRequest({ type: 'drop_items', itemKeys: ['sso_login'] }, 'customer', 'infeasible');
  await expect(s.answer()).rejects.toThrow(/item.required_missing/);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'open' });
});
it('12.14 extend_deadline validates the date window before committing', async () => {
  const s = await customRequest({ type: 'extend_deadline', date: '2026-10-23' }, 'customer', 'infeasible');
  await expect(s.answer()).rejects.toThrow(/date.out_of_range/);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'open' });
});
it('12.14 choose_candidate materializes a human proposal and is idempotent', async () => {
  const s = await customRequest({ type: 'choose_candidate', candidateKey: 'sso_login' }, 'customer', 'rounds_exhausted');
  expect(await s.answer()).toMatchObject({ outcome: 'applied', effect: 'choose_candidate' });
  expect(await s.answer()).toEqual({ outcome: 'already_answered' });
  const p = (await s.t.run(ctx => ctx.db.query('proposals').first()))!;
  expect(p).toMatchObject({ origin: 'human_choice', sourceRequestId: s.requestId, authorRole: 'customer', version: 1, terms: { amountCents: 80000 } });
});
it('CE-144 choose_candidate failed full recheck regenerates one request', async () => {
  const s = await customRequest({ type: 'choose_candidate', candidateKey: 'not_available' }, 'customer', 'rounds_exhausted');
  expect(await s.answer()).toMatchObject({ outcome: 'regenerated' });
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'superseded', closedReason: 'regenerated', answerOptionKey: 'A' });
  expect((await s.t.run(ctx => ctx.db.query('humanRequests').collect())).filter(r => r.status === 'open')).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toHaveLength(0);
});
it('CE-061 disclose resumes without bump and records only owner current brief values', async () => {
  const s = await customRequest({ type: 'disclose', field: 'requiredItemKeys', toRoles: ['provider'] }, 'customer', 'clarify');
  await s.answer();
  expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ constraintsVersion: 1 });
  expect(await s.t.run(ctx => ctx.db.query('sharedFacts').first())).toMatchObject({ value: { kind: 'itemKeys', itemKeys: ['sso_login'] }, audience: ['provider'], briefVersion: 1 });
});
it('12.14 disclose rejects budget disclosure to provider', async () => {
  const s = await customRequest({ type: 'disclose', field: 'capCents', toRoles: ['provider'] }, 'finance', 'clarify');
  await expect(s.answer()).rejects.toThrow(/disclosure.blocked/);
  expect(await s.t.run(ctx => ctx.db.query('sharedFacts').collect())).toEqual([]);
});
it('12.14 pass_to_next opens a recipient-scoped request without bump', async () => {
  const s = await customRequest({ type: 'pass_to_next', toRole: 'finance' }, 'customer', 'infeasible');
  expect(await s.answer()).toMatchObject({ outcome: 'applied', effect: 'pass_to_next', constraintsVersion: 1 });
  const open = (await s.t.run(ctx => ctx.db.query('humanRequests').collect())).filter(r => r.status === 'open');
  expect(open).toHaveLength(1); expect(open[0]!.toRole).toBe('finance');
});
it('12.14 end_run is available while draining and keeps room open', async () => {
  const s = await customRequest({ type: 'end_run' }, 'provider');
  await s.t.run(ctx => ctx.db.insert('opsFlags', { key: 'global', draining: true, changedAt: Date.now(), changedBy: null }));
  expect(await s.answer()).toMatchObject({ outcome: 'applied', effect: 'end_run' });
  expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ status: 'open' });
});
it('12.14 keep_as_is extends exhausted rounds only once', async () => {
  const s = await customRequest({ type: 'keep_as_is' }, 'customer', 'rounds_exhausted');
  await s.t.run(async ctx => { const r = (await ctx.db.get(s.requestId))!; await ctx.db.patch(r.runId, { roundNo: 3 }); await ctx.db.patch(r._id, { questionKey: 'request.rounds_exhausted.rounds' }); });
  await s.answer();
  const r = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  expect(await s.t.run(ctx => ctx.db.get(r.runId))).toMatchObject({ roundsExtended: true, maxRounds: 4, roundNo: 4 });
});
it('12.14 retry_turn creates a new sequence through both public aliases', async () => {
  const s = await customRequest({ type: 'retry_turn' }, 'provider');
  const r = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  expect(await s.as('provider').mutation(api.runs.retryTurn, { runId: r.runId })).toHaveProperty('attemptId');
  const turns = await s.t.run(ctx => ctx.db.query('turns').collect());
  expect(turns).toHaveLength(2); expect(turns[1]!.retryOfTurnId).toBe(turns[0]!._id);
});
it('12.14 raise_cap below committed → budget.below_committed rolls back rows and events', async () => {
  const s = await customRequest({ type: 'raise_cap', amountCents: 99999 }, 'finance', 'infeasible');
  const before = await s.t.run(ctx => ctx.db.query('events').collect());
  await expect(s.answer()).rejects.toThrow(/budget.below_committed/);
  expect(await s.t.run(ctx => ctx.db.query('events').collect())).toEqual(before);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'open' });
});
it('12.14 expired and superseded requests → request.not_open without writes', async () => {
  const s = await customRequest({ type: 'retry_turn' }, 'provider');
  const r = (await s.t.run(ctx => ctx.db.get(s.requestId)))!;
  vi.setSystemTime(r.expiresAt);
  await expect(s.answer()).rejects.toThrow(/request.not_open/);
  expect(await s.t.run(ctx => ctx.db.get(r._id))).toMatchObject({ status: 'open' });
  await s.t.run(ctx => ctx.db.patch(r._id, { status: 'superseded' }));
  await expect(s.answer()).rejects.toThrow(/request.not_open/);
  await s.as('customer').mutation(api.runs.cancel, { runId: r.runId });
});
it('12.14 retry effect while draining → run.draining leaves request open', async () => {
  const s = await customRequest({ type: 'retry_turn' }, 'provider');
  await s.t.run(ctx => ctx.db.insert('opsFlags', { key: 'global', draining: true, changedAt: Date.now(), changedBy: null }));
  await expect(s.answer()).rejects.toThrow(/run.draining/);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'open' });
});
it('12.14 unchanged constraint effect resumes via precheck without bump', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const s = await customRequest({ type: 'raise_cap', amountCents: 200000 }, 'finance', 'infeasible');
  expect(await s.answer()).toMatchObject({ outcome: 'applied', constraintsVersion: 1 });
  expect(await s.t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.get(s.requestId))).toMatchObject({ status: 'answered' });
  vi.restoreAllMocks();
});
it('05-S1 provider cannot_deliver opens a provider request instead of spending another round', async () => {
  const { internal } = await import('../_generated/api');
  const s = await seedRoom(); const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'reject', proposalVersion: null, reasonKey: 'cannot_deliver', rationale: '' }, response: { usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawText: '', stopReason: 'end_turn', stopCategory: null, requestId: null, messageId: null, responseModel: null }, schemaVersion: 'test', latencyMs: 0 });
  const r = (await s.t.run(ctx => ctx.db.query('humanRequests').first()))!;
  expect(r).toMatchObject({ kind: 'agent_escalated', toRole: 'provider' });
  expect(r.options.map(o => o.effect.type)).toEqual(['keep_as_is', 'end_run']);
});
it('12.14 budget_room discloses derived headroom without disclosing cap', async () => {
  const s = await customRequest({ type: 'disclose', field: 'headroomCents', toRoles: ['customer'] }, 'finance', 'clarify');
  await s.answer();
  expect(await s.t.run(ctx => ctx.db.query('sharedFacts').first())).toMatchObject({ field: 'headroomCents', value: { kind: 'cents', cents: 100000 }, audience: ['customer'] });
  expect(await s.t.run(ctx => ctx.db.get(s.roomId))).toMatchObject({ constraintsVersion: 1 });
});
it('05-5.10 provider first-turn escalation cannot delegate a feasible room to a human', async () => {
  const { internal } = await import('../_generated/api');
  const s = await seedRoom(); const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.mutation(internal.turns.complete, { attemptId: a._id, actorUserId: null, move: { action: 'escalate', kind: 'needs_tradeoff', toRole: 'customer', rationale: '' }, response: { usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawText: '', stopReason: 'end_turn', stopCategory: null, requestId: null, messageId: null, responseModel: null }, schemaVersion: 'test', latencyMs: 0 });
  expect(await s.t.run(ctx => ctx.db.query('humanRequests').collect())).toHaveLength(0);
  expect(await s.t.run(ctx => ctx.db.get(a.runId))).toMatchObject({ status: 'negotiating', roundNo: 2 });
});
