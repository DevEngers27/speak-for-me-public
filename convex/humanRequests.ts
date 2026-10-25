import {nowMs} from './lib/time';
import { setStatus, openRoomTx, appendEvents } from './model/runtimeTx';
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import type { Id } from './_generated/dataModel';
import { sysMutation } from './lib/functions';
import {memberMutation} from './lib/functions';
import { applyHumanAnswer, prepareHumanAnswer } from './model/humanRequests';
import { disposeCurrentRun } from './model/runs';
const effectTypeV = v.union(...(['raise_cap', 'drop_items', 'extend_deadline', 'choose_candidate', 'disclose', 'retry_turn', 'pass_to_next', 'keep_as_is', 'end_run'] as const).map(t => v.literal(t)));
export const answer = memberMutation('humanRequests.answer')({ returns: v.union(v.object({ outcome: v.literal('applied'), effect: effectTypeV, constraintsVersion: v.number(), runId: v.union(v.id('runs'), v.null()), proposalId: v.union(v.id('proposals'), v.null()) }), v.object({ outcome: v.literal('regenerated'), requestId: v.id('humanRequests') }), v.object({ outcome: v.literal('already_answered') })), args: { requestId: v.id('humanRequests'), optionKey: v.string() }, handler: async (ctx, { requestId, optionKey }) => {
  const request = await ctx.db.get(requestId);
  const m = {room:ctx.room,role:ctx.member.role,user:{_id:ctx.viewer.userId}};
  const prepared = await prepareHumanAnswer(ctx, request!, optionKey, m.role, m.user._id);
  if (!prepared) return { outcome: 'already_answered' as const };
  const tx = await openRoomTx(ctx, m.room._id, ['open'], m.user._id);
  return applyHumanAnswer(tx, request!, optionKey, m.role, prepared);
} });
const expireRef = makeFunctionReference<'mutation', { requestId: Id<'humanRequests'> }, null>('humanRequests:expireDue');
export const expireDue = sysMutation('humanRequests.expireDue')({ args: { requestId: v.optional(v.id('humanRequests')) }, returns: v.null(), handler: async (ctx, { requestId }) => {
  if (!requestId) {
    const due = await ctx.db.query('humanRequests').withIndex('by_status_expiresAt', q => q.eq('status', 'open').lte('expiresAt', nowMs(ctx))).take(100);
    for (const request of due) await ctx.scheduler.runAfter(0, expireRef, { requestId: request._id });
    return null;
  }
  const request = await ctx.db.get(requestId);
  if (!request || request.status !== 'open' || request.expiresAt > nowMs(ctx)) return null;
  const room = await ctx.db.get(request.roomId);
  if (!room) return null;
  const tx = await openRoomTx(ctx, room._id, [room.status]);
  await setStatus(tx, { table: 'humanRequests', id: request._id, patch: { status: 'expired', closedAt: nowMs(ctx) } });
  const run = await ctx.db.get(request.runId);
  if (run) await appendEvents(tx, [{ type: 'human_request_closed', runNo: run.runNo, status: 'expired' }], { runId: run._id }, { table: 'humanRequests', id: request._id });
  if (room.currentRunId === request.runId && run?.status === 'needs_input') await disposeCurrentRun(tx, 'request_expired');
  return null;
} });

import {memberQuery} from './lib/functions';
import {roleV,humanRequestStatusV} from './lib/validators';

import {privacy} from '../core/engine';
import {scenarioOf} from './scenarios/registry';
import {projectOpenRequestOptions,openRequestOptionV} from './model/views/requestOptions';
export const get=memberQuery('humanRequests.get')({
 room:'requestId',args:{requestId:v.id('humanRequests'),roomId:v.optional(v.id('rooms'))},
 returns:v.union(v.null(),v.object({mine:v.literal(true),requestId:v.id('humanRequests'),kind:v.string(),status:humanRequestStatusV,options:v.array(openRequestOptionV),answerOptionKey:v.union(v.string(),v.null()),closedReason:v.union(v.string(),v.null()),closedAtConstraintsVersion:v.union(v.number(),v.null()),expiresAt:v.number()}),v.object({mine:v.literal(false),requestId:v.id('humanRequests'),waitingOnRole:roleV,kind:v.string(),status:humanRequestStatusV}),v.object({mine:v.literal(false),kind:v.literal('run_waiting')})),
 handler:async(ctx,args)=>{
  const request=await ctx.db.get(args.requestId);
  if(!request||args.roomId&&request.roomId!==args.roomId)return null;
  const projected=privacy.projectForRole(ctx.member.role,{family:'humanRequests',data:{toRole:request.toRole,kind:request.kind,status:request.status}},{plugin:scenarioOf(ctx.room)})!;
  if(projected.kind==='run_waiting')return {mine:false as const,kind:'run_waiting' as const};
  if(projected.toRole!==ctx.member.role)return {mine:false as const,requestId:request._id,waitingOnRole:projected.toRole as typeof ctx.member.role,kind:String(projected.kind),status:request.status};
  return {mine:true as const,requestId:request._id,kind:String(projected.kind),status:request.status,
   options:projectOpenRequestOptions(ctx.member.role,request),
   answerOptionKey:request.answerOptionKey??null,closedReason:request.closedReason??null,closedAtConstraintsVersion:request.closedReason==='constraints_changed'?request.constraintsVersion+1:null,expiresAt:request.expiresAt};
 }
});
