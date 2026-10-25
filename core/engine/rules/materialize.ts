import { canonicalJson } from '../canonicalJson';
import { addDays } from '../dates';
import type { IsoDate } from '../dates';
import { candidateKey } from '../keys';
import { isCents, cents, MAX_CENTS } from '../money';
import type { CandidateDraft, CatalogRow, Materialized, ProposalLike, CheckOutcome } from './types';
import { PluginContractError } from './types';
/** Only snapshot data participates in the amount assertion. */
export function claimMismatch(x: ProposalLike): CheckOutcome {
  const keys = [...x.terms.itemKeys, ...x.terms.modifiers].sort();
  const lineKeys = x.lines.map(l => l.itemKey).sort();
  if (keys.length !== lineKeys.length || keys.some((k, n) => k !== lineKeys[n]) || new Set(lineKeys).size !== lineKeys.length) return { ok: false, code: 'amount.claim_mismatch' };
  let total = 0;
  for (const l of x.lines) {
    if (!isCents(l.priceCents) || total + l.priceCents > MAX_CENTS) return { ok: false, code: 'amount.out_of_range', params: { field: 'lines' } };
    total += l.priceCents;
  }
  return total === x.terms.amountCents ? { ok: true } : { ok: false, code: 'amount.claim_mismatch' };
}
export function staleSource(x: ProposalLike, catalog: readonly CatalogRow[]): CheckOutcome {
  const expected = [...x.terms.itemKeys, ...x.terms.modifiers];
  const itemKeys = [...new Set([...expected, ...x.lines.map(l => l.itemKey)])].filter(k => {
    const lines = x.lines.filter(l => l.itemKey === k);
    const current = catalog.find(r => r.itemKey === k);
    return !expected.includes(k) || lines.length !== 1 || !current || current.revision !== lines[0]!.revision;
  }).sort();
  return itemKeys.length ? { ok: false, code: 'version.stale_source', params: { itemKeys } } : { ok: true };
}
/** The scenario supplies the meaning of lead times through this pure callback. */
export function materializeTerms(d: CandidateDraft, catalog: readonly CatalogRow[], localDate: IsoDate, effectiveLeadDays: (rows: readonly CatalogRow[]) => number): Materialized | null {
  const itemKeys = [...d.itemKeys].sort();
  const modifiers = [...d.modifiers].sort();
  if (itemKeys.some(k => modifiers.includes(k))) throw new PluginContractError('invalid_candidate');
  const key = candidateKey(itemKeys, modifiers);
  const resolve = (keys: readonly string[], kind: CatalogRow['kind']) => keys.map(k => {
    const row = catalog.find(r => r.itemKey === k && r.kind === kind);
    if (!row || row.status !== 'confirmed') throw new PluginContractError('invalid_candidate');
    return row;
  });
  const rows = [...resolve(itemKeys, 'item'), ...resolve(modifiers, 'modifier')].sort((a, b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0);
  let amount = 0;
  for (const r of rows) {
    if (!isCents(r.priceCents)) throw new PluginContractError('invalid_amount');
    amount += r.priceCents;
    if (amount > MAX_CENTS) return null;
  }
  const days = effectiveLeadDays(rows);
  if (!Number.isSafeInteger(days) || days < 0 || days > 365) throw new PluginContractError('invalid_lead_days');
  const deliveryDate = addDays(localDate, days);
  const terms = { itemKeys, modifiers, amountCents: cents(amount), deliveryDate };
  return { candidateKey: key, termsKey: canonicalJson(terms), terms, lines: rows.map(r => ({ itemKey: r.itemKey, revision: r.revision, title: r.title, priceCents: r.priceCents, leadDays: r.leadDays })), plannedTasks: rows.flatMap(r => r.taskTemplates.map((t, templateIndex) => ({ ...t, itemKey: r.itemKey, templateIndex, dueDate: deliveryDate }))) };
}
