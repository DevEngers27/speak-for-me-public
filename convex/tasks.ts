import { v } from 'convex/values';
import { memberMutation } from './lib/functions';
import { openRoomTx, eventWriteContext } from './lib/db';
import { appendEvents } from './model/events';
import { appError } from './lib/errors';

export const markDone = memberMutation('tasks.markDone')({
  args: { taskId: v.id('tasks') },
  returns: v.object({ status: v.union(v.literal('done'), v.literal('unchanged')) }),
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    const member = { role: ctx.member.role, userId: ctx.viewer.userId };
    if (!task) throw appError('auth.not_member');
    if (task.assigneeRole !== member.role) throw appError('auth.role_forbidden');
    if (task.status === 'done') return { status: 'unchanged' as const };
    const tx = await openRoomTx(ctx, task.roomId, { allow: ['executed'] });
    await tx.patch('tasks', taskId, { status: 'done', doneByUserId: member.userId, doneAt: eventWriteContext(tx).createdAt });
    await appendEvents(tx, [{ payload: { type: 'task_completed', taskKey: task.taskKey }, actor: { kind: 'user', role: member.role }, actorUserId: member.userId }]);
    return { status: 'done' as const };
  },
});
