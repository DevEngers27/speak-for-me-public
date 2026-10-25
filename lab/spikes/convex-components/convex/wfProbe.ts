// Probes for workflow determinism constraints (not production code).
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { workflow } from "./lib";

// Simulates "deploying a new version of the workflow code" while an instance is in flight.
export const knobs = { insertExtraStep: false };

export const noop = internalMutation({ args: { tag: v.string() }, handler: async () => null });

export const fetchProbe = workflow.define({ args: {} }).handler(async (): Promise<void> => {
  await fetch("https://example.invalid/");
});
export const envProbe = workflow.define({ args: {} }).handler(async (): Promise<void> => {
  const x = (globalThis as any).process.env.SOME_SECRET_NAME;
  void x;
});
export const timeProbe = workflow
  .define({ args: {}, returns: v.object({ now: v.number(), rnd: v.number() }) })
  .handler(async (step): Promise<{ now: number; rnd: number }> => {
    await step.runMutation(internal.wfProbe.noop, { tag: "a" });
    return { now: Date.now(), rnd: Math.random() };
  });
export const codeChangeProbe = workflow.define({ args: {} }).handler(async (step): Promise<void> => {
  await step.runMutation(internal.wfProbe.noop, { tag: "a" });
  if (knobs.insertExtraStep) await step.runMutation(internal.wfProbe.noop, { tag: "inserted" });
  await step.runMutation(internal.wfProbe.noop, { tag: "b" });
  await step.runMutation(internal.wfProbe.noop, { tag: "c" });
});

export const startProbe = mutation({
  args: { which: v.union(v.literal("fetch"), v.literal("env"), v.literal("time"), v.literal("codeChange")) },
  handler: async (ctx, { which }): Promise<string> => {
    const ref = {
      fetch: internal.wfProbe.fetchProbe,
      env: internal.wfProbe.envProbe,
      time: internal.wfProbe.timeProbe,
      codeChange: internal.wfProbe.codeChangeProbe,
    }[which];
    return await workflow.start(ctx, ref, {});
  },
});
