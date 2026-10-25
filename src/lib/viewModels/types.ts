/**
 * View models consumed by the product UI (13 §13.8–13.9, 12 §12.17).
 * Every view type is derived from `FunctionReturnType<typeof api.…>` (13 §13.9.1; W1-6-r04).
 * Sensitive branches are discriminated unions so a provider value cannot carry budget figures (FE-D16).
 */

import type { Doc } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { formatCents as formatEngineCents, type SignedCents } from "@core/engine/ui";
import { api } from "@/lib/api";

export type ViewerView = NonNullable<
  FunctionReturnType<typeof api.users.viewer>
>;
export type RoomView = NonNullable<FunctionReturnType<typeof api.rooms.view>>;
export type RoomHeader = RoomView["header"];
export type PhaseView = RoomHeader["phase"];
export type Role = RoomHeader["viewingAs"];
export type ProvenanceBadge = RoomHeader["provenanceBadge"];

export type MemberView = RoomView["members"][number];
export type SeatView = NonNullable<RoomView["seats"]>[number];
export type TodoView = RoomView["todos"][number];
export type BudgetView = RoomView["budget"];
export type CatalogEntry = RoomView["catalog"][number];
export type SharedFact = RoomView["sharedFacts"][number];
export type FollowUpOfView = NonNullable<RoomView["followUpOf"]>;

export type ProposalCard = NonNullable<RoomView["currentProposal"]>;
export type ProposalTerms = ProposalCard["terms"];
export type ProposalLine = ProposalCard["lines"][number];
export type FitView = ProposalCard["fit"];
export type CheckRow = Extract<FitView, { audience: "buyer" }>["checks"][number];
export type ApprovalSlot = ProposalCard["approvals"][number];
export type ApprovalSlotState = ApprovalSlot["state"];
export type MyAction = ProposalCard["myAction"];
export type RecordsPreview = NonNullable<ProposalCard["recordsPreview"]>;
export type AgentSuggestion = NonNullable<ProposalCard["myAgentSuggestion"]>;

export type HistoryRow = NonNullable<RoomView["proposalHistory"]>[number];
export type ProposalStorageStatus = HistoryRow["status"];
export type ProposalDetailView = NonNullable<
  FunctionReturnType<typeof api.proposals.get>
>;

export type RunView = NonNullable<RoomView["run"]>;

export type RunAttemptStatus = NonNullable<RunView["attemptStatus"]>;
export type RunWaiting = NonNullable<RunView["waiting"]>;

export type OpenRequestView = NonNullable<RoomView["openRequest"]>;
export type MyOpenRequestView = Extract<OpenRequestView, { mine: true }>;
export type RequestOption = MyOpenRequestView["options"][number];
export type RequestOptionEffectView = RequestOption["effectView"];

export type ExecutionView = NonNullable<
  FunctionReturnType<typeof api.executions.forRoom>
>;
export type AmountChain = NonNullable<ExecutionView["changeOrder"]["amountChain"]>;
export type ApprovalSnapshotEntry = ExecutionView["approvalsSnapshot"][number];
export type ExecutionTask = ExecutionView["tasks"][number];

export type TimelinePage = NonNullable<FunctionReturnType<typeof api.timeline.page>>;
export type TimelineEntry = TimelinePage["page"][number];

export type InboxCard = NonNullable<FunctionReturnType<typeof api.rooms.listMine>>["page"][number];
export type InboxSection = InboxCard["inboxSection"];
export type InboxTodo = NonNullable<InboxCard["topTodo"]>;

export type InviteCard = NonNullable<FunctionReturnType<typeof api.invites.listMine>>["invites"][number];
export type MyBriefView = NonNullable<
  FunctionReturnType<typeof api.briefs.mine>
>;
export type PreviewChangeView = FunctionReturnType<
  typeof api.rooms.previewChange
>;
export type MyTurnView = NonNullable<FunctionReturnType<typeof api.turns.mine>>["page"][number];

/**
 * Pure diff over public `ProposalTerms` (13 §13.9.3).
 * Never inspects private briefs, caps, or rule inputs.
 */
export function diffTerms(
  prev: ProposalTerms | null,
  next: ProposalTerms,
): readonly string[] {
  if (!prev) return [];
  const changes: string[] = [];

  const prevItems = new Set(prev.itemKeys);
  const nextItems = new Set(next.itemKeys);
  const addedItems = next.itemKeys.filter((k) => !prevItems.has(k));
  const removedItems = prev.itemKeys.filter((k) => !nextItems.has(k));
  for (const item of addedItems) {
    changes.push(`+${item}`);
  }
  for (const item of removedItems) {
    changes.push(`−${item}`);
  }

  const prevMods = new Set(prev.modifiers);
  const nextMods = new Set(next.modifiers);
  const addedMods = next.modifiers.filter((m) => !prevMods.has(m));
  const removedMods = prev.modifiers.filter((m) => !nextMods.has(m));
  for (const mod of addedMods) {
    changes.push(`+${mod}`);
  }
  for (const mod of removedMods) {
    changes.push(`−${mod}`);
  }

  if (prev.deliveryDate !== next.deliveryDate) {
    changes.push(`Delivery ${prev.deliveryDate} → ${next.deliveryDate}`);
  }

  if (prev.amountCents !== next.amountCents) {
    const prevFmt = formatEngineCents(prev.amountCents as SignedCents);
    const nextFmt = formatEngineCents(next.amountCents as SignedCents);
    changes.push(`${prevFmt} → ${nextFmt}`);
  }

  return changes;
}

/**
 * Compile-time proof (13 §13.9.1; W1-6-r04): raw database documents (`Doc<"proposals">`)
 * cannot be passed into a view-model consumer expecting `ProposalCard`.
 */
export function acceptProposalCardOnly(card: ProposalCard): string {
  return card.summaryText;
}

export function _assertRawProposalDocRejected(rawDoc: Doc<"proposals">): void {
  // @ts-expect-error Raw Doc<"proposals"> lacks projected view-model fields and must never feed UI components
  acceptProposalCardOnly(rawDoc);
}
