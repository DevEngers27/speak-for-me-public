// engine/rules/projection.ts — per-viewer view of an Evaluation. The authoritative matrix lives in 07;
// this is the proposed default. Runs inside Convex queries before anything reaches the browser.
import type { ReasonCode } from './codes.ts';
import type { CheckResult } from './engine.ts';
import type { Evaluation } from './types.ts';

export type ViewerRole = 'customer' | 'provider' | 'finance';
export type Disclosure = { deadlineShared: boolean; requiredItemsShared: boolean };

type Owner = { owner: 'customer'; sharedBy?: keyof Disclosure } | { owner: 'buyers' };
const OWNED: Partial<Record<ReasonCode, Owner>> = {
  AFTER_DEADLINE: { owner: 'customer', sharedBy: 'deadlineShared' },
  DATE_CONFLICT: { owner: 'customer', sharedBy: 'deadlineShared' },
  MISSING_REQUIRED_ITEM: { owner: 'customer', sharedBy: 'requiredItemsShared' },
  REQUIRED_ITEM_NOT_OFFERED: { owner: 'customer', sharedBy: 'requiredItemsShared' },
  MISSES_PREFERRED_DATE: { owner: 'customer' },
  SHOULD_ITEM_EXCLUDED: { owner: 'customer' },
  FITS_BUDGET: { owner: 'buyers' },
  OVER_BUDGET: { owner: 'buyers' },
  BUDGET_BELOW_COMMITTED: { owner: 'buyers' },
};

export type ProjectedEvaluation = Omit<Evaluation, 'amounts' | 'checks'> & {
  checks: CheckResult[];
  amounts: Evaluation['amounts'] | null;
};

export function projectEvaluation(e: Evaluation, viewer: ViewerRole, d: Disclosure): ProjectedEvaluation {
  const buyer = viewer === 'customer' || viewer === 'finance';
  const checks: CheckResult[] = [];
  for (const c of e.checks) {
    const o = OWNED[c.code];
    if (!o) { checks.push(c); continue; }
    if (o.owner === 'buyers') { checks.push(buyer ? c : { ...c, params: {} }); continue; }
    if (viewer === 'customer') { checks.push(c); continue; }
    if (o.sharedBy && d[o.sharedBy]) { checks.push(c); continue; }
    if (!o.sharedBy) continue; // private soft preference: invisible to others
    checks.push({ ...c, code: 'PRIVATE_CONSTRAINT_UNMET', params: {} });
  }
  const pick = (sev: 'block' | 'info') => {
    const out: ReasonCode[] = [];
    for (const c of checks) if (c.status === 'fail' && c.severity === sev && !out.includes(c.code)) out.push(c.code);
    return out;
  };
  return { executable: e.executable, blocking: pick('block'), info: pick('info'), checks,
    pricing: e.pricing, amounts: buyer ? e.amounts : null };
}
