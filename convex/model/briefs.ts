import { rollLocalDateTx, todayInTimeZone } from './clock';
import {nowMs} from '../lib/time';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isoDate,cents,canonicalJson,ITEM_KEY_RE } from '../../core/engine';
import { validateRequiredItemKeys,validatePreferredItemKeys,validateDeadline,validateNotes,validateCapCents } from '../../core/scenarios/scope-change';
import { scenarioOf } from '../scenarios/registry';
import { appError } from '../lib/errors';
import { openRoomTx,eventWriteContext,type RoomTx } from '../lib/db';
import { assertWithinRate } from '../lib/rateLimit';
import { requireActor,assertStatus,assertVersion,latestBrief,catalogRows,currentCatalog,ledgerState,checked,same,type Actor,type Role } from './common';
import { appendEvents } from './events';
import { materializeDisclosures } from './sharedFacts';
import {assertDailyConstraintBucket} from './constraintRates';
import { withConstraintChange } from './constraints';
export type ConfirmArgs={roomId:Id<'rooms'>;expectedConstraintsVersion:number;hardFields:Doc<'briefs'>['hardFields'];softFields:Doc<'briefs'>['softFields'];disclosures:Doc<'briefs'>['disclosures']};
export async function insertBriefVersion(tx:RoomTx,actor:Actor,args:{role:Role;hardFields:Doc<'briefs'>['hardFields'];softFields:Doc<'briefs'>['softFields'];disclosures:Doc<'briefs'>['disclosures'];source:Doc<'briefs'>['source'];humanRequestId?:Id<'humanRequests'>}) {
  if(args.source==='soft_update'&&!validateNotes(args.softFields.notes).ok)throw appError('input.invalid',{field:'notes'});
  const state=eventWriteContext(tx),old=await latestBrief({db:state.db} as import('../_generated/server').QueryCtx,tx.room._id,args.role);
  const id=await tx.insert('briefs',{roomId:tx.room._id,...args,version:(old?.version??0)+1,confirmedBy:actor.userId,confirmedAt:state.createdAt,provenance:tx.room.provenance});
  return (await state.db.get(id))!;
}
export async function confirmCore(ctx:MutationCtx,actor:Actor,args:ConfirmArgs,source:Doc<'briefs'>['source']='form',heldTx?:RoomTx,humanRequestId?:Id<'humanRequests'>) {
  const resolved=await requireActor(ctx,actor,args.roomId);let room=resolved.room;const member=resolved.member;assertStatus(room);
  const schemaKey=`scope_change.${member.role}.v1`;
  if(args.hardFields.schemaKey!==schemaKey||args.softFields.schemaKey!==schemaKey)throw appError('input.invalid',{field:'hardFields'});
  assertVersion(room,args.expectedConstraintsVersion);
  if(room.status==='setup'){if(todayInTimeZone(nowMs(ctx),room.timeZone)>room.localDate){heldTx??=await openRoomTx(ctx,room._id,{allow:['setup']});await rollLocalDateTx({...ctx,tx:heldTx},room._id,nowMs(ctx),true);room=(await ctx.db.get(room._id))!;}}
  const catalog=currentCatalog(await catalogRows(ctx,room._id)),ledger=await ledgerState(ctx,room._id);
  if(args.hardFields.schemaKey==='scope_change.customer.v1') {
    if (args.hardFields.requiredItemKeys.some(key=>!ITEM_KEY_RE.test(key))) throw appError('input.invalid',{field:'requiredItemKeys'});
    if (args.softFields.schemaKey==='scope_change.customer.v1' && args.softFields.preferredItemKeys.some(key=>!ITEM_KEY_RE.test(key))) throw appError('input.invalid',{field:'preferredItemKeys'});
    checked(validateRequiredItemKeys(args.hardFields.requiredItemKeys,catalog,{allowRetired:true}), 'requiredItemKeys');
    checked(validateDeadline(args.hardFields.deadline,isoDate(room.localDate)), 'deadline');
    if(args.softFields.schemaKey==='scope_change.customer.v1')checked(validatePreferredItemKeys(args.softFields.preferredItemKeys,args.hardFields.requiredItemKeys,catalog,{allowRetired:true}));
  }
  if(args.hardFields.schemaKey==='scope_change.finance.v1')checked(validateCapCents(args.hardFields.capCents,cents(0)));
  checked(validateNotes(args.softFields.notes));
  const fields=scenarioOf(room).fields;
  for(const [key,audience]of Object.entries(args.disclosures)) {
    const field=fields.find(f=>f.key===key&&f.owner===member.role&&f.class!=='note'&&f.disclosableTo.length);
    if(!field||audience.some(role=>!field.disclosableTo.includes(role)||role===member.role))throw appError('input.invalid',{field:'disclosures'});
  }
  if(args.hardFields.schemaKey==='scope_change.finance.v1'&&args.hardFields.capCents<ledger.committedCents)throw appError('budget.below_committed',{minAllowedCapCents:ledger.committedCents});
  const softFields={...args.softFields,notes:args.softFields.notes.normalize('NFC')};
  const disclosures=Object.fromEntries(Object.entries(args.disclosures).sort(([a],[b])=>a.localeCompare(b)).map(([key,roles])=>[key,[...new Set(roles)].sort()]));
  const old=await latestBrief(ctx,room._id,member.role);
  if(old&&same(old.hardFields,args.hardFields)&&same(old.softFields,softFields)&&same(old.disclosures,disclosures))return {status:'unchanged' as const,version:old.version,constraintsVersion:room.constraintsVersion,bumped:false};
  await assertWithinRate(ctx,{kind:'constraint_writes',roomId:room._id,actorUserId:actor.userId});
  if(!old||canonicalJson(old.hardFields)!==canonicalJson(args.hardFields))await assertDailyConstraintBucket(ctx,room,'hard_fields');
  const tx=heldTx??await openRoomTx(ctx,room._id,{allow:['setup','open']});
  const sourceRefs:Doc<'constraintRevisions'>['sourceRefs']=humanRequestId?[{kind:'humanRequest',humanRequestId}]:[];
  return await withConstraintChange({...ctx,tx},room._id,{cause:humanRequestId?'human_answer':'brief_confirmed',sourceRefs,actorUserId:actor.userId},async()=>{
    const brief=await insertBriefVersion(tx,actor,{role:member.role,hardFields:args.hardFields,softFields,disclosures,source,...(humanRequestId?{humanRequestId}:{})});
    sourceRefs.push({kind:'brief',briefId:brief._id,role:member.role,version:brief.version});
    await materializeDisclosures(ctx,tx,brief,actor);
    await appendEvents(tx,[{payload:{type:'brief_confirmed',role:member.role,version:brief.version,hardChanged:!old||canonicalJson(old.hardFields)!==canonicalJson(args.hardFields)},actor:{kind:'user',role:member.role},actorUserId:actor.userId,restrictedRef:{table:'briefs',id:brief._id}}]);
    return {status:'confirmed' as const,version:brief.version,constraintsVersion:room.constraintsVersion,bumped:false};
  });
}
export async function setCapCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;capCents:number;expectedConstraintsVersion:number}) {
  const {room}=await requireActor(ctx,actor,args.roomId,['finance']);assertStatus(room);assertVersion(room,args.expectedConstraintsVersion);
  const brief=await latestBrief(ctx,room._id,'finance');
  if(!brief)throw appError('run.invalid_state',{guard:'brief_missing'});
  return await confirmCore(ctx,actor,{roomId:room._id,expectedConstraintsVersion:args.expectedConstraintsVersion,hardFields:{schemaKey:'scope_change.finance.v1',capCents:args.capCents},softFields:brief.softFields,disclosures:brief.disclosures},'set_cap');
}
