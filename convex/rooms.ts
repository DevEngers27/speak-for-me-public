import {nowMs} from './lib/time';
// W2-1: room creation/setup close and owned query sections.
import {v} from 'convex/values';
import {paginationOptsValidator,paginationResultValidator} from 'convex/server';
import {userMutation,memberMutation,memberQuery,userQuery,type MemberCtx} from './lib/functions';
import {roleV} from './lib/validators';
import {createCore,closeCore} from './model/rooms';
import {roomViewV,toRoomView,inboxCardV,toInboxCard} from './model/views/roomView';
export const create=userMutation('rooms.create')({args:{title:v.string(),scenarioKey:v.literal('scope_change'),timeZone:v.string(),myRole:roleV},returns:v.object({roomId:v.id('rooms')}),handler:async(ctx,args)=>await createCore(ctx,{userId:ctx.viewer.userId},args)});
export const close=memberMutation('rooms.close')({args:{roomId:v.id('rooms')},returns:v.object({status:v.union(v.literal('closed'),v.literal('unchanged'))}),creatorOnly:true,handler:async(ctx,args)=>await closeCore(ctx,{userId:ctx.viewer.userId},args)});
export const view=memberQuery('rooms.view')({args:{roomId:v.id('rooms')},returns:v.union(v.null(),roomViewV),handler:async ctx=>await toRoomView(ctx)});
export const listMine=userQuery('rooms.listMine')({args:{paginationOpts:paginationOptsValidator},returns:v.union(v.null(),paginationResultValidator(inboxCardV)),handler:async(ctx,args)=>{
 const members=await ctx.db.query('members').withIndex('by_user',q=>q.eq('userId',ctx.viewer.userId)).order('desc').paginate(args.paginationOpts),cards=[];
 for(const member of members.page){const room=await ctx.db.get(member.roomId);if(!room)continue;const memberCtx:MemberCtx={...ctx,room,member:{memberId:member._id,role:member.role,isCreator:room.createdBy===ctx.viewer.userId}};cards.push(await toInboxCard(memberCtx));}
 return {page:cards,isDone:members.isDone,continueCursor:members.continueCursor};
}});
// End W2-1.

// W2-2: follow-up uses the shared authenticated boundary.
import {startFollowUpCore} from './model/followUp';
export const startFollowUp=memberMutation('rooms.startFollowUp')({args:{executionId:v.id('executions')},returns:v.object({roomId:v.id('rooms'),created:v.boolean()}),handler:async(ctx,{executionId})=>{const member=await ctx.db.get(ctx.member.memberId);if(!member)throw new Error('Missing member');return startFollowUpCore(ctx,member,executionId);}});
// W2-3: owned preview endpoint; creation/view remain W2-1's real endpoints.
import {changeV,previewResultV,previewChange as preview} from './model/constraintReads';
export const previewChange=memberQuery('rooms.previewChange')({args:{roomId:v.id('rooms'),change:changeV},returns:previewResultV,handler:preview});

// W2-4: operational close.
import {assertTier} from './lib/config';
import {forceCloseOpsLog} from './lib/opsLog';
import {sysMutation} from './lib/functions';
import {openRoomTx,setStatus,appendEvents} from './model/runtimeTx';
import {disposeCurrentRun} from './model/runs';
export const forceClose = sysMutation('rooms.forceClose')({ args: { roomId: v.id('rooms'), reason: v.string() }, returns: v.object({ status: v.union(v.literal('closed'), v.literal('unchanged')) }), handler: async (ctx, { roomId }) => {
  await assertTier(ctx, ['dev', 'preview', 'prod', 'test']);
  const room = await ctx.db.get(roomId);
  if (!room || room.status === 'closed' || room.status === 'executed') return { status: 'unchanged' as const };
  const tx = await openRoomTx(ctx, roomId, ['setup', 'open']);
  await disposeCurrentRun(tx, 'room_closed');
  await setStatus(tx, { table: 'rooms', id: roomId, patch: { status: 'closed', closedAt: nowMs(ctx) } });
  await appendEvents(tx, [{ type: 'room_closed', by: 'ops' }]);
  forceCloseOpsLog(ctx.log, roomId);
  return { status: 'closed' as const };
} });
