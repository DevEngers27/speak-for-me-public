// W2-2: approval, execution and follow-up projections. Merge this block by union.
import { v, type Infer } from 'convex/values';
import {executionWhy} from './executionWhy';
import type { QueryCtx, MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { termsV } from '../../schema';
import { publicOpsLog } from '../../lib/opsLog';
import { roleV, decisionV, taskStatusV } from '../../lib/validators';
import { evaluateApprovalSet, isCurrentForApproval, latestDecisionsByUser, computeChangeOrderChain, planExecutionRecords, committedCents, checkProposal, privacy, publicText } from '@core/engine';
import { loadApprovalSet, approvalRows, asEngineProposal, loadRuleInput, currentApprovalInput, auditScenario } from '../approvalHelpers';

type ReadCtx = QueryCtx | MutationCtx;
const provenanceV = v.union(v.literal('live'), v.literal('seeded'), v.literal('stub'));
const numberOrNull = v.union(v.number(), v.null());
const stringOrNull = v.union(v.string(), v.null());
const approvalKindV = v.union(v.literal('terms'), v.literal('budget'));
const visibleLineV = v.object({ itemKey: v.string(), kind: v.union(v.literal('item'), v.literal('modifier')), title: v.string(), priceCents: v.number() });
const approvalsSnapshotV = v.array(v.object({ role: roleV, displayName: v.string(), decidedAt: v.number() }));
export const fitV = v.union(v.object({ audience: v.literal('provider'), value: v.union(v.literal('ok'), v.literal('blocked')) }), v.object({ audience: v.literal('buyer'), passesChecks: v.boolean(), checks: v.array(v.object({ code: v.string(), owner: v.union(v.literal('self'), v.literal('other')), text: v.string() })) }));
export const proposalCardV = v.object({
  proposalId: v.id('proposals'), version: v.number(), termsKey: v.string(), origin: v.string(), provenance: provenanceV, createdAtConstraintsVersion: v.number(),
  terms: termsV, lines: v.array(visibleLineV), summaryText: v.string(), status: v.optional(v.string()),
  diffFromPrevious: v.union(v.null(), v.object({ previousVersion: v.number(), changes: v.array(v.string()) })),
  fit: v.optional(v.union(fitV, v.null())), notIncludedForMe: v.union(v.array(v.string()), v.null()),
  approvals: v.array(v.object({ role: roleV, kind: approvalKindV, displayName: v.string(), isMe: v.boolean(), state: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'), v.literal('stale_approve'), v.literal('stale_reject'), v.literal('withdrawn')), boundConstraintsVersion: numberOrNull, reasonKey: stringOrNull })),
  allApproved: v.boolean(), myAction: v.object({ canDecide: v.boolean(), kind: approvalKindV, disabledReasonCode: stringOrNull, current: v.union(decisionV, v.null()), completesSet: v.boolean(), canWithdraw: v.boolean() }),
  recordsPreview: v.object({ changeOrderNumber: v.number(), taskCount: v.number(), myTaskTitles: v.array(v.string()), commitCents: v.number() }),
  myAgentSuggestion: v.union(v.null(), v.object({ action: v.string(), proposalVersion: numberOrNull, rationale: v.string(), isSimulated: v.boolean() })),
});
export const proposalDetailV = v.object({ card: proposalCardV, decisions: v.array(v.object({ role: roleV, decision: decisionV, decidedAt: v.number(), boundConstraintsVersion: v.number(), reasonKey: stringOrNull, isMe: v.boolean(), note: stringOrNull })) });
export const executionViewV = v.object({ executionId: v.id('executions'), proposalVersion: v.number(), constraintsVersion: v.number(), executedAt: v.number(), provenance: provenanceV, approvalsSnapshot: approvalsSnapshotV,
  changeOrder: v.object({ number: v.number(), terms: termsV, lines: v.array(visibleLineV), amountChain: v.union(v.null(), v.object({ baselineCents: numberOrNull, approvedToDateCents: numberOrNull, committedBeforeCents: numberOrNull, thisChangeCents: v.number(), committedAfterCents: numberOrNull, capCentsAtExecution: numberOrNull, headroomAfterCents: numberOrNull })) }),
  tasks: v.array(v.object({ taskId: v.id('tasks'), taskKey: v.string(), title: v.string(), assigneeRole: roleV, dueDate: v.string(), status: taskStatusV, canMarkDone: v.boolean() })),
  whyChain: v.array(v.object({step:v.string(),constraintsVersion:numberOrNull,proposalVersion:numberOrNull,text:v.string(),href:stringOrNull})),
});
const budgetV = v.union(v.object({ visibility: v.literal('none') }), v.object({ visibility: v.literal('customer'), capCents: numberOrNull, committedCents: numberOrNull, headroomCents: numberOrNull }),
  v.object({ visibility: v.literal('finance'), capCents: numberOrNull, committedCents: v.number(), headroomCents: numberOrNull, baselineRecorded: v.boolean(), baselineSuggestionCents: numberOrNull, proposalCents: numberOrNull, totalAfterCents: numberOrNull, overByCents: numberOrNull, status: v.union(v.literal('within'), v.literal('over'), v.literal('no_proposal')) }));
const factValueV = v.union(v.object({ kind: v.literal('date'), date: v.string() }), v.object({ kind: v.literal('itemKeys'), itemKeys: v.array(v.string()) }), v.object({ kind: v.literal('cents'), cents: v.number() }), v.object({ kind: v.literal('enum'), value: v.string() }));
export const roomViewV = v.object({
  header: v.object({ roomId: v.id('rooms'), title: v.string(), scenarioKey: v.string(), status: v.string(), phase: v.string(), constraintsVersion: v.number(), proposalVersion: numberOrNull, viewingAs: roleV, isCreator: v.boolean(), provenanceBadge: provenanceV }),
  members: v.array(v.object({ role: roleV, displayName: v.string(), isMe: v.boolean(), joinedVia: v.string(), briefConfirmed: v.boolean(), briefVersion: numberOrNull })),
  seats: v.union(v.null(), v.array(v.object({ role: roleV, state: v.union(v.literal('filled'), v.literal('invited'), v.literal('empty')), inviteMode: v.union(v.literal('email'), v.literal('link'), v.null()), invitedEmail: stringOrNull, inviteExpiresAt: numberOrNull }))),
  todos: v.array(v.object({ kind: v.string(), priority: v.number(), refs: v.object({ proposalId: v.optional(v.id('proposals')), proposalVersion: v.optional(v.number()), requestId: v.optional(v.id('humanRequests')), runId: v.optional(v.id('runs')) }) })),
  catalog: v.array(v.object({ itemKey: v.string(), kind: v.union(v.literal('item'), v.literal('modifier')), title: v.string(), priceCents: v.number(), leadDays: v.number(), revision: v.number() })),
  sharedFacts: v.array(v.object({ fromRole: roleV, field: v.string(), value: factValueV, asOfBriefVersion: v.number() })), budget: budgetV,
  currentProposal: v.union(v.null(), proposalCardV), proposalHistory: v.array(v.object({ proposalId: v.id('proposals'), version: v.number(), status: v.string(), amountCents: v.number(), deliveryDate: v.string(), createdAtConstraintsVersion: v.number() })),
  run: v.union(v.null(), v.object({ runId: v.id('runs'), runNo: v.number(), status: v.string(), roundNo: v.number(), maxRounds: v.number(), activeRole: v.union(roleV, v.null()), attemptStatus: stringOrNull, waiting: v.union(v.literal('backoff'),v.literal('spend_deferred'),v.literal('draining'),v.literal('run_cap'),v.null()), staleDiscarded: v.number(), cause: v.string(), endedReason: stringOrNull, agentMode: v.union(v.literal('live'),v.literal('stub')) })),
  execution: v.union(v.null(), v.object({ executionId: v.id('executions'), proposalVersion: v.number(), executedAt: v.number(), changeOrderNumber: v.number(), approvalsSnapshot: approvalsSnapshotV, followUpRoomId: v.union(v.id('rooms'), v.null()) })),
  followUpOf: v.union(v.null(), v.object({ previousRoomId: v.id('rooms'), changeOrderNumber: v.number(), deliveredItems: v.array(v.object({ itemKey: v.string(), title: v.string() })) })),
});
export const inboxCardV = v.object({ roomId: v.id('rooms'), title: v.string(), myRole: roleV, status: v.string(), phase: v.string(), inboxSection: v.union(v.literal('needs_you'), v.literal('agents_working'), v.literal('waiting'), v.literal('done')), topTodo: v.union(v.null(), v.object({ kind: v.string(), proposalVersion: numberOrNull, constraintsVersion: v.number() })), waitingOn: v.union(v.array(roleV), v.literal('others'), v.null()), notice: v.union(v.null(), v.literal('approval_no_longer_applies'), v.literal('request_closed')), provenanceBadge: provenanceV, updatedAt: v.number() });

function visibleLine(line: Doc<'proposals'>['lines'][number]) { return { itemKey: line.itemKey, kind: line.kind, title: line.title, priceCents: line.priceCents }; }
function reasonFor(row: Doc<'approvals'> | undefined, member: Doc<'members'>) { return row?.reasonKey && !(member.role === 'provider' && row.reasonKey === 'over_our_limit') ? row.reasonKey : null; }
async function signatures(ctx: ReadCtx, execution: Doc<'executions'>, members: Doc<'members'>[]) {
  const rows = await Promise.all(execution.approvalIds.map(id => ctx.db.get(id)));
  return rows.flatMap(row => row ? [{ role: row.role, displayName: members.find(m => m.userId === row.userId)?.displayName ?? row.role, decidedAt: row.decidedAt }] : []);
}
async function latestFacts(ctx: ReadCtx, roomId: Id<'rooms'>) {
  const all = await ctx.db.query('sharedFacts').withIndex('by_room_from_field', q => q.eq('roomId', roomId)).collect();
  const latest = new Map<string, Doc<'sharedFacts'>>();
  for (const row of all) {
    const key = `${row.fromRole}:${row.field}`;
    if (!latest.has(key) || latest.get(key)!.seq < row.seq) latest.set(key, row);
  }
  return Array.from(latest.values());
}
export async function buildExecutionView(ctx: ReadCtx, roomId: Id<'rooms'>, member: Doc<'members'>): Promise<Infer<typeof executionViewV> | null> {
  const execution = await ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', roomId)).unique();
  if (!execution) return null;
  const order = await ctx.db.query('changeOrders').withIndex('by_execution', q => q.eq('executionId', execution._id)).unique();
  if (!order) return null;
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', roomId)).collect();
  const tasks = await ctx.db.query('tasks').withIndex('by_execution', q => q.eq('executionId', execution._id)).collect();
  // Replay source references rather than inferring version membership from wall-clock ties.
  const revisions = await ctx.db.query('constraintRevisions').withIndex('by_room_version', q => q.eq('roomId', roomId).lte('version', execution.constraintsVersion)).collect();
  const activeBriefs = new Map<Doc<'members'>['role'], { briefId: Id<'briefs'>; version: number }>();
  for (const revision of revisions.sort((a,b) => a.version - b.version)) {
    for (const ref of revision.sourceRefs) if (ref.kind === 'brief') activeBriefs.set(ref.role, ref);
  }
  const financeRef = activeBriefs.get('finance');
  const financeBrief = financeRef ? await ctx.db.get(financeRef.briefId) : null;
  const financeVersion = financeBrief?.roomId === roomId && financeBrief.role === 'finance' && financeBrief.version === financeRef?.version ? financeBrief.version : null;
  const allFacts = await ctx.db.query('sharedFacts').withIndex('by_room_from_field', q => q.eq('roomId', roomId)).collect();
  const historicalFacts = financeVersion === null ? [] : allFacts.filter(row => row.fromRole === 'finance' && row.briefVersion === financeVersion && row.createdAt <= execution.executedAt);
  const projectedFacts = privacy.projectSharedFacts(member.role, historicalFacts, financeVersion ?? undefined, auditScenario);
  const shared = (field: string) => projectedFacts.some(row => row.fromRole === 'finance' && row.field === field);
  const canSeeCommitted = member.role === 'finance' || shared('committedCents');
  const canSeeCap = member.role === 'finance' || shared('capCents');
  const canSeeHeadroom = member.role === 'finance' || shared('headroomCents');
  const room = await ctx.db.get(roomId);
  if (!room) return null;
  return { executionId: execution._id, proposalVersion: execution.proposalVersion, constraintsVersion: execution.constraintsVersion, executedAt: execution.executedAt, provenance: execution.provenance,
    approvalsSnapshot: await signatures(ctx, execution, members),
    whyChain: await executionWhy(ctx, room, execution, member, revisions, order, tasks.length),
    changeOrder: { number: order.number, terms: order.terms, lines: order.lines.map(visibleLine), amountChain: member.role === 'provider' ? null : { baselineCents: canSeeCommitted ? order.baselineCents : null, approvedToDateCents: canSeeCommitted ? order.priorApprovedDeltaCents : null, committedBeforeCents: canSeeCommitted ? order.amountBeforeCents : null, thisChangeCents: order.deltaCents, committedAfterCents: canSeeCommitted ? order.amountAfterCents : null, capCentsAtExecution: canSeeCap ? execution.capCentsAtExecution : null, headroomAfterCents: canSeeHeadroom ? execution.capCentsAtExecution - execution.committedAfterCents : null } },
    tasks: tasks.map(task => ({ taskId: task._id, taskKey: task.taskKey, title: task.title, assigneeRole: task.assigneeRole, dueDate: task.dueDate, status: task.status, canMarkDone: task.status === 'open' && task.assigneeRole === member.role })),
  };
}
export async function buildProposalCard(ctx: ReadCtx, proposal: Doc<'proposals'>, member: Doc<'members'>, currentRoomCard = false): Promise<Infer<typeof proposalCardV>> {
  const room = await ctx.db.get(proposal.roomId);
  if (!room) throw new Error('Missing room');
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect();
  const execution = proposal.status === 'executed' ? await ctx.db.query('executions').withIndex('by_proposal', q => q.eq('proposalId', proposal._id)).unique() : null;
  const frozen = execution ? await Promise.all(execution.approvalIds.map(id => ctx.db.get(id))) : null;
  // A9: an executed card never reevaluates a mutable approval interval.
  const rows = frozen ? frozen.filter((row): row is Doc<'approvals'> => row !== null) : await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
  const latest = frozen ? null : latestDecisionsByUser(approvalRows(rows));
  const set = frozen ? null : evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: approvalRows(rows), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
  for (const { slot } of set?.slots ?? []) {
    if (slot.state === 'vacant') publicOpsLog('view.vacant_slot', { fn: 'rooms.view' });
    if (slot.state === 'self_conflict') publicOpsLog('approval.self_conflict', { fn: 'rooms.view' });
  }
  const isCurrent = isCurrentForApproval(currentApprovalInput(room, run, proposal));
  const mine = frozen ? frozen.find(row => row?.userId === member.userId) : latest?.get(member.userId);
  const current = mine && mine.boundConstraintsVersion === room.constraintsVersion && mine.boundTermsKey === proposal.termsKey ? mine.decision : null;
  const req = proposal.requiredApprovals.find(r => r.role === member.role);
  const previous = await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', room._id).lt('version', proposal.version)).order('desc').first();
  const changes: string[] = [];
  if (previous) {
    if (previous.terms.amountCents !== proposal.terms.amountCents) changes.push('Amount changed');
    if (previous.terms.deliveryDate !== proposal.terms.deliveryDate) changes.push('Delivery date changed');
    if (JSON.stringify(previous.terms.itemKeys) !== JSON.stringify(proposal.terms.itemKeys) || JSON.stringify(previous.terms.modifiers) !== JSON.stringify(proposal.terms.modifiers)) changes.push('Scope changed');
  }
  let fit: Infer<typeof fitV> | undefined;
  let passesCurrentChecks = false;
  let taskCount = proposal.plannedTasks.length;
  let myTaskTitles = proposal.plannedTasks.filter(t => t.assigneeRole === member.role).map(t => t.title);
  let notIncludedForMe: string[] | null = null;
  if (isCurrent || room.status === 'open' && run?.currentProposalId === proposal._id && proposal.status === 'active') {
    const loaded = await loadRuleInput(ctx, room);
    if (loaded.scenario) {
      const scenario = loaded.scenario;
      const evaluation = checkProposal(loaded.scenario, loaded.input, asEngineProposal(proposal));
      passesCurrentChecks = evaluation.passesChecks;
      const projected = privacy.projectChecks(member.role, evaluation.checks.map(check => ({ checkId: check.checkId, code: check.code ?? 'private.constraint_unmet', ownerRole: check.owner as Doc<'members'>['role'] | null, inputs: scenario.checks.find(d => d.checkId === check.checkId)?.requires.flat() ?? (check.checkId.startsWith('budget_') ? loaded.disclosures.headroomCents?.includes(member.role) ? ['headroomCents'] : ['capCents', 'committedCents'] : []), params: check.params, passed: check.status === 'pass' })), { plugin: loaded.scenario, sharedFacts: loaded.sharedFacts });
      if (member.role === 'provider') fit = { audience: 'provider', value: projected.fit };
      else {
        const items = 'items' in projected ? projected.items as readonly { code: string }[] : [];
        fit = { audience: 'buyer', passesChecks: projected.fit === 'ok', checks: items.map(item => ({ code: item.code, owner: evaluation.checks.some(c => c.code === item.code && c.owner === member.role) ? 'self' : 'other', text: item.code === 'private.constraint_unmet' ? 'A private constraint is unmet.' : item.code.replaceAll('.', ': ').replaceAll('_', ' ') })) };
      }
      const chain = loaded.input.capCents === undefined ? null : computeChangeOrderChain({ entries: loaded.ledgerEntries, deltaCents: proposal.terms.amountCents, capCents: loaded.input.capCents });
      if (chain?.ok) {
        const plan = planExecutionRecords(asEngineProposal(proposal), chain.chain);
        taskCount = plan.tasks.length;
        myTaskTitles = plan.tasks.filter(t => t.assigneeRole === member.role).map(t => t.title);
      }
    }
  }
  if (member.role === 'customer') {
    const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', room._id).eq('role', 'customer')).order('desc').first();
    if (brief && 'requiredItemKeys' in brief.hardFields) {
      const preferred = 'preferredItemKeys' in brief.softFields ? brief.softFields.preferredItemKeys : [];
      notIncludedForMe = privacy.projectNotIncludedForMe(member.role, brief.hardFields.requiredItemKeys.concat(preferred), proposal.terms.itemKeys);
    }
  }
  let number = 1;
  if (room.followsExecutionId) {
    const prior = await ctx.db.query('changeOrders').withIndex('by_execution', q => q.eq('executionId', room.followsExecutionId!)).unique();
    if (prior) number = prior.number + 1;
  }
  const turns = run ? await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect() : [];
  const suggestion = turns.filter(turn => turn.role === member.role && turn.result && ('proposalVersion' in turn.result && turn.result.proposalVersion === proposal.version)).at(-1);
  const canDecide = isCurrent && !!req && passesCurrentChecks;
  return { proposalId: proposal._id, version: proposal.version, termsKey: proposal.termsKey, origin: proposal.origin, provenance: proposal.provenance, createdAtConstraintsVersion: proposal.createdAtConstraintsVersion,
    terms: proposal.terms, lines: proposal.lines.map(visibleLine), summaryText: publicText.renderPublicText('proposal_summary', { roundNumber: run?.roundNo ?? 1, status: member.role === 'provider' && proposal.status === 'stale' ? 'superseded' : proposal.status, totalPriceCents: publicText.publicCents(proposal.terms.amountCents), durationDays: Math.max(0, Math.max.apply(null, [0].concat(proposal.lines.filter(l => l.kind === 'item').map(l => l.leadDays))) - proposal.lines.filter(l => l.kind === 'modifier').reduce((sum, line) => sum + line.leadDays, 0)), includedItemKeys: proposal.terms.itemKeys.map(publicText.itemKey) }, member.role === 'provider' ? 'owner' : 'buyer'),
    status: isCurrent ? undefined : member.role === 'provider' && proposal.status === 'stale' ? 'superseded' : proposal.status,
    diffFromPrevious: previous ? { previousVersion: previous.version, changes } : null, fit: fit ?? (currentRoomCard ? null : undefined), notIncludedForMe,
    approvals: proposal.requiredApprovals.map((required, index) => {
      const slot = set?.slots[index]?.slot ?? { state: 'pending' as const };
      const holder = members.find(m => m.role === required.role);
      const row = frozen ? frozen[index] ?? undefined : rows.find(r => r._id === ('approvalId' in slot ? slot.approvalId : ''));
      return { role: required.role, kind: required.kind, displayName: holder?.displayName ?? required.role, isMe: holder?.userId === member.userId,
        state: frozen && row ? 'approved' as const : slot.state === 'vacant' || slot.state === 'self_conflict' ? 'pending' as const : slot.state,
        boundConstraintsVersion: row?.boundConstraintsVersion ?? null, reasonKey: reasonFor(row, member) };
    }), allApproved: frozen ? true : set?.complete ?? false,
    myAction: { canDecide, kind: req?.kind ?? (member.role === 'finance' ? 'budget' : 'terms'), disabledReasonCode: canDecide ? null : proposal.status === 'executed' ? 'approval.already_executed' : !req ? 'auth.role_forbidden' : isCurrent && !passesCurrentChecks ? 'approval.not_executable' : 'approval.not_current', current, completesSet: canDecide && set?.missingRoles.length === 1 && set.missingRoles[0] === member.role, canWithdraw: isCurrent && !!req && current === 'approve' },
    recordsPreview: { changeOrderNumber: number, taskCount, myTaskTitles, commitCents: proposal.terms.amountCents },
    myAgentSuggestion: suggestion?.result ? { action: suggestion.result.action, proposalVersion: 'proposalVersion' in suggestion.result ? suggestion.result.proposalVersion : null, rationale: suggestion.result.rationale, isSimulated: room.provenance !== 'live' || run?.agentMode === 'stub' } : null,
  };
}

export async function buildProposalDetail(ctx: ReadCtx, proposal: Doc<'proposals'>, member: Doc<'members'>): Promise<Infer<typeof proposalDetailV>> {
  const rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
  return { card: await buildProposalCard(ctx, proposal, member), decisions: rows.map(row => ({ role: row.role, decision: row.decision, decidedAt: row.decidedAt, boundConstraintsVersion: row.boundConstraintsVersion, reasonKey: reasonFor(row, member), isMe: row.userId === member.userId, note: row.userId === member.userId ? row.note ?? null : null })) };
}

export async function buildRoomView(ctx: ReadCtx, room: Doc<'rooms'>, member: Doc<'members'>): Promise<Infer<typeof roomViewV>> {
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect();
  const briefs = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', room._id)).collect();
  const proposals = await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', room._id)).order('desc').take(20);
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const proposal = run?.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  const currentProposal = proposal ? await buildProposalCard(ctx, proposal, member, true) : null;
  const allCatalog = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', room._id)).collect();
  const catalog = new Map<string, Doc<'catalogItems'>>();
  for (const row of allCatalog) { const old = catalog.get(row.itemKey); if (!old || row.revision > old.revision || row.revision === old.revision && row.editNo > old.editNo) catalog.set(row.itemKey, row); }
  const facts = await latestFacts(ctx, room._id);
  const validFacts = facts.filter(row => {
    const brief = briefs.filter(b => b.role === row.fromRole).sort((a,b) => b.version - a.version)[0];
    return row.value !== null && (row.fromRole === member.role || row.audience.includes(member.role)) && brief?.version === row.briefVersion && !(member.role === 'provider' && row.fromRole === 'finance');
  });
  const ledger = member.role === 'finance' ? await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', room._id)).collect() : [];
  const finance = briefs.filter(b => b.role === 'finance').sort((a,b) => b.version - a.version)[0];
  const cap = member.role === 'finance' && finance && 'capCents' in finance.hardFields ? finance.hardFields.capCents : null;
  const committed = committedCents(ledger) ?? 0;
  const previousExecution = room.followsExecutionId ? await ctx.db.get(room.followsExecutionId) : null;
  const previousOrder = previousExecution ? await ctx.db.query('changeOrders').withIndex('by_execution', q => q.eq('executionId', previousExecution._id)).unique() : null;
  const amount = room.status === 'open' && run && ['negotiating','needs_input','pending_approval'].includes(run.status) && proposal?.status === 'active' ? proposal.terms.amountCents : null;
  const total = amount === null ? null : committed + amount;
  const shareCents = (field: string): number | null => { const value = validFacts.find(row => row.fromRole === 'finance' && row.field === field)?.value; return value?.kind === 'cents' ? value.cents : null; };
  const budget: Infer<typeof budgetV> = member.role === 'provider' ? { visibility: 'none' } : member.role === 'customer' ? { visibility: 'customer', capCents: shareCents('capCents'), committedCents: shareCents('committedCents'), headroomCents: shareCents('headroomCents') } : {
    visibility: 'finance', capCents: cap, committedCents: committed, headroomCents: cap === null ? null : cap - committed,
    baselineRecorded: ledger.some(row => row.kind === 'baseline'), baselineSuggestionCents: previousExecution?.committedAfterCents ?? null,
    proposalCents: amount, totalAfterCents: total, overByCents: total === null || cap === null ? null : Math.max(0, total - cap), status: total === null || cap === null ? 'no_proposal' : total <= cap ? 'within' : 'over',
  };
  const execution = await buildExecutionView(ctx, room._id, member);
  const followUp = execution ? await ctx.db.query('rooms').withIndex('by_followsExecutionId', q => q.eq('followsExecutionId', execution.executionId)).unique() : null;
  const turns = run ? await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect() : [];
  const activeTurn = turns.find(turn => turn.turnSeq === run?.activeTurnSeq);
  const ownTurn = activeTurn?.role === member.role;
  const attempt = ownTurn && activeTurn ? await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', activeTurn._id)).order('desc').first() : null;
  const isCreator = member.userId === room.createdBy;
  const invites = isCreator ? await ctx.db.query('invites').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect() : [];
  const phase = room.status !== 'open' ? room.status : member.role === 'provider' && run?.status === 'needs_input' ? 'run_waiting' : run?.status ?? 'ready';
  const todos: Infer<typeof roomViewV>['todos'] = [];
  if (currentProposal?.myAction.canDecide && currentProposal.myAction.current !== 'approve') todos.push({ kind: 'approve', priority: 1, refs: { proposalId: currentProposal.proposalId, proposalVersion: currentProposal.version } });
  return {
    header: { roomId: room._id, title: room.title, scenarioKey: room.scenarioKey, status: room.status, phase, constraintsVersion: room.constraintsVersion, proposalVersion: proposal?.version ?? null, viewingAs: member.role, isCreator, provenanceBadge: room.provenance },
    members: members.map(m => { const latest = briefs.filter(b => b.role === m.role).sort((a,b) => b.version - a.version)[0]; return { role: m.role, displayName: m.displayName, isMe: m.userId === member.userId, joinedVia: m.joinedVia, briefConfirmed: !!latest, briefVersion: member.role === 'provider' && m.userId !== member.userId && room.status !== 'setup' ? null : latest?.version ?? null }; }),
    seats: !isCreator ? null : (['customer','provider','finance'] as const).map(role => { const seat = members.find(m => m.role === role); const invite = invites.filter(i => i.role === role && i.status === 'open').at(-1); return { role, state: seat ? 'filled' : invite ? 'invited' : 'empty', inviteMode: invite?.mode ?? null, invitedEmail: invite?.invitedEmail ?? null, inviteExpiresAt: invite?.expiresAt ?? null }; }),
    todos, catalog: Array.from(catalog.values()).filter(row => row.status === 'confirmed').map(row => ({ itemKey: row.itemKey, kind: row.kind, title: row.title, priceCents: row.priceCents, leadDays: row.leadDays, revision: row.revision })),
    sharedFacts: validFacts.flatMap(row => row.value ? [{ fromRole: row.fromRole, field: row.field, value: row.value, asOfBriefVersion: row.briefVersion }] : []), budget, currentProposal,
    proposalHistory: proposals.map(p => ({ proposalId: p._id, version: p.version, status: member.role === 'provider' && p.status === 'stale' ? 'superseded' : p.status, amountCents: p.terms.amountCents, deliveryDate: p.terms.deliveryDate, createdAtConstraintsVersion: p.createdAtConstraintsVersion })),
    run: !run ? null : { runId: run._id, runNo: run.runNo, status: member.role === 'provider' && run.status === 'needs_input' ? 'run_waiting' : run.status, roundNo: run.roundNo, maxRounds: run.maxRounds, activeRole: member.role === 'provider' && run.status === 'needs_input' ? null : activeTurn?.role ?? null, attemptStatus: attempt?.status ?? null, waiting: ownTurn ? activeTurn?.waitingReason ?? null : null, staleDiscarded: turns.filter(t => t.status === 'stale').length, cause: run.cause, endedReason: run.endedReason ?? null, agentMode: run.agentMode },
    execution: execution ? { executionId: execution.executionId, proposalVersion: execution.proposalVersion, executedAt: execution.executedAt, changeOrderNumber: execution.changeOrder.number, approvalsSnapshot: execution.approvalsSnapshot, followUpRoomId: followUp?._id ?? null } : null,
    followUpOf: previousExecution && previousOrder ? { previousRoomId: previousExecution.roomId, changeOrderNumber: previousOrder.number, deliveredItems: previousOrder.lines.filter(l => l.kind === 'item').map(l => ({ itemKey: l.itemKey, title: l.title })) } : null,
  };
}

export async function decisionNotice(ctx: ReadCtx, room: Doc<'rooms'>, userId: Id<'users'>, role: Doc<'members'>['role']): Promise<'approval_no_longer_applies'|'request_closed'|null> {
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const proposal = run?.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  const set = proposal ? await loadApprovalSet(ctx, room, proposal) : null;
  if (room.status === 'open' && set?.slots.some(slot => slot.role === role && slot.slot.state === 'stale_approve' && slot.slot.userId === userId)) return 'approval_no_longer_applies';
  if (room.status === 'open') {
    const proposals = await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', room._id)).order('desc').collect();
    for (const prior of proposals) {
      const rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', prior._id).eq('userId', userId)).collect();
      const latest = rows.sort((a,b) => b._creationTime - a._creationTime).at(0);
      if (latest) {
        if (latest.decision === 'approve' && latest.boundConstraintsVersion < room.constraintsVersion) return 'approval_no_longer_applies';
        break;
      }
    }
  }
  const requests = await ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', room._id)).collect();
  const open = requests.some(r => r.status === 'open' && r.runId === run?._id);
  return !open && requests.some(r => r.toRole === role && r.status === 'superseded') ? 'request_closed' : null;
}
// End W2-2.
