import { describe, expect, it, vi } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { executionViewV } from '../model/views/roomView';
import { harness } from '../../tests/convex-helpers/w2Execution.fixture';

const executionRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof executionViewV> | null>('executions:forRoom');
type H = Awaited<ReturnType<typeof harness>>;
async function share(h: H, field: 'capCents' | 'committedCents' | 'headroomCents', patch: { briefVersion?: number; createdAt?: number; seq?: number; withdraw?: boolean } = {}) {
  return h.t.run(ctx => ctx.db.insert('sharedFacts', { roomId: h.roomId, fromRole: 'finance', field, seq: patch.seq ?? 1, value: patch.withdraw ? null : { kind: 'cents', cents: field === 'capCents' ? 480000 : field === 'committedCents' ? 400000 : 80000 }, audience: patch.withdraw ? [] : ['customer'], briefVersion: patch.briefVersion ?? 1, source: 'manual', createdBy: h.users.finance, provenance: 'live', createdAt: patch.createdAt ?? 1 }));
}
async function chain(h: H, role: 'customer' | 'provider' | 'finance' = 'customer') { return (await h.as(role).query(executionRef, { roomId: h.roomId }))?.changeOrder.amountChain; }
const privateNulls = { baselineCents: null, approvedToDateCents: null, committedBeforeCents: null, committedAfterCents: null, capCentsAtExecution: null, headroomAfterCents: null, thisChangeCents: 80000 };

describe('W2-2 F5/F6 historical execution projection', () => {
  it('F5 customer chain always includes public change, finance has cap/headroom, provider has no chain', async () => {
    const h = await harness(); await h.execute();
    expect(await chain(h)).toEqual(privateNulls);
    expect(await chain(h, 'provider')).toBeNull();
    expect(await chain(h, 'finance')).toEqual({ baselineCents: 400000, approvedToDateCents: 0, committedBeforeCents: 400000, committedAfterCents: 480000, thisChangeCents: 80000, capCentsAtExecution: 480000, headroomAfterCents: 0 });
  });
  it.each(['capCents', 'headroomCents', 'committedCents'] as const)('F5 customer %s grant independently reveals only its execution fields', async field => {
    const h = await harness(); await share(h, field); await h.execute();
    const expected = { ...privateNulls } as { [K in keyof typeof privateNulls]: number | null };
    if (field === 'capCents') expected.capCentsAtExecution = 480000;
    if (field === 'headroomCents') expected.headroomAfterCents = 0;
    if (field === 'committedCents') Object.assign(expected, { baselineCents: 400000, approvedToDateCents: 0, committedBeforeCents: 400000, committedAfterCents: 480000 });
    expect(await chain(h)).toEqual(expected);
  });
  it('F6 same-millisecond later brief/share cannot backfill an earlier constraints snapshot [construct]', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T18:00:00Z'));
    try {
      const h = await harness(); const executed = await h.execute();
      const execution = await h.t.run(ctx => ctx.db.get(executed.executionId!));
      await h.t.run(async ctx => {
        const old = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).unique();
        const { _id, _creationTime, ...fields } = old!; void _id; void _creationTime;
        const briefId = await ctx.db.insert('briefs', { ...fields, version: 2, confirmedAt: execution!.executedAt });
        await ctx.db.insert('constraintRevisions', { roomId: h.roomId, version: 2, previousVersion: 1, cause: 'brief_confirmed', sourceRefs: [{ kind: 'brief', briefId, role: 'finance', version: 2 }], localDate: '2026-10-24', createdAt: execution!.executedAt });
      });
      await share(h, 'capCents', { briefVersion: 2, createdAt: execution!.executedAt });
      await share(h, 'headroomCents', { briefVersion: 2, createdAt: execution!.executedAt });
      expect(await chain(h)).toEqual(privateNulls);
    } finally { vi.useRealTimers(); }
  });
  it('F6 server-createdAt cutoff excludes later shares even for the active brief version [construct]', async () => {
    const h = await harness(); const result = await h.execute();
    const execution = await h.t.run(ctx => ctx.db.get(result.executionId!));
    await share(h, 'capCents', { createdAt: execution!.executedAt + 1 });
    expect(await chain(h)).toEqual(privateNulls);
  });
  it('F6 replay chooses active finance source version at execution cv and ignores older-version grant', async () => {
    const h = await harness();
    await h.t.run(async ctx => {
      const old = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).unique();
      const { _id, _creationTime, ...fields } = old!; void _id; void _creationTime;
      const briefId = await ctx.db.insert('briefs', { ...fields, version: 2 });
      await ctx.db.insert('constraintRevisions', { roomId: h.roomId, version: 2, previousVersion: 1, cause: 'brief_confirmed', sourceRefs: [{ kind: 'brief', briefId, role: 'finance', version: 2 }], localDate: '2026-10-24', createdAt: 1 });
      await ctx.db.patch(h.roomId, { constraintsVersion: 2 }); await ctx.db.patch(h.runId, { constraintsVersionAtStart: 2 });
    });
    await share(h, 'capCents'); await share(h, 'committedCents', { briefVersion: 2 });
    for (const role of ['customer', 'provider', 'finance'] as const) await h.approve(role, { expectedConstraintsVersion: 2 });
    expect(await chain(h)).toEqual({ ...privateNulls, baselineCents: 400000, approvedToDateCents: 0, committedBeforeCents: 400000, committedAfterCents: 480000 });
  });
  it('F6 an active-version withdrawal in force at execution hides only its field', async () => {
    const h = await harness(); await share(h, 'capCents'); await share(h, 'headroomCents'); await share(h, 'capCents', { seq: 2, withdraw: true }); await h.execute();
    expect(await chain(h)).toEqual({ ...privateNulls, headroomAfterCents: 0 });
  });
});
