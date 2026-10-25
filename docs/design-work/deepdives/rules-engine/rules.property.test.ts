// Property tests with a seeded PRNG (no fast-check dependency). Run: node --test rules.property.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCents, isIsoDate } from './primitives.ts';
import { MAX_CENTS } from './codes.ts';
import { evaluateScopeChange } from './scope-change.ts';
import { canonicalTermsKey } from './terms.ts';
import { dominates, findFeasibleOptions } from './feasibility.ts';
import { projectEvaluation } from './projection.ts';
import type { ScopeChangeTerms } from './types.ts';
import * as F from './fixture.ts';

function rng(seed: number) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const N = 500;
const KEYS = ['LOGIN', 'REPORTS', 'EXPORT', 'NOPE'];
const pad = (n: number) => String(n).padStart(2, '0');
function randTerms(r: () => number): ScopeChangeTerms {
  const pick = () => KEYS.filter(() => r() < 0.5);
  return { itemKeys: pick(), deferredItemKeys: pick(), deliveryDate: `2026-${pad(10 + Math.floor(r() * 3))}-${pad(1 + Math.floor(r() * 31))}` };
}
const shuffle = <T,>(xs: readonly T[], r: () => number) => [...xs].map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const base = (cap: number) => ({ today: F.TODAY, catalog: F.catalog, customer: F.customer, budget: F.budgetAt(cap), pricingSnapshot: null });

test('P1 determinism and order-insensitivity', () => {
  const r = rng(1);
  for (let k = 0; k < N; k++) {
    const t = randTerms(r); const cap = 400_000 + Math.floor(r() * 200_000);
    const a = evaluateScopeChange({ ...base(cap), terms: t });
    const b = evaluateScopeChange({ ...base(cap), terms: { ...t, itemKeys: shuffle(t.itemKeys, r) },
      catalog: { ...F.catalog, items: shuffle(F.catalog.items, r) } });
    assert.deepEqual(b, a);
    assert.equal(canonicalTermsKey({ ...t, itemKeys: shuffle(t.itemKeys, r) }), canonicalTermsKey(t));
  }
});

test('P2 executable <=> no blocking codes; amounts consistent', () => {
  const r = rng(2);
  for (let k = 0; k < N; k++) {
    const e = evaluateScopeChange({ ...base(380_000 + Math.floor(r() * 300_000)), terms: randTerms(r) });
    assert.equal(e.executable, e.blocking.length === 0);
    if (e.amounts) {
      assert.equal(e.amounts.committedAfterCents, e.amounts.committedCents + e.amounts.additionalCostCents);
      assert.equal(e.amounts.overByCents, Math.max(0, e.amounts.committedAfterCents - e.amounts.capCents));
    }
  }
});

test('P3 budget monotonic in cap; boundary uses <=', () => {
  const r = rng(3);
  for (let k = 0; k < N; k++) {
    const t = randTerms(r);
    const e = evaluateScopeChange({ ...base(500_000), terms: t });
    if (!e.amounts) continue;
    const exact = e.amounts.committedAfterCents;
    const at = (cap: number) => evaluateScopeChange({ ...base(cap), terms: t }).checks.find((c) => c.checkId === 'budget')!.code;
    assert.equal(at(exact), 'FITS_BUDGET');
    assert.equal(at(exact + 1), 'FITS_BUDGET');
    if (exact - 1 >= 400_000) assert.equal(at(exact - 1), 'OVER_BUDGET');
  }
});

test('P4 feasible set is executable; frontier is undominated and covers the rest', () => {
  for (const cap of [440_000, 445_000, 480_000, 490_000, 500_000, 540_000]) {
    const f = findFeasibleOptions(base(cap));
    if (f.kind !== 'single' && f.kind !== 'tradeoff') continue;
    for (const o of f.feasible) assert.ok(evaluateScopeChange({ ...base(cap), terms: o.terms }).executable);
    for (const a of f.frontier) assert.ok(!f.frontier.some((b) => b !== a && dominates(b, a)));
    for (const o of f.feasible) assert.ok(f.frontier.includes(o) || f.frontier.some((p) => dominates(p, o)));
  }
});

test('P5 isIsoDate agrees with a Date.UTC round-trip reference', () => {
  const r = rng(5);
  for (let k = 0; k < 5000; k++) {
    const y = 1900 + Math.floor(r() * 300), m = Math.floor(r() * 14), d = Math.floor(r() * 33);
    const s = `${y}-${pad(m)}-${pad(d)}`;
    const dt = new Date(Date.UTC(y, m - 1, d));
    const ref = m >= 1 && m <= 12 && d >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    assert.equal(isIsoDate(s), ref, s);
  }
  for (const bad of ['2026-02-30', '2026-11-31', '2026-02-29', ' 2026-01-01', '2026-1-01', '20260101', '2026-01-01T00:00']) assert.equal(isIsoDate(bad), false);
  assert.equal(isIsoDate('2028-02-29'), true);
});

test('P6 cents arithmetic never leaves the safe range', () => {
  const r = rng(6);
  for (let k = 0; k < N; k++) {
    const a = Math.floor(r() * MAX_CENTS), b = Math.floor(r() * MAX_CENTS);
    const s = addCents(a, b);
    assert.equal(s === null, a + b > MAX_CENTS);
  }
  assert.equal(addCents(0.5, 1), null);
  assert.equal(addCents(-1, 1), null);
});

test('P7 provider projection never carries budget numbers or an unshared deadline', () => {
  const r = rng(7);
  for (let k = 0; k < N; k++) {
    const e = evaluateScopeChange({ ...base(400_000 + Math.floor(r() * 150_000)), terms: randTerms(r) });
    const p = projectEvaluation(e, 'provider', { deadlineShared: false, requiredItemsShared: false });
    const json = JSON.stringify({ blocking: p.blocking, info: p.info, checks: p.checks, amounts: p.amounts });
    assert.equal(p.amounts, null);
    assert.ok(!json.includes(F.customer.deadline));
    assert.ok(!json.includes('overByCents') && !json.includes('belowByCents'));
    assert.ok(!p.info.includes('MISSES_PREFERRED_DATE'));
  }
});
