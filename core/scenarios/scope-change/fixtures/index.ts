// Scope-change fixtures. Zod validation of this shape lives under convex/, not here.
import { resolveDayOffset, type IsoDate } from "./anchor";
import type { CustomerBrief, ScopeChangeFixture } from "./main";

export type MaterializedScopeChangeFixture = Omit<ScopeChangeFixture, "briefs"> & {
  readonly localDate: IsoDate;
  readonly briefs: Omit<ScopeChangeFixture["briefs"], "customer"> & {
    readonly customer: Omit<CustomerBrief, "hardFields"> & {
      readonly hardFields: Omit<CustomerBrief["hardFields"], "deadline"> & { readonly deadline: IsoDate };
    };
  };
};

/** Resolve every stored day offset against the room's `localDate`. */
export function materializeFixture(fx: ScopeChangeFixture, localDate: IsoDate): MaterializedScopeChangeFixture {
  return {
    ...fx,
    localDate,
    briefs: {
      ...fx.briefs,
      customer: {
        ...fx.briefs.customer,
        hardFields: {
          ...fx.briefs.customer.hardFields,
          deadline: resolveDayOffset(localDate, fx.briefs.customer.hardFields.deadline),
        },
      },
    },
  };
}

export { addDays, daysBetween, GOLDEN_ANCHOR, isoDate, resolveDayOffset } from "./anchor";
export type { DayOffset, IsoDate } from "./anchor";
export {
  CANARY_CUSTOMER,
  CANARY_FINANCE,
  CANARY_PROVIDER,
  CANARY_RATIONALE,
  canaryAmounts,
  canarySecrets,
  lintCanaries,
  publicMoneyText,
} from "./canaries";
export type { CanaryLintIssue, CanarySecret, PublicText } from "./canaries";
export { main, proposalExpectations } from "./main";
export type {
  CatalogRow,
  CustomerBrief,
  FinanceBrief,
  LedgerBaseline,
  ProposalExpectation,
  ProviderBrief,
  Role,
  RoomSeed,
  ScopeChangeFixture,
} from "./main";
export { canaryFixture, fixtureForVariant, namedScripts, variantByKey, variants } from "./variants";
export type { VariantExpected, VariantKey, VariantSpec } from "./variants";
