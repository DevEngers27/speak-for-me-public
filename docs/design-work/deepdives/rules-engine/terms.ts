// scenarios/scope-change/terms.ts — canonical key and structured diff of proposal terms.
import type { Cents, IsoDate } from './primitives.ts';
import { sortedUnique } from './primitives.ts';
import type { ScopeChangeTerms } from './types.ts';

/** Canonical, order-insensitive identity of the terms. Approvals bind (proposalId, constraintsVersion, termsKey). */
export function canonicalTermsKey(t: ScopeChangeTerms): string {
  return JSON.stringify({ v: 1, scenario: 'scope_change', itemKeys: sortedUnique(t.itemKeys),
    deferredItemKeys: sortedUnique(t.deferredItemKeys), deliveryDate: t.deliveryDate });
}

export type TermsDiff =
  | { field: 'items_added' | 'items_removed' | 'items_deferred' | 'items_undeferred'; itemKeys: string[] }
  | { field: 'delivery_date'; before: IsoDate; after: IsoDate }
  | { field: 'additional_cost'; beforeCents: Cents; afterCents: Cents };

export function diffTerms(prev: ScopeChangeTerms, next: ScopeChangeTerms, prevCost: Cents, nextCost: Cents): TermsDiff[] {
  const out: TermsDiff[] = [];
  const added = next.itemKeys.filter((k) => !prev.itemKeys.includes(k));
  const dropped = prev.itemKeys.filter((k) => !next.itemKeys.includes(k));
  const deferred = dropped.filter((k) => next.deferredItemKeys.includes(k));
  const removed = dropped.filter((k) => !next.deferredItemKeys.includes(k));
  const undeferred = prev.deferredItemKeys.filter((k) => !next.deferredItemKeys.includes(k) && next.itemKeys.includes(k));
  if (added.length) out.push({ field: 'items_added', itemKeys: sortedUnique(added) });
  if (removed.length) out.push({ field: 'items_removed', itemKeys: sortedUnique(removed) });
  if (deferred.length) out.push({ field: 'items_deferred', itemKeys: sortedUnique(deferred) });
  if (undeferred.length) out.push({ field: 'items_undeferred', itemKeys: sortedUnique(undeferred) });
  if (prev.deliveryDate !== next.deliveryDate) out.push({ field: 'delivery_date', before: prev.deliveryDate, after: next.deliveryDate });
  if (prevCost !== nextCost) out.push({ field: 'additional_cost', beforeCents: prevCost, afterCents: nextCost });
  return out;
}
