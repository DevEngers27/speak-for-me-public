// Proposed location: packages/scenario-scope-change/src/fixture.ts
// (importable by Convex functions, Next.js server code and tests; no Convex/Next imports here)
// EVERYTHING in this file is SIMULATED example data. Seed writes isSimulated: true on every row.

export const FIXTURE_KEY = "scope_change.v1" as const;
export const SIMULATED_BADGE = "Simulated example data" as const;

/** Dates are stored as offsets from an anchor date (room timezone, YYYY-MM-DD).
 *  Canonical anchor used in docs and golden tests: 2026-10-26 (Mon). */
export type DayOffset = { daysFromAnchor: number };
export const CANONICAL_ANCHOR = "2026-10-26" as const;

export type DeliveryTier = "standard" | "expedited";

export const scopeChangeFixture = {
  fixtureKey: FIXTURE_KEY,
  isSimulated: true,
  room: {
    title: "Harbor Lane Clinics - Q4 portal scope change (simulated)",
    timezone: "America/Los_Angeles",
    maxRounds: 2,
  },
  parties: {
    customer: { orgName: "Harbor Lane Clinics (simulated)", personaLabel: "Product owner" },
    provider: { orgName: "Fernway Software (simulated)", personaLabel: "Delivery lead" },
    finance: { orgName: "Harbor Lane Clinics Finance (simulated)", personaLabel: "Budget owner" },
  },

  // ---- Provider-owned catalog (room-visible once provider confirms) ----
  catalog: {
    items: [
      {
        itemKey: "sso_login",
        title: "SSO login (SAML via Okta)",
        priceCents: 45_000,
        effortDays: 4,
        taskTemplates: [
          { key: "sso_impl", title: "Implement SAML SSO login and admin toggle" },
        ],
      },
      {
        itemKey: "usage_reports",
        title: "Monthly usage report dashboard",
        priceCents: 30_000,
        effortDays: 3,
        taskTemplates: [
          { key: "reports_impl", title: "Build monthly usage report dashboard" },
        ],
      },
      {
        itemKey: "csv_export",
        title: "CSV export for audit logs",
        priceCents: 50_000,
        effortDays: 5,
        taskTemplates: [
          { key: "export_impl", title: "Add CSV export for audit logs" },
        ],
      },
    ],
    terms: [
      {
        termKey: "expedite_fee",
        kind: "rush_fee",
        title: "Expedited delivery (priority staffing)",
        deltaCents: 15_000,
        appliesWhen: { deliveryTier: "expedited" as DeliveryTier },
      },
    ],
  },

  // ---- Briefs (seeded as DRAFT; each party must confirm in the UI) ----
  briefs: {
    customer: {
      hard: {
        requiredItemKeys: ["sso_login"],                 // shared
        hardDeadline: { daysFromAnchor: 35 },            // PRIVATE -> 2026-11-30
      },
      soft: {
        wantedItemKeys: ["usage_reports"],               // shared ("want in this phase")
        deferrableItemKeys: ["usage_reports", "csv_export"], // shared
        preferredDate: { daysFromAnchor: 21 },           // shared -> 2026-11-16
        conflictPolicy: "ask_me" as const,               // PRIVATE
      },
      share: ["requiredItemKeys", "wantedItemKeys", "deferrableItemKeys", "preferredDate"],
      privateNote: "Security audit starts Dec 1; SSO must be live before it. CANARY-CUST-7Q2",
    },
    provider: {
      hard: {
        // PRIVATE capacity: earliest delivery for a bundle = first row whose tier matches
        // and maxEffortDays >= sum(effortDays). No row -> bundle not deliverable.
        deliverySchedule: [
          { tier: "expedited" as DeliveryTier, maxEffortDays: 7, delivery: { daysFromAnchor: 21 } },
          { tier: "expedited" as DeliveryTier, maxEffortDays: 12, delivery: { daysFromAnchor: 28 } },
          { tier: "standard" as DeliveryTier, maxEffortDays: 7, delivery: { daysFromAnchor: 28 } },
          { tier: "standard" as DeliveryTier, maxEffortDays: 12, delivery: { daysFromAnchor: 42 } },
        ],
        requireConfirmedScope: true,                     // shared policy text
      },
      soft: { prefersPhasedDelivery: true },             // shared
      share: ["requireConfirmedScope", "prefersPhasedDelivery"],
      privateNote: "Team has 12 effort-days free before Dec 7. CANARY-PROV-4K9",
    },
    finance: {
      // budget lives in `budgets`; finance confirms the seeded values as part of confirming its brief
      budget: { totalBudgetCents: 500_000 },
      baselineCommitment: {
        amountCents: 400_000,
        label: "Existing SOW: portal maintenance Q3-Q4 (simulated)",
      },
      soft: { paymentTerms: "milestone" as const },      // PRIVATE preference
      share: [] as string[],
      budgetDisclosure: "buyer_side" as const,           // customer + finance see numbers; provider never
      privateNote: "Prefer milestone-based payment. CANARY-FIN-8M1",
    },
  },

  // ---- Scripted constraint changes and their expected candidate sets ----
  // Candidate ids: `${sortedItemKeys.join("+")}@${tier}`; expectations list ids only, never amounts,
  // so amounts in tests are always derived from the catalog above.
  variants: {
    mainline: {
      budgetChangeTo: 480_000, reason: "Q4 reforecast: department budget reduced (simulated)",
      expectFeasibleBefore: ["sso_login@standard", "sso_login@expedited",
        "sso_login+usage_reports@standard", "sso_login+usage_reports@expedited"],
      expectFeasibleAfter: ["sso_login@standard", "sso_login@expedited",
        "sso_login+usage_reports@standard"],
      expectCustomerPareto: ["sso_login@expedited", "sso_login+usage_reports@standard"],
      expectOutcome: "tradeoff_request_to_customer" as const,
      scriptedAnswer: "sso_login+usage_reports@standard",
    },
    boundary: {
      budgetChangeTo: 475_000, reason: "Boundary test: cap equals committed + candidate (simulated)",
      expectFeasibleAfter: ["sso_login@standard", "sso_login@expedited",
        "sso_login+usage_reports@standard"],             // 400_000 + 75_000 == 475_000 passes (<=)
      expectOutcome: "tradeoff_request_to_customer" as const,
    },
    boundaryMinusOneCent: {
      budgetChangeTo: 474_999, reason: "Boundary test: one cent below (simulated)",
      expectFeasibleAfter: ["sso_login@standard", "sso_login@expedited"],
      expectCustomerPareto: ["sso_login@expedited"],
      expectOutcome: "single_candidate_negotiation" as const,
    },
    unsolvable: {
      budgetChangeTo: 440_000, reason: "Unsolvable test: headroom below cheapest required bundle (simulated)",
      expectFeasibleAfter: [] as string[],               // 40_000 < 45_000 (sso_login@standard)
      expectOutcome: "tradeoff_request_to_finance" as const,
    },
    belowCommitted: {
      budgetChangeTo: 390_000, reason: "Edge test: cap below committed spend (simulated)",
      expectFeasibleAfter: [] as string[],
      expectOutcome: "budget_below_committed_request_to_finance" as const,
    },
  },
} as const;

// ---------------- pure helpers (no I/O; used by seed, rules, tests) ----------------

export function resolveDate(anchorIso: string, off: DayOffset): string {
  const [y, m, d] = anchorIso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + off.daysFromAnchor * 86_400_000; // calendar days, no DST issue in UTC math
  return new Date(t).toISOString().slice(0, 10);
}

type Fx = typeof scopeChangeFixture;
export type Candidate = {
  id: string; itemKeys: string[]; deferredItemKeys: string[]; tier: DeliveryTier;
  amountCents: number; termKeys: string[]; effortDays: number; deliveryDate: string | null;
};

export function buildCandidate(fx: Fx, anchorIso: string, itemKeys: string[], tier: DeliveryTier): Candidate {
  const keys = [...itemKeys].sort();
  const items = fx.catalog.items.filter((i) => keys.includes(i.itemKey));
  if (items.length !== keys.length) throw new Error("UNKNOWN_ITEM");
  const terms = fx.catalog.terms.filter((t) => t.appliesWhen.deliveryTier === tier);
  const amountCents = items.reduce((s, i) => s + i.priceCents, 0) + terms.reduce((s, t) => s + t.deltaCents, 0);
  const effortDays = items.reduce((s, i) => s + i.effortDays, 0);
  const row = fx.briefs.provider.hard.deliverySchedule.find((r) => r.tier === tier && r.maxEffortDays >= effortDays);
  return {
    id: `${keys.join("+")}@${tier}`, itemKeys: keys,
    deferredItemKeys: fx.catalog.items.map((i) => i.itemKey).filter((k) => !keys.includes(k)).sort(),
    tier, amountCents, termKeys: terms.map((t) => t.termKey), effortDays,
    deliveryDate: row ? resolveDate(anchorIso, row.delivery) : null,
  };
}

/** Exhaustive enumeration (3 items x 2 tiers = 14 non-empty bundles). Scenario plugin contract:
 *  small catalogs enumerate; large catalogs must supply pruning (see 06). */
export function enumerateAll(fx: Fx, anchorIso: string): Candidate[] {
  const keys = fx.catalog.items.map((i) => i.itemKey);
  const out: Candidate[] = [];
  for (let mask = 1; mask < 1 << keys.length; mask++) {
    const subset = keys.filter((_, i) => mask & (1 << i));
    for (const tier of ["standard", "expedited"] as const) out.push(buildCandidate(fx, anchorIso, subset, tier));
  }
  return out;
}
