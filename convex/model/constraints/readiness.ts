import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { scenarioOf } from '../../scenarios/registry';
import { catalogRows, currentCatalog, latestBrief, ledgerState, type Role } from '../common';
export type ReadinessGap = {gap: string; ownerRole: Role};
export async function readinessGaps(ctx: QueryCtx, room: Doc<'rooms'>): Promise<ReadinessGap[]> {
  const plugin = scenarioOf(room);
  const members = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', room._id)).collect();
  const gaps: ReadinessGap[] = [];
  const briefs: Record<string, Doc<'briefs'>> = {};
  for (const role of ['customer','provider','finance'] as const) {
    if (!members.some(m => m.role === role)) gaps.push({gap: 'seat_vacant', ownerRole: role});
    const brief = await latestBrief(ctx, room._id, role);
    if (brief) briefs[role] = brief;
    else gaps.push({gap: 'brief_unconfirmed', ownerRole: role});
  }
  const ledger = await ledgerState(ctx, room._id);
  if (!ledger.baseline) gaps.push({gap: 'baseline_missing', ownerRole: 'finance'});
  const view = plugin.toRuleInput({room, briefs, catalogRows: currentCatalog(await catalogRows(ctx, room._id)), ...(ledger.baseline ? {committedCents: ledger.committedCents} : {})});
  for (const gap of plugin.readiness(view)) if (!gaps.some(g => g.gap === gap.gap && g.ownerRole === gap.ownerRole)) gaps.push({gap: gap.gap, ownerRole: gap.ownerRole as Role});
  return gaps;
}

export async function roomReadiness(ctx:QueryCtx,roomId:Id<'rooms'>){const room=await ctx.db.get(roomId);if(!room)throw new TypeError('Missing readiness room');const gaps=await readinessGaps(ctx,room);return gaps.length?{ready:false as const,gaps}:{ready:true as const};}
