/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "../../tests/convex-helpers/setup";
import {
  ANONYMOUS,
  advanceScheduledBy,
  advanceScheduledTo,
  assertNoCanaries,
  assertNoForbiddenFields,
  bindFakeTimers,
  canonRoles,
  convexTestMatchers,
  defineRoles,
  drainDue,
  expectNoPendingScheduled,
  findCanaries,
  findForbiddenFields,
  isConvexError,
  listScheduled,
  roleMatrix,
  setTimerControl,
  verifyQueryThenInsertDedup,
  withRole,
  type ScheduledTester,
} from "../../tests/helpers/convex";

const fixtureLoaders = import.meta.glob("../../tests/convex-helpers/example.fixture.ts");

function loadFixture(): () => Promise<unknown> {
  const loader = fixtureLoaders["../../tests/convex-helpers/example.fixture.ts"];
  if (loader === undefined) throw new Error("example.fixture.ts was not bundled");
  return loader;
}

const scheduleRename = makeFunctionReference<"mutation", { userId: string; displayName: string; delayMs: number }>(
  "test/example.fixture:scheduleRename",
);
const scheduleBoom = makeFunctionReference<"mutation", Record<string, never>>("test/example.fixture:scheduleBoom");
const ensureUser = makeFunctionReference<"mutation", { tokenIdentifier: string; isTestAccount: boolean; createdAt: number; updatedAt: number; displayName: string }, string>(
  "test/example.fixture:ensureUser",
);
const claimUser = makeFunctionReference<"mutation", { tokenIdentifier: string; isTestAccount: boolean; createdAt: number; updatedAt: number; displayName: string }, string>(
  "test/example.fixture:claimUser",
);

function makeT() {
  return convexTest(schema, { ...modules, "./test/example.fixture.ts": loadFixture() });
}

describe("canon role identities", () => {
  test("customer, provider, and finance are deterministic and distinct", () => {
    const roles = canonRoles();
    expect(roles.names).toEqual(["customer", "provider", "finance"]);
    expect(roles.tokenIdentifier("customer")).toBe("https://issuer.convex-test.invalid|user_customer");
    expect(roles.subject("provider")).toBe("user_provider");
    expect(new Set(roles.names.map((role) => roles.tokenIdentifier(role))).size).toBe(3);
    expect(roles.roleOf(roles.tokenIdentifier("finance"))).toBe("finance");
  });

  test("rejects reserved claims and undefined names", () => {
    expect(() => defineRoles({ customer: { issuer: "https://other.invalid" } as unknown as { name?: string } })).toThrow(/reserved/);
    expect(() => defineRoles({ customer: { name: undefined } })).toThrow(/undefined/);
    expect(() => defineRoles({ anonymous: {} as unknown as never })).toThrow(/reserved/);
  });

  test("ensureViewer follows withRole and anonymous stays unauthenticated", async () => {
    const t = makeT();
    const roles = canonRoles({ issuer: "https://clerk.test" });
    const me = await withRole(t, roles, "customer").mutation(api.users.ensureViewer, {});
    expect(me.changed).toBe(true);
    expect(me.userId).toBeTruthy();
    assertNoForbiddenFields(me, ["email", "clerkUserId", "hardFields"]);
    await expect(withRole(t, roles, ANONYMOUS).mutation(api.users.ensureViewer, {})).rejects.toThrow(/auth.unauthenticated/);
  });

  test("roleMatrix records outcomes and rejects an unknown only-list before calling", async () => {
    const t = makeT();
    const roles = canonRoles({ issuer: "https://clerk.test" });
    const matrix = await roleMatrix(t, roles, (as) => as.mutation(api.users.ensureViewer, {}));
    expect(matrix.customer).toBe("ok");
    expect(matrix.provider).toBe("ok");
    expect(matrix.finance).toBe("ok");
    expect(matrix.anonymous).toBe("auth.unauthenticated");
    let calls = 0;
    await expect(
      roleMatrix(t, roles, async () => {
        calls += 1;
        return "nope";
      }, { only: ["admin"] as unknown as readonly ("customer" | "provider" | "finance")[] }),
    ).rejects.toThrow(/Unknown role "admin"/);
    expect(calls).toBe(0);
  });
});

describe("forbidden fields and numeric canaries", () => {
  test("dotted paths, empty lists, and exact numeric canaries", () => {
    const payload = { publicTitle: "ok", nested: { capCents: 42000 }, rows: [{ secret: 1 }] };
    expect(findForbiddenFields(payload, ["secret", "nested.capCents"]).map((hit) => hit.path)).toEqual(["$.nested.capCents", "$.rows[0].secret"]);
    expect(findForbiddenFields({ items: [{ secret: 1 }] }, ["*.secret"])).toEqual([]);
    expect(findForbiddenFields({ items: [{ secret: 1 }] }, ["*.secret".replace("*", "items.*")])).toHaveLength(1);
    expect(() => findForbiddenFields(payload, [])).toThrow(/empty/);
    expect(() => findCanaries(payload, [])).toThrow(/empty/);
    expect(findCanaries({ capCents: 42000, note: "cap 42000" }, [42000]).map((hit) => hit.where)).toEqual(["value", "value"]);
    expect(findCanaries({ capCents: 42000n }, [42000n])).toHaveLength(1);
    expect(findCanaries({ capCents: 42000 }, ["$42,000"])).toEqual([]);
    expect(() => assertNoCanaries({ capCents: 42000 }, [42000], "projection")).toThrow(/canary #0/);
    expect(() => assertNoCanaries({ capCents: 42000 }, [42000], "projection")).toThrow(/^projection/);
    const thrown = () => {
      try {
        assertNoCanaries({ capCents: 42000 }, [42000]);
      } catch (error) {
        return error instanceof Error ? error.message : "";
      }
      return "";
    };
    expect(thrown()).not.toContain("42000");
    assertNoForbiddenFields({ publicTitle: "ok" }, ["capCents", "hardFields"]);
  });

  test("matcher sees a private numeric field copied under an innocent key", () => {
    expect.extend(convexTestMatchers);
    expect({ summary: { capCents: 10 } }).not.toHaveNoForbiddenFields(["capCents"]);
  });
});

describe("scheduled functions", () => {
  bindFakeTimers(vi, { beforeEach, afterEach });

  test("advanceScheduledTo runs the job at its scheduledTime and not before", async () => {
    const t = makeT();
    const roles = canonRoles();
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { tokenIdentifier: "tok", isTestAccount: true, createdAt: 0, updatedAt: 0, displayName: "before" }),
    );
    await withRole(t, roles, "provider").mutation(scheduleRename, { userId, displayName: "after", delayMs: 5_000 });
    const [job] = await listScheduled(t as unknown as ScheduledTester);
    expect(job?.state).toBe("pending");
    const drained = await drainDue(t as unknown as ScheduledTester);
    expect(drained.ran).toEqual([]);
    expect(drained.stillPending).toHaveLength(1);
    await advanceScheduledTo(t as unknown as ScheduledTester, (job?.scheduledTime ?? 0) - 1);
    expect(await listScheduled(t as unknown as ScheduledTester)).toMatchObject([{ state: "pending" }]);
    await advanceScheduledTo(t as unknown as ScheduledTester, job?.scheduledTime ?? 0);
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.displayName).toBe("after");
    await expectNoPendingScheduled(t as unknown as ScheduledTester);
  });

  test("drainDue surfaces a failed job instead of only logging it", async () => {
    const t = makeT();
    const roles = canonRoles();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withRole(t, roles, "finance").mutation(scheduleBoom, {});
    await expect(drainDue(t as unknown as ScheduledTester)).rejects.toThrow(/\(failed\)/);
    const quietT = makeT();
    await withRole(quietT, roles, "finance").mutation(scheduleBoom, {});
    const quiet = await drainDue(quietT as unknown as ScheduledTester, { failOnFailedJobs: false });
    expect(quiet.failed.map((job) => job.name)).toEqual(["test/example.fixture:boom"]);
    expect(quiet.ran).toEqual([]);
    expect(quiet.canceled).toEqual([]);
  });

  test("advanceScheduledBy throws when the due job fails", async () => {
    const t = makeT();
    const roles = canonRoles();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withRole(t, roles, "customer").mutation(scheduleBoom, {});
    await expect(advanceScheduledBy(t as unknown as ScheduledTester, 1)).rejects.toThrow(/advanceScheduledBy: scheduled function/);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("scheduler guards", () => {
  afterEach(() => {
    setTimerControl(undefined);
    vi.useRealTimers();
  });

  test("refuses to advance without fake timers", async () => {
    const t = makeT();
    await expect(drainDue(t as unknown as ScheduledTester)).rejects.toThrow(/fake timers are not active/);
    await expect(advanceScheduledBy(t as unknown as ScheduledTester, 10)).rejects.toThrow(/fake timers are not active/);
  });
});

describe("dedup recipe", () => {
  test("returnExisting survives a fresh burst and a bypass that is not any error", async () => {
    const t = makeT();
    const args = { tokenIdentifier: "user_customer", isTestAccount: true, createdAt: 0, updatedAt: 0, displayName: "Customer" };
    const report = await verifyQueryThenInsertDedup({
      callSameKey: () => t.mutation(ensureUser, args),
      callOtherKey: () => t.mutation(ensureUser, { ...args, tokenIdentifier: "user_provider", displayName: "Provider" }),
      countRows: async () => (await t.run(async (ctx) => ctx.db.query("users").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier)).collect())).length,
      idOf: (id) => id,
      bypassInsert: () => t.run(async (ctx) => {
        await ctx.db.insert("users", args);
      }),
      expectBypassError: (error) => isConvexError(error) || (error instanceof Error && /unique/i.test(error.message)) || /unique/i.test(String(error)),
    });
    expect(report.otherKeyId).toBeDefined();
    expect(report.otherKeyId).not.toBe(report.firstId);
    expect(report.bypassError).toBeDefined();
  });

  test("rejectDuplicate uses item.duplicate and does not accept an unrelated bypass error", async () => {
    const t = makeT();
    const args = { tokenIdentifier: "user_finance", isTestAccount: true, createdAt: 0, updatedAt: 0, displayName: "Finance" };
    const duplicate = (error: unknown) => isConvexError(error) && (error as { data?: { code?: string } }).data?.code === "item.duplicate";
    const report = await verifyQueryThenInsertDedup({
      mode: "rejectDuplicate",
      expectDuplicateError: duplicate,
      callSameKey: () => t.mutation(claimUser, args),
      countRows: async () => (await t.run(async (ctx) => ctx.db.query("users").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier)).collect())).length,
      idOf: (id) => id,
    });
    expect(report.serialIds).toEqual([]);
    await expect(
      verifyQueryThenInsertDedup({
        mode: "rejectDuplicate",
        callSameKey: () => t.mutation(claimUser, { ...args, tokenIdentifier: "other" }),
        countRows: async () => 0,
        idOf: (id) => id,
      }),
    ).rejects.toThrow(/expectDuplicateError/);
  });
});

function roleTypeProbe(t: { withIdentity(identity: ReturnType<ReturnType<typeof canonRoles>["identity"]>): typeof t }) {
  const roles = canonRoles();
  withRole(t, roles, "customer");
  // @ts-expect-error admin is not a canon role
  withRole(t, roles, "admin");
  // @ts-expect-error only must name registered roles
  void roleMatrix(t, roles, async () => "ok", { only: ["admin"] });
}

test("role type probe is part of the suite", () => {
  expect(typeof roleTypeProbe).toBe("function");
});
