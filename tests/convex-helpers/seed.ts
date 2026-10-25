import type {TestConvex} from 'convex-test';
import schema from '../../convex/schema';
import {api} from '../../convex/_generated/api';
import {asRole,TEST_ROLES} from './roles';
import type {ScopeChangeFixture} from '../../core/scenarios/scope-change/fixtures/main';
import {addDays,isoDate} from '../../core/engine/index';
import type {Doc} from '../../convex/_generated/dataModel';
export async function seedRoom(t:TestConvex<typeof schema>,fx:ScopeChangeFixture,opts:{until?:'members'|'catalog'|'two_briefs'|'run_started';disclosures?:Partial<Record<import('../../convex/model/common').Role,Record<string,import('../../convex/model/common').Role[]>>>;baseline?:boolean}={}){
 const actors={customer:asRole(t,'customer'),provider:asRole(t,'provider'),finance:asRole(t,'finance')};
 const users={} as Record<typeof TEST_ROLES[number],{userId:import('../../convex/_generated/dataModel').Id<'users'>;changed:boolean}>;
 for(const role of TEST_ROLES)users[role]=await actors[role].mutation(api.users.ensureViewer,{});
 await asRole(t,'outsider').mutation(api.users.ensureViewer,{});
 const creator=actors[fx.room.creatorRole];
 const {roomId}=await creator.mutation(api.rooms.create,{title:fx.room.title,scenarioKey:'scope_change',timeZone:fx.room.timeZone,myRole:fx.room.creatorRole});
 for(const role of TEST_ROLES)if(role!==fx.room.creatorRole){const {inviteId}=await creator.mutation(api.invites.create,{roomId,role,invitedEmail:`${role}@example.com`});await actors[role].mutation(api.invites.accept,{invite:{by:'email',inviteId}});}
 const localDate=(await t.run(async ctx=>await ctx.db.get(roomId)))!.localDate;
 const result={roomId,actors,creator,users,localDate,fx};
 if(opts.until==='members')return result;
 if(opts.baseline!==false)await actors.finance.mutation(api.ledger.recordBaseline,{roomId,amountCents:fx.ledgerBaselineCents});
 await actors.provider.mutation(api.catalog.confirm,{roomId,expectedConstraintsVersion:0,rows:fx.catalog.map(row=>({itemKey:row.itemKey,kind:row.kind,title:row.title,priceCents:row.priceCents,leadDays:row.leadDays,taskTemplates:row.taskTemplates.map(template=>({title:template.title,assigneeRole:template.assigneeRole}))}))});
 if(opts.until==='catalog')return result;
 let confirmed=0;
 for(const role of fx.confirmOrder){if(confirmed===2&&opts.until!=='run_started')break;const brief=fx.briefs[role];let hardFields:Doc<'briefs'>['hardFields'];let softFields:Doc<'briefs'>['softFields'];
 if(role==='customer'){const b=fx.briefs.customer;hardFields={schemaKey:'scope_change.customer.v1',requiredItemKeys:[...b.hardFields.requiredItemKeys].sort(),deadline:addDays(isoDate(localDate),b.hardFields.deadline.offsetDays)};softFields={schemaKey:'scope_change.customer.v1',preferredItemKeys:[...b.softFields.preferredItemKeys],notes:b.softFields.notes};}
 else if(role==='finance'){hardFields={schemaKey:'scope_change.finance.v1',capCents:fx.briefs.finance.hardFields.capCents};softFields={schemaKey:'scope_change.finance.v1',notes:brief.softFields.notes};}
 else{hardFields={schemaKey:'scope_change.provider.v1'};softFields={schemaKey:'scope_change.provider.v1',notes:brief.softFields.notes};}
 const disclosures=Object.fromEntries(Object.entries(opts.disclosures?.[role]??brief.disclosures).map(([key,value])=>[key,[...value]]));
 await actors[role].mutation(api.briefs.confirm,{roomId,expectedConstraintsVersion:0,hardFields,softFields,disclosures});confirmed++;
 }
 return result;
}
