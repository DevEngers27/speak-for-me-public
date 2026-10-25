import type { Id } from '../_generated/dataModel';
import { appendLedgerEntry } from './ledger';
import { appError } from '../lib/errors';
import { ApprovalInvariantError, ExecutionPlanError, isCurrentForApproval, evaluateApprovalSet, computeChangeOrderChain, planExecutionRecords, inheritProvenance } from '@core/engine';
import { publicOpsLog } from '../lib/opsLog';
import { approvalRows, approvalVerdict, loadRuleInput, appendEvent, asEngineProposal, currentApprovalInput, type Role, type Tx } from './approvalHelpers';

/** Only approvals.record calls this helper. All writes share the final approval mutation. */
export async function executeIfComplete(tx: Tx, args: { proposalId: Id<'proposals'>; actorUserId: Id<'users'> }): Promise<{ status: 'not_complete'; missingRoles: Role[] } | { status: 'executed'; executionId: Id<'executions'> }> {
  try { return await executeRecords(tx, args); }
  catch (error) {
    if (error instanceof ApprovalInvariantError || error instanceof ExecutionPlanError) failInvariant('invariant.guard_bypassed');
    throw error;
  }
}
function failInvariant(code: 'invariant.room_already_executed' | 'invariant.duplicate_execution' | 'invariant.guard_bypassed'): never {
  publicOpsLog(code, { fn: 'approvals.record' });
  throw appError('internal');
}
async function executeRecords(tx: Tx, args: { proposalId: Id<'proposals'>; actorUserId: Id<'users'> }): ReturnType<typeof executeIfComplete> {
  const { ctx, now } = tx;
  // X0: reread independently, including the approval just inserted in this transaction.
  const room = await ctx.db.get(tx.room._id);
  const proposal = await ctx.db.get(args.proposalId);
  const run = room?.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (!room || !proposal || proposal.roomId !== room._id || !run || run.roomId !== room._id || !isCurrentForApproval(currentApprovalInput(room, run, proposal))) failInvariant('invariant.guard_bypassed');
  await loadRuleInput(ctx, room);
  const rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
  const members = (await Promise.all(proposal.requiredApprovals.map(req => ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id).eq('role', req.role)).take(2)))).flat();
  const set = evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: approvalRows(rows), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
  if (!set.complete) return { status: 'not_complete', missingRoles: set.missingRoles as Role[] };
  const loaded = await approvalVerdict(ctx, room, proposal, 'finance');
  if (!loaded.scenario || loaded.input.capCents === undefined) failInvariant('invariant.guard_bypassed');
  if ((await ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', room._id)).take(1)).length) failInvariant('invariant.room_already_executed');
  const executionKey = `exec:${proposal._id}`;
  if ((await ctx.db.query('executions').withIndex('by_executionKey', q => q.eq('executionKey', executionKey)).take(1)).length) failInvariant('invariant.duplicate_execution');
  const result = computeChangeOrderChain({ entries: loaded.ledgerEntries, deltaCents: proposal.terms.amountCents, capCents: loaded.input.capCents });
  if (!result.ok) failInvariant('invariant.guard_bypassed');
  const plan = planExecutionRecords(asEngineProposal(proposal), result.chain);
  const sources = [room.provenance, proposal.provenance, ...loaded.catalogItems.filter(r => proposal.lines.some(l => l.itemKey === r.itemKey && l.revision === r.revision)).map(r => r.provenance)];
  const provenance = inheritProvenance(...sources);
  let number = 1;
  if (room.followsExecutionId) {
    const previous = await ctx.db.query('changeOrders').withIndex('by_execution', q => q.eq('executionId', room.followsExecutionId!)).take(2);
    if (previous.length !== 1) failInvariant('invariant.guard_bypassed');
    number = previous[0]!.number + 1;
  }
  const chain = result.chain;
  if (!set.approvalIds) failInvariant('invariant.guard_bypassed');
  const executionId = await tx.roomTx.insert('executions', { roomId: room._id, runId: run._id, proposalId: proposal._id, proposalVersion: proposal.version, executionKey, constraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey, approvalIds: set.approvalIds as Id<'approvals'>[], executedByUserId: args.actorUserId, scenarioKey: room.scenarioKey, scenarioVersion: room.scenarioVersion, amountCents: plan.ledgerCommit.amountCents, committedBeforeCents: chain.amountBeforeCents, committedAfterCents: chain.amountAfterCents, capCentsAtExecution: chain.capCents, provenance, executedAt: now });
  await appendLedgerEntry(tx.roomTx, { userId: args.actorUserId, provenance }, { kind: 'commit', amountCents: plan.ledgerCommit.amountCents, executionId });
  await tx.roomTx.insert('changeOrders', { roomId: room._id, executionId, proposalId: proposal._id, proposalVersion: proposal.version, number, terms: proposal.terms, lines: proposal.lines, termsKey: proposal.termsKey, baselineCents: chain.baselineCents, priorApprovedDeltaCents: chain.priorApprovedDeltaCents, amountBeforeCents: chain.amountBeforeCents, deltaCents: chain.deltaCents, amountAfterCents: chain.amountAfterCents, constraintsVersion: room.constraintsVersion, ...(room.followsExecutionId ? { followsExecutionId: room.followsExecutionId } : {}), provenance, createdAt: now });
  for (const task of plan.tasks) {
    const { taskKeySuffix, ...data } = task;
    await tx.roomTx.insert('tasks', { ...data, assigneeRole: task.assigneeRole as Role, roomId: room._id, executionId, taskKey: `${executionId}:${taskKeySuffix}`, status: 'open', provenance, createdAt: now });
  }
  await tx.roomTx.patch('proposals', proposal._id, { status: 'executed', statusChangedAt: now });
  await tx.roomTx.patch('runs', run._id, { status: 'executed', endedReason: 'executed', endedAt: now, activeTurnSeq: null });
  await tx.roomTx.patch('rooms', room._id, { status: 'executed', executionId, executedAt: now });
  const openRequests = await ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', room._id).eq('status', 'open')).collect();
  if (openRequests.length) publicOpsLog('invariant.open_request_at_execution', { fn: 'approvals.record' });
  for (const request of openRequests) await tx.roomTx.patch('humanRequests', request._id, { status: 'superseded', closedReason: 'regenerated', closedAt: now });
  await appendEvent(tx, { type: 'proposal_status_changed', proposalVersion: proposal.version, to: 'executed' }, undefined, undefined, { runId: run._id, proposalId: proposal._id, executionId });
  await appendEvent(tx, { type: 'run_ended', runNo: run.runNo, status: 'executed', endedReason: 'executed' }, undefined, undefined, { runId: run._id });
  await appendEvent(tx, { type: 'room_executed', proposalVersion: proposal.version, amountCents: proposal.terms.amountCents, taskCount: plan.tasks.length, changeOrderNumber: number }, undefined, { table: 'executions', id: executionId }, { runId: run._id, proposalId: proposal._id, executionId });
  return { status: 'executed', executionId };
}
