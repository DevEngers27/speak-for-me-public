/** Persisted lifecycle inputs use the platform's source readers and disclosure projection. */
import type {QueryCtx} from '../_generated/server';
import type {Doc,Id} from '../_generated/dataModel';
import {latestBrief,catalogRows,currentCatalog,ledgerState,type Role} from './common';
import {factRows} from './sharedFacts';
import {scenarioOf} from '../scenarios/registry';
import {viewFor,privacy,type View} from '@core/engine';
import type {ScopeChangeRuleInput} from '@core/scenarios/scope-change';
export {roomReadiness} from './constraints/readiness';
export async function sources(ctx:Pick<QueryCtx,'db'>,roomId:Id<'rooms'>){
 const read=ctx as QueryCtx;
 const briefs=(await Promise.all((['customer','provider','finance'] as const).map(role=>latestBrief(read,roomId,role)))).filter((b):b is Doc<'briefs'>=>b!==null);
 const catalog=currentCatalog(await catalogRows(read,roomId));
 const ledger=await ctx.db.query('ledgerEntries').withIndex('by_room_kind',q=>q.eq('roomId',roomId)).collect();
 const facts=await factRows(read,roomId);
 return {briefs,catalog,ledger,facts};
}
export async function loadRuleInput(ctx:Pick<QueryCtx,'db'>,room:Doc<'rooms'>){
 const data=await sources(ctx,room._id),ledger=await ledgerState(ctx as QueryCtx,room._id);
 const input=scenarioOf(room).toRuleInput({room,briefs:Object.fromEntries(data.briefs.map(b=>[b.role,b])),catalogRows:data.catalog,...(ledger.baseline?{committedCents:ledger.committedCents}:{})});
 return {full:{...input,viewer:'system'} as View<ScopeChangeRuleInput>,data};
}
export async function roleView(ctx:Pick<QueryCtx,'db'>,room:Doc<'rooms'>,role:Role){
 const {full,data}=await loadRuleInput(ctx,room),plugin=scenarioOf(room);
 const facts=privacy.projectSharedFacts(role,data.facts,undefined,plugin);
 const disclosures:Record<string,Role[]>={};const visible={...full};
 for(const fact of facts){
  const field=String(fact.field),value=fact.value as Doc<'sharedFacts'>['value'];
  if(!value)continue;
  disclosures[field]=[role];
  if(plugin.fields.find(f=>f.key===field)?.owner!==role)Object.assign(visible,{[field]:value.kind==='cents'?value.cents:value.kind==='date'?value.date:value.kind==='itemKeys'?value.itemKeys:value.value});
 }
 return {view:viewFor(plugin,visible,disclosures,role),own:data.briefs.find(b=>b.role===role),data};
}
