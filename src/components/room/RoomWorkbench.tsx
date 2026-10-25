"use client";

import { waitingText, uiStatusText } from "@core/engine/ui";

import Link from "next/link";
import { useDraftProtection } from "./useDraftProtection";
import { useRef, useState } from "react";
import { countCodePoints, TEXT_LIMITS } from "@core/engine/ui";
import {
  AgentBox,
  BudgetPanel,
  CatalogTitleText,
  ChecksList,
  DeliveryDate,
  SimulatedBadge,
  VersionBadge,
} from "@/components/prototype/markers";
import { parseUiError } from "@/lib/errors";
import { formatCents, formatIsoDate, formatRole, formatSharedValue, formatFieldLabel, formatItemKeys, formatCatalogReferences } from "@/lib/format";
import type { MyBriefView, TimelineEntry, ProposalCard, RoomView, SharedFact } from "@/lib/viewModels/types";

function formatSharedFactValue(fact: SharedFact, catalog: RoomView["catalog"]): string {
  return `${formatFieldLabel(fact.field)}: ${formatSharedValue(fact.value, catalog)}`;
}

export function TradeoffCard({ view, onAnswerRequest }: { view: RoomView; onAnswerRequest?: (optionKey: string) => Promise<void> | void }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = view.openRequest;
  if (request === null) {
    return <p data-testid="tradeoff-card">No trade-off is waiting.</p>;
  }
  if (request.mine) {
    return (
      <section
        className="panel muted stack"
        data-testid="tradeoff-card"
        aria-labelledby="tradeoff-title"
      >
        <div className="row-between">
          <h3 id="tradeoff-title" style={{ margin: 0 }}>
            Choose how to proceed
          </h3>
          <span className="pill">Needs your input</span>
        </div>
        <ul>
          {request.options.map((option) => (
            <li key={option.optionKey}>{formatCatalogReferences(option.text, view.catalog)}</li>
          ))}
        </ul>
        <div className="row">
          <Link
            className="btn primary"
            data-testid="answer-request-link"
            href={`/rooms/${view.header.roomId}/requests/${request.requestId}`}
          >
            Choose how to proceed
          </Link>
          <Link className="btn" href={`/rooms/${view.header.roomId}`}>Answer later (expires after 7 days)</Link>
          {request.options.filter((option) => option.answerable && option.type === "end_run").map((option) => <button key={option.optionKey} type="button" className="btn" aria-disabled={pending} data-testid="question-end-run" onClick={async () => {
            if (pending) return;
            if (!confirmEnd) { setConfirmEnd(true); return; }
            setPending(true);
            try { await onAnswerRequest?.(option.optionKey); } catch (err) { setError(parseUiError(err).message); } finally { setPending(false); }
          }}>{confirmEnd ? "Confirm end negotiation" : "End the negotiation"}</button>)}
          {confirmEnd ? <p role="alert">End this negotiation without agreement?</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </section>
    );
  }
  if ("waitingOnRole" in request) {
    return (
      <p data-testid="tradeoff-card">
        {waitingText(request.kind, request.waitingOnRole)}
      </p>
    );
  }
  return <div data-testid="tradeoff-card"><p>Waiting on others</p><p>Waiting on the buyer side</p></div>;
}

function ProposalSummaryCard({
  view,
  proposal,
}: {
  view: RoomView;
  proposal: ProposalCard;
}) {
  const ready =
    proposal.fit?.audience === "provider"
      ? proposal.fit.value === "ok"
      : proposal.fit?.passesChecks;
  const approvedCount = proposal.approvals.filter(
    (s) => s.state === "approved",
  ).length;

  return (
    <article className="panel muted stack" data-testid="proposal-card">
      <div className="row-between">
        <strong>Proposal v{proposal.version}</strong>
        <div className="row">
          <span className="pill">
            {approvedCount}/{proposal.approvals.length} approved
          </span>
          {proposal.provenance !== "live" ? <SimulatedBadge /> : null}
        </div>
      </div>
      <p style={{ margin: 0 }}>{formatCatalogReferences(proposal.summaryText, view.catalog)}</p>
      <p style={{ margin: 0 }}>
        Delivery <DeliveryDate iso={proposal.terms.deliveryDate} /> ·{" "}
        {formatCents(proposal.terms.amountCents)}
      </p>
      <p style={{ margin: 0 }}>
        {ready ? "Ready for approval" : "Does not pass the current checks"}
      </p>
      <ChecksList
        fit={proposal.fit}
        constraintsVersion={view.header.constraintsVersion}
      />
      {proposal.myAgentSuggestion?.proposalVersion === proposal.version ? <AgentBox suggestion={proposal.myAgentSuggestion} /> : <p>Your agent hasn&apos;t commented on this version.</p>}
      {proposal.notIncludedForMe !== null &&
      proposal.notIncludedForMe.length > 0 ? (
        <p style={{ margin: 0 }} data-testid="workbench-not-included">
          Not included from your wishlist:{" "}
          {formatItemKeys(proposal.notIncludedForMe, view.catalog)}.
        </p>
      ) : null}
      <div className="row">
        <Link
          className="btn primary"
          data-testid="review-decide-link"
          href={`/rooms/${view.header.roomId}/proposals/${proposal.proposalId}`}
        >
          Review & decide v{proposal.version}
        </Link>
      </div>
    </article>
  );
}

export function GuideMyAgentPanel({
  initialNotes = "",
  onSaveNotes,
}: {
  initialNotes?: string;
  onSaveNotes?: (notes: string) => Promise<void> | void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [savedNotes, setSavedNotes] = useState(initialNotes);
  useDraftProtection(notes.trim() !== savedNotes.trim());
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const codePoints = countCodePoints(notes);
  const tooLong = codePoints > TEXT_LIMITS.briefNote;

  async function handleSave() {
    if (saving || tooLong || !onSaveNotes) return;
    setSaving(true);
    setErrorText(null);
    setSavedBanner(null);
    try {
      await onSaveNotes?.(notes.trim());
      setSavedNotes(notes.trim());
      setSavedBanner("Saved for your agent's next turn.");
    } catch (err) {
      setErrorText(parseUiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="panel muted stack"
      data-testid="guide-my-agent"
      aria-labelledby="guide-agent-heading"
    >
      <div className="row-between">
        <h3 id="guide-agent-heading" style={{ margin: 0 }}>
          Guide my agent
        </h3>
        <span className="pill">Soft guidance</span>
      </div>
      <p className="subtle">
        Applies to your agent&apos;s next turn without bumping room constraints.
      </p>
      <label htmlFor="guide-agent-notes" className="sr-only">
        Soft guidance notes for your agent
      </label>
      <textarea
        id="guide-agent-notes"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g., Prefer keeping SSO login even if delivery shifts by a few days."
        data-testid="guide-agent-notes"
      />
      {!onSaveNotes ? <p role="status">Guidance saving is not available yet.</p> : null}
      <div className="row-between">
        <span className="subtle">
          {codePoints}/{TEXT_LIMITS.briefNote} characters
        </span>
        <button
          type="button"
          className="btn"
          data-testid="guide-agent-submit"
          disabled={saving || tooLong || !onSaveNotes}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? "Saving…" : "Save guidance for next turn"}
        </button>
      </div>
      {savedBanner ? (
        <p className="subtle" data-testid="guide-agent-saved">
          {savedBanner}
        </p>
      ) : null}
      {errorText ? (
        <div
          className="stale-banner"
          role="alert"
          data-testid="guide-agent-error"
        >
          {errorText}
        </div>
      ) : null}
    </section>
  );
}

export function RoomWorkbench({
  view,
  brief = null,
  timeline = [],
  onSaveGuidance,
  onAnswerRequest,
  onRetryTurn,
  onStartRun,
  onCloseRoom,
  onCancelRun,
  onRequestRenegotiation,
}: {
  view: RoomView;
  brief?: MyBriefView | null;
  timeline?: readonly TimelineEntry[];
  onSaveGuidance?: (notes: string) => Promise<void> | void;
  onAnswerRequest?: (optionKey: string) => Promise<void> | void;
  onRetryTurn?: () => Promise<void> | void;
  onStartRun?: () => Promise<void> | void;
  onCloseRoom?: () => Promise<void> | void;
  onCancelRun?: () => Promise<void> | void;
  onRequestRenegotiation?: () => Promise<void> | void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runPending,setRunPending] = useState(false);
  const runPendingRef = useRef(false);
  const [runActionError, setRunActionError] = useState<string | null>(null);

  async function runAction(fn?: () => Promise<void> | void) {
    if (!fn || runPendingRef.current) return;
    runPendingRef.current = true; setRunPending(true);
    setRunActionError(null);
    try {
      await fn();
    } catch (err) {
      setRunActionError(parseUiError(err).message);
    } finally {runPendingRef.current = false;setRunPending(false);}
  }

  return (
    <div className="stack" data-testid="room-workbench">
      <div className="row-between">
        <div>
          <h1 style={{ margin: 0 }}>{view.header.title}</h1>
          <VersionBadge header={view.header} />
        </div>
        <button
          type="button"
          className="btn know-drawer-toggle"
          data-testid="know-drawer-toggle"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((prev) => !prev)}
        >
          {drawerOpen ? "Hide What I know" : "What I know"}
        </button>
      </div>

      {view.header.provenanceBadge !== "live" ? (
        <p className="banner" data-testid="simulated-room">
          <SimulatedBadge /> Simulated room · seeded from fixture
          scope_change/main
        </p>
      ) : null}

      <p data-testid="phase-banner" style={{ margin: 0 }}>
        {uiStatusText(view.header.phase.phase)}
      </p>

      {view.header.phase.phase === "setup" &&
      (view.header.phase.gaps?.length ?? 0) > 0 ? (
        <div className="panel muted stack" data-testid="setup-gaps">
          <strong>Setup steps remaining before negotiation starts:</strong>
          <ul>
            {view.header.phase.gaps?.map((gap) => (
              <li key={`${gap.ownerRole}-${gap.gap}`}>{formatRole(gap.ownerRole)}: {gap.gap.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.todos.length > 0 ? (
        <ul data-testid="needs-you">
          {view.todos.map((todo) => (
            <li key={todo.kind}>{todo.refs.proposalId ? <Link href={`/rooms/${view.header.roomId}/proposals/${todo.refs.proposalId}`}>{uiStatusText(todo.kind)}</Link> : uiStatusText(todo.kind)}{view.header.viewingAs === "provider" && (todo.kind === "decide_proposal" || todo.kind === "redecide_proposal") ? " · Review whether the proposal fits the room’s private constraints." : null}</li>
          ))}
        </ul>
      ) : null}

      {runActionError ? (
        <div
          className="stale-banner"
          role="alert"
          data-testid="workbench-run-error"
        >
          {runActionError}
        </div>
      ) : null}

      <div className="row">
        {view.header.status === "open" && !view.run ? <button type="button" className="btn primary" disabled={runPending} onClick={() => void runAction(onStartRun)}>Start negotiation</button> : null}
        {view.header.isCreator && (view.header.status === "open" || view.header.status === "setup") ? <button type="button" className="btn" disabled={runPending} onClick={() => void runAction(onCloseRoom)}>Close room</button> : null}
      </div>
      <div className="panes">
        <section
          className="pane pane-know stack"
          aria-labelledby="pane-know"
          data-testid="pane-know"
          data-drawer-open={drawerOpen ? "true" : "false"}
        >
          <h2 id="pane-know" style={{ margin: 0 }}>
            My brief & private area
          </h2>
          {brief?.latest ? <div className="private-area">
            <ul>{Object.entries(brief.latest.hardFields).filter(([field]) => field !== "schemaKey").map(([field, value]) => <li key={field}>{formatFieldLabel(field)}: {typeof value === "number" ? formatCents(value) : Array.isArray(value) ? formatItemKeys(value, view.catalog) : field === "deadline" ? formatIsoDate(value) : value} · {brief.latest!.disclosures[field]?.length ? `Shared with ${brief.latest!.disclosures[field]!.map(formatRole).join(", ")}` : "Private"}</li>)}</ul>
            <p>{brief.latest.softFields.notes} · Private</p>
          </div> : null}
          <p><Link href={`/rooms/${view.header.roomId}/brief`}>Read and edit your private brief</Link></p>
          <h3>What others can see from you</h3>
          {(brief?.othersSee ?? []).map((mirror) => <div key={mirror.role}><strong>{formatRole(mirror.role)}</strong><ul>{mirror.fields.map((field) => <li key={field.field}>{formatFieldLabel(field.field)}: {formatSharedValue(field.value, view.catalog)}</li>)}</ul></div>)}
          <h3>Shared with you</h3>
          {view.sharedFacts.length === 0 ? (
            <p className="subtle">No shared facts disclosed yet.</p>
          ) : (
            <ul data-testid="shared-facts-list">
              {view.sharedFacts.map((fact) => (
                <li key={`${fact.fromRole}-${fact.field}`}>
                  {formatSharedFactValue(fact, view.catalog)}
                </li>
              ))}
            </ul>
          )}

          {view.catalog.length > 0 ? (
            <div data-testid="workbench-catalog">
              <h3>Catalog</h3>
              <ul>
                {view.catalog
                  .map((item) => (
                    <li key={item.itemKey}>
                      <CatalogTitleText
                        title={item.title}
                        revision={item.revision}
                      />{" "}
                      · {formatCents(item.priceCents)} · {item.leadDays}d lead
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <BudgetPanel budget={view.budget} />

          <GuideMyAgentPanel key={brief?.latest?.version ?? "loading"} initialNotes={brief?.latest?.softFields.notes ?? ""} onSaveNotes={onSaveGuidance} />
        </section>

        <section
          className="pane pane-decide stack"
          aria-labelledby="pane-decide"
          data-testid="pane-decide"
        >
          <h2 id="pane-decide" style={{ margin: 0 }}>
            Current proposal, approvals, and trade-off
          </h2>
          {view.currentProposal === null ? (
            <p>No proposal yet. Agents are still drafting.</p>
          ) : (
            <ProposalSummaryCard
              view={view}
              proposal={view.currentProposal}
            />
          )}
          <TradeoffCard key={view.openRequest?.mine ? view.openRequest.requestId : "waiting"} view={view} onAnswerRequest={onAnswerRequest} />
          <h3>Proposal history</h3>
          <div role="region" aria-label="Proposal comparison">
            <ul>
              {(view.proposalHistory ?? []).map((row) => (
                <li
                  key={row.proposalId}
                  aria-current={
                    view.header.proposalVersion === row.version
                      ? "true"
                      : undefined
                  }
                >
                  <Link
                    href={`/rooms/${view.header.roomId}/proposals/${row.proposalId}`}
                  >
                    v{row.version}
                  </Link>{" "}
                  {row.status} {formatCents(row.amountCents)}{" "}
                  <DeliveryDate iso={row.deliveryDate} />
                  {view.header.proposalVersion === row.version
                    ? " Current"
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="pane pane-happened stack"
          aria-labelledby="pane-happened"
          data-testid="pane-happened"
        >
          <div className="row-between">
            <h2 id="pane-happened" style={{ margin: 0 }}>
              Timeline & run progress
            </h2>
            <Link href={`/rooms/${view.header.roomId}/timeline`}>
              Full timeline
            </Link>
          </div>
          {view.run === null ? (
            <p>No run yet.</p>
          ) : (
            <div className="stack">
              <p className="subtle" style={{ margin: 0 }}>
                Run #{view.run.runNo} · {view.run.status.replaceAll("_", " ")} · Round{" "}
                {view.run.roundNo} of {view.run.maxRounds}
              </p>
              {view.run.turnStatus ? <p className="subtle">Turn: {view.run.turnStatus.replaceAll("_", " ")}</p> : null}
              {view.run.attemptStatus ? (
                <p
                  className="subtle"
                  style={{ margin: 0 }}
                  data-testid="attempt-status"
                >
                  Your turn: {view.run.attemptStatus.replaceAll("_", " ")}
                </p>
              ) : null}
              {view.run.waiting ? (
                <p
                  className="subtle"
                  style={{ margin: 0 }}
                  data-testid="run-waiting-banner"
                >
                  Waiting: {" "}
                  {view.run.waiting}
                </p>
              ) : null}
              {view.run.agentMode === "stub" ? <SimulatedBadge /> : null}
              <ol data-testid="run-progress">
                {view.run.staleDiscarded > 0 ? (
                  <li>{view.run.staleDiscarded} late reply discarded</li>
                ) : null}
              </ol>
              <div className="row">
                {view.openRequest?.mine && view.openRequest.kind === "agent_failed" && view.openRequest.options.slice(0, -1).some((option) => option.answerable) ? (
                  <button
                    type="button"
                    className="btn primary"
                    data-testid="retry-turn-btn" disabled={runPending}
                    onClick={() => {
                      void runAction(onRetryTurn);
                    }}
                  >
                    Retry failed turn
                  </button>
                ) : null}
                {view.header.isCreator &&
                (view.run.status === "negotiating" ||
                  view.run.status === "needs_input") ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid="cancel-run-btn" disabled={runPending}
                    onClick={() => {
                      void runAction(onCancelRun);
                    }}
                  >
                    Cancel run
                  </button>
                ) : null}
                {view.header.isCreator &&
                (view.run.status === "pending_approval" ||
                  view.run.status === "ended_no_agreement" ||
                  view.run.status === "canceled") ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid="renegotiate-btn" disabled={runPending}
                    onClick={() => {
                      void runAction(onRequestRenegotiation);
                    }}
                  >
                    Request renegotiation
                  </button>
                ) : null}
              </div>
            </div>
          )}
          <ul data-testid="timeline">
            {timeline.map((entry) => <li key={entry.eventId}>{entry.text}</li>)}
            <li><Link href={`/rooms/${view.header.roomId}/timeline`}>View timeline</Link></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
