// engine/rules/codes.ts — the single source of reason codes and check ids.
// Convex validators, Zod enums, ConvexError codes and template tables all derive from these arrays.

export const REASON_CODES = [
  'OK',
  // inputs / structure
  'CONSTRAINTS_INCOMPLETE',
  'CONSTRAINT_INCONSISTENT',
  'EMPTY_SCOPE',
  'DUPLICATE_ITEM',
  'ITEM_OVERLAP',
  'UNKNOWN_ITEM',
  'UNCONFIRMED_ITEM',
  'ITEM_EXPIRED',
  'INVALID_DATE',
  'AMOUNT_OUT_OF_RANGE',
  'SOURCE_CHANGED',
  // scope
  'REQUIRED_ITEM_NOT_OFFERED',
  'MISSING_REQUIRED_ITEM',
  'SHOULD_ITEM_EXCLUDED', // info
  // dates
  'BEFORE_EARLIEST_DELIVERY',
  'DELIVERY_IN_PAST',
  'AFTER_DEADLINE',
  'DATE_CONFLICT',
  'MISSES_PREFERRED_DATE', // info
  'RUSH_FEE_APPLIED', // info
  // budget
  'BUDGET_BELOW_COMMITTED',
  'FITS_BUDGET',
  'OVER_BUDGET',
  // execution readiness
  'ALREADY_EXECUTED',
  'NOT_CURRENT_PROPOSAL',
  'TERMS_KEY_MISMATCH',
  'NO_REQUIRED_APPROVERS',
  'APPROVER_IDENTITY_CONFLICT',
  'APPROVAL_REJECTED',
  'APPROVAL_PENDING',
  'APPROVAL_STALE', // info
  // feasibility
  'NO_FEASIBLE_OPTION',
  'NEEDS_TRADEOFF',
  'SEARCH_SPACE_TOO_LARGE',
  // projection only: what a viewer sees when the real code depends on someone else's private constraint
  'PRIVATE_CONSTRAINT_UNMET',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// Fixed evaluation order. Output arrays are sorted by this order, never by insertion order.
export const SCOPE_CHANGE_CHECK_ORDER = [
  'constraints_present',
  'constraints_consistent',
  'terms_shape',
  'items_known',
  'items_confirmed',
  'items_current',
  'required_offered',
  'required_included',
  'includes_should_items', // info
  'pricing',
  'no_rush_fee', // info
  'source_unchanged',
  'delivery_not_past',
  'delivery_by_deadline',
  'date_window',
  'meets_preferred_date', // info
  'budget_state',
  'budget',
] as const;
export type ScopeChangeCheckId = (typeof SCOPE_CHANGE_CHECK_ORDER)[number];

export const READINESS_CHECK_ORDER = [
  'is_current',
  'terms_key_matches',
  'has_required_approvers',
  'distinct_approvers',
  'approvals_not_rejected',
  'approvals_complete',
  'approvals_fresh', // info
] as const;
export type ReadinessCheckId = (typeof READINESS_CHECK_ORDER)[number];

export const MAX_CENTS = 100_000_000_000; // $1,000,000,000.00
export const MAX_OPTIONAL_ITEMS = 10; // 2^10 subsets for the feasible-set search
export const MAX_RELAXATION_ITEMS = 12; // 2^12 subsets when searching single relaxations
