// scenarios/scope-change/fixture.ts — SIMULATED example (F14.2 catalog 1). Tests derive every number from here.
import type { BudgetInput, Catalog, CustomerConstraints, ScopeChangeTerms } from './types.ts';

export const SIMULATED = true as const;
export const TODAY = '2026-10-26';

export const catalog: Catalog = {
  rushFee: { chargeKey: 'RUSH', amountCents: 10_000 },
  items: [
    { itemKey: 'LOGIN', revision: 1, priceCents: 45_000, standardDeliveryDate: '2026-11-20', rushDeliveryDate: '2026-11-13', status: 'confirmed', simulated: true },
    { itemKey: 'REPORTS', revision: 1, priceCents: 35_000, standardDeliveryDate: '2026-11-20', rushDeliveryDate: '2026-11-13', status: 'confirmed', simulated: true },
    { itemKey: 'EXPORT', revision: 1, priceCents: 50_000, standardDeliveryDate: '2026-11-27', rushDeliveryDate: '2026-11-20', status: 'confirmed', simulated: true },
  ],
};

export const customer: CustomerConstraints = {
  requiredItemKeys: ['LOGIN'],
  deferrableItemKeys: ['EXPORT'],
  preferredDate: '2026-11-13',
  deadline: '2026-11-27',
};

export const baselineCommitment = { kind: 'baseline' as const, amountCents: 400_000, simulated: true };
export const budgetAt = (capCents: number): BudgetInput => ({ capCents, commitments: [baselineCommitment] });
export const CAP_INITIAL = 500_000;
export const CAP_AFTER_CUT = 480_000;
export const CAP_INFEASIBLE = 440_000;

export const terms = {
  phase1Rush: { itemKeys: ['LOGIN', 'REPORTS'], deferredItemKeys: ['EXPORT'], deliveryDate: '2026-11-13' },
  phase1Standard: { itemKeys: ['LOGIN', 'REPORTS'], deferredItemKeys: ['EXPORT'], deliveryDate: '2026-11-20' },
  loginRush: { itemKeys: ['LOGIN'], deferredItemKeys: ['EXPORT'], deliveryDate: '2026-11-13' },
  fullRush: { itemKeys: ['EXPORT', 'LOGIN', 'REPORTS'], deferredItemKeys: [], deliveryDate: '2026-11-20' },
} satisfies Record<string, ScopeChangeTerms>;
