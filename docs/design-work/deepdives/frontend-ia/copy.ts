// frontend-ia/copy.ts
// Client-side copy for reason codes and labels. Inputs are view-model fields only.
// Money/date formatters never parse ISO date-only strings with new Date().

export function formatCents(cents: number, currency = "USD", locale?: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`; // "2026-11-20" -> "Nov 20, 2026" in every time zone
}

export function decisionButtonLabel(kind: "terms" | "budget", version: number): string {
  return kind === "terms" ? `Accept terms of v${version}` : `Approve budget commitment for v${version}`;
}

export const DECISION_SCOPE_NOTE = (p: number, c: number) =>
  `Your decision applies only to proposal v${p} under constraints v${c}. An agent's suggestion never counts as approval.`;

// Budget verdict copy: the provider branch has no numbers by construction (verdict view).
export function budgetCheckCopy(
  view: { visibility: "amounts"; shortfallCents: number | null } | { visibility: "verdict" } | { visibility: "unset" },
): string {
  if (view.visibility === "amounts" && view.shortfallCents)
    return `Over the budget cap by ${formatCents(view.shortfallCents)}. This version cannot execute.`;
  if (view.visibility === "verdict") return "Exceeds the finance limit. This version cannot execute.";
  return "Budget not confirmed yet.";
}

export const SLOT_COPY = {
  pending: { badge: "Pending", icon: "clock" },
  approved: { badge: "Approved", icon: "check" },
  rejected: { badge: "Rejected", icon: "x" },
  stale_approved: { badge: "No longer applies", icon: "check-strike" },
  stale_rejected: { badge: "No longer applies", icon: "x-strike" },
} as const;

export const STALE_REASON_COPY = {
  constraints_changed: "constraints changed",
  newer_proposal: "a newer proposal replaced it",
} as const;

export const TODO_COPY: Record<string, (v?: number) => string> = {
  answer_request: () => "Your input is needed to continue",
  decide_proposal: (v) => `Decide on proposal v${v}`,
  redecide_proposal: (v) => `Your earlier decision no longer applies. Review proposal v${v}`,
  confirm_brief: () => "Confirm your private brief",
  confirm_budget: () => "Confirm the room budget",
  confirm_offer: () => "Confirm your draft offers",
  review_extraction: () => "Review extracted brief items",
  retry_run: () => "Agent negotiation failed. Retry the turn",
  join_room: () => "Accept your invitation",
};

export const ERROR_COPY: Record<string, string> = {
  STALE_VIEW: "Constraints changed while you were reviewing. Review the current version before deciding.",
  PROPOSAL_NOT_CURRENT: "A newer proposal replaced this one.",
  ROLE_FORBIDDEN: "You can't do this in your role.",
  REQUEST_CLOSED: "This request was withdrawn or already answered.",
  RUN_BUSY: "Agents are already working on this round.",
  RATE_LIMITED: "Too many requests. Try again in a minute.",
  UNKNOWN: "Something went wrong. Nothing was changed.",
};
