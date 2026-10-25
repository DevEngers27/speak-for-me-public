import { openRoomTx, assertWithinRate, appendEvents } from './model/runtimeTx';
import { roomReadiness } from './model/runtimeSources';
import { v } from 'convex/values';
import { sysMutation } from './lib/functions';
import { runStatusV } from './lib/validators';
import { appError } from './lib/errors';
import {memberMutation} from './lib/functions';
import { startRunTx, terminalRun, draining, disposeCurrentRun, reconcileRun, decideReconcile } from './model/runs';
import { applyHumanAnswer, prepareHumanAnswer } from './model/humanRequests';
export const start = memberMutation('runs.start')({
  args: { roomId: v.id('rooms') }, returns: v.object({ runId: v.id('runs'), created: v.boolean(), status: runStatusV }),
  handler: async (ctx, { roomId }) => {
    const m = {room:ctx.room,role:ctx.member.role,user:{_id:ctx.viewer.userId}};
    if (m.room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
    const current = m.room.currentRunId ? await ctx.db.get(m.room.currentRunId) : null;
    if (current && !terminalRun(current)) return { runId: current._id, created: false, status: current.status };
    if (!(await roomReadiness(ctx, roomId)).ready) throw appError('run.invalid_state', { guard: 'not_ready' });
    if (await draining(ctx)) throw appError('run.draining');
    await assertWithinRate(ctx, roomId, m.user._id, true);
    return startRunTx(await openRoomTx(ctx, roomId, ['open'], m.user._id), { cause: 'manual_start', origin: 'user' });
  },
});
export const cancel = memberMutation('runs.cancel')({
  creatorOnly:true, args: { runId: v.id('runs') }, returns: v.object({ status: v.union(v.literal('canceled'), v.literal('unchanged')) }),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    const m = {room:ctx.room,role:ctx.member.role,user:{_id:ctx.viewer.userId}};
    if (m.room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
    if (!run || m.room.currentRunId !== runId) throw appError('run.invalid_state', { guard: 'run_changed' });
    if (terminalRun(run)) return { status: 'unchanged' as const };
    await disposeCurrentRun(await openRoomTx(ctx, m.room._id, ['open'], m.user._id), 'canceled_by_creator');
    return { status: 'canceled' as const };
  },
});
export const requestRenegotiation = memberMutation('runs.requestRenegotiation')({
  creatorOnly:true, args: { roomId: v.id('rooms'), expectedRunId: v.id('runs') }, returns: v.object({ runId: v.id('runs'), status: runStatusV }),
  handler: async (ctx, { roomId, expectedRunId }) => {
    const m = {room:ctx.room,role:ctx.member.role,user:{_id:ctx.viewer.userId}};
    if (m.room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
    if (m.room.currentRunId !== expectedRunId) throw appError('run.invalid_state', { guard: 'run_changed' });
    const run = await ctx.db.get(expectedRunId);
    if (!run || !['pending_approval', 'needs_input'].includes(run.status)) throw appError('run.invalid_state', { guard: 'run_status' });
    if (await draining(ctx)) throw appError('run.draining');
    await assertWithinRate(ctx, roomId, m.user._id);
    const tx = await openRoomTx(ctx, roomId, ['open'], m.user._id);
    await appendEvents(tx, [{ type: 'run_renegotiation_requested', runNo: run.runNo }], { runId: run._id });
    await disposeCurrentRun(tx, 'renegotiation_requested');
    const next = await startRunTx(tx, { cause: 'renegotiation_requested', origin: 'user' });
    return { runId: next.runId, status: next.status };
  },
});
export const retryTurn = memberMutation('runs.retryTurn')({
  args: { runId: v.id('runs') }, returns: v.object({ attemptId: v.union(v.id('attempts'), v.null()) }),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    const m = {room:ctx.room,role:ctx.member.role,user:{_id:ctx.viewer.userId}};
    if (!run || m.room.currentRunId !== runId || run.status !== 'needs_input') throw appError('run.invalid_state', { guard: 'run_status' });
    const request = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'open')).unique();
    const option = request?.options.find(o => o.effect.type === 'retry_turn');
    if (!request || request.kind !== 'agent_failed' || !option) throw appError('run.invalid_state', { guard: 'no_failed_turn' });
    if (m.role !== request.toRole) throw appError('auth.role_forbidden');
    if (await draining(ctx)) throw appError('run.draining');
    const prepared = await prepareHumanAnswer(ctx, request, option.optionKey, m.role, m.user._id);
    if (!prepared) return { attemptId: null };
    const tx = await openRoomTx(ctx, m.room._id, ['open'], m.user._id);
    await applyHumanAnswer(tx, request, option.optionKey, m.role, prepared);
    const updated = (await ctx.db.get(runId))!;
    const turn = updated.activeTurnSeq === null ? null : await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId).eq('turnSeq', updated.activeTurnSeq!)).unique();
    const latest = turn && turn.currentAttemptNo > 0 ? await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id).eq('attemptNo', turn.currentAttemptNo)).unique() : null;
    return { attemptId: latest?.status === 'running' ? latest._id : null };
  },
});
export const reconcile = sysMutation('runs.reconcile')({ args: { runId: v.id('runs'), why: v.optional(v.string()) }, returns: v.union(...(['noop', 'repaired', 'redispatched', 'replaced', 'needs_input', 'advanced'] as const).map(s => v.literal(s))), handler: async (ctx, { runId }) => {
  if (await decideReconcile(ctx, runId) === 'noop') return 'noop' as const;
  const run = await ctx.db.get(runId);
  const room = run ? await ctx.db.get(run.roomId) : null;
  if (!room) return 'noop' as const;
  return reconcileRun(await openRoomTx(ctx, room._id, [room.status]), runId);
} });
