import type { Id } from "@convex/_generated/dataModel";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionInbox, resolveInboxTodoHref } from "@/components/inbox/DecisionInbox";
import { AgentBox, approveLabel } from "@/components/prototype/markers";
import { parseUiError } from "@/lib/errors";
import type { Role } from "@/lib/viewModels/types";
import { buildInboxCard, buildRoomView, type WalkthroughPhase } from "./fixtures";

afterEach(() => {
  cleanup();
});

const roles: readonly Role[] = ["customer", "provider", "finance"];
const phases: readonly WalkthroughPhase[] = ["S3", "S5", "S7", "S11"];

function show(role: Role, phase: WalkthroughPhase) {
  render(createElement(DecisionInbox, { cards: [buildInboxCard(role, phase)] }));
}

describe("decision inbox", () => {
  it("renders the four sections", () => {
    show("customer", "S5");
    expect(screen.getByRole("heading", { name: "Needs you" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Agents working" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Waiting on others" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Done & no longer needed" }),
    ).toBeTruthy();
  });

  it.each(roles)("keeps money off the inbox for %s", (role) => {
    for (const phase of phases) {
      cleanup();
      show(role, phase);
      expect(
        screen.getByTestId("decision-inbox").textContent ?? "",
      ).not.toMatch(/\$/);
      const badge = screen.queryAllByTestId("simulated-badge");
      if (buildInboxCard(role, phase).provenanceBadge !== 'live') expect(badge[0]?.textContent).toBe("Simulated");
    }
  });

  it.each(roles)("puts pending approval in Needs you for %s", (role) => {
    show(role, "S5");
    const needs = screen.getByTestId("inbox-needs_you");
    expect(needs.textContent).toContain("Review & decide");
    expect(needs.textContent).toContain(
      role === "provider" ? "Review whether the proposal fits the room’s private constraints" : "decide proposal",
    );
    expect(screen.getByTestId("inbox-agents_working").textContent).toContain(
      "Nothing in this section.",
    );
  });

  it("puts an open room in Agents working", () => {
    show("provider", "S3");
    expect(screen.getByTestId("inbox-agents_working").textContent).toContain(
      "negotiating",
    );
    expect(screen.getByTestId("inbox-needs_you").textContent).toContain(
      "Nothing in this section.",
    );
  });

  // InboxCard.notice approval_no_longer_applies.
  it("keeps a stale approval notice without moving the live room into Done", () => {
    show("customer", "S7");
    const working = screen.getByTestId("inbox-needs_you");
    expect(working.textContent).toContain(
      "Your approval no longer applies",
    );
    expect(screen.getByTestId("inbox-done").textContent).toContain(
      "Nothing in this section.",
    );
    cleanup();
    show("finance", "S7");
    expect(
      screen.getByTestId("inbox-agents_working").textContent,
    ).not.toContain("No longer applies");
  });

  it("files executed rooms under Done and supports Hide executed rooms toggle", () => {
    show("customer", "S11");
    expect(screen.getByTestId("inbox-done").textContent).toContain(
      "executed",
    );
    fireEvent.click(screen.getByTestId("hide-executed-toggle"));
    expect(screen.getByTestId("inbox-done").textContent).toContain(
      "Nothing in this section.",
    );
    cleanup();
    show("provider", "S11");
    expect(screen.getByTestId("inbox-done").textContent).toContain("executed");
    expect(screen.getByTestId("inbox-needs_you").textContent).toContain("Nothing in this section.");
  });

  it("renders invitations and calls onAcceptInvite", async () => {
    const onAcceptInvite = vi.fn().mockResolvedValue({ roomId: "room_1" });
    render(
      createElement(DecisionInbox, {
        cards: [],
        invites: [
          {
            inviteId: "inv_1" as Id<"invites">,
            roomTitle: "Enterprise Scope Room",
            role: "finance",
            invitedByDisplayName: "Alice Customer",
            expiresAt: 1_762_999_000_000,
          },
        ],
        onAcceptInvite,
      }),
    );
    expect(screen.getByTestId("inbox-invitations").textContent).toContain(
      "Enterprise Scope Room",
    );
    fireEvent.click(screen.getByTestId("accept-invite-inv_1"));
    expect(onAcceptInvite).toHaveBeenCalledWith("inv_1");
  });
});

describe("I-FE-1..I-FE-10 and TC-AUTH-11 / TC-OPS-04 invariants", () => {
  it("I-FE-4 provider DTO and DOM contain no private budget figures or raw check reason codes", () => {
    const view = buildRoomView("provider", "S7");
    expect(view.budget).toEqual({visibility:"none"});
    render(createElement(DecisionInbox, {cards:[buildInboxCard("provider", "S7")]}));
    expect(screen.getByTestId("decision-inbox").textContent).not.toMatch(/budget.over|private.constraint_unmet|\$/);
  });

  it("I-FE-8 AgentBox never contains a button and approveLabel binds vN and constraints vK", () => {
    render(
      createElement(AgentBox, {
        suggestion: {
          action: "recommend_accept",
          proposalVersion: 1,
          rationale: "Fits required items.",
          isSimulated: true,
        },
      }),
    );
    expect(
      screen.getByTestId("agent-box").querySelectorAll("button"),
    ).toHaveLength(0);
    expect(approveLabel(2, 3, "terms", 80_000)).toBe(
      "Approve v2 under constraints v3",
    );
    expect(approveLabel(2, 3, "budget", 80_000)).toBe(
      "Approve budget commitment of +$800.00 for v2 under constraints v3",
    );
  });

  it("13.17 E12 parseUiError never echoes raw Error.message", () => {
    const err = new Error("SELECT * FROM secrets WHERE cap = 512347");
    expect(parseUiError(err).message).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("TC-AUTH-11 static part & TC-OPS-04: /api/health is the only route handler under src/app and requires auth()", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) out.push(...walk(full));
        else if (/^route\.(ts|tsx|js)$/.test(entry)) out.push(full);
      }
      return out;
    };
    const routes = walk("src/app");
    expect(routes).toEqual(["src/app/api/health/route.ts"]);
    const code = fs.readFileSync("src/app/api/health/route.ts", "utf8");
    expect(code).toContain("auth()");
    expect(code).toContain("status: 401");
  });
});

it("generated decision and request links use ids from rooms.view", () => {
 const view = buildRoomView("provider", "S5");
 const todo = buildInboxCard("provider", "S5").topTodo!;
 expect(resolveInboxTodoHref(view.header.roomId, todo, view)).toBe(`/rooms/${view.header.roomId}/proposals/${view.todos.find(t => t.kind === todo.kind)!.refs.proposalId}`);
 const requestView = buildRoomView("customer", "S7");
 if (!requestView.openRequest?.mine) throw new Error("Expected own request");
 expect(resolveInboxTodoHref(requestView.header.roomId, {kind:"answer_request",proposalVersion:null,constraintsVersion:requestView.header.constraintsVersion}, requestView)).toBe(`/rooms/${requestView.header.roomId}/requests/${requestView.openRequest.requestId}`);
});
