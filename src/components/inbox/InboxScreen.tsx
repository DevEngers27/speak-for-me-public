"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import { DecisionInbox, resolveInboxTodoHref } from "@/components/inbox/DecisionInbox";
import { useBackendStatus } from "@/components/providers";
import { api } from "@/lib/api";
import type { InboxCard, InviteCard } from "@/lib/viewModels/types";

export function InboxScreen({
  initialCards,
  initialInvites,
}: {
  initialCards?: readonly InboxCard[];
  initialInvites?: readonly InviteCard[];
}) {
  const { live } = useBackendStatus();
  if (live && initialCards === undefined) {
    return <LiveInboxScreen />;
  }
  return (
    <DecisionInbox
      cards={initialCards ?? []}
      invites={initialInvites ?? []}
    />
  );
}

function LiveInboxScreen() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const [cursor,setCursor] = useState<string|null>(null);
  const [previous,setPrevious] = useState<InboxCard[]>([]);
  const cards = useQuery(api.rooms.listMine,isAuthenticated ? {paginationOpts:{numItems:50,cursor}} : "skip");
  const loaded = [...new Map([...previous,...(cards?.page ?? [])].map(card=>[card.roomId,card])).values()];
  const invites = useQuery(
    api.invites.listMine,
    isAuthenticated ? {} : "skip",
  );
  const acceptInvite = useMutation(api.invites.accept);

  if (!isAuthenticated || (cards === undefined && previous.length === 0) || invites === undefined) {
    return (
      <div data-testid="inbox-loading">
        <p className="subtle">Loading decision inbox…</p>
      </div>
    );
  }

  return (
    <>
    <DecisionInbox
      cards={loaded}
      renderTodoLink={card => <LiveTodoLink card={card} />}
      invites={invites?.invites ?? []}
      onAcceptInvite={async (inviteId) => {
        const res = await acceptInvite({ invite: { by: "email", inviteId } });
        router.push(`/rooms/${res.roomId}/brief`);
        return res;
      }}
    />
    {cards?.isDone === false || (cards === undefined && previous.length > 0) ? <div className="pagination-actions"><p className="subtle">More rooms may be available.</p><button className="btn" disabled={cards === undefined} onClick={()=>{if(cards){setPrevious(loaded);setCursor(cards.continueCursor);}}}>{cards === undefined ? "Loading…" : "Load more rooms"}</button></div> : null}
    </>
  );
}

function LiveTodoLink({card}: {card: InboxCard}) {
 const view = useQuery(api.rooms.view, {roomId:card.roomId as Id<"rooms">});
 if (!card.topTodo) return null;
 return <Link className="btn primary" data-testid={`inbox-cta-${card.roomId}`} href={resolveInboxTodoHref(card.roomId, card.topTodo, view)}>{card.topTodo.kind === "decide_proposal" || card.topTodo.kind === "redecide_proposal" ? "Review & decide" : card.topTodo.kind === "answer_request" ? "Choose how to proceed" : card.topTodo.kind.replaceAll("_", " ")}</Link>;
}
