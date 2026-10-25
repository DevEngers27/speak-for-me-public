import {deleteMaintenanceRow,patchGlobal,insertGlobal} from './lib/db';
import {nowMs, timeZoneMode} from './lib/time';
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { sysMutation, sysQuery } from "./lib/functions";
import { schedulerOpsLog } from "./lib/opsLog";
import type { Id } from "./_generated/dataModel";

// W2-4: stable scheduler references to the implemented lifecycle endpoints.
const reconcile = makeFunctionReference<"mutation", { runId: Id<"runs"> }>("runs:reconcile");
const watchdog = makeFunctionReference<"mutation", { attemptId: Id<"attempts"> }>("agents:watchdog");
const sweep = makeFunctionReference<"mutation", Record<string, never>>("ops:livenessSweep");
// 12.20 specifies a grace interval without a numerical value. One minute allows
// the scheduled watchdog to commit before the five-minute fallback intervenes.
export const LIVENESS_GRACE_MS = 60_000;

export const setDraining = sysMutation('ops.setDraining')({
  args: { draining: v.boolean(), reason: v.string() },
  returns: v.object({ draining: v.boolean(), changedAt: v.number() }),
  handler: async (ctx, { draining, reason }) => {
    const changedAt = nowMs(ctx);
    const flags = await ctx.db.query("opsFlags").withIndex("by_key", q => q.eq("key", "global")).unique();
    const value = { key: "global" as const, draining, changedAt, changedBy: null };
    if (flags) await patchGlobal(ctx,'opsFlags',flags._id,{draining,changedAt,changedBy:null});
    else await insertGlobal(ctx,'opsFlags',value);
    schedulerOpsLog(ctx.log, "draining_set", { draining, reason: Array.from(reason).slice(0, 120).join("") });
    if (!draining) await ctx.scheduler.runAfter(0, sweep, {});
    return { draining, changedAt };
  },
});

export const activeAttemptCount = sysQuery('ops.activeAttemptCount')({
  args: {},
  returns: v.object({ runningLive: v.number(), runningStub: v.number(), negotiatingRuns: v.number() }),
  handler: async ctx => {
    const attempts = await ctx.db.query("attempts").withIndex("by_status_deadline", q => q.eq("status", "running")).take(1001);
    const runs = await ctx.db.query("runs").withIndex("by_status", q => q.eq("status", "negotiating")).collect();
    return {
      runningLive: attempts.filter(a => a.provenance === "live").length,
      runningStub: attempts.filter(a => a.provenance === "stub").length,
      negotiatingRuns: runs.length,
    };
  },
});

export const livenessSweep = sysMutation('ops.livenessSweep')({
  args: {},
  returns: v.object({ scheduled: v.number(), stuckAttempts: v.number() }),
  handler: async ctx => {
    const runs = await ctx.db.query("runs").withIndex("by_status", q => q.eq("status", "negotiating")).collect();
    for (const run of runs) await ctx.scheduler.runAfter(0, reconcile, { runId: run._id });
    const stuck = await ctx.db.query("attempts").withIndex("by_status_deadline", q =>
      q.eq("status", "running").lt("deadlineAt", nowMs(ctx) - LIVENESS_GRACE_MS)).collect();
    for (const attempt of stuck) {
      schedulerOpsLog(ctx.log, "stuck_run", { attemptId: attempt._id });
      await ctx.scheduler.runAfter(0, watchdog, { attemptId: attempt._id });
    }
    return { scheduled: runs.length, stuckAttempts: stuck.length };
  },
});



import { checkConfigHealth, configHealthFrom, reportedAgentMode } from "./lib/configHealth";
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { opsLog } from "./lib/opsLog";

import { NEGOTIATION_MODEL, retrieveModel } from "./model/agents/models";
import { WARM_MAX_TOKENS } from "./model/agents/warmVariants";
import { z } from 'zod';
import { toStrictOutputSchema } from '@core/engine';
import { buildTurnZod, listScopeChangeWarmTurnSpecs } from './model/agents/outputSchema';
import { createSchemaWarmTransport, callModel, type JsonSchemaObject } from './model/agents/modelGateway';

const purgeRef = makeFunctionReference<"mutation", Record<string, never>>("ops:purgeRawOutputs");
export const PURGE_BATCH = 500;
const PRICE_AS_OF = "2026-10-06";

const sample = v.object({ n: v.number() });
const latency = v.object({ n: v.number(), p50: v.union(v.number(), v.null()), p95: v.union(v.number(), v.null()) });
const counted = v.object({ n: v.number(), count: v.number(), rate: v.union(v.number(), v.null()) });

export const configHealth = internalQuery("ops.configHealth")({
  args: {},
  returns: v.object({
    tier: v.union(v.literal("dev"), v.literal("preview"), v.literal("prod"), v.literal("test"), v.literal("missing")),
    clerkIssuerConfigured: v.boolean(),
    anthropicKeyConfigured: v.boolean(),
    agentMode: v.union(v.literal("live"), v.literal("stub")),
    agentsEnabled: v.boolean(),
    modelFallbacks: v.boolean(),
    draining: v.boolean(),
    configValid: v.boolean(),
    timeZoneMode: v.union(v.literal("intl"), v.literal("offset")),
    invalidFields: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const flag = await ctx.db.query("opsFlags").withIndex("by_key", (q) => q.eq("key", "global")).unique();
    return { ...configHealthFrom(process.env, flag?.draining ?? false), timeZoneMode: timeZoneMode() };
  },
});

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function rate(count: number, n: number): { n: number; count: number; rate: number | null } {
  return { n, count, rate: n === 0 ? null : count / n };
}

export const metrics = internalQuery("ops.metrics")({
  args: { sinceMs: v.number(), untilMs: v.number() },
  returns: v.object({
    turnLatency: v.object({
      n: v.number(),
      p50: v.union(v.number(), v.null()),
      p95: v.union(v.number(), v.null()),
      groups: v.array(v.object({
        role: v.string(),
        kind: v.string(),
        mode: v.string(),
        n: v.number(),
        p50: v.union(v.number(), v.null()),
        p95: v.union(v.number(), v.null()),
      })),
    }),
    timeToFirstProposal: latency,
    tokens: v.object({
      n: v.number(),
      input: v.number(),
      cacheCreation: v.number(),
      cacheRead: v.number(),
      output: v.number(),
      thinking: v.number(),
    }),
    cacheHitRate: counted,
    invalidOutputRate: counted,
    staleRate: counted,
    refusalRate: counted,
    watchdogErrorRate: counted,
    needsInputRate: counted,
    endedNoAgreementRate: counted,
    spendEstimate: v.object({
      n: v.number(),
      microUsd: v.number(),
      unknownCost: v.number(),
      estimate: v.literal(true),
      asOf: v.string(),
    }),
    runningAttempts: v.object({ n: v.number(), runningLive: v.number(), runningStub: v.number() }),
    negotiatingRuns: sample,
    liveRoomsByScenarioVersion: v.object({ n: v.number(), counts: v.record(v.string(), v.number()) }),
  }),
  handler: async (ctx, args) => {
    const inWindow = (at: number) => at >= args.sinceMs && at < args.untilMs;
    const attempts = (await ctx.db.query("attempts").collect()).filter((row) => inWindow(row.startedAt));
    const runs = (await ctx.db.query("runs").collect()).filter((row) => inWindow(row.startedAt));
    const events = await ctx.db.query("events").collect();
    const latencies: number[] = [];
    const grouped = new Map<string, number[]>();
    let input = 0;
    let cacheCreation = 0;
    let cacheRead = 0;
    let output = 0;
    let thinking = 0;
    let usageN = 0;
    let liveN = 0;
    let cacheHits = 0;
    let microUsd = 0;
    let unknownCost = 0;
    let costN = 0;
    for (const attempt of attempts) {
      if (attempt.finishedAt !== undefined) {
        const ms = attempt.finishedAt - attempt.startedAt;
        latencies.push(ms);
        const turn = await ctx.db.get(attempt.turnId);
        const key = `${attempt.role}|${turn?.kind ?? "unknown"}|${attempt.provenance}`;
        const bucket = grouped.get(key) ?? [];
        bucket.push(ms);
        grouped.set(key, bucket);
      }
      if (attempt.usage) {
        usageN += 1;
        input += attempt.usage.inputTokens;
        cacheCreation += attempt.usage.cacheCreationInputTokens;
        cacheRead += attempt.usage.cacheReadInputTokens;
        output += attempt.usage.outputTokens;
        thinking += attempt.usage.thinkingTokens;
      }
      if (attempt.provenance === "live") {
        liveN += 1;
        if ((attempt.usage?.cacheReadInputTokens ?? 0) > 0) cacheHits += 1;
      }
      if (attempt.costMicroUsd === undefined) unknownCost += 1;
      else {
        costN += 1;
        microUsd += attempt.costMicroUsd;
      }
    }
    latencies.sort((a, b) => a - b);
    const groups = [...grouped.entries()].map(([key, values]) => {
      const [role, kind, mode] = key.split("|");
      const sorted = [...values].sort((a, b) => a - b);
      return { role: role ?? "unknown", kind: kind ?? "unknown", mode: mode ?? "unknown", n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
    });
    const deltas: number[] = [];
    const rooms = await ctx.db.query("rooms").collect();
    for (const room of rooms) {
      const roomEvents = events.filter((event) => event.roomId === room._id && inWindow(event.createdAt));
      const started = roomEvents.find((event) => event.payload.type === "run_started");
      const proposed = roomEvents.find((event) => event.payload.type === "proposal_created");
      if (started && proposed) deltas.push(proposed.createdAt - started.createdAt);
    }
    deltas.sort((a, b) => a - b);
    const running = attempts.filter((row) => row.status === "running");
    const counts: Record<string, number> = {};
    let liveRooms = 0;
    for (const room of rooms) {
      if (room.status !== "setup" && room.status !== "open") continue;
      liveRooms += 1;
      const key = `${room.scenarioKey}@${room.scenarioVersion}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      turnLatency: { n: latencies.length, p50: percentile(latencies, 50), p95: percentile(latencies, 95), groups },
      timeToFirstProposal: { n: deltas.length, p50: percentile(deltas, 50), p95: percentile(deltas, 95) },
      tokens: { n: usageN, input, cacheCreation, cacheRead, output, thinking },
      cacheHitRate: rate(cacheHits, liveN),
      invalidOutputRate: rate(attempts.filter((row) => row.status === "invalid_output").length, attempts.length),
      staleRate: rate(attempts.filter((row) => row.status === "stale").length, attempts.length),
      refusalRate: rate(attempts.filter((row) => row.status === "refused").length, attempts.length),
      watchdogErrorRate: rate(attempts.filter((row) => row.status === "error" || row.status === "timeout").length, attempts.length),
      needsInputRate: rate(runs.filter((row) => row.status === "needs_input").length, runs.length),
      endedNoAgreementRate: rate(runs.filter((row) => row.status === "ended_no_agreement").length, runs.length),
      spendEstimate: { n: costN, microUsd, unknownCost, estimate: true as const, asOf: PRICE_AS_OF },
      runningAttempts: {
        n: running.length,
        runningLive: running.filter((row) => row.provenance === "live").length,
        runningStub: running.filter((row) => row.provenance === "stub").length,
      },
      negotiatingRuns: { n: runs.filter((row) => row.status === "negotiating").length },
      liveRoomsByScenarioVersion: { n: liveRooms, counts },
    };
  },
});

export const auditUsers = internalQuery("ops.auditUsers")({
  args: {},
  returns: v.object({ duplicateTokenIdentifiers: v.number() }),
  handler: async (ctx) => {
    const counts = new Map<string, number>();
    for (const user of await ctx.db.query("users").collect()) {
      counts.set(user.tokenIdentifier, (counts.get(user.tokenIdentifier) ?? 0) + 1);
    }
    let duplicateTokenIdentifiers = 0;
    for (const count of counts.values()) if (count > 1) duplicateTokenIdentifiers += 1;
    return { duplicateTokenIdentifiers };
  },
});

export const purgeRawOutputs = internalMutation("ops.purgeRawOutputs")({
  args: {},
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const now = nowMs(ctx);
    const due = await ctx.db.query("rawOutputs").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(PURGE_BATCH + 1);
    const batch = due.slice(0, PURGE_BATCH);
    for (const row of batch) await deleteMaintenanceRow(ctx, row._id);
    const more = due.length > PURGE_BATCH;
    if (more) await ctx.scheduler.runAfter(0, purgeRef, {});
    return { deleted: batch.length, more };
  },
});

export const checkModelConfig = internalAction("ops.checkModelConfig")({
  args: {},
  returns: v.object({ ok: v.boolean(), code: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    if (!checkConfigHealth(process.env).ok) return { ok: false, code: "config_invalid" };
    const mode = reportedAgentMode(process.env);
    if (mode !== "live") return { ok: true, code: null };
    const retrieved = await retrieveModel(NEGOTIATION_MODEL, process.env.ANTHROPIC_API_KEY);
    if (!retrieved.ok) {
      opsLog(ctx.log, "config_invalid", { errorCode: retrieved.code });
      return { ok: false, code: retrieved.code };
    }
    return { ok: true, code: null };
  },
});

export const warmSchemas = internalAction("ops.warmSchemas")({
  args: {},
  returns: v.object({ warmed: v.number() }),
  handler: async (ctx) => {
    const schemas = listScopeChangeWarmTurnSpecs().map(spec => ({ spec, schema: toStrictOutputSchema(z.toJSONSchema(buildTurnZod(spec, true))) as JsonSchemaObject }));
    if (!checkConfigHealth(process.env).ok || reportedAgentMode(process.env) !== 'live') return { warmed: 0 };
    const transport = createSchemaWarmTransport();
    let warmed = 0;
    for (const { spec, schema } of schemas) {
      const result = await callModel({ purpose: 'schema_warm', transport, schema, maxTokens: WARM_MAX_TOKENS, messages: [{ role: 'user', content: 'Warm this schema.' }, { role: 'system', content: 'Return the smallest valid response.' }], validate: () => ({ ok: true, value: null }), maxRetries: 0 });
      opsLog(ctx.log, 'model_call', { role: spec.role, kind: 'schema_warm', inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens });
      // A truncation still demonstrates schema acceptance; transport/config failures do not.
      if (result.kind === 'error' || result.kind === 'aborted') throw new Error('Schema warm failed');
      warmed++;
    }
    return { warmed };
  },
});
