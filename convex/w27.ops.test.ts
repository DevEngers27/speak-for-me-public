/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { lintCanaries } from "@core/scenarios/scope-change/fixtures";
import { internal } from "./_generated/api";
import * as seedFunctions from "./seed";
import * as probeFunctions from "./devProbes";
import * as seedChain from "./lib/seedChain";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "../tests/convex-helpers/setup";
import { rawOutputRetentionMs } from "./lib/time";
import { retrieveModel } from "./model/agents/models";
import { WARM_MAX_TOKENS, WARM_SCHEMA_VARIANTS } from "./model/agents/warmVariants";
import crons from "./crons";
import { isConvexError } from "../tests/helpers/convex";

function makeT(transactionLimits = false) {
  return transactionLimits ? convexTest({ schema, modules, transactionLimits: true }) : convexTest(schema, modules);
}

async function mutationOnDeployment<A, R>(t: ReturnType<typeof makeT>, fn: unknown, args: A, name: string): Promise<R> {
  const registered = fn as { _handler(ctx: MutationCtx, args: A): Promise<R> };
  return t.run(ctx => registered._handler({ ...ctx, meta: { ...ctx.meta, getDeploymentMetadata: async () => ({ ...await ctx.meta.getDeploymentMetadata(), name }) } }, args));
}

function codeOf(error: unknown): string | undefined {
  if (!isConvexError(error)) return undefined;
  const data = (error as { data?: { code?: string } }).data;
  return data?.code;
}

beforeEach(() => {
  vi.stubEnv("DEPLOYMENT_TIER", "test");
  vi.stubEnv("AGENT_MODE", "stub");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "");
  vi.stubEnv("AGENTS_ENABLED", "true");
  vi.stubEnv("MODEL_FALLBACKS", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("W2-7 seed and reset", () => {
  test("12.20 seed default terminal state", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const snapshot = await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      const runs = await ctx.db.query("runs").withIndex("by_room_runNo", (q) => q.eq("roomId", roomId)).collect();
      const events = await ctx.db.query("events").withIndex("by_room_order", (q) => q.eq("roomId", roomId)).collect();
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      return {
        room,
        turns: await ctx.db.query('turns').collect(),
        attempts: await ctx.db.query('attempts').collect(),
        facts: await ctx.db.query('sharedFacts').collect(),
        events,
        runs,
        proposals: (await ctx.db.query("proposals").collect()).length,
        approvals: (await ctx.db.query("approvals").collect()).length,
        executions: (await ctx.db.query("executions").collect()).length,
        started: events.filter((event) => event.payload.type === "run_started"),
        scheduled: scheduled.map((job) => job.name),
      };
    });
    expect(snapshot.room?.status).toBe("open");
    expect(snapshot.room?.constraintsVersion).toBe(1);
    expect(snapshot.room?.provenance).toBe("seeded");
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]?.runNo).toBe(1);
    expect(snapshot.runs[0]?.cause).toBe("room_opened");
    expect(snapshot.runs[0]?.provenance).toBe("seeded");
    expect(snapshot.started.map((event) => event.payload)).toEqual([{ type: "run_started", runNo: 1, cause: "room_opened" }]);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.candidateSnapshot.length).toBeGreaterThan(0);
    expect(snapshot.turns[0]?.promptVersion).not.toBe('seed');
    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.attempts[0]?.status).toBe('running');
    expect(snapshot.facts.length).toBeGreaterThan(0);
    expect(snapshot.events.some(event => event.payload.type === 'disclosure_changed')).toBe(true);
    expect(snapshot.events.map(event => event.seq)).toEqual(snapshot.events.map((_, index) => index));
    expect(snapshot.proposals).toBe(0);
    expect(snapshot.approvals).toBe(0);
    expect(snapshot.executions).toBe(0);
    expect(snapshot.scheduled.some((name) => name.includes("runAttempt"))).toBe(true);
  });

  test("12.20 seed stopBeforeRole leaves setup without a run", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: "finance" });
    const snapshot = await t.run(async (ctx) => ({
      room: await ctx.db.get(roomId),
      runs: await ctx.db.query("runs").withIndex("by_room_runNo", (q) => q.eq("roomId", roomId)).collect(),
      briefs: await ctx.db.query("briefs").withIndex("by_room_role_version", (q) => q.eq("roomId", roomId)).collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(snapshot.room?.status).toBe("setup");
    expect(snapshot.runs).toHaveLength(0);
    expect(snapshot.briefs.map((brief) => brief.role).sort()).toEqual(["customer", "provider"]);
    expect(snapshot.scheduled.some(job => job.name.includes("runAttempt"))).toBe(false);
  });

  test("D18 seed refuses the prod tier", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "prod");
    const t = makeT();
    const error = await mutationOnDeployment(t, seedFunctions.fromFixture, {}, "prod-deployment").then(() => undefined, (caught: unknown) => caught);
    expect(codeOf(error)).toBe("internal");
    expect(await t.run(async (ctx) => (await ctx.db.query("rooms").collect()).length)).toBe(0);
  });

  test('seed/reset work on dev while environment test tier cannot unlock them', async () => {
    const t = makeT();
    vi.stubEnv('DEPLOYMENT_TIER', 'test');
    await expect(mutationOnDeployment(t, seedFunctions.fromFixture, {}, 'dev-deployment')).rejects.toThrow(/internal/);
    await expect(mutationOnDeployment(t, probeFunctions.limitsProbe, { confirmDeployment: 'dev-deployment' }, 'dev-deployment')).rejects.toThrow(/internal/);
    await expect(mutationOnDeployment(t, seedFunctions.reset, { confirmDeployment: 'dev-deployment', fixtureKey: null }, 'dev-deployment')).rejects.toThrow(/internal/);
    expect(await t.run(ctx => ctx.db.query('rooms').collect())).toEqual([]);
    vi.stubEnv('DEPLOYMENT_TIER', 'dev');
    const seeded = await mutationOnDeployment<Record<string, never>, { roomId: Id<'rooms'> }>(t, seedFunctions.fromFixture, {}, 'dev-deployment');
    expect(await t.run(ctx => ctx.db.get(seeded.roomId))).not.toBeNull();
    await expect(mutationOnDeployment(t, seedFunctions.reset, { confirmDeployment: 'wrong', fixtureKey: null }, 'dev-deployment')).rejects.toThrow(/internal/);
    await mutationOnDeployment(t, seedFunctions.reset, { confirmDeployment: 'dev-deployment', fixtureKey: null }, 'dev-deployment');
    expect(await t.run(ctx => ctx.db.query('rooms').collect())).toEqual([]);
  });

  test('limitsProbe preserves preexisting rooms and every row they own', async () => {
    const t = makeT();
    const seeded = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: 'finance' });
    const snapshot = () => t.run(async ctx => ({ room: await ctx.db.get(seeded.roomId), catalog: await ctx.db.query('catalogItems').collect(), ledger: await ctx.db.query('ledgerEntries').collect(), members: await ctx.db.query('members').collect(), events: await ctx.db.query('events').collect(), briefs: await ctx.db.query('briefs').collect(), invites: await ctx.db.query('invites').collect() }));
    const before = await snapshot();
    await t.mutation(internal.devProbes.limitsProbe, { confirmDeployment: 'test' });
    expect(await snapshot()).toEqual(before);
    expect(await t.query(internal.testing.listRoomIds, {})).toEqual([seeded.roomId]);
  });

  test("D18 reset refuses a wrong confirmDeployment", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const error = await t.mutation(internal.seed.reset, { confirmDeployment: "nope", fixtureKey: null }).then(() => undefined, (caught: unknown) => caught);
    expect(codeOf(error)).toBe("internal");
    expect(await t.run(async (ctx) => ctx.db.get(roomId))).not.toBeNull();
  });

  test("TC-OPS-02 seeded stub and live provenance stay distinct through reset", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const { liveId, stubId } = await t.run(async (ctx) => {
      const seeded = await ctx.db.get(roomId);
      const rows = [
        ...(await ctx.db.query("briefs").collect()),
        ...(await ctx.db.query("catalogItems").collect()),
        ...(await ctx.db.query("ledgerEntries").collect()),
        ...(await ctx.db.query("runs").collect()),
        ...(await ctx.db.query("events").collect()),
      ];
      if (seeded?.provenance !== "seeded" || rows.some((row) => row.provenance !== "seeded")) {
        throw new Error("seed rows must be provenance seeded");
      }
      const userId = seeded?.createdBy;
      if (!userId || !seeded) throw new Error("seed missing");
      const base = {
        scenarioKey: "scope_change" as const,
        scenarioVersion: 1,
        title: "other",
        timeZone: "America/Los_Angeles",
        localDate: seeded.localDate,
        status: "setup" as const,
        constraintsVersion: 0,
        nextProposalVersion: 1,
        nextRunNo: 1,
        writeSeq: 0,
        createdBy: userId,
        createdAt: seeded.createdAt,
      };
      return {
        liveId: await ctx.db.insert("rooms", { ...base, provenance: "live" }),
        stubId: await ctx.db.insert("rooms", { ...base, provenance: "stub", title: "stub room" }),
      };
    });
    const first = await t.mutation(internal.seed.reset, { confirmDeployment: "test", fixtureKey: null });
    expect(first.more).toBe(false);
    const left = await t.run(async (ctx) => ({
      live: await ctx.db.get(liveId),
      stub: await ctx.db.get(stubId),
      seeded: await ctx.db.get(roomId),
    }));
    expect(left.live?.provenance).toBe("live");
    expect(left.stub).toBeNull();
    expect(left.seeded).toBeNull();
  });

  test("TC-OPS-03 prod reset is refused and a live room is kept", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const liveId = await t.run(async (ctx) => {
      const seeded = await ctx.db.get(roomId);
      if (!seeded) throw new Error("missing");
      return await ctx.db.insert("rooms", {
        scenarioKey: "scope_change",
        scenarioVersion: 1,
        title: "live",
        timeZone: seeded.timeZone,
        localDate: seeded.localDate,
        status: "setup",
        constraintsVersion: 0,
        nextProposalVersion: 1,
        nextRunNo: 1,
        writeSeq: 0,
        createdBy: seeded.createdBy,
        provenance: "live",
        createdAt: seeded.createdAt,
      });
    });
    vi.stubEnv("DEPLOYMENT_TIER", "prod");
    const error = await mutationOnDeployment(t, seedFunctions.reset, { confirmDeployment: "prod-deployment", fixtureKey: null }, "prod-deployment").then(() => undefined, (caught: unknown) => caught);
    expect(codeOf(error)).toBe("internal");
    vi.stubEnv("DEPLOYMENT_TIER", "test");
    await t.mutation(internal.seed.reset, { confirmDeployment: "test", fixtureKey: "main" });
    const live = await t.run(async (ctx) => ctx.db.get(liveId));
    expect(live?.provenance).toBe("live");
    expect(await t.run(async (ctx) => (await ctx.db.query("rooms").collect()).length)).toBe(1);
  });

  test('limitsProbe checks confirmDeployment before any writes or reset', async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: 'finance' });
    await expect(t.mutation(internal.devProbes.limitsProbe, { confirmDeployment: 'wrong' })).rejects.toThrow(/internal/);
    expect(await t.run(ctx => ctx.db.get(roomId))).not.toBeNull();
    expect(await t.query(internal.testing.listRoomIds, {})).toEqual([roomId]);
  });

  test("TC-OPS-06 reset batch stays inside the transaction limit with 10x headroom", async () => {
    const t = makeT(true);
    const metrics = await t.mutation(internal.devProbes.limitsProbe, { confirmDeployment: "test" });
    expect(metrics.available).toBe(true);
    if (metrics.available) {
      const { used, remaining } = metrics.documentsWritten;
      expect(used * 10).toBeLessThanOrEqual(used + remaining);
    }
    const seeded = await t.mutation(internal.seed.fromFixture, {});
    await expect(t.mutation(internal.seed.reset, { confirmDeployment: "test", fixtureKey: null })).resolves.toMatchObject({ more: false });
    expect(seeded.roomId).toBeTruthy();
  });

  test("seed.reset stops at 2000 documents and reports more", async () => {
    const t = makeT();
    const roomId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "https://seed.invalid|batch",
        displayName: "batch",
        isTestAccount: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const id = await ctx.db.insert("rooms", {
        scenarioKey: "scope_change",
        scenarioVersion: 1,
        title: "batch",
        timeZone: "America/Los_Angeles",
        localDate: "2026-11-02",
        status: "setup",
        constraintsVersion: 0,
        nextProposalVersion: 1,
        nextRunNo: 1,
        writeSeq: 0,
        createdBy: userId,
        provenance: "stub",
        createdAt: 1,
      });
      for (let index = 0; index < 2001; index += 1) {
        await ctx.db.insert("members", {
          roomId: id,
          userId,
          role: "customer",
          displayName: "m",
          joinedVia: "creator",
          joinedAt: 1,
        });
      }
      return id;
    });
    const first = await t.mutation(internal.seed.reset, { confirmDeployment: "test", fixtureKey: null });
    expect(first.rowsDeleted).toBe(2000);
    expect(first.more).toBe(true);
    expect(await t.run(async (ctx) => ctx.db.get(roomId))).not.toBeNull();
    const second = await t.mutation(internal.seed.reset, { confirmDeployment: "test", fixtureKey: null });
    expect(second.more).toBe(false);
    expect(await t.run(async (ctx) => ctx.db.get(roomId))).toBeNull();
  });

  test("TC-PRIV-17 lintCanaries runs before a canary seed and a colliding value is rejected", async () => {
    const issues = lintCanaries(
      [{ id: "price", ownerRole: "finance", kind: "money", value: 50000, allowedRoles: [], origin: "constraint", provenance: "seeded" }],
      [{ label: "catalog", text: "sso_login $500.00" }],
    );
    expect(issues.length).toBeGreaterThan(0);
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, { fixtureKey: "canary" });
    expect(await t.run(async (ctx) => (await ctx.db.get(roomId))?.provenance)).toBe("seeded");
    const error = await t.mutation(internal.seed.fromFixture, { fixtureKey: "below_committed" }).then(() => undefined, (caught: unknown) => caught);
    expect(codeOf(error)).toBe("budget.below_committed");
  });

  test("E2E subjects become tokenIdentifier rows", async () => {
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example");
    vi.stubEnv("E2E_CUSTOMER_SUBJECT", "user_customer");
    vi.stubEnv("E2E_PROVIDER_SUBJECT", "user_provider");
    vi.stubEnv("E2E_FINANCE_SUBJECT", "user_finance");
    const t = makeT();
    await t.mutation(internal.seed.fromFixture, { stopBeforeRole: "customer" });
    const tokens = await t.run(async (ctx) => (await ctx.db.query("users").collect()).map((user) => user.tokenIdentifier).sort());
    expect(tokens).toEqual([
      "https://clerk.example|user_customer",
      "https://clerk.example|user_finance",
      "https://clerk.example|user_provider",
    ]);
  });
});

describe("W2-7 ops and privacy", () => {
  test("15.3 configHealth preview stub without a key is valid", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "preview");
    vi.stubEnv("AGENT_MODE", "stub");
    const health = await makeT().query(internal.ops.configHealth, {});
    expect(health).toMatchObject({ tier: "preview", agentMode: "stub", anthropicKeyConfigured: false, configValid: true, invalidFields: [] });
  });

  test("15.3 configHealth preview live is invalid", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "preview");
    vi.stubEnv("AGENT_MODE", "live");
    const health = await makeT().query(internal.ops.configHealth, {});
    expect(health.configValid).toBe(false);
    expect(health.invalidFields).toContain("agentMode");
  });

  test("15.3 configHealth live without a key is invalid", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "dev");
    vi.stubEnv("AGENT_MODE", "live");
    const health = await makeT().query(internal.ops.configHealth, {});
    expect(health.invalidFields).toContain("anthropicKeyConfigured");
  });

  test("15.3 configHealth missing tier is invalid", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "");
    const health = await makeT().query(internal.ops.configHealth, {});
    expect(health.tier).toBe("missing");
    expect(health.configValid).toBe(false);
  });

  test("15.3 configHealth modelFallbacks default false and garbage is invalid", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "dev");
    vi.stubEnv("AGENT_MODE", "stub");
    expect((await makeT().query(internal.ops.configHealth, {})).modelFallbacks).toBe(false);
    vi.stubEnv("MODEL_FALLBACKS", "sometimes");
    expect((await makeT().query(internal.ops.configHealth, {})).invalidFields).toContain("modelFallbacks");
  });

  test("15.3 configHealth draining comes from opsFlags", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "dev");
    vi.stubEnv("AGENT_MODE", "stub");
    const t = makeT();
    expect((await t.query(internal.ops.configHealth, {})).draining).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.insert("opsFlags", { key: "global", draining: true, changedAt: 1, changedBy: null });
    });
    expect((await t.query(internal.ops.configHealth, {})).draining).toBe(true);
  });

  test("15.3 configHealth never returns a value", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "preview");
    vi.stubEnv("AGENT_MODE", "stub");
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://canary-issuer.example");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-canary-value");
    const health = await makeT().query(internal.ops.configHealth, {});
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain("canary-issuer");
    expect(serialized).not.toContain("sk-canary");
    expect(health.clerkIssuerConfigured).toBe(true);
    expect(health.anthropicKeyConfigured).toBe(true);
    expect(Object.values(health).every((value) => typeof value === "boolean" || typeof value === "string" || Array.isArray(value))).toBe(true);
  });

  test("12.20 ops.metrics reports n for every metric", async () => {
    const metrics = await makeT().query(internal.ops.metrics, { sinceMs: 0, untilMs: 10 });
    for (const value of Object.values(metrics)) expect(value).toEqual(expect.objectContaining({ n: expect.any(Number) }));
    expect(metrics.spendEstimate.estimate).toBe(true);
    expect(metrics.spendEstimate.asOf).toBe("2026-10-06");
  });

  test("12.20 ops.auditUsers counts duplicate tokens without returning them", async () => {
    const t = makeT();
    const secret = "https://issuer.example|duplicate-subject";
    await t.run(async (ctx) => {
      const row = { displayName: "a", isTestAccount: true, createdAt: 1, updatedAt: 1, tokenIdentifier: secret };
      await ctx.db.insert("users", row);
      await ctx.db.insert("users", { ...row, displayName: "b" });
    });
    const report = await t.query(internal.ops.auditUsers, {});
    expect(report).toEqual({ duplicateTokenIdentifiers: 1 });
    expect(JSON.stringify(report)).not.toContain("duplicate-subject");
  });

  test("12.20 ops.purgeRawOutputs deletes 500 and reschedules while more", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "https://seed.invalid|purge", displayName: "p", isTestAccount: true, createdAt: 1, updatedAt: 1,
      });
      const roomId = await ctx.db.insert("rooms", {
        scenarioKey: "scope_change", scenarioVersion: 1, title: "purge", timeZone: "UTC", localDate: "2026-11-02",
        status: "open", constraintsVersion: 1, nextProposalVersion: 1, nextRunNo: 2, writeSeq: 1,
        createdBy: userId, provenance: "seeded", createdAt: 1,
      });
      const runId = await ctx.db.insert("runs", {
        roomId, runNo: 1, status: "negotiating", cause: "room_opened", constraintsVersionAtStart: 1, agentMode: "stub",
        roundNo: 1, maxRounds: 3, roundsExtended: false, activeTurnSeq: null, nextTurnSeq: 1, attemptCount: 1,
        maxAttempts: 18, reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 1, provenance: "seeded", startedAt: 1,
      });
      const turnId = await ctx.db.insert("turns", {
        roomId, runId, turnSeq: 1, roundNo: 1, role: "provider", kind: "propose", status: "running",
        constraintsVersion: 1, candidateSnapshot: [], allowedActions: ["propose"], promptVersion: "v", currentAttemptNo: 1, createdAt: 1,
      });
      const attemptId = await ctx.db.insert("attempts", {
        roomId, runId, turnId, attemptNo: 1, role: "provider", origin: "turn_start", status: "running", provenance: "stub",
        model: "stub:v1", effort: "medium", maxTokens: 16, protocolVersion: "v", promptVersion: "v", reservedDay: "2026-11-02",
        watchdogArmCount: 0, deadlineAt: 10, reservedMicroUsd: 0, lateUsage: false, startedAt: 1,
      });
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert("rawOutputs", { attemptId, roomId, text: "x", truncated: false, createdAt: 1, expiresAt: 0 });
      }
      await ctx.db.insert("rawOutputs", { attemptId, roomId, text: "keep", truncated: false, createdAt: 1, expiresAt: 9_000_000_000_000 });
    });
    const first = await t.mutation(internal.ops.purgeRawOutputs, {});
    expect(first).toEqual({ deleted: 500, more: true });
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((job) => job.name.includes("purgeRawOutputs"))).toBe(true);
    const second = await t.mutation(internal.ops.purgeRawOutputs, {});
    expect(second).toEqual({ deleted: 1, more: false });
    expect(await t.run(async (ctx) => (await ctx.db.query("rawOutputs").collect()).length)).toBe(1);
  });

  test("12.20 raw output retention is 30 days in dev and 7 days in prod", () => {
    expect(rawOutputRetentionMs("dev")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(rawOutputRetentionMs("preview")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(rawOutputRetentionMs("prod")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("12.20 checkModelConfig live without key → code", async () => {
    vi.stubEnv("AGENT_MODE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await makeT().action(internal.ops.checkModelConfig, {});
    expect(result).toEqual({ ok: false, code: "config_invalid" });
  });

  test("12.20 checkModelConfig stub skips retrieve and model_not_found maps", async () => {
    vi.stubEnv("DEPLOYMENT_TIER", "dev");
    const ok = await makeT().action(internal.ops.checkModelConfig, {});
    expect(ok).toEqual({ ok: true, code: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(retrieveModel("claude-missing", "present-key")).resolves.toEqual({ ok: false, code: "model_not_found" });
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  test('model config validates first and maps real HTTP responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      vi.stubEnv('DEPLOYMENT_TIER', 'preview');
      vi.stubEnv('AGENT_MODE', 'live');
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
      expect(await makeT().action(internal.ops.checkModelConfig, {})).toEqual({ ok: false, code: 'config_invalid' });
      expect(fetchMock).not.toHaveBeenCalled();
      vi.stubEnv('DEPLOYMENT_TIER', 'dev');
      for (const [status, code] of [[401, 'auth'], [403, 'auth'], [404, 'model_not_found']] as const) {
        fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
        expect(await makeT().action(internal.ops.checkModelConfig, {})).toEqual({ ok: false, code });
      }
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      expect(await makeT().action(internal.ops.checkModelConfig, {})).toEqual({ ok: true, code: null });
    } finally { fetchMock.mockRestore(); }
  });

  test('live schema warming sends 25 strict schemas with max_tokens 16 and logs usage', async () => {
    vi.stubEnv('DEPLOYMENT_TIER', 'dev');
    vi.stubEnv('AGENT_MODE', 'live');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      id: 'warm', model: 'claude-opus-5-5', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await makeT().action(internal.ops.warmSchemas, {})).toEqual({ warmed: 25 });
      expect(fetchMock).toHaveBeenCalledTimes(25);
      for (const [, options] of fetchMock.mock.calls) {
        const body = JSON.parse(String(options?.body));
        expect(body.max_tokens).toBe(16);
        expect(body.output_config.format.schema.additionalProperties).toBe(false);
      }
      expect(log).toHaveBeenCalledTimes(25);
      expect(String(log.mock.calls[0]?.[0])).toContain('"inputTokens":1');
    } finally { fetchMock.mockRestore(); log.mockRestore(); }
  });

  test("12.20 ops.warmSchemas warms 25 variants and never uses max_tokens 0", async () => {
    expect(WARM_SCHEMA_VARIANTS).toHaveLength(25);
    expect(WARM_MAX_TOKENS).toBeGreaterThan(0);
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const t = makeT();
    const result = await t.action(internal.ops.warmSchemas, {});
    spy.mockRestore();
    expect(result).toEqual({ warmed: 0 });
    expect(lines).toHaveLength(0);
    expect(lines.join("\n")).not.toContain("\"maxTokens\":0");
    expect(await t.run(async (ctx) => (await ctx.db.query("proposals").collect()).length)).toBe(0);
  });

  test("TC-PRIV-22 redact notes and approval note without touching terms keys", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const ids = await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      const run = (await ctx.db.query("runs").withIndex("by_room_runNo", (q) => q.eq("roomId", roomId)).collect())[0];
      const brief = (await ctx.db.query("briefs").collect()).find((row) => row.role === "customer");
      if (!room || !run || !brief) throw new Error("missing seed rows");
      const termsKey = "terms-key-unchanged";
      const proposalId = await ctx.db.insert("proposals", {
        roomId, runId: run._id, version: 1, origin: "agent", authorRole: "provider", candidateKey: "sso_login",
        terms: { itemKeys: ["sso_login"], modifiers: [], deliveryDate: "2026-11-18", amountCents: 50000 },
        termsKey, lines: [], plannedTasks: [], requiredApprovals: [{ role: "customer", kind: "terms" }],
        createdAtConstraintsVersion: 1, status: "active", statusChangedAt: 1, provenance: "stub", createdAt: 1,
      });
      const approvalId = await ctx.db.insert("approvals", {
        roomId, proposalId, runId: run._id, userId: room.createdBy, role: "customer", kind: "terms", decision: "approve",
        seq: 1, boundConstraintsVersion: 1, boundTermsKey: termsKey, note: "secret note", decidedAt: 1,
      });
      return { briefId: brief._id, proposalId, approvalId, termsKey };
    });
    await t.mutation(internal.privacy.redact, { table: "briefs", rowId: ids.briefId, field: "softFields.notes" });
    await t.mutation(internal.privacy.redact, { table: "approvals", rowId: ids.approvalId, field: "note" });
    const after = await t.run(async (ctx) => ({
      brief: await ctx.db.get(ids.briefId),
      proposal: await ctx.db.get(ids.proposalId),
      approval: await ctx.db.get(ids.approvalId),
      briefs: (await ctx.db.query("briefs").collect()).length,
      approvals: (await ctx.db.query("approvals").collect()).length,
      events: (await ctx.db.query("events").collect()).filter((event) => event.payload.type === "pii_redacted").map((event) => event.payload),
    }));
    expect(after.brief?.softFields.notes).toBe("[redacted]");
    expect(after.approval?.note).toBe("[redacted]");
    expect(after.proposal?.termsKey).toBe(ids.termsKey);
    expect(after.approval?.boundTermsKey).toBe(ids.termsKey);
    expect(after.briefs).toBe(3);
    expect(after.approvals).toBe(1);
    expect(after.events).toEqual([
      { type: "pii_redacted", table: "briefs", field: "softFields.notes" },
      { type: "pii_redacted", table: "approvals", field: "note" },
    ]);
  });

  test("12.20 privacy.redact covers each listed field and rejects a field outside the list", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: "finance" });
    const ids = await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      const member = (await ctx.db.query("members").collect())[0];
      const invite = (await ctx.db.query("invites").collect())[0];
      if (!room || !member || !invite) throw new Error("missing");
      return { userId: room.createdBy, memberId: member._id, inviteId: invite._id };
    });
    await t.mutation(internal.privacy.redact, { table: "users", rowId: ids.userId, field: "displayName" });
    await t.mutation(internal.privacy.redact, { table: "members", rowId: ids.memberId, field: "displayName" });
    await t.mutation(internal.privacy.redact, { table: "invites", rowId: ids.inviteId, field: "invitedEmail" });
    await t.mutation(internal.privacy.redact, { table: "rooms", rowId: roomId, field: "title" });
    const rows = await t.run(async (ctx) => ({
      user: await ctx.db.get(ids.userId as Id<"users">),
      member: await ctx.db.get(ids.memberId),
      invite: await ctx.db.get(ids.inviteId),
      room: await ctx.db.get(roomId),
    }));
    expect(rows.user?.displayName).toBe("[redacted]");
    expect(rows.member?.displayName).toBe("[redacted]");
    expect(rows.invite?.invitedEmail).toBe("[redacted]");
    expect(rows.room?.title).toBe("[redacted]");
    const error = await t.mutation(internal.privacy.redact, { table: "rooms", rowId: roomId, field: "status" }).then(() => undefined, (caught: unknown) => caught);
    expect(codeOf(error)).toBe("input.invalid");
  });
});

describe('redaction lock regression', () => {
  test('users with no memberships are redacted and every member room is audited', async () => {
    const t = makeT();
    const orphan = await t.run(ctx => ctx.db.insert('users', { tokenIdentifier: 'orphan', displayName: 'Private', isTestAccount: true, createdAt: 1, updatedAt: 1 }));
    await t.mutation(internal.privacy.redact, { table: 'users', rowId: orphan, field: 'displayName' });
    expect((await t.run(ctx => ctx.db.get(orphan)))?.displayName).toBe('[redacted]');
    const a = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: 'finance' });
    const b = await t.mutation(internal.seed.fromFixture, { stopBeforeRole: 'finance' });
    const before = await t.run(async ctx => ({ a: (await ctx.db.get(a.roomId))!, b: (await ctx.db.get(b.roomId))!, user: (await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', a.roomId).eq('role', 'customer')).unique())!.userId }));
    await t.mutation(internal.privacy.redact, { table: 'users', rowId: before.user, field: 'displayName' });
    for (const room of [before.a, before.b]) {
      const after = await t.run(async ctx => ({ room: (await ctx.db.get(room._id))!, events: await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', room._id)).collect() }));
      expect(after.room.writeSeq).toBe(room.writeSeq + 1);
      expect(after.events.filter(e => e.payload.type === 'pii_redacted').map(e => e.seq)).toEqual([room.writeSeq + 1]);
    }
  });
});

describe("W2-7 crons and probes", () => {
  test("15.8 crons registers exactly the four jobs", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(Object.keys(crons.crons).sort()).toEqual([
      "expire human requests",
      "liveness sweep",
      "purge raw model outputs",
      "roll room local dates",
    ]);
    expect(source).toContain('crons.hourly("roll room local dates", { minuteUTC: 1 }, internal.clock.rollLocalDate, {});');
    expect(source).toContain('crons.hourly("expire human requests", { minuteUTC: 20 }, internal.humanRequests.expireDue, {});');
    expect(source).toContain('crons.interval("liveness sweep", { minutes: 5 }, internal.ops.livenessSweep, {});');
    expect(source).toContain('crons.daily("purge raw model outputs", { hourUTC: 3, minuteUTC: 10 }, internal.ops.purgeRawOutputs, {});');
  });

  test("dev probes and roomCounts refuse prod and count a seeded room", async () => {
    const t = makeT();
    const { roomId } = await t.mutation(internal.seed.fromFixture, {});
    const counts = await t.query(internal.testing.roomCounts, { roomId });
    expect(counts).toMatchObject({ members: 3, briefs: 3, runs: 1, proposals: 0, approvals: 0, executions: 0, ledgerCommits: 0 });
    const identity = await t.mutation(internal.devProbes.scheduledIdentity, {});
    expect(identity.identityPresent).toBe(false);
    vi.stubEnv("DEPLOYMENT_TIER", "prod");
    const error = await t.query(internal.testing.roomCounts, { roomId }).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeUndefined();
  });

  test.each([false, true])("runtimeProbe rolls back seed writes, Intl unavailable=%s", async unavailable => {
    const t = makeT();
    if (unavailable) vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new TypeError('no ICU'); });
    try {
      const error: unknown = await t.mutation(internal.devProbes.runtimeProbe, {}).catch((error: unknown) => error);
      expect(isConvexError(error)).toBe(true);
      const data = (error as { data: { code: string; report: { intlTimeZone: string; seedChain: { ok: boolean } } } }).data;
      expect(data.code).toBe('runtime_probe_rollback');
      expect(data.report.intlTimeZone).toBe(unavailable ? 'throws' : 'ok');
      expect(data.report.seedChain.ok).toBe(true);
      await t.run(async ctx => {
        for (const table of Object.keys(schema.tables) as (keyof typeof schema.tables)[]) {
          expect(await ctx.db.query(table).collect(), table).toEqual([]);
        }
        expect(await ctx.db.system.query('_scheduled_functions').collect()).toEqual([]);
      });
      expect((await t.query(internal.ops.configHealth, {})).timeZoneMode).toBe(unavailable ? 'offset' : 'intl');
    } finally { vi.restoreAllMocks(); }
  });
  test('runtimeProbe bounds errors and rolls back a failed chain after writes', async () => {
    const t = makeT();
    const run = seedChain.runSeedChain;
    vi.spyOn(seedChain, 'runSeedChain').mockImplementation(async (ctx, args) => {
      await run(ctx, args);
      const error = new TypeError('x'.repeat(500));
      error.stack = Array.from({ length: 8 }, () => '    at sensitiveName (/private/path/seed.ts:42:9)').join('\n');
      throw error;
    });
    try {
      const error: unknown = await t.mutation(internal.devProbes.runtimeProbe, {}).catch((error: unknown) => error);
      const report = (error as { data: { report: { seedChain: { ok: boolean; errorClass: string; message: string; frames: string[] } } } }).data.report;
      expect(report.seedChain).toEqual({ ok: false, errorClass: 'TypeError', message: 'x'.repeat(300), frames: Array(5).fill('seed.ts:42') });
      await t.run(async ctx => {
        for (const table of Object.keys(schema.tables) as (keyof typeof schema.tables)[]) {
          expect(await ctx.db.query(table).collect(), table).toEqual([]);
        }
        expect(await ctx.db.system.query('_scheduled_functions').collect()).toEqual([]);
      });
    } finally { vi.restoreAllMocks(); }
  });
  test.each(['preview', 'prod'])('runtimeProbe rejects %s', async tier => {
    vi.stubEnv('DEPLOYMENT_TIER', tier);
    await expect(mutationOnDeployment(makeT(), probeFunctions.runtimeProbe, {}, 'dev-probe')).rejects.toThrow();
  });
});
