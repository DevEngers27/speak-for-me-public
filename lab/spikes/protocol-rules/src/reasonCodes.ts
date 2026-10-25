// Single source of truth for deterministic rule outcomes.
// Codes are stable identifiers; human text is rendered per audience elsewhere.

export const REASON_CODES = [
  // budget
  "budget.within",
  "budget.over",
  "budget.total_below_committed",
  "budget.invalid_amount",
  // scope
  "scope.empty",
  "scope.unknown_item",
  "scope.duplicate_item",
  "scope.required_missing",
  // source / provenance
  "source.unconfirmed",
  "source.catalog_version_mismatch",
  // amounts
  "amount.invalid_cents",
  "amount.claim_mismatch",
  // dates
  "date.invalid_format",
  "date.after_deadline",
  "date.before_earliest",
  // versioning / approvals (isExecutable)
  "version.stale_constraints",
  "version.content_hash_mismatch",
  "approval.missing",
  "approval.rejected",
  "approval.stale",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** A single failed (or informational) check. params never carry free text from a model. */
export interface Issue {
  reasonCode: ReasonCode;
  params: Record<string, string | number | boolean | readonly string[]>;
}

/** Codes that only make sense to show in full to the owner of the underlying private constraint. */
export const PRIVATE_PARAM_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "budget.over",
  "budget.total_below_committed",
  "date.after_deadline",
]);
