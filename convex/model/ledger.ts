import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isCents, inheritProvenance } from '../../core/engine';
import { openRoomTx,eventWriteContext,type RoomTx } from '../lib/db';
import { appError } from '../lib/errors';
import { requireActor,assertStatus,ledgerState,latestBrief,type Actor } from './common';
import { materializeDisclosures } from './sharedFacts';
import { openIfReady } from './constraints';
import { appendEvents } from './events';
export async function appendLedgerEntry(tx:RoomTx,actor:Actor,args:{kind:'baseline'|'commit';amountCents:number;executionId?:Id<'executions'>}) {
  if(!isCents(args.amountCents))throw appError('amount.out_of_range',{field:'amountCents'});
  const state=eventWriteContext(tx);
  if(args.kind==='baseline'){
    assertStatus(tx.room,['setup']);
    if(args.executionId||await state.db.query('ledgerEntries').withIndex('by_room_kind',q=>q.eq('roomId',tx.room._id).eq('kind','baseline')).unique())throw appError('run.invalid_state',{guard:'baseline_exists'});
  }else if(!args.executionId)throw appError('internal');
  return await tx.insert('ledgerEntries',{roomId:tx.room._id,...args,recordedByUserId:actor.userId,provenance:inheritProvenance(tx.room.provenance,actor.provenance??'live'),createdAt:state.createdAt});
}
export async function recordBaselineCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;amountCents:number}) {
  const {room}=await requireActor(ctx,actor,args.roomId,['finance']);assertStatus(room,['setup']);
  if(!isCents(args.amountCents))throw appError('amount.out_of_range',{field:'amountCents'});
  const ledger=await ledgerState(ctx,room._id);
  if(ledger.baseline){if(ledger.baseline.amountCents===args.amountCents)return {status:'unchanged' as const,ledgerEntryId:ledger.baseline._id};throw appError('run.invalid_state',{guard:'baseline_exists'});}
  const brief=await latestBrief(ctx,room._id,'finance');
  if(brief?.hardFields.schemaKey==='scope_change.finance.v1'&&args.amountCents>brief.hardFields.capCents)throw appError('budget.below_committed',{minAllowedCapCents:args.amountCents});
  const tx=await openRoomTx(ctx,room._id,{allow:['setup']});
  const ledgerEntryId=await appendLedgerEntry(tx,actor,{kind:'baseline',amountCents:args.amountCents});
  if(brief)await materializeDisclosures(ctx,tx,brief,actor,'ledger');
  await appendEvents(tx,[{payload:{type:'baseline_recorded'},actor:{kind:'user',role:'finance'},actorUserId:actor.userId,restrictedRef:{table:'ledgerEntries',id:ledgerEntryId}}]);
  await openIfReady({...ctx,tx},tx.room._id,actor.userId);return {status:'recorded' as const,ledgerEntryId};
}
