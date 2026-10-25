import { isCents, cents, MAX_CENTS } from '../money';
import type { Cents } from '../money';
import type { ReasonParams } from '../reasonCodes';
export type BudgetResult = { ok: true; committedAfterCents: Cents | null; headroomCents: number } | { ok: false; code: 'budget.over' | 'budget.below_committed' | 'amount.out_of_range'; params: ReasonParams };
export function checkBudget(x: { amountCents: Cents } & ({ capCents: Cents; committedCents: Cents } | { headroomCents: number })): BudgetResult {
  const full = 'capCents' in x;
  const invalidField = !isCents(x.amountCents) ? 'amountCents' : full && !isCents(x.capCents) ? 'capCents' : full && !isCents(x.committedCents) ? 'committedCents' : null;
  if (invalidField) return { ok: false, code: 'amount.out_of_range', params: { field: invalidField } };
  const headroom = full ? x.capCents - x.committedCents : x.headroomCents;
  if (!Number.isSafeInteger(headroom) || Math.abs(headroom) > MAX_CENTS) return { ok: false, code: 'amount.out_of_range', params: { field: 'headroomCents' } };
  if (headroom < 0) return { ok: false, code: 'budget.below_committed', params: { belowByCents: -headroom } };
  const after = full ? x.committedCents + x.amountCents : null;
  if (after !== null && !isCents(after)) return { ok: false, code: 'amount.out_of_range', params: { field: 'committedAfterCents' } };
  if (x.amountCents > headroom) return { ok: false, code: 'budget.over', params: { overByCents: x.amountCents - headroom, headroomCents: headroom } };
  return { ok: true, committedAfterCents: after === null ? null : cents(after), headroomCents: headroom };
}
export function validateCapChange(capCents: Cents, committedCents: Cents) {
  if (!isCents(capCents) || !isCents(committedCents)) return { ok: false as const, code: 'amount.out_of_range' as const, params: { field: !isCents(capCents) ? 'capCents' : 'committedCents' } };
  return capCents < committedCents ? { ok: false as const, code: 'budget.below_committed' as const, params: { minAllowedCapCents: committedCents } } : { ok: true as const };
}
