// Simulated example (core #8): every record is origin "fixture", isSimulated true.
// Numbers follow the original README: total $5,000, committed $4,000,
// full change $1,400, phase one $900, later budget cut to $4,800.
import type { Catalog, ScopeChangeConstraints } from "./protocol.js";

export const FIXTURE_CATALOG: Catalog = {
  catalogVersion: 1,
  items: [
    { itemKey: "sso_login", title: "SSO login", priceCents: 50_000, earliestDeliveryDate: "2026-11-13", status: "confirmed", origin: "fixture", isSimulated: true },
    { itemKey: "audit_log_export", title: "Audit log export", priceCents: 30_000, earliestDeliveryDate: "2026-11-16", status: "confirmed", origin: "fixture", isSimulated: true },
    { itemKey: "usage_dashboard", title: "Usage dashboard", priceCents: 10_000, earliestDeliveryDate: "2026-11-18", status: "confirmed", origin: "fixture", isSimulated: true },
    { itemKey: "slack_alerts", title: "Slack alerts", priceCents: 25_000, earliestDeliveryDate: "2026-11-27", status: "confirmed", origin: "fixture", isSimulated: true },
    { itemKey: "custom_theme", title: "Custom theme", priceCents: 25_000, earliestDeliveryDate: "2026-12-04", status: "confirmed", origin: "fixture", isSimulated: true },
  ],
};
// sum = 140_000 ($1,400 full change); required (sso+audit) = 80_000; +usage_dashboard = 90_000 ($900)

export const FIXTURE_CONSTRAINTS_V1: ScopeChangeConstraints = {
  constraintsVersion: 1,
  requiredItemKeys: ["sso_login", "audit_log_export"],
  preferredItemKeys: ["usage_dashboard", "slack_alerts"],
  hardDeadline: "2026-11-20",
  budget: { totalBudgetCents: 500_000, committedCents: 400_000 },
};

/** Finance cuts the budget to $4,800 during approval: headroom 80_000 == required-only cost. */
export const FIXTURE_CONSTRAINTS_V2_CUT: ScopeChangeConstraints = {
  ...FIXTURE_CONSTRAINTS_V1,
  constraintsVersion: 2,
  budget: { totalBudgetCents: 480_000, committedCents: 400_000 },
};

/** Variant with no feasible option: headroom 70_000 < required-only 80_000. */
export const FIXTURE_CONSTRAINTS_V3_INFEASIBLE: ScopeChangeConstraints = {
  ...FIXTURE_CONSTRAINTS_V1,
  constraintsVersion: 3,
  budget: { totalBudgetCents: 470_000, committedCents: 400_000 },
};
