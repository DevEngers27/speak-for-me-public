/**
 * Example fixture: software service scope change (SIMULATED).
 *
 * Numbers follow the original brief: $5,000 total budget, $4,000 already
 * committed, $1,400 for the full change request, $900 for a first phase with
 * the remaining work deferred, and the budget cap lowered to $4,800 during
 * approval. Item names, dates and people are invented and marked simulated.
 *
 * Arithmetic (integer cents):
 *   full request:   400000 + 140000 = 540000 > 500000 (over cap)
 *   phase one:      400000 +  90000 = 490000 <= 500000 (fits)
 *   after cap cut:  400000 +  90000 = 490000 > 480000 (no longer fits)
 *
 * Constraint `kind` values are illustrative scenario vocabulary; the generic
 * fixture layer does not interpret them. Reason codes are left out until the
 * rules engine defines them.
 */
import { loadFixture, type ScenarioFixture } from "../loader";
import type { ScenarioFixtureInput } from "../schema";

const ALL_ITEMS = ["sso-login", "audit-export", "usage-dashboard"];
const PHASE_ONE_ITEMS = ["sso-login", "audit-export"];

export const scopeChangeSimulatedInput = {
  schemaVersion: 1,
  id: "scope-change-basic",
  scenarioId: "scope-change",
  title: "Software service scope change (simulated example)",
  description:
    "A customer asks its software provider for three additions. The full request exceeds the budget cap; " +
    "a first phase fits until finance lowers the cap.",
  provenance: {
    simulated: true,
    label: "Simulated example",
    notes: "Seed data for development and tests. Not a real customer, provider, budget or quote.",
  },
  asOf: "2026-11-02",
  roles: [
    { id: "customer", label: "Customer", description: "Requests the change and needs it delivered." },
    { id: "provider", label: "Service provider", description: "Builds the change and quotes price and dates." },
    { id: "finance", label: "Finance", description: "Owns the budget and existing commitments." },
  ],
  participants: [
    { id: "customer-lead", roleId: "customer", displayName: "Customer lead (simulated)" },
    { id: "provider-pm", roleId: "provider", displayName: "Provider project manager (simulated)" },
    { id: "finance-controller", roleId: "finance", displayName: "Finance controller (simulated)" },
  ],
  privateBriefs: {
    customer: {
      summary: "Needs single sign-on and the audit export before the November security review.",
      notes: ["The usage dashboard can wait for a later phase.", "Delivery after 2026-11-20 misses the review."],
    },
    provider: {
      summary: "Can deliver single sign-on and the audit export by 2026-11-20; the dashboard needs until 2026-12-04.",
      notes: ["Prefers phased delivery."],
    },
    finance: {
      summary: "Spending above the budget cap is not allowed; every new commitment needs finance approval.",
      notes: ["Prefers milestone-based payment."],
    },
  },
  catalog: {
    currency: "USD",
    items: [
      {
        id: "sso-login",
        label: "Single sign-on (SAML) for the client portal",
        priceCents: 50000,
        earliestDate: "2026-11-13",
        sourceRoleId: "provider",
      },
      {
        id: "audit-export",
        label: "Audit log CSV export",
        priceCents: 40000,
        earliestDate: "2026-11-20",
        sourceRoleId: "provider",
      },
      {
        id: "usage-dashboard",
        label: "Usage analytics dashboard",
        priceCents: 50000,
        earliestDate: "2026-12-04",
        sourceRoleId: "provider",
      },
    ],
  },
  constraintSets: [
    {
      version: 1,
      label: "Initial constraints",
      constraints: [
        { id: "budget-cap", kind: "budget-cap", ownerRoleId: "finance", visibility: "shared", amountCents: 500000 },
        {
          id: "committed-spend",
          kind: "committed-spend",
          ownerRoleId: "finance",
          visibility: "shared",
          amountCents: 400000,
        },
        {
          id: "required-items",
          kind: "required-items",
          ownerRoleId: "customer",
          visibility: "shared",
          itemIds: PHASE_ONE_ITEMS,
        },
        { id: "delivery-deadline", kind: "delivery-deadline", ownerRoleId: "customer", visibility: "private", date: "2026-11-20" },
      ],
    },
    {
      version: 2,
      label: "Budget cap lowered to $4,800",
      constraints: [
        { id: "budget-cap", kind: "budget-cap", ownerRoleId: "finance", visibility: "shared", amountCents: 480000 },
        {
          id: "committed-spend",
          kind: "committed-spend",
          ownerRoleId: "finance",
          visibility: "shared",
          amountCents: 400000,
        },
        {
          id: "required-items",
          kind: "required-items",
          ownerRoleId: "customer",
          visibility: "shared",
          itemIds: PHASE_ONE_ITEMS,
        },
        { id: "delivery-deadline", kind: "delivery-deadline", ownerRoleId: "customer", visibility: "private", date: "2026-11-20" },
      ],
    },
  ],
  phases: [
    {
      id: "initial",
      label: "Initial negotiation",
      constraintSetVersion: 1,
      expectations: [
        {
          id: "full-request",
          description: "All three items: 400000 + 140000 = 540000 exceeds the 500000 cap and lands after the deadline.",
          candidate: { itemIds: ALL_ITEMS, deliveryDate: "2026-12-04" },
          outcome: { feasible: false, itemsTotalCents: 140000 },
        },
        {
          id: "phase-one",
          description: "Required items only: 400000 + 90000 = 490000 fits the 500000 cap by the deadline.",
          candidate: { itemIds: PHASE_ONE_ITEMS, deliveryDate: "2026-11-20" },
          outcome: { feasible: true, itemsTotalCents: 90000 },
        },
      ],
    },
    {
      id: "cap-lowered",
      label: "Budget cap lowered during approval",
      description: "Finance lowers the cap to 480000; the phase-one candidate is no longer executable.",
      constraintSetVersion: 2,
      expectations: [
        {
          id: "phase-one-after-cap-cut",
          description: "Same phase one: 400000 + 90000 = 490000 exceeds the new 480000 cap.",
          candidate: { itemIds: PHASE_ONE_ITEMS, deliveryDate: "2026-11-20" },
          outcome: { feasible: false, itemsTotalCents: 90000 },
        },
        {
          id: "full-request-after-cap-cut",
          description: "Full request: 540000 exceeds the 480000 cap and lands after the deadline.",
          candidate: { itemIds: ALL_ITEMS, deliveryDate: "2026-12-04" },
          outcome: { feasible: false, itemsTotalCents: 140000 },
        },
      ],
    },
  ],
} satisfies ScenarioFixtureInput;

/** The example, validated and deeply frozen. */
export const scopeChangeSimulatedFixture: ScenarioFixture = loadFixture(scopeChangeSimulatedInput, {
  expectedScenarioId: "scope-change",
});
