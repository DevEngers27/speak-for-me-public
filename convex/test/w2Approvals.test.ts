import { describe, expect, it, vi } from 'vitest';
import { harness, recordRef } from '../../tests/convex-helpers/w2Execution.fixture';
import type { DecisionArgs } from '../approvals';
import * as engine from '@core/engine';
import { recordDecisionCore } from '../approvals';

type H = Awaited<ReturnType<typeof harness>>;
async function fresh() { return harness(); }
function expectFindings(h: H, codes: string[]) { h.expectFindings(codes); }
async function counts(h: H) { return h.t.run(async ctx => ({ approvals: (await ctx.db.query('approvals').collect()).length, events: (await ctx.db.query('events').collect()).length, executions: (await ctx.db.query('executions').collect()).length, ledger: (await ctx.db.query('ledgerEntries').collect()).length, tasks: (await ctx.db.query('tasks').collect()).length, changeOrders: (await ctx.db.query('changeOrders').collect()).length })); }
async function fails(h: H, code: string, call: () => Promise<unknown>) { const before = await counts(h); await expect(call()).rejects.toThrow(code); expect(await counts(h)).toEqual(before); }

export async function addApproval(h: H, role: 'customer'|'provider'|'finance', decision: DecisionArgs['decision'], seq: number, cv = 1) {
  return h.t.run(ctx => ctx.db.insert('approvals', { roomId: h.roomId, proposalId: h.proposalId, runId: h.runId, userId: h.users[role], role, kind: role === 'finance' ? 'budget' : 'terms', decision, seq, boundConstraintsVersion: cv, boundTermsKey: h.termsKey, decidedAt: 1 }));
}

describe('W2-2 approvals and atomic execution', () => {
  it('TC-EXE-01 [serial] S3 replay returns same execution with no rows or events', async () => {
    const h = await fresh();
    const first = await h.execute();
    expect(first).toMatchObject({ status: 'executed', alreadyExecuted: false });
    const before = await counts(h);
    for (const role of ['customer','provider','finance'] as const) expect(await h.approve(role, { expectedConstraintsVersion: -1, expectedTermsKey: 'old' })).toEqual({ status: 'executed', alreadyExecuted: true, executionId: first.executionId });
    expect(await counts(h)).toEqual(before);
    expect(before).toMatchObject({ approvals: 3, executions: 1, ledger: 2, tasks: 1, changeOrders: 1 });
    const room = await h.t.run(ctx => ctx.db.get(h.roomId));
    expect(room).toMatchObject({ status: 'executed', constraintsVersion: 1 });
    await fails(h, 'approval.already_executed', () => h.as('customer').mutation(recordRef, h.args('reject')));
    await fails(h, 'approval.already_executed', () => h.as('provider').mutation(recordRef, h.args('withdraw')));
  });
  it('TC-EXE-04 I1 I12 I14 I20 X7–X17 writes frozen signatures, G701 chain and planned tasks together', async () => {
    const h = await fresh();
    const preview = await h.t.run(async ctx => { const p = await ctx.db.get(h.proposalId); return p!.plannedTasks; });
    const result = await h.execute();
    const data = await h.t.run(async ctx => ({ e: await ctx.db.get(result.executionId!), p: await ctx.db.get(h.proposalId), run: await ctx.db.get(h.runId), tasks: await ctx.db.query('tasks').collect(), co: await ctx.db.query('changeOrders').unique(), ledger: await ctx.db.query('ledgerEntries').collect(), events: await ctx.db.query('events').collect() }));
    expect(data.e?.approvalIds).toHaveLength(3);
    expect(data.e?.executionKey).toBe(`exec:${h.proposalId}`);
    expect(data.co).toMatchObject({ baselineCents: 400000, priorApprovedDeltaCents: 0, amountBeforeCents: 400000, deltaCents: 80000, amountAfterCents: 480000 });
    expect(data.tasks).toHaveLength(preview.length);
    for (const [i, task] of data.tasks.entries()) expect(task).toMatchObject({ ...preview[i], taskKey: `${result.executionId}:${preview[i]!.itemKey}:${preview[i]!.templateIndex}` });
    expect([data.p?.status,data.run?.status]).toEqual(['executed','executed']);
    expect(data.ledger.filter(l => l.kind === 'commit')).toHaveLength(1);
    expect(data.events.filter(e => e.payload.type === 'room_executed')).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toEqual([]);
  });
  it('TC-VER-11 [serial] I2 I3 I8 I9 withdraw without approve is unchanged; withdrawal can be reapproved', async () => {
    const h = await fresh();
    const before = await counts(h);
    expect(await h.as('customer').mutation(recordRef,h.args('withdraw'))).toEqual({ status: 'unchanged' });
    expect(await counts(h)).toEqual(before);
    expect(await h.approve('customer')).toMatchObject({ status: 'recorded', missingRoles: ['provider','finance'] });
    const once = await counts(h);
    expect(await h.approve('customer')).toEqual({ status: 'unchanged' });
    expect(await counts(h)).toEqual(once);
    expect(await h.as('customer').mutation(recordRef,h.args('withdraw'))).toMatchObject({ status: 'recorded' });
    await h.approve('customer'); await h.approve('provider'); expect(await h.approve('finance')).toMatchObject({ status: 'executed' });
  });
  it('TC-RUN-25 [construct] I11 I23 E14 reject works while draining and after pinned scenario removal', async () => {
    const h = await fresh();
    await h.t.run(async ctx => { await ctx.db.patch(h.roomId,{ scenarioVersion: 99 }); await ctx.db.insert('opsFlags',{ key:'global',draining:true,changedBy:null,changedAt:1 }); });
    expect(await h.as('finance').mutation(recordRef,h.args('reject',{reasonKey:'over_our_limit',note:'PRIVATE_AUTHOR_NOTE'}))).toMatchObject({status:'recorded'});
    const data = await h.t.run(async ctx => ({ p:await ctx.db.get(h.proposalId), run:await ctx.db.get(h.runId), turns:await ctx.db.query('turns').collect(), req:await ctx.db.query('humanRequests').unique(), events:await ctx.db.query('events').collect() }));
    expect(data.p?.status).toBe('rejected'); expect(data.run?.status).toBe('needs_input'); expect(data.turns).toEqual([]); expect(data.req).toMatchObject({ kind:'agent_failed',options:[{effect:{type:'end_run'}}] });
    expect(JSON.stringify(data.events.map(e=>e.payload))).not.toContain('PRIVATE_AUTHOR_NOTE');
    expect(data.events.find(e=>e.payload.type==='approval_recorded')?.payload).not.toHaveProperty('reasonKey');
  });
  it('08-S13 D06 carried proposal reject uses the real attempt chain and closes the prior request', async () => {
    const h=await fresh();
    const ids=await h.t.run(async ctx=>{
      const old=(await ctx.db.get(h.runId))!;
      const {_id,_creationTime,currentProposalId,...fields}=old;void _id;void _creationTime;void currentProposalId;
      await ctx.db.patch(h.runId,{status:'superseded',endedReason:'constraints_changed',endedAt:2});
      const runId=await ctx.db.insert('runs',{...fields,runNo:2,currentProposalId:h.proposalId});
      await ctx.db.patch(h.roomId,{currentRunId:runId,nextRunNo:3});
      const requestId=await ctx.db.insert('humanRequests',{roomId:h.roomId,runId,kind:'rounds_exhausted',toRole:'customer',questionKey:'rounds_exhausted',constraintsVersion:1,options:[{optionKey:'E',templateKey:'end_run',effect:{type:'end_run'}}],status:'open',expiresAt:Date.now()+100000,provenance:'live',createdAt:1});
      return {runId,requestId};
    });
    await h.as('customer').mutation(recordRef,h.args('reject'));
    const rows=await h.t.run(async ctx=>({run:await ctx.db.get(ids.runId),request:await ctx.db.get(ids.requestId),turns:await ctx.db.query('turns').withIndex('by_run_turnSeq',q=>q.eq('runId',ids.runId)).collect(),attempts:await ctx.db.query('attempts').withIndex('by_room',q=>q.eq('roomId',h.roomId)).collect(),events:await ctx.db.query('events').collect()}));
    expect(rows.run).toMatchObject({status:'negotiating',roundNo:2,currentProposalId:h.proposalId});
    expect(rows.request).toMatchObject({status:'superseded',closedReason:'regenerated'});
    expect(rows.turns).toHaveLength(1);expect(rows.attempts).toHaveLength(1);
    expect(rows.turns[0]!.promptVersion).not.toBe('parallel-stub');
    expect(rows.turns[0]!.candidateSnapshot.every(c=>c.candidateKey!==h.candidateKey)).toBe(true);
    expect(rows.events.some(e=>e.payload.type==='human_request_closed')).toBe(true);
  });
  it('TC-VER-01 TC-VER-02 TC-VER-05 S8 expected cv and terms are independently bound, no rows', async () => {
    const h = await fresh();
    for (const patch of [{ expectedConstraintsVersion: 0 }, { expectedTermsKey:'changed' }]) await fails(h,'approval.stale',()=>h.approve('customer',patch));
    try { await h.approve('customer',{expectedConstraintsVersion:0}); } catch(error) { expect((error as {data:unknown}).data).toEqual({code:'approval.stale',params:{currentConstraintsVersion:1}}); }
  });
  it('08-S0 unprovisioned and unauthenticated → exact auth codes, no row', async () => {
    const h = await fresh();
    await fails(h,'auth.unauthenticated',()=>h.t.mutation(recordRef,h.args()));
    await fails(h,'auth.user_not_provisioned',()=>h.t.withIdentity({tokenIdentifier:'unknown'}).mutation(recordRef,h.args()));
  });
  it('TC-VER-12 [construct] 08-S1 nonexistent proposal and outsider → auth.not_member; duplicate seats → self_conflict', async () => {
    const h = await fresh();
    const outsider = await h.t.run(ctx=>ctx.db.insert('users',{tokenIdentifier:'outside',displayName:'outside',isTestAccount:true,createdAt:1,updatedAt:1}));
    expect(outsider).toBeTruthy();
    await fails(h,'auth.not_member',()=>h.t.withIdentity({tokenIdentifier:'outside'}).mutation(recordRef,h.args()));
    await h.t.run(async ctx=> { const m = await ctx.db.query('members').withIndex('by_room_user',q=>q.eq('roomId',h.roomId).eq('userId',h.users.customer)).unique(); const {_id,_creationTime,...rest}=m!; void _id; void _creationTime; await ctx.db.insert('members',rest); });
    await fails(h,'approval.self_conflict',()=>h.approve('customer'));
  });
  it.each(['setup','closed','executed'] as const)('08-S4 %s → room guard, no row [construct]',async status=> {
    const h=await fresh(); await h.t.run(ctx=>ctx.db.patch(h.roomId,{status}));
    if(status==='executed') expectFindings(h,['R11']);
    await fails(h,status==='setup'?'approval.not_current':status==='executed'?'approval.already_executed':'run.invalid_state',()=>h.approve('customer'));
  });
  it('08-S5 approve scenario mismatch → scenario_version, no row; withdraw remains possible',async()=>{
    const h=await fresh(); await h.approve('customer'); await h.t.run(ctx=>ctx.db.patch(h.roomId,{scenarioVersion:99}));
    await fails(h,'run.invalid_state',()=>h.approve('provider')); expect(await h.as('customer').mutation(recordRef,h.args('withdraw'))).toMatchObject({status:'recorded'});
  });
  it('08-S6 noncurrent proposal → approval.not_current, no row',async()=>{ const h=await fresh(); await h.t.run(ctx=>ctx.db.patch(h.proposalId,{status:'superseded'})); await fails(h,'approval.not_current',()=>h.approve('customer')); });
  it('08-S7 non-required role → auth.role_forbidden, no row',async()=>{ const h=await fresh(); await h.t.run(ctx=>ctx.db.patch(h.proposalId,{requiredApprovals:[{role:'finance',kind:'budget'}]})); await fails(h,'auth.role_forbidden',()=>h.approve('customer')); });
  it.each([{reasonKey:'unknown',decision:'reject' as const},{reasonKey:'other',decision:'approve' as const},{note:'a'.repeat(501),decision:'approve' as const},{note:'a\u0000',decision:'reject' as const}])('08-S10 invalid input → input.invalid, no row (%j)',async patch=>{const h=await fresh(); await fails(h,'input.invalid',()=>h.as('customer').mutation(recordRef,h.args(patch.decision,patch))); });
  it('08-S11 failed current checks → approval.not_executable, no row',async()=>{ const h=await fresh(); await h.t.run(async ctx=>{const b=await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',h.roomId).eq('role','finance')).unique(); await ctx.db.patch(b!._id,{hardFields:{schemaKey:'scope_change.finance.v1',capCents:479999}});}); await fails(h,'approval.not_executable',()=>h.approve('customer')); });
  it('I22 reject never reads other users approval rows [construct]',async()=>{
    const h=await fresh();
    for(let i=1;i<=75;i++) await addApproval(h,'provider',i%2?'approve':'withdraw',i);
    // Detect a proposal-wide S9 read, even if its result is unused.
    await h.t.run(async ctx=>{
      const db = new Proxy(ctx.db,{get(target,key){ if(key!=='query') return Reflect.get(target,key); return (table:string)=>{ const query=target.query(table as 'approvals'); if(table!=='approvals') return query; return new Proxy(query,{get(q,prop){ if(prop!=='withIndex') return Reflect.get(q,prop); return (index:string, range:(builder:unknown)=>unknown)=> { const observed:string[]=[]; const fake={eq(field:string){observed.push(field);return fake;}}; range(fake); if(index==='by_proposal_user'&&!observed.includes('userId')) throw new Error('I22 whole approval range read'); return query.withIndex(index as 'by_proposal_user', range as never); }; }}); }; }});
      const member=await ctx.db.query('members').withIndex('by_room_user',q=>q.eq('roomId',h.roomId).eq('userId',h.users.customer)).unique();
      await recordDecisionCore({...ctx,db} as typeof ctx,member!,h.args('reject'));
    });
    expect((await h.t.run(ctx=>ctx.db.get(h.proposalId)))?.status).toBe('rejected');
  });
  it('08-S9 approve at 60 and withdraw at 10 → rate limit; reject has no cap',async()=>{
    const h=await fresh();
    for(let i=1;i<=120;i++) await addApproval(h,'customer',i%2?'approve':'withdraw',i);
    await fails(h,'run.rate_limited',()=>h.approve('customer'));
    // Existing current approve at limit must still converge without another row.
    await addApproval(h,'customer','approve',121);
    await fails(h,'run.rate_limited',()=>h.as('customer').mutation(recordRef,h.args('withdraw')));
    expect(await h.approve('customer')).toEqual({status:'unchanged'});
    expect(await h.as('customer').mutation(recordRef,h.args('reject'))).toMatchObject({status:'recorded'});
  });
  it('I15 [construct] unchanged approve still executes a complete set',async()=>{
    const h=await fresh(); for(const role of ['customer','provider','finance'] as const) await addApproval(h,role,'approve',1);
    expect(await h.approve('customer')).toMatchObject({status:'executed',alreadyExecuted:false});
  });
  it('08-X2 08-X3 existing execution fails closed and rolls last approve back [construct]',async()=>{
    const h=await fresh(); await h.approve('customer');await h.approve('provider');
    await h.t.run(ctx=>ctx.db.insert('executions',{roomId:h.roomId,runId:h.runId,proposalId:h.proposalId,proposalVersion:1,executionKey:`exec:${h.proposalId}`,constraintsVersion:1,termsKey:h.termsKey,approvalIds:[],executedByUserId:h.users.customer,scenarioKey:'scope_change',scenarioVersion:1,amountCents:80000,committedBeforeCents:400000,committedAfterCents:480000,capCentsAtExecution:480000,provenance:'live',executedAt:1}));
    await fails(h,'internal',()=>h.approve('finance')); expectFindings(h,['R2','R6','R7','R11']);
  });
  it('08-X5 corrupt planned task fails closed and rolls last approve back [construct]',async()=>{
    const h=await fresh();await h.approve('customer');await h.approve('provider');await h.t.run(async ctx=>{const p=await ctx.db.get(h.proposalId);await ctx.db.patch(h.proposalId,{plannedTasks:[...p!.plannedTasks,...p!.plannedTasks]});});await fails(h,'internal',()=>h.approve('finance'));
  });
});

describe('W2-2 execution fail-closed constructions', () => {
  it('08-X3 execution-key hit after an empty room lookup fails closed [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    const before = await counts(h);
    await expect(h.t.run(async ctx => {
      const db = new Proxy(ctx.db, { get(target, key) {
        if (key !== 'query') return Reflect.get(target, key);
        return (table: 'executions') => {
          const query = target.query(table);
          if (table !== 'executions') return query;
          return new Proxy(query, { get(q, prop) {
            if (prop !== 'withIndex') return Reflect.get(q, prop);
            return (index: string, range: never) => index === 'by_executionKey' ? { take: async () => [{ _id: 'injected-key-hit' }] } : query.withIndex(index as 'by_room', range);
          } });
        };
      } });
      const member = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', h.roomId).eq('userId', h.users.finance)).unique();
      return recordDecisionCore({ ...ctx, db } as typeof ctx, member!, h.args());
    })).rejects.toThrow('internal');
    expect(await counts(h)).toEqual(before);
  });
  it('08-X4 multiple baselines fail closed without final approval or records [construct]', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    await h.t.run(ctx => ctx.db.insert('ledgerEntries', { roomId: h.roomId, kind: 'baseline', amountCents: 0, recordedByUserId: h.users.finance, provenance: 'live', createdAt: 1 }));
    await fails(h, 'internal', () => h.approve('finance')); h.expectFindings(['R10']);
  });
  it('08-X5 terms drift fails closed without final approval [construct]', async () => {
    const h = await harness(); await h.t.run(ctx => ctx.db.patch(h.proposalId, { termsKey: 'drift' }));
    await h.approve('customer', { expectedTermsKey: 'drift' }); await h.approve('provider', { expectedTermsKey: 'drift' });
    await fails(h, 'internal', () => h.approve('finance', { expectedTermsKey: 'drift' })); h.expectFindings(['R8']);
  });
  for (const table of ['executions', 'ledgerEntries', 'changeOrders', 'tasks'] as const) it(`08-X7–X10 ${table} write failure rolls the final approval back [construct]`, async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    const before = await counts(h);
    await expect(h.t.run(async ctx => {
      const db = new Proxy(ctx.db, { get(target, key) {
        if (key !== 'insert') return Reflect.get(target, key);
        return (name: string, value: never) => { if (name === table) throw new Error('injected write fault'); return target.insert(name as 'approvals', value); };
      } });
      const member = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', h.roomId).eq('userId', h.users.finance)).unique();
      return recordDecisionCore({ ...ctx, db } as typeof ctx, member!, h.args());
    })).rejects.toThrow('injected write fault');
    expect(await counts(h)).toEqual(before);
  });
  it('TC-EXE-07 [construct] 08-I17 executed card uses only frozen approvalIds despite later injected row [construct]', async () => {
    const h = await harness(); await h.execute(); await addApproval(h, 'customer', 'withdraw', 2);
    const { buildProposalCard } = await import('../model/views/roomView');
    const card = await h.t.run(async ctx => {
      const p = await ctx.db.get(h.proposalId);
      const m = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', h.roomId).eq('userId', h.users.customer)).unique();
      return buildProposalCard(ctx, p!, m!);
    });
    expect(card.allApproved).toBe(true); expect(card.approvals.every(slot => slot.state === 'approved')).toBe(true);
    expect(card.myAction.current).toBe('approve'); h.expectFindings(['R7']);
  });
});

describe('W2-2 proposal binding and retry', () => {
  it('TC-EXE-05 TC-VER-15 only current-cv signatures count despite proposal creation cv', async () => {
    const h = await harness();
    await h.t.run(async ctx => { await ctx.db.patch(h.roomId, { constraintsVersion: 5 }); await ctx.db.patch(h.runId, { constraintsVersionAtStart: 5 }); });
    await h.approve('customer', { expectedConstraintsVersion: 5 }); await h.approve('provider', { expectedConstraintsVersion: 5 });
    await h.t.run(async ctx => { await ctx.db.patch(h.roomId, { constraintsVersion: 6 }); await ctx.db.patch(h.runId, { constraintsVersionAtStart: 6 }); });
    expect(await h.approve('finance', { expectedConstraintsVersion: 6 })).toMatchObject({ status: 'recorded', missingRoles: ['customer', 'provider'] });
    await h.approve('customer', { expectedConstraintsVersion: 6 });
    const result = await h.approve('provider', { expectedConstraintsVersion: 6 });
    expect(result.status).toBe('executed');
    const execution = await h.t.run(ctx => ctx.db.get(result.executionId!));
    const signatures = await h.t.run(ctx => Promise.all(execution!.approvalIds.map(id => ctx.db.get(id))));
    expect(execution?.constraintsVersion).toBe(6); expect(signatures.every(s => s?.boundConstraintsVersion === 6)).toBe(true);
    expect((await h.t.run(ctx => ctx.db.get(h.proposalId)))?.createdAtConstraintsVersion).toBe(1);
  });
  it('TC-EXE-09 pure planner failure rolls back every final-vote write; retry then succeeds', async () => {
    const h = await harness(); await h.approve('customer'); await h.approve('provider');
    const spy = vi.spyOn(engine, 'planExecutionRecords').mockImplementationOnce(() => { throw new Error('planner fault'); });
    try { await fails(h, 'internal', () => h.approve('finance')); }
    finally { spy.mockRestore(); }
    expect(await h.approve('finance')).toMatchObject({ status: 'executed', alreadyExecuted: false });
    expect(await counts(h)).toMatchObject({ approvals: 3, executions: 1, ledger: 2, tasks: 1, changeOrders: 1 });
  });
});
