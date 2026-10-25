// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { api as generatedApi } from "@convex/_generated/api";
import { api } from "@/lib/api";
import { AppAuthGateView } from "@/components/auth/AppAuthShell";
import { customRequest } from "../../tests/convex-helpers/request.fixture";
import { seedRoom } from "../../tests/convex-helpers/seedRoom.fixture";
import { BriefScreen, RequestScreen } from "@/components/room/RoomSections";
import { RoomWorkbench } from "@/components/room/RoomWorkbench";
import { DecisionInbox } from "@/components/inbox/DecisionInbox";
import { setup, financeBrief, customerBrief } from "../../tests/convex-helpers/workflows.fixture";
import { asRole } from "../../tests/convex-helpers/roles";
import { openRoomTx } from "../../convex/lib/db";
import { appendEvents } from "../../convex/model/events";

describe("W2-6 integration with real W2-1 query DTOs", () => {
  it.each(["customer", "provider", "finance"] as const)("I-FE-2/I-FE-4 %s screens consume real room, brief, catalog, timeline, and paginated inbox queries", async (role) => {
    const seeded = await setup("catalog");
    await financeBrief(seeded, { capCents: ["customer"] });
    await customerBrief(seeded, { deadline: ["provider"], requiredItemKeys: ["provider"] });
    await seeded.actors.provider.mutation(api.briefs.confirm, { roomId: seeded.roomId, expectedConstraintsVersion: 0, hardFields: { schemaKey: "scope_change.provider.v1" }, softFields: { schemaKey: "scope_change.provider.v1", notes: "PROVIDER_OWN_NOTE" }, disclosures: {} });
    await seeded.actors.finance.mutation(api.ledger.recordBaseline, { roomId: seeded.roomId, amountCents: 400000 });
    const actor = seeded.actors[role];
    const view = (await actor.query(api.rooms.view, { roomId: seeded.roomId }))!;
    const brief = (await actor.query(api.briefs.mine, { roomId: seeded.roomId }))!;
    const catalog = (await actor.query(api.catalog.list, { roomId: seeded.roomId }))!;
    const timeline = (await actor.query(api.timeline.page, { roomId: seeded.roomId, paginationOpts: { numItems: 100, cursor: null } }))!;
    const inbox = (await actor.query(api.rooms.listMine, { paginationOpts: { numItems: 1, cursor: null } }))!;
    const invites = (await actor.query(api.invites.listMine, {}))!;
    const dto = JSON.stringify({ view, brief, catalog, timeline });
    const markup = renderToStaticMarkup(<><RoomWorkbench view={view} brief={brief} timeline={timeline.page} /><BriefScreen view={view} brief={brief} catalog={catalog} /><DecisionInbox cards={inbox.page} invites={invites.invites} /></>);
    for (const [owner, marker] of [["customer", "CUSTOMER_PRIVATE_NOTE"], ["finance", "FINANCE_PRIVATE_NOTE"], ["provider", "PROVIDER_OWN_NOTE"]] as const) {
      if (owner === role) expect(markup).toContain(marker);
      else { expect(dto).not.toContain(marker); expect(markup).not.toContain(marker); }
    }
    if (role === "provider") {
      expect(view.budget).toEqual({ visibility: "none" });
      expect(view.sharedFacts.every((fact) => fact.value?.kind === "date" || fact.value?.kind === "itemKeys")).toBe(true);
      expect(markup).not.toMatch(/\$5,000|\$4,000|FINANCE_PRIVATE_NOTE|CUSTOMER_PRIVATE_NOTE/);
    }
    if (role === "finance") { expect(markup).toContain('value="5000"'); expect(markup).toContain("Shared with Customer"); }
    expect(inbox.page).toHaveLength(1);
    expect(typeof inbox.continueCursor).toBe("string");
    // Real W2-1 references retain exactly the generated argument/return contracts.
    expect(await actor.query(api.rooms.view, { roomId: seeded.roomId })).toEqual(await actor.query(generatedApi.rooms.view, { roomId: seeded.roomId }));
  });

  it("I-FE-1 real viewer provisioning controls the auth gate", async () => {
    const seeded = await setup();
    const newcomer = asRole(seeded.t, "new-ui-user");
    const before = await newcomer.query(api.users.viewer, {});
    expect(before).toEqual({ status: "unprovisioned" });
    const props = { clerkLoaded: true, clerkSignedIn: true, convexLoading: false, convexAuthenticated: true };
    expect(renderToStaticMarkup(<AppAuthGateView {...props} viewer={before}><p>Business child</p></AppAuthGateView>)).not.toContain("Business child");
    await newcomer.mutation(api.users.ensureViewer, {});
    const ready = await newcomer.query(api.users.viewer, {});
    expect(ready?.status).toBe("ready");
    expect(renderToStaticMarkup(<AppAuthGateView {...props} viewer={ready}><p>Business child</p></AppAuthGateView>)).toContain("Business child");
  });

  it("DX-5/DX-7 real provider query and timeline projections remain author-neutral for either buyer's bump", async () => {
    const projections = [];
    for (const role of ["finance", "customer"] as const) {
      const seeded = await setup("catalog");
      await financeBrief(seeded); await customerBrief(seeded);
      await seeded.t.run(async (ctx) => {
        const tx = await openRoomTx(ctx, seeded.roomId, { allow: ["setup"] });
        await appendEvents(tx, [
          { payload: { type: "brief_confirmed", role, version: 2, hardChanged: true }, actor: { kind: "user", role }, actorUserId: seeded.users[role].userId },
          { payload: { type: "constraints_changed", fromVersion: 1, toVersion: 2 }, actor: { kind: "user", role }, actorUserId: seeded.users[role].userId },
          { payload: { type: "run_needs_input", runNo: 1 }, actor: { kind: "user", role }, actorUserId: seeded.users[role].userId },
        ]);
        await tx.patch("rooms", seeded.roomId, { status: "open", constraintsVersion: 2 });
      });
      const view = (await seeded.actors.provider.query(api.rooms.view, { roomId: seeded.roomId }))!;
      const timeline = (await seeded.actors.provider.query(api.timeline.page, { roomId: seeded.roomId, paginationOpts: { numItems: 100, cursor: null } }))!;
      const changed = timeline.page.find((entry) => entry.type === "constraints_changed")!;
      expect(changed).toMatchObject({ text: "Constraints changed (v2)", actorKind: "system", actorRole: "system" });
      expect(view.members.filter((member) => !member.isMe).every((member) => member.briefVersion === null)).toBe(true);
      expect(JSON.stringify(view)).not.toMatch(/waitingOn|FINANCE_PRIVATE_NOTE|CUSTOMER_PRIVATE_NOTE/);
      const neutral = timeline.page.filter((entry) => entry.type === "constraints_changed" || entry.type === "run_waiting");
      expect(neutral.every((entry) => entry.actorKind === "system" && entry.actorRole === "system")).toBe(true);
      const markup = renderToStaticMarkup(<RoomWorkbench view={view} timeline={neutral} />);
      expect(markup).not.toMatch(/Finance updated|Customer updated|Waiting on Finance|Waiting on Customer/);
      // Normalize only database identity/time, which differ between test databases.
      projections.push({ room: { ...view, header: { ...view.header, roomId: "ROOM" } }, timeline: neutral.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "eventId" && key !== "at"))) });
    }
    expect(JSON.stringify(projections[0])).toBe(JSON.stringify(projections[1]));
  });
});


describe("W2-4 real run DTO privacy in UI", () => {
  it("shows attempt and waiting details only to the active turn owner", async () => {
    const s = await seedRoom();
    await s.t.run(async ctx => {
      const turn = (await ctx.db.query("turns").first())!;
      await ctx.db.patch(turn._id, { waitingReason: "backoff" });
    });
    for (const role of ["customer", "provider", "finance"] as const) {
      const view = (await s.as(role).query(api.rooms.view, { roomId: s.roomId }))!;
      const markup = renderToStaticMarkup(<RoomWorkbench view={view} />);
      expect(view.run?.turnStatus).toBeTruthy();
      if (role === "provider") {
        expect(view.run?.attemptStatus).toBe("running");
        expect(view.run?.waiting).toBe("backoff");
        expect(markup).toContain("attempt-status");
      } else {
        expect(view.run?.attemptStatus).toBeNull();
        expect(view.run?.waiting).toBeNull();
        expect(markup).not.toMatch(/attempt-status|run-waiting-banner/);
      }
    }
  });

  it("keeps blocked options free of digits and provider requests role-neutral", async () => {
    const s = await customRequest({ type: "blocked" }, "finance", "infeasible");
    for (const role of ["customer", "provider", "finance"] as const) {
      const view = (await s.as(role).query(api.rooms.view, { roomId: s.roomId }))!;
      const markup = renderToStaticMarkup(<RequestScreen view={view} />);
      if (role === "provider") {
        expect(view.openRequest).toEqual({ mine: false, kind: "run_waiting" });
        expect(view.run?.status).toBe("run_waiting");
        expect(markup).not.toMatch(/Finance|infeasible|blocked/);
      } else if (role === "customer") {
        expect(view.openRequest).toEqual({ mine: false, waitingOnRole: "finance", kind: "infeasible" });
      } else {
        const request = view.openRequest;
        expect(request?.mine).toBe(true);
        if (!request?.mine) throw new Error("Expected own request");
        const blocked = request.options.find(option => !option.answerable)!;
        expect(blocked.answerable).toBe(false);
        expect(blocked.text).not.toMatch(/\d/);
        expect(markup).toContain("request-option-A");
      }
    }
  });
});

describe("W2-6 stage B generated execution and decision contracts", () => {
  it("I-FE-6 13.16 a constraints change rejects the exact version pair from rooms.view without an approval row", async () => {
    const { harness } = await import("../../tests/convex-helpers/w2Execution.fixture");
    const h = await harness();
    const view = (await h.as("customer").query(api.rooms.view, { roomId: h.roomId }))!;
    await h.as("finance").mutation(api.budget.setCap, { roomId: h.roomId, expectedConstraintsVersion: view.header.constraintsVersion, capCents: 490000 });
    await expect(h.as("customer").mutation(api.approvals.record, { proposalId: view.currentProposal!.proposalId, decision: "approve", expectedConstraintsVersion: view.header.constraintsVersion, expectedTermsKey: view.currentProposal!.termsKey, reasonKey: null, note: null })).rejects.toThrow(/approval.stale/);
    expect(await h.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
  });

  it.each(["customer", "provider", "finance"] as const)("I-FE-4 13.16 %s results render real nullable amounts and projected whyChain", async (role) => {
    const { harness } = await import("../../tests/convex-helpers/w2Execution.fixture");
    const { ResultsScreen } = await import("@/components/room/RoomSections");
    const h = await harness();
    await h.execute();
    const actor = h.as(role);
    const view = (await actor.query(api.rooms.view, { roomId: h.roomId }))!;
    const execution = (await actor.query(api.executions.forRoom, { roomId: h.roomId }))!;
    const markup = renderToStaticMarkup(<ResultsScreen view={view} execution={execution} />);
    expect(markup).toContain("why-chain");
    expect(markup).not.toMatch(/NaN|CUSTOMER_CANARY|FINANCE_CANARY|PROVIDER_CANARY/);
    if (role === "provider") expect(markup).not.toMatch(/\$4,000|\$4,800/);
    if (role === "customer") { expect(execution.changeOrder.amountChain?.committedAfterCents).toBeNull(); expect(markup).not.toContain("Committed after"); }
    if (role === "finance") expect(markup).toContain("Committed after $4,800.00");
  });
});
