import { beforeAll, describe, expect, test } from "vitest";
import { FIXTURE_CATALOG as CAT, FIXTURE_CONSTRAINTS_V1 as C1, FIXTURE_CONSTRAINTS_V2_CUT as C2 } from "../src/fixtures.js";
import { contentHash, stableStringify } from "../src/primitives.js";
import type { Catalog, ProposalTerms } from "../src/protocol.js";
import { checkProposal, isExecutable, type ApprovalRecord, type StoredProposal } from "../src/rules.js";

const APPROVERS = ["p_customer", "p_finance", "p_provider"];
let proposal: StoredProposal;
let hash: string;

function approvals(h: string, cv: number, overrides: Partial<Record<string, Partial<ApprovalRecord>>> = {}): ApprovalRecord[] {
  return APPROVERS.map((id, i) => ({
    approverId: id, proposalId: "prop_1", contentHash: h, constraintsVersion: cv, decision: "approve" as const, createdAt: 100 + i,
    ...overrides[id],
  }));
}

beforeAll(async () => {
  const r = checkProposal({ catalog: CAT, constraints: C1, draft: { includedItemKeys: ["sso_login", "audit_log_export", "usage_dashboard"], deliveryDate: null } });
  const terms = r.terms as ProposalTerms;
  hash = await contentHash(terms);
  proposal = { proposalId: "prop_1", version: 1, constraintsVersion: 1, contentHash: hash, terms, requiredApproverIds: APPROVERS };
});

describe("contentHash", () => {
  test("stable under key order", async () => {
    const a = { b: 1, a: [1, 2], c: { y: "x", x: null } };
    const b = { c: { x: null, y: "x" }, a: [1, 2], b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(await contentHash(a)).toBe(await contentHash(b));
  });
  test("terms are normalized so input order does not change the hash", async () => {
    const r2 = checkProposal({ catalog: CAT, constraints: C1, draft: { includedItemKeys: ["usage_dashboard", "audit_log_export", "sso_login"], deliveryDate: null } });
    expect(await contentHash(r2.terms)).toBe(hash);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("isExecutable", () => {
  test.each<[string, () => Parameters<typeof isExecutable>[0], string[]]>([
    ["all approvals bound to current version -> executable", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT, approvals: approvals(hash, 1), recomputedContentHash: hash }), []],
    ["one approver missing", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT, approvals: approvals(hash, 1).slice(0, 2), recomputedContentHash: hash }), ["approval.missing"]],
    ["latest decision is reject", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT,
      approvals: [...approvals(hash, 1), { approverId: "p_finance", proposalId: "prop_1", contentHash: hash, constraintsVersion: 1, decision: "reject", createdAt: 999 }],
      recomputedContentHash: hash }), ["approval.rejected"]],
    ["approval bound to another content hash", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT,
      approvals: approvals(hash, 1, { p_customer: { contentHash: "sha256:old" } }), recomputedContentHash: hash }), ["approval.stale"]],
    ["approval for another proposal does not count", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT,
      approvals: approvals(hash, 1, { p_provider: { proposalId: "prop_0" } }), recomputedContentHash: hash }), ["approval.missing"]],
    ["budget cut to USD 4,800: stale version + rule fail + all approvals stale", () => ({ proposal, currentConstraints: C2, currentCatalog: CAT, approvals: approvals(hash, 1), recomputedContentHash: hash }),
      ["version.stale_constraints", "budget.over", "approval.stale", "approval.stale", "approval.stale"]],
    ["stored terms tampered (hash mismatch)", () => ({ proposal, currentConstraints: C1, currentCatalog: CAT, approvals: approvals(hash, 1), recomputedContentHash: "sha256:tampered" }), ["version.content_hash_mismatch"]],
    ["catalog re-priced under same version -> claim mismatch", () => ({ proposal, currentConstraints: C1,
      currentCatalog: { ...CAT, items: CAT.items.map((i) => (i.itemKey === "sso_login" ? { ...i, priceCents: 55_000 } : i)) } as Catalog,
      approvals: approvals(hash, 1), recomputedContentHash: hash }), ["amount.claim_mismatch"]],
    ["catalog version bumped -> source mismatch", () => ({ proposal, currentConstraints: C1, currentCatalog: { ...CAT, catalogVersion: 2 }, approvals: approvals(hash, 1), recomputedContentHash: hash }),
      ["source.catalog_version_mismatch"]],
  ])("%s", (_name, mk, codes) => {
    const r = isExecutable(mk());
    expect(r.issues.map((i) => i.reasonCode).sort()).toEqual([...codes].sort());
    expect(r.executable).toBe(codes.length === 0);
  });

  test("re-approval under v2 does NOT make the old USD 900 proposal executable (rules still fail)", () => {
    const reproposed = { ...proposal, constraintsVersion: 2 };
    const r = isExecutable({ proposal: reproposed, currentConstraints: C2, currentCatalog: CAT, approvals: approvals(hash, 2), recomputedContentHash: hash });
    expect(r.issues.map((i) => i.reasonCode)).toEqual(["budget.over"]);
  });
});
