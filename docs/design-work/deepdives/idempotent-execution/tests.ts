// convex/approvals.test.ts —— convex-test + vitest 草图。convex-test 0.0.65 的 API 名称待验证（inputs/04 §1.12）。
// 这些测试证明“单事务逻辑 + 任意串行顺序下的不变量”；不证明 OCC（见 part4 §4.1）。
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// seedScopeChange：14 的 fixture（budget 500000、baseline 400000、提案 v3 = +90000、cv=5、run pending_approval）
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.mutation(internal.testing.seedScopeChange, {});
  const as = (role: "customer" | "provider" | "finance") =>
    t.withIdentity({ tokenIdentifier: `test|${role}`, subject: role, issuer: "test" });
  return { t, ids, as };
}

async function invariants(t: any, roomId: string) {
  // internal.testing.checkExecutionInvariants 返回违反项列表；空数组 = 通过（清单见 part4 §4.3）
  const violations = await t.query(internal.testing.checkExecutionInvariants, { roomId });
  expect(violations).toEqual([]);
}

describe("decide: single-transaction logic", () => {
  test("three approvals execute exactly once", async () => {
    const { t, ids, as } = await setup();
    await as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    const r = await as("finance").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    expect(r).toMatchObject({ kind: "executed", alreadyExecuted: false });
    const s = await t.query(internal.testing.roomCounts, { roomId: ids.roomId });
    expect(s).toMatchObject({ executions: 1, changeOrders: 1, changeOrderCommitments: 1, tasks: 3, committedCents: 490000 });
    await invariants(t, ids.roomId);
  });

  test("repeat approve: unchanged before execution, alreadyExecuted after; no new events", async () => {
    const { t, ids, as } = await setup();
    await as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    const again = await as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    expect(again).toMatchObject({ kind: "recorded", changed: false });
    await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await as("finance").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    const before = await t.query(internal.testing.roomCounts, { roomId: ids.roomId });
    const late = await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    expect(late).toMatchObject({ kind: "executed", alreadyExecuted: true });
    expect(await t.query(internal.testing.roomCounts, { roomId: ids.roomId })).toEqual(before);
  });

  test("reject after execution is refused", async () => {
    const { ids, as } = await setup();
    for (const r of ["customer", "provider", "finance"] as const)
      await as(r).mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await expect(as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "reject", expectedConstraintsVersion: ids.cv }))
      .rejects.toThrow(/PROPOSAL_ALREADY_EXECUTED/); // ConvexError data 的断言方式待验证
  });

  test("approve after budget change: CONSTRAINTS_CHANGED and nothing written", async () => {
    const { t, ids, as } = await setup();
    await as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await as("finance").mutation(api.budgets.updateBudget, { roomId: ids.roomId, newTotalCents: 480000, reason: "cut" });
    await expect(as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv }))
      .rejects.toThrow(/CONSTRAINTS_CHANGED/);
    expect((await t.query(internal.testing.roomCounts, { roomId: ids.roomId })).approvals).toBe(1);
  });

  test("RA-R11: compliant bump keeps proposal; re-approve same proposalId at new cv executes once", async () => {
    const { t, ids, as } = await setup();
    for (const r of ["customer", "provider"] as const)
      await as(r).mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await as("finance").mutation(api.budgets.updateBudget, { roomId: ids.roomId, newTotalCents: 495000, reason: "trim" });
    const cv2 = ids.cv + 1; // reconcileAfterBump 保留 v3（490000 <= 495000），旧审批 stale
    const first = await as("customer").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: cv2 });
    expect(first).toMatchObject({ kind: "recorded", changed: true, missingRoles: ["provider", "finance"] });
    await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: cv2 });
    const r = await as("finance").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: cv2 });
    expect(r).toMatchObject({ kind: "executed" });
    await invariants(t, ids.roomId); // operationId = exec:<v3>，execution.constraintsVersion = cv2，cv 旧行保留
  });

  test("defense in depth: budget patched without bump → not executable; provider sees no reason codes", async () => {
    const { t, ids, as } = await setup();
    await t.run(async (ctx) => { // 故意绕过 bumpConstraints，模拟 bug
      const b = await ctx.db.query("budgets").withIndex("by_roomId", (q) => q.eq("roomId", ids.roomId)).unique();
      await ctx.db.patch("budgets", b!._id, { totalBudgetCents: 480000 });
    });
    const err = await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv }).catch((e) => e);
    expect(err.data).toEqual({ code: "PROPOSAL_NOT_EXECUTABLE" }); // 无 reasonCodes
    const err2 = await as("finance").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv }).catch((e) => e);
    expect(err2.data.reasonCodes).toContain("EXCEEDS_BUDGET");
  });

  test("replaced member's approval does not count", async () => {
    const { t, ids, as } = await setup();
    for (const r of ["customer", "finance"] as const)
      await as(r).mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await t.mutation(internal.testing.replaceMember, { roomId: ids.roomId, role: "finance", newToken: "test|finance2" });
    const r = await as("provider").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    expect(r).toMatchObject({ kind: "recorded", missingRoles: ["finance"] });
  });

  test("plan failure rolls back the last approval (rollback semantics in convex-test: 待验证)", async () => {
    const { t, ids, as } = await setup();
    await t.mutation(internal.testing.breakTaskTemplates, { roomId: ids.roomId }); // 让 planExecution 产生 51 个任务
    for (const r of ["customer", "provider"] as const)
      await as(r).mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv });
    await expect(as("finance").mutation(api.approvals.decide, { proposalId: ids.v3, decision: "approve", expectedConstraintsVersion: ids.cv }))
      .rejects.toThrow(/INVARIANT_VIOLATION/);
    expect((await t.query(internal.testing.roomCounts, { roomId: ids.roomId })).approvals).toBe(2);
  });
});

// 模型测试：随机串行顺序。Convex mutation 可串行化 ⇒ 任意并发执行等价于某个串行顺序（D10）。
type Op =
  | { k: "decide"; role: "customer" | "provider" | "finance"; decision: "approve" | "reject" }
  | { k: "updateBudget"; cents: number }
  | { k: "staleCompleteTurn" } // 用旧 turnSeq 提交回合结果（C10）
  | { k: "watchdogOldTurn" }; // C21

function* randomOps(seed: number, n: number): Generator<Op> {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const roles = ["customer", "provider", "finance"] as const;
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.7) yield { k: "decide", role: roles[Math.floor(rnd() * 3)], decision: rnd() < 0.8 ? "approve" : "reject" };
    else if (r < 0.85) yield { k: "updateBudget", cents: [480000, 490000, 500000][Math.floor(rnd() * 3)] };
    else if (r < 0.95) yield { k: "staleCompleteTurn" };
    else yield { k: "watchdogOldTurn" };
  }
}

test.each(Array.from({ length: 200 }, (_, i) => i))("random serial schedule %i keeps invariants", async (seed) => {
  const { t, ids, as } = await setup();
  for (const op of randomOps(seed, 25)) {
    await t.mutation(internal.testing.applyOp, { roomId: ids.roomId, op }).catch(() => undefined); // 业务错误是预期的
    await invariants(t, ids.roomId); // 每一步之后检查，而不只在最后
  }
  void as;
});

// 注意：下面这种写法在 convex-test 中不是并发证据（mutation 串行执行，待验证），证据记录里必须如实写“串行”。
// await Promise.all([asP.mutation(api.approvals.decide, ...), asF.mutation(api.approvals.decide, ...)]);
