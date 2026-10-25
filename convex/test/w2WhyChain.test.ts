import {describe,it,expect} from 'vitest';
import {makeFunctionReference} from 'convex/server';
import type {Infer} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import {executionViewV} from '../model/views/roomView';
import {harness} from '../../tests/convex-helpers/w2Execution.fixture';
const ref=makeFunctionReference<'query',{roomId:Id<'rooms'>},Infer<typeof executionViewV>|null>('executions:forRoom');
describe('W2-2 immutable execution why chain',()=>{
 it('12.17 whyChain follows revision and frozen signatures with audience-safe request links',async()=>{
  const h=await harness();
  await h.t.run(ctx=>ctx.db.insert('humanRequests',{roomId:h.roomId,runId:h.runId,kind:'infeasible',toRole:'customer',questionKey:'private_tradeoff',constraintsVersion:1,options:[{optionKey:'E',templateKey:'end_run',effect:{type:'end_run'}}],status:'answered',answerOptionKey:'E',answeredBy:h.users.customer,answeredAt:1,expiresAt:100,provenance:'live',createdAt:1}));
  await h.execute();
  const customer=(await h.as('customer').query(ref,{roomId:h.roomId}))!;
  expect(customer.whyChain.map(step=>step.step)).toEqual(['constraints_changed','run_started','request_answered','proposal_created','approval_recorded','approval_recorded','approval_recorded','room_executed']);
  expect(customer.whyChain.find(step=>step.step==='proposal_created')?.href).toBe(`/rooms/${h.roomId}/proposals/${h.proposalId}`);
  expect(customer.whyChain.find(step=>step.step==='request_answered')?.href).toMatch(/\/requests\//);
  const provider=(await h.as('provider').query(ref,{roomId:h.roomId}))!;
  expect(provider.whyChain.find(step=>step.step==='request_answered')).toMatchObject({href:null,text:'Negotiation resumed'});
  expect(JSON.stringify(provider.whyChain)).not.toMatch(/private_tradeoff|infeasible|userId|capCents/);
  // A later constraint source cannot alter historical execution provenance.
  await h.t.run(ctx=>ctx.db.insert('constraintRevisions',{roomId:h.roomId,version:2,previousVersion:1,cause:'clock',sourceRefs:[],localDate:'2026-10-25',createdAt:2}));
  expect((await h.as('customer').query(ref,{roomId:h.roomId}))!.whyChain).toEqual(customer.whyChain);
 });
 it('12.17 whyChain projects finance sourceRefs by their revision time and brief version',async()=>{
  const h=await harness();
  await h.t.run(async ctx=>{
   const old=(await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',h.roomId).eq('role','finance')).unique())!;
   const {_id,_creationTime,...copy}=old;void _id;void _creationTime;
   const briefId=await ctx.db.insert('briefs',{...copy,version:2,hardFields:{schemaKey:'scope_change.finance.v1',capCents:499999}});
   await ctx.db.insert('constraintRevisions',{roomId:h.roomId,version:2,previousVersion:1,cause:'brief_confirmed',sourceRefs:[{kind:'brief',briefId,role:'finance',version:2}],localDate:'2026-10-24',createdAt:2});
   await ctx.db.patch(h.roomId,{constraintsVersion:2});await ctx.db.patch(h.runId,{constraintsVersionAtStart:2});
  });
  for(const role of ['customer','provider','finance']as const)await h.approve(role,{expectedConstraintsVersion:2});
  const finance=(await h.as('finance').query(ref,{roomId:h.roomId}))!;
  expect(finance.whyChain.find(step=>step.constraintsVersion===2&&step.step==='constraints_changed')?.text).toContain('$4,999.99');
  const before=(await h.as('customer').query(ref,{roomId:h.roomId}))!;
  expect(JSON.stringify(before.whyChain)).not.toContain('$4,999.99');
  await h.t.run(ctx=>ctx.db.insert('sharedFacts',{roomId:h.roomId,fromRole:'finance',field:'capCents',seq:1,value:{kind:'cents',cents:499999},audience:['customer'],briefVersion:2,source:'manual',createdBy:h.users.finance,provenance:'live',createdAt:Date.now()+1}));
  expect((await h.as('customer').query(ref,{roomId:h.roomId}))!.whyChain).toEqual(before.whyChain);
  expect(JSON.stringify((await h.as('provider').query(ref,{roomId:h.roomId}))!.whyChain)).not.toMatch(/4,999|499999|finance updated/);
 });
 it('12.17 whyChain bounds revision history at 20 versions and folds earlier versions',async()=>{
  const h=await harness();
  await h.t.run(async ctx=>{
   for(let version=2;version<=22;version++)await ctx.db.insert('constraintRevisions',{roomId:h.roomId,version,previousVersion:version-1,cause:'clock',sourceRefs:[],localDate:'2026-10-24',createdAt:version});
   await ctx.db.patch(h.roomId,{constraintsVersion:22});await ctx.db.patch(h.runId,{constraintsVersionAtStart:22});
  });
  for(const role of ['customer','provider','finance']as const)await h.approve(role,{expectedConstraintsVersion:22});
  const view=(await h.as('finance').query(ref,{roomId:h.roomId}))!;
  expect(view.whyChain[0]).toMatchObject({step:'earlier_history',constraintsVersion:null});
  expect(view.whyChain.filter(step=>step.step==='constraints_changed').map(step=>step.constraintsVersion)).toEqual(Array.from({length:20},(_,index)=>index+3));
  expect(view.whyChain.at(-1)).toMatchObject({step:'room_executed',constraintsVersion:22});
 });
});
