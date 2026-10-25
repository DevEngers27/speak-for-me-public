"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useLiveAnnouncer } from "@/components/a11y/LiveAnnouncer";
import { useBackendStatus } from "@/components/providers";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@/lib/api";
import type { RoomView } from "@/lib/viewModels/types";

const TABS = [
  { suffix: "", label: "Workbench" },
  { suffix: "/brief", label: "My brief" },
  { suffix: "/results", label: "Results" },
  { suffix: "/timeline", label: "Timeline" },
  { suffix: "/people", label: "People" },
] as const;

const RoomViewContext = createContext<RoomView | null>(null);

export function useRoomView(): RoomView | null {
  return useContext(RoomViewContext);
}

export function RoomNotAvailable() {
  return (
    <section className="panel stack" data-testid="room-not-available">
      <h1>This room is not available to you</h1>
      <p className="subtle">
        If you were invited, open the invitation from your inbox.
      </p>
      <div className="row">
        <Link className="btn" href="/rooms">
          Back to rooms
        </Link>
      </div>
    </section>
  );
}

export function RoomFrame({
  roomId,
  initialView,
  children,
}: {
  roomId: string;
  initialView?: RoomView | null;
  children?: ReactNode;
}) {
  const { live } = useBackendStatus();
  if (live && initialView === undefined) {
    return <LiveRoomFrame roomId={roomId}>{children}</LiveRoomFrame>;
  }
  if (!initialView || initialView.header.roomId !== roomId) {
    return <RoomNotAvailable />;
  }
  return (
    <RoomFrameView roomId={roomId} view={initialView}>
      {children}
    </RoomFrameView>
  );
}

function LiveRoomFrame({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const view = useQuery(
    api.rooms.view,
    isAuthenticated ? { roomId: roomId as Id<"rooms"> } : "skip",
  );

  if (isLoading || !isAuthenticated || view === undefined) {
    return (
      <div className="page-shell" data-testid="room-loading-skeleton">
        <p className="subtle">Loading room…</p>
      </div>
    );
  }

  if (view === null) {
    return <RoomNotAvailable />;
  }

  return (
    <RoomFrameView roomId={roomId} view={view}>
      {children}
    </RoomFrameView>
  );
}

export function RoomFrameView({
  roomId,
  view,
  children,
}: {
  roomId: string;
  view: RoomView;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { announcePolite } = useLiveAnnouncer();
  const prevStateRef = useRef<{
    cv: number;
    pv: number | null;
    executed: boolean;
  } | null>(null);

  useEffect(() => {
    const prev = prevStateRef.current;
    const next = {
      cv: view.header.constraintsVersion,
      pv: view.header.proposalVersion,
      executed: view.execution !== null,
    };
    prevStateRef.current = next;
    if (!prev) return;

    if (!prev.executed && next.executed && view.execution) {
      announcePolite(
        `Executed Change Order CO-${view.execution.changeOrderNumber} for proposal v${view.execution.proposalVersion}.`,
      );
    } else if (prev.cv !== next.cv) {
      announcePolite(`Constraints updated to v${next.cv}.`);
    } else if (prev.pv !== next.pv && next.pv !== null) {
      announcePolite(`Proposal v${next.pv} is ready for review.`);
    }
  }, [
    view.header.constraintsVersion,
    view.header.proposalVersion,
    view.execution,
    announcePolite,
  ]);

  return (
    <RoomViewContext.Provider value={view}>
      <div className="room-shell" data-testid="room-shell">
        <div className="row-between">
          <Link href="/rooms">← Decision inbox</Link>
          {view.followUpOf ? (
            <span className="pill" data-testid="follow-up-lineage-badge">
              Follow-up to{" "}
              <Link href={`/rooms/${view.followUpOf.previousRoomId}/results`}>
                CO-{view.followUpOf.changeOrderNumber}
              </Link>
            </span>
          ) : null}
        </div>
        <nav className="room-nav" aria-label="Room">
          <ul>
            {TABS.map((tab) => {
              const href = `/rooms/${roomId}${tab.suffix}`;
              const current = pathname === href;
              return (
                <li key={tab.label}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {children}
      </div>
    </RoomViewContext.Provider>
  );
}
