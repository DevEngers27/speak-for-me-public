/** Constraint reads use the landed W2-1 source and disclosure helpers. */
import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { checkProposal, evaluateApprovalSet, viewFor, privacy, type ProposalLike, type View } from '../../core/engine';
import type { ScopeChangeRuleInput } from '../../core/scenarios/scope-change';
import { scenarioOf } from '../scenarios/registry';
import { catalogRows, currentCatalog, latestBrief, ledgerState, type Role } from './common';
import { factRows } from './sharedFacts';
export async function loadRuleInput(ctx: QueryCtx, roomId: Id<'rooms'>): Promise<View<ScopeChangeRuleInput>> {
  const room = await ctx.db.get(roomId); if (!room) throw new Error('Missing rule room');
  const briefs: Record<string, NonNullable<Awaited<ReturnType<typeof latestBrief>>>> = {};
  for (const role of ['customer','provider','finance'] as const) { const brief = await latestBrief(ctx, roomId, role); if (brief) briefs[role] = brief; }
  const ledger = await ledgerState(ctx, roomId);
  return scenarioOf(room).toRuleInput({ room, briefs, catalogRows: currentCatalog(await catalogRows(ctx, roomId)), ...(ledger.baseline ? { committedCents: ledger.committedCents } : {}) });
}
export async function loadRuleInputForRole(ctx: QueryCtx, roomId: Id<'rooms'>, role: Role, localDate: string) {
  const room = (await ctx.db.get(roomId))!; const plugin = scenarioOf(room);
  const full = { ...await loadRuleInput(ctx, roomId), localDate };
  const visible = privacy.projectSharedFacts(role, await factRows(ctx, roomId), undefined, plugin);
  const disclosures: Record<string, readonly string[]> = {}, shared: Record<string, unknown> = {};
  for (const fact of visible) {
    const field = fact.field as string; if (plugin.fields.find(f => f.key === field)?.owner === role) continue;
    const value = fact.value as NonNullable<import('../_generated/dataModel').Doc<'sharedFacts'>['value']>;
    shared[field] = value.kind === 'cents' ? value.cents : value.kind === 'date' ? value.date : value.kind === 'itemKeys' ? value.itemKeys : value.value;
    disclosures[field] = [role];
  }
  return viewFor<ScopeChangeRuleInput>(plugin, { ...full, ...shared }, disclosures, role);
}
export function evaluateProposal(input: View<ScopeChangeRuleInput>, proposal: ProposalLike) {
  return checkProposal(scenarioOf({ scenarioKey: 'scope_change', scenarioVersion: 1 }), input, proposal);
}
export function materializeCandidate(input: View<ScopeChangeRuleInput>, key: string) {
  const plugin = scenarioOf({ scenarioKey: 'scope_change', scenarioVersion: 1 });
  for (const draft of plugin.candidateSpace(input).drafts) { const p = plugin.materialize(draft, input.catalog, input.localDate); if (p?.candidateKey === key) return p; }
  return null;
}
export async function currentRunProposal(ctx: QueryCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId), run = room?.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  return { run, proposal: run?.currentProposalId ? await ctx.db.get(run.currentProposalId) : null };
}
export async function effectiveApprovals(ctx: QueryCtx, roomId: Id<'rooms'>, proposal: import('../_generated/dataModel').Doc<'proposals'>) {
  const room = (await ctx.db.get(roomId))!;
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', roomId)).collect();
  const rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
  return evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: rows.map(r => ({ ...r, id: r._id })), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
}
