/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import workflowTest from "@convex-dev/workflow/test";
import workpoolTest from "@convex-dev/workpool/test";
import retrierTest from "@convex-dev/action-retrier/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  workpoolTest.register(t, "modelPool");
  retrierTest.register(t, "actionRetrier");
  rateLimiterTest.register(t, "rateLimiter");
  return t;
}
type T = ReturnType<typeof setup>;
// Step timers one at a time and let async work settle in between. `finishAllScheduledFunctions(vi.runAllTimers)`
// fires an 11-minute watchdog timer before a 0ms action has finished (harness artifact, see report).
async function drain(t: T) {
  for (let i = 0; i < 5000; i++) {
    await t.finishInProgressScheduledFunctions();
    if (vi.getTimerCount() === 0) return i;
    vi.advanceTimersToNextTimer();
  }
  return -1;
}

async function summary(t: T, runId: Id<"runs">) {
  const d = (await t.query(api.observe.runDetail, { runId }))!;
  return {
    status: d.run.status,
    endReason: d.run.endReason,
    turns: d.turns.length,
    attempts: d.attempts.map((a) => `${a.turnIndex}#${a.attempt}:${a.status}`),
    rejections: d.rejections.map((r) => `${r.turnIndex}:${r.reasonCode}`),
    stubCalls: Object.fromEntries(d.stubCalls.map((s) => [s.key, s.calls])),
    wfStatus: d.wf?.status.type,
    wfSteps: d.wf?.steps.map((s: any) => `${s.stepNumber}:${s.name}:${s.runResult?.kind ?? (s.inProgress ? "inProgress" : "?")}`),
  };
}

const ENGINES = {
  chain: api.chain.startRun,
  workflow: api.wf.startRun,
  retrierChain: api.retrierChain.startRun,
} as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe.each(Object.entries(ENGINES))("engine=%s", (engine, startRun) => {
  async function run(failPlan: { key: string; mode: any; times: number }[], rounds = 2) {
    const t = setup();
    const roomId = await t.mutation(api.rooms.createRoom, { name: "r", budgetCents: 800_000 });
    const runId = await t.mutation(startRun, { roomId, rounds, failPlan });
    await drain(t);
    const s = await summary(t, runId);
    console.log(`[${engine}] ${JSON.stringify(failPlan)} =>`, JSON.stringify(s));
    return { t, roomId, runId, s };
  }

  test("happy path: 2 rounds x 3 roles", async () => {
    const { s } = await run([]);
    expect(s.status).toBe("completed");
    expect(s.turns).toBe(6);
  });

  test("transient failure x2 is retried and recovers", async () => {
    const { s } = await run([{ key: "0:provider", mode: "transient", times: 2 }]);
    expect(s.status).toBe("completed");
    expect(s.turns).toBe(6);
    expect(s.stubCalls["0:provider"]).toBe(3);
  });

  test("transient failure beyond bound fails the run", async () => {
    const { s } = await run([{ key: "1:finance", mode: "transient", times: 9 }]);
    expect(s.status).toBe("failed");
    expect(s.turns).toBe(5);
    console.log(`[${engine}] bounded calls for 1:finance =`, s.stubCalls["1:finance"]);
  });

  test("fatal (non-retryable) failure", async () => {
    const { s } = await run([{ key: "0:customer", mode: "fatal", times: 1 }]);
    expect(s.status).toBe("failed");
    expect(s.turns).toBe(0);
    console.log(`[${engine}] fatal calls =`, s.stubCalls["0:customer"]);
  });

  // retrier.cancel() on an in-flight run cancels an inProgress scheduled action, which convex-test
  // 0.0.65 rejects ("Unexpected scheduled function state ... canceled"); real backend allows it.
  test.skipIf(engine === "retrierChain")("budget cut while a model call is in flight cancels the run", async () => {
    const { t, roomId, s } = await run([{ key: "1:customer", mode: "budgetCutDuring", times: 1 }]);
    expect(s.status).toBe("canceled");
    expect(s.turns).toBe(3);
    const room = await t.run((ctx) => ctx.db.get(roomId));
    expect(room!.constraintVersion).toBe(2);
    expect(room!.activeRunId).toBeUndefined();
  });

  test("budget change before first turn runs: nothing executes", async () => {
    const t = setup();
    const roomId = await t.mutation(api.rooms.createRoom, { name: "r", budgetCents: 800_000 });
    const runId = await t.mutation(startRun, { roomId, rounds: 2 });
    await t.mutation(api.rooms.changeBudget, { roomId, budgetCents: 500_000 });
    await drain(t);
    const s = await summary(t, runId);
    console.log(`[${engine}] cancel-before-start =>`, JSON.stringify(s));
    expect(s.status).toBe("canceled");
    expect(s.turns).toBe(0);
    expect(Object.keys(s.stubCalls).length).toBe(0);
  });

  test("second concurrent start is rejected", async () => {
    const t = setup();
    const roomId = await t.mutation(api.rooms.createRoom, { name: "r", budgetCents: 800_000 });
    await t.mutation(startRun, { roomId, rounds: 1 });
    await expect(t.mutation(startRun, { roomId, rounds: 1 })).rejects.toThrow(/run_already_active/);
  });
});

describe("chain-only: lost action is detected by watchdog", () => {
  test("lost once -> timedOut -> retry -> completed", async () => {
    const t = setup();
    const roomId = await t.mutation(api.rooms.createRoom, { name: "r", budgetCents: 800_000 });
    const runId = await t.mutation(api.chain.startRun, {
      roomId, rounds: 1, failPlan: [{ key: "0:finance", mode: "lost", times: 1 }],
    });
    await drain(t);
    const s = await summary(t, runId);
    console.log("[chain] lost =>", JSON.stringify(s));
    expect(s.status).toBe("completed");
    expect(s.attempts).toContain("2#1:timedOut");
  });
});
