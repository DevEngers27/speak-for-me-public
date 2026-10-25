import {assertCatalogNotDelivered} from './followUp';
import {nowMs} from '../lib/time';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { inheritProvenance, ITEM_KEY_RE } from '../../core/engine';
import { validateCatalogTitle } from '../../core/scenarios/scope-change';
import { isCents } from '../../core/engine';
import { appError } from '../lib/errors';
import { openRoomTx,eventWriteContext,type RoomTx } from '../lib/db';
import { assertWithinRate } from '../lib/rateLimit';
import { requireActor,assertStatus,assertVersion,catalogRows,currentCatalog,checked,same,type Actor,type Role } from './common';
import {assertDailyConstraintBucket} from './constraintRates';
import {assertItemRepriceWithinRun} from './constraints/writeGuards';
import {currentRunProposal} from './constraintInput';
import { withConstraintChange } from './constraints';
import { appendEvents } from './events';
export type CatalogInput={itemKey:string;kind:'item'|'modifier';title:string;priceCents:number;leadDays:number;taskTemplates:{title:string;assigneeRole:Role}[]};
export async function appendCatalogRow(tx:RoomTx,actor:Actor,row:CatalogInput,old?:Doc<'catalogItems'>,status:'confirmed'|'retired'|'draft'='confirmed') {
  await assertCatalogNotDelivered(eventWriteContext(tx),tx.room,[row.itemKey]);
  const pricing=!old||old.status==='draft'||old.priceCents!==row.priceCents||old.leadDays!==row.leadDays||old.status!==status;
  const revision=status==='draft'?0:!old||old.status==='draft'?1:old.revision+(pricing?1:0);
  const editNo=status==='draft'||!old||pricing?0:old.editNo+1;
  const now=eventWriteContext(tx).createdAt;
  const id=await tx.insert('catalogItems',{roomId:tx.room._id,itemKey:row.itemKey,kind:row.kind,title:row.title,priceCents:row.priceCents,leadDays:row.leadDays,taskTemplates:row.taskTemplates,status,revision,editNo,createdBy:actor.userId,provenance:inheritProvenance(tx.room.provenance,actor.provenance??'live'),createdAt:now,...(status==='draft'?{}:{confirmedBy:actor.userId,confirmedAt:pricing?now:old?.confirmedAt??now})});
  return {id,itemKey:row.itemKey,revision,editNo,changed:true,priceChanged:pricing};
}
export async function confirmCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;expectedConstraintsVersion:number;rows:CatalogInput[]}) {
  const {room}=await requireActor(ctx,actor,args.roomId,['provider']);assertStatus(room);assertVersion(room,args.expectedConstraintsVersion);
  const current=currentCatalog(await catalogRows(ctx,room._id)),seen=new Set<string>();
  if(args.rows.length<1||args.rows.length>14)throw appError('input.invalid',{field:'rows'});
  for(const row of args.rows) {
    if(!ITEM_KEY_RE.test(row.itemKey))throw appError('input.invalid',{field:'itemKey'});
    const old=current.find(r=>r.itemKey===row.itemKey);
    if(seen.has(row.itemKey)||old&&old.kind!==row.kind)throw appError('item.duplicate',{field:'itemKey',itemKeys:[row.itemKey]});
    seen.add(row.itemKey);
    if(old?.status==='retired')throw appError('item.retired',{field:'itemKey'}); // CN-004 #6: fail closed pending ruling.
  }
  await assertCatalogNotDelivered(ctx,room,args.rows.map(row=>row.itemKey));
  const normalized=args.rows.map(row=>({...row,title:row.title.normalize('NFC').trim(),taskTemplates:row.taskTemplates.map(t=>({title:t.title.normalize('NFC').trim(),assigneeRole:t.assigneeRole}))}));
  for(const row of normalized) {
    checked(validateCatalogTitle(row.title));
    if(!isCents(row.priceCents)||row.priceCents>8000000000)throw appError('amount.out_of_range',{field:'priceCents'});
    if(!Number.isInteger(row.leadDays)||row.leadDays<0||row.leadDays>365)throw appError('date.out_of_range',{field:'leadDays'});
    if(row.kind==='modifier'&&row.taskTemplates.length||row.taskTemplates.length>5)throw appError('input.invalid',{field:'taskTemplates'});
    for(const t of row.taskTemplates)checked(validateCatalogTitle(t.title,'taskTemplates.title'));
  }
  const merged=new Map(current.filter(r=>r.status!=='retired').map(r=>[r.itemKey,r.kind]));for(const row of normalized)merged.set(row.itemKey,row.kind);
  for(const [kind,limit]of [['item',12],['modifier',2]] as const)if([...merged.values()].filter(v=>v===kind).length>limit)throw appError('item.limit_exceeded',{field:kind,limit});
  const plan=normalized.map(row=>{const old=current.find(r=>r.itemKey===row.itemKey);const changed=!old||old.status!=='confirmed'||!same({itemKey:old.itemKey,kind:old.kind,title:old.title,priceCents:old.priceCents,leadDays:old.leadDays,taskTemplates:old.taskTemplates},row);return {row,old,changed};});
  if(!plan.some(p=>p.changed))return {status:'unchanged' as const,rows:plan.map(p=>({itemKey:p.row.itemKey,revision:p.old!.revision,editNo:p.old!.editNo,changed:false})),constraintsVersion:room.constraintsVersion,bumped:false};
  const {run}=await currentRunProposal(ctx,room._id);
  for(const p of plan)if(p.changed&&p.old&&p.old.priceCents!==p.row.priceCents&&run){
    const pricing=await ctx.db.query('catalogItems').withIndex('by_room_item',q=>q.eq('roomId',room._id).eq('itemKey',p.old!.itemKey).eq('revision',p.old!.revision)).first();
    if(p.old.confirmedAt!==undefined&&(p.old.confirmedAt>run.startedAt||p.old.confirmedAt===run.startedAt&&pricing!._creationTime>=run._creationTime))assertItemRepriceWithinRun(room.status,run.startedAt,p.old.confirmedAt,nowMs(ctx));
  }
  if(plan.some(p=>p.changed&&(!p.old||p.old.status!=='confirmed'||p.old.priceCents!==p.row.priceCents||p.old.leadDays!==p.row.leadDays)))await assertDailyConstraintBucket(ctx,room,'price_writes');
  await assertWithinRate(ctx,{kind:'constraint_writes',roomId:room._id,actorUserId:actor.userId});
  const tx=await openRoomTx(ctx,room._id,{allow:['setup','open']});
  const sourceRefs:Doc<'constraintRevisions'>['sourceRefs']=[];
  return await withConstraintChange({...ctx,tx},room._id,{cause:'catalog_changed',sourceRefs,actorUserId:actor.userId},async()=>{
    const rows:{itemKey:string;revision:number;editNo:number;changed:boolean}[]=[],events:{itemKey:string;kind:'item'|'modifier';revision:number;priceCents:number;leadDays:number}[]=[];let priceChanged=false;
    for(const p of plan){if(!p.changed){rows.push({itemKey:p.row.itemKey,revision:p.old!.revision,editNo:p.old!.editNo,changed:false});continue;}const out=await appendCatalogRow(tx,actor,p.row,p.old);sourceRefs.push({kind:'catalogItem',catalogItemId:out.id,itemKey:out.itemKey,revision:out.revision});rows.push({itemKey:out.itemKey,revision:out.revision,editNo:out.editNo,changed:true});priceChanged ||=out.priceChanged;events.push({itemKey:p.row.itemKey,kind:p.row.kind,revision:out.revision,priceCents:p.row.priceCents,leadDays:p.row.leadDays});}
    await appendEvents(tx,[{payload:{type:'catalog_item_confirmed',items:events,priceChanged},actor:{kind:'user',role:'provider'},actorUserId:actor.userId}]);
    return {status:'confirmed' as const,rows,constraintsVersion:room.constraintsVersion,bumped:false};
  });
}
export async function retireCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;itemKey:string;expectedConstraintsVersion:number}) {
  const {room}=await requireActor(ctx,actor,args.roomId,['provider']);assertStatus(room);assertVersion(room,args.expectedConstraintsVersion);
  const old=currentCatalog(await catalogRows(ctx,room._id)).find(r=>r.itemKey===args.itemKey);
  if(!old)throw appError('item.unknown',{field:'itemKey',itemKeys:ITEM_KEY_RE.test(args.itemKey)?[args.itemKey]:[]});
  if(old.status==='retired')return {status:'unchanged' as const,revision:old.revision,constraintsVersion:room.constraintsVersion,bumped:false};
  await assertDailyConstraintBucket(ctx,room,'price_writes');
  await assertWithinRate(ctx,{kind:'constraint_writes',roomId:room._id,actorUserId:actor.userId});
  const tx=await openRoomTx(ctx,room._id,{allow:['setup','open']});
  const sourceRefs:Doc<'constraintRevisions'>['sourceRefs']=[];
  return await withConstraintChange({...ctx,tx},room._id,{cause:'catalog_changed',sourceRefs,actorUserId:actor.userId},async()=>{const row=await appendCatalogRow(tx,actor,old,old,'retired');sourceRefs.push({kind:'catalogItem',catalogItemId:row.id,itemKey:row.itemKey,revision:row.revision});await appendEvents(tx,[{payload:{type:'catalog_item_retired',itemKey:old.itemKey,revision:row.revision},actor:{kind:'user',role:'provider'},actorUserId:actor.userId}]);return {status:'retired' as const,revision:row.revision,constraintsVersion:room.constraintsVersion,bumped:false};});
}
