import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { openRoomTx,eventWriteContext,type RoomTx } from '../lib/db';
import { appError } from '../lib/errors';
import { scenarioOf } from '../scenarios/registry';
import { appendEvents } from './events';
import { assertStatus,requireActor,latestBrief,ledgerState,same,type Actor,type Role } from './common';
import { validateDeadline,validatePreferredItemKeys } from '../../core/scenarios/scope-change';
import { checked,catalogRows,currentCatalog } from './common';
import { isoDate } from '../../core/engine';
export async function factRows(ctx:QueryCtx,roomId:Id<'rooms'>) {
  return await ctx.db.query('sharedFacts').withIndex('by_room_from_field',q=>q.eq('roomId',roomId)).collect();
}
export async function ownedValue(ctx:QueryCtx,brief:Doc<'briefs'>,field:string):Promise<Doc<'sharedFacts'>['value']|undefined> {
  const hard=brief.hardFields;
  if((field==='requiredItemKeys'||field==='preferredItemKeys')&&hard.schemaKey==='scope_change.customer.v1') {
    const keys=field==='requiredItemKeys'?hard.requiredItemKeys:brief.softFields.schemaKey==='scope_change.customer.v1'?brief.softFields.preferredItemKeys:[];
    return {kind:'itemKeys',itemKeys:keys};
  }
  if(field==='deadline'&&hard.schemaKey==='scope_change.customer.v1') return {kind:'date',date:hard.deadline};
  if(hard.schemaKey==='scope_change.finance.v1') {
    if(field==='capCents')return {kind:'cents',cents:hard.capCents};
    const ledger=await ledgerState(ctx,brief.roomId);
    if(!ledger.baseline)return undefined;
    if(field==='committedCents')return {kind:'cents',cents:ledger.committedCents};
    if(field==='headroomCents')return {kind:'cents',cents:hard.capCents-ledger.committedCents};
  }
  return undefined;
}
export async function appendSharedFact(tx:RoomTx,args:Omit<Doc<'sharedFacts'>,'_id'|'_creationTime'|'roomId'|'seq'|'provenance'|'createdAt'>):Promise<{id:Id<'sharedFacts'>|null;changed:false}|{id:Id<'sharedFacts'>;changed:true}> {
  const state=eventWriteContext(tx),plugin=scenarioOf(tx.room);
  const field=plugin.fields.find(f=>f.key===args.field&&f.owner===args.fromRole&&f.class!=='note'&&f.disclosableTo.length);
  if(!field || args.audience.some(role=>!field.disclosableTo.includes(role)) || args.fromRole==='finance'&&args.audience.includes('provider'))throw appError('internal');
  const previous=await state.db.query('sharedFacts').withIndex('by_room_from_field',q=>q.eq('roomId',tx.room._id).eq('fromRole',args.fromRole).eq('field',args.field)).order('desc').first();
  const audience=[...new Set(args.audience)].sort();
  if(previous&&same(previous.value,args.value)&&same(previous.audience,audience))return {id:previous._id,changed:false};
  if(!previous && audience.length===0)return {id:null,changed:false};
  const id=await tx.insert('sharedFacts',{...args,audience,roomId:tx.room._id,seq:(previous?.seq??0)+1,provenance:tx.room.provenance,createdAt:state.createdAt});
  return {id,changed:true};
}
export async function materializeDisclosures(ctx:MutationCtx,tx:RoomTx,brief:Doc<'briefs'>,actor:Actor,source:'brief_confirm'|'ledger'='brief_confirm') {
  const plugin=scenarioOf(tx.room);
  for(const field of plugin.fields.filter(f=>f.owner===brief.role&&f.disclosableTo.length&&f.class!=='note')) {
    const audience=brief.disclosures[field.key]??[];
    const value=await ownedValue(ctx,brief,field.key);
    if(value===undefined)continue;
    const result=await appendSharedFact(tx,{fromRole:brief.role,field:field.key,value:audience.length?value:null,audience,briefVersion:brief.version,source,createdBy:actor.userId});
    if(result.changed)await appendEvents(tx,[{payload:{type:'disclosure_changed',fromRole:brief.role},actor:{kind:'user',role:brief.role},actorUserId:actor.userId,restrictedRef:{table:'sharedFacts',id:result.id}}]);
  }
}
export async function addCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;field:string;audience:Role[];confirmOwnDisclosure:boolean}) {
  const {room,member}=await requireActor(ctx,actor,args.roomId);assertStatus(room);
  const field=scenarioOf(room).fields.find(f=>f.key===args.field&&f.owner===member.role&&f.class!=='note'&&f.disclosableTo.length);
  if(!field||args.audience.some(role=>!field.disclosableTo.includes(role)||role===member.role))throw appError('disclosure.blocked',{field:/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(args.field)?args.field:'field'});
  const brief=await latestBrief(ctx,room._id,member.role);
  if(!brief)throw appError('run.invalid_state',{guard:'brief_missing'});
  const previous=await ctx.db.query('sharedFacts').withIndex('by_room_from_field',q=>q.eq('roomId',room._id).eq('fromRole',member.role).eq('field',args.field)).order('desc').first();
  if(field.requiresAck&&args.audience.some(role=>!previous?.audience.includes(role))&&!args.confirmOwnDisclosure)throw appError('disclosure.needs_own_confirmation',{field:args.field});
  const owned=await ownedValue(ctx,brief,args.field);
  if(owned===undefined)throw appError('run.invalid_state',{guard:'baseline_exists'});
  if(owned?.kind==='date')checked(validateDeadline(owned.date,isoDate(room.localDate)));
  if(owned?.kind==='itemKeys')checked(validatePreferredItemKeys(owned.itemKeys,[],currentCatalog(await catalogRows(ctx,room._id)),{allowRetired:true}));
  const audience=[...new Set(args.audience)].sort(),value=audience.length?owned:null;
  if(!previous&&!audience.length)return {status:'unchanged' as const,sharedFactId:null};
  if(previous&&same(previous.value,value)&&same(previous.audience,audience))return {status:'unchanged' as const,sharedFactId:previous._id};
  const tx=await openRoomTx(ctx,room._id,{allow:['setup','open']});
  const result=await appendSharedFact(tx,{fromRole:member.role,field:args.field,value,audience,briefVersion:brief.version,source:'manual',createdBy:actor.userId});
  if(!result.changed)return {status:'unchanged' as const,sharedFactId:result.id};
  await appendEvents(tx,[{payload:{type:'disclosure_changed',fromRole:member.role},actor:{kind:'user',role:member.role},actorUserId:actor.userId,restrictedRef:{table:'sharedFacts',id:result.id}}]);
  return {status:audience.length?'shared' as const:'withdrawn' as const,sharedFactId:result.id};
}
