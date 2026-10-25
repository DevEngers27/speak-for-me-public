// Deterministic rules engine. Pure functions, no zod, no I/O, no clock.
// Inputs are plain data; outputs are typed results carrying reasonCodes.
import type { Catalog, ProposalTerms, ScopeChangeConstraints } from "./protocol.js";
import type { Issue } from "./reasonCodes.js";
import { compareIsoDate, isCents, isIsoDate, maxIsoDate, sumCents } from "./primitives.js";

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

export interface BudgetInput {
  totalBudgetCents: number;
  committedCents: number;
  additionalCostCents: number;
}

export type BudgetResult =
  | {
      ok: true;
      reasonCode: "budget.within";
      headroomCents: number; // total - committed
      projectedCommittedCents: number; // committed + additional
      overByCents: 0;
    }
  | {
      ok: false;
      reasonCode: "budget.over" | "budget.total_below_committed";
      headroomCents: number; // may be negative for total_below_committed
      projectedCommittedCents: number;
      overByCents: number; // > 0
    }
  | { ok: false; reasonCode: "budget.invalid_amount"; invalidFields: string[] };

export function checkBudget(input: BudgetInput): BudgetResult {
  const invalidFields = (["totalBudgetCents", "committedCents", "additionalCostCents"] as const).filter(
    (k) => !isCents(input[k]),
  );
  if (invalidFields.length > 0) return { ok: false, reasonCode: "budget.invalid_amount", invalidFields };

  const projected = sumCents([input.committedCents, input.additionalCostCents]);
  if (projected === null) return { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["sum"] };

  const headroomCents = input.totalBudgetCents - input.committedCents;
  const overByCents = projected - input.totalBudgetCents;

  if (input.committedCents > input.totalBudgetCents) {
    return { ok: false, reasonCode: "budget.total_below_committed", headroomCents, projectedCommittedCents: projected, overByCents };
  }
  if (overByCents > 0) {
    return { ok: false, reasonCode: "budget.over", headroomCents, projectedCommittedCents: projected, overByCents };
  }
  return { ok: true, reasonCode: "budget.within", headroomCents, projectedCommittedCents: projected, overByCents: 0 };
}

function budgetIssue(r: BudgetResult): Issue | null {
  if (r.ok) return null;
  if (r.reasonCode === "budget.invalid_amount") return { reasonCode: r.reasonCode, params: { fields: r.invalidFields } };
  return {
    reasonCode: r.reasonCode,
    params: { overByCents: r.overByCents, headroomCents: r.headroomCents, projectedCommittedCents: r.projectedCommittedCents },
  };
}

// ---------------------------------------------------------------------------
// checkProposal: shape-independent business validation + server-side derivation
// ---------------------------------------------------------------------------

export interface ProposalDraft {
  includedItemKeys: readonly string[];
  /** null = use derived earliest delivery date. */
  deliveryDate: string | null;
  /** Any amount claimed by a model/human/legacy record; must equal the derived sum. */
  claimedAdditionalCostCents?: number;
}

export interface CheckProposalInput {
  catalog: Catalog;
  constraints: ScopeChangeConstraints;
  draft: ProposalDraft;
  /** If set, the catalog version the draft was built against. */
  expectedCatalogVersion?: number;
}

export interface CheckProposalResult {
  ok: boolean;
  issues: Issue[];
  /** Server-derived terms; null when structural issues make them undefined. */
  terms: ProposalTerms | null;
  budget: BudgetResult | null;
}

function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) (seen.has(k) ? dup : seen).add(k);
  return [...dup].sort();
}

export function checkProposal(input: CheckProposalInput): CheckProposalResult {
  const { catalog, constraints, draft } = input;
  const issues: Issue[] = [];
  let structural = false;

  if (input.expectedCatalogVersion !== undefined && input.expectedCatalogVersion !== catalog.catalogVersion) {
    issues.push({
      reasonCode: "source.catalog_version_mismatch",
      params: { expected: input.expectedCatalogVersion, actual: catalog.catalogVersion },
    });
    structural = true;
  }

  const keys = draft.includedItemKeys;
  if (keys.length === 0) {
    issues.push({ reasonCode: "scope.empty", params: {} });
    structural = true;
  }

  const dup = duplicates(keys);
  if (dup.length > 0) {
    issues.push({ reasonCode: "scope.duplicate_item", params: { itemKeys: dup } });
    structural = true;
  }

  const byKey = new Map(catalog.items.filter((i) => i.status !== "withdrawn").map((i) => [i.itemKey, i] as const));
  const unique = [...new Set(keys)].sort();
  const unknown = unique.filter((k) => !byKey.has(k));
  if (unknown.length > 0) {
    issues.push({ reasonCode: "scope.unknown_item", params: { itemKeys: unknown } });
    structural = true;
  }

  const known = unique.flatMap((k) => {
    const item = byKey.get(k);
    return item ? [item] : [];
  });

  const unconfirmed = known.filter((i) => i.status !== "confirmed").map((i) => i.itemKey);
  if (unconfirmed.length > 0) issues.push({ reasonCode: "source.unconfirmed", params: { itemKeys: unconfirmed } });

  const badCents = known.filter((i) => !isCents(i.priceCents)).map((i) => i.itemKey);
  if (badCents.length > 0) {
    issues.push({ reasonCode: "amount.invalid_cents", params: { itemKeys: badCents } });
    structural = true;
  }

  const badCatalogDates = known.filter((i) => !isIsoDate(i.earliestDeliveryDate)).map((i) => i.itemKey);
  if (badCatalogDates.length > 0) {
    issues.push({ reasonCode: "date.invalid_format", params: { field: "catalog.earliestDeliveryDate", itemKeys: badCatalogDates } });
    structural = true;
  }

  const included = new Set(unique);
  const missing = [...new Set(constraints.requiredItemKeys)].filter((k) => !included.has(k)).sort();
  if (missing.length > 0) issues.push({ reasonCode: "scope.required_missing", params: { itemKeys: missing } });

  if (draft.deliveryDate !== null && !isIsoDate(draft.deliveryDate)) {
    issues.push({ reasonCode: "date.invalid_format", params: { field: "deliveryDate" } });
    structural = true;
  }
  const deadlineValid = isIsoDate(constraints.hardDeadline);
  if (!deadlineValid) {
    issues.push({ reasonCode: "date.invalid_format", params: { field: "hardDeadline" } });
    structural = true;
  }

  if (structural) return { ok: false, issues, terms: null, budget: null };

  // --- derivation: amounts and dates come only from the catalog ---
  const lineItems = known.map((i) => ({
    itemKey: i.itemKey,
    priceCents: i.priceCents,
    earliestDeliveryDate: i.earliestDeliveryDate,
  }));
  const additionalCostCents = sumCents(lineItems.map((l) => l.priceCents));
  const earliestDeliveryDate = maxIsoDate(lineItems.map((l) => l.earliestDeliveryDate));
  if (additionalCostCents === null || earliestDeliveryDate === null) {
    issues.push({ reasonCode: "amount.invalid_cents", params: { field: "sum" } });
    return { ok: false, issues, terms: null, budget: null };
  }
  const deliveryDate = draft.deliveryDate ?? earliestDeliveryDate;

  if (compareIsoDate(deliveryDate, earliestDeliveryDate) < 0) {
    issues.push({ reasonCode: "date.before_earliest", params: { deliveryDate, earliestDeliveryDate } });
  }
  if (compareIsoDate(deliveryDate, constraints.hardDeadline) > 0) {
    issues.push({ reasonCode: "date.after_deadline", params: { deliveryDate, hardDeadline: constraints.hardDeadline } });
  }
  if (draft.claimedAdditionalCostCents !== undefined && draft.claimedAdditionalCostCents !== additionalCostCents) {
    issues.push({
      reasonCode: "amount.claim_mismatch",
      params: { claimedCents: draft.claimedAdditionalCostCents, derivedCents: additionalCostCents },
    });
  }

  const budget = checkBudget({
    totalBudgetCents: constraints.budget.totalBudgetCents,
    committedCents: constraints.budget.committedCents,
    additionalCostCents,
  });
  const bi = budgetIssue(budget);
  if (bi) issues.push(bi);

  const deferredItemKeys = [...byKey.keys()].filter((k) => !included.has(k)).sort();
  const terms: ProposalTerms = {
    catalogVersion: catalog.catalogVersion,
    includedItemKeys: unique,
    deferredItemKeys,
    lineItems,
    additionalCostCents,
    earliestDeliveryDate,
    deliveryDate,
  };
  return { ok: issues.length === 0, issues, terms, budget };
}

// ---------------------------------------------------------------------------
// isExecutable: version match + rules pass (re-run against CURRENT state) + approvals
// ---------------------------------------------------------------------------

export interface StoredProposal {
  proposalId: string;
  version: number;
  constraintsVersion: number;
  contentHash: string;
  terms: ProposalTerms;
  requiredApproverIds: readonly string[]; // snapshotted at proposal creation
}

export interface ApprovalRecord {
  approverId: string;
  proposalId: string;
  contentHash: string;
  constraintsVersion: number;
  decision: "approve" | "reject";
  createdAt: number;
}

export interface ExecutableInput {
  proposal: StoredProposal;
  currentConstraints: ScopeChangeConstraints;
  currentCatalog: Catalog;
  approvals: readonly ApprovalRecord[];
  /** Hash recomputed by the caller from proposal.terms (async Web Crypto lives outside). */
  recomputedContentHash: string;
}

export interface ExecutableResult {
  executable: boolean;
  issues: Issue[];
}

export function isExecutable(input: ExecutableInput): ExecutableResult {
  const { proposal, currentConstraints, currentCatalog } = input;
  const issues: Issue[] = [];

  if (input.recomputedContentHash !== proposal.contentHash) {
    issues.push({ reasonCode: "version.content_hash_mismatch", params: { proposalId: proposal.proposalId } });
  }
  if (proposal.constraintsVersion !== currentConstraints.constraintsVersion) {
    issues.push({
      reasonCode: "version.stale_constraints",
      params: { proposalConstraintsVersion: proposal.constraintsVersion, currentConstraintsVersion: currentConstraints.constraintsVersion },
    });
  }

  const recheck = checkProposal({
    catalog: currentCatalog,
    constraints: currentConstraints,
    expectedCatalogVersion: proposal.terms.catalogVersion,
    draft: {
      includedItemKeys: proposal.terms.includedItemKeys,
      deliveryDate: proposal.terms.deliveryDate,
      claimedAdditionalCostCents: proposal.terms.additionalCostCents,
    },
  });
  issues.push(...recheck.issues);

  for (const approverId of [...new Set(proposal.requiredApproverIds)].sort()) {
    const latest = input.approvals
      .filter((a) => a.approverId === approverId && a.proposalId === proposal.proposalId)
      .reduce<ApprovalRecord | null>((acc, a) => (acc === null || a.createdAt > acc.createdAt ? a : acc), null);
    if (latest === null) {
      issues.push({ reasonCode: "approval.missing", params: { approverId } });
    } else if (latest.decision === "reject") {
      issues.push({ reasonCode: "approval.rejected", params: { approverId } });
    } else if (latest.contentHash !== proposal.contentHash || latest.constraintsVersion !== currentConstraints.constraintsVersion) {
      issues.push({ reasonCode: "approval.stale", params: { approverId } });
    }
  }

  return { executable: issues.length === 0, issues };
}
