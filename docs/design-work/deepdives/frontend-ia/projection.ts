// frontend-ia/projection.ts
// Pure projection helpers used by rooms.view (and results.view / proposals.detail).
// No Convex imports: unit-testable with vitest. Inputs are already-authorized server data.
// The query handler: getViewer -> requireMember -> read tables (bounded, by index) -> project.

import type { ApprovalSlot, BudgetView, Todo } from "./view-models";

export type Role = "customer" | "provider" | "finance";
export type Decision = "approve" | "reject";

// Scenario-configurable disclosure (07 decides the final value). Default per F07.1.
export type Disclosure = { budgetAmountsVisibleTo: ReadonlyArray<Role> };
export const DEFAULT_DISCLOSURE: Disclosure = { budgetAmountsVisibleTo: ["customer", "finance"] };

// ---------- budget ----------
export type BudgetFacts = {
  capCents: number | null; // null until finance confirms a budget
  committedCents: number; // sum of commitments ledger (F02.4)
  proposalCents: number | null; // current proposal additional cost
};

export function projectBudget(f: BudgetFacts, viewer: Role, d: Disclosure): BudgetView {
  if (f.capCents === null) return { visibility: "unset" };
  const totalAfter = f.proposalCents === null ? null : f.committedCents + f.proposalCents;
  const status =
    totalAfter === null ? "no_proposal" : totalAfter <= f.capCents ? "within" : "over"; // "<=": $800 boundary
  if (!d.budgetAmountsVisibleTo.includes(viewer)) {
    // Provider branch: a NEW object with only the verdict. Never spread `f`.
    return { visibility: "verdict", status };
  }
  return {
    visibility: "amounts",
    capCents: f.capCents,
    committedCents: f.committedCents,
    proposalCents: f.proposalCents,
    totalAfterCents: totalAfter,
    headroomCents: Math.max(0, f.capCents - f.committedCents),
    shortfallCents: status === "over" && totalAfter !== null ? totalAfter - f.capCents : null,
    status,
    canEdit: viewer === "finance",
  };
}

// Check params: budget-rule params carry amounts only for viewers who may see them.
const BUDGET_RULE_KEYS = new Set(["budget.within_cap"]);
export function projectCheckParams(
  ruleKey: string,
  params: Record<string, string | number>,
  viewer: Role,
  d: Disclosure,
): Record<string, string | number> {
  if (BUDGET_RULE_KEYS.has(ruleKey) && !d.budgetAmountsVisibleTo.includes(viewer)) return {};
  // Private-constraint rules (e.g. customer's private deadline) are projected by 07's matrix;
  // default: params of a rule derived from another party's private fact are dropped.
  return params;
}

// ---------- approval slots ----------
export type DecisionRow = {
  role: Role;
  userId: string;
  decision: Decision;
  proposalId: string;
  proposalVersion: number;
  constraintsVersion: number;
  decidedAt: number;
  reasonKey: string | null;
};

export function deriveSlotState(
  latest: DecisionRow | null, // latest decision by the seat holder, any proposal
  current: { proposalId: string | null; constraintsVersion: number },
): Pick<ApprovalSlot, "state"> & { staleBecause: "constraints_changed" | "newer_proposal" | null } {
  if (!latest) return { state: "pending", staleBecause: null };
  const sameProposal = latest.proposalId === current.proposalId;
  const sameConstraints = latest.constraintsVersion === current.constraintsVersion;
  if (sameProposal && sameConstraints) {
    return { state: latest.decision === "approve" ? "approved" : "rejected", staleBecause: null };
  }
  const staleBecause = sameProposal ? "constraints_changed" : "newer_proposal";
  return { state: latest.decision === "approve" ? "stale_approved" : "stale_rejected", staleBecause };
}

// ---------- todos ----------
export type TodoInput = {
  viewer: Role;
  myBriefConfirmed: boolean;
  budgetConfirmed: boolean;
  myOpenRequestIds: string[];
  myPendingExtraction: boolean;
  myDraftOffers: number; // provider only
  current: { proposalId: string; version: number; isExecutable: boolean } | null;
  mySlot: ReturnType<typeof deriveSlotState> | null; // null if viewer is not a required approver
  run: { runId: string; status: string; canRetry: boolean } | null;
};

export function deriveTodos(i: TodoInput): Todo[] {
  const out: Todo[] = [];
  for (const requestId of i.myOpenRequestIds)
    out.push({ kind: "answer_request", priority: 0, refs: { requestId: requestId as never } });
  if (i.current && i.current.isExecutable && i.mySlot) {
    if (i.mySlot.state === "pending")
      out.push({ kind: "decide_proposal", priority: 1, refs: { proposalId: i.current.proposalId as never, proposalVersion: i.current.version } });
    if (i.mySlot.state === "stale_approved" || i.mySlot.state === "stale_rejected")
      out.push({ kind: "redecide_proposal", priority: 1, refs: { proposalId: i.current.proposalId as never, proposalVersion: i.current.version } });
  }
  if (!i.myBriefConfirmed) out.push({ kind: "confirm_brief", priority: 2, refs: {} });
  if (i.viewer === "finance" && !i.budgetConfirmed) out.push({ kind: "confirm_budget", priority: 2, refs: {} });
  if (i.viewer === "provider" && i.myDraftOffers > 0) out.push({ kind: "confirm_offer", priority: 3, refs: {} });
  if (i.myPendingExtraction) out.push({ kind: "review_extraction", priority: 3, refs: {} });
  if (i.run && i.run.status === "failed" && i.run.canRetry)
    out.push({ kind: "retry_run", priority: 4, refs: { runId: i.run.runId as never } });
  return out.sort((a, b) => a.priority - b.priority);
}

// ---------- phase (UI-only derivation; 04 owns the stored statuses) ----------
export type PhaseInput = {
  lifecycle: "open" | "executed" | "closed";
  setupComplete: boolean; // all seats joined, all required briefs + budget confirmed
  run: { status: string } | null;
  hasOpenRequest: boolean;
  current: { isExecutable: boolean } | null;
};
export function derivePhase(p: PhaseInput) {
  if (p.lifecycle === "closed") return "closed" as const;
  if (p.lifecycle === "executed") return "executed" as const;
  if (!p.setupComplete) return "setup" as const;
  if (p.hasOpenRequest) return "needs_input" as const;
  if (p.run && (p.run.status === "queued" || p.run.status === "drafting")) return "negotiating" as const;
  if (p.current?.isExecutable) return "awaiting_approval" as const;
  if (p.current) return "blocked" as const;
  return "negotiating" as const;
}

// ---------- requests ----------
export function projectRequest<T extends { _id: string; targetRole: Role; openedAt: number }>(
  r: T,
  viewer: Role,
  renderMine: (r: T) => object,
) {
  return r.targetRole === viewer
    ? { kind: "mine" as const, ...renderMine(r) }
    : { kind: "waiting" as const, requestId: r._id, targetRole: r.targetRole, openedAt: r.openedAt };
}
