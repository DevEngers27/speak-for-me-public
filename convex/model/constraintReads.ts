import { v, type Infer } from 'convex/values';
import { cents, EngineInvariantError, evaluateApprovalSet, hardProjection, isoDate, normalizeCatalogRow, type View } from '@core/engine';
import { fields, type ScopeChangeRuleInput } from '@core/scenarios/scope-change';
import type {MemberCtx} from '../lib/functions';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { currentRunProposal, loadRuleInput } from './constraintInput';

export const changeV = v.union(
  v.object({ kind: v.literal('cap'), newCapCents: v.number() }),
  v.object({ kind: v.literal('customer_hard'), requiredItemKeys: v.optional(v.array(v.string())), deadline: v.optional(v.string()) }),
  v.object({ kind: v.literal('catalog'), rows: v.array(v.object({ itemKey: v.string(), priceCents: v.optional(v.number()), leadDays: v.optional(v.number()), retire: v.optional(v.boolean()) })) }),
);
const impact = { nextConstraintsVersion: v.number(), invalidatedApprovals: v.number(), willSupersedeRun: v.boolean() };
export const previewResultV = v.union(
  v.null(), v.object({ verdict: v.literal('unchanged') }),
  v.object({ verdict: v.literal('recheck'), ...impact }),
  v.object({ verdict: v.literal('after'), ...impact, verdictAfter: v.object({ proposalVersion: v.number(), budgetCheck: v.union(v.literal('pass'), v.literal('budget.over')), overByCents: v.optional(v.number()) }) }),
  v.object({ verdict: v.literal('rejected'), code: v.literal('budget.below_committed'), minAllowedCapCents: v.number() }),
);
export type PreviewResult = Infer<typeof previewResultV>;
export type Change = Infer<typeof changeV>;
const OWNER = { cap: 'finance', customer_hard: 'customer', catalog: 'provider' } as const;

/** D12(2): no hypothetical feasibility evaluation. Finance's only verdict is
 * arithmetic on its own cap, committed balance and the current public amount.
 * This query deliberately has no clock dependency and never opens a write lock.
 */
export async function previewChange(ctx: MemberCtx, args: { roomId: Id<'rooms'>; change: Change }): Promise<PreviewResult> {
  const member=ctx.member;
  if (!member || member.role !== OWNER[args.change.kind]) return null;
  const room = await ctx.db.get(args.roomId);
  if (!room) return null;
  const input = await loadRuleInput(ctx, args.roomId);
  const change = args.change;
  const hypothetical = { ...input };
  if (change.kind === 'cap') hypothetical.capCents = change.newCapCents as ScopeChangeRuleInput['capCents'];
  else if (change.kind === 'customer_hard') {
    if (change.requiredItemKeys !== undefined) hypothetical.requiredItemKeys = change.requiredItemKeys;
    if (change.deadline !== undefined) hypothetical.deadline = change.deadline as ScopeChangeRuleInput['deadline'];
  } else {
    const catalog = new Map(input.catalog.map(row => [row.itemKey, row]));
    for (const row of change.rows) {
      const existing = catalog.get(row.itemKey);
      if (!existing) {
        if (row.retire === true) continue;
        catalog.set(row.itemKey, { itemKey: row.itemKey, kind: 'item', title: '', revision: 1,
          status: 'confirmed', priceCents: cents(row.priceCents ?? 0), leadDays: row.leadDays ?? 0,
          taskTemplates: [], provenance: 'live' });
        continue;
      }
      const next = { ...existing, priceCents: row.priceCents === undefined ? existing.priceCents : cents(row.priceCents),
        leadDays: row.leadDays ?? existing.leadDays,
        status: row.retire === undefined ? existing.status : row.retire ? 'retired' as const : 'confirmed' as const };
      if (next.priceCents !== existing.priceCents || next.leadDays !== existing.leadDays || next.status !== existing.status) next.revision++;
      catalog.set(row.itemKey, next);
    }
    hypothetical.catalog = [...catalog.values()];
  }
  if (hardProjection({ fields }, input) === hardProjection({ fields }, hypothetical)) return { verdict: 'unchanged' };
  if (change.kind === 'cap' && change.newCapCents < (input.committedCents ?? 0)) return { verdict: 'rejected', code: 'budget.below_committed', minAllowedCapCents: input.committedCents ?? 0 };
  const { run, proposal: linkedProposal } = await currentRunProposal(ctx, args.roomId);
  const proposal = run?.status === 'pending_approval' && linkedProposal?.status === 'active' ? linkedProposal : null;
  let invalidatedApprovals = 0;
  if (proposal) {
    const rows = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
    const members = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', args.roomId)).collect();
    const set = evaluateApprovalSet({ required: proposal.requiredApprovals, members, rows: rows.map(row => ({ ...row, id: row._id })), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
    invalidatedApprovals = set.slots.filter(slot => slot.slot.state === 'approved').length;
  }
  const result = { nextConstraintsVersion: room.status === 'setup' ? 1 : room.constraintsVersion + 1, invalidatedApprovals,
    willSupersedeRun: run !== null && !['executed', 'superseded', 'ended_no_agreement', 'canceled'].includes(run.status) };
  if (change.kind !== 'cap' || !proposal) return { verdict: 'recheck', ...result };
  const overByCents = (input.committedCents ?? 0) + proposal.terms.amountCents - change.newCapCents;
  return { verdict: 'after', ...result, verdictAfter: { proposalVersion: proposal.version, budgetCheck: overByCents > 0 ? 'budget.over' : 'pass', ...(overByCents > 0 ? { overByCents } : {}) } };
}

type SourceRef = Doc<'constraintRevisions'>['sourceRefs'][number];
/** Fold by logical source key, not document id. Retirements replace an offered
 * catalog source; presentation-only edits never enter constraint revisions.
 */
export type ReplayRef = { constraintsVersion: number; localDate: string };
export async function replayRuleInput(ctx: QueryCtx, roomId: Id<'rooms'>, ref: ReplayRef): Promise<View<ScopeChangeRuleInput>> {
  const version = ref.constraintsVersion;
  if (!Number.isSafeInteger(version) || version < 1) throw new EngineInvariantError('replay.unknown_version');
  const revisions = await ctx.db.query('constraintRevisions').withIndex('by_room_version', q => q.eq('roomId', roomId).lte('version', version)).collect();
  if (revisions.at(-1)?.version !== version) throw new EngineInvariantError('replay.unknown_version');
  if (revisions.length !== version || revisions.some((revision, index) => revision.version !== index + 1 || revision.previousVersion !== index)) throw new Error('constraints.replay_revision_gap');
  const inForce = new Map<string, SourceRef>();
  for (const revision of revisions) for (const source of revision.sourceRefs) {
    if (source.kind === 'brief') inForce.set(`brief:${source.role}`, source);
    else if (source.kind === 'catalogItem') inForce.set(`catalog:${source.itemKey}`, source);
    else if (source.kind === 'ledgerEntry') inForce.set(`ledger:${source.ledgerEntryId}`, source);
  }
  let capCents: ScopeChangeRuleInput['capCents'];
  let requiredItemKeys: ScopeChangeRuleInput['requiredItemKeys'];
  let deadline: ScopeChangeRuleInput['deadline'];
  let committedCents: ScopeChangeRuleInput['committedCents'];
  const catalog: ScopeChangeRuleInput['catalog'][number][] = [];
  for (const source of inForce.values()) {
    if (source.kind === 'brief') {
      const brief = await ctx.db.get(source.briefId);
      if (!brief || brief.roomId !== roomId || brief.version !== source.version || brief.role !== source.role) throw new Error('constraints.replay_source_invalid');
      const hard = brief.hardFields;
      if ('capCents' in hard) capCents = cents(hard.capCents);
      if ('requiredItemKeys' in hard) { requiredItemKeys = hard.requiredItemKeys; deadline = isoDate(hard.deadline); }
    } else if (source.kind === 'catalogItem') {
      const row = await ctx.db.get(source.catalogItemId);
      if (!row || row.roomId !== roomId || row.itemKey !== source.itemKey || row.revision !== source.revision) throw new Error('constraints.replay_source_invalid');
      if (row.status !== 'draft') catalog.push(normalizeCatalogRow({ ...row, status: row.status }, 'provider'));
    } else if (source.kind === 'ledgerEntry') {
      const row = await ctx.db.get(source.ledgerEntryId);
      if (!row || row.roomId !== roomId) throw new Error('constraints.replay_source_invalid');
      committedCents = cents((committedCents ?? 0) + row.amountCents);
    }
  }
  catalog.sort((a, b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0);
  return { viewer: 'system', localDate: isoDate(ref.localDate), capCents, committedCents,
    headroomCents: capCents !== undefined && committedCents !== undefined ? capCents - committedCents : undefined,
    requiredItemKeys, deadline, catalog };
}
