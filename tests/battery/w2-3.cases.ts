import { convexTest } from 'convex-test';
import { afterEach, expect, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
import { api, internal } from '../../convex/_generated/api';
import type { Id, Doc } from '../../convex/_generated/dataModel';
import schema from '../../convex/schema';
import { modules } from '../convex-helpers/setup';

export const LOGIN = { itemKey: 'login', kind: 'item' as const, title: 'Login', priceCents: 50000, leadDays: 2, taskTemplates: [{ title: 'Build login', assigneeRole: 'provider' as const }] };
export const REPORT = { itemKey: 'reports', kind: 'item' as const, title: 'Reports', priceCents: 40000, leadDays: 1, taskTemplates: [] };
export async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T18:00:00Z'));
  const t = convexTest(schema, modules);
  const users = await t.run(async ctx => {
    const ids = {} as Record<'finance' | 'provider' | 'customer', Id<'users'>>;
    for (const role of ['finance', 'provider', 'customer'] as const) ids[role] = await ctx.db.insert('users', { tokenIdentifier: `test|${role}`, displayName: role, isTestAccount: true, createdAt: Date.now(), updatedAt: Date.now() });
    return ids;
  });
  const finance = t.withIdentity({ tokenIdentifier: 'test|finance' });
  const provider = t.withIdentity({ tokenIdentifier: 'test|provider' });
  const customer = t.withIdentity({ tokenIdentifier: 'test|customer' });
  const { roomId } = await finance.mutation(api.rooms.create, { title: 'Constraint room', scenarioKey: 'scope_change', myRole: 'finance', timeZone: 'UTC' });
  await t.run(async ctx => {
    const {openRoomTx}=await import('../../convex/lib/db');const {addMember}=await import('../../convex/model/members');
    const tx=await openRoomTx(ctx,roomId,{allow:['setup']});
    for(const role of ['provider','customer']as const)await addMember(tx,{userId:users[role],role,via:'creator'});
  });
  await provider.mutation(api.catalog.confirm, { roomId, expectedConstraintsVersion: 0, rows: [LOGIN, REPORT] });
  await finance.mutation(api.ledger.recordBaseline, { roomId, amountCents: 400000 });
  await provider.mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: 0, hardFields: { schemaKey: 'scope_change.provider.v1' }, softFields: { schemaKey: 'scope_change.provider.v1', notes: '' }, disclosures: {} });
  await customer.mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: 0, hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-11-20' }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes: '' }, disclosures: {} });
  vi.setSystemTime(Date.now() + 1);
  await finance.mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: 0, hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 500000 }, softFields: { schemaKey: 'scope_change.finance.v1', notes: 'FINANCE_PRIVATE_CANARY' }, disclosures: {} });
  const room = () => t.run(async ctx => (await ctx.db.get(roomId))!);
  const revisions = () => t.run(async ctx => ctx.db.query('constraintRevisions').withIndex('by_room_version', q => q.eq('roomId', roomId)).collect());
  const cv = async () => (await room()).constraintsVersion;
  const setCap = async (capCents: number) => finance.mutation(api.budget.setCap, { roomId, capCents, expectedConstraintsVersion: await cv() });
  const confirmCustomer = async (deadline: string, requiredItemKeys = ['login'], notes = '') => customer.mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: await cv(), hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys, deadline }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes }, disclosures: {} });
  return { t, users, finance, provider, customer, roomId, room, revisions, cv, setCap, confirmCustomer };
}
export async function pending(f: Awaited<ReturnType<typeof fixture>>, deliveryDate = '2026-10-26', proposalStatus: Doc<'proposals'>['status'] = 'active') {
  return f.t.run(async ctx => {
    const room = (await ctx.db.get(f.roomId))!;
    const runId = room.currentRunId!;
    const proposalId = await ctx.db.insert('proposals', { roomId: f.roomId, runId, version: 1, origin: 'agent', authorRole: 'provider', candidateKey: 'login', terms: { itemKeys: ['login'], modifiers: [], deliveryDate, amountCents: 50000 }, termsKey: `login:${deliveryDate}:50000`, lines: [{ itemKey: 'login', kind: 'item', revision: 1, title: 'Login', priceCents: 50000, leadDays: 2 }], plannedTasks: [], requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }], createdAtConstraintsVersion: room.constraintsVersion, status: proposalStatus, statusChangedAt: Date.now(), provenance: 'stub', createdAt: Date.now() });
    await ctx.db.patch(runId, { status: proposalStatus === 'rejected' ? 'negotiating' : 'pending_approval', currentProposalId: proposalId, activeTurnSeq: null });
    for (const turn of await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId)).collect()) if (!['completed', 'stale', 'failed'].includes(turn.status)) await ctx.db.patch(turn._id, { status: 'stale' });
    return { proposalId, runId };
  });
}
export const cases = {
  unchanged: async () => {
    const f = await fixture(); const before = await f.t.run(async ctx => ({ room: await ctx.db.get(f.roomId), events: await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', f.roomId)).collect(), briefs: await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', f.roomId)).collect() }));
    expect(await f.setCap(500000)).toMatchObject({ status: 'unchanged', bumped: false, constraintsVersion: 1 });
    expect(await f.t.run(async ctx => ({ room: await ctx.db.get(f.roomId), events: await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', f.roomId)).collect(), briefs: await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', f.roomId)).collect() }))).toEqual(before);
  },
  belowCommitted: async () => {
    const f = await fixture(); const before = await f.room();
    await expect(f.setCap(390000)).rejects.toMatchObject({ data: { code: 'budget.below_committed', params: { minAllowedCapCents: 400000 } } });
    expect(await f.room()).toEqual(before); expect(await f.revisions()).toHaveLength(1);
    await expect(f.provider.mutation(api.budget.setCap, { roomId: f.roomId, capCents: 390000, expectedConstraintsVersion: 1 })).rejects.toMatchObject({ data: { code: 'auth.role_forbidden', params: {} } });
  },
  hardBucket: async () => {
    const f = await fixture(); vi.setSystemTime(Date.now() + 25 * 3600000);
    for (let n = 0; n < 6; n++) await f.confirmCustomer(`2026-11-${String(10 + n).padStart(2, '0')}`);
    await expect(f.setCap(510000)).rejects.toThrow(/run.rate_limited/);
    expect(await f.cv()).toBe(7); expect(await f.revisions()).toHaveLength(7);
    vi.setSystemTime(Date.now() + 25 * 3600000); await expect(f.setCap(510000)).resolves.toMatchObject({ bumped: true });
  },
  priceBucket: async () => {
    const f = await fixture(); vi.setSystemTime(Date.now() + 25 * 3600000);
    for (let n = 1; n <= 3; n++) await f.provider.mutation(api.catalog.confirm, { roomId: f.roomId, expectedConstraintsVersion: await f.cv(), rows: [{ ...LOGIN, priceCents: 50000 + n }] });
    await expect(f.provider.mutation(api.catalog.confirm, { roomId: f.roomId, expectedConstraintsVersion: await f.cv(), rows: [{ ...LOGIN, priceCents: 50004 }] })).rejects.toThrow(/run.rate_limited/);
    expect(await f.cv()).toBe(4); expect(await f.revisions()).toHaveLength(4);
  },
  titleOnly: async () => {
    const f = await fixture(); const before = await f.room();
    expect(await f.provider.mutation(api.catalog.confirm, { roomId: f.roomId, expectedConstraintsVersion: 1, rows: [{ ...LOGIN, title: 'Secure login', taskTemplates: [] }] })).toMatchObject({ constraintsVersion: 1, bumped: false });
    expect((await f.room()).currentRunId).toBe(before.currentRunId); expect(await f.revisions()).toHaveLength(1);
    const rows = await f.t.run(async ctx => ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', f.roomId).eq('itemKey', 'login')).collect());
    expect(rows.map(r => [r.revision, r.editNo])).toEqual([[1, 0], [1, 1]]);
  },
  retainPending: async () => {
    const f = await fixture(); const old = await pending(f); await f.setCap(510000);
    const room = await f.room(); expect(room.constraintsVersion).toBe(2); expect(room.currentRunId).not.toBe(old.runId);
    const rows = await f.t.run(async ctx => ({ old: await ctx.db.get(old.runId), run: await ctx.db.get(room.currentRunId!), proposal: await ctx.db.get(old.proposalId) }));
    expect(rows.old).toMatchObject({ status: 'superseded', endedReason: 'constraints_changed' });
    expect(rows.run).toMatchObject({ status: 'pending_approval', currentProposalId: old.proposalId, constraintsVersionAtStart: 2 }); expect(rows.proposal?.status).toBe('active');
  },
  rejectedNeverRevives: async () => {
    const f = await fixture(); const old = await pending(f, '2026-10-26', 'rejected'); await f.setCap(510000);
    const room = await f.room();
    expect(await f.t.run(async ctx => (await ctx.db.get(old.proposalId))?.status)).toBe('rejected');
    expect(await f.t.run(async ctx => (await ctx.db.get(room.currentRunId!))?.currentProposalId)).not.toBe(old.proposalId);
  },
  repricingBumps: async () => {
    const f = await fixture(); const old = await pending(f); vi.setSystemTime(Date.now() + 25 * 3600000);
    const result = await f.provider.mutation(api.catalog.confirm, { roomId: f.roomId, expectedConstraintsVersion: 1, rows: [{ ...LOGIN, priceCents: 60000 }] });
    expect(result).toMatchObject({ bumped: true, constraintsVersion: 2 });
    expect(await f.t.run(async ctx => (await ctx.db.get(old.proposalId))?.status)).toBe('stale');
  },
  twoBumps: async () => {
    const f = await fixture(); const first = (await f.room()).currentRunId!;
    await f.setCap(510000); const second = (await f.room()).currentRunId!;
    await f.setCap(520000); const third = (await f.room()).currentRunId!;
    expect(new Set([first, second, third]).size).toBe(3);
    const rows = await f.t.run(async ctx => Promise.all([first, second, third].map(id => ctx.db.get(id))));
    expect(rows.map(r => r?.status)).toEqual(['superseded', 'superseded', 'negotiating']);
    expect(rows[2]?.constraintsVersionAtStart).toBe(3); expect((await f.revisions()).map(r => r.version)).toEqual([1, 2, 3]);
  },
  replay: async () => {
    const f = await fixture();
    const initial = await f.t.query(internal.constraints.replayRuleInput, { roomId: f.roomId, ref: { constraintsVersion: 1, localDate: '2026-10-24' } });
    expect(initial).toMatchObject({ capCents: 500000, committedCents: 400000, requiredItemKeys: ['login'], deadline: '2026-11-20' });
    await f.setCap(510000); await f.confirmCustomer('2026-11-18');
    expect(await f.t.query(internal.constraints.replayRuleInput, { roomId: f.roomId, ref: { constraintsVersion: 1, localDate: '2026-10-24' } })).toEqual(initial);
    expect(await f.t.query(internal.constraints.replayRuleInput, { roomId: f.roomId, ref: { constraintsVersion: 2, localDate: '2026-10-24' } })).toMatchObject({ capCents: 510000, deadline: '2026-11-20' });
    expect(await f.t.query(internal.constraints.replayRuleInput, { roomId: f.roomId, ref: { constraintsVersion: 3, localDate: '2026-10-24' } })).toMatchObject({ capCents: 510000, deadline: '2026-11-18' });
    const revs = await f.revisions(); expect(revs.map(r => r.version)).toEqual([1, 2, 3]); expect(revs[0]?.sourceRefs.filter(r => r.kind === 'brief')).toHaveLength(3); expect(revs[0]?.sourceRefs.filter(r => r.kind === 'catalogItem')).toHaveLength(2);
  },
  rollover: async () => {
    const f = await fixture(); const old = await pending(f, '2026-10-24'); vi.setSystemTime(new Date('2026-10-25T00:01:00Z'));
    await f.t.mutation(internal.clock.rollLocalDate, { roomId: f.roomId });
    expect(await f.room()).toMatchObject({ localDate: '2026-10-25', constraintsVersion: 2 });
    expect(await f.t.run(async ctx => (await ctx.db.get(old.proposalId))?.terms.deliveryDate)).toBe('2026-10-24');
    const after = await f.room(); await f.t.mutation(internal.clock.rollLocalDate, { roomId: f.roomId }); expect(await f.room()).toEqual(after);
    expect((await f.revisions())[1]).toMatchObject({ cause: 'clock', localDate: '2026-10-25' });
  },
  baselineOpen: async () => {
    const f = await fixture(); await expect(f.finance.mutation(api.ledger.recordBaseline, { roomId: f.roomId, amountCents: 400000 })).rejects.toThrow(/run.invalid_state/); expect(await f.cv()).toBe(1);
  },
};

export async function previewMatrix() {
  const f = await fixture(); const old = await pending(f);
  const changes = [{ kind: 'cap' as const, newCapCents: 480000 }, { kind: 'customer_hard' as const, deadline: '2026-11-18' }, { kind: 'catalog' as const, rows: [{ itemKey: 'login', priceCents: 60000 }] }];
  for (const [n, change] of changes.entries()) for (const [role, actor] of [['finance', f.finance], ['customer', f.customer], ['provider', f.provider]] as const) {
    const result = await actor.query(api.rooms.previewChange, { roomId: f.roomId, change });
    const owner = ['finance', 'customer', 'provider'][n];
    if (role !== owner) expect(result).toBeNull();
    else expect(result).toMatchObject({ verdict: role === 'finance' ? 'after' : 'recheck', nextConstraintsVersion: 2, invalidatedApprovals: 0, willSupersedeRun: true });
  }
  expect(await f.finance.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'cap', newCapCents: 500000 } })).toEqual({ verdict: 'unchanged' });
  expect(await f.customer.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'customer_hard' } })).toEqual({ verdict: 'unchanged' });
  expect(await f.provider.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'login', priceCents: 50000 }] } })).toEqual({ verdict: 'unchanged' });
  expect(await f.finance.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'cap', newCapCents: 390000 } })).toEqual({ verdict: 'rejected', code: 'budget.below_committed', minAllowedCapCents: 400000 });
  expect(await f.finance.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'cap', newCapCents: 440000 } })).toMatchObject({ verdict: 'after', verdictAfter: { proposalVersion: 1, budgetCheck: 'budget.over', overByCents: 10000 } });
  await f.t.run(async ctx => {
    const proposal = (await ctx.db.get(old.proposalId))!;
    for (const role of ['finance', 'customer'] as const) await ctx.db.insert('approvals', { roomId: f.roomId, proposalId: old.proposalId, runId: old.runId, userId: f.users[role], role, kind: role === 'finance' ? 'budget' : 'terms', decision: 'approve', seq: 1, boundConstraintsVersion: 1, boundTermsKey: proposal.termsKey, decidedAt: Date.now() });
  });
  const before = await f.room(); const revisions = await f.revisions();
  const result = await f.finance.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'cap', newCapCents: 480000 } });
  expect(result).toEqual({ verdict: 'after', nextConstraintsVersion: 2, invalidatedApprovals: 2, willSupersedeRun: true, verdictAfter: { proposalVersion: 1, budgetCheck: 'pass' } });
  await f.t.run(async ctx => {
    const b = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', f.roomId).eq('role', 'customer')).order('desc').first())!;
    await ctx.db.patch(b._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['reports'], deadline: '2026-10-24' } });
  });
  expect(await f.finance.query(api.rooms.previewChange, { roomId: f.roomId, change: { kind: 'cap', newCapCents: 480000 } })).toEqual(result);
  expect(await f.room()).toEqual(before); expect(await f.revisions()).toEqual(revisions);
}

export async function answerBump() {
  const f = await fixture();
  const requestId = await f.t.run(async ctx => {
    const room = (await ctx.db.get(f.roomId))!;
    await ctx.db.patch(room.currentRunId!, { status: 'needs_input', activeTurnSeq: null });
    return ctx.db.insert('humanRequests', { roomId: f.roomId, runId: room.currentRunId!, kind: 'infeasible', toRole: 'finance', questionKey: 'raise_cap', constraintsVersion: 1, options: [{ optionKey: 'A', templateKey: 'raise_cap', effect: { type: 'raise_cap', amountCents: 510000 } }, { optionKey: 'B', templateKey: 'end_run', effect: { type: 'end_run' } }], status: 'open', expiresAt: Date.now() + 86400000, provenance: 'stub', createdAt: Date.now() });
  });
  const oldRun = (await f.room()).currentRunId!;
  const result = await f.finance.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' });
  expect(result).toMatchObject({ outcome: 'applied', effect: 'raise_cap', constraintsVersion: 2 });
  expect((await f.room()).currentRunId).not.toBe(oldRun);
  expect(await f.t.run(async ctx => ctx.db.get(requestId))).toMatchObject({ status: 'answered' });
  expect(await f.t.run(async ctx => ctx.db.get(oldRun))).toMatchObject({ status: 'superseded' });
  expect((await f.revisions())[1]?.sourceRefs).toEqual(expect.arrayContaining([{ kind: 'humanRequest', humanRequestId: requestId }]));
  await expect(f.customer.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' })).rejects.toThrow(/auth.role_forbidden/);
  expect(await f.finance.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' })).toEqual({ outcome: 'already_answered' });
}

export async function infeasibleAfterCap() {
  const f = await fixture(); await pending(f); await f.setCap(440000);
  const room = await f.room();
  const result = await f.t.run(async ctx => ({ run: await ctx.db.get(room.currentRunId!), requests: await ctx.db.query('humanRequests').withIndex('by_room_status', q => q.eq('roomId', f.roomId).eq('status', 'open')).collect() }));
  expect(result.run).toMatchObject({ status: 'needs_input', constraintsVersionAtStart: 2 }); expect(result.requests).toHaveLength(1); expect(result.requests[0]?.runId).toBe(room.currentRunId);
}
export async function lowerCapStillFits() {
  const f = await fixture(); const old = await pending(f); await f.setCap(480000); const room = await f.room();
  expect(await f.t.run(async ctx => ctx.db.get(room.currentRunId!))).toMatchObject({ status: 'pending_approval', currentProposalId: old.proposalId, constraintsVersionAtStart: 2 });
  expect(await f.t.run(async ctx => ctx.db.get(old.proposalId))).toMatchObject({ status: 'active', createdAtConstraintsVersion: 1 });
}
export async function directCapSupersedesRequest() {
  const f = await fixture();
  const requestId = await f.t.run(async ctx => {
    const room = (await ctx.db.get(f.roomId))!; await ctx.db.patch(room.currentRunId!, { status: 'needs_input', activeTurnSeq: null });
    return ctx.db.insert('humanRequests', { roomId: f.roomId, runId: room.currentRunId!, kind: 'infeasible', toRole: 'finance', questionKey: 'raise_cap', constraintsVersion: 1, options: [{ optionKey: 'A', templateKey: 'raise_cap', effect: { type: 'raise_cap', amountCents: 510000 } }], status: 'open', expiresAt: Date.now() + 86400000, provenance: 'stub', createdAt: Date.now() });
  });
  await f.setCap(510000);
  expect(await f.t.run(async ctx => ctx.db.get(requestId))).toMatchObject({ status: 'superseded', closedReason: 'constraints_changed' });
  await expect(f.finance.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' })).rejects.toThrow(/request.not_open/);
}

export async function projectionMatrix() {
  const f = await fixture();
  const { hardProjection } = await import('../../core/engine/rules');
  const { fields } = await import('../../core/scenarios/scope-change');
  const { loadRuleInput } = await import('../../convex/model/constraintInput');
  const projection = () => f.t.run(async ctx => hardProjection({ fields }, await loadRuleInput(ctx, f.roomId)));
  let previous = await projection(); let version = await f.cv();
  for (const change of [() => f.setCap(510000), () => f.confirmCustomer('2026-11-18'), () => f.confirmCustomer('2026-11-18', ['login', 'reports']), () => f.provider.mutation(api.catalog.confirm, { roomId: f.roomId, expectedConstraintsVersion: version, rows: [{ ...LOGIN, priceCents: 51000 }] })]) {
    await change(); const after = await projection(); expect(after).not.toBe(previous); expect(await f.cv()).toBe(version + 1); previous = after; version++;
    const revs = await f.revisions(); expect(revs.map(r => r.version)).toEqual(Array.from({ length: version }, (_, i) => i + 1));
  }
  const room = await f.room();
  await f.confirmCustomer('2026-11-18', ['login', 'reports'], 'only private notes');
  expect(await projection()).toBe(previous); expect(await f.cv()).toBe(version); expect((await f.room()).currentRunId).toBe(room.currentRunId);
}

export async function depthRollback() {
  const f = await fixture(); const before = await f.room(); const oldRevisions = await f.revisions();
  const transactionRows = () => f.t.run(async ctx => ({ runs: await ctx.db.query('runs').withIndex('by_room_runNo', q=>q.eq('roomId',f.roomId)).collect(), events: await ctx.db.query('events').withIndex('by_room_order', q=>q.eq('roomId',f.roomId)).collect() }));
  const beforeRows = await transactionRows();
  const {latestBrief}=await import('../../convex/model/common');
  const {makeConstraintTx}=await import('../../convex/model/constraints');
  const {openRoomTx}=await import('../../convex/lib/db');
  const { bump, withConstraintChange } = await import('../../convex/model/constraints');
  await expect(f.t.run(async ctx => {
    const facade=await openRoomTx(ctx,f.roomId,{allow:['open']});const tx = makeConstraintTx({...ctx,tx:facade}, f.roomId); const start = tx.startRun;
    tx.startRun = async args => { await start(args); await bump(tx, { cause: 'brief_confirmed', sourceRefs: [], depth: args.reactDepth, actorUserId: f.users.finance }); };
    await withConstraintChange(tx, { cause: 'brief_confirmed', actorUserId: f.users.finance }, async () => {
      const prior = (await latestBrief(ctx, f.roomId, 'finance'))!;
      const {insertBriefVersion}=await import('../../convex/model/briefs');const b=await insertBriefVersion(facade,{userId:f.users.finance},{role:'finance',hardFields:{schemaKey:'scope_change.finance.v1',capCents:510000},softFields:prior.softFields,disclosures:{},source:'form'});
      const briefId=b._id;
      return [{ kind: 'brief', briefId, role: 'finance', version: 2 }];
    });
  })).rejects.toThrow(/constraints.react_depth_exceeded/);
  expect(await f.room()).toEqual(before); expect(await f.revisions()).toEqual(oldRevisions); expect(await transactionRows()).toEqual(beforeRows);
  expect(await f.t.run(async ctx => ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', f.roomId).eq('role', 'finance')).collect())).toHaveLength(1);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'eventId', 'continueCursor', 'at', '_id', '_creationTime', 'roomId', 'runId', 'proposalId', 'userId', 'joinedAt', 'createdAt', 'startedAt', 'statusChangedAt', 'expiresAt', 'openedAt'].includes(key)).map(([key, child]) => [key, normalize(child)]));
  return value;
}
export async function privacyEquivalentChanges() {
  const results: unknown[] = [];
  for (const kind of ['setCap', 'finance_confirm', 'customer_confirm', 'raise_cap'] as const) {
    const f = await fixture();
    if (kind === 'setCap') await f.setCap(510000);
    if (kind === 'finance_confirm') await f.finance.mutation(api.briefs.confirm, { roomId: f.roomId, expectedConstraintsVersion: 1, hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 510000 }, softFields: { schemaKey: 'scope_change.finance.v1', notes: '' }, disclosures: {} });
    if (kind === 'customer_confirm') await f.confirmCustomer('2026-11-18');
    if (kind === 'raise_cap') {
      const requestId = await f.t.run(async ctx => {
        const room = (await ctx.db.get(f.roomId))!; await ctx.db.patch(room.currentRunId!, { status: 'needs_input', activeTurnSeq: null });
        return ctx.db.insert('humanRequests', { roomId: f.roomId, runId: room.currentRunId!, kind: 'infeasible', toRole: 'finance', questionKey: 'raise_cap', constraintsVersion: 1, options: [{ optionKey: 'A', templateKey: 'raise_cap', effect: { type: 'raise_cap', amountCents: 510000 } }], status: 'open', expiresAt: Date.now() + 86400000, provenance: 'stub', createdAt: Date.now() });
      });
      await f.finance.mutation(api.humanRequests.answer, { requestId, optionKey: 'A' });
    }
    const view = await f.provider.query(api.rooms.view, { roomId: f.roomId });
    const timeline = await f.provider.query(api.timeline.page, { roomId: f.roomId, paginationOpts: { numItems: 100, cursor: null } });
    expect(JSON.stringify({ view, timeline })).not.toMatch(/500000|510000|2026-11-18|2026-11-20|raise_cap|FINANCE_PRIVATE_CANARY/);
    results.push(normalize({ view, timeline }));
    const finance = await f.finance.query(api.timeline.page, { roomId: f.roomId, paginationOpts: { numItems: 100, cursor: null } });
    const customer = await f.customer.query(api.timeline.page, { roomId: f.roomId, paginationOpts: { numItems: 100, cursor: null } });
    const financeChange = finance?.page.find(e => e.type === 'constraints_changed');
    const customerChange = customer?.page.find(e => e.type === 'constraints_changed');
    const providerChange = timeline?.page.find(e => e.type === 'constraints_changed');
    expect(providerChange?.text).toBe('Constraints changed (v2)');
    expect(providerChange?.actorKind).toBe('system');expect(providerChange?.actorRole).toBe('system');
    if (kind === 'customer_confirm') {
      expect(financeChange?.text).toBe('Constraints changed (customer updated constraints, v2)');
      expect(customerChange?.text).toBe('Constraints changed (customer updated constraints, v2)');
    } else {
      expect(financeChange?.text).toContain('$5,000 → $5,100');
      expect(financeChange?.privateToYou).toBe(true);
      expect(customerChange?.text).toBe('Constraints changed (finance updated constraints, v2)');
      expect(JSON.stringify(customerChange)).not.toMatch(/500000|510000|\$5,000|\$5,100/);
    }
  }
  for (const result of results.slice(1)) expect(JSON.stringify(result)).toBe(JSON.stringify(results[0]));
}

export async function providerSnapshotIndependentOfCap() {
  const f = await fixture();
  const snapshot = () => f.t.run(async ctx => {
    const room = (await ctx.db.get(f.roomId))!;
    const turn = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', room.currentRunId!)).first();
    return turn?.candidateSnapshot;
  });
  const before = await snapshot(); expect(before?.length).toBeGreaterThan(0); await f.setCap(480000);
  expect(await f.cv()).toBe(2); expect(await snapshot()).toEqual(before);
}
export async function negotiatingCannotKeepActive() {
  const f = await fixture(); const old = await pending(f);
  await f.t.run(ctx => ctx.db.patch(old.runId, { status: 'negotiating' }));
  await f.setCap(510000); const room = await f.room();
  expect(await f.t.run(async ctx => ctx.db.get(old.proposalId))).toMatchObject({ status: 'stale' });
  expect(await f.t.run(async ctx => ctx.db.get(room.currentRunId!))).toMatchObject({ status: 'negotiating', constraintsVersionAtStart: 2 });
  expect(await f.t.run(async ctx => (await ctx.db.get(room.currentRunId!))?.currentProposalId)).toBeNull();
}
export async function staleHistoryNotRecomputed() {
  const f = await fixture(); const old = await pending(f); await f.setCap(440000);
  const first = await f.provider.query(api.rooms.view, { roomId: f.roomId });
  const oldHistory = first?.proposalHistory?.find(p => p.proposalId === old.proposalId);
  expect(oldHistory?.status).toBe('superseded'); expect(oldHistory).not.toHaveProperty('fit'); expect(oldHistory).not.toHaveProperty('checks');
  await f.setCap(430000);
  const second = await f.provider.query(api.rooms.view, { roomId: f.roomId });
  expect(second?.proposalHistory?.find(p => p.proposalId === old.proposalId)).toEqual(oldHistory);
}
