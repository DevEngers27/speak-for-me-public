// 示例：convex/agentRuntime/staleTurn.test.ts —— 过期结果拒绝（§3.5）。设计稿，未运行。
// 函数路径以 10 / 12 为准（run-lifecycle 专题：internal.agentRuntime.*）。
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { confirmAllBriefs, makeT, seedRoom } from "../test/setup";
import { enqueue, resetScript, scriptedModelModule } from "../test/scriptedModel";
import { scopeChange } from "@sfm/scenario-scope-change"; // fixture 单一来源

vi.mock("./modelClient", () => scriptedModelModule); // 待验证 V3

beforeEach(() => {
  vi.useFakeTimers();
  resetScript();
});
afterEach(() => vi.useRealTimers());

const validProposalJson = () =>
  JSON.stringify(scopeChange.fixtures.feasible.expectations.stubFirstProposalOutput);

describe("STALE: 回合持久化守卫", () => {
  test("T-L1-STALE-01 守卫单元：降预算后直接提交旧回合 → stale", async () => {
    const { t, as } = makeT();
    const { roomId } = await seedRoom(t, "feasible");
    await confirmAllBriefs(as, roomId); // 以三个身份逐个调用 12 的公开确认函数；不存在测试后门

    const { runId } = await as.customer.mutation(api.runs.startRun, { roomId });
    const turn = await t.run(async (ctx) =>
      ctx.db.query("agentTurns").withIndex("by_run_seq", (q) => q.eq("runId", runId)).first(),
    );
    expect(turn?.status).toBe("running");

    const { budget } = scopeChange.fixtures.feasible;
    await as.finance.mutation(api.budgets.updateBudget, {
      roomId,
      newTotalCents: budget.totalCents - 20_000,
      reason: "test: cut",
    });

    const proposalsBefore = await t.run((ctx) => ctx.db.query("proposals").collect());
    await t.mutation(internal.agentRuntime.completeTurn, {
      turnId: turn!._id,
      rawText: validProposalJson(),
      stopReason: "end_turn",
    });

    const after = await t.run(async (ctx) => ({
      turn: await ctx.db.get(turn!._id),
      proposals: await ctx.db.query("proposals").collect(),
      staleEvents: (await ctx.db.query("events").collect()).filter((e) => e.action === "turn_rejected_stale"),
    }));
    expect(after.turn?.status).toBe("stale");
    expect(after.proposals.length).toBe(proposalsBefore.length);
    expect(after.staleEvents.length).toBe(1);
  });

  test("T-L1-STALE-02 调用中变更：模型思考期间 finance 降预算 → 迟到结果被拒", async () => {
    const { t, as } = makeT();
    const { roomId } = await seedRoom(t, "feasible");
    await confirmAllBriefs(as, roomId);
    const { budget } = scopeChange.fixtures.feasible;

    enqueue("provider", 1, {
      kind: "beforeReturn",
      run: async () => {
        // action 非事务，理论上可在其执行期间插入 mutation（待验证 V5）
        await as.finance.mutation(api.budgets.updateBudget, {
          roomId,
          newTotalCents: budget.totalCents - 20_000,
          reason: "test: cut during turn",
        });
      },
      then: { kind: "ok", stopReason: "end_turn", text: validProposalJson() },
    });

    const { runId: oldRunId } = await as.customer.mutation(api.runs.startRun, { roomId });
    await t.finishInProgressScheduledFunctions(); // 只推进当前回合（名称待验证 V1）

    const state = await t.run(async (ctx) => ({
      oldRun: await ctx.db.get(oldRunId),
      room: await ctx.db.get(roomId),
      turns: await ctx.db.query("agentTurns").withIndex("by_run_seq", (q) => q.eq("runId", oldRunId)).collect(),
    }));
    expect(state.oldRun?.status).toBe("superseded");
    expect(state.turns.every((x) => x.status !== "succeeded")).toBe(true);
    expect(state.room?.currentRunId).not.toBe(oldRunId);
  });

  test("T-L1-WD-02 看门狗与迟到提交两种顺序都只产生一个终态 [serial]", async () => {
    // 顺序 A：watchdog → completeTurn（后者见终态，空操作并写 stale）
    // 顺序 B：completeTurn → watchdog（后者见终态，空操作，不写事件）
    // 真实竞争见 L2 watchdog_real。
    expect(true).toBe(true); // 结构示意
  });
});
