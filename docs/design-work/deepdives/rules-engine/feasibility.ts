// scenarios/scope-change/feasibility.ts — code-enumerated feasible set, Pareto frontier, single relaxations.
import type { ReasonCode } from './codes.ts';
import { MAX_OPTIONAL_ITEMS, MAX_RELAXATION_ITEMS } from './codes.ts';
import type { Cents, IsoDate } from './primitives.ts';
import { maxDateOf, sortedUnique } from './primitives.ts';
import type { Catalog, CatalogItem, Evaluation, ScopeChangeInput, ScopeChangeTerms } from './types.ts';
import { evaluateScopeChange } from './scope-change.ts';

export type BaseInput = Omit<ScopeChangeInput, 'terms' | 'pricingSnapshot'>;
export type Option = {
  terms: ScopeChangeTerms;
  additionalCostCents: Cents;
  valueItemKeys: string[]; // included non-required items
  meetsPreferred: boolean;
  rush: boolean;
};
export type Feasibility =
  | { kind: 'too_large'; code: 'SEARCH_SPACE_TOO_LARGE'; optionalCount: number }
  | { kind: 'none'; code: 'NO_FEASIBLE_OPTION'; blockingUnion: ReasonCode[] }
  | { kind: 'single'; frontier: Option[]; feasible: Option[] }
  | { kind: 'tradeoff'; code: 'NEEDS_TRADEOFF'; frontier: Option[]; feasible: Option[] };

const live = (it: CatalogItem, today: IsoDate) =>
  it.status === 'confirmed' && (it.validUntil === undefined || today <= it.validUntil);

/** At most two dates matter per selection: earliest standard (no rush) and earliest rush. */
export function candidateDates(items: readonly CatalogItem[], catalog: Catalog, today: IsoDate): IsoDate[] {
  const std = maxDateOf(items.map((i) => i.standardDeliveryDate))!;
  const out = [std > today ? std : today];
  if (catalog.rushFee) {
    const rush = maxDateOf(items.map((i) =>
      i.rushDeliveryDate && i.rushDeliveryDate < i.standardDeliveryDate ? i.rushDeliveryDate : i.standardDeliveryDate))!;
    const r = rush > today ? rush : today;
    if (r < out[0]!) out.push(r);
  }
  return out;
}

function enumerate(base: BaseInput, pool: readonly string[], fixed: readonly string[]): ScopeChangeTerms[] {
  const byKey = new Map(base.catalog.items.map((i) => [i.itemKey, i] as const));
  const deferrable = base.customer?.deferrableItemKeys ?? [];
  const out: ScopeChangeTerms[] = [];
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const keys = sortedUnique([...fixed, ...pool.filter((_, j) => mask & (1 << j))]);
    if (keys.length === 0) continue;
    const deferredItemKeys = sortedUnique(deferrable.filter((k) => byKey.has(k) && !keys.includes(k)));
    for (const d of candidateDates(keys.map((k) => byKey.get(k)!), base.catalog, base.today)) {
      out.push({ itemKeys: keys, deferredItemKeys, deliveryDate: d });
    }
  }
  return out;
}

function toOption(base: BaseInput, t: ScopeChangeTerms, e: Evaluation): Option {
  const req = base.customer?.requiredItemKeys ?? [];
  const p = base.customer?.preferredDate;
  return { terms: t, additionalCostCents: e.pricing!.additionalCostCents,
    valueItemKeys: t.itemKeys.filter((k) => !req.includes(k)),
    meetsPreferred: p === undefined || t.deliveryDate <= p, rush: e.pricing!.rush };
}

const byStableOrder = (a: Option, b: Option) =>
  a.additionalCostCents - b.additionalCostCents
  || a.terms.itemKeys.join(',').localeCompare(b.terms.itemKeys.join(','))
  || (a.terms.deliveryDate < b.terms.deliveryDate ? -1 : a.terms.deliveryDate > b.terms.deliveryDate ? 1 : 0);

/** a dominates b: no more expensive, superset of value items, meets preference if b does, and strictly better somewhere. */
export function dominates(a: Option, b: Option): boolean {
  const superset = b.valueItemKeys.every((k) => a.valueItemKeys.includes(k));
  const geq = a.additionalCostCents <= b.additionalCostCents && superset && (a.meetsPreferred || !b.meetsPreferred);
  const strict = a.additionalCostCents < b.additionalCostCents
    || a.valueItemKeys.length > b.valueItemKeys.length || (a.meetsPreferred && !b.meetsPreferred);
  return geq && strict;
}

export function paretoFrontier(xs: readonly Option[]): Option[] {
  return xs.filter((x) => !xs.some((y) => y !== x && dominates(y, x))).sort(byStableOrder);
}

export function findFeasibleOptions(base: BaseInput): Feasibility {
  const req = base.customer?.requiredItemKeys ?? [];
  const pool = base.catalog.items.filter((i) => live(i, base.today) && !req.includes(i.itemKey)).map((i) => i.itemKey).sort();
  if (pool.length > MAX_OPTIONAL_ITEMS) return { kind: 'too_large', code: 'SEARCH_SPACE_TOO_LARGE', optionalCount: pool.length };
  const feasible: Option[] = [];
  const union = new Set<ReasonCode>();
  for (const t of enumerate(base, pool, req)) {
    const e = evaluateScopeChange({ ...base, terms: t, pricingSnapshot: null });
    if (e.executable) feasible.push(toOption(base, t, e));
    else e.blocking.forEach((c) => union.add(c));
  }
  // even an empty enumeration (e.g. required item not offered) must say why
  if (feasible.length === 0) {
    const probe = evaluateScopeChange({ ...base, pricingSnapshot: null,
      terms: { itemKeys: req.length ? [...req] : ['__none__'], deferredItemKeys: [], deliveryDate: base.today } });
    probe.blocking.filter((c) => c !== 'UNKNOWN_ITEM').forEach((c) => union.add(c));
    return { kind: 'none', code: 'NO_FEASIBLE_OPTION', blockingUnion: [...union].sort() };
  }
  feasible.sort(byStableOrder);
  const frontier = paretoFrontier(feasible);
  return frontier.length === 1 ? { kind: 'single', frontier, feasible }
    : { kind: 'tradeoff', code: 'NEEDS_TRADEOFF', frontier, feasible };
}

export type Relaxation =
  | { kind: 'raise_cap'; targetRole: 'finance'; minCapCents: Cents }
  | { kind: 'defer_required'; targetRole: 'customer'; itemKeys: string[] }
  | { kind: 'extend_deadline'; targetRole: 'customer'; minDeadline: IsoDate }
  | { kind: 'confirm_offer'; targetRole: 'provider' };

/** Single-step relaxations that would make at least one candidate executable. Combined relaxations are out of scope (v1). */
export function suggestRelaxations(base: BaseInput): Relaxation[] | { kind: 'too_large' } {
  const pool = base.catalog.items.filter((i) => live(i, base.today)).map((i) => i.itemKey).sort();
  if (pool.length > MAX_RELAXATION_ITEMS) return { kind: 'too_large' };
  const req = base.customer?.requiredItemKeys ?? [];
  const committed = base.budget ? base.budget.commitments.reduce((s, c) => s + c.amountCents, 0) : 0;
  let minCap: Cents | null = null;
  let defer: { keys: string[]; cost: Cents } | null = null;
  let minDeadline: IsoDate | null = null;
  const only = (b: readonly ReasonCode[], allowed: readonly ReasonCode[]) => b.length > 0 && b.every((c) => allowed.includes(c));
  for (const t of enumerate(base, pool, [])) {
    const e = evaluateScopeChange({ ...base, terms: t, pricingSnapshot: null });
    if (!e.pricing) continue;
    const cost = e.pricing.additionalCostCents;
    if (only(e.blocking, ['OVER_BUDGET', 'BUDGET_BELOW_COMMITTED'])) {
      const need = committed + cost;
      if (minCap === null || need < minCap) minCap = need;
    }
    if (only(e.blocking, ['MISSING_REQUIRED_ITEM', 'REQUIRED_ITEM_NOT_OFFERED'])) {
      const keys = req.filter((k) => !t.itemKeys.includes(k)).sort();
      if (keys.length > 0 && (defer === null || keys.length < defer.keys.length || (keys.length === defer.keys.length && cost < defer.cost))) {
        defer = { keys, cost };
      }
    }
    if (only(e.blocking, ['AFTER_DEADLINE', 'DATE_CONFLICT'])) {
      if (minDeadline === null || t.deliveryDate < minDeadline) minDeadline = t.deliveryDate;
    }
  }
  const out: Relaxation[] = [];
  if (minCap !== null) out.push({ kind: 'raise_cap', targetRole: 'finance', minCapCents: minCap });
  if (defer !== null) out.push({ kind: 'defer_required', targetRole: 'customer', itemKeys: defer.keys });
  if (minDeadline !== null) out.push({ kind: 'extend_deadline', targetRole: 'customer', minDeadline });
  out.push({ kind: 'confirm_offer', targetRole: 'provider' });
  return out;
}
