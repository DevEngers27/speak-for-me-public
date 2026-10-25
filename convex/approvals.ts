import { v } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { decisionV, roleV } from './lib/validators';
import { appError } from './lib/errors';
import { latestDecisionsByUser, isCurrentForApproval, evaluateApprovalSet, ApprovalInvariantError, ExecutionPlanError } from '@core/engine';
import { appendEvent, approvalRows, currentApprovalInput, scenarioOf, humanReasonKeys, approvalVerdict, onProposalRejected } from './model/approvalHelpers';
import { memberMutation } from './lib/functions';
import { openRoomTx, eventWriteContext } from './lib/db';
import { publicOpsLog } from './lib/opsLog';
import { executeIfComplete } from './model/executions';

export const approvalRecordArgs = { proposalId: v.id('proposals'), decision: decisionV, expectedConstraintsVersion: v.number(), expectedTermsKey: v.string(), reasonKey: v.union(v.string(), v.null()), note: v.union(v.string(), v.null()) };
export const approvalRecordResultV = v.union(
  v.object({ status: v.literal('recorded'), decision: decisionV, missingRoles: v.array(roleV) }),
  v.object({ status: v.literal('unchanged') }),
  v.object({ status: v.literal('executed'), executionId: v.id('executions'), alreadyExecuted: v.boolean() }),
);
export type DecisionArgs = { proposalId: Id<'proposals'>; decision: Doc<'approvals'>['decision']; expectedConstraintsVersion: number; expectedTermsKey: string; reasonKey: string | null; note: string | null };
export const MAX_WITHDRAWALS_PER_USER_PER_PROPOSAL = 10;
export const MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL = 60;

/** S0/S1 are performed at the public boundary; seed/probes reuse this exact body. */
export async function recordDecisionCore(ctx: MutationCtx, member: Doc<'members'>, args: DecisionArgs) {
  try { return await recordDecisionBody(ctx, member, args); }
  catch (error) {
    if (error instanceof ApprovalInvariantError || error instanceof ExecutionPlanError) {
      publicOpsLog('invariant.guard_bypassed', { fn: 'approvals.record' });
      throw appError('internal');
    }
    throw error;
  }
}
async function recordDecisionBody(ctx: MutationCtx, member: Doc<'members'>, args: DecisionArgs) {
  const proposal = await ctx.db.get(args.proposalId);
  if (!proposal || proposal.roomId !== member.roomId) throw appError('auth.not_member');
  const room = await ctx.db.get(proposal.roomId);
  if (!room) throw appError('auth.not_member');
  // S3 must precede room/current/version guards: replay remains valid after execution.
  if (proposal.status === 'executed') {
    if (args.decision !== 'approve') throw appError('approval.already_executed');
    const existing = await ctx.db.query('executions').withIndex('by_executionKey', q => q.eq('executionKey', `exec:${proposal._id}`)).take(2);
    if (existing.length !== 1 || existing[0]!.roomId !== room._id) { publicOpsLog('invariant.duplicate_execution', { fn: 'approvals.record' }); throw appError('internal'); }
    return { status: 'executed' as const, executionId: existing[0]!._id, alreadyExecuted: true };
  }
  if (room.status === 'executed') throw appError('approval.already_executed');
  if (room.status === 'setup') throw appError('approval.not_current');
  if (room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
  if (args.decision === 'approve' && !scenarioOf(room)) throw appError('run.invalid_state', { guard: 'scenario_version' });
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (!run || run.roomId !== room._id || !isCurrentForApproval(currentApprovalInput(room, run, proposal))) throw appError('approval.not_current');
  const required = proposal.requiredApprovals.find(r => r.role === member.role);
  if (!required) throw appError('auth.role_forbidden');
  if (args.expectedConstraintsVersion !== room.constraintsVersion || args.expectedTermsKey !== proposal.termsKey) throw appError('approval.stale', { currentConstraintsVersion: room.constraintsVersion });
  // S9 reject deliberately never reads the proposal-wide range.
  let rows: Doc<'approvals'>[] = [];
  let mine: Doc<'approvals'> | undefined;
  if (args.decision === 'reject') {
    mine = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id).eq('userId', member.userId)).order('desc').first() ?? undefined;
  } else if (args.decision === 'withdraw') {
    rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id).eq('userId', member.userId)).collect();
    mine = [...rows].sort((a,b) => b.seq - a.seq)[0];
  } else {
    rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
    const latest = latestDecisionsByUser(approvalRows(rows));
    const row = latest.get(member.userId);
    mine = row ? rows.find(r => r._id === row.id) : undefined;
  }
  const currentApprove = mine?.decision === 'approve' && mine.boundConstraintsVersion === room.constraintsVersion && mine.boundTermsKey === proposal.termsKey;
  const unchanged = args.decision === 'approve' && currentApprove;
  if (args.decision === 'withdraw' && !currentApprove) return { status: 'unchanged' as const };
  if (args.decision !== 'reject' && !unchanged) {
    const limit = args.decision === 'approve' ? MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL : MAX_WITHDRAWALS_PER_USER_PER_PROPOSAL;
    if (rows.filter(r => r.userId === member.userId && r.decision === args.decision).length >= limit) throw appError('run.rate_limited');
  }
  if (args.decision === 'reject' && mine?.decision === 'reject') { publicOpsLog('invariant.guard_bypassed', { fn: 'approvals.record' }); throw appError('internal'); }
  if (args.decision === 'reject' ? !humanReasonKeys.some(k => k.key === args.reasonKey) : args.reasonKey !== null) throw appError('input.invalid', { field: 'reasonKey' });
  const reasonDecl = humanReasonKeys.find(k => k.key === args.reasonKey);
  if (args.decision === 'reject' && reasonDecl && 'usableBy' in reasonDecl && !(reasonDecl.usableBy as readonly string[]).includes(member.role)) throw appError('auth.role_forbidden');
  if (args.note !== null && ([...args.note].length > 500 || /[\p{Cc}\p{Cf}]/u.test(args.note))) throw appError('input.invalid', { field: 'note' });
  // F3 / S10: incomplete replay is a read-only no-op, even if checks have changed.
  if (unchanged) {
    const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect();
    const set = evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: approvalRows(rows), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
    if (!set.complete) return { status: 'unchanged' as const };
  }
  if (args.decision === 'approve') await approvalVerdict(ctx, room, proposal, member.role);
  const roomTx = await openRoomTx(ctx, room._id, { allow: ['open'] });
  const tx = { ctx, room: roomTx.room, now: eventWriteContext(roomTx).createdAt, roomTx };
  if (!unchanged) {
    const reasonKey = args.reasonKey as Doc<'approvals'>['reasonKey'];
    const id = await roomTx.insert('approvals', { roomId: room._id, proposalId: proposal._id, runId: run._id, userId: member.userId, role: member.role, kind: required.kind, decision: args.decision, seq: (mine?.seq ?? 0) + 1, boundConstraintsVersion: room.constraintsVersion, boundTermsKey: proposal.termsKey, ...(reasonKey ? { reasonKey } : {}), ...(args.note !== null ? { note: args.note } : {}), decidedAt: tx.now });
    const publicReason = humanReasonKeys.find(k => k.key === reasonKey && k.audience === 'room');
    await appendEvent(tx, { type: 'approval_recorded', proposalVersion: proposal.version, role: member.role, decision: args.decision, boundConstraintsVersion: room.constraintsVersion, ...(publicReason ? { reasonKey: publicReason.key as 'terms_not_acceptable' | 'scope_insufficient' | 'needs_earlier_delivery' | 'other' } : {}) }, member, { table: 'approvals', id }, { runId: run._id, proposalId: proposal._id });
  }
  if (args.decision === 'reject') { await onProposalRejected(tx, run, proposal); return { status: 'recorded' as const, decision: args.decision, missingRoles: [] }; }
  if (args.decision === 'withdraw') {
    const [rows, members] = await Promise.all([
      ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect(),
      ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect(),
    ]);
    const set = evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: approvalRows(rows), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
    return { status: 'recorded' as const, decision: args.decision, missingRoles: set.missingRoles as Doc<'members'>['role'][] };
  }
  const result = await executeIfComplete(tx, { proposalId: proposal._id, actorUserId: member.userId });
  if (result.status === 'executed') return { ...result, alreadyExecuted: false };
  if (unchanged) return { status: 'unchanged' as const };
  return { status: 'recorded' as const, decision: args.decision, missingRoles: result.missingRoles };
}
export const record = memberMutation('approvals.record')({ args: approvalRecordArgs, returns: approvalRecordResultV, handler: async (ctx, args) => {
  const member = await ctx.db.get(ctx.member.memberId);
  if (!member) throw appError('auth.not_member');
  return recordDecisionCore(ctx, member, args);
} });
