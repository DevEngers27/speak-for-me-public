"use client";

import { useEffect, useState, type ReactNode } from "react";
import { countCodePoints, TEXT_LIMITS, uiStatusText } from "@core/engine/ui";
import { formatDisabledReason, parseUiError } from "@/lib/errors";
import { formatCents, formatIsoDate, formatRole } from "@/lib/format";
import type {
  ApprovalSlot,
  ApprovalSlotState,
  BudgetView,
  FitView,
  MyAction,
  ProposalCard,
  RoomHeader,
  Role,
} from "@/lib/viewModels/types";

// §14 humanReasonKeys; audience controls who can see the recorded key.
export const SCENARIO_REJECT_REASONS = [
 { key: "terms_not_acceptable", label: "Terms are not acceptable", roles: ["customer", "provider", "finance"], audience: "room" },
 { key: "scope_insufficient", label: "Scope is insufficient", roles: ["customer", "provider", "finance"], audience: "room" },
 { key: "needs_earlier_delivery", label: "Need earlier delivery", roles: ["customer", "provider", "finance"], audience: "room" },
 { key: "over_our_limit", label: "Over our limit", roles: ["finance"], audience: "buyers" },
 { key: "other", label: "Other", roles: ["customer", "provider", "finance"], audience: "room" },
] as const;

export function SimulatedBadge() {
  return (
    <span className="simulated-badge" data-testid="simulated-badge">
      Simulated
    </span>
  );
}

export function ChangeOrderDisclaimer() {
  return (
    <p className="disclaimer-banner" data-testid="change-order-disclaimer">
      {uiStatusText("change_order_disclaimer")}
    </p>
  );
}

export function CatalogTitleText({
  title,
  revision,
}: {
  title: string;
  revision?: number;
}) {
  return (
    <span data-testid="catalog-title-item">
      <span className="author-badge" data-testid="catalog-author-badge">
        Provider
      </span>{" "}
      <span>{title}</span>
      {revision !== undefined ? (
        <span className="subtle"> (rev {revision})</span>
      ) : null}
    </span>
  );
}

export function VersionBadge({
  header,
}: {
  header: Pick<
    RoomHeader,
    "proposalVersion" | "constraintsVersion" | "viewingAs"
  >;
}) {
  const proposal =
    header.proposalVersion === null
      ? "No proposal yet"
      : `Proposal v${header.proposalVersion}`;
  return (
    <p className="version-badge" data-testid="version-badge">
      {proposal} · Constraints v{header.constraintsVersion} · Viewing as{" "}
      {formatRole(header.viewingAs)}
    </p>
  );
}

export function AgentBox({
  suggestion,
}: {
  suggestion: ProposalCard["myAgentSuggestion"];
}) {
  return (
    <aside className="agent-box" data-testid="agent-box">
      <p className="kicker">Suggestion</p>
      {suggestion === null ? (
        <p>Your agent has not commented on this version.</p>
      ) : (
        <>
          <p>{suggestion.action === "recommend_accept" ? "Your agent suggests accepting." : suggestion.action === "reject" ? "Your agent suggests rejecting." : suggestion.action === "counter" ? "Your agent suggests a counterproposal." : "Your agent’s note:"} {suggestion.rationale}</p>
          <p>Suggestion only, never counted as approval.</p>
          {suggestion.isSimulated ? <SimulatedBadge /> : null}
        </>
      )}
    </aside>
  );
}

export function HumanBox({ children }: { children: ReactNode }) {
  return (
    <section
      className="human-box"
      data-testid="human-box"
      aria-labelledby="human-box-title"
    >
      <h3 id="human-box-title">Your decision</h3>
      {children}
    </section>
  );
}

export function StaleBanner({
  constraintsVersion,
  focusTargetId = "decision-proposal-title",
}: {
  constraintsVersion: number;
  focusTargetId?: string;
}) {
  useEffect(() => {
    const target = document.getElementById(focusTargetId);
    if (target) {
      target.focus();
    }
  }, [constraintsVersion, focusTargetId]);

  return (
    <div
      className="stale-banner row-between"
      role="status"
      tabIndex={-1}
      id="decision-stale-banner"
      data-testid="stale-banner"
    >
      <span>
        Constraints changed to v{constraintsVersion} while you were reviewing.
        Review again before deciding.
      </span>
      <button
        type="button"
        className="btn"
        data-testid="stale-banner-focus-btn"
        onClick={() => {
          document.getElementById(focusTargetId)?.focus();
        }}
      >
        Review updated terms
      </button>
    </div>
  );
}

const BADGE: Record<ApprovalSlotState, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  stale_approve: "No longer applies",
  stale_reject: "No longer applies",
  withdrawn: "Withdrawn",
};

export function ApprovalPanel({
  slots,
  proposalVersion,
  constraintsVersion,
  usedForExecution,
}: {
  slots: readonly ApprovalSlot[];
  proposalVersion: number;
  constraintsVersion: number;
  usedForExecution: boolean;
}) {
  return (
    <div data-testid="approval-panel">
      <h3>
        Approvals for proposal v{proposalVersion} under constraints v
        {constraintsVersion}
      </h3>
      {usedForExecution ? <p>Used for execution</p> : null}
      <ul>
        {slots.map((slot) => (
          <li
            key={`${slot.role}-${slot.state}`}
            data-testid={`slot-${slot.role}`}
            data-state={slot.state}
          >
            <span className={`slot-badge slot-${slot.state}`}>
              {BADGE[slot.state]}
            </span>{" "}
            {slot.displayName}
            <span className="slot-detail"> {slot.boundConstraintsVersion === null ? "" : `under constraints v${slot.boundConstraintsVersion}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function approveLabel(
  version: number,
  constraintsVersion: number,
  kind: MyAction["kind"],
  amountCents: number,
): string {
  if (kind === "budget") {
    return `Approve budget commitment of +${formatCents(amountCents)} for v${version} under constraints v${constraintsVersion}`;
  }
  return `Approve v${version} under constraints v${constraintsVersion}`;
}

export type RecordDecisionInput = import("convex/server").FunctionArgs<
  typeof import("@/lib/api").api.approvals.record
>;
type DecisionChoice = Pick<RecordDecisionInput, "decision"> &
  Partial<Pick<RecordDecisionInput, "reasonKey" | "note">>;

export function ApprovalButton({
  version,
  proposalId,
  termsKey,
  role,
  constraintsVersion,
  action,
  amountCents,
  onRecordDecision,
}: {
  version: number;
  proposalId: import("@convex/_generated/dataModel").Id<"proposals">;
  termsKey: string;
  role: Role;
  constraintsVersion: number;
  action: MyAction;
  amountCents: number;
  onRecordDecision?: (input: RecordDecisionInput) => Promise<void> | void;
}) {
  const reasonId = "approval-disabled-reason";

  const binding = `${proposalId}:${termsKey}:${constraintsVersion}`;
  const [rejectBinding, setRejectBinding] = useState<string | null>(null);
  const rejectOpen = rejectBinding === binding;
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  const blocked = !action.canDecide || staleVersion !== null;
  const resolvedDisabledText = staleVersion !== null
    ? "Constraints changed. Review updated terms before deciding."
    : formatDisabledReason(action.disabledReasonCode);
  const setRejectOpen = (open: boolean) => { setRejectBinding(open ? binding : null); setPrivateNote(""); setReasonKey(SCENARIO_REJECT_REASONS[0].key); };
  const [reasonKey, setReasonKey] = useState<string>(
    SCENARIO_REJECT_REASONS[0].key,
  );
  const [privateNote, setPrivateNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function submitDecision(input: DecisionChoice) {
    if (!onRecordDecision) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await onRecordDecision({
        ...input,
        proposalId,
        expectedTermsKey: termsKey,
        expectedConstraintsVersion: constraintsVersion,
        reasonKey: input.reasonKey ?? null,
        note: input.note ?? null,
      });
      if (input.decision === "reject") {
        setRejectOpen(false);
        setPrivateNote("");
      }
    } catch (err) {
      const parsed = parseUiError(err);
      if (parsed.code === "approval.stale") { setStaleVersion(parsed.currentConstraintsVersion ?? constraintsVersion); setRejectOpen(false); }
      else setErrorText(parsed.message);
    } finally {
      setSubmitting(false);
    }
  }

  const noteCodePoints = countCodePoints(privateNote);
  const noteTooLong = noteCodePoints > TEXT_LIMITS.approvalNote;

  return (
    <div className="decision-controls stack">
      {staleVersion !== null ? <StaleBanner constraintsVersion={staleVersion} /> : null}
      <div className="row">
        <button
          type="button"
          className="approve-button"
          data-testid="approval-button"
          aria-disabled={blocked || submitting ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={(event) => {
            if (blocked || submitting) {
              event.preventDefault();
              document.getElementById(reasonId)?.focus();
              return;
            }
            void submitDecision({ decision: "approve" });
          }}
        >
          {approveLabel(version, constraintsVersion, action.kind, amountCents)}
        </button>

        <button
          type="button"
          className="btn"
          data-testid="reject-button"
          aria-disabled={blocked || submitting ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={(event) => {
            if (blocked || submitting) {
              event.preventDefault();
              document.getElementById(reasonId)?.focus();
              return;
            }
            setRejectOpen(!rejectOpen);
          }}
        >
          Reject v{version}
        </button>

        {action.canWithdraw ? (
          <button
            type="button"
            className="btn"
            data-testid="withdraw-button"
            disabled={submitting}
            onClick={() => {
              void submitDecision({ decision: "withdraw" });
            }}
          >
            Withdraw my approval
          </button>
        ) : null}
      </div>

      {blocked && resolvedDisabledText !== null ? (
        <p id={reasonId} tabIndex={-1} data-testid="approval-disabled-reason">
          {resolvedDisabledText}
        </p>
      ) : null}

      {action.completesSet ? (
        <p data-testid="completes-set-note">
          Your approval completes the set — this executes now.
        </p>
      ) : null}

      {rejectOpen ? (
        <div
          className="panel muted stack"
          role="dialog"
          aria-labelledby="reject-dialog-title"
          data-testid="reject-dialog"
        >
          <h4 id="reject-dialog-title" style={{ margin: 0 }}>
            Reject proposal v{version} under constraints v{constraintsVersion}
          </h4>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="kicker">Select reason (shared per room rules)</legend>
            <div className="stack" style={{ marginTop: "0.35rem" }}>
              {SCENARIO_REJECT_REASONS.filter((r) => (r.roles as readonly string[]).includes(role)).map((r) => (
                <label key={r.key} className="row">
                  <input
                    type="radio"
                    name="reject-reason-key"
                    value={r.key}
                    checked={reasonKey === r.key}
                    onChange={() => setReasonKey(r.key)}
                    data-testid={`reject-reason-${r.key}`}
                  />
                  <span>{r.label} · {r.audience === "buyers" ? "Shared with buyers" : "Shared with the room"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="stack">
            <label htmlFor="reject-private-note">
              Private note (visible only to you · {noteCodePoints}/
              {TEXT_LIMITS.approvalNote})
            </label>
            <textarea
              id="reject-private-note"
              rows={2}
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              data-testid="reject-private-note"
            />
            {noteTooLong ? (
              <p className="stale-banner" role="alert">
                Note exceeds {TEXT_LIMITS.approvalNote} characters.
              </p>
            ) : null}
          </div>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              data-testid="confirm-reject-button"
              disabled={submitting || noteTooLong}
              onClick={() => {
                const trimmed = privateNote.trim();
                void submitDecision({
                  decision: "reject",
                  reasonKey,
                  ...(trimmed ? { note: trimmed } : {}),
                });
              }}
            >
              Confirm rejection of v{version}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="cancel-reject-button"
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {errorText ? (
        <div
          className="stale-banner"
          role="alert"
          data-testid="decision-error"
        >
          {errorText}
        </div>
      ) : null}
    </div>
  );
}

export function ChecksList({
  fit,
  constraintsVersion,
}: {
  fit: FitView;
  constraintsVersion: number;
}) {
  if (!fit) return <p>Checks are shown for the current proposal only.</p>;
  return (
    <div data-testid="checks">
      <h3>
        Rule checks (code, not the model) · Checked against constraints v
        {constraintsVersion}
      </h3>
      {fit.audience === "provider" ? (
        <p>
          {fit.value === "ok"
            ? "Fits the room's private constraints"
            : "Doesn't fit the room's private constraints"}
        </p>
      ) : (
        <ul>
          {fit.checks.map((check) => (
            <li key={check.code} className="check-fail">
              <code>{check.code}</code> {check.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BudgetPanel({ budget }: { budget: BudgetView }) {
  if (budget.visibility === "none") return null;
  return (
    <section
      className="budget-panel"
      data-testid="budget-panel"
      aria-labelledby="budget-title"
    >
      <h3 id="budget-title">Budget</h3>
      {budget.visibility === "customer" ? (
        <ul>
          {budget.capCents !== null ? (
            <li>Budget cap {formatCents(budget.capCents)}</li>
          ) : (
            <li>Budget cap: Not shared with you</li>
          )}
          {budget.committedCents !== null ? (
            <li>Committed {formatCents(budget.committedCents)}</li>
          ) : null}
          {budget.headroomCents !== null ? (
            <li>Headroom {formatCents(budget.headroomCents)}</li>
          ) : null}
        </ul>
      ) : (
        <ul>
          <li>Budget cap {formatCents(budget.capCents)}</li>
          <li>Committed {formatCents(budget.committedCents)}</li>
          <li>Headroom {formatCents(budget.headroomCents)}</li>
          {budget.proposalCents !== null ? (
            <li>This proposal {formatCents(budget.proposalCents)}</li>
          ) : null}
          {budget.totalAfterCents !== null ? (
            <li>Total after {formatCents(budget.totalAfterCents)}</li>
          ) : null}
          {budget.overByCents !== null && budget.status === "over" ? (
            <li>Over by {formatCents(budget.overByCents)}</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function DeliveryDate({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatIsoDate(iso)}</time>;
}
