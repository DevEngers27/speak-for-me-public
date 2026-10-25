import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { allApproved, canExecuteNow, evaluateApprovalSet, isCurrentForApproval, isExecutable, passesChecks, enumerateCandidates } from '../../../core/engine/rules';
import { canonicalJson } from '../../../core/engine/canonicalJson';
import { cents } from '../../../core/engine/money';
import { input, plugin, proposal } from './fixture';

const current = () => ({ room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'p' }, proposal: { ...proposal(), _id: 'p', status: 'active', createdAtConstraintsVersion: 1 }, input });
const pending = () => evaluateApprovalSet({ required: [{ role: 'customer', kind: 'terms' }], members: [{ role: 'customer', userId: 'u' }], rows: [], roomConstraintsVersion: 2, termsKey: 't' });
it.each([
  ['stale', 'version.stale_constraints'], ['executed', 'approval.already_executed'], ['rejected', 'approval.not_current'],
])('08-U13 guard %s returns only %s before rules', (status, code) => {
  const x = current();
  expect(isExecutable(plugin, { ...x, room: { ...x.room, status: 'closed' }, run: null, proposal: { ...x.proposal, status } })).toEqual({ ok: false, reasons: [{ code }] });
});
it('08-U13 incomplete approval set does not affect isExecutable; old creation cv passes', () => {
  const x = current();
  expect(isCurrentForApproval(x)).toBe(true);
  expect(isExecutable(plugin, x)).toEqual({ ok: true });
  expect(allApproved(pending())).toBe(false);
  expect(canExecuteNow(plugin, { ...x, approvalSet: pending() })).toEqual({ ok: false, reasons: [{ code: 'approval.missing_role', role: 'customer' }] });
});
it('08-U13 every independent rule block is returned in check order', () => {
  const x = current();
  const p = proposal(input.catalog.filter(r => r.kind === 'item').map(r => r.itemKey));
  expect(isExecutable(plugin, { ...x, proposal: { ...p, _id: 'p', status: 'active' } })).toEqual({ ok: false, reasons: [{ code: 'date.after_deadline' }, { code: 'budget.over' }] });
  expect(passesChecks({ blocking: [] })).toBe(true);
  expect(passesChecks({ blocking: ['budget.over'] })).toBe(false);
});
it('08-U6 withdraw on an old cv is pending', () => {
  const set = evaluateApprovalSet({ required: [{ role: 'customer', kind: 'terms' }], members: [{ role: 'customer', userId: 'u' }], rows: [{ id: 'a', userId: 'u', role: 'customer', kind: 'terms', decision: 'withdraw', seq: 2, boundConstraintsVersion: 1, boundTermsKey: 't' }], roomConstraintsVersion: 2, termsKey: 't' });
  expect(set.slots[0]?.slot).toEqual({ state: 'pending', userId: 'u' });
});
it('T06-S6 single isExecutable export', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [readFileSync(`${dir}/${entry.name}`, 'utf8')] : []);
  expect(sources('core').join('\n').match(/export function isExecutable\b/g)).toHaveLength(1);
});
it('08-U13 retains system-view and terms-key integrity assertions', () => {
  const x = current();
  expect(() => isExecutable(plugin, { ...x, input: { ...input, viewer: 'provider' } })).toThrow('execution_on_view');
  expect(() => isExecutable(plugin, { ...x, proposal: { ...x.proposal, termsKey: canonicalJson({}) } })).toThrow('terms_key');
});
it('14-6.4 feasibility enumeration accepts limit Infinity', () => {
  const opts = { mode: 'feasibility' as const, anchor: false, exclude: [], mustInclude: [] };
  const all = enumerateCandidates(plugin, input, { ...opts, limit: Infinity });
  expect(all.items.length).toBeGreaterThan(1);
  expect(enumerateCandidates(plugin, input, { ...opts, limit: 1 })).toEqual(all);
  expect(() => enumerateCandidates(plugin, input, { ...opts, mode: 'snapshot', limit: Infinity })).toThrow('invalid_limit');
  expect(isExecutable(plugin, { ...current(), input: { ...input, capCents: cents(0) } }).ok).toBe(false);
});

it.each([
  'item.unknown', 'item.duplicate', 'date.invalid', 'amount.out_of_range', 'item.retired',
  'version.stale_source', 'amount.claim_mismatch', 'date.in_past', 'date.out_of_range',
  'item.required_missing', 'date.after_deadline', 'budget.below_committed', 'budget.over',
])('08-U13 rule block %s is retained', code => {
  const x = current();
  if (code === 'item.unknown') x.proposal.terms.itemKeys = ['absent_item'];
  if (code === 'item.duplicate') x.proposal.terms.itemKeys.push(x.proposal.terms.itemKeys[0]!);
  if (code === 'date.invalid') x.proposal.terms.deliveryDate = 'invalid' as typeof x.proposal.terms.deliveryDate;
  if (code === 'amount.out_of_range') x.proposal.terms.amountCents = -1 as typeof x.proposal.terms.amountCents;
  if (code === 'item.retired') x.input = { ...input, catalog: input.catalog.map(row => ({ ...row, status: 'retired' })) };
  if (code === 'version.stale_source') x.input = { ...input, catalog: input.catalog.map(row => ({ ...row, revision: row.revision + 1 })) };
  if (code === 'amount.claim_mismatch') x.proposal.terms.amountCents = cents(1);
  if (code === 'date.in_past') x.proposal.terms.deliveryDate = '2026-01-01' as typeof x.proposal.terms.deliveryDate;
  if (code === 'date.out_of_range') x.proposal.terms.deliveryDate = '2030-01-01' as typeof x.proposal.terms.deliveryDate;
  if (code === 'item.required_missing') x.input = { ...input, requiredItemKeys: ['absent_item'] };
  if (code === 'date.after_deadline') x.input = { ...input, deadline: input.localDate };
  if (code === 'budget.below_committed') x.input = { ...input, capCents: cents(1) };
  if (code === 'budget.over') x.input = { ...input, capCents: input.committedCents };
  x.proposal.termsKey = canonicalJson(x.proposal.terms);
  const result = isExecutable(plugin, x);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected rule block');
  expect(result.reasons).toContainEqual({ code });
  expect(result.reasons.some(reason => ['approval.not_current', 'version.stale_constraints', 'approval.already_executed'].includes(reason.code))).toBe(false);
});
