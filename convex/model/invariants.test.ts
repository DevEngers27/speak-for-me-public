import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedRoom } from '../../tests/convex-helpers/seedRoom.fixture';
import { livenessFindings } from '../testing';
import { trackLiveness } from '../../tests/convex-helpers/setup';
import { internal } from '../_generated/api';
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('AGENT_MODE', 'stub'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('LV-1 detects a negotiating run without a running attempt and reconcile repairs it', async () => {
  const s = await seedRoom();
  const a = (await s.t.run(ctx => ctx.db.query('attempts').first()))!;
  await s.t.run(ctx => ctx.db.patch(a._id, { status: 'error' }));
  expect((await s.t.run(ctx => livenessFindings(ctx, s.roomId))).map(f => f.invariant)).toContain('LV-1');
  await s.t.mutation(internal.runs.reconcile, { runId: a.runId });
});
it('LV-2 detects needs_input without an open request', async () => {
  const s = await seedRoom({ capCents: 100000, track: false });
  await s.t.run(async ctx => { const r = (await ctx.db.query('humanRequests').first())!; await ctx.db.delete(r._id); });
  trackLiveness(s.t, s.roomId, ['LV-2']);
});
it('LV-3 detects two nonterminal runs', async () => {
  const s = await seedRoom({ track: false });
  await s.t.run(async ctx => { const run = (await ctx.db.query('runs').first())!; const { _id, _creationTime, ...copy } = run; void _id; void _creationTime; await ctx.db.insert('runs', { ...copy, runNo: 2 }); });
  trackLiveness(s.t, s.roomId, ['LV-1', 'LV-3']);
});
it('LV-4 detects two running attempts in one turn', async () => {
  const s = await seedRoom({ track: false });
  await s.t.run(async ctx => { const a = (await ctx.db.query('attempts').first())!; const { _id, _creationTime, ...copy } = a; void _id; void _creationTime; await ctx.db.insert('attempts', { ...copy, attemptNo: 2 }); });
  trackLiveness(s.t, s.roomId, ['LV-4', 'INV-SM-08']);
});
it('EV-1 detects a constraint revision without an event', async () => {
  const s = await seedRoom({ track: false });
  await s.t.run(async ctx => { for (const e of await ctx.db.query('events').collect()) if (e.payload.type === 'constraints_changed') await ctx.db.delete(e._id); });
  trackLiveness(s.t, s.roomId, ['EV-1']);
});
it('SF-1 detects a shared fact that disagrees with its bound brief', async () => {
  const s = await seedRoom({ track: false });
  await s.t.run(ctx => ctx.db.insert('sharedFacts', { roomId: s.roomId, fromRole: 'customer', field: 'requiredItemKeys', seq: 1, value: { kind: 'itemKeys', itemKeys: ['wrong'] }, audience: ['provider'], briefVersion: 1, source: 'manual', createdBy: s.users[0]!, provenance: 'stub', createdAt: Date.now() }));
  trackLiveness(s.t, s.roomId, ['SF-1']);
});
it('16.5 testing endpoints list rooms and expose no findings for a valid chain', async () => {
  const s = await seedRoom();
  expect(await s.t.query(internal.testing.listRoomIds, {})).toEqual([s.roomId]);
  expect(await s.t.query(internal.testing.checkLiveness, { roomId: s.roomId })).toEqual([]);
});
