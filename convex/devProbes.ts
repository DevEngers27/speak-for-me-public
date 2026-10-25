// eslint-disable-next-line no-restricted-imports, w21/platform -- D22 dev/test rollback diagnostic exception to 11 §11.6.
import { internalMutation as diagnosticMutation } from './_generated/server';
import { intlDate, nowMs } from './lib/time';
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { confirmCore as confirmCatalogCore } from "./model/catalog";
import { runSeedChain } from "./lib/seedChain";
import { deleteProbeRoom } from "./lib/resetRooms";
import { assertTier } from "./lib/config";

const PROBE_TIERS = ["dev", "preview", "test"] as const;

export const schedulerSemantics = internalAction("devProbes.schedulerSemantics")({
  args: { fail: v.boolean() },
  returns: v.object({ ran: v.literal(true) }),
  handler: async (ctx, args) => {
    await assertTier(ctx, PROBE_TIERS);
    if (args.fail) throw new Error("probe_fail");
    return { ran: true as const };
  },
});

export const scheduledIdentity = internalMutation("devProbes.scheduledIdentity")({
  args: {},
  returns: v.object({ identityPresent: v.boolean() }),
  handler: async (ctx) => {
    await assertTier(ctx, PROBE_TIERS);
    const identity = await ctx.auth.getUserIdentity();
    return { identityPresent: identity !== null };
  },
});

export const limitsProbe = internalMutation("devProbes.limitsProbe")({
  args: { confirmDeployment: v.string() },
  returns: v.union(
    v.object({ available: v.literal(false) }),
    v.object({
      available: v.literal(true),
      documentsWritten: v.object({ used: v.number(), remaining: v.number() }),
    }),
  ),
  handler: async (ctx, args) => {
    await assertTier(ctx, PROBE_TIERS, { confirmDeployment: args.confirmDeployment });
    // Measure production seed/catalog writes and cleanup for this probe room only.
    const { roomId } = await runSeedChain(ctx, { stopBeforeRole: "finance" });
    const provider = await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', roomId).eq('role', 'provider')).unique();
    if (!provider) throw new Error('Probe fixture missing provider');
    await confirmCatalogCore(ctx, { userId: provider.userId, provenance: 'seeded' }, {
      roomId, expectedConstraintsVersion: 0,
      rows: Array.from({ length: 6 }, (_, index) => ({ itemKey: `extra_item_${index}`, kind: 'item' as const, title: `Extra item ${index}`, priceCents: 1000, leadDays: 1,
        taskTemplates: Array.from({ length: 5 }, (_, template) => ({ title: `Task ${template}`, assigneeRole: 'provider' as const })),
      })),
    });
    await deleteProbeRoom(ctx, roomId);
    try {
      const metrics = await ctx.meta.getTransactionMetrics();
      return { available: true as const, documentsWritten: metrics.documentsWritten };
    } catch {
      return { available: false as const };
    }
  },
});

/** 11 §11.6 exception: only this dev/test probe exposes bounded raw messages.
 * The dedicated ConvexError carries the report and rolls back ALL seed writes,
 * even if the seed throws after creating actors or scheduling work. No logging.
 */
export const runtimeProbe = diagnosticMutation({
  args: {},
  returns: v.object({
    intlTimeZone: v.union(v.literal('ok'), v.literal('throws')),
    intlError: v.optional(v.string()), todayInTimeZone: v.optional(v.string()),
    seedChain: v.object({ ok: v.boolean(), errorClass: v.optional(v.string()),
      message: v.optional(v.string()), frames: v.optional(v.array(v.string())) }),
  }),
  handler: async (ctx) => {
    await assertTier(ctx, ['dev', 'test']);
    const report: { intlTimeZone: 'ok' | 'throws'; intlError?: string; todayInTimeZone?: string;
      seedChain: { ok: boolean; errorClass?: string; message?: string; frames?: string[] } } = {
      intlTimeZone: 'ok', seedChain: { ok: true },
    };
    try { report.todayInTimeZone = intlDate(nowMs(ctx), 'America/Los_Angeles'); }
    catch (error) {
      report.intlTimeZone = 'throws';
      report.intlError = (error instanceof Error ? `${error.name}: ${error.message}` : 'UnknownError').slice(0, 200);
    }
    try { await runSeedChain(ctx, {}); }
    catch (error) {
      report.seedChain = { ok: false, errorClass: error instanceof Error ? error.name.slice(0, 80) : 'UnknownError',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
        // Drop function names, arguments, columns and absolute paths.
        frames: error instanceof Error ? [...(error.stack ?? '').matchAll(/(?:^|[\s(/])([\w.-]+\.[cm]?[jt]s):([0-9]+)(?::[0-9]+)?/gm)]
          .slice(0, 5).map(match => `${match[1]}:${match[2]}`) : [],
      };
    }
    throw new ConvexError({ code: 'runtime_probe_rollback', report });
  },
});

export const commitTsProbe = internalMutation("devProbes.commitTsProbe")({
  args: {},
  returns: v.object({ roomId: v.id("rooms"), seq: v.number() }),
  handler: async (ctx) => {
    await assertTier(ctx, PROBE_TIERS);
    const seeded = await runSeedChain(ctx, { stopBeforeRole: "finance" });
    const events = await ctx.db.query("events").withIndex("by_room_order", (q) => q.eq("roomId", seeded.roomId)).collect();
    return { roomId: seeded.roomId, seq: events.length };
  },
});

export const schedulerSemanticsKick = internalMutation("devProbes.schedulerSemanticsKick")({
  args: { fail: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await assertTier(ctx, PROBE_TIERS);
    const ref = makeFunctionReference<"action", { fail: boolean }>("devProbes:schedulerSemantics");
    return await ctx.scheduler.runAfter(0, ref, { fail: args.fail });
  },
});

/** Only scheduler state leaves this probe, never action arguments or error text. */
export const schedulerSemanticsState = internalQuery('devProbes.schedulerSemanticsState')({
  args: { id: v.string() }, returns: v.union(v.string(), v.null()), handler: async (ctx, { id }) => {
    await assertTier(ctx, PROBE_TIERS);
    const normalized = ctx.db.system.normalizeId('_scheduled_functions', id);
    const job = normalized ? await ctx.db.system.get(normalized) : null;
    return job?.state.kind ?? null;
  },
});

import { fixtureV, fixtureModeV, observationV, prepareConcurrencyCore, observeConcurrencyCore } from './lib/probeFixtures';
export const prepareConcurrency = internalMutation('devProbes.prepareConcurrency')({ args: { key: v.string(), mode: fixtureModeV }, returns: fixtureV,
  handler: (ctx, { key, mode }) => prepareConcurrencyCore(ctx, key, mode) });
export const observeConcurrency = internalQuery('devProbes.observeConcurrency')({ args: { roomId: v.id('rooms'), proposalId: v.optional(v.id('proposals')) }, returns: observationV,
  handler: (ctx, { roomId, proposalId }) => observeConcurrencyCore(ctx, roomId, proposalId) });
