// Run: node --test rules.test.ts   (Node >= 23.6 strips types; no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCents, isIsoDate, sumCents } from './primitives.ts';
import { MAX_CENTS } from './codes.ts';
import { evaluateScopeChange } from './scope-change.ts';
import { canonicalTermsKey, diffTerms } from './terms.ts';
import { dominates, findFeasibleOptions, suggestRelaxations } from './feasibility.ts';
import { evaluateExecutionReadiness } from './engine.ts';
import type { Decision } from './engine.ts';
import { projectEvaluation } from './projection.ts';
import type { ScopeChangeInput, ScopeChangeTerms } from './types.ts';
import * as F from './fixture.ts';

const input = (t: ScopeChangeTerms, cap = F.CAP_INITIAL, over: Partial<ScopeChangeInput> = {}): ScopeChangeInput =>
  ({ today: F.TODAY, catalog: F.catalog, customer: F.customer, budget: F.budgetAt(cap), terms: t, pricingSnapshot: null, ...over });
const ev = (t: ScopeChangeTerms, cap?: number, over?: Partial<ScopeChangeInput>) => evaluateScopeChange(input(t, cap, over));

// ---------------------------------------------------------------- table-driven
const TABLE: { name: string; t: ScopeChangeTerms; cap?: number; over?: Partial<ScopeChangeInput>; blocking: string[]; info?: string[]; cost?: number }[] = [
  { name: 'phase 1 with rush fits $5,000', t: F.terms.phase1Rush, blocking: [], info: ['RUSH_FEE_APPLIED'], cost: 90_000 },
  { name: 'full change is over budget', t: F.terms.fullRush, blocking: ['OVER_BUDGET'], cost: 140_000 },
  { name: 'phase 1 after cut to $4,800 is over', t: F.terms.phase1Rush, cap: F.CAP_AFTER_CUT, blocking: ['OVER_BUDGET'] },
  { name: 'boundary: $800 == headroom fits (<=)', t: F.terms.phase1Standard, cap: F.CAP_AFTER_CUT, blocking: [], info: ['MISSES_PREFERRED_DATE'], cost: 80_000 },
  { name: 'boundary: one cent less cap is over', t: F.terms.phase1Standard, cap: F.CAP_AFTER_CUT - 1, blocking: ['OVER_BUDGET'] },
  { name: 'cap below committed', t: F.terms.loginRush, cap: 399_999, blocking: ['BUDGET_BELOW_COMMITTED'] },
  { name: 'empty scope', t: { itemKeys: [], deferredItemKeys: [], deliveryDate: '2026-11-20' }, blocking: ['EMPTY_SCOPE'] },
  { name: 'duplicate item', t: { itemKeys: ['LOGIN', 'LOGIN'], deferredItemKeys: [], deliveryDate: '2026-11-20' }, blocking: ['DUPLICATE_ITEM'] },
  { name: 'item both included and deferred', t: { itemKeys: ['LOGIN'], deferredItemKeys: ['LOGIN'], deliveryDate: '2026-11-20' }, blocking: ['ITEM_OVERLAP'] },
  { name: 'unknown item', t: { itemKeys: ['LOGIN', 'whatever'], deferredItemKeys: [], deliveryDate: '2026-11-20' }, blocking: ['UNKNOWN_ITEM'] },
  { name: 'calendar-invalid date 2026-11-31', t: { itemKeys: ['LOGIN'], deferredItemKeys: [], deliveryDate: '2026-11-31' }, blocking: ['INVALID_DATE'] },
  { name: 'before earliest even with rush', t: { itemKeys: ['LOGIN'], deferredItemKeys: [], deliveryDate: '2026-11-12' }, blocking: ['BEFORE_EARLIEST_DELIVERY'] },
  { name: 'after deadline', t: { itemKeys: ['LOGIN'], deferredItemKeys: [], deliveryDate: '2026-11-28' }, blocking: ['AFTER_DEADLINE'] },
  { name: 'deadline day itself is on time', t: { itemKeys: ['LOGIN'], deferredItemKeys: [], deliveryDate: '2026-11-27' }, blocking: [], cost: 45_000 },
  { name: 'delivery in the past', t: F.terms.loginRush, over: { today: '2026-11-14' }, blocking: ['DELIVERY_IN_PAST'] },
  { name: 'missing brief', t: F.terms.loginRush, over: { customer: null }, blocking: ['CONSTRAINTS_INCOMPLETE'] },
  { name: 'required deferred', t: { itemKeys: ['REPORTS'], deferredItemKeys: ['LOGIN'], deliveryDate: '2026-11-20' }, blocking: ['MISSING_REQUIRED_ITEM'] },
];
for (const row of TABLE) {
  test(`table: ${row.name}`, () => {
    const e = ev(row.t, row.cap, row.over);
    assert.deepEqual(e.blocking, row.blocking);
    assert.equal(e.executable, row.blocking.length === 0);
    if (row.info) assert.deepEqual(e.info, row.info);
    if (row.cost !== undefined) assert.equal(e.pricing?.additionalCostCents, row.cost);
  });
}

test('RA-R02 regression: $700 deferring required items, after deadline, is NOT executable', () => {
  const cat = { ...F.catalog, items: [...F.catalog.items,
    { itemKey: 'CHANGE3', revision: 1, priceCents: 70_000, standardDeliveryDate: '2026-12-20', status: 'confirmed' as const, simulated: true }] };
  const e = ev({ itemKeys: ['CHANGE3'], deferredItemKeys: ['LOGIN', 'REPORTS'], deliveryDate: '2026-12-20' }, F.CAP_AFTER_CUT, { catalog: cat });
  assert.equal(e.executable, false);
  assert.deepEqual(e.blocking, ['MISSING_REQUIRED_ITEM', 'AFTER_DEADLINE', 'DATE_CONFLICT']);
  assert.equal(e.checks.find((c) => c.checkId === 'budget')?.code, 'FITS_BUDGET');
});

test('source changed: price edit after proposal blocks', () => {
  const snap = ev(F.terms.phase1Rush).pricing!;
  const cat = { ...F.catalog, items: F.catalog.items.map((i) => i.itemKey === 'REPORTS' ? { ...i, revision: 2, priceCents: 36_000 } : i) };
  assert.deepEqual(ev(F.terms.phase1Rush, F.CAP_INITIAL, { catalog: cat, pricingSnapshot: snap }).blocking, ['SOURCE_CHANGED']);
});

test('expired and unconfirmed items', () => {
  const cat = { ...F.catalog, items: F.catalog.items.map((i) => i.itemKey === 'REPORTS' ? { ...i, validUntil: '2026-10-25' } : i.itemKey === 'EXPORT' ? { ...i, status: 'unconfirmed' as const } : i) };
  assert.deepEqual(ev(F.terms.phase1Rush, F.CAP_INITIAL, { catalog: cat }).blocking, ['ITEM_EXPIRED']);
  assert.deepEqual(ev(F.terms.fullRush, 9_000_000, { catalog: cat }).blocking, ['UNCONFIRMED_ITEM']);
});

test('feasibility after cut: tradeoff frontier', () => {
  const f = findFeasibleOptions({ today: F.TODAY, catalog: F.catalog, customer: F.customer, budget: F.budgetAt(F.CAP_AFTER_CUT) });
  assert.equal(f.kind, 'tradeoff');
  if (f.kind !== 'tradeoff') return;
  assert.deepEqual(f.frontier.map((o) => `${o.terms.itemKeys.join('+')}@${o.terms.deliveryDate}=${o.additionalCostCents}`),
    ['LOGIN@2026-11-20=45000', 'LOGIN@2026-11-13=55000', 'LOGIN+REPORTS@2026-11-20=80000']);
});

test('infeasible cap: none + relaxations', () => {
  const base = { today: F.TODAY, catalog: F.catalog, customer: F.customer, budget: F.budgetAt(F.CAP_INFEASIBLE) };
  const f = findFeasibleOptions(base);
  assert.equal(f.kind, 'none');
  assert.deepEqual(suggestRelaxations(base), [
    { kind: 'raise_cap', targetRole: 'finance', minCapCents: 445_000 },
    { kind: 'defer_required', targetRole: 'customer', itemKeys: ['LOGIN'] },
    { kind: 'confirm_offer', targetRole: 'provider' },
  ]);
});

test('diff distinguishes removed vs deferred', () => {
  const d = diffTerms(F.terms.fullRush, F.terms.phase1Rush, 140_000, 90_000);
  assert.deepEqual(d.map((x) => x.field), ['items_deferred', 'delivery_date', 'additional_cost']);
});

// ---------------------------------------------------------------- readiness
const approvers = [
  { participantId: 'p_c', userId: 'u1', role: 'customer' },
  { participantId: 'p_p', userId: 'u2', role: 'provider' },
  { participantId: 'p_f', userId: 'u3', role: 'finance' },
];
const key = canonicalTermsKey(F.terms.phase1Rush);
const dec = (participantId: string, userId: string, kind: Decision['kind'], cv: number, seq: number): Decision =>
  ({ participantId, userId, proposalId: 'pr1', kind, constraintsVersion: cv, termsKey: key, seq });
const ready = (decisions: Decision[], cv = 1, extra: object = {}) => evaluateExecutionReadiness({
  proposalId: 'pr1', isCurrentProposal: true, storedTermsKey: key, recomputedTermsKey: key,
  currentConstraintsVersion: cv, requiredApprovers: approvers, decisions, executionId: null, evaluation: { blocking: [] }, ...extra });
const all = [dec('p_c', 'u1', 'approve', 1, 1), dec('p_p', 'u2', 'approve', 1, 2), dec('p_f', 'u3', 'approve', 1, 3)];

test('readiness: all fresh approvals -> ready', () => {
  const r = ready(all);
  assert.equal(r.kind === 'evaluated' && r.ready, true);
});
test('readiness: constraints bump makes approvals stale', () => {
  const r = ready(all, 2);
  assert.ok(r.kind === 'evaluated' && !r.ready && r.blocking.includes('APPROVAL_PENDING') && r.info.includes('APPROVAL_STALE'));
  assert.equal(r.kind === 'evaluated' && r.states['p_c'], 'stale_approve');
});
test('readiness: latest decision wins (withdraw after approve)', () => {
  const r = ready([...all, dec('p_f', 'u3', 'withdraw', 1, 4)]);
  assert.ok(r.kind === 'evaluated' && r.states['p_f'] === 'withdrawn' && !r.ready);
});
test('readiness: one user holding two roles is rejected', () => {
  const r = ready(all, 1, { requiredApprovers: [approvers[0], { ...approvers[1], userId: 'u1' }, approvers[2]] });
  assert.ok(r.kind === 'evaluated' && r.blocking.includes('APPROVER_IDENTITY_CONFLICT'));
});
test('readiness: existing execution short-circuits before budget', () => {
  const r = ready(all, 1, { executionId: 'ex1', evaluation: { blocking: ['OVER_BUDGET'] } });
  assert.deepEqual(r, { kind: 'already_executed', executionId: 'ex1' });
});
