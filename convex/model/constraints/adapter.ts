/** Caller-supplied lifecycle callbacks keep the constraint adapter acyclic. */
import { nowMs } from '../../lib/time';
import type { RoomCtx } from '../../lib/db';
import type { Id } from '../../_generated/dataModel';
import { hardProjection } from '@core/engine';
import { scenarioOf } from '../../scenarios/registry';
import { currentRunProposal, evaluateProposal, loadRuleInput } from '../constraintInput';
import { appendEvents } from '../events';
import { bindRoomTx } from '../runtimeTx';
import type { ConstraintTx } from './protocol';
import type * as Lifecycle from '../runs';
export type ConstraintLifecycle = Pick<typeof Lifecycle, 'openIfReady' | 'disposeCurrentRun' | 'startRunTx'>;
export function createConstraintTx(ctx:RoomCtx,roomId:Id<'rooms'>,lifecycle:ConstraintLifecycle):ConstraintTx{
  let revisionId:Id<'constraintRevisions'>|undefined;
  return{
    persistence:ctx,
    room:async()=>{const room=await ctx.db.get(roomId);if(!room)throw new Error('Missing room');return room;},
    hardProjection:async()=>hardProjection(scenarioOf(ctx.tx.room),await loadRuleInput(ctx,roomId)),
    openIfReady:async actor=>{await lifecycle.openIfReady(bindRoomTx(ctx,ctx.tx,actor??null));},
    disposeCurrentRun:()=>lifecycle.disposeCurrentRun(bindRoomTx(ctx,ctx.tx),'constraints_changed'),
    insertRevision:async row=>{revisionId=await ctx.tx.insert('constraintRevisions',{...row,roomId,createdAt:nowMs(ctx)});},
    patchVersion:async()=>{throw new Error('constraints.version_writer_only_bump');},
    appendChanged:async(fromVersion,toVersion)=>{await appendEvents(ctx.tx,[{payload:{type:'constraints_changed',fromVersion,toVersion},actor:{kind:'system'},restrictedRef:revisionId?{table:'constraintRevisions',id:revisionId}:undefined}]);},
    currentRun:async()=>(await currentRunProposal(ctx,roomId)).run,
    startRun:async args=>{await lifecycle.startRunTx(bindRoomTx(ctx,ctx.tx),args);},
    fixedPointSnapshot:async()=>{const room=(await ctx.db.get(roomId))!;const{run,proposal}=await currentRunProposal(ctx,roomId);return{room,run,proposals:await ctx.db.query('proposals').withIndex('by_room_version',q=>q.eq('roomId',roomId)).collect(),requests:await ctx.db.query('humanRequests').withIndex('by_room_status',q=>q.eq('roomId',roomId)).collect(),currentProposalPassesChecks:proposal?evaluateProposal(await loadRuleInput(ctx,roomId),{terms:{...proposal.terms,amountCents:proposal.terms.amountCents as import('../../../core/engine').Cents,deliveryDate:proposal.terms.deliveryDate as import('../../../core/engine').IsoDate},lines:proposal.lines.map(l=>({...l,priceCents:l.priceCents as import('../../../core/engine').Cents}))}).passesChecks:false};},
  };
}
