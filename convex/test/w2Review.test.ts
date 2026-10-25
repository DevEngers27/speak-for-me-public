import { describe, expect, it } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { roomViewV } from '../model/views/roomView';
import { harness, recordRef } from '../../tests/convex-helpers/w2Execution.fixture';
const viewRef = makeFunctionReference<'query', {roomId:Id<'rooms'>}, Infer<typeof roomViewV>|null>('rooms:view');

describe('W2-2 review regressions', () => {
  for (const role of ['customer','provider'] as const) it(`08-S10 finance-only reason by ${role} → auth.role_forbidden, no row or event`, async () => {
    const h = await harness();
    const count = () => h.t.run(async ctx => ({ approvals: (await ctx.db.query('approvals').collect()).length, events: (await ctx.db.query('events').collect()).length }));
    const before = await count();
    await expect(h.as(role).mutation(recordRef,h.args('reject',{reasonKey:'over_our_limit'}))).rejects.toThrow('auth.role_forbidden');
    expect(await count()).toEqual(before);
    expect(await h.as('finance').mutation(recordRef,h.args('reject',{reasonKey:'over_our_limit'}))).toMatchObject({status:'recorded'});
  });

  for (const used of [false,true]) it(`08-I9 max-round alternatives exclude rejected key and keep-as-is used=${used}`, async () => {
    const h = await harness();
    await h.t.run(ctx => ctx.db.patch(h.runId,{roundNo:3,roundsExtended:used}));
    await h.as('customer').mutation(recordRef,h.args('reject'));
    const request = await h.t.run(ctx => ctx.db.query('humanRequests').withIndex('by_run_status',q => q.eq('runId',h.runId).eq('status','open')).unique());
    expect(request?.kind).toBe('rounds_exhausted');
    expect(request?.toRole).toBe('customer');
    expect(request?.options.some(o => o.effect.type === 'choose_candidate')).toBe(true);
    expect(request?.options.some(o => o.effect.type === 'choose_candidate' && o.effect.candidateKey === h.candidateKey)).toBe(false);
    expect(request?.options.some(o => o.effect.type === 'keep_as_is')).toBe(!used);
    expect(request?.options.at(-1)?.effect.type).toBe('end_run');
    expect(await h.t.run(ctx => ctx.db.query('turns').withIndex('by_run_turnSeq',q => q.eq('runId',h.runId)).collect())).toEqual([]);
  });

  it('08-I8 next proposer snapshot honors active shared required scope after rejection', async () => {
    const h = await harness();
    await h.t.run(ctx => ctx.db.insert('sharedFacts',{roomId:h.roomId,fromRole:'customer',field:'requiredItemKeys',seq:1,value:{kind:'itemKeys',itemKeys:['scope_item']},audience:['provider'],briefVersion:1,source:'manual',createdBy:h.users.customer,provenance:'live',createdAt:1}));
    await h.as('customer').mutation(recordRef,h.args('reject'));
    const turn = await h.t.run(ctx => ctx.db.query('turns').withIndex('by_run_turnSeq',q => q.eq('runId',h.runId)).unique());
    expect(turn?.candidateSnapshot.length).toBeGreaterThan(0);
    expect(turn?.candidateSnapshot.every(candidate => candidate.itemKeys.includes('scope_item'))).toBe(true);
    expect(turn?.candidateSnapshot.some(candidate => candidate.candidateKey === h.candidateKey)).toBe(false);
  });

  it('07-7.9.3 current shared budget checks unmask for customer; withdrawal remasks; provider stays fit-only', async () => {
    const h = await harness();
    await h.t.run(async ctx => {
      const finance = await ctx.db.query('briefs').withIndex('by_room_role_version',q => q.eq('roomId',h.roomId).eq('role','finance')).unique();
      await ctx.db.patch(finance!._id,{hardFields:{schemaKey:'scope_change.finance.v1',capCents:479999}});
    });
    const codes = async () => {
      const fit = (await h.as('customer').query(viewRef,{roomId:h.roomId}))?.currentProposal?.fit;
      return fit?.audience === 'buyer' ? fit.checks.map(c => c.code) : [];
    };
    expect(await codes()).toContain('private.constraint_unmet');
    const share = async (seq:number, withdrawn=false, version=1) => h.t.run(async ctx => {
      for (const field of ['capCents','committedCents'] as const) await ctx.db.insert('sharedFacts',{roomId:h.roomId,fromRole:'finance',field,seq,value:withdrawn?null:{kind:'cents',cents:field==='capCents'?479999:400000},audience:withdrawn?[]:['customer'],briefVersion:version,source:'manual',createdBy:h.users.finance,provenance:'live',createdAt:1});
    });
    await share(1);
    expect(await codes()).toContain('budget.over');
    const provider = (await h.as('provider').query(viewRef,{roomId:h.roomId}))?.currentProposal?.fit;
    expect(provider).toEqual({audience:'provider',value:'blocked'});
    await expect(h.approve('customer')).rejects.toThrow('budget.over');
    await share(2,true);
    expect(await codes()).not.toContain('budget.over');
    expect(await codes()).toContain('private.constraint_unmet');
    await share(3,false,0);
    expect(await codes()).not.toContain('budget.over');
  });
});
