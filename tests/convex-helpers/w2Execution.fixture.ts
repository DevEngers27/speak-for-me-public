import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../../convex/schema';
import { modules, registerRoomInvariantAudit } from './setup';
import { canonicalJson, candidateKey as makeCandidateKey } from '@core/engine';
import type { DecisionArgs } from '../../convex/approvals';
import type { Id } from '../../convex/_generated/dataModel';
export const recordRef = makeFunctionReference<'mutation', DecisionArgs, { status: string; executionId?: Id<'executions'>; missingRoles?: string[]; alreadyExecuted?: boolean }>('approvals:record');
export const invariantsRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, { code: string; check: string }[]>('executions:checkInvariants');
export async function harness() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async ctx => {
    const users = {} as Record<'customer'|'provider'|'finance', Id<'users'>>;
    for (const role of ['customer','provider','finance'] as const) users[role] = await ctx.db.insert('users', { tokenIdentifier: `https://w2.test|${role}`, displayName: role, isTestAccount: true, createdAt: 1, updatedAt: 1 });
    const roomId = await ctx.db.insert('rooms', { scenarioKey: 'scope_change', scenarioVersion: 1, title: 'Scope', timeZone: 'UTC', localDate: '2026-10-24', status: 'open', constraintsVersion: 1, nextProposalVersion: 2, nextRunNo: 2, writeSeq: 0, createdBy: users.customer, provenance: 'live', createdAt: 1, openedAt: 1 });
    for (const role of ['customer','provider','finance'] as const) await ctx.db.insert('members', { roomId, userId: users[role], role, displayName: role, joinedVia: 'creator', joinedAt: 1 });
    await ctx.db.insert('briefs', { roomId, role: 'customer', version: 1, hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['scope_item'], deadline: '2026-11-24' }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: ['extra_item'], notes: 'CUSTOMER_CANARY_731' }, disclosures: {}, source: 'form', confirmedBy: users.customer, confirmedAt: 1, provenance: 'live' });
    await ctx.db.insert('briefs', { roomId, role: 'provider', version: 1, hardFields: { schemaKey: 'scope_change.provider.v1' }, softFields: { schemaKey: 'scope_change.provider.v1', notes: 'PROVIDER_CANARY_731' }, disclosures: {}, source: 'form', confirmedBy: users.provider, confirmedAt: 1, provenance: 'live' });
    await ctx.db.insert('briefs', { roomId, role: 'finance', version: 1, hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 480_000 }, softFields: { schemaKey: 'scope_change.finance.v1', notes: 'FINANCE_CANARY_731' }, disclosures: {}, source: 'form', confirmedBy: users.finance, confirmedAt: 1, provenance: 'live' });
    const baselineId = await ctx.db.insert('ledgerEntries', { roomId, kind: 'baseline', amountCents: 400_000, recordedByUserId: users.finance, provenance: 'live', createdAt: 1 });
    const initialBriefs = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId)).collect();
    const lines = [{ itemKey: 'scope_item', kind: 'item' as const, revision: 1, title: 'Scope item', priceCents: 80_000, leadDays: 0 }];
    for (const line of [...lines, { itemKey: 'extra_item', kind: 'item' as const, revision: 1, title: 'Extra item', priceCents: 10_000, leadDays: 0 }]) await ctx.db.insert('catalogItems', { ...line, roomId, status: 'confirmed', editNo: 0, taskTemplates: [{ title: 'Deliver', assigneeRole: 'provider' }], confirmedBy: users.provider, confirmedAt: 1, createdBy: users.provider, provenance: 'live', createdAt: 1 });
    const initialCatalog = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', roomId)).collect();
    await ctx.db.insert('constraintRevisions', { roomId, version: 1, previousVersion: 0, cause: 'room_opened', sourceRefs: [...initialBriefs.map(brief => ({ kind: 'brief' as const, briefId: brief._id, role: brief.role, version: brief.version })), ...initialCatalog.map(row => ({kind:'catalogItem' as const,catalogItemId:row._id,itemKey:row.itemKey,revision:row.revision})), {kind:'ledgerEntry',ledgerEntryId:baselineId}], localDate: '2026-10-24', createdAt: 1 });
    const runId = await ctx.db.insert('runs', { roomId, runNo: 1, status: 'pending_approval', cause: 'room_opened', constraintsVersionAtStart: 1, agentMode: 'stub', roundNo: 1, maxRounds: 3, roundsExtended: false, activeTurnSeq: null, nextTurnSeq: 1, attemptCount: 0, maxAttempts: 18, reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 1_000_000, provenance: 'live', startedAt: 1 });
    const terms = { itemKeys: ['scope_item'], modifiers: [], amountCents: 80_000, deliveryDate: '2026-10-24' };
    const candidateKey = makeCandidateKey(terms.itemKeys, terms.modifiers);
    const proposalId = await ctx.db.insert('proposals', { roomId, runId, version: 1, origin: 'human_choice', authorRole: 'customer', chosenBy: users.customer, candidateKey, terms, termsKey: canonicalJson(terms), lines, plannedTasks: [{ itemKey: 'scope_item', templateIndex: 0, title: 'Frozen deliver', assigneeRole: 'provider', dueDate: terms.deliveryDate }], requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }], createdAtConstraintsVersion: 1, status: 'active', statusChangedAt: 1, provenance: 'live', createdAt: 1 });
    await ctx.db.patch(runId, { currentProposalId: proposalId });
    await ctx.db.patch(roomId, { currentRunId: runId });
    return { roomId, runId, proposalId, users, candidateKey, termsKey: canonicalJson(terms) };
  });
  const audit = registerRoomInvariantAudit(String(fixture.roomId), async () => {
    const rooms = await t.run(ctx => ctx.db.query('rooms').collect());
    return (await Promise.all(rooms.map(room => t.query(invariantsRef, { roomId: room._id })))).flat();
  });
  const as = (role: 'customer'|'provider'|'finance') => t.withIdentity({ tokenIdentifier: `https://w2.test|${role}`, subject: role, issuer: 'https://w2.test' });
  const args = (decision: DecisionArgs['decision'] = 'approve', patch: Partial<DecisionArgs> = {}): DecisionArgs => ({ proposalId: fixture.proposalId, decision, expectedConstraintsVersion: 1, expectedTermsKey: fixture.termsKey, reasonKey: decision === 'reject' ? 'other' : null, note: null, ...patch });
  const approve = (role: 'customer'|'provider'|'finance', patch: Partial<DecisionArgs> = {}) => as(role).mutation(recordRef, args('approve', patch));
  const execute = async () => { await approve('customer'); await approve('provider'); return approve('finance'); };
  return { t, ...fixture, as, args, approve, execute, expectFindings: audit.expectFindings };
}
