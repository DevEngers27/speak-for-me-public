import type { ScenarioPlugin } from '../plugin';
import type { ReasonCode } from '../reasonCodes';
import { canonicalJson } from '../canonicalJson';
import { candidateKey } from '../keys';
import { isCents } from '../money';
import { isIsoDate } from '../dates';
import type { RuleInputBase, View, Materialized, SnapshotItem } from './types';
import { PluginContractError } from './types';
import { checkProposal } from './checkProposal';
import { claimMismatch } from './materialize';
export type EnumerateOpts = { mode: 'snapshot' | 'feasibility'; limit?: number; anchor: boolean; exclude: readonly string[]; mustInclude: readonly string[] };
export function enumerateCandidates<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, view: View<RI>, o: EnumerateOpts): { items: SnapshotItem[]; materialized: Materialized[]; emptyReasons: ReasonCode[] } {
  const limit = o.limit ?? 12;
  if (o.mode !== 'feasibility' && (!Number.isSafeInteger(limit) || limit < 1 || limit > 12)) throw new PluginContractError('invalid_limit');
  const space = p.candidateSpace(view);
  const seen = new Set<string>();
  const ok: Materialized[] = [];
  for (const d of space.drafts) {
    const m = p.materialize(d, view.catalog, view.localDate);
    if (m === null) continue;
    const claim = claimMismatch(m);
    if (!isCents(m.terms.amountCents) || !isIsoDate(m.terms.deliveryDate) || !('ok' in claim) || !claim.ok || m.candidateKey !== candidateKey(m.terms.itemKeys, m.terms.modifiers) || m.termsKey !== canonicalJson(m.terms)) throw new PluginContractError('invalid_materialized');
    if (seen.has(m.candidateKey) || o.exclude.includes(m.candidateKey)) continue;
    seen.add(m.candidateKey);
    if (checkProposal(p, view, m).passesChecks) ok.push(m);
  }
  const byKey = (a: Materialized, b: Materialized) => a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0;
  const label = (ms: Materialized[]): SnapshotItem[] => ms.map((m, n) => ({ optionKey: `O${n + 1}`, candidateKey: m.candidateKey, itemKeys: [...m.terms.itemKeys], modifiers: [...m.terms.modifiers], amountCents: m.terms.amountCents, deliveryDate: m.terms.deliveryDate }));
  if (o.mode === 'feasibility') { ok.sort(byKey); return { items: label(ok), materialized: ok, emptyReasons: space.emptyReasons }; }
  const pool = [...ok].sort((a, b) => a.terms.amountCents - b.terms.amountCents || byKey(a, b));
  const chosen: Materialized[] = [];
  if (o.anchor && pool[0]) chosen.push(pool[0]);
  for (const k of o.mustInclude) {
    const m = pool.find(m => m.candidateKey === k);
    if (m && !chosen.includes(m)) chosen.push(m);
  }
  if (chosen.length > limit) throw new PluginContractError('must_include_exceeds_limit');
  for (const m of pool) { if (chosen.length >= limit) break; if (!chosen.includes(m)) chosen.push(m); }
  const head = o.anchor ? chosen.slice(0, 1) : [];
  const ordered = [...head, ...chosen.filter(m => !head.includes(m)).sort(byKey)];
  return { items: label(ordered), materialized: ordered, emptyReasons: space.emptyReasons };
}
