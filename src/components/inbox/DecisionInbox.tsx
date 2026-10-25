"use client";

import type { Id } from "@convex/_generated/dataModel";
import Link from "next/link";
import { useState } from "react";
import { SimulatedBadge } from "@/components/prototype/markers";
import { parseUiError } from "@/lib/errors";
import { formatRole } from "@/lib/format";
import type {
  InboxCard,
  InboxSection,
  InboxTodo,
  InviteCard,
  RoomView,
} from "@/lib/viewModels/types";

const SECTIONS: readonly { readonly id: InboxSection; readonly title: string }[] =
  [
    { id: "needs_you", title: "Needs you" },
    { id: "agents_working", title: "Agents working" },
    { id: "waiting", title: "Waiting on others" },
    { id: "done", title: "Done & no longer needed" },
  ];

export function resolveInboxTodoHref(
  roomId: string,
  todo: InboxTodo,
  view?: RoomView | null,
): string {
  if (todo.kind === "task") {
    return `/rooms/${roomId}/results`;
  }
  if (todo.kind === "answer_request") {
    return `/rooms/${roomId}/requests/${view?.openRequest?.mine ? view.openRequest.requestId : "open"}`;
  }
  if (
    todo.kind === "confirm_brief" ||
    todo.kind === "confirm_catalog" ||
    todo.kind === "record_baseline"
  ) {
    return `/rooms/${roomId}/brief`;
  }
  if (todo.kind === "invite_seats") {
    return `/rooms/${roomId}/people`;
  }
  if (
    todo.kind === "decide_proposal" ||
    todo.proposalVersion !== null
  ) {
    const target = view?.todos.find(item => item.kind === todo.kind)?.refs.proposalId;
    return target ? `/rooms/${roomId}/proposals/${target}` : `/rooms/${roomId}`;
  }
  return `/rooms/${roomId}`;
}

export function DecisionInbox({
  cards,
  invites = [],
  onAcceptInvite,
  renderTodoLink,
  roomViews,
}: {
  cards: readonly InboxCard[];
  roomViews?: Readonly<Record<string, RoomView>>;
  renderTodoLink?: (card: InboxCard) => import("react").ReactNode;
  invites?: readonly InviteCard[];
  onAcceptInvite?: (inviteId: Id<"invites">) => Promise<{ roomId: string }> | void;
}) {
  const [hideExecuted, setHideExecuted] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function handleAccept(inviteId: Id<"invites">) {
    if (!onAcceptInvite) return;
    setAcceptingId(inviteId);
    setInviteError(null);
    try {
      await onAcceptInvite(inviteId);
    } catch (err) {
      setInviteError(parseUiError(err).message);
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <div className="stack" data-testid="decision-inbox">
      <header>
        <div>
          <h1>Decision inbox</h1>
          <p className="subtle">
            What needs you, what the agents are doing, and what is already
            settled.
          </p>
        </div>
        <div className="row">
          <label className="row">
            <input
              type="checkbox"
              checked={hideExecuted}
              onChange={(e) => setHideExecuted(e.target.checked)}
              data-testid="hide-executed-toggle"
            />
            <span>Hide executed rooms</span>
          </label>
          <Link
            className="btn primary"
            href="/rooms/new"
            data-testid="new-room-link"
          >
            New room
          </Link>
        </div>
      </header>

      {invites.length > 0 ? (
        <section
          className="panel stack"
          aria-labelledby="inbox-invitations"
          data-testid="inbox-invitations"
        >
          <h2 id="inbox-invitations" style={{ margin: 0 }}>
            Invitations ({invites.length})
          </h2>
          {inviteError ? (
            <div
              className="stale-banner"
              role="alert"
              data-testid="inbox-invite-error"
            >
              {inviteError}
            </div>
          ) : null}
          <ul className="check-list">
            {invites.map((inv) => (
              <li
                key={inv.inviteId}
                className="row-between panel muted"
                data-testid={`invite-row-${inv.inviteId}`}
              >
                <div>
                  <strong>{inv.roomTitle}</strong> · Role:{" "}
                  <span>{formatRole(inv.role)}</span> · Invited by{" "}
                  <span>{inv.invitedByDisplayName}</span>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  data-testid={`accept-invite-${inv.inviteId}`}
                  disabled={acceptingId === inv.inviteId}
                  onClick={() => {
                    void handleAccept(inv.inviteId);
                  }}
                >
                  {acceptingId === inv.inviteId ? "Accepting…" : "Accept"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {SECTIONS.map((section) => {
        const items = cards.filter((card) => {
          if (card.inboxSection !== section.id) return false;
          if (
            hideExecuted &&
            section.id === "done" &&
            card.status === "executed"
          ) {
            return false;
          }
          return true;
        });

        return (
          <section
            key={section.id}
            className="panel stack"
            aria-labelledby={`inbox-${section.id}`}
            data-testid={`inbox-${section.id}`}
          >
            <h2 id={`inbox-${section.id}`} style={{ margin: 0 }}>
              {section.title}
            </h2>
            {items.length === 0 ? <p className="subtle">Nothing in this section.</p> : null}
            <ul className="check-list">
              {items.map((card) => (
                <li key={card.roomId} className="panel muted">
                  <article className="stack">
                    <div className="row-between">
                      <h3 style={{ margin: 0 }}>{card.title}</h3>
                      <div className="row">
                        <span className="pill">
                          Viewing as {formatRole(card.myRole)}
                        </span>
                        {card.provenanceBadge !== "live" ? (
                          <SimulatedBadge />
                        ) : null}
                      </div>
                    </div>
                    <p style={{ margin: 0 }}>{card.phase.phase.replaceAll("_", " ")}</p>
                    {card.topTodo !== null ? (
                      <div className="row-between">
                        <p style={{ margin: 0 }}>{card.myRole === "provider" && card.topTodo.kind === "decide_proposal" ? "Review whether the proposal fits the room’s private constraints" : card.topTodo.kind.replaceAll("_", " ")}</p>
                        {renderTodoLink ? renderTodoLink(card) : <Link
                          className="btn primary"
                          data-testid={`inbox-cta-${card.roomId}`}
                          href={resolveInboxTodoHref(
                            card.roomId,
                            card.topTodo,
                            roomViews?.[card.roomId],
                          )}
                        >
                          {card.topTodo.kind === "decide_proposal" ? "Review & decide" : card.topTodo.kind === "task" ? "Open results" : card.topTodo.kind.replaceAll("_", " ")}
                        </Link>}
                      </div>
                    ) : null}
                    {card.inboxSection === "waiting" ? <p>{card.waitingOn === "others" ? "Waiting on others" : `Waiting on ${card.waitingOn?.map(formatRole).join(", ") ?? "others"}`}</p> : null}
                    {card.notice ? <p className="stale-banner">{card.notice === "approval_no_longer_applies" ? "Your approval no longer applies" : "Request closed"}</p> : null}
                    <p style={{ margin: 0 }}>
                      <Link
                        href={
                          card.inboxSection === "done"
                            ? `/rooms/${card.roomId}/results`
                            : `/rooms/${card.roomId}`
                        }
                      >
                        Open room
                      </Link>
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
