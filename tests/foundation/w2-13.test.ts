import {describe,it,expect} from 'vitest';
import {api} from '../../convex/_generated/api';
import {harness} from '../convex-helpers/w2Execution.fixture';
import {retainedApprovalReadModels} from '../convex-helpers/w2ReadModels.fixture';
import {privacyEquivalentChanges} from '../battery/w2-3.cases';
import {projectOpenRequestOptions} from '../../convex/model/views/requestOptions';

const roles=['customer','provider','finance'] as const;
describe('W2-13 read models',()=>{
 for(const status of ['negotiating','needs_input','pending_approval'] as const) for(const role of roles) {
  it(`DX-1 D11 ${role} current proposal fit and omissions during ${status}`,async()=>{
   const h=await harness();
   await h.t.run(ctx=>ctx.db.patch(h.runId,{status}));
   const view=(await h.as(role).query(api.rooms.view,{roomId:h.roomId}))!;
   expect(view.currentProposal?.fit).toEqual(role==='provider'?{audience:'provider',value:'ok'}:{audience:'buyer',passesChecks:true,checks:[]});
   expect(view.currentProposal?.notIncludedForMe).toEqual(role==='customer'?['extra_item']:null);
   expect(view.currentProposal?.myAgentSuggestion).toBeNull();
   await h.t.run(async ctx=>{
    const brief=(await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',h.roomId).eq('role','finance')).first())!;
    await ctx.db.patch(brief._id,{hardFields:{schemaKey:'scope_change.finance.v1',capCents:470000}});
   });
   const blocked=(await h.as(role).query(api.rooms.view,{roomId:h.roomId}))!.currentProposal!;
   if(role==='provider') expect(blocked.fit).toEqual({audience:'provider',value:'blocked'});
   else expect(blocked.fit).toMatchObject({audience:'buyer',passesChecks:false});
   expect(blocked.myAction.canDecide).toBe(false);

  });
 }
 for(const role of roles) it(`13.8.2 ${role} sees only own matching-version agent suggestion`,async()=>{
  const h=await harness();
  const insert=async(owner:typeof role,result:{action:'recommend_accept';proposalVersion:number;rationale:string}|{action:'escalate';kind:'infeasible';toRole:'finance';rationale:string},seq:number)=>h.t.run(ctx=>ctx.db.insert('turns',{roomId:h.roomId,runId:h.runId,turnSeq:seq,roundNo:1,role:owner,kind:'evaluate',status:'completed',constraintsVersion:1,candidateSnapshot:[],allowedActions:[],promptVersion:'test',currentAttemptNo:1,result,createdAt:seq,completedAt:seq}));
  const card=async()=>(await h.as(role).query(api.rooms.view,{roomId:h.roomId}))!.currentProposal!;
  await insert(roles.find(other=>other!==role)!,{action:'recommend_accept',proposalVersion:1,rationale:'OTHER_PRIVATE'},1);
  await insert(role,{action:'recommend_accept',proposalVersion:2,rationale:'WRONG_VERSION'},2);
  await insert(role,{action:'escalate',kind:'infeasible',toRole:'finance',rationale:'UNSCOPED'},3);
  expect((await card()).myAgentSuggestion).toBeNull();
  await insert(role,{action:'recommend_accept',proposalVersion:1,rationale:'OWN_MATCH'},4);
  expect((await card()).myAgentSuggestion).toMatchObject({action:'recommend_accept',proposalVersion:1,rationale:'OWN_MATCH'});
 });
 it('CE-058 Δ4 retained approval notice agrees with todos and phase',retainedApprovalReadModels);
 it('DX-5 TC-PRIV-21 provider bytes independent of constraints author',privacyEquivalentChanges);
 for(const role of roles) it(`D15 ${role} request endpoints share type and stored shown, blocked has no fields`,async()=>{
  const h=await harness();
  const requestId=await h.t.run(async ctx=>{
   await ctx.db.patch(h.runId,{status:'needs_input'});
   return ctx.db.insert('humanRequests',{roomId:h.roomId,runId:h.runId,kind:'infeasible',toRole:role,questionKey:'test',constraintsVersion:1,status:'open',expiresAt:9999999999999,createdAt:1,provenance:'live',options:[
    {optionKey:'A',templateKey:'choose_candidate',effect:{type:'choose_candidate',candidateKey:h.candidateKey},shown:{itemKeys:['scope_item'],amountCents:90000}},
    {optionKey:'B',templateKey:'blocked',effect:{type:'blocked'},shown:{amountCents:12345}},
   ]});
  });
  const view=(await h.as(role).query(api.rooms.view,{roomId:h.roomId}))!;
  const get=(await h.as(role).query(api.humanRequests.get,{requestId}))!;
  if(!view.openRequest?.mine||!get.mine)throw new Error('missing own request');
  expect(view.openRequest.options).toEqual(get.options);
  expect(get.options[0]).toMatchObject({type:'choose_candidate',shown:{itemKeys:['scope_item'],amountCents:90000},answerable:true});
  expect(get.options[1]).toMatchObject({type:'blocked',shown:{},effectView:{},answerable:false});
  expect(projectOpenRequestOptions(role,{toRole:role,status:'answered',options:[]})).toEqual([]);
 });
});
