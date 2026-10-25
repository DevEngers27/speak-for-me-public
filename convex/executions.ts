import { v } from 'convex/values';
import { memberQuery, sysQuery } from './lib/functions';
import { findRoomFindings } from './model/roomSnapshot';
import { buildExecutionView, executionViewV } from './model/views/roomView';
export const forRoom = memberQuery('executions.forRoom')({ args: { roomId: v.id('rooms') }, returns: v.union(v.null(), executionViewV), handler: async (ctx, { roomId }) => {
  const member = await ctx.db.get(ctx.member.memberId);
  if (!member) return null;
  return buildExecutionView(ctx, roomId, member);
} });
const findingV = v.object({ code: v.union(...(['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11'] as const).map(c => v.literal(c))), check: v.string(), ref: v.optional(v.object({ table: v.string(), id: v.string() })) });
export const checkInvariants = sysQuery('executions.checkInvariants')({ args: { roomId: v.id('rooms') }, returns: v.array(findingV), handler: async (ctx, { roomId }) => {
  return findRoomFindings(ctx, roomId);
} });
