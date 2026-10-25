// scenarios/scope-change/rules.ts — scope_change pricing, checks and evaluation (pure).
import type { ReasonCode, ScopeChangeCheckId } from './codes.ts';
import { SCOPE_CHANGE_CHECK_ORDER } from './codes.ts';
import type { Cents, IsoDate } from './primitives.ts';
import { addCents, duplicatesOf, isCents, isIsoDate, isNonEmptyKey, maxDateOf, sortedUnique, sumCents } from './primitives.ts';
import type { CheckDef, CheckOutcome } from './engine.ts';
import type { Amounts, Catalog, CatalogItem, Evaluation, Pricing, ScopeChangeInput, ScopeChangeTerms } from './types.ts';
import { assemble, runChecks } from './engine.ts';

export type PriceResult = { ok: true; pricing: Pricing } | { ok: false; code: ReasonCode; params: Record<string, string> };

/** Caller guarantees itemKeys are known, unique and confirmed. */
export function priceTerms(terms: ScopeChangeTerms, catalog: Catalog): PriceResult {
  const byKey = new Map(catalog.items.map((i) => [i.itemKey, i] as const));
  const items = [...terms.itemKeys].sort().map((k) => byKey.get(k)!);
  const std = maxDateOf(items.map((i) => i.standardDeliveryDate))!;
  const rushMin = maxDateOf(items.map((i) =>
    i.rushDeliveryDate && i.rushDeliveryDate < i.standardDeliveryDate ? i.rushDeliveryDate : i.standardDeliveryDate))!;
  const d = terms.deliveryDate;
  let rush = false;
  if (d >= std) rush = false;
  else if (catalog.rushFee && d >= rushMin) rush = true;
  else return { ok: false, code: 'BEFORE_EARLIEST_DELIVERY', params: { earliestDate: catalog.rushFee ? rushMin : std } };
  const lines = items.map((i) => ({ itemKey: i.itemKey, revision: i.revision, priceCents: i.priceCents }));
  const charges = rush && catalog.rushFee ? [{ ...catalog.rushFee }] : [];
  const total = sumCents([...lines.map((l) => l.priceCents), ...charges.map((c) => c.amountCents)]);
  if (total === null) return { ok: false, code: 'AMOUNT_OUT_OF_RANGE', params: {} };
  return { ok: true, pricing: { lines, charges, rush, additionalCostCents: total } };
}

type Ctx = {
  i: ScopeChangeInput;
  byKey: Map<string, CatalogItem>;
  committed: Cents | null;
  pricing: PriceResult | null;
};

const isLive = (it: CatalogItem | undefined, today: IsoDate) =>
  !!it && it.status === 'confirmed' && (it.validUntil === undefined || today <= it.validUntil);

const DEFS: Record<ScopeChangeCheckId, CheckDef<ScopeChangeCheckId, Ctx>> = {
  constraints_present: { severity: 'block', dependsOn: [], run: ({ i }) => {
    const missing = [...(i.customer ? [] : ['customer_constraints']), ...(i.budget ? [] : ['budget'])];
    return missing.length === 0 ? { ok: true } : { ok: false, code: 'CONSTRAINTS_INCOMPLETE', params: { missing } };
  } },
  constraints_consistent: { severity: 'block', dependsOn: ['constraints_present'], run: ({ i, committed }) => {
    const c = i.customer!, b = i.budget!;
    const problems: string[] = [];
    const keys = [...c.requiredItemKeys, ...c.deferrableItemKeys];
    if (!keys.every(isNonEmptyKey) || duplicatesOf(keys).length > 0) problems.push('item_keys');
    if (!isIsoDate(c.deadline)) problems.push('deadline');
    if (c.preferredDate !== undefined && (!isIsoDate(c.preferredDate) || c.preferredDate > c.deadline)) problems.push('preferred_date');
    if (!isCents(b.capCents) || committed === null) problems.push('budget_amounts');
    if (!isIsoDate(i.today)) problems.push('today');
    return problems.length === 0 ? { ok: true } : { ok: false, code: 'CONSTRAINT_INCONSISTENT', params: { problems } };
  } },
  terms_shape: { severity: 'block', dependsOn: [], run: ({ i }): CheckOutcome => {
    const t = i.terms;
    if (t.itemKeys.length === 0) return { ok: false, code: 'EMPTY_SCOPE' };
    if (![...t.itemKeys, ...t.deferredItemKeys].every(isNonEmptyKey)) return { ok: false, code: 'UNKNOWN_ITEM', params: { itemKeys: [] } };
    const dup = duplicatesOf([...t.itemKeys]).concat(duplicatesOf([...t.deferredItemKeys]));
    if (dup.length > 0) return { ok: false, code: 'DUPLICATE_ITEM', params: { itemKeys: sortedUnique(dup) } };
    const overlap = t.itemKeys.filter((k) => t.deferredItemKeys.includes(k));
    if (overlap.length > 0) return { ok: false, code: 'ITEM_OVERLAP', params: { itemKeys: sortedUnique(overlap) } };
    if (!isIsoDate(t.deliveryDate)) return { ok: false, code: 'INVALID_DATE', params: { field: 'deliveryDate' } };
    return { ok: true };
  } },
  items_known: { severity: 'block', dependsOn: ['terms_shape'], run: ({ i, byKey }) => {
    const unknown = [...i.terms.itemKeys, ...i.terms.deferredItemKeys].filter((k) => !byKey.has(k));
    return unknown.length === 0 ? { ok: true } : { ok: false, code: 'UNKNOWN_ITEM', params: { itemKeys: sortedUnique(unknown) } };
  } },
  items_confirmed: { severity: 'block', dependsOn: ['items_known'], run: ({ i, byKey }) => {
    const bad = i.terms.itemKeys.filter((k) => byKey.get(k)!.status !== 'confirmed');
    return bad.length === 0 ? { ok: true } : { ok: false, code: 'UNCONFIRMED_ITEM', params: { itemKeys: sortedUnique(bad) } };
  } },
  items_current: { severity: 'block', dependsOn: ['items_confirmed', 'constraints_consistent'], run: ({ i, byKey }) => {
    const bad = i.terms.itemKeys.filter((k) => !isLive(byKey.get(k), i.today));
    return bad.length === 0 ? { ok: true } : { ok: false, code: 'ITEM_EXPIRED', params: { itemKeys: sortedUnique(bad) } };
  } },
  required_offered: { severity: 'block', dependsOn: ['constraints_consistent'], run: ({ i, byKey }) => {
    const bad = i.customer!.requiredItemKeys.filter((k) => !isLive(byKey.get(k), i.today));
    return bad.length === 0 ? { ok: true } : { ok: false, code: 'REQUIRED_ITEM_NOT_OFFERED', params: { itemKeys: sortedUnique(bad) } };
  } },
  required_included: { severity: 'block', dependsOn: ['constraints_consistent', 'terms_shape'], run: ({ i }) => {
    const missing = i.customer!.requiredItemKeys.filter((k) => !i.terms.itemKeys.includes(k));
    if (missing.length === 0) return { ok: true };
    const deferred = missing.filter((k) => i.terms.deferredItemKeys.includes(k));
    return { ok: false, code: 'MISSING_REQUIRED_ITEM', params: { itemKeys: sortedUnique(missing), deferredItemKeys: sortedUnique(deferred) } };
  } },
  includes_should_items: { severity: 'info', dependsOn: ['constraints_consistent', 'items_known'], run: ({ i }) => {
    const c = i.customer!;
    const should = i.catalog.items.filter((it) => isLive(it, i.today)).map((it) => it.itemKey)
      .filter((k) => !c.requiredItemKeys.includes(k) && !c.deferrableItemKeys.includes(k));
    const excluded = should.filter((k) => !i.terms.itemKeys.includes(k));
    return excluded.length === 0 ? { ok: true } : { ok: false, code: 'SHOULD_ITEM_EXCLUDED', params: { itemKeys: sortedUnique(excluded) } };
  } },
  pricing: { severity: 'block', dependsOn: ['items_confirmed'], run: ({ pricing }) =>
    pricing!.ok ? { ok: true } : { ok: false, code: pricing!.code, params: pricing!.params } },
  no_rush_fee: { severity: 'info', dependsOn: ['pricing'], run: ({ pricing }) =>
    pricing!.ok && pricing!.pricing.rush ? { ok: false, code: 'RUSH_FEE_APPLIED' } : { ok: true } },
  source_unchanged: { severity: 'block', dependsOn: ['pricing'], run: ({ i, pricing }) => {
    const snap = i.pricingSnapshot;
    if (snap === null || !pricing!.ok) return { ok: true };
    const now = pricing!.pricing;
    const changed = now.lines.filter((l) => {
      const s = snap.lines.find((x) => x.itemKey === l.itemKey);
      return !s || s.revision !== l.revision || s.priceCents !== l.priceCents;
    }).map((l) => l.itemKey);
    const totalChanged = snap.additionalCostCents !== now.additionalCostCents || snap.lines.length !== now.lines.length;
    return changed.length === 0 && !totalChanged ? { ok: true }
      : { ok: false, code: 'SOURCE_CHANGED', params: { itemKeys: sortedUnique(changed) } };
  } },
  delivery_not_past: { severity: 'block', dependsOn: ['terms_shape', 'constraints_consistent'], run: ({ i }) =>
    i.terms.deliveryDate >= i.today ? { ok: true } : { ok: false, code: 'DELIVERY_IN_PAST', params: { today: i.today } } },
  delivery_by_deadline: { severity: 'block', dependsOn: ['terms_shape', 'constraints_consistent'], run: ({ i }) =>
    i.terms.deliveryDate <= i.customer!.deadline ? { ok: true }
      : { ok: false, code: 'AFTER_DEADLINE', params: { deadline: i.customer!.deadline } } },
  date_window: { severity: 'block', dependsOn: ['items_confirmed', 'constraints_consistent'], run: ({ i, byKey }) => {
    const items = i.terms.itemKeys.map((k) => byKey.get(k)!);
    const earliest = maxDateOf(items.map((it) => i.catalog.rushFee && it.rushDeliveryDate && it.rushDeliveryDate < it.standardDeliveryDate
      ? it.rushDeliveryDate : it.standardDeliveryDate))!;
    const windowStart = earliest > i.today ? earliest : i.today;
    return windowStart <= i.customer!.deadline ? { ok: true }
      : { ok: false, code: 'DATE_CONFLICT', params: { windowStart, windowEnd: i.customer!.deadline } };
  } },
  meets_preferred_date: { severity: 'info', dependsOn: ['terms_shape', 'constraints_consistent'], run: ({ i }) => {
    const p = i.customer!.preferredDate;
    return p === undefined || i.terms.deliveryDate <= p ? { ok: true } : { ok: false, code: 'MISSES_PREFERRED_DATE' };
  } },
  budget_state: { severity: 'block', dependsOn: ['constraints_consistent'], run: ({ i, committed }) =>
    committed! <= i.budget!.capCents ? { ok: true }
      : { ok: false, code: 'BUDGET_BELOW_COMMITTED', params: { belowByCents: committed! - i.budget!.capCents } } },
  budget: { severity: 'block', dependsOn: ['budget_state', 'pricing'], run: ({ i, committed, pricing }) => {
    const after = addCents(committed!, (pricing as { ok: true; pricing: Pricing }).pricing.additionalCostCents);
    if (after === null) return { ok: false, code: 'AMOUNT_OUT_OF_RANGE' };
    return after <= i.budget!.capCents ? { ok: true, code: 'FITS_BUDGET' }
      : { ok: false, code: 'OVER_BUDGET', params: { overByCents: after - i.budget!.capCents } };
  } },
};

export function evaluateScopeChange(i: ScopeChangeInput): Evaluation {
  const byKey = new Map(i.catalog.items.map((it) => [it.itemKey, it] as const));
  const committed = i.budget ? sumCents(i.budget.commitments.map((c) => c.amountCents)) : null;
  const ctx: Ctx = { i, byKey, committed, pricing: null };
  // pricing is computed lazily only when its dependencies hold; runChecks guarantees the order.
  const defs = { ...DEFS, pricing: { ...DEFS.pricing, run: (c: Ctx) => {
    c.pricing = priceTerms(c.i.terms, c.i.catalog);
    return DEFS.pricing.run(c);
  } } };
  const a = assemble(SCOPE_CHANGE_CHECK_ORDER, runChecks(SCOPE_CHANGE_CHECK_ORDER, defs, ctx));
  const pricing = ctx.pricing?.ok ? ctx.pricing.pricing : null;
  let amounts: Amounts | null = null;
  if (pricing && i.budget && committed !== null && isCents(i.budget.capCents)) {
    const after = addCents(committed, pricing.additionalCostCents);
    if (after !== null) amounts = {
      additionalCostCents: pricing.additionalCostCents, committedCents: committed, capCents: i.budget.capCents,
      committedAfterCents: after, headroomCents: i.budget.capCents - committed,
      overByCents: Math.max(0, after - i.budget.capCents),
    };
  }
  return { executable: a.executable, blocking: a.blocking, info: a.info, checks: a.checks, pricing, amounts };
}

