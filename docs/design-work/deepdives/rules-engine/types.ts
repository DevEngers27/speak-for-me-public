// scenarios/scope-change/types.ts — input/output shapes of the scope_change rules.
import type { ReasonCode, ScopeChangeCheckId } from './codes.ts';
import type { Cents, IsoDate } from './primitives.ts';
import type { CheckResult } from './engine.ts';

export type CatalogItem = {
  itemKey: string;
  revision: number; // +1 on every confirmed change to price/dates/validity
  priceCents: Cents;
  standardDeliveryDate: IsoDate; // earliest delivery without rush
  rushDeliveryDate?: IsoDate; // earliest delivery with rush (<= standard)
  status: 'confirmed' | 'unconfirmed';
  validUntil?: IsoDate; // quote expiry, inclusive
  simulated: boolean;
};
export type Catalog = { items: readonly CatalogItem[]; rushFee?: { chargeKey: string; amountCents: Cents } };
export type CustomerConstraints = {
  requiredItemKeys: readonly string[];
  deferrableItemKeys: readonly string[];
  deadline: IsoDate; // hard, inclusive
  preferredDate?: IsoDate; // soft
};
export type BudgetInput = { capCents: Cents; commitments: readonly { amountCents: Cents }[] };
export type ScopeChangeTerms = { itemKeys: readonly string[]; deferredItemKeys: readonly string[]; deliveryDate: IsoDate };
export type PricingLine = { itemKey: string; revision: number; priceCents: Cents };
export type Pricing = {
  lines: PricingLine[];
  charges: { chargeKey: string; amountCents: Cents }[];
  rush: boolean;
  additionalCostCents: Cents;
};
export type ScopeChangeInput = {
  today: IsoDate;
  catalog: Catalog;
  customer: CustomerConstraints | null; // null = brief not confirmed
  budget: BudgetInput | null; // null = budget not set
  terms: ScopeChangeTerms;
  pricingSnapshot: Pricing | null; // stored on the proposal; null while drafting a new proposal
};
export type Amounts = {
  additionalCostCents: Cents; committedCents: Cents; capCents: Cents;
  committedAfterCents: Cents; headroomCents: number; overByCents: Cents;
};
export type Evaluation = {
  executable: boolean;
  blocking: ReasonCode[];
  info: ReasonCode[];
  checks: CheckResult<ScopeChangeCheckId>[];
  pricing: Pricing | null;
  amounts: Amounts | null; // buyer-side only after projection
};

