import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { ISSUER, countRows, expectAppError, log, makeT, rejectionOf, seed } from "./test.helpers";

describe("(d) t.withIdentity and ctx.auth.getUserIdentity", () => {
  test("no identity -> getUserIdentity() returns null (query does not throw)", async () => {
    const t = makeT();
    expect(await t.query(api.users.whoami, {})).toBeNull();
  });

  test("withIdentity with only name: issuer/subject/tokenIdentifier are auto-generated", async () => {
    const t = makeT();
    const id = await t.withIdentity({ name: "Alice" }).query(api.users.whoami, {});
    log("auto-generated identity", id);
    expect(id).not.toBeNull();
    expect(typeof id?.tokenIdentifier).toBe("string");
  });

  test("withIdentity with subject+issuer: tokenIdentifier is derived", async () => {
    const t = makeT();
    const id = await t
      .withIdentity({ subject: "user_alice", issuer: ISSUER })
      .query(api.users.whoami, {});
    log("explicit subject+issuer identity", id);
    expect(id?.subject).toBe("user_alice");
    expect(id?.issuer).toBe(ISSUER);
  });

  test("explicit tokenIdentifier is used verbatim", async () => {
    const t = makeT();
    const id = await t
      .withIdentity({ tokenIdentifier: "custom|tok", subject: "s", issuer: "i" })
      .query(api.users.whoami, {});
    expect(id?.tokenIdentifier).toBe("custom|tok");
  });

  test("withIdentity returns a new accessor; original t stays anonymous", async () => {
    const t = makeT();
    const alice = t.withIdentity({ subject: "user_alice" });
    expect(await alice.query(api.users.whoami, {})).not.toBeNull();
    expect(await t.query(api.users.whoami, {})).toBeNull();
  });

  test("unauthenticated mutation -> ConvexError{code:UNAUTHENTICATED} reaches the test intact", async () => {
    const t = makeT();
    const err = await rejectionOf(t.mutation(api.users.ensureUser, {}));
    expectAppError(err, "UNAUTHENTICATED");
    log("error class / data", {
      isConvexError: err instanceof ConvexError,
      data: (err as ConvexError<{ code: string }>).data,
      message: (err as Error).message,
    });
  });

  test("identity present but no users row -> USER_NOT_PROVISIONED (authn != authz)", async () => {
    const t = makeT();
    const { proposalId } = await seed(t);
    const stranger = t.withIdentity({ subject: "user_stranger", issuer: ISSUER });
    const err = await rejectionOf(
      stranger.mutation(api.execution.executeProposal, { proposalId, operationId: "x" }),
    );
    expectAppError(err, "USER_NOT_PROVISIONED");
  });

  test("ensureUser is idempotent per tokenIdentifier", async () => {
    const t = makeT();
    const a = t.withIdentity({ subject: "user_alice", issuer: ISSUER });
    const id1 = await a.mutation(api.users.ensureUser, {});
    const id2 = await a.mutation(api.users.ensureUser, {});
    expect(id1).toBe(id2);
    expect(await countRows(t, "users")).toBe(1);
  });

  test("public action: identity visible in action and propagated into ctx.runQuery", async () => {
    const t = makeT();
    const res = await t
      .withIdentity({ subject: "user_alice", issuer: ISSUER })
      .action(api.users.whoamiViaAction, {});
    log("action identity", res);
    expect(res.inAction?.subject).toBe("user_alice");
    expect(res.viaRunQuery?.tokenIdentifier).toBe(res.inAction?.tokenIdentifier);
    const anon = await t.action(api.users.whoamiViaAction, {});
    expect(anon).toEqual({ inAction: null, viaRunQuery: null });
  });
});
