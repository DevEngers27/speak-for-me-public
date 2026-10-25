import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import {
  as,
  countEvents,
  countRows,
  expectAppError,
  log,
  makeT,
  rejectionOf,
  seed,
} from "./test.helpers";

describe("(a) query-by-index-then-insert idempotency in one mutation", () => {
  test("repeat call with same operationId returns existing record", async () => {
    const t = makeT();
    const { alice, proposalId } = await seed(t);
    const first = await alice.mutation(api.execution.executeProposal, {
      proposalId,
      operationId: "op-1",
    });
    const second = await alice.mutation(api.execution.executeProposal, {
      proposalId,
      operationId: "op-1",
    });
    log("first", first);
    log("second", second);
    expect(first.created).toBe(true);
    expect(second).toEqual({ executionId: first.executionId, created: false });
    expect(await countRows(t, "executions")).toBe(1);
    expect(await countRows(t, "commitments")).toBe(1);
    expect(await countEvents(t, "execution.created")).toBe(1);
  });

  test("Promise.all of two identical calls: one created (convex-test serializes)", async () => {
    const t = makeT();
    const { alice, proposalId } = await seed(t);
    const [r1, r2] = await Promise.all([
      alice.mutation(api.execution.executeProposal, { proposalId, operationId: "op-par" }),
      alice.mutation(api.execution.executeProposal, { proposalId, operationId: "op-par" }),
    ]);
    log("parallel results", [r1, r2]);
    expect([r1.created, r2.created].sort()).toEqual([false, true]);
    expect(r1.executionId).toBe(r2.executionId);
    expect(await countRows(t, "executions")).toBe(1);
  });

  test("different operationIds for the same proposal DO create duplicates", async () => {
    const t = makeT();
    const { alice, proposalId } = await seed(t);
    await alice.mutation(api.execution.executeProposal, { proposalId, operationId: "click-A" });
    await alice.mutation(api.execution.executeProposal, { proposalId, operationId: "click-B" });
    const n = await countRows(t, "executions");
    log("executions after two client-random keys", n);
    expect(n).toBe(2); // => key must be derived server-side from the business identity
  });

  test("mutation is atomic: throw after writes leaves nothing; retry succeeds", async () => {
    const t = makeT();
    const { alice, proposalId } = await seed(t);
    const err = await rejectionOf(
      alice.mutation(api.execution.executeProposal, {
        proposalId,
        operationId: "op-atomic",
        simulateFailureAfterWrites: true,
      }),
    );
    expectAppError(err, "SIMULATED_FAILURE");
    log("error data", (err as { data: unknown }).data);
    expect(await countRows(t, "executions")).toBe(0);
    expect(await countRows(t, "commitments")).toBe(0);
    expect(await countEvents(t, "execution.created")).toBe(0);
    const retry = await alice.mutation(api.execution.executeProposal, {
      proposalId,
      operationId: "op-atomic",
    });
    expect(retry.created).toBe(true);
  });

  test("unauthenticated caller is rejected before any read", async () => {
    const t = makeT();
    const { proposalId } = await seed(t);
    const err = await rejectionOf(
      t.mutation(api.execution.executeProposal, { proposalId, operationId: "op-x" }),
    );
    expectAppError(err, "UNAUTHENTICATED");
  });
});

describe("(b) approval upsert keyed by by_proposal_user", () => {
  test("insert -> unchanged -> updated, one row per (proposal,user)", async () => {
    const t = makeT();
    const { alice, proposalId, roomId } = await seed(t);
    const bob = as(t, "bob");
    await bob.mutation(api.users.ensureUser, {});

    const r1 = await alice.mutation(api.approvals.setApproval, { proposalId, decision: "approve" });
    const r2 = await alice.mutation(api.approvals.setApproval, { proposalId, decision: "approve" });
    const r3 = await alice.mutation(api.approvals.setApproval, { proposalId, decision: "reject" });
    const rb = await bob.mutation(api.approvals.setApproval, { proposalId, decision: "approve" });
    log("alice r1/r2/r3", [r1.outcome, r2.outcome, r3.outcome, r3.revision]);
    expect([r1.outcome, r2.outcome, r3.outcome]).toEqual(["inserted", "unchanged", "updated"]);
    expect(r2.approvalId).toBe(r1.approvalId);
    expect(r3.approvalId).toBe(r1.approvalId);
    expect(rb.outcome).toBe("inserted");

    // Constraint version bump: same decision must be re-recorded against v2.
    await t.run((ctx) => ctx.db.patch("rooms", roomId, { constraintVersion: 2 }));
    const r4 = await alice.mutation(api.approvals.setApproval, { proposalId, decision: "reject" });
    expect(r4).toMatchObject({ outcome: "updated", revision: 3 });

    const rows = await t.query(api.approvals.listForProposal, { proposalId });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r._id === r1.approvalId)).toMatchObject({
      decision: "reject",
      constraintVersion: 2,
      revision: 3,
    });
  });

  test(".unique() turns a duplicate that bypassed the entry point into a hard error", async () => {
    const t = makeT();
    const { alice, aliceId, proposalId } = await seed(t);
    await alice.mutation(api.approvals.setApproval, { proposalId, decision: "approve" });
    // Bypass the single write entry point: indexes are NOT unique, insert succeeds.
    await t.run((ctx) =>
      ctx.db.insert("approvals", {
        proposalId,
        userId: aliceId,
        decision: "approve",
        constraintVersion: 1,
        revision: 1,
      }),
    );
    expect(await countRows(t, "approvals")).toBe(2);
    const err = await rejectionOf(
      alice.mutation(api.approvals.setApproval, { proposalId, decision: "reject" }),
    );
    log("duplicate detection error", (err as Error).message.split("\n")[0]);
    expect((err as Error).message).toMatch(/unique/i);
  });
});
