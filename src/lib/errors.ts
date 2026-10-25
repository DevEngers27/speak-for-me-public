import { ERROR_CODES, type ErrorCode } from "@core/engine/ui";

export interface StructuredUiError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly retryAfterSeconds?: number;
  readonly currentConstraintsVersion?: number;
}

const GUARD_COPY: Readonly<Record<string, string>> = {
  room_status: "This action isn't available in the room's current state.",
  run_status:
    "An agent run is already in progress or not in a valid state for this action.",
  run_changed: "The active agent run changed. Review the latest state.",
  not_ready: "Complete all setup requirements before starting a run.",
  baseline_exists:
    "Baseline commitment has already been recorded for this room.",
  brief_missing: "Confirm your brief before performing this action.",
  no_failed_turn: "There is no failed turn waiting for retry.",
  scenario_version:
    "This room uses an older scenario version and cannot start new runs.",
};

const STATIC_ERROR_COPY: Readonly<Record<string, string>> = {
  "auth.unauthenticated": "Sign in to continue.",
  "auth.user_not_provisioned":
    "Your account is still being set up. Try again in a moment.",
  "auth.not_member": "This room isn't available to your account.",
  "auth.role_forbidden":
    "Your role in this room cannot perform that action.",
  "auth.not_creator": "Only the room creator can do that.",
  "invite.invalid": "This invitation is no longer valid.",
  "invite.email_unverified":
    "Verify your email address in Clerk before accepting this invitation.",
  "invite.seat_taken": "That role is already filled in this room.",
  "invite.already_member": "You already have a role in this room.",
  "request.not_open": "This request is already closed.",
  "request.option_unknown": "That option is not available on this request.",
  "input.invalid": "Check the highlighted field and try again.",
  "version.stale_constraints":
    "Constraints changed while you were editing. Review the updated room state and try again.",
  "version.stale_source":
    "Catalog items changed since this proposal was created.",
  "approval.stale":
    "Constraints changed since this proposal was reviewed. Refresh and review again.",
  "approval.not_current": "Only the current proposal can be decided.",
  "approval.already_executed": "This proposal has already been executed.",
  "approval.self_conflict":
    "You have already recorded a conflicting decision.",
  "approval.missing_role": "Waiting on all required roles to approve.",
  "approval.not_executable":
    "This proposal doesn't pass all room checks yet.",
  "budget.over": "Exceeds the current budget cap.",
  "budget.below_committed":
    "Budget cap cannot be set below the already committed amount.",
  "disclosure.blocked":
    "That field cannot be shared with the selected role.",
  "disclosure.needs_own_confirmation":
    "Confirm sharing your private value before disclosing it.",
  "item.unknown": "Unknown catalog item key.",
  "item.unconfirmed":
    "All referenced catalog items must be confirmed first.",
  "item.retired": "A referenced catalog item has been retired.",
  "item.required_missing": "Missing one or more required items.",
  "item.duplicate": "Duplicate catalog item key.",
  "item.limit_exceeded":
    "Catalog item limit reached (max 12 items and 2 modifiers).",
  "date.invalid": "Enter a valid YYYY-MM-DD calendar date.",
  "date.in_past": "Delivery date cannot be earlier than the room date.",
  "date.after_deadline": "Delivery date is after the deadline.",
  "date.before_lead_time":
    "Delivery date is earlier than required lead time.",
  "date.out_of_range": "Date is outside the allowed range.",
  "amount.claim_mismatch":
    "Proposal total does not match the catalog line sum.",
  "amount.out_of_range":
    "Amount is outside the allowed range ($0 to $1,000,000,000).",
  "run.call_limit": "Agent call limit reached for this run.",
  "run.draining":
    "New agent runs are temporarily paused for maintenance. Your work is saved.",
  "run.invalid_state":
    "This action isn't available in the room's current state.",
  "run.rate_limited": "Please wait a moment before starting another update.",
  "private.constraint_unmet":
    "A participant's private constraint isn't met.",
  "output.not_json": "Agent response could not be parsed.",
  "output.schema_violation": "Agent response did not match the schema.",
  "output.truncated": "Agent response was truncated.",
  "output.refusal": "Agent declined to complete the turn.",
  "output.unknown_reference": "Agent referenced an unknown option or item.",
  "action.not_allowed_for_role": "Action is not allowed for this role.",
  "action.option_not_in_snapshot": "Selected option is no longer in the snapshot.",
  "action.repeats_blocked": "That option was already tried in this run.",
  internal: "Something went wrong. Please try again.",
};

export const DISABLED_REASON_COPY: Readonly<Record<string, string>> = {
  room_not_open: "Room is no longer open for decisions.",
  run_not_awaiting_approval:
    "Agents are still working; approval opens when a proposal is ready for review.",
  not_current_proposal: "Only the current proposal can be decided.",
  proposal_not_active: "This proposal is no longer active.",
  stale_for_current_constraints:
    "Constraints changed since this proposal was checked.",
  checks_failing:
    "This proposal doesn't meet all constraints under the current version.",
  already_approved_current_version: "You have already approved this version.",
  role_not_required:
    "Your role does not record an approval on this proposal.",
};

export function formatDisabledReason(code: string | null | undefined): string | null {
  if (!code) return null;
  return (
    DISABLED_REASON_COPY[code] ??
    STATIC_ERROR_COPY[code] ??
    "Action is not currently available."
  );
}

/**
 * Translate a structured error code + optional sanitized params into safe UI copy (12 §12.4, 13 §13.12).
 * Never echoes raw `error.message` or stack traces (I-FE-7).
 */
export function formatErrorCode(
  code: string | null | undefined,
  params?: Readonly<Record<string, unknown>>,
): StructuredUiError {
  const safeCode =
    typeof code === "string" && code.length > 0 ? code : "internal";
  const field =
    typeof params?.field === "string" ? params.field : undefined;

  if (safeCode === "run.rate_limited") {
    const retryAfterMs =
      typeof params?.retryAfterMs === "number" &&
      Number.isFinite(params.retryAfterMs) &&
      params.retryAfterMs > 0
        ? params.retryAfterMs
        : 5_000;
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
    return {
      code: safeCode,
      message: `Please wait ${seconds}s before starting another update.`,
      retryAfterSeconds: seconds,
    };
  }

  if (safeCode === "run.invalid_state") {
    const guard =
      typeof params?.guard === "string" ? params.guard : undefined;
    const message =
      (guard ? GUARD_COPY[guard] : undefined) ??
      STATIC_ERROR_COPY["run.invalid_state"]!;
    return { code: safeCode, message };
  }

  const message =
    STATIC_ERROR_COPY[safeCode] ?? "Something went wrong. Please try again.";
  return {
    code: safeCode,
    message,
    ...(field ? { field } : {}),
    ...(safeCode === "approval.stale" && Number.isSafeInteger(params?.currentConstraintsVersion) && Number(params?.currentConstraintsVersion) >= 0
      ? { currentConstraintsVersion: Number(params?.currentConstraintsVersion) }
      : {}),
  };
}

/**
 * Extract structured `{ code, params }` from a ConvexError or unknown thrown value.
 * Never returns raw `err.message` when `err` is an unstructured Error (I-FE-7).
 */
export function parseUiError(err: unknown): StructuredUiError {
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const data =
      typeof rec.data === "object" && rec.data !== null
        ? (rec.data as Record<string, unknown>)
        : rec;
    if (typeof data.code === "string") {
      const params =
        typeof data.params === "object" && data.params !== null
          ? (data.params as Record<string, unknown>)
          : undefined;
      return formatErrorCode(data.code, params);
    }
  }
  return formatErrorCode("internal");
}

export function isKnownErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}
