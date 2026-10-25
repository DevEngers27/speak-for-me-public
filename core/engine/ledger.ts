import { cents, isCents, sumCents, MoneyError } from './money';

// The money foundation throws; the execution contract represents invalid sums as null.
function safeSum(values: readonly number[]): number | null {
  try { return sumCents(values.map(value => cents(value))); }
  catch (error) { if (error instanceof MoneyError) return null; throw error; }
}
function safeAdd(a: number, b: number): number | null { return safeSum([a, b]); }

export interface LedgerEntryLite { kind: 'baseline' | 'commit'; amountCents: number }
export interface ChangeOrderChain {
  baselineCents: number; priorApprovedDeltaCents: number; amountBeforeCents: number;
  deltaCents: number; amountAfterCents: number; capCents: number; headroomAfterCents: number;
}
export type ChainResult =
  | { ok: true; chain: ChangeOrderChain }
  | { ok: false; code: 'budget.over' }                                    // 规则结论（调用方视上下文处理）
  | { ok: false; invariant: 'baseline_count' | 'cents_out_of_range' };    // 数据损坏 → internal

export function committedCents(entries: readonly LedgerEntryLite[]): number | null {
  return safeSum(entries.map((e) => e.amountCents));                       // 溢出 / 非法 → null
}

export function computeChangeOrderChain(i: {
  entries: readonly LedgerEntryLite[]; deltaCents: number; capCents: number;
}): ChainResult {
  const baselines = i.entries.filter((e) => e.kind === 'baseline');
  if (baselines.length !== 1) return { ok: false, invariant: 'baseline_count' };
  const prior = safeSum(i.entries.filter((e) => e.kind === 'commit').map((e) => e.amountCents));
  const before = prior === null ? null : safeAdd(baselines[0]!.amountCents, prior);
  const after = before === null ? null : safeAdd(before, i.deltaCents);
  if (prior === null || before === null || after === null || !isCents(i.deltaCents) || !isCents(i.capCents))
    return { ok: false, invariant: 'cents_out_of_range' };
  if (after > i.capCents) return { ok: false, code: 'budget.over' };       // 恰等于上限通过（K18）
  return { ok: true, chain: { baselineCents: baselines[0]!.amountCents, priorApprovedDeltaCents: prior,
    amountBeforeCents: before, deltaCents: i.deltaCents, amountAfterCents: after,
    capCents: i.capCents, headroomAfterCents: i.capCents - after } };
}
