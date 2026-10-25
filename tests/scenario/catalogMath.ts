import type { ScopeChangeFixture } from "@core/scenarios/scope-change/fixtures";

export function priceOf(fx: ScopeChangeFixture, itemKey: string): number {
  const row = fx.catalog.find((item) => item.itemKey === itemKey);
  if (!row) throw new Error(`unknown itemKey ${itemKey}`);
  return row.priceCents;
}

export function leadDaysOf(fx: ScopeChangeFixture, itemKey: string): number {
  const row = fx.catalog.find((item) => item.itemKey === itemKey);
  if (!row) throw new Error(`unknown itemKey ${itemKey}`);
  return row.leadDays;
}

export function sumPrices(fx: ScopeChangeFixture, itemKeys: readonly string[], modifierKeys: readonly string[] = []): number {
  return [...itemKeys, ...modifierKeys].reduce((sum, key) => sum + priceOf(fx, key), 0);
}

/** max(0, max(item.leadDays) − Σ modifier.leadDays). Modifiers shorten the delivery. */
export function effectiveLeadDays(fx: ScopeChangeFixture, itemKeys: readonly string[], modifierKeys: readonly string[] = []): number {
  const maxLead = itemKeys.reduce((max, key) => Math.max(max, leadDaysOf(fx, key)), 0);
  const shortenedBy = modifierKeys.reduce((sum, key) => sum + leadDaysOf(fx, key), 0);
  return Math.max(0, maxLead - shortenedBy);
}

export function committedAfter(baselineCents: number, amountCents: number): number {
  return baselineCents + amountCents;
}

/** Canon comparison is `<=`, so a proposal that lands on the cap fits. */
export function fitsBudget(baselineCents: number, amountCents: number, capCents: number): boolean {
  return committedAfter(baselineCents, amountCents) <= capCents;
}

export function overByCents(baselineCents: number, amountCents: number, capCents: number): number {
  return committedAfter(baselineCents, amountCents) - capCents;
}

export function subsets(keys: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 1; mask < 2 ** keys.length; mask += 1) {
    const subset: string[] = [];
    for (let index = 0; index < keys.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const key = keys[index];
      if (key === undefined) throw new Error(`missing subset key ${index}`);
      subset.push(key);
    }
    out.push(subset);
  }
  return out;
}
