import { ITEM_KEY_RE } from '../keys';
import type { ScenarioPlugin } from '../plugin';
import { addDays, isIsoDate } from '../dates';
import { isCents, cents } from '../money';
import type { CheckDecl, CheckOutcome, CheckResult, Evaluation, ProposalLike, RuleInputBase, View } from './types';
import { PluginContractError } from './types';
import { checkBudget } from './budget';
import { claimMismatch, staleSource } from './materialize';
export const CHECK_ORDER = ['terms_shape', 'items_known', 'items_live', 'source_current', 'amount_consistent', 'date_window'] as const;
export const passesChecks = (v: { blocking: readonly unknown[] }): boolean => v.blocking.length === 0;
export function checkProposal<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, input: View<RI>, x: ProposalLike): Evaluation {
  const owner = p.roles.find(r => r.budgetOwner)?.role ?? null;
  const requires = [['capCents', 'committedCents'], ['headroomCents']];
  const budget = (amount = x.terms.amountCents): CheckOutcome => {
    if (input.capCents !== undefined && input.committedCents !== undefined) return checkBudget({ amountCents: amount, capCents: input.capCents, committedCents: input.committedCents });
    if (input.headroomCents !== undefined) return checkBudget({ amountCents: amount, headroomCents: input.headroomCents });
    return { unknown: true };
  };
  const keys = (): string[] => [...(Array.isArray(x.terms.itemKeys) ? x.terms.itemKeys : []), ...(Array.isArray(x.terms.modifiers) ? x.terms.modifiers : [])];
  const engine = (checkId: string, dependsOn: string[], run: () => CheckOutcome): CheckDecl<RI> => ({ checkId, dependsOn, run, owner: null, requires: [] });
  const decls: CheckDecl<RI>[] = [
    engine('terms_shape', [], (): CheckOutcome => {
      const t = x.terms;
      if (!Array.isArray(t.itemKeys) || t.itemKeys.length === 0 || !Array.isArray(t.modifiers)) return { ok: false, code: 'item.unknown', params: { itemKeys: [] } };
      const invalid = keys().filter(k => typeof k !== 'string' || !ITEM_KEY_RE.test(k));
      if (invalid.length) return { ok: false, code: 'item.unknown', params: { itemKeys: invalid.filter(k => typeof k === 'string') } };
      const overlap = t.itemKeys.filter(k => t.modifiers.includes(k));
      if (overlap.length) return { ok: false, code: 'item.duplicate', params: { itemKeys: overlap } };
      for (const list of [t.itemKeys, t.modifiers]) if (list.some((k, n) => n > 0 && list[n - 1]! >= k)) return { ok: false, code: 'item.duplicate', params: { itemKeys: [...list] } };
      if (!isIsoDate(t.deliveryDate) || t.deliveryDate.startsWith('0000-')) return { ok: false, code: 'date.invalid', params: { field: 'deliveryDate' } };
      if (!isCents(t.amountCents)) return { ok: false, code: 'amount.out_of_range', params: { field: 'amountCents' } };
      return { ok: true };
    }),
    engine('items_known', ['terms_shape'], () => {
      const itemKeys = [...x.terms.itemKeys.filter(k => !input.catalog.some(r => r.itemKey === k && r.kind === 'item')), ...x.terms.modifiers.filter(k => !input.catalog.some(r => r.itemKey === k && r.kind === 'modifier'))];
      return itemKeys.length ? { ok: false, code: 'item.unknown', params: { itemKeys } } : { ok: true };
    }),
    engine('items_live', ['items_known'], () => {
      const itemKeys = keys().filter(k => input.catalog.find(r => r.itemKey === k)?.status !== 'confirmed');
      return itemKeys.length ? { ok: false, code: 'item.retired', params: { itemKeys } } : { ok: true };
    }),
    engine('source_current', ['items_live'], () => staleSource(x, input.catalog)),
    engine('amount_consistent', ['terms_shape'], () => claimMismatch(x)),
    engine('date_window', ['terms_shape'], (): CheckOutcome => {
      if (x.terms.deliveryDate < input.localDate) return { ok: false, code: 'date.in_past', params: { localDate: input.localDate } };
      const max = addDays(input.localDate, 365);
      return x.terms.deliveryDate > max ? { ok: false, code: 'date.out_of_range', params: { field: 'deliveryDate', min: input.localDate, max } } : { ok: true };
    }), ...p.checks,
    { checkId: 'budget_state', owner, requires, dependsOn: [], run: () => budget(cents(0)) },
    { checkId: 'budget_fit', owner, requires, dependsOn: ['budget_state', 'amount_consistent'], run: () => budget() },
  ];
  const checks: CheckResult[] = [];
  for (const d of decls) {
    const deps = d.dependsOn.map(id => checks.find(c => c.checkId === id));
    if (deps.some(c => !c)) throw new PluginContractError('invalid_dependency');
    let outcome: CheckOutcome | undefined;
    let status: CheckResult['status'];
    if (deps.some(c => c?.status === 'fail' || c?.status === 'not_evaluated')) status = 'not_evaluated';
    else if (deps.some(c => c?.status === 'unknown')) status = 'unknown';
    else {
      try { outcome = d.run({ input, proposal: x, terms: x.terms, lines: x.lines }); } catch { throw new PluginContractError('check_failed'); }
      status = 'unknown' in outcome ? 'unknown' : outcome.ok ? 'pass' : 'fail';
    }
    checks.push({ checkId: d.checkId, owner: d.owner, status, code: outcome && 'ok' in outcome && !outcome.ok ? outcome.code : null, params: outcome && 'params' in outcome ? outcome.params ?? {} : {} });
  }
  const fit = budget();
  const amounts: Evaluation['amounts'] = { amountCents: x.terms.amountCents };
  if (input.capCents !== undefined) amounts.capCents = input.capCents;
  if (input.committedCents !== undefined) amounts.committedCents = input.committedCents;
  if (input.headroomCents !== undefined) amounts.headroomCents = input.headroomCents;
  else if (input.capCents !== undefined && input.committedCents !== undefined) amounts.headroomCents = input.capCents - input.committedCents;
  if (input.committedCents !== undefined && isCents(x.terms.amountCents) && isCents(input.committedCents + x.terms.amountCents)) amounts.committedAfterCents = cents(input.committedCents + x.terms.amountCents);
  if ('ok' in fit && !fit.ok && fit.code === 'budget.over' && typeof fit.params?.overByCents === 'number') amounts.overByCents = cents(fit.params.overByCents);
  const blocking = [...new Set(checks.flatMap(c => c.status === 'fail' && c.code ? [c.code] : []))];
  return { terms: checks.filter(c => ['terms_shape', 'items_known', 'items_live', 'amount_consistent'].includes(c.checkId)).every(c => c.status === 'pass') ? x.terms : null, checks, blocking, passesChecks: blocking.length === 0, amounts, provenance: { seededCatalog: input.catalog.some(r => keys().includes(r.itemKey) && r.provenance === 'seeded'), seededLedger: false } };
}
