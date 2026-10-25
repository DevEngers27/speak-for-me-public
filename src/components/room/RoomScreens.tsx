"use client";

import { useAction, useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBackendStatus } from "@/components/providers";
import { RoomNotAvailable, useRoomView } from "@/components/room/RoomFrame";
import {
  BriefScreen,
  ConfirmConstraintChangeDialog,
  DecisionScreen,
  PeopleScreen,
  RequestScreen,
  ResultsScreen,
  TimelineScreen,
} from "@/components/room/RoomSections";
import { RoomWorkbench } from "@/components/room/RoomWorkbench";
import type { Id } from "@convex/_generated/dataModel";
import { canAnswerOption, optionConstraintChange } from "./requestConsent";
import { api } from "@/lib/api";


export function WorkbenchScreen() {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <RoomWorkbench view={view} />;
  return <LiveWorkbenchScreen view={view} />;
}

function LiveWorkbenchScreen({
  view,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
}) {
  const { isAuthenticated } = useConvexAuth();
  const brief = useQuery(api.briefs.mine, isAuthenticated ? { roomId: view.header.roomId } : "skip");
  const timeline = useQuery(api.timeline.page, isAuthenticated ? { roomId: view.header.roomId, paginationOpts: { numItems: 5, cursor: null } } : "skip");
  const saveGuidance = useMutation(api.briefs.updateSoft);
  const answerRequest = useMutation(api.humanRequests.answer);
  const retryTurn = useMutation(api.runs.retryTurn);
  const startRun = useMutation(api.runs.start);
  const closeRoom = useMutation(api.rooms.close);
  const cancelRun = useMutation(api.runs.cancel);
  const requestRenegotiation = useMutation(api.runs.requestRenegotiation);
  const roomId = view.header.roomId;

  return (
    <RoomWorkbench
      view={view}
      brief={brief}
      onSaveGuidance={async (notes) => { await saveGuidance({ roomId, notes }); }}
      timeline={timeline?.page ?? []}
      onAnswerRequest={async (optionKey) => {
        if (view.openRequest?.mine) await answerRequest({ requestId: view.openRequest.requestId, optionKey });
      }}
      onStartRun={async () => { await startRun({ roomId }); }}
      onCloseRoom={async () => { await closeRoom({ roomId }); }}
      onRetryTurn={async () => {
        if (view.run) await retryTurn({ runId: view.run.runId });
      }}
      onCancelRun={async () => {
        if (view.run) await cancelRun({ runId: view.run.runId });
      }}
      onRequestRenegotiation={async () => {
        if (view.run) await requestRenegotiation({ roomId, expectedRunId: view.run.runId });
      }}
    />
  );
}

export function BriefRoute() {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <BriefScreen view={view} />;
  return <LiveBriefRoute view={view} />;
}

function LiveBriefRoute({
  view,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
}) {
  const { isAuthenticated } = useConvexAuth();
  const brief = useQuery(api.briefs.mine, isAuthenticated ? { roomId: view.header.roomId } : "skip");
  const catalog = useQuery(api.catalog.list, isAuthenticated ? { roomId: view.header.roomId } : "skip");
  const confirmBrief = useMutation(api.briefs.confirm);
  const setCap = useMutation(api.budget.setCap);
  const saveNotes = useMutation(api.briefs.updateSoft);
  const recordBaseline = useMutation(api.ledger.recordBaseline);
  const addSharedFact = useMutation(api.sharedFacts.add);
  const confirmCatalog = useMutation(api.catalog.confirm);
  const retireCatalog = useMutation(api.catalog.retire);
  const roomId = view.header.roomId;
  const cv = view.header.constraintsVersion;
  const convex = useConvex();
  const [confirmation, setConfirmation] = useState<{ preview: import("@/lib/viewModels/types").PreviewChangeView; resolve: (confirmed: boolean) => void } | null>(null);
  async function confirmChange(change: import("convex/server").FunctionArgs<typeof api.rooms.previewChange>["change"]) {
    if (view.header.status !== "open") return true;
    const preview = await convex.query(api.rooms.previewChange, { roomId, change });
    if (!preview) return false;
    if (preview.verdict === "unchanged") return true;
    if (preview.verdict === "rejected") return false;
    return new Promise<boolean>((resolve) => setConfirmation({ preview, resolve }));
  }
  function finishConfirmation(confirmed: boolean) { confirmation?.resolve(confirmed); setConfirmation(null); }


  if (brief === undefined || catalog === undefined) return <p>Loading your brief…</p>;
  return (
    <>
    {confirmation ? <ConfirmConstraintChangeDialog preview={confirmation.preview} currentConstraintsVersion={cv} onConfirm={() => finishConfirmation(true)} onCancel={() => finishConfirmation(false)} /> : null}
    <BriefScreen
      key={`${roomId}:${brief?.latest?.version ?? "initial"}`}
      view={view}
      brief={brief}
      catalog={catalog}
      onConfirmBrief={async (input) => {
        if (input.hardFields.schemaKey === "scope_change.customer.v1" && !await confirmChange({ kind: "customer_hard", requiredItemKeys: input.hardFields.requiredItemKeys, deadline: input.hardFields.deadline })) return false;
        await confirmBrief({
          roomId,
          expectedConstraintsVersion: cv,
          ...input,
        });
      }}
      onSetCap={async (capCents) => {
        if (!await confirmChange({ kind: "cap", newCapCents: capCents })) return false;
        await setCap({
          roomId,
          expectedConstraintsVersion: cv,
          capCents,
        });
      }}
      onSaveNotes={async (notes)=>{await saveNotes({roomId,notes});}}
      onRecordBaseline={async (amountCents) => {
        await recordBaseline({ roomId, amountCents });
      }}
      onAddSharedFact={async (input) => {
        await addSharedFact({ roomId, ...input });
      }}
      onConfirmCatalog={async (rows) => {
        if (!await confirmChange({ kind: "catalog", rows: rows.map(({ itemKey, priceCents, leadDays }) => ({ itemKey, priceCents, leadDays })) })) return false;
        await confirmCatalog({
          roomId,
          expectedConstraintsVersion: cv,
          rows,
        });
      }}
      onRetireCatalogItem={async (itemKey) => {
        if (!await confirmChange({ kind: "catalog", rows: [{ itemKey, retire: true }] })) return false;
        await retireCatalog({
          roomId,
          expectedConstraintsVersion: cv,
          itemKey,
        });
      }}
    />
    </>
  );
}

export function ResultsRoute() {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <ResultsScreen view={view} />;
  return <LiveResultsRoute view={view} />;
}

function LiveResultsRoute({
  view,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
}) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const execution = useQuery(api.executions.forRoom, isAuthenticated ? { roomId: view.header.roomId } : "skip");
  const markDone = useMutation(api.tasks.markDone);
  const startFollowUp = useMutation(api.rooms.startFollowUp);
  const requestRenegotiation = useMutation(api.runs.requestRenegotiation);
  const roomId = view.header.roomId;

  return (
    <ResultsScreen
      view={view}
      execution={execution}
      onMarkTaskDone={async (taskId) => {
        await markDone({ taskId });
      }}
      onStartFollowUp={async () => {
        if (!execution) return;
        const res = await startFollowUp({ executionId: execution.executionId });
        router.push(`/rooms/${res.roomId}/brief`);
      }}
      onRequestRenegotiation={async () => {
        if (view.run) await requestRenegotiation({ roomId, expectedRunId: view.run.runId });
      }}
    />
  );
}

export function PeopleRoute() {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <PeopleScreen view={view} />;
  return <LivePeopleRoute view={view} />;
}

function LivePeopleRoute({
  view,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
}) {
  const createInvite = useMutation(api.invites.create);
  const createInviteLink = useAction(api.invites.createLink);
  const roomId = view.header.roomId;

  return (
    <PeopleScreen
      view={view}
      onCreateInvite={async ({ role, invitedEmail }) => {
        await createInvite({ roomId, role, invitedEmail });
      }}
      onCreateInviteLink={async (role) => {
        return await createInviteLink({ roomId, role });
      }}
    />
  );
}

export function ProposalRoute({ proposalId }: { proposalId: string }) {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  const numericVersion = Number(proposalId);
  const version =
    Number.isInteger(numericVersion) && numericVersion >= 1
      ? numericVersion
      : undefined;

  if (!live) {
    return (
      <DecisionScreen
        view={view}
        proposalId={proposalId}
        version={version}
      />
    );
  }
  return (
    <LiveProposalRoute
      view={view}
      proposalId={proposalId}
      version={version}
    />
  );
}

function LiveProposalRoute({
  view,
  proposalId,
  version,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
  proposalId: string;
  version?: number;
}) {
  const { isAuthenticated } = useConvexAuth();
  const recordDecision = useMutation(api.approvals.record);

  const resolvedProposalId = version === undefined ? proposalId as Id<"proposals"> : view.proposalHistory?.find((row) => row.version === version)?.proposalId;
  const historicalDetail = useQuery(
    api.proposals.get,
    isAuthenticated && resolvedProposalId ? { proposalId: resolvedProposalId } : "skip",
  );

  return (
    <DecisionScreen
      view={view}
      proposalId={proposalId}
      version={version}
      historicalDetail={historicalDetail ?? null}
      onRecordDecision={async (input) => {
        await recordDecision(input);
      }}
    />
  );
}

export function RequestRoute({ requestId }: { requestId: string }) {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <RequestScreen view={view} requestId={requestId} />;
  return <LiveRequestRoute view={view} requestId={requestId} />;
}

function LiveRequestRoute({
  view,
  requestId,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
  requestId: string;
}) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const resolvedRequestId = requestId === "open" ? (view.openRequest?.mine ? view.openRequest.requestId : null) : requestId as Id<"humanRequests">;
  const request = useQuery(api.humanRequests.get, isAuthenticated && resolvedRequestId ? { requestId: resolvedRequestId, roomId: view.header.roomId } : "skip");
  const brief = useQuery(api.briefs.mine, isAuthenticated ? {roomId:view.header.roomId} : "skip");
  const answerRequest = useMutation(api.humanRequests.answer);
  const roomId = view.header.roomId;
  const convex = useConvex();
  const [confirmation, setConfirmation] = useState<{ preview: import("@/lib/viewModels/types").PreviewChangeView; resolve: (value: boolean) => void } | null>(null);
  function finishConfirmation(value: boolean) { confirmation?.resolve(value); setConfirmation(null); }


  if (request === undefined && resolvedRequestId) return <p>Loading request…</p>;
  return (
    <>
    {confirmation ? <ConfirmConstraintChangeDialog preview={confirmation.preview} currentConstraintsVersion={view.header.constraintsVersion} onConfirm={() => finishConfirmation(true)} onCancel={() => finishConfirmation(false)} /> : null}
    <RequestScreen
      view={view}
      requestId={requestId}
      requestDetail={request ?? null}
      brief={brief}
      onAnswerRequest={async (optionKey) => {
        if (!request?.mine || request.requestId !== resolvedRequestId ||
          !request.options.some((option) => option.optionKey === optionKey && option.answerable)) return;
        const option = request.options.find(o => o.optionKey === optionKey)!;
        if (!canAnswerOption(option, brief)) return;
        const effectType = option.type;
        if (["raise_cap", "drop_items", "extend_deadline"].includes(effectType)) {
          const change = optionConstraintChange(option, brief);
          if (change) {
            const preview = await convex.query(api.rooms.previewChange, {roomId, change});
            if (!preview || preview.verdict === "rejected") return;
            if (preview.verdict !== "unchanged" && !await new Promise<boolean>(resolve => setConfirmation({preview, resolve}))) return;
          }
        }
        const result = await answerRequest({
          requestId: request.requestId,
          optionKey,
        });
        router.push(result.outcome === "regenerated" ? `/rooms/${roomId}/requests/${result.requestId}` : `/rooms/${roomId}`);
      }}
    />
    </>
  );
}

export function TimelineRoute() {
  const view = useRoomView();
  const { live } = useBackendStatus();
  if (!view) return <RoomNotAvailable />;
  if (!live) return <TimelineScreen view={view} />;
  return <LiveTimelineRoute view={view} />;
}

function LiveTimelineRoute({
  view,
}: {
  view: NonNullable<ReturnType<typeof useRoomView>>;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<import("@/lib/viewModels/types").TimelineEntry[]>([]);
  const page = useQuery(api.timeline.page, isAuthenticated ? { roomId: view.header.roomId, paginationOpts: { numItems: 50, cursor } } : "skip");

  return (
    <TimelineScreen
      view={view}
      items={[...previous, ...(page?.page ?? [])]}
      hasMore={!!page && !page.isDone}
      onLoadOlder={() => { if (page && !page.isDone) { setPrevious([...previous, ...page.page]); setCursor(page.continueCursor); } }}
    />
  );
}
