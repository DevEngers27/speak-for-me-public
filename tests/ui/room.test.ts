import type { Id } from "@convex/_generated/dataModel";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppAuthGateView } from "@/components/auth/AppAuthShell";
import {
  DecisionInbox,
  resolveInboxTodoHref,
} from "@/components/inbox/DecisionInbox";
import {
  InviteLandingView,
  parseInviteFragmentToken,
} from "@/components/invite/InviteLandingClient";
import { ApprovalPanel, approveLabel } from "@/components/prototype/markers";
import { RoomFrame } from "@/components/room/RoomFrame";
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
import { formatErrorCode, parseUiError } from "@/lib/errors";
import { formatCents, formatIsoDate } from "@/lib/format";
import { diffTerms, type ApprovalSlot, type Role } from "@/lib/viewModels/types";
import {
  buildCanaryRoomView,
  buildInboxCard,
  buildPreviewChange,
  buildRoomView,
  buildExecution,
  buildTimeline,
  CANARY_CUSTOMER,
  CANARY_FINANCE,
  canaryAmounts,
  TEST_ROOM_ID,
  type WalkthroughPhase,
} from "./fixtures";

afterEach(() => {
  cleanup();
});

const roles: readonly Role[] = ["customer", "provider", "finance"];
const phases: readonly WalkthroughPhase[] = ["S3", "S5", "S7", "S11"];

const privateCents = [500_000, 480_000, 400_000, 490_000, 100_000];
const privateKeys = [
  "capCents",
  "committedCents",
  "headroomCents",
  "overByCents",
  "totalAfterCents",
];

function mount(node: ReactElement) {
  render(node);
}

function workbench(role: Role, phase: WalkthroughPhase) {
  mount(createElement(RoomWorkbench, { view: buildRoomView(role, phase) }));
}

function decisionPage(role: Role, phase: WalkthroughPhase, version = phase === "S7" || phase === "S11" ? 2 : 1) {
  mount(
    createElement(DecisionScreen, {
      view: buildRoomView(role, phase),
      version,
    }),
  );
}

describe("format", () => {
  it("splits calendar dates instead of parsing them", () => {
    expect(formatIsoDate("2026-11-20")).toBe("Nov 20, 2026");
  });
});

describe("13.16 budget-branch and fit-branch tables", () => {
  it.each(phases)(
    "13.16 budget-branch table: hides cap, committed, and headroom from the provider at %s",
    (phase) => {
      const view = buildRoomView("provider", phase);
      expect(view.budget).toEqual({ visibility: "none" });
      expect(buildExecution("provider", phase)?.changeOrder.amountChain ?? null).toBeNull();
      const blob = JSON.stringify(view);
      for (const cents of privateCents) {
        expect(blob).not.toContain(String(cents));
        expect(blob).not.toContain(formatCents(cents));
      }
      for (const key of privateKeys) expect(blob).not.toContain(key);
      workbench("provider", phase);
      const text = screen.getByTestId("room-workbench").textContent ?? "";
      expect(screen.queryByTestId("budget-panel")).toBeNull();
      for (const cents of privateCents) {
        expect(text).not.toContain(formatCents(cents));
      }
      expect(text).not.toMatch(/Budget cap|Committed|Headroom/);
      expect(screen.getByTestId("version-badge").textContent).toContain(
        "Viewing as Provider",
      );
      expect(
        screen.getAllByTestId("simulated-badge").length,
      ).toBeGreaterThan(0);
    },
  );

  it.each(phases)(
    "13.16 budget-branch table: shows the customer only the disclosed cap at %s",
    (phase) => {
      const view = buildRoomView("customer", phase);
      expect(view.budget.visibility).toBe("customer");
      if (view.budget.visibility !== "customer") return;
      expect(view.budget.capCents).toBe(
        phase === "S3" || phase === "S5" ? 500_000 : 480_000,
      );
      expect(view.budget.committedCents).toBeNull();
      expect(view.budget.headroomCents).toBeNull();
      workbench("customer", phase);
      const panel = screen.getByTestId("budget-panel").textContent ?? "";
      expect(panel).toContain("Budget cap");
      expect(panel).toContain(formatCents(view.budget.capCents ?? 0));
      expect(panel).not.toContain("Committed");
      expect(panel).not.toContain("Headroom");
      const text = screen.getByTestId("room-workbench").textContent ?? "";
      expect(text).not.toContain(formatCents(400_000));
      expect(text).not.toContain(formatCents(490_000));
      expect(text).not.toContain(formatCents(100_000));
    },
  );

  it("13.16 budget-branch table: shows finance the cap, committed amount, and headroom", () => {
    const view = buildRoomView("finance", "S5");
    expect(view.budget.visibility).toBe("finance");
    if (view.budget.visibility !== "finance") return;
    expect(view.budget.capCents).toBe(500_000);
    expect(view.budget.committedCents).toBe(400_000);
    expect(view.budget.headroomCents).toBe(100_000);
    expect(view.budget.status).toBe("within");
    workbench("finance", "S5");
    const panel = screen.getByTestId("budget-panel").textContent ?? "";
    expect(panel).toContain("Budget cap");
    expect(panel).toContain("Committed");
    expect(panel).toContain("Headroom");
    expect(panel).toContain(formatCents(500_000));
    expect(panel).toContain(formatCents(400_000));
  });

  it("13.16 fit-branch table: tells the provider only whether the proposal fits", () => {
    decisionPage("provider", "S5");
    const checks = screen.getByTestId("checks").textContent ?? "";
    expect(checks).toContain("Fits the room's private constraints");
    expect(checks).not.toMatch(/budget.over|private.constraint_unmet/);
  });

  it("13.16 finance delta2 budget table shows the revised proposal within budget", () => {
    const view = buildRoomView("finance", "S7");
    expect(view.budget.visibility).toBe("finance");
    if (view.budget.visibility !== "finance") throw new Error("Expected finance budget");
    expect(view.budget.status).toBe("within");
    expect(view.budget.overByCents).toBe(0);
    expect(view.budget.proposalCents).toBe(80000);
    expect(view.budget.totalAfterCents).toBe(480000);
    workbench("finance", "S7");
    expect(screen.getByTestId("budget-panel").textContent).toContain(formatCents(80000));
  });

});

describe("decision chrome", () => {
  it.each(roles)(
    "13.5 binds the approval button to the version for %s",
    (role) => {
      decisionPage(role, "S5");
      const button = screen.getByTestId("approval-button");
      const expected = approveLabel(
        1,
        1,
        role === "finance" ? "budget" : "terms",
        90_000,
      );
      expect(button.textContent).toBe(expected);
      expect(button.getAttribute("aria-disabled")).toBeNull();
      if (role !== "provider") expect(screen.getByTestId("agent-box").className).toContain("agent-box");
      expect(screen.getByTestId("human-box").className).toContain("human-box");
      if (role === "provider") {
        expect(screen.queryByTestId("agent-box")).toBeNull();
        expect(screen.getByTestId("checks").textContent).toContain(
          "Fits the room's private constraints",
        );
      } else {
        expect(screen.getByTestId("agent-box").textContent).toContain(
          "Suggestion only, never counted as approval.",
        );
      }
      expect(screen.getByTestId("version-badge").textContent).toBe(
        `Proposal v1 · Constraints v1 · Viewing as ${
          role === "customer"
            ? "Customer"
            : role === "provider"
              ? "Provider"
              : "Finance"
        }`,
      );
    },
  );

  it("13.5 shows a stale banner for a reviewed proposal after a live cv update", () => {
    const reviewed = buildRoomView("customer", "S5");
    mount(createElement(DecisionScreen, {view: {...reviewed, header:{...reviewed.header, constraintsVersion:2}}, version:1}));
    expect(screen.getByTestId("stale-banner").textContent).toContain("Constraints changed to v2 while you were reviewing.");
    expect(document.activeElement).toBe(screen.getByTestId("decision-proposal-title"));
  });

  it("13.7 records the executed outcome without a provider amount chain and separates disclaimer from SimulatedBadge", () => {
    for (const role of roles) {
      cleanup();
      const view = buildRoomView(role, "S11");
      mount(createElement(ResultsScreen, { view, execution: buildExecution(role, "S11") }));
      expect(screen.getByTestId("change-order").textContent).toContain("CO-1");
      expect(screen.getByTestId("change-order").textContent).toContain(
        "CO-1",
      );
      expect(
        screen.getByTestId("change-order-disclaimer").textContent,
      ).toContain("Internal record only. No payment, transfer, contract signature, or ERP update happens here.");
      expect(screen.getAllByTestId("simulated-badge").length).toBeGreaterThan(
        0,
      );
      expect(screen.getByTestId("approvals-snapshot").textContent).toContain(
        "bound to constraints v2",
      );
      if (role !== "provider") {
        expect(screen.getByTestId("amount-chain")).toBeTruthy();
      } else {
        expect(screen.queryByTestId("amount-chain")).toBeNull();
      }
    }
  });

  it("renders every approval slot state", () => {
    const states = [
      "pending",
      "approved",
      "rejected",
      "stale_approve",
      "stale_reject",
      "withdrawn",
    ] as const;
    const slots: ApprovalSlot[] = states.map((state, index) => ({
      role:
        (["customer", "provider", "finance", "customer", "provider", "finance"] as const)[
          index
        ] ?? "customer",
      kind: "terms",
      displayName: state,
      isMe: false,
      state,
      boundConstraintsVersion: state === "pending" ? null : 1,
      reasonKey: state === "rejected" ? "needs_earlier_delivery" : null,
    }));
    mount(
      createElement(ApprovalPanel, {
        slots,
        proposalVersion: 2,
        constraintsVersion: 2,
        usedForExecution: false,
      }),
    );
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getAllByText("No longer applies")).toHaveLength(2);
    expect(screen.getByText("Withdrawn")).toBeTruthy();
  });

  it("W1-6-r01 provider People screen shows no other version after open", () => {
    const view = buildRoomView("provider", "S7");
    expect(
      view.members.filter((m) => !m.isMe).map((m) => m.briefVersion),
    ).toEqual([null, null]);
    mount(createElement(PeopleScreen, { view }));
    const text = screen.getByTestId("people-page").textContent ?? "";
    expect(text).not.toContain("Finance · invite · brief v2");
    expect(text).not.toContain("Customer · creator · brief v1");
    expect(text).toContain(`${view.members.find(member => member.isMe)!.displayName} (you)`);
  });

  it("W1-6-r02 main fixture shows Customer-shared required items and deadline", () => {
    const view = buildRoomView("provider", "S5");
    expect(view.sharedFacts.map((f) => f.field).sort()).toEqual(["deadline", "preferredItemKeys", "requiredItemKeys"]);
    workbench("provider", "S5");
    const sharedList = screen.getByTestId("shared-facts-list").textContent ?? "";
    expect(sharedList).toContain("Audit log export, SSO login (SAML)");
    expect(sharedList).toContain("Nov 22, 2026");
  });

  it("W1-6-r02 canary fixture: undisclosed values absent from DTO and DOM", () => {
    const providerCanary = buildCanaryRoomView("provider", "S7", {
      zeroDisclosures: true,
    });
    expect(providerCanary.sharedFacts).toEqual([]);
    const dtoJson = JSON.stringify(providerCanary);
    expect(dtoJson).not.toContain(CANARY_CUSTOMER);
    expect(dtoJson).not.toContain(CANARY_FINANCE);
    expect(dtoJson).not.toContain(String(canaryAmounts.capCentsV1));
    expect(dtoJson).not.toContain(String(canaryAmounts.capCentsV2));
    expect(dtoJson).not.toContain(String(canaryAmounts.baselineCents));
    expect(dtoJson).not.toContain("2026-11-20");
    expect(dtoJson).not.toContain("Nov 22, 2026");

    mount(createElement(RoomWorkbench, { view: providerCanary }));
    const domText = screen.getByTestId("room-workbench").textContent ?? "";
    expect(domText).not.toContain(CANARY_CUSTOMER);
    expect(domText).not.toContain(CANARY_FINANCE);
    expect(domText).not.toContain(formatCents(canaryAmounts.capCentsV1));
    expect(domText).not.toContain(formatCents(canaryAmounts.capCentsV2));
    expect(domText).not.toContain("Nov 22, 2026");
    expect(domText).toContain("Read and edit your private brief");
  });

  it("W1-6-r03 I-FE-10 no Preview-as or role switch reachable in product routes", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    expect(fs.existsSync("src/components/mock/MockWorkspace.tsx")).toBe(false);
    expect(fs.existsSync("src/lib/mock/scopeChange.ts")).toBe(false);
    const roomsLayout = fs.readFileSync(
      path.resolve("src/app/(app)/rooms/layout.tsx"),
      "utf8",
    );
    expect(roomsLayout).not.toContain("MockWorkspace");
    expect(roomsLayout).not.toContain("Preview as");
  });

  it("W1-6-r04 13.9.1 view types derived from FunctionReturnType<typeof api> with revision, catalog, effectView, attemptStatus, approvalsSnapshot", () => {
    const view = buildRoomView("finance", "S7");
    expect(view.catalog.length).toBeGreaterThan(0);
    expect(view.catalog[0]?.revision).toBe(1);
    if (view.openRequest && view.openRequest.mine) {
      expect(view.openRequest.options[0]?.effectView).toBeDefined();
    }
    const s3View = buildRoomView("provider", "S3");
    expect(s3View.run?.attemptStatus).toBe("running");
    const s11View = buildRoomView("finance", "S11");
    expect(s11View.execution?.approvalsSnapshot).toHaveLength(3);
  });

  it("W1-6-r05 11.4 src imports only @core/engine/ui", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
      }
      return out;
    };
    for (const file of walk("src")) {
      const code = fs.readFileSync(file, "utf8");
      expect(code).not.toMatch(/@core\/scenarios\//);
      expect(code).not.toMatch(/from\s+["']@core\/engine["']/);
    }
  });

  it("W1-6-r06 all 10 product routes exist on disk", async () => {
    const fs = await import("node:fs");
    const expectedRoutes = [
      "src/app/(setup)/setup/page.tsx",
      "src/app/(public)/invite/page.tsx",
      "src/app/(app)/rooms/page.tsx",
      "src/app/(app)/rooms/new/page.tsx",
      "src/app/(app)/rooms/[roomId]/page.tsx",
      "src/app/(app)/rooms/[roomId]/brief/page.tsx",
      "src/app/(app)/rooms/[roomId]/proposals/[proposalId]/page.tsx",
      "src/app/(app)/rooms/[roomId]/requests/[requestId]/page.tsx",
      "src/app/(app)/rooms/[roomId]/results/page.tsx",
      "src/app/(app)/rooms/[roomId]/timeline/page.tsx",
      "src/app/(app)/rooms/[roomId]/people/page.tsx",
    ];
    for (const routeFile of expectedRoutes) {
      expect(fs.existsSync(routeFile)).toBe(true);
    }
  });

  it("W1-6-r07 inbox section / CTA routes straight to /rooms/[roomId]/proposals/[proposalId], workbench shows summary card, and decision screen has Reject and notIncludedForMe", async () => {
    const s5Card = buildInboxCard("customer", "S5");
    expect(s5Card.topTodo).not.toBeNull();
    expect(resolveInboxTodoHref(s5Card.roomId, s5Card.topTodo!, buildRoomView("customer", "S5"))).toBe(
      `/rooms/${TEST_ROOM_ID}/proposals/proposals_1`,
    );

    mount(createElement(DecisionInbox, { cards: [s5Card], roomViews: {[s5Card.roomId]:buildRoomView("customer", "S5")} }));
    const cta = screen.getByTestId(`inbox-cta-${TEST_ROOM_ID}`);
    expect(cta.getAttribute("href")).toBe(
      `/rooms/${TEST_ROOM_ID}/proposals/proposals_1`,
    );
    cleanup();

    // Workbench has short summary card with link to decision screen and no ApprovalButton
    workbench("customer", "S5");
    expect(screen.queryByTestId("approval-button")).toBeNull();
    expect(
      screen.getByTestId("review-decide-link").getAttribute("href"),
    ).toBe(`/rooms/${TEST_ROOM_ID}/proposals/proposals_1`);
    cleanup();

    // Decision screen has Approve, Reject dialog with reasonKey + private note, and notIncludedForMe
    const onRecord = vi.fn();
    mount(
      createElement(DecisionScreen, {
        view: buildRoomView("customer", "S5"),
        version: 1,
        onRecordDecision: onRecord,
      }),
    );
    expect(screen.getByTestId("not-included-for-me").textContent).toContain(
      "Not included from your wishlist: Slack alerts.",
    );
    fireEvent.click(screen.getByTestId("reject-button"));
    expect(screen.getByTestId("reject-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("reject-reason-needs_earlier_delivery"));
    fireEvent.change(screen.getByTestId("reject-private-note"), {
      target: { value: "Too close to Q4 freeze" },
    });
    fireEvent.click(screen.getByTestId("confirm-reject-button"));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
      decision: "reject",
      reasonKey: "needs_earlier_delivery",
      note: "Too close to Q4 freeze",
    }));
  });

  it("W1-6-r08 (setup) root mounts no ClerkProvider, (app) calls auth.protect(), /api/health returns 401 without session, and session mismatch banner renders", async () => {
    const fs = await import("node:fs");
    const setupLayout = fs.readFileSync("src/app/(setup)/layout.tsx", "utf8");
    expect(setupLayout).not.toContain("ClerkProvider");
    expect(setupLayout).not.toContain("ConvexClientProvider");

    const appLayout = fs.readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(appLayout).toContain("auth.protect()");

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: "unauthenticated" });

    // 13.2 no NotAvailable flash before auth
    mount(
      createElement(
        AppAuthGateView,
        {
          clerkLoaded: false,
          clerkSignedIn: false,
          convexLoading: true,
          convexAuthenticated: false,
          viewer: undefined,
        },
        createElement("div", { "data-testid": "protected-child" }, "Protected"),
      ),
    );
    expect(screen.getByTestId("auth-loading-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("room-not-available")).toBeNull();
    expect(screen.queryByTestId("protected-child")).toBeNull();
    cleanup();

    // Session mismatch banner when Clerk is signed in but Convex rejects token
    mount(
      createElement(
        AppAuthGateView,
        {
          clerkLoaded: true,
          clerkSignedIn: true,
          convexLoading: false,
          convexAuthenticated: false,
          viewer: undefined,
        },
        createElement("div", null, "Protected"),
      ),
    );
    expect(screen.getByTestId("auth-mismatch-banner").textContent).toContain(
      "Signed in, but the backend did not accept your session. See /setup.",
    );
  });

  it("W1-6-r09 <1024px single column orders decision and run progress before private brief, and StaleBanner focuses proposal title", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*\.pane-decide\s*\{\s*order:\s*1;/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*\.pane-know\s*\{\s*order:\s*2;/,
    );

    // Synthetic subscription update: keep the reviewed proposal while cv advances.
    const reviewed = buildRoomView("customer", "S5");
    mount(createElement(DecisionScreen, {view: {...reviewed, header: {...reviewed.header, constraintsVersion: 2}}, version: 1}));
    const titleEl = screen.getByTestId("decision-proposal-title");
    expect(document.activeElement).toBe(titleEl);
  });

  it("W1-6-r10 catalog title labelled Provider and rendered as text", () => {
    const maliciousTitle = "<img src=x onerror=alert(1)> **Bold** Title";
    const view = buildRoomView("customer", "S5");
    const modifiedView = {
      ...view,
      currentProposal: view.currentProposal
        ? {
            ...view.currentProposal,
            lines: [
              {
                ...view.currentProposal.lines[0]!,
                title: maliciousTitle,
              },
            ],
          }
        : null,
    };
    mount(createElement(DecisionScreen, { view: modifiedView, version: 1 }));
    const badges = screen.getAllByTestId("catalog-author-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]?.textContent).toBe("Provider");
    const lineContainer = screen.getByTestId("decision-lines");
    expect(lineContainer.querySelector("img")).toBeNull();
    expect(lineContainer.textContent).toContain(maliciousTitle);
  });
});

describe("Stage A & Stage B screens and interactions", () => {
  it("13.6 viewer-split waiting copy and one-question RequestScreen with D15 blocked option", () => {
    // Finance sees options on RequestScreen
    const financeView = buildRoomView("customer", "S7");
    const baseReq =
      financeView.openRequest && financeView.openRequest.mine
        ? financeView.openRequest
        : null;
    expect(baseReq).not.toBeNull();
    const withBlockedOption = {
      ...financeView,
      openRequest: baseReq
        ? {
            ...baseReq,
            options: [
              ...baseReq.options,
              {
                optionKey: "disclose_locked_opt",
                type: "blocked" as const,
                shown: {},
                text: "Needs Finance to raise the budget.",
                answerable: false as const,
                blockedReasonCode: "disclosure.blocked",
                effectView: {},
              },
            ],
          }
        : null,
    };

    mount(createElement(RequestScreen, { view: withBlockedOption }));
    expect(
      screen.getByTestId("request-options-group").getAttribute("role"),
    ).toBe("radiogroup");
    expect(screen.queryByText(/Let my agent choose/i)).toBeNull();
    expect(screen.queryByTestId("request-radio-disclose_locked_opt")).toBeNull();
    const blocked = screen.getByTestId("request-option-disclose_locked_opt");
    expect(blocked.textContent).toBe("Needs Finance to raise the budget.");
    expect(blocked.textContent).not.toMatch(/\d|\$/);
    cleanup();

    // Customer (other buyer) sees Waiting on Finance
    mount(createElement(RequestScreen, { view: buildRoomView("finance", "S7") }));
    expect(
      screen.getByTestId("request-waiting-buyer").textContent,
    ).toContain("Waiting on Customer");
    cleanup();

    // Provider sees neutral Waiting on other participants
    mount(createElement(RequestScreen, { view: buildRoomView("provider", "S7") }));
    const providerWaitText =
      screen.getByTestId("request-waiting-provider").textContent ?? "";
    expect(screen.getByText("Waiting on others").textContent).toBe("Waiting on others");
    expect(providerWaitText).not.toMatch(/waiting.*(?:finance|customer)/i);
    expect(providerWaitText).not.toContain("Finance");
  });

  it("13.4 ConfirmConstraintChangeDialog renders cap verdictAfter for Finance and recheck for Customer", () => {
    const onConfirm = vi.fn();
    mount(
      createElement(ConfirmConstraintChangeDialog, {
        preview: buildPreviewChange("finance"),
        currentConstraintsVersion: 1,
        onConfirm,
        onCancel: () => {},
      }),
    );
    expect(
      screen.getByTestId("preview-invalidated-approvals").textContent,
    ).toContain("2 people");
    expect(screen.getByTestId("preview-cap-verdict").textContent).toContain(
      "Over budget by $100.00",
    );
    fireEvent.click(screen.getByTestId("confirm-constraint-change-btn"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    cleanup();

    mount(
      createElement(ConfirmConstraintChangeDialog, {
        preview: buildPreviewChange("customer"),
        currentConstraintsVersion: 1,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(screen.getByTestId("preview-recheck-note").textContent).toContain(
      "Current proposal will be re-checked under the new constraints.",
    );
  });

  it("13.5 Guide my agent saves soft notes for next turn with no Pause control", () => {
    const onSaveGuidance = vi.fn();
    mount(
      createElement(RoomWorkbench, {
        view: buildRoomView("customer", "S3"),
        onSaveGuidance,
      }),
    );
    expect(screen.queryByText(/Pause/i)).toBeNull();
    fireEvent.change(screen.getByTestId("guide-agent-notes"), {
      target: { value: "Prioritize SSO login over custom theme" },
    });
    fireEvent.click(screen.getByTestId("guide-agent-submit"));
    expect(onSaveGuidance).toHaveBeenCalledWith(
      "Prioritize SSO login over custom theme",
    );
  });

  it("13.7 Timeline filter chips, Load older, N new events pill, and footer", () => {
    const view = buildRoomView("finance", "S11");
    mount(
      createElement(TimelineScreen, {
        view,
        items: buildTimeline("finance", "S11"),
        hasMore: true,
        newEventCount: 2,
      }),
    );
    expect(
      screen.getByTestId("timeline-new-events-pill").textContent,
    ).toContain("2 new events");
    expect(screen.getByTestId("timeline-load-older")).toBeTruthy();
    expect(screen.getByTestId("timeline-footer").textContent).toContain(
      "events visible to Finance in this room.",
    );

    fireEvent.click(screen.getByTestId("timeline-filter-private"));
    expect(screen.getByTestId("timeline-footer").textContent).toContain(
      "Showing all 9 events visible to Finance in this room.",
    );
  });

  it("13.7 deliveredItems rendered as Delivered in CO-n on follow-up brief", () => {
    const view = {
      ...buildRoomView("customer", "S5"),
      followUpOf: {
        previousRoomId: "room_parent" as Id<"rooms">,
        changeOrderNumber: 1,
        deliveredItems: [
          {
            itemKey: "sso_login",
            title: "SSO login (SAML)",
            changeOrderNumber: 1,
          },
        ],
      },
    };
    mount(createElement(BriefScreen, { view }));
    expect(screen.getByTestId("delivered-items-list").textContent).toContain(
      "SSO login (SAML) — Delivered in CO-1",
    );
  });

  it("13.5 historical proposal shows Checks are shown for the current proposal only", () => {
    const view = buildRoomView("customer", "S11");
    mount(createElement(DecisionScreen, { view, version: 1, historicalDetail: { card: { ...buildRoomView("customer", "S5").currentProposal!, status: "superseded" }, decisions: [] } }));
    expect(
      screen.getByTestId("historical-checks-note").textContent,
    ).toBe("Checks are shown for the current proposal only.");
    expect(screen.queryByTestId("approval-button")).toBeNull();
  });

  it("13.3.3 invite fragment token parser and error code translation never leak raw error messages", () => {
    expect(parseInviteFragmentToken("#t=tok_abc123")).toBe("tok_abc123");
    expect(parseInviteFragmentToken("")).toBeNull();

    mount(
      createElement(InviteLandingView, {
        initialHash: "#t=tok_abc123",
        isAuthenticated: true,
        onAccept: async () => {
          throw new Error("Raw internal stack trace secret 99999");
        },
      }),
    );
    fireEvent.click(screen.getByTestId("accept-invite-btn"));

    const parsed = parseUiError(new Error("Raw database secret error"));
    expect(parsed.message).toBe("Something went wrong. Please try again.");
    expect(parsed.message).not.toContain("Raw database secret");

    expect(
      formatErrorCode("run.rate_limited", { retryAfterMs: 3200 }).message,
    ).toBe("Please wait 4s before starting another update.");
  });

  it("13.9.3 diffTerms compares public proposal terms and RoomFrame renders NotAvailable for non-matching roomId", () => {
    const changes = diffTerms(
      {
        itemKeys: ["sso_login", "usage_dashboard"],
        modifiers: [],
        deliveryDate: "2026-11-18",
        amountCents: 60_000,
      },
      {
        itemKeys: ["sso_login", "audit_log_export"],
        modifiers: ["rush"],
        deliveryDate: "2026-11-16",
        amountCents: 95_000,
      },
    );
    expect(changes).toContain("+audit_log_export");
    expect(changes).toContain("−usage_dashboard");
    expect(changes).toContain("+rush");

    mount(
      createElement(
        RoomFrame,
        { roomId: "wrong_room_id", initialView: buildRoomView("customer", "S5") },
        createElement("div", null, "Child"),
      ),
    );
    expect(screen.getByTestId("room-not-available").textContent).toContain(
      "This room is not available to you",
    );
  });
});
