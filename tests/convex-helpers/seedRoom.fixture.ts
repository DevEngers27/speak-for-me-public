/** W2-4 scheduler fixture built on the platform's production bootstrap. */
import {convexTest} from 'convex-test';
import schema from '../../convex/schema';
import {modules,trackLiveness} from './setup';
import {seedRoom as platformSeed} from './seed';
import {main} from '../../core/scenarios/scope-change/fixtures/main';
import {api} from '../../convex/_generated/api';
import {openRoomTx} from '../../convex/lib/db';
import {insertBriefVersion} from '../../convex/model/briefs';
import {startRunTx} from '../../convex/model/runs';
import {bindRoomTx} from '../../convex/model/runtimeTx';
export async function seedRoom(options:{until?:'setup'|'run_started';agentMode?:'stub'|'live';capCents?:number;scenarioVersion?:number;track?:boolean}={}) {
 const t=convexTest(schema,modules);
 const fx={...main,room:{...main.room,title:'Scheduler test',timeZone:'UTC',creatorRole:'customer' as const},catalog:[{...main.catalog.find(c=>c.itemKey==='sso_login')!,priceCents:80000,leadDays:3}],ledgerBaselineCents:100000,
  confirmOrder:['provider','finance','customer'] as const,briefs:{customer:{...main.briefs.customer,hardFields:{requiredItemKeys:['sso_login'],deadline:{offsetDays:31}},softFields:{preferredItemKeys:[],notes:'PRIVATE-CUSTOMER'},disclosures:{requiredItemKeys:[],deadline:[],preferredItemKeys:[]}},provider:{...main.briefs.provider,softFields:{notes:'PRIVATE-PROVIDER'},disclosures:{}},finance:{...main.briefs.finance,hardFields:{capCents:options.capCents??200000},softFields:{notes:'PRIVATE-FINANCE'},disclosures:{capCents:[],committedCents:[],headroomCents:[]}}}};
 const s=await platformSeed(t,fx,{until:'two_briefs'});
 const users=[s.users.customer.userId,s.users.provider.userId,s.users.finance.userId];
 if(options.until==='setup'||(options.scenarioVersion&&options.scenarioVersion!==1)) {
  await t.run(async ctx=>{
   const tx=await openRoomTx(ctx,s.roomId,{allow:['setup']});
   await insertBriefVersion(tx,{userId:users[0]!},{role:'customer',hardFields:{schemaKey:'scope_change.customer.v1',requiredItemKeys:['sso_login'],deadline:'2026-11-24'},softFields:{schemaKey:'scope_change.customer.v1',preferredItemKeys:[],notes:'PRIVATE-CUSTOMER'},disclosures:{requiredItemKeys:[],deadline:[],preferredItemKeys:[]},source:'form'});
  });
 } else {
  await s.actors.customer.mutation(api.briefs.confirm,{roomId:s.roomId,expectedConstraintsVersion:0,hardFields:{schemaKey:'scope_change.customer.v1',requiredItemKeys:['sso_login'],deadline:'2026-11-24'},softFields:{schemaKey:'scope_change.customer.v1',preferredItemKeys:[],notes:'PRIVATE-CUSTOMER'},disclosures:{requiredItemKeys:[],deadline:[],preferredItemKeys:[]}});
 }
 if(options.scenarioVersion&&options.scenarioVersion!==1) {
  // Construct the deployment-version-change failure after real bootstrap.
  await t.run(async ctx=>{const tx=await openRoomTx(ctx,s.roomId,{allow:['setup']});const runTx=bindRoomTx(ctx,tx,users[0]!);await tx.patch('rooms',s.roomId,{status:'open',constraintsVersion:1});await ctx.db.patch(s.roomId,{scenarioVersion:options.scenarioVersion});await startRunTx(runTx,{cause:'manual_start',origin:'system'});});
 }
 if(options.track!==false&&options.until!=='setup')trackLiveness(t,s.roomId);
 return {t,roomId:s.roomId,users,as:(role:'customer'|'provider'|'finance')=>s.actors[role]};
}
