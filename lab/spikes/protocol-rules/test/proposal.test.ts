import { describe, expect, test } from "vitest";
import { FIXTURE_CATALOG as CAT, FIXTURE_CONSTRAINTS_V1 as C1, FIXTURE_CONSTRAINTS_V2_CUT as C2 } from "../src/fixtures.js";
import type { Catalog, ScopeChangeConstraints } from "../src/protocol.js";
import { checkProposal, type ProposalDraft } from "../src/rules.js";

const REQ = ["audit_log_export", "sso_login"];
const PHASE1 = [...REQ, "usage_dashboard"];
const ALL = CAT.items.map((i) => i.itemKey);

const withItem = (key: string, patch: Record<string, unknown>): Catalog => ({
  ...CAT,
  items: CAT.items.map((i) => (i.itemKey === key ? { ...i, ...patch } : i)) as Catalog["items"],
});

type Row = [name: string, draft: ProposalDraft, codes: string[], opts?: { catalog?: Catalog; constraints?: ScopeChangeConstraints; termsNull?: boolean }];

const rows: Row[] = [
  ["phase one passes", { includedItemKeys: PHASE1, deliveryDate: null }, []],
  ["required only passes", { includedItemKeys: REQ, deliveryDate: null }, []],
  ["full scope: budget + deadline both reported", { includedItemKeys: ALL, deliveryDate: null }, ["date.after_deadline", "budget.over"]],
  ["empty scope", { includedItemKeys: [], deliveryDate: null }, ["scope.empty", "scope.required_missing"], { termsNull: true }],
  ["unknown itemKey", { includedItemKeys: [...REQ, "blockchain_ai"], deliveryDate: null }, ["scope.unknown_item"], { termsNull: true }],
  ["withdrawn item behaves as unknown", { includedItemKeys: PHASE1, deliveryDate: null }, ["scope.unknown_item"],
    { catalog: withItem("usage_dashboard", { status: "withdrawn" }), termsNull: true }],
  ["duplicate item", { includedItemKeys: [...REQ, "sso_login"], deliveryDate: null }, ["scope.duplicate_item"], { termsNull: true }],
  ["missing required item", { includedItemKeys: ["sso_login", "usage_dashboard"], deliveryDate: null }, ["scope.required_missing"]],
  ["date bad separator", { includedItemKeys: REQ, deliveryDate: "2026/11/18" }, ["date.invalid_format"], { termsNull: true }],
  ["date not zero padded", { includedItemKeys: REQ, deliveryDate: "2026-11-8" }, ["date.invalid_format"], { termsNull: true }],
  ["date Feb 30", { includedItemKeys: REQ, deliveryDate: "2026-02-30" }, ["date.invalid_format"], { termsNull: true }],
  ["date month 13", { includedItemKeys: REQ, deliveryDate: "2026-13-01" }, ["date.invalid_format"], { termsNull: true }],
  ["date with time", { includedItemKeys: REQ, deliveryDate: "2026-11-18T00:00:00Z" }, ["date.invalid_format"], { termsNull: true }],
  ["date empty string", { includedItemKeys: REQ, deliveryDate: "" }, ["date.invalid_format"], { termsNull: true }],
  ["deadline exactly equal passes", { includedItemKeys: REQ, deliveryDate: "2026-11-20" }, []],
  ["one day after deadline", { includedItemKeys: REQ, deliveryDate: "2026-11-21" }, ["date.after_deadline"]],
  ["exactly earliest passes", { includedItemKeys: REQ, deliveryDate: "2026-11-16" }, []],
  ["before earliest", { includedItemKeys: REQ, deliveryDate: "2026-11-15" }, ["date.before_earliest"]],
  ["unconfirmed catalog item", { includedItemKeys: PHASE1, deliveryDate: null }, ["source.unconfirmed"],
    { catalog: withItem("usage_dashboard", { status: "draft" }) }],
  ["fractional catalog price", { includedItemKeys: PHASE1, deliveryDate: null }, ["amount.invalid_cents"],
    { catalog: withItem("usage_dashboard", { priceCents: 10_000.5 }), termsNull: true }],
  ["claimed amount mismatch (model/human said USD 850)", { includedItemKeys: PHASE1, deliveryDate: null, claimedAdditionalCostCents: 85_000 },
    ["amount.claim_mismatch"]],
  ["claimed amount equal passes", { includedItemKeys: PHASE1, deliveryDate: null, claimedAdditionalCostCents: 90_000 }, []],
  ["phase one after cut to USD 4,800 is over", { includedItemKeys: PHASE1, deliveryDate: null }, ["budget.over"], { constraints: C2 }],
  ["required only after cut equals cap exactly", { includedItemKeys: REQ, deliveryDate: null }, [], { constraints: C2 }],
  ["invalid hardDeadline in constraints", { includedItemKeys: REQ, deliveryDate: null }, ["date.invalid_format"],
    { constraints: { ...C1, hardDeadline: "next friday" }, termsNull: true }],
];

describe("checkProposal", () => {
  test.each(rows)("%s", (_name, draft, codes, opts) => {
    const r = checkProposal({ catalog: opts?.catalog ?? CAT, constraints: opts?.constraints ?? C1, draft });
    expect(r.issues.map((i) => i.reasonCode).sort()).toEqual([...codes].sort());
    expect(r.ok).toBe(codes.length === 0);
    if (opts?.termsNull) expect(r.terms).toBeNull();
    else expect(r.terms).not.toBeNull();
  });

  test("server derives amounts and dates from catalog only", () => {
    const r = checkProposal({ catalog: CAT, constraints: C1, draft: { includedItemKeys: ["usage_dashboard", "sso_login", "audit_log_export"], deliveryDate: null } });
    expect(r.terms).toEqual({
      catalogVersion: 1,
      includedItemKeys: ["audit_log_export", "sso_login", "usage_dashboard"],
      deferredItemKeys: ["custom_theme", "slack_alerts"],
      lineItems: [
        { itemKey: "audit_log_export", priceCents: 30_000, earliestDeliveryDate: "2026-11-16" },
        { itemKey: "sso_login", priceCents: 50_000, earliestDeliveryDate: "2026-11-13" },
        { itemKey: "usage_dashboard", priceCents: 10_000, earliestDeliveryDate: "2026-11-18" },
      ],
      additionalCostCents: 90_000,
      earliestDeliveryDate: "2026-11-18",
      deliveryDate: "2026-11-18",
    });
    expect(r.budget).toMatchObject({ reasonCode: "budget.within", projectedCommittedCents: 490_000 });
  });

  test("leap day handled by calendar check", () => {
    const leap = checkProposal({ catalog: CAT, constraints: { ...C1, hardDeadline: "2028-02-29" }, draft: { includedItemKeys: REQ, deliveryDate: null } });
    expect(leap.issues.map((i) => i.reasonCode)).not.toContain("date.invalid_format");
    const nonLeap = checkProposal({ catalog: CAT, constraints: { ...C1, hardDeadline: "2027-02-29" }, draft: { includedItemKeys: REQ, deliveryDate: null } });
    expect(nonLeap.issues.map((i) => i.reasonCode)).toContain("date.invalid_format");
  });
});
