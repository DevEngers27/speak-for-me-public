/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { knobs } from "./wfProbe";
import { workflow } from "./lib";
import workflowTest from "@convex-dev/workflow/test";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  return t;
}
async function status(t: ReturnType<typeof setup>, id: string) {
  return t.run(async (ctx) => {
    const st = await workflow.status(ctx, id as any);
    const steps = await workflow.listSteps(ctx, id as any);
    return { st, steps: steps.page.map((s: any) => `${s.stepNumber}:${s.name}:${s.runResult?.kind}`) };
  });
}

test.each(["fetch", "env", "time"] as const)("determinism probe: %s", async (which) => {
  const t = setup();
  const id = await t.mutation(api.wfProbe.startProbe, { which });
  await t.finishAllScheduledFunctions(vi.runAllTimers, 200);
  const r = await status(t, id);
  console.log(`[probe ${which}]`, JSON.stringify(r));
  expect(r.st.type).not.toBe("inProgress");
});

test("changing workflow code under an in-flight instance", async () => {
  const t = setup();
  knobs.insertExtraStep = false;
  const id = await t.mutation(api.wfProbe.startProbe, { which: "codeChange" });
  // Run until steps a and b are journaled, then "deploy" a version that inserts a step between them.
  for (let i = 0; i < 200; i++) {
    const s = await status(t, id);
    if (s.steps.length >= 2) break;
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersToNextTimer();
  }
  const mid = await status(t, id);
  knobs.insertExtraStep = true;
  await t.finishAllScheduledFunctions(vi.runAllTimers, 200);
  const r = await status(t, id);
  knobs.insertExtraStep = false;
  console.log("[probe codeChange] mid=", JSON.stringify(mid), "final=", JSON.stringify(r));
});
