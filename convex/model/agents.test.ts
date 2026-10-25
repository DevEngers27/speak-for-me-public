import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { internal, api } from '../_generated/api';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { drainDue } from '../../tests/convex-helpers/scheduler';
import { script, scriptedSuccess } from '../../tests/convex-helpers/scriptedModel';
import * as runtime from './runs';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); vi.stubEnv('AGENT_MODE', 'live'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('ANTHROPIC_API_KEY', 'scripted'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('RT-09 commit throw calls fail once and never calls the model again', async () => {
  const original = runtime.commitAttempt;
  let failed = false;
  vi.spyOn(runtime, 'commitAttempt').mockImplementation(async (ctx, args) => {
    if (args.move && !failed) { failed = true; throw new Error('commit defect'); }
    return original(ctx, args);
  });
  script.enqueue(scriptedSuccess({ action: 'propose', optionKey: 'O1', rationale: 'private' }));
  const s = await seedRoom(); await drainDue(s.t);
  expect(failed).toBe(true); expect(script.recorded).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query('attempts').first())).toMatchObject({ status: 'error', errorCode: 'internal' });
  expect(await s.t.run(ctx => ctx.db.query('proposals').collect())).toEqual([]);
  expect(await s.t.run(ctx => ctx.db.query('humanRequests').first())).toMatchObject({ kind: 'agent_failed' });
});
it('RT-10 stale_context action commits fail without calling the model', async () => {
  const s = await seedRoom();
  const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.as('customer').mutation(api.runs.cancel, { runId: a.runId });
  await s.t.action(internal.agents.runAttempt, { attemptId: a._id, actorUserId: null });
  expect(script.recorded).toHaveLength(0);
  expect(await s.t.run(ctx => ctx.db.get(a._id))).toMatchObject({ status: 'stale' });
});
it('RT-14 AGENTS_ENABLED false fails live attempts without consuming a model response', async () => {
  vi.stubEnv('AGENTS_ENABLED', 'false');
  const s = await seedRoom(); await drainDue(s.t);
  expect(script.recorded).toHaveLength(0);
  expect(await s.t.run(ctx => ctx.db.query('attempts').first())).toMatchObject({ status: 'error', errorCode: 'agents_disabled' });
});
it('15.3 live config invalid writes config_invalid before any model call', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  const s = await seedRoom(); await drainDue(s.t);
  expect(script.recorded).toHaveLength(0);
  expect(await s.t.run(ctx => ctx.db.query('attempts').first())).toMatchObject({ status: 'error', errorCode: 'config_invalid' });
});
it('16.4.5 queue exhaustion fails the test even when application code catches the model exception', async () => {
  const { callModel } = await import('./agents/modelGateway');
  await expect(callModel({ messages: [{ role: 'user', content: 'test' }], validate: (data: unknown) => ({ ok: true, data }) })).rejects.toThrow(/queue exhausted/);
  expect(() => script.assertEmpty()).toThrow(/queue exhausted/);
  script.reset();
});
it('Claude i04 F7 both commits may fail without another model call; watchdog records internal', async () => {
  const commits = vi.spyOn(runtime, 'commitAttempt').mockRejectedValue(new Error('both commits fail'));
  script.enqueue(scriptedSuccess({ action: 'propose', optionKey: 'O1', rationale: '' }));
  const s = await seedRoom();
  await drainDue(s.t);
  expect(commits).toHaveBeenCalledTimes(2);
  expect(script.recorded).toHaveLength(1);
  const attempt = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  expect(attempt.status).toBe('running');
  const action = await s.t.run(ctx => ctx.db.system.get(ctx.db.system.normalizeId('_scheduled_functions', attempt.actionFnId!)!));
  expect(action!.state.kind).toBe('success');
  commits.mockRestore();
  await s.t.mutation(internal.agents.watchdog, { attemptId: attempt._id });
  expect(await s.t.run(ctx => ctx.db.get(attempt._id))).toMatchObject({ status: 'error', errorCode: 'internal' });
  expect(await s.t.run(ctx => ctx.db.query('humanRequests').first())).toMatchObject({ kind: 'agent_failed' });
  expect(script.recorded).toHaveLength(1);
});

it('W2-4 merge uses the gateway user/system channel and verbatim retry instruction', async () => {
  const { buildRequest } = await import('./agents/modelGateway');
  const { turnInstruction } = await import('@core/engine');
  const first = scriptedSuccess({ action: 'propose', optionKey: 'O1', rationale: '' });
  script.enqueue(first);
  const s = await seedRoom();
  const attempt = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.run(ctx => ctx.db.patch(attempt._id, { retryNote: 'output.not_json' }));
  await s.t.action(internal.agents.runAttempt, { attemptId: attempt._id, actorUserId: null });
  expect(script.recorded).toHaveLength(1);
  const request = script.recorded[0]!;
  expect(request.messages.map(m => m.role)).toEqual(['user', 'system']);
  const turn = (await s.t.run(ctx => ctx.db.get(attempt.turnId)))!;
  expect(request.messages[1]?.content).toBe(turnInstruction({ turnKind: turn.kind, allowedActions: turn.allowedActions, extra: { retryCode: 'output.not_json' } }));
  expect(() => buildRequest({ ...request, schema: request.schema! })).not.toThrow();
});

it('W2-5 integration persists classifier truncation metadata and the original raw output',async()=>{
  const rationale='x'.repeat(1500);
  script.enqueue(scriptedSuccess({action:'propose',optionKey:'O1',rationale}));
  const s=await seedRoom();
  const attempt=(await s.t.run(ctx=>ctx.db.query('attempts').first()))!;
  await s.t.action(internal.agents.runAttempt,{attemptId:attempt._id,actorUserId:null});
  const stored=(await s.t.run(ctx=>ctx.db.get(attempt._id)))!;
  expect(stored).toMatchObject({status:'completed',rationaleTruncated:true,promptVersion:'v2',protocolVersion:'1'});
  expect(stored.move!.rationale).toHaveLength(1200);
  expect(stored.schemaVersion).toMatch(/^p1:scope_change@1:provider:propose:n1:/);
  expect((await s.t.run(ctx=>ctx.db.get(stored.rawOutputRef!)))!.text).toContain(rationale);
  expect(script.recorded).toHaveLength(1);
});
it('W2-5 integration classifies semantic references and renders the canonical retry instruction',async()=>{
  script.enqueue(scriptedSuccess({action:'propose',optionKey:'O2',rationale:'Choose this option.'}),scriptedSuccess({action:'propose',optionKey:'O2',rationale:'Choose this option.'}));
  const s=await seedRoom();await drainDue(s.t);
  const attempts=await s.t.run(ctx=>ctx.db.query('attempts').collect());
  expect(attempts).toHaveLength(2);
  expect(attempts.every(a=>a.status==='invalid_output'&&a.errorCode==='action.option_not_in_snapshot')).toBe(true);
  expect(script.recorded).toHaveLength(2);
  expect(script.recorded[1]!.messages[1]!.content).toContain('Choose an optionKey that is listed in <candidates>.');
  expect((await s.t.run(ctx=>ctx.db.query('humanRequests').first()))!.kind).toBe('agent_failed');
});
it('W2-5 integration stores sanitized schema issue paths',async()=>{
  const valid=scriptedSuccess({action:'propose',optionKey:'O1',rationale:'Choose this option.'});
  script.enqueue({...valid,data:{turn:{action:'propose',optionKey:'O1',rationale:'Choose this option.',PRIVATE_INJECTION:'secret'}}});
  const s=await seedRoom();const attempt=(await s.t.run(ctx=>ctx.db.query('attempts').first()))!;
  await s.t.action(internal.agents.runAttempt,{attemptId:attempt._id,actorUserId:null});
  const stored=(await s.t.run(ctx=>ctx.db.get(attempt._id)))!;
  expect(stored).toMatchObject({status:'invalid_output',errorCode:'output.schema_violation'});
  expect(stored.issuePaths!.length).toBeGreaterThan(0);
  expect(JSON.stringify(stored.issuePaths)).not.toMatch(/PRIVATE_INJECTION|secret/);
  expect(script.recorded).toHaveLength(1);
});
it('W2-5 integration uses the real scripted driver override without a gateway call',async()=>{
  const {ScriptedDriver,setDriverForTests,resetDriverForTests}=await import('./agents/drivers');
  vi.stubEnv('DEPLOYMENT_TIER','test');vi.stubEnv('AGENT_MODE','stub');
  const driver=new ScriptedDriver([{action:'propose',optionKey:'O1',rationale:'Choose this option.'}]);
  setDriverForTests(driver,{tier:'test'});
  try{
    const s=await seedRoom();const attempt=(await s.t.run(ctx=>ctx.db.query('attempts').first()))!;
    await s.t.action(internal.agents.runAttempt,{attemptId:attempt._id,actorUserId:null});
    expect(driver.remaining).toBe(0);expect(script.recorded).toHaveLength(0);
    expect((await s.t.run(ctx=>ctx.db.get(attempt._id)))!.status).toBe('completed');
  }finally{resetDriverForTests();}
});
it('W2-5 integration snapshots each evaluator role and evaluates serially',async()=>{
  vi.stubEnv('AGENT_MODE','stub');const s=await seedRoom();await drainDue(s.t);
  const turns=await s.t.run(ctx=>ctx.db.query('turns').collect());
  expect(turns.map(t=>[t.role,t.candidateSnapshot.length,t.status])).toEqual([['provider',1,'completed'],['customer',0,'completed'],['finance',0,'completed']]);
  expect((await s.t.run(ctx=>ctx.db.query('runs').first()))!.status).toBe('pending_approval');
  expect(script.recorded).toHaveLength(0);
});
