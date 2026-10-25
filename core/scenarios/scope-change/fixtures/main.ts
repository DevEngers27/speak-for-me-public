import { SCENARIO_KEY } from "../constants";
// Main scope_change seed. Dates are day offsets from the room localDate.
import { GOLDEN_ANCHOR, type DayOffset, type IsoDate } from "./anchor";

export type Role = "customer" | "provider" | "finance";
export type Provenance = "seeded";
export type ItemKind = "item" | "modifier";
export type CatalogStatus = "confirmed";

export interface TaskTemplate {
  readonly title: string;
  readonly assigneeRole: "provider";
}

export interface CatalogRow {
  readonly itemKey: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly priceCents: number;
  readonly leadDays: number;
  readonly taskTemplates: readonly TaskTemplate[];
  readonly status: CatalogStatus;
  readonly revision: 1;
  readonly provenance: Provenance;
}

export interface RoomSeed {
  readonly title: string;
  readonly timeZone: string;
  readonly creatorRole: Role;
  readonly scenarioKey: typeof SCENARIO_KEY;
  readonly scenarioVersion: 1;
  readonly provenance: Provenance;
}

export interface CustomerBrief {
  readonly hardFields: {
    readonly requiredItemKeys: readonly string[];
    readonly deadline: DayOffset;
  };
  readonly softFields: {
    readonly preferredItemKeys: readonly string[];
    readonly notes: string;
  };
  readonly disclosures: {
    readonly requiredItemKeys: readonly ("provider" | "finance")[];
    readonly deadline: readonly ("provider" | "finance")[];
    readonly preferredItemKeys: readonly ("provider" | "finance")[];
  };
  readonly provenance: Provenance;
}

export interface FinanceBrief {
  readonly hardFields: { readonly capCents: number };
  readonly softFields: { readonly notes: string };
  readonly disclosures: {
    readonly capCents: readonly "customer"[];
    readonly committedCents: readonly "customer"[];
    readonly headroomCents: readonly "customer"[];
  };
  readonly provenance: Provenance;
}

export interface ProviderBrief {
  readonly hardFields: Record<string, never>;
  readonly softFields: { readonly notes: string };
  readonly disclosures: Record<string, never>;
  readonly provenance: Provenance;
}

export interface LedgerBaseline {
  readonly kind: "baseline";
  readonly amountCents: number;
  readonly note: string;
  readonly provenance: Provenance;
}

export interface ScopeChangeFixture {
  readonly key: string;
  readonly label: string;
  readonly goldenAnchor: IsoDate;
  readonly room: RoomSeed;
  readonly catalog: readonly CatalogRow[];
  readonly ledgerBaselineCents: number;
  readonly ledgerBaseline: LedgerBaseline;
  readonly briefs: {
    readonly provider: ProviderBrief;
    readonly customer: CustomerBrief;
    readonly finance: FinanceBrief;
  };
  readonly confirmOrder: readonly [Role, Role, Role];
  readonly provenance: Provenance;
}

export interface ProposalExpectation {
  readonly constraintsVersion: 1 | 2 | 3;
  readonly capCents: number;
  readonly id: string;
  readonly itemKeys: readonly string[];
  readonly modifierKeys: readonly string[];
  readonly itemsTotalCents: number;
  readonly deliveryOffsetDays: number;
  readonly feasible: boolean;
  /** Empty when the candidate fits. Canon reason codes when it does not. */
  readonly reasonCodes: readonly ("date.after_deadline" | "budget.over")[];
  /** Feasible rush row that must not be enumerated because the base row already meets the deadline. */
  readonly notEnumeratedBecause?: "base_meets_deadline";
}

const seeded = "seeded" as const;

export const main: ScopeChangeFixture = {
  key: "main",
  label: "Simulated example",
  goldenAnchor: GOLDEN_ANCHOR,
  room: {
    title: "Q4 portal scope change (simulated)",
    timeZone: "America/Los_Angeles",
    creatorRole: "customer",
    scenarioKey: SCENARIO_KEY,
    scenarioVersion: 1,
    provenance: seeded,
  },
  catalog: [
    { itemKey: "sso_login", kind: "item", title: "SSO login (SAML)", priceCents: 50_000, leadDays: 11, taskTemplates: [{ title: "Implement SAML SSO login", assigneeRole: "provider" }], status: "confirmed", revision: 1, provenance: seeded },
    { itemKey: "audit_log_export", kind: "item", title: "Audit log export", priceCents: 30_000, leadDays: 14, taskTemplates: [{ title: "Build audit log CSV export", assigneeRole: "provider" }], status: "confirmed", revision: 1, provenance: seeded },
    { itemKey: "usage_dashboard", kind: "item", title: "Usage dashboard", priceCents: 10_000, leadDays: 16, taskTemplates: [{ title: "Build usage dashboard", assigneeRole: "provider" }], status: "confirmed", revision: 1, provenance: seeded },
    { itemKey: "slack_alerts", kind: "item", title: "Slack alerts", priceCents: 25_000, leadDays: 25, taskTemplates: [{ title: "Wire Slack alert webhooks", assigneeRole: "provider" }], status: "confirmed", revision: 1, provenance: seeded },
    { itemKey: "custom_theme", kind: "item", title: "Custom theme", priceCents: 25_000, leadDays: 32, taskTemplates: [{ title: "Apply custom theme", assigneeRole: "provider" }], status: "confirmed", revision: 1, provenance: seeded },
    { itemKey: "rush", kind: "modifier", title: "Rush delivery", priceCents: 15_000, leadDays: 4, taskTemplates: [], status: "confirmed", revision: 1, provenance: seeded },
  ],
  ledgerBaselineCents: 400_000,
  ledgerBaseline: {
    kind: "baseline",
    amountCents: 400_000,
    note: "Existing SOW commitments (simulated)",
    provenance: seeded,
  },
  briefs: {
    provider: {
      hardFields: {},
      softFields: { notes: "Team capacity is tight in December." },
      disclosures: {},
      provenance: seeded,
    },
    customer: {
      hardFields: {
        requiredItemKeys: ["audit_log_export", "sso_login"],
        deadline: { offsetDays: 18 },
      },
      softFields: {
        preferredItemKeys: ["slack_alerts", "usage_dashboard"],
        notes: "Security audit starts right after the deadline.",
      },
      disclosures: {
        requiredItemKeys: ["provider", "finance"],
        deadline: ["provider", "finance"],
        preferredItemKeys: ["provider"],
      },
      provenance: seeded,
    },
    finance: {
      hardFields: { capCents: 500_000 },
      softFields: { notes: "Q4 forecast is tight; keep a reserve." },
      disclosures: { capCents: ["customer"], committedCents: [], headroomCents: [] },
      provenance: seeded,
    },
  },
  confirmOrder: ["provider", "customer", "finance"],
  provenance: seeded,
};

/** §9.3 constraint sets. Amounts and delivery offsets are checked against the catalog. */
export const proposalExpectations: readonly ProposalExpectation[] = [
  {
    constraintsVersion: 1,
    capCents: 500_000,
    id: "full-request",
    itemKeys: ["sso_login", "audit_log_export", "usage_dashboard", "slack_alerts", "custom_theme"],
    modifierKeys: [],
    itemsTotalCents: 140_000,
    deliveryOffsetDays: 32,
    feasible: false,
    reasonCodes: ["date.after_deadline", "budget.over"],
  },
  {
    constraintsVersion: 1,
    capCents: 500_000,
    id: "phase-one",
    itemKeys: ["audit_log_export", "sso_login", "usage_dashboard"],
    modifierKeys: [],
    itemsTotalCents: 90_000,
    deliveryOffsetDays: 16,
    feasible: true,
    reasonCodes: [],
  },
  {
    constraintsVersion: 1,
    capCents: 500_000,
    id: "required-only",
    itemKeys: ["audit_log_export", "sso_login"],
    modifierKeys: [],
    itemsTotalCents: 80_000,
    deliveryOffsetDays: 14,
    feasible: true,
    reasonCodes: [],
  },
  {
    constraintsVersion: 1,
    capCents: 500_000,
    id: "required-rush",
    itemKeys: ["audit_log_export", "sso_login"],
    modifierKeys: ["rush"],
    itemsTotalCents: 95_000,
    deliveryOffsetDays: 10,
    feasible: true,
    reasonCodes: [],
    notEnumeratedBecause: "base_meets_deadline",
  },
  {
    constraintsVersion: 2,
    capCents: 480_000,
    id: "phase-one-after-cut",
    itemKeys: ["audit_log_export", "sso_login", "usage_dashboard"],
    modifierKeys: [],
    itemsTotalCents: 90_000,
    deliveryOffsetDays: 16,
    feasible: false,
    reasonCodes: ["budget.over"],
  },
  {
    constraintsVersion: 2,
    capCents: 480_000,
    id: "required-only-after-cut",
    itemKeys: ["audit_log_export", "sso_login"],
    modifierKeys: [],
    itemsTotalCents: 80_000,
    deliveryOffsetDays: 14,
    feasible: true,
    reasonCodes: [],
  },
  {
    constraintsVersion: 3,
    capCents: 470_000,
    id: "required-only-4700",
    itemKeys: ["audit_log_export", "sso_login"],
    modifierKeys: [],
    itemsTotalCents: 80_000,
    deliveryOffsetDays: 14,
    feasible: false,
    reasonCodes: ["budget.over"],
  },
];
