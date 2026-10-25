// Observability: what each engine lets a UI/operator see.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { workflow } from "./lib";

export const runDetail = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const turns = await ctx.db.query("turns").withIndex("by_run_turn", (q) => q.eq("runId", runId)).collect();
    const attempts = await ctx.db.query("attempts").withIndex("by_run_turn", (q) => q.eq("runId", runId)).collect();
    const rejections = await ctx.db.query("rejections").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    const stubCalls = await ctx.db.query("stubCalls").withIndex("by_run_key", (q) => q.eq("runId", runId)).collect();
    let wf = null;
    if (run.workflowId) {
      const status = await workflow.status(ctx, run.workflowId as any);
      const steps = await workflow.listSteps(ctx, run.workflowId as any, { paginationOpts: { numItems: 100, cursor: null } });
      wf = { status, steps: steps.page };
    }
    return { run, turns, attempts, rejections, stubCalls, wf };
  },
});
