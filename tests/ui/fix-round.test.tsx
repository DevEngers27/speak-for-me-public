import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";
import { AppAuthShell } from "@/components/auth/AppAuthShell";
import { BriefRoute, ProposalRoute, RequestRoute, ResultsRoute, TimelineRoute, WorkbenchScreen } from "@/components/room/RoomScreens";
import { BriefScreen, ConfirmConstraintChangeDialog, DecisionScreen, RequestScreen } from "@/components/room/RoomSections";
import { InboxScreen } from "@/components/inbox/InboxScreen";
import { SCENARIO_REJECT_REASONS } from "@/components/prototype/markers";
import { api } from "@/lib/api";
import type { RoomView, ViewerView } from "@/lib/viewModels/types";
import { generated } from "./generated-fixtures";
import infeasibleFixture from "./fixtures/generated/infeasible-request.json";
import blockedFixture from "./fixtures/generated/blocked-request.json";
import type { Projection } from "../../scripts/gen-ui-fixtures";
import { protocol } from "@core/scenarios/scope-change/candidates";
import { buildRoomView, buildInboxCard, buildBriefQuery, buildCatalogQuery, buildExecution, buildTimeline, buildPreviewChange, TEST_ROOM_ID, canaryAmounts } from "./fixtures";

const state = vi.hoisted(() => ({
  room: null as RoomView | null,
  viewer: { status: "unprovisioned" } as ViewerView | null,
  authenticated: true,
  queries: new Map<string, unknown>(),
  calls: [] as { name: string; args: unknown }[],
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  push: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("@/components/providers", () => ({ useBackendStatus: () => ({ live: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }), usePathname: () => "/rooms" }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: state.preview }),
  useConvexAuth: () => ({ isAuthenticated: state.authenticated, isLoading: false }),
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    if (args === "skip") return undefined;
    if (name === "users:viewer") return state.viewer;
    return state.queries.get(name);
  },
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    if (!state.mutations.has(name)) state.mutations.set(name, vi.fn().mockResolvedValue({}));
    return state.mutations.get(name);
  },
  useAction: () => vi.fn(),
}));
vi.mock("@/components/room/RoomFrame", async (original) => ({
  ...await original<typeof import("@/components/room/RoomFrame")>(),
  useRoomView: () => state.room,
}));
beforeEach(() => {
  state.room = buildRoomView("customer", "S5");
  state.viewer = { status: "unprovisioned" };
  state.authenticated = true;
  state.queries.clear(); state.mutations.clear(); state.calls.length = 0; state.push.mockReset(); state.preview.mockReset();
});
afterEach(cleanup);

function BusinessQuery() { useQuery(api.rooms.listMine, { paginationOpts: { numItems: 50, cursor: null } }); return <p>Business mounted</p>; }
function mutation(name: string) { return state.mutations.get(name)!; }
function change(id: string, value: string) { fireEvent.change(screen.getByTestId(id), { target: { value } }); }

describe("W2-6A contract and interaction regressions", () => {
  it("locks brief mutations until the pending write settles", async () => {
    state.room = buildRoomView("provider", "S3");
    state.queries.set("briefs:mine", { ...buildBriefQuery("provider", "S3"), latest: null });
    state.queries.set("catalog:list", buildCatalogQuery());
    let finish!: () => void;
    state.mutations.set("briefs:confirm", vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    render(<BriefRoute />);
    fireEvent.click(screen.getByTestId("confirm-provider-brief-btn"));
    fireEvent.click(screen.getByTestId("confirm-provider-brief-btn"));
    expect(mutation("briefs:confirm")).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("confirm-catalog-btn").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect((screen.getByTestId("confirm-catalog-btn").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  });

  it("preserves catalog task assignments when editing an item", async () => {
    const view = buildRoomView("provider", "S3");
    const catalog = buildCatalogQuery();
    const item = catalog.items.find(entry => entry.kind === "item")!;
    item.taskTemplates = [{ title: "Review delivery", assigneeRole: "customer" }];
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<BriefScreen view={view} brief={buildBriefQuery("provider", "S3")} catalog={catalog} onConfirmCatalog={confirm} />);
    fireEvent.click(screen.getByTestId(`edit-catalog-${item.itemKey}`));
    expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("Review delivery");
    expect((screen.getByLabelText("Assignee") as HTMLSelectElement).value).toBe("customer");
    fireEvent.click(screen.getByTestId("confirm-catalog-btn"));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith([expect.objectContaining({ taskTemplates: item.taskTemplates })]));
  });

  it("F1 unprovisioned → ensureViewer → ready mounts business queries only after the ready query", async () => {
    const node = <AppAuthShell><BusinessQuery /></AppAuthShell>;
    const mounted = render(node);
    await waitFor(() => expect(mutation("users:ensureViewer")).toHaveBeenCalledExactlyOnceWith({}));
    expect(screen.queryByText("Business mounted")).toBeNull();
    expect(state.calls.some((call) => call.name === "rooms:listMine")).toBe(false);
    // Mutation completion is insufficient: the subscribed viewer must become ready.
    expect(screen.getByTestId("auth-provisioning-skeleton")).toBeTruthy();
    state.viewer = { status: "ready", userId: "viewer" as Id<"users">, displayName: "Viewer", emailVerified: true };
    mounted.rerender(<AppAuthShell><BusinessQuery /></AppAuthShell>);
    expect(screen.getByText("Business mounted")).toBeTruthy();
    expect(mutation("users:ensureViewer")).toHaveBeenCalledTimes(1);
    state.viewer = { status: "unprovisioned" };
    mounted.rerender(<AppAuthShell><BusinessQuery /></AppAuthShell>);
    await waitFor(() => expect(mutation("users:ensureViewer")).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Business mounted")).toBeNull();
  });

  it.each([null, { status: "unprovisioned" } as const])("F1 viewer %j never mounts business children", (viewer) => {
    state.viewer = viewer;
    render(<AppAuthShell><BusinessQuery /></AppAuthShell>);
    expect(screen.queryByText("Business mounted")).toBeNull();
  });

  it("F1 unauthenticated viewer query is skipped", () => {
    state.authenticated = false;
    render(<AppAuthShell><BusinessQuery /></AppAuthShell>);
    expect(state.calls).toContainEqual({ name: "users:viewer", args: "skip" });
    expect(state.calls.some((call) => call.name === "rooms:listMine")).toBe(false);
  });

  it("W2-1 integration inbox consumes the real pagination envelope and arguments", () => {
    state.queries.set("rooms:listMine", { page: [buildInboxCard("customer", "S5")], isDone: true, continueCursor: "" });
    state.queries.set("invites:listMine", { emailVerified: true, invites: [] });
    render(<InboxScreen />);
    expect(state.calls).toContainEqual({ name: "rooms:listMine", args: { paginationOpts: { numItems: 50, cursor: null } } });
    expect(screen.getByTestId("inbox-needs_you").textContent).toContain("Review & decide");
  });

  it("F12 all temporary references and generated namespaces resolve Convex function names", () => {
    expect(getFunctionName(api.health.ping)).toBe("health:ping");
    const names = [api.users.viewer, api.users.ensureViewer, api.rooms.view, api.rooms.create, api.rooms.startFollowUp, api.invites.accept, api.briefs.confirm, api.budget.setCap, api.ledger.recordBaseline, api.sharedFacts.add, api.catalog.confirm, api.approvals.record, api.humanRequests.answer, api.runs.start, api.runs.retryTurn, api.runs.cancel, api.tasks.markDone, api.timeline.page];
    for (const ref of names) expect(getFunctionName(ref)).toMatch(/^[\w/]+:\w+$/);
  });

  it.each(["customer", "provider", "finance"] as const)("F4 %s rejection keys are scenario human keys with declared audience and eligibility", (role) => {
    state.room = buildRoomView(role, "S5");
    render(<ProposalRoute proposalId="proposals_1" />);
    fireEvent.click(screen.getByTestId("reject-button"));
    const humanKeys = protocol.reasonKeys.filter((decl) => decl.usableBy.includes("human")).map((decl) => decl.reasonKey);
    expect(SCENARIO_REJECT_REASONS.map((reason) => reason.key).sort()).toEqual([...humanKeys].sort());
    for (const reason of SCENARIO_REJECT_REASONS) {
      const radio = screen.queryByTestId(`reject-reason-${reason.key}`);
      expect(Boolean(radio)).toBe(reason.key !== "over_our_limit" || role === "finance");
    }
    const key = role === "finance" ? "over_our_limit" : "needs_earlier_delivery";
    fireEvent.click(screen.getByTestId(`reject-reason-${key}`));
    expect(screen.getByTestId(`reject-reason-${key}`).parentElement?.textContent).toContain(role === "finance" ? "Shared with buyers" : "Shared with the room");
    fireEvent.click(screen.getByTestId("confirm-reject-button"));
    expect(mutation("approvals:record")).toHaveBeenCalledWith({ proposalId: "proposals_1", decision: "reject", expectedConstraintsVersion: 1, expectedTermsKey: state.room.currentProposal!.termsKey, reasonKey: key, note: null });
  });

  it("F5 approval.stale mutation response shows stale banner and focuses the proposal title", async () => {
    state.mutations.set("approvals:record", vi.fn().mockRejectedValue(new ConvexError({ code: "approval.stale", params: { currentConstraintsVersion: 2 } })));
    render(<ProposalRoute proposalId="proposals_1" />);
    fireEvent.click(screen.getByTestId("approval-button"));
    await waitFor(() => expect(screen.getByTestId("stale-banner").textContent).toContain("Constraints changed to v2"));
    expect(screen.getByTestId("approval-button").getAttribute("aria-disabled")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("decision-proposal-title")));
    expect(screen.queryByTestId("decision-error")).toBeNull();
    expect(mutation("approvals:record")).toHaveBeenCalledWith(expect.objectContaining({ expectedConstraintsVersion: 1, expectedTermsKey: state.room!.currentProposal!.termsKey }));
  });

  it.each(["constraints", "terms", "proposal"])("F5 live %s binding change invalidates rejection and clears private input", (kind) => {
    const original = buildRoomView("customer", "S5");
    const mounted = render(<DecisionScreen view={original} version={1} onRecordDecision={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reject-button"));
    change("reject-private-note", "Old private note");
    const next: RoomView = { ...original, header: { ...original.header, constraintsVersion: kind === "constraints" ? 2 : 1 }, currentProposal: { ...original.currentProposal!, proposalId: (kind === "proposal" ? "proposal_other" : "proposals_1") as Id<"proposals">, termsKey: kind === "terms" ? "new terms" : original.currentProposal!.termsKey } };
    mounted.rerender(<DecisionScreen view={next} version={1} onRecordDecision={vi.fn()} />);
    expect(screen.queryByTestId("reject-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("reject-button"));
    expect((screen.getByTestId("reject-private-note") as HTMLTextAreaElement).value).toBe("");
  });

  it("F6/F11 synthetic by design: no scope_change v1 path emits blocked", () => {
    const projection = blockedFixture["initial-request"].customer as unknown as Projection;
    const detail = projection.request;
    if (!detail?.mine) throw new Error("Expected own request");
    // Synthetic by design: no scope_change v1 path emits blocked.
    const blocked = {type: "blocked" as const, shown: {}, optionKey: "blocked", answerable: false, effectView: {}, text: "Needs Finance to raise the budget."};
    render(<RequestScreen view={projection.room} requestDetail={{...detail, options: [blocked, ...detail.options]}} />);
    const option = screen.getByTestId(`request-option-${blocked.optionKey}`);
    expect(option.textContent).toBe("Needs Finance to raise the budget.");
    expect(option.innerHTML).not.toMatch(/\d|\$/);
    expect(option.querySelector("input")).toBeNull();
    for (const cents of Object.values(canaryAmounts)) expect(option.textContent).not.toContain(String(cents));
  });

  it("F13 request has no default choice, reachable disabled reason, and second-step end_run confirmation", async () => {
    state.room = buildRoomView("customer", "S7");
    state.queries.set("humanRequests:get", generated.revised!.customer.request);
    state.mutations.set("humanRequests:answer", vi.fn().mockResolvedValue({ outcome: "applied", effect: "end_run", constraintsVersion: 2, runId: "run_2", proposalId: null }));
    render(<RequestRoute requestId="open" />);
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText("Agents did not pick this. This is a human choice.")).toBeTruthy();
    const confirm = screen.getByTestId("confirm-request-answer");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    expect(document.activeElement?.id).toBe("request-choice-reason");
    expect(mutation("humanRequests:answer")).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("request-radio-C"));
    fireEvent.click(confirm);
    expect(mutation("humanRequests:answer")).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Confirm end negotiation")).toBeTruthy());
    fireEvent.click(screen.getByTestId("confirm-request-answer"));
    await waitFor(() => expect(mutation("humanRequests:answer")).toHaveBeenCalledExactlyOnceWith({ requestId: "humanRequests_1", optionKey: "C" }));
  });

  it("F-UI question card offers Answer later and confirms end_run in a second step", async () => {
    state.room = buildRoomView("customer", "S7");
    render(<WorkbenchScreen />);
    expect(screen.getByText("Answer later (expires after 7 days)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("question-end-run"));
    expect(mutation("humanRequests:answer")).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("question-end-run"));
    await waitFor(() => expect(mutation("humanRequests:answer")).toHaveBeenCalledExactlyOnceWith({ requestId: "humanRequests_1", optionKey: "C" }));
  });

  it.each(["customer", "finance", "provider"] as const)("F7 %s initial setup uses role-specific briefs.confirm and actual query values for edits", async (role) => {
    state.room = buildRoomView(role, "S3");
    state.room = { ...state.room, header: { ...state.room.header, status: "setup", constraintsVersion: 0, phase: { phase: "setup", gaps: [{ gap: "brief_unconfirmed", ownerRole: role }] } } };
    const brief = { ...buildBriefQuery(role, "S3"), latest: null, finance: role === "finance" ? { committedCents: 0, baselineRecorded: false, baselineSuggestionCents: null } : null };
    state.queries.set("briefs:mine", brief); state.queries.set("catalog:list", buildCatalogQuery());
    const mounted = render(<BriefRoute />);
    if (role === "customer") {
      expect((screen.getByTestId("customer-deadline-input") as HTMLInputElement).value).toBe("");
      change("customer-deadline-input", "2027-01-15"); change("customer-required-items-input", "sso_login");
      fireEvent.click(screen.getByTestId("confirm-customer-brief-btn"));
    } else if (role === "finance") {
      expect((screen.getByTestId("finance-cap-input") as HTMLInputElement).value).toBe("");
      change("finance-baseline-input", "0"); fireEvent.click(screen.getByTestId("record-baseline-btn"));
      await waitFor(() => expect((screen.getByTestId("confirm-cap-btn").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
      change("finance-cap-input", "7000"); fireEvent.click(screen.getByTestId("confirm-cap-btn"));
      expect(mutation("budget:setCap")).not.toHaveBeenCalled();
      expect(mutation("ledger:recordBaseline")).toHaveBeenCalledWith({ roomId: TEST_ROOM_ID, amountCents: 0 });
    } else {
      expect((screen.getByTestId("catalog-key-input") as HTMLInputElement).value).toBe("");
      fireEvent.click(screen.getByTestId("confirm-provider-brief-btn"));
      await waitFor(() => expect((screen.getByTestId("confirm-catalog-btn").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
      change("catalog-key-input", "new_item"); change("catalog-title-input", "Real service"); change("catalog-price-input", "45"); change("catalog-lead-input", "7");
      fireEvent.click(screen.getByTestId("confirm-catalog-btn"));
      await waitFor(() => expect(mutation("catalog:confirm")).toHaveBeenCalledWith(expect.objectContaining({ expectedConstraintsVersion: 0, rows: [expect.objectContaining({ itemKey: "new_item", priceCents: 4500 })] })));
    }
    await waitFor(() => expect(mutation("briefs:confirm")).toHaveBeenCalledTimes(1));
    const input = mutation("briefs:confirm").mock.calls[0]![0];
    expect(input.hardFields.schemaKey).toBe(`scope_change.${role}.v1`);
    expect(input.softFields.schemaKey).toBe(`scope_change.${role}.v1`);
    expect(input.expectedConstraintsVersion).toBe(0);
    expect(Object.keys(input).sort()).toEqual(["disclosures", "expectedConstraintsVersion", "hardFields", "roomId", "softFields"]);
    const confirmed = buildBriefQuery(role, "S3");
    if (confirmed.latest && role === "customer") confirmed.latest.hardFields = { schemaKey: "scope_change.customer.v1", requiredItemKeys: ["audit_log_export"], deadline: "2027-02-03" };
    if (confirmed.latest && role === "finance") confirmed.latest.hardFields = { schemaKey: "scope_change.finance.v1", capCents: 700123 };
    state.queries.set("briefs:mine", confirmed);
    mounted.rerender(<BriefRoute />);
    expect(screen.getByText("Confirmed brief v1")).toBeTruthy();
    if (role === "customer") expect((screen.getByTestId("customer-deadline-input") as HTMLInputElement).value).toBe("2027-02-03");
    if (role === "finance") expect((screen.getByTestId("finance-cap-input") as HTMLInputElement).value).toBe("7001.23");
  });

  it("F3 results and timeline routes read their canonical queries instead of rooms.view extras", () => {
    state.room = buildRoomView("finance", "S11");
    state.queries.set("executions:forRoom", buildExecution("finance", "S11"));
    const mounted = render(<ResultsRoute />);
    expect(screen.getByTestId("amount-chain").textContent).toContain("$4,800.00");
    cleanup();
    state.queries.set("timeline:page", { page: buildTimeline("finance", "S11"), isDone: true, continueCursor: "" });
    mounted.unmount(); render(<TimelineRoute />);
    expect(state.calls).toContainEqual({ name: "timeline:page", args: { roomId: TEST_ROOM_ID, paginationOpts: { numItems: 50, cursor: null } } });
    expect(screen.getByTestId("timeline-page").textContent).toContain("Finance updated");
  });

  it.each(["setup", "stopped", "closed", "waiting-buyer", "waiting-provider"])("F8 W1-6-r06 route state %s renders", (kind) => {
    const role = kind === "waiting-provider" ? "provider" : "finance";
    const base = buildRoomView(role, "S7");
    state.room = kind.startsWith("waiting") ? base : { ...base, header: { ...base.header, phase: kind === "setup" ? { phase: "setup", gaps: [{ gap: "brief_unconfirmed", ownerRole: role }] } : kind === "stopped" ? { phase: "stopped", reason: "ended_no_agreement" } : { phase: "closed" }, status: kind === "setup" ? "setup" : kind === "closed" ? "closed" : "open" } };
    render(<WorkbenchScreen />);
    expect(screen.getByTestId("room-workbench")).toBeTruthy();
    if (kind.startsWith("waiting")) expect(screen.getByTestId("tradeoff-card").textContent).toContain(kind === "waiting-provider" ? "Waiting on others" : "Waiting on Customer");
    else expect(screen.getByTestId("phase-banner").textContent).toBe(kind === "setup" ? "Finish setting up the room" : kind === "stopped" ? "Negotiation stopped" : "Room closed");
  });

  it("F9/F10 provider S7 DTO and DOM have neutral authors, no wait target, no other brief versions", () => {
    state.room = buildRoomView("provider", "S7");
    const timeline = buildTimeline("provider", "S7");
    const blob = JSON.stringify({ room: state.room, timeline });
    expect(blob).not.toContain("Finance updated"); expect(blob).not.toContain("waitingOn");
    expect(state.room.proposalHistory?.find(row => row.version === 1)?.status).toBe("superseded");
    expect(state.room.sharedFacts.filter(fact => fact.fromRole !== "provider").every((fact) => fact.asOfBriefVersion === null)).toBe(true);
    expect(timeline.filter((item) => item.refs.constraintsVersion === 2).every((item) => item.actorKind === "system" && item.actorRole === "system")).toBe(true);
    render(<WorkbenchScreen />);
    expect(screen.getByTestId("room-workbench").textContent).not.toMatch(/Finance updated|Waiting on (?:Finance|Customer)|(?:Finance|Customer) attempt/);
  });

  it.each(["customer", "provider"] as const)("F10 %s sees no other party's attempt status or named wait targets", (role) => {
    state.room = buildRoomView(role, "S3");
    render(<WorkbenchScreen />);
    const text = screen.getByTestId("room-workbench").textContent;
    expect(text).not.toMatch(/(?:Finance|Customer|Provider) attempt|Waiting on (?:Finance|Customer|Provider)/);
    expect(state.room.run?.attemptStatus).toBe(role === "provider" ? "running" : null);
    expect(state.room.run?.waiting).toBeNull();
  });

});

it('F7 open request route resolves the alias to the actual generated request id', () => {
 state.room = buildRoomView('customer','S7');
 state.queries.set('humanRequests:get', generated.revised!.customer.request);
 render(<RequestRoute requestId="open" />);
 expect(state.calls).toContainEqual({name:'humanRequests:get',args:{roomId:TEST_ROOM_ID,requestId:'humanRequests_1'}});
 expect(state.calls.some(call => call.name === 'humanRequests:get' && JSON.stringify(call.args).includes('"requestId":"open"'))).toBe(false);
});
it('F7 missing open request skips id validation and shows the closed screen', () => {
 state.room = buildRoomView('provider','S7');
 render(<RequestRoute requestId="open" />);
 expect(state.calls).toContainEqual({name:'humanRequests:get',args:'skip'});
 expect(screen.getByTestId('request-closed')).toBeTruthy();
});
it('F11 constraint confirmation disables after a subscription cv change', () => {
 const confirm = vi.fn();
 const preview = buildPreviewChange('finance');
 const mounted = render(<ConfirmConstraintChangeDialog preview={preview} currentConstraintsVersion={1} onConfirm={confirm} onCancel={vi.fn()} />);
 mounted.rerender(<ConfirmConstraintChangeDialog preview={preview} currentConstraintsVersion={2} onConfirm={confirm} onCancel={vi.fn()} />);
 expect(screen.getByText('Constraints changed to v2 while you were reviewing')).toBeTruthy();
 const button = screen.getByTestId('confirm-constraint-change-btn');
 expect(button.getAttribute('aria-disabled')).toBe('true');
 expect(button.hasAttribute('disabled')).toBe(false);
 expect(document.getElementById(button.getAttribute('aria-describedby')!)).toBe(screen.getByRole('alert', {hidden:true}));
 fireEvent.click(button);
 expect(confirm).not.toHaveBeenCalled();
});

it('F11 raise-cap without an authoritative amount defers without preview or answer', () => {
 const projection = structuredClone(infeasibleFixture.revised.finance) as unknown as Projection;
 if (!projection.request?.mine) throw new Error('Expected own request');
 const option = projection.request.options.find(o => o.type === 'raise_cap');
 if (!option || option.type !== 'raise_cap') throw new Error('Expected cap option');
 // Deliberately malformed boundary fixture; generated options now carry real amounts.
 option.effect.amountCents = Number.NaN;
 state.room = projection.room;
 state.queries.set('humanRequests:get', projection.request);
 render(<RequestRoute requestId="open" />);
 expect((screen.getByTestId('request-radio-A') as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByTestId('request-radio-A'));
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(state.preview).not.toHaveBeenCalled();
 expect(mutation('humanRequests:answer')).not.toHaveBeenCalled();
});
it('F11 setup brief writes without calling previewChange', async () => {
 state.room = structuredClone(generated.setup!.customer.room);
 state.queries.set('briefs:mine', generated.setup!.customer.brief);
 state.queries.set('catalog:list', generated.setup!.customer.catalog);
 render(<BriefRoute />);
 fireEvent.click(screen.getByTestId('confirm-customer-brief-btn'));
 await waitFor(() => expect(mutation('briefs:confirm')).toHaveBeenCalledOnce());
 expect(state.preview).not.toHaveBeenCalled();
 expect(screen.queryByTestId('confirm-constraint-change-dialog')).toBeNull();
});

it.each(['drop_items','extend_deadline','raise_cap'] as const)('round 7 %s uses the payload preview and waits for constraint confirmation', async (kind) => {
 const {default: snapshots}=await import('./fixtures/generated/option-payloads.json');
 const projections=snapshots as unknown as Record<string,Record<string,Projection>>;
 const p=kind==='raise_cap'?projections.finance!.finance!:projections.customer!.customer!;
 state.room=structuredClone(p.room);
 state.queries.set('humanRequests:get',p.request); state.queries.set('briefs:mine',p.brief);
 const request=p.request;
 if(!request?.mine)throw new Error('Expected target request');
 const option=request.options.find(o=>o.type===kind)!;
 expect(option).toBeTruthy();
 const preview=buildPreviewChange(kind==='raise_cap'?'finance':'customer');
 state.preview.mockResolvedValue(preview);
 render(<RequestRoute requestId="open"/>);
 fireEvent.click(screen.getByTestId(`request-radio-${option.optionKey}`));
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 const hard=p.brief!.latest!.hardFields;
 const change=option.type==='raise_cap'?{kind:'cap',newCapCents:option.effect.amountCents}:option.type==='extend_deadline'?{kind:'customer_hard',deadline:option.effect.date}:{kind:'customer_hard',requiredItemKeys:'requiredItemKeys' in hard && option.type==='drop_items'?hard.requiredItemKeys.filter(k=>!option.effect.itemKeys.includes(k)):[]};
 await waitFor(()=>expect(state.preview).toHaveBeenCalledExactlyOnceWith(api.rooms.previewChange,{roomId:p.room.header.roomId,change}));
 await waitFor(()=>expect(screen.getByTestId('confirm-constraint-change-dialog')).toBeTruthy());
 expect(mutation('humanRequests:answer')).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId('confirm-constraint-change-btn'));
 await waitFor(()=>expect(mutation('humanRequests:answer')).toHaveBeenCalledWith({requestId:request.requestId,optionKey:option.optionKey}));
});

it('round 8 stale archived proposal retains the new-version banner and focuses it after regeneration',async()=>{
 const original=buildRoomView('finance','S5');
 const old=original.currentProposal!;
 const mounted=render(<DecisionScreen view={original} proposalId={old.proposalId}/>);
 fireEvent.click(screen.getByTestId('reject-button'));
 const next={...original,header:{...original.header,constraintsVersion:2},currentProposal:{...old,proposalId:'replacement' as Id<'proposals'>,version:old.version+1}};
 const historicalDetail={card:{...old,status:'stale' as const,approvals:old.approvals.map(slot=>({...slot,state:'stale_approve' as const}))}} as unknown as import('@/lib/viewModels/types').ProposalDetailView;
 mounted.rerender(<DecisionScreen view={next} proposalId={old.proposalId} historicalDetail={historicalDetail}/>);
 expect(screen.queryByTestId('reject-dialog')).toBeNull();
 const banner=screen.getByTestId('stale-banner');
 expect(banner.textContent).toContain('Constraints changed to v2 while you were reviewing. Review again before deciding.');
 await waitFor(()=>expect(document.activeElement).toBe(banner));
 expect(screen.getAllByText(/No longer applies/).length).toBeGreaterThan(0);
});

it('round 8 room lists contain only listitems and retain the Simulated badge',()=>{
 render(<WorkbenchScreen/>);
 expect(screen.getAllByTestId('simulated-badge').length).toBeGreaterThan(0);
 expect(screen.getByTestId('run-progress').querySelector('[data-testid="simulated-badge"]')).toBeNull();
 for(const list of document.querySelectorAll('ol,ul'))for(const child of list.children)expect(child.tagName).toBe('LI');
});
