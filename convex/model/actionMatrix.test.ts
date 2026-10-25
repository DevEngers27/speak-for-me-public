import {test,expect} from 'vitest';
import {makeFunctionReference} from 'convex/server';
import type {Value} from 'convex/values';
import {api} from '../_generated/api';
import {ACTION_MATRIX} from '../../tests/convex-helpers/actionMatrix';
import {setup} from '../../tests/convex-helpers/workflows.fixture';
import {harness} from '../../tests/convex-helpers/w2Execution.fixture';
import {asRole} from '../../tests/convex-helpers/roles';
for(const row of ACTION_MATRIX)test(`TC-AUTH-07 ${row.name} action × role matrix`,async()=>{
 if (['approvals.record','proposals.get','executions.forRoom','tasks.markDone','rooms.startFollowUp'].includes(row.name)) {
  const h=await harness();
  const execution=await h.execute();
  const task=await h.t.run(async ctx=>(await ctx.db.query('tasks').collect())[0]!);
  for(const who of ['customer','provider','finance','outsider','anonymous'] as const){
   const actor=who==='anonymous'?h.t:who==='outsider'?h.t.withIdentity({tokenIdentifier:'matrix|outside'}):h.as(who);
   if(who==='outsider')await actor.mutation(api.users.ensureViewer,{});
   const args:Record<string,Value>=row.name==='approvals.record'?h.args():row.name==='proposals.get'?{proposalId:h.proposalId}:row.name==='tasks.markDone'?{taskId:task._id}:row.name==='rooms.startFollowUp'?{executionId:execution.executionId!}:{roomId:h.roomId};
   const call=()=>row.kind==='query'?actor.query(makeFunctionReference<'query',Record<string,Value>,unknown>(row.name.replace('.',':')),args):actor.mutation(makeFunctionReference<'mutation',Record<string,Value>,unknown>(row.name.replace('.',':')),args);
   if(who==='anonymous'||who==='outsider'){if(row.kind==='query')expect(await call()).toBeNull();else await expect(call()).rejects.toThrow(/auth\./);}
   else if(row.name==='tasks.markDone'&&who!=='provider')await expect(call()).rejects.toThrow(/auth.role_forbidden/);
   else expect(await call()).not.toBeNull();
  }
  return;
 }
 for(const who of ['customer','provider','finance','outsider','anonymous'] as const){
  const s=await setup('catalog');const actor=who==='anonymous'?s.t:asRole(s.t,who);
  if(who==='outsider')await actor.mutation(api.users.ensureViewer,{});
  const args:Record<string,Value>={};
  if(!['users.viewer','users.ensureViewer','health.ping','rooms.create','rooms.listMine','invites.listMine'].includes(row.name))args.roomId=s.roomId;
  if(row.name==='rooms.create')Object.assign(args,{title:'Matrix room',scenarioKey:'scope_change',timeZone:'UTC',myRole:'customer'});
  if(row.name.startsWith('invites.create'))Object.assign(args,{role:'finance',...(row.name==='invites.create'?{invitedEmail:'finance@example.com'}:{})});
  if(row.name==='invites.accept'){delete args.roomId;args.invite={by:'link',token:'invalid'};}
  if(row.name==='briefs.updateSoft')args.notes='Matrix guidance';
  if(row.name==='briefs.confirm')Object.assign(args,{expectedConstraintsVersion:0,hardFields:who==='customer'?{schemaKey:'scope_change.customer.v1',requiredItemKeys:['audit_log_export'],deadline:s.localDate}:who==='finance'?{schemaKey:'scope_change.finance.v1',capCents:500000}:{schemaKey:'scope_change.provider.v1'},softFields:who==='customer'?{schemaKey:'scope_change.customer.v1',preferredItemKeys:[],notes:''}:who==='finance'?{schemaKey:'scope_change.finance.v1',notes:''}:{schemaKey:'scope_change.provider.v1',notes:''},disclosures:{}});
  if(row.name==='rooms.previewChange')args.change=who==='customer'?{kind:'customer_hard',requiredItemKeys:['audit_log_export']}:who==='provider'?{kind:'catalog',rows:[]}:{kind:'cap',newCapCents:500000};
  if(row.name==='budget.setCap')Object.assign(args,{expectedConstraintsVersion:0,capCents:500000});
  if(row.name==='ledger.recordBaseline')args.amountCents=0;
  if(row.name==='sharedFacts.add')Object.assign(args,{field:'capCents',audience:['customer'],confirmOwnDisclosure:true});
  if(row.name==='catalog.confirm')Object.assign(args,{expectedConstraintsVersion:0,rows:[{itemKey:'matrix_item',kind:'item',title:'Matrix item',priceCents:1,leadDays:1,taskTemplates:[]}]});
  if(row.name==='catalog.retire')Object.assign(args,{expectedConstraintsVersion:0,itemKey:'audit_log_export'});
  if(row.name==='timeline.page'||row.name==='rooms.listMine')args.paginationOpts={numItems:10,cursor:null};
  if(row.name==='turns.mine')Object.assign(args,{runId:null,paginationOpts:{numItems:10,cursor:null}});
  if(['runs.cancel','runs.retryTurn','runs.requestRenegotiation','humanRequests.answer','humanRequests.get'].includes(row.name)) {
   const ids=await s.t.run(async ctx=>{
    const runId=await ctx.db.insert('runs',{roomId:s.roomId,runNo:1,status:'needs_input',cause:'room_opened',constraintsVersionAtStart:0,agentMode:'stub',roundNo:1,maxRounds:3,roundsExtended:false,activeTurnSeq:null,nextTurnSeq:1,attemptCount:0,maxAttempts:18,reservedMicroUsd:0,spentMicroUsd:0,spendCapMicroUsd:3000000,provenance:'stub',startedAt:0});
    const requestId=await ctx.db.insert('humanRequests',{roomId:s.roomId,runId,kind:'agent_failed',toRole:'customer',questionKey:'request.agent_failed',constraintsVersion:0,options:[{optionKey:'A',templateKey:'request.retry_turn',effect:{type:'retry_turn'}}],status:'open',expiresAt:Date.now()+86400000,provenance:'stub',createdAt:0});
    await ctx.db.patch(s.roomId,{currentRunId:runId});return {runId,requestId};
   });
   if(row.name==='runs.requestRenegotiation')args.expectedRunId=ids.runId;
   else {delete args.roomId;if(row.name==='humanRequests.answer')Object.assign(args,{requestId:ids.requestId,optionKey:'A'});else if(row.name==='humanRequests.get')args.requestId=ids.requestId;else args.runId=ids.runId;}
  }
  const call=async()=>row.kind==='query'?await actor.query(makeFunctionReference<'query',Record<string,Value>,unknown>(row.name.replace('.',':')),args):row.kind==='mutation'?await actor.mutation(makeFunctionReference<'mutation',Record<string,Value>,unknown>(row.name.replace('.',':')),args):await actor.action(makeFunctionReference<'action',Record<string,Value>,unknown>(row.name.replace('.',':')),args);
  const denied=who==='anonymous'&&row.access!=='anon'||who==='outsider'&&row.access==='member'||row.creatorOnly&&who!=='customer'||row.roles&&!row.roles.includes(who as 'customer'|'provider'|'finance');
  if(denied&&row.kind==='query'){expect(await call()).toBeNull();continue;}
  try{await call();expect(denied,`${row.name} ${who}`).toBeFalsy();}catch(error){const data=(error as {data?:{code?:string}}).data;const code=data?.code??String(error);if(denied)expect(code).toMatch(/auth\./);else expect(code).not.toMatch(/auth\.|internal/);}
 }
});
