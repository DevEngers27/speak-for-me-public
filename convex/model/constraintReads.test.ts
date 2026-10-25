import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineInvariantError } from '@core/engine';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { modules } from '../../tests/convex-helpers/setup';
import type { Doc } from '../_generated/dataModel';
import { replayRuleInput } from './constraintReads';
import { evaluateProposal, loadRuleInput } from './constraintInput';
afterEach(() => vi.useRealTimers());

type Role = Doc<'members'>['role'];
export async function readFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const users = {} as Record<Role, Awaited<ReturnType<typeof ctx.db.insert<'users'>>>>;
    for (const role of ['customer', 'provider', 'finance'] as const) users[role] = await ctx.db.insert('users', { tokenIdentifier: `test|${role}`, displayName: role, isTestAccount: true, createdAt: 1, updatedAt: 1 });
    const roomId = await ctx.db.insert('rooms', { scenarioKey: 'scope_change', scenarioVersion: 1, title: 'Private test', timeZone: 'UTC', localDate: '2026-10-24', status: 'open', constraintsVersion: 1, nextProposalVersion: 2, nextRunNo: 2, writeSeq: 0, createdBy: users.customer, provenance: 'stub', createdAt: 1 });
    const refs: Doc<'constraintRevisions'>['sourceRefs'] = [];
    for (const role of ['customer', 'provider', 'finance'] as const) {
      await ctx.db.insert('members', { roomId, userId: users[role], role, displayName: role, joinedVia: 'creator', joinedAt: 1 });
      const hardFields: Doc<'briefs'>['hardFields'] = role === 'customer' ? { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login'], deadline: '2026-12-01' } : role === 'finance' ? { schemaKey: 'scope_change.finance.v1', capCents: 1000 } : { schemaKey: 'scope_change.provider.v1' };
      const softFields: Doc<'briefs'>['softFields'] = role === 'customer' ? { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes: '' } : role === 'finance' ? { schemaKey: 'scope_change.finance.v1', notes: '' } : { schemaKey: 'scope_change.provider.v1', notes: '' };
      const briefId = await ctx.db.insert('briefs', { roomId, role, version: 1, hardFields, softFields, disclosures: {}, source: 'form', confirmedBy: users[role], confirmedAt: 1, provenance: 'stub' });
      refs.push({ kind: 'brief', briefId, role, version: 1 });
    }
    const itemId = await ctx.db.insert('catalogItems', { roomId, itemKey: 'login', revision: 1, editNo: 0, status: 'confirmed', kind: 'item', title: 'Login', priceCents: 400, leadDays: 2, taskTemplates: [], createdBy: users.provider, confirmedBy: users.provider, confirmedAt: 1, provenance: 'stub', createdAt: 1 });
    refs.push({ kind: 'catalogItem', catalogItemId: itemId, itemKey: 'login', revision: 1 });
    const ledgerId = await ctx.db.insert('ledgerEntries', { roomId, kind: 'baseline', amountCents: 100, recordedByUserId: users.finance, provenance: 'stub', createdAt: 1 });
    refs.push({ kind: 'ledgerEntry', ledgerEntryId: ledgerId });
    const runId = await ctx.db.insert('runs', { roomId, runNo: 1, status: 'pending_approval', cause: 'room_opened', constraintsVersionAtStart: 1, agentMode: 'stub', roundNo: 1, maxRounds: 3, roundsExtended: false, activeTurnSeq: null, nextTurnSeq: 1, attemptCount: 0, maxAttempts: 18, reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 1000000, provenance: 'stub', startedAt: 1 });
    const proposalId = await ctx.db.insert('proposals', { roomId, runId, version: 1, origin: 'agent', authorRole: 'provider', candidateKey: 'login@', terms: { itemKeys: ['login'], modifiers: [], deliveryDate: '2026-10-26', amountCents: 400 }, termsKey: 'terms', lines: [{ itemKey: 'login', kind: 'item', revision: 1, title: 'Login', priceCents: 400, leadDays: 2 }], plannedTasks: [], requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }], createdAtConstraintsVersion: 1, status: 'active', statusChangedAt: 1, provenance: 'stub', createdAt: 1 });
    await ctx.db.patch(runId, { currentProposalId: proposalId }); await ctx.db.patch(roomId, { currentRunId: runId });
    await ctx.db.insert('constraintRevisions', { roomId, version: 1, previousVersion: 0, cause: 'room_opened', actorUserId: users.customer, sourceRefs: refs, localDate: '2026-10-24', createdAt: 1 });
    return { roomId, users, runId, proposalId, itemId };
  });
  const as = (role: Role) => t.withIdentity({ subject: role, issuer: 'test', tokenIdentifier: `test|${role}` });
  return { t, ids, as };
}

describe('W2-3 constraint reads', () => {
  for (const role of ['customer', 'provider', 'finance'] as const) for (const kind of ['cap', 'customer_hard', 'catalog'] as const) {
    it(`12.17 previewChange ${kind} by ${role}`, async () => {
      const { ids, as } = await readFixture();
      const change = kind === 'cap' ? { kind, newCapCents: 900 } : kind === 'customer_hard' ? { kind, deadline: '2026-12-02' } : { kind, rows: [{ itemKey: 'login', priceCents: 500 }] };
      const result = await as(role).query(api.rooms.previewChange, { roomId: ids.roomId, change });
      const owner = { cap: 'finance', customer_hard: 'customer', catalog: 'provider' }[kind];
      if (role !== owner) expect(result).toBeNull();
      else expect(result).toEqual(kind === 'cap' ? { verdict: 'after', nextConstraintsVersion: 2, invalidatedApprovals: 0, willSupersedeRun: true, verdictAfter: { proposalVersion: 1, budgetCheck: 'pass' } } : { verdict: 'recheck', nextConstraintsVersion: 2, invalidatedApprovals: 0, willSupersedeRun: true });
    });
  }
  it('12.17 unchanged projection ignores customer key order and missing catalog fields', async () => {
    const { ids, as } = await readFixture();
    expect(await as('customer').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'customer_hard', requiredItemKeys: ['login'], deadline: '2026-12-01' } })).toEqual({ verdict: 'unchanged' });
    expect(await as('provider').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'login' }] } })).toEqual({ verdict: 'unchanged' });
    expect(await as('provider').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'login', retire: true }] } })).toMatchObject({ verdict: 'recheck' });
    expect(await as('provider').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'new_item', priceCents: 10 }] } })).toMatchObject({ verdict: 'recheck' });
  });
  it('12.17 nonmember query returns null', async () => {
    const { t, ids } = await readFixture();
    expect(await t.query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents: 900 } })).toBeNull();
    expect(await t.withIdentity({ subject: 'outsider', issuer: 'test' }).query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents: 900 } })).toBeNull();
  });
  it('CC-22 preview returns unchanged, rejected, after-over, and recheck without writes', async () => {
    const { t, ids, as } = await readFixture();
    const before = await t.run(ctx => ctx.db.get(ids.roomId));
    const read = (newCapCents: number) => as('finance').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents } });
    expect(await read(1000)).toEqual({ verdict: 'unchanged' });
    expect(await read(99)).toEqual({ verdict: 'rejected', code: 'budget.below_committed', minAllowedCapCents: 100 });
    expect(await read(450)).toEqual({ verdict: 'after', nextConstraintsVersion: 2, invalidatedApprovals: 0, willSupersedeRun: true, verdictAfter: { proposalVersion: 1, budgetCheck: 'budget.over', overByCents: 50 } });
    expect(await t.run(ctx => ctx.db.get(ids.roomId))).toEqual(before);
    await t.run(ctx => ctx.db.patch(ids.runId, { status: 'canceled' }));
    expect(await read(900)).toEqual({ verdict: 'recheck', nextConstraintsVersion: 2, invalidatedApprovals: 0, willSupersedeRun: false });
    await t.run(ctx => ctx.db.patch(ids.roomId, { status: 'setup', constraintsVersion: 0 }));
    expect(await read(900)).toMatchObject({ verdict: 'recheck', nextConstraintsVersion: 1 });
  });
  it('CC-22 stale approval preview counts only current effective approvals', async () => {
    const { t, ids, as } = await readFixture();
    await t.run(async ctx => {
      for (const role of ['customer', 'provider', 'finance'] as const) await ctx.db.insert('approvals', { roomId: ids.roomId, proposalId: ids.proposalId, runId: ids.runId, userId: ids.users[role], role, kind: role === 'finance' ? 'budget' : 'terms', decision: 'approve', seq: 1, boundConstraintsVersion: role === 'finance' ? 0 : 1, boundTermsKey: 'terms', decidedAt: 1 });
      await ctx.db.insert('approvals', { roomId: ids.roomId, proposalId: ids.proposalId, runId: ids.runId, userId: ids.users.provider, role: 'provider', kind: 'terms', decision: 'withdraw', seq: 2, boundConstraintsVersion: 1, boundTermsKey: 'terms', decidedAt: 2 });
    });
    expect(await as('finance').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents: 900 } })).toMatchObject({ invalidatedApprovals: 1 });
  });
  it('TC-PRIV-13 perturb customer private fields leaves finance preview byte-identical', async () => {
    const { t, ids, as } = await readFixture();
    const read = () => as('finance').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents: 450 } });
    const before = JSON.stringify(await read());
    await t.run(async ctx => {
      const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', ids.roomId).eq('role', 'customer')).first();
      if (!brief) throw new Error('fixture');
      await ctx.db.patch(brief._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['unknown'], deadline: '2026-10-24' }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: ['other'], notes: 'CANARY_PRIVATE' } });
    });
    expect(JSON.stringify(await read())).toBe(before);
  });
  it('CC-16 replay retains historical sources and localDate, not latest source rows', async () => {
    const { t, ids } = await readFixture();
    const atV1 = await t.run(ctx => loadRuleInput(ctx, ids.roomId));
    const replayV1 = await t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion: 1, localDate: '2026-10-24' }));
    expect(replayV1).toEqual(atV1);
    await t.run(async ctx => {
      const old = await ctx.db.get(ids.itemId); if (!old) throw new Error('fixture');
      const { _id: _ignoredId, _creationTime: _ignoredTime, ...row } = old; void _ignoredId; void _ignoredTime;
      const catalogItemId = await ctx.db.insert('catalogItems', { ...row, revision: 2, priceCents: 600 });
      await ctx.db.insert('constraintRevisions', { roomId: ids.roomId, version: 2, previousVersion: 1, cause: 'catalog_changed', sourceRefs: [{ kind: 'catalogItem', catalogItemId, itemKey: 'login', revision: 2 }], localDate: '2026-10-25', createdAt: 2 });
      await ctx.db.patch(ids.roomId, { localDate: '2026-10-25', constraintsVersion: 2 });
    });
    expect(await t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion: 1, localDate: '2026-10-24' }))).toEqual(atV1);
    expect(await t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion: 2, localDate: '2026-10-25' }))).toEqual(await t.run(ctx => loadRuleInput(ctx, ids.roomId)));
    await expect(t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion: 0, localDate: '2026-10-24' }))).rejects.toThrow('replay.unknown_version');
    await expect(t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion: 3, localDate: '2026-10-24' }))).rejects.toThrow('replay.unknown_version');
  });
});

describe('W2-3 fix round 2 read regressions', () => {
  it('CC-16 F2 replay ref preserves old evaluation after a no-flip clock roll at the same cv', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.UTC(2026, 9, 25, 1));
    const { t, ids } = await readFixture();
    const oldInput = await t.run(ctx => loadRuleInput(ctx, ids.roomId));
    const proposal = await t.run(ctx => ctx.db.get(ids.proposalId));
    const terms = { ...proposal!.terms, amountCents: oldInput.catalog[0]!.priceCents,
      deliveryDate: proposal!.terms.deliveryDate as typeof oldInput.localDate };
    const candidate = { terms, lines: oldInput.catalog };
    const oldEvaluation = evaluateProposal(oldInput, candidate);
    await t.mutation(internal.clock.rollLocalDate, { roomId: ids.roomId });
    expect(await t.run(ctx => ctx.db.get(ids.roomId))).toMatchObject({ constraintsVersion: 1, localDate: '2026-10-25' });
    const historical = await t.query(internal.constraints.replayRuleInput, { roomId: ids.roomId, ref: { constraintsVersion: 1, localDate: '2026-10-24' } });
    expect(historical).toEqual(oldInput);
    expect(evaluateProposal(historical as unknown as typeof oldInput, candidate)).toEqual(oldEvaluation);
    const current = await t.query(internal.constraints.replayRuleInput, { roomId: ids.roomId, ref: { constraintsVersion: 1, localDate: '2026-10-25' } });
    expect(current).toEqual(await t.run(ctx => loadRuleInput(ctx, ids.roomId)));
    expect(current.localDate).not.toBe(historical.localDate);
    expect(await t.run(ctx => ctx.db.query('constraintRevisions').collect())).toHaveLength(1);
  });

  it('CC-16 F2 unknown replay versions throw EngineInvariantError and cv-only args are rejected', async () => {
    const { t, ids } = await readFixture();
    for (const constraintsVersion of [0, 2, -1, 1.5]) {
      await expect(t.run(ctx => replayRuleInput(ctx, ids.roomId, { constraintsVersion, localDate: '2026-10-24' }))).rejects.toBeInstanceOf(EngineInvariantError);
      await expect(t.query(internal.constraints.replayRuleInput, { roomId: ids.roomId, ref: { constraintsVersion, localDate: '2026-10-24' } })).rejects.toThrow('replay.unknown_version');
    }
    const legacyArgs = { roomId: ids.roomId, version: 1 };
    await expect(t.query(internal.constraints.replayRuleInput, legacyArgs as never)).rejects.toThrow();
  });

  for (const [runStatus, proposalStatus] of [
    ['negotiating', 'rejected'], ['pending_approval', 'stale'], ['pending_approval', 'superseded'],
    ['ended_no_agreement', 'active'], ['canceled', 'active'], ['superseded', 'stale'],
  ] as const) {
    it(`CC-22 F4 linked ${proposalStatus} proposal on ${runStatus} run is not an active preview`, async () => {
      const { t, ids, as } = await readFixture();
      await t.run(async ctx => {
        await ctx.db.patch(ids.runId, { status: runStatus });
        await ctx.db.patch(ids.proposalId, { status: proposalStatus });
        await ctx.db.insert('approvals', { roomId: ids.roomId, proposalId: ids.proposalId, runId: ids.runId,
          userId: ids.users.customer, role: 'customer', kind: 'terms', decision: 'approve', seq: 1,
          boundConstraintsVersion: 1, boundTermsKey: 'terms', decidedAt: 1 });
      });
      const room = await t.run(ctx => ctx.db.get(ids.roomId));
      expect(await as('finance').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'cap', newCapCents: 900 } })).toEqual({
        verdict: 'recheck', nextConstraintsVersion: 2, invalidatedApprovals: 0,
        willSupersedeRun: ['negotiating', 'pending_approval'].includes(runStatus),
      });
      expect(await t.run(ctx => ctx.db.get(ids.runId))).toMatchObject({ currentProposalId: ids.proposalId });
      expect(await t.run(ctx => ctx.db.get(ids.roomId))).toEqual(room);
    });
  }

  it('CC-22 F4 hard projection comparison handles key order and unchanged catalog revisions', async () => {
    const { t, ids, as } = await readFixture();
    await t.run(async ctx => {
      const brief = (await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', ids.roomId).eq('role', 'customer')).first())!;
      await ctx.db.patch(brief._id, { hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['login', 'reports'], deadline: '2026-12-01' } });
    });
    expect(await as('customer').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'customer_hard', requiredItemKeys: ['reports', 'login'] } })).toEqual({ verdict: 'unchanged' });
    expect(await as('provider').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'login', priceCents: 400, leadDays: 2, retire: false }] } })).toEqual({ verdict: 'unchanged' });
    expect(await as('provider').query(api.rooms.previewChange, { roomId: ids.roomId, change: { kind: 'catalog', rows: [{ itemKey: 'login', leadDays: 3 }] } })).toMatchObject({ verdict: 'recheck' });
  });
});
