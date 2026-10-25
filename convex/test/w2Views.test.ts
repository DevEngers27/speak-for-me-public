import {api} from '../_generated/api';
import {bump} from '../../tests/convex-helpers/w2Constraint.fixture';
import { describe, expect, it, vi } from 'vitest';
import * as approvalHelpers from '../model/approvalHelpers';
import * as decisionViews from '../model/views/decisionView';
import { makeFunctionReference } from 'convex/server';
import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { roomViewV, proposalDetailV, executionViewV, inboxCardV } from '../model/views/roomView';
import { assertCatalogNotDelivered } from '../model/followUp';
import { harness, recordRef } from '../../tests/convex-helpers/w2Execution.fixture';
const pingRef = makeFunctionReference<'query', Record<string, never>, { ok: boolean }>('health:ping');
const whoamiRef = makeFunctionReference<'query', Record<string, never>, { status: string; displayName?: string } | null>('users:viewer');
const viewRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof roomViewV> | null>('rooms:view');
const proposalRef = makeFunctionReference<'query', { proposalId: Id<'proposals'> }, Infer<typeof proposalDetailV> | null>('proposals:get');
const executionRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof executionViewV> | null>('executions:forRoom');
const inboxRef = makeFunctionReference<'query', { paginationOpts: { numItems: number; cursor: null } }, { page: Infer<typeof inboxCardV>[]; isDone: boolean; continueCursor: string } | null>('rooms:listMine');
const followUpRef = makeFunctionReference<'mutation', { executionId: Id<'executions'> }, { roomId: Id<'rooms'>; created: boolean }>('rooms:startFollowUp');
const markDoneRef = makeFunctionReference<'mutation', { taskId: Id<'tasks'> }, { status: string }>('tasks:markDone');

describe('W2-2 decision views and execution lifecycle', () => {
  it('13.16 completesSet truth table and 12.17 equality is within', async () => {
    const h = await harness();
    const initial = await h.as('finance').query(viewRef, { roomId: h.roomId });
    expect(initial?.currentProposal?.myAction.completesSet).toBe(false);
    expect(initial?.budget).toMatchObject({ visibility: 'finance', proposalCents: 80_000, totalAfterCents: 480_000, overByCents: 0, status: 'within' });
    await h.approve('customer');
    expect((await h.as('finance').query(viewRef, { roomId: h.roomId }))?.currentProposal?.myAction.completesSet).toBe(false);
    await h.approve('provider');
    const last = await h.as('finance').query(viewRef, { roomId: h.roomId });
    expect(last?.currentProposal?.myAction.completesSet).toBe(true);
    expect((await h.as('customer').query(viewRef, { roomId: h.roomId }))?.currentProposal?.myAction.canWithdraw).toBe(true);
    await h.approve('finance');
    const written = await h.as('finance').query(executionRef, { roomId: h.roomId });
    expect(written?.tasks).toHaveLength(last!.currentProposal!.recordsPreview.taskCount);
    expect(written?.changeOrder.terms.amountCents).toBe(last!.currentProposal!.recordsPreview.commitCents);
    expect(written?.changeOrder.number).toBe(last!.currentProposal!.recordsPreview.changeOrderNumber);
  });
  it('TC-PRIV-08 / TC-PRIV-24 provider gets fit only and no budget, notes or user ids', async () => {
    const h = await harness();
    await h.approve('customer', { note: 'PRIVATE_DECISION_710' });
    const view = await h.as('provider').query(viewRef, { roomId: h.roomId });
    expect(view?.currentProposal?.fit).toEqual({ audience: 'provider', value: 'ok' });
    expect(view?.budget).toEqual({ visibility: 'none' });
    expect(view?.currentProposal?.notIncludedForMe).toBeNull();
    const detail = await h.as('provider').query(proposalRef, { proposalId: h.proposalId });
    expect(detail?.decisions[0]).toMatchObject({ isMe: false, note: null });
    const customerDetail = await h.as('customer').query(proposalRef, { proposalId: h.proposalId });
    expect(customerDetail?.decisions[0]?.note).toBe('PRIVATE_DECISION_710');
    expect(JSON.stringify([view,detail])).not.toMatch(/PRIVATE_DECISION_710|CUSTOMER_CANARY_731|FINANCE_CANARY_731|PROVIDER_CANARY_731|userId|hardFields|softFields/);
  });
  it('TC-EXE-06 / TC-EXE-11 [serial] follow-up is idempotent, carries seats and only undelivered drafts', async () => {
    const h = await harness();
    const executed = await h.execute();
    expect(executed.executionId).toBeDefined();
    const first = await h.as('customer').mutation(followUpRef, { executionId: executed.executionId! });
    expect(first.created).toBe(true);
    expect(await h.as('provider').mutation(followUpRef, { executionId: executed.executionId! })).toEqual({ roomId: first.roomId, created: false });
    await h.t.run(async ctx => {
      const rows = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', first.roomId)).collect();
      expect(rows.map(row => [row.itemKey,row.status,row.revision,row.editNo])).toEqual([['extra_item','draft',0,0]]);
      expect(await ctx.db.query('members').withIndex('by_room_role', q => q.eq('roomId', first.roomId)).collect()).toHaveLength(3);
      expect(await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', first.roomId)).collect()).toHaveLength(0);
      const room = await ctx.db.get(first.roomId);
      await expect(assertCatalogNotDelivered(ctx, room!, ['scope_item'])).rejects.toThrow(/item.duplicate/);
    });
    const finance = await h.as('finance').query(viewRef, { roomId: first.roomId });
    expect(finance?.budget).toMatchObject({ baselineSuggestionCents: 480_000, baselineRecorded: false });
    expect(finance?.followUpOf?.deliveredItems).toEqual([{ itemKey: 'scope_item', title: 'Scope item' }]);
    expect((await h.as('provider').query(viewRef, { roomId: first.roomId }))?.budget).toEqual({ visibility: 'none' });
  });
  it('12.16 markDone by a non-assignee → auth.role_forbidden; own completion is idempotent', async () => {
    const h = await harness();
    await h.execute();
    const records = await h.as('provider').query(executionRef, { roomId: h.roomId });
    const taskId = records!.tasks[0]!.taskId;
    const before = await h.t.run(async ctx => (await ctx.db.query('events').collect()).length);
    await expect(h.as('customer').mutation(markDoneRef, { taskId })).rejects.toThrow(/auth.role_forbidden/);
    expect(await h.t.run(async ctx => (await ctx.db.query('events').collect()).length)).toBe(before);
    expect(await h.as('provider').mutation(markDoneRef, { taskId })).toEqual({ status: 'done' });
    expect(await h.as('provider').mutation(markDoneRef, { taskId })).toEqual({ status: 'unchanged' });
    expect((await h.as('provider').query(executionRef, { roomId: h.roomId }))?.tasks[0]?.canMarkDone).toBe(false);
  });
  it('TC-AUTH-07 query matrix: anonymous and outsider get null for every W2-2 public query', async () => {
    const h = await harness();
    const outside = h.t.withIdentity({ tokenIdentifier: 'https://w2.test|outside', subject: 'outside', issuer: 'https://w2.test' });
    for (const client of [h.t, outside]) {
      expect(await client.query(viewRef, { roomId: h.roomId })).toBeNull();
      expect(await client.query(proposalRef, { proposalId: h.proposalId })).toBeNull();
      expect(await client.query(executionRef, { roomId: h.roomId })).toBeNull();
      expect(await client.query(inboxRef, { paginationOpts: { numItems: 20, cursor: null } })).toBeNull();
    }
  });
  it('TC-VER-13 / 08 I21 retained proposal reapproval notice; historical provider stale is superseded without fit', async () => {
    const h = await harness();
    await h.approve('customer');
    await h.t.run(ctx => ctx.db.patch(h.roomId, { constraintsVersion: 2 }));
    const inbox = await h.as('customer').query(inboxRef, { paginationOpts: { numItems: 20, cursor: null } });
    expect(inbox?.page[0]?.notice).toBe('approval_no_longer_applies');
    const current = await h.as('customer').query(viewRef, { roomId: h.roomId });
    expect(current?.currentProposal?.approvals.find(slot => slot.isMe)?.state).toBe('stale_approve');
    await h.t.run(ctx => ctx.db.patch(h.proposalId, { status: 'stale' }));
    const history = await h.as('provider').query(proposalRef, { proposalId: h.proposalId });
    expect(history?.card.status).toBe('superseded');
    expect(history?.card.summaryText).not.toContain('stale');
    expect(history?.card.summaryText).toContain('superseded');
    expect(history?.card).not.toHaveProperty('fit');
  });
  it('TC-PRIV-09 execution historical disclosure cannot be backfilled by a later share row', async () => {
    const h = await harness();
    await h.execute();
    await h.t.run(async ctx => {
      await ctx.db.insert('sharedFacts', { roomId: h.roomId, fromRole: 'finance', field: 'committedCents', seq: 1, value: { kind: 'cents', cents: 480_000 }, audience: ['customer'], briefVersion: 1, source: 'manual', createdBy: h.users.finance, provenance: 'live', createdAt: Date.now() + 1 });
    });
    expect((await h.as('customer').query(executionRef, { roomId: h.roomId }))?.changeOrder.amountChain).toMatchObject({ committedAfterCents: null, thisChangeCents: 80000 });
    expect((await h.as('provider').query(executionRef, { roomId: h.roomId }))?.changeOrder.amountChain).toBeNull();
    expect((await h.as('finance').query(executionRef, { roomId: h.roomId }))?.changeOrder.amountChain).toMatchObject({ committedAfterCents: 480_000 });
  });
});

import { ACTION_MATRIX } from '../../tests/convex-helpers/actionMatrix';
import { findCanaries } from '../../tests/helpers/convex';

describe('W2-2 authorization and historical disclosure close-out', () => {
  it('TC-AUTH-07 complete ACTION_MATRIX: member queries, mutations, assignee and public health', async () => {
    expect(ACTION_MATRIX.map(row => row.name)).toEqual(expect.arrayContaining(['approvals.record','health.ping','users.viewer','executions.forRoom','proposals.get','rooms.listMine','rooms.startFollowUp','rooms.view','tasks.markDone']));
    const h = await harness();
    const executed = await h.execute();
    const task = await h.t.run(async ctx => (await ctx.db.query('tasks').collect())[0]!);
    const outside = h.t.withIdentity({ tokenIdentifier: 'https://w2.test|outside', issuer: 'https://w2.test', subject: 'outside' });
    await h.t.run(ctx => ctx.db.insert('users', { tokenIdentifier: 'https://w2.test|outside', displayName: 'outside', isTestAccount: true, createdAt: 1, updatedAt: 1 }));
    for (const [client,code] of [[h.t,'auth.unauthenticated'],[outside,'auth.not_member']] as const) {
      await expect(client.mutation(followUpRef, { executionId: executed.executionId! })).rejects.toThrow(code);
      await expect(client.mutation(markDoneRef, { taskId: task._id })).rejects.toThrow(code);
      await expect(client.mutation(recordRef, h.args())).rejects.toThrow(code);
    }
    for (const role of ['customer','provider','finance'] as const) {
      const as = h.as(role);
      expect(await as.query(viewRef, { roomId: h.roomId })).not.toBeNull();
      expect(await as.query(proposalRef, { proposalId: h.proposalId })).not.toBeNull();
      expect(await as.query(executionRef, { roomId: h.roomId })).not.toBeNull();
      expect((await as.query(inboxRef, { paginationOpts: { numItems: 20, cursor: null } }))?.page.some(card => card.roomId === h.roomId)).toBe(true);
      expect((await as.mutation(followUpRef, { executionId: executed.executionId! })).roomId).toBeDefined();
      if (role === 'provider') expect(await as.mutation(markDoneRef, { taskId: task._id })).toEqual({ status: 'done' });
      else await expect(as.mutation(markDoneRef, { taskId: task._id })).rejects.toThrow('auth.role_forbidden');
    }
    expect(await h.t.query(pingRef, {})).toMatchObject({ ok: true });
    expect(await h.t.query(whoamiRef, {})).toBeNull();
    expect(await h.as('customer').query(whoamiRef, {})).toMatchObject({ status: 'ready', displayName: 'customer' });
  });
  it('TC-PRIV-06 / TC-PRIV-14 / TC-PRIV-23 every public query output excludes other-side canaries', async () => {
    const h = await harness();
    await h.approve('customer', { note: 'CUSTOMER_DECISION_CANARY_981' });
    for (const role of ['customer','provider','finance'] as const) {
      const outputs = [await h.as(role).query(viewRef, { roomId: h.roomId }), await h.as(role).query(proposalRef, { proposalId: h.proposalId }), await h.as(role).query(executionRef, { roomId: h.roomId }), await h.as(role).query(inboxRef, { paginationOpts: { numItems: 20, cursor: null } }), await h.as(role).query(pingRef, {})];
      const forbidden = ['CUSTOMER_CANARY_731','PROVIDER_CANARY_731','FINANCE_CANARY_731', ...(role === 'customer' ? [] : ['CUSTOMER_DECISION_CANARY_981'])];
      expect(findCanaries(outputs, forbidden)).toEqual([]);
      expect(JSON.stringify(outputs)).not.toMatch(/tokenIdentifier|userId|hardFields|softFields|commitTs|restrictedRef/);
    }
  });
  it('TC-AUTH-09 markDone anonymous, missing task, and room-state failures leave counts unchanged [construct]', async () => {
    const h = await harness();
    await h.execute();
    const task = await h.t.run(async ctx => (await ctx.db.query('tasks').collect())[0]!);
    await expect(h.t.mutation(markDoneRef, { taskId: task._id })).rejects.toThrow('auth.unauthenticated');
    await h.t.run(ctx => ctx.db.patch(h.roomId, { status: 'open' }));
    const before = await h.t.run(async ctx => (await ctx.db.query('events').collect()).length);
    await expect(h.as('provider').mutation(markDoneRef, { taskId: task._id })).rejects.toThrow('run.invalid_state');
    expect(await h.t.run(async ctx => (await ctx.db.query('events').collect()).length)).toBe(before);
    expect((await h.t.run(ctx => ctx.db.get(task._id)))?.status).toBe('open');
    h.expectFindings(['R11']);
  });
  it('TC-EXE-06 follow-up wrong-state and room-create rate failures are atomic [construct]', async () => {
    const h = await harness();
    const execution = await h.execute();
    await h.t.run(ctx => ctx.db.patch(h.roomId, { status: 'open' }));
    await expect(h.as('customer').mutation(followUpRef, { executionId: execution.executionId! })).rejects.toThrow('run.invalid_state');
    await h.t.run(async ctx => {
      await ctx.db.patch(h.roomId, { status: 'executed' });
      const room = await ctx.db.get(h.roomId);
      for (let i=0;i<10;i++) await ctx.db.insert('rooms', { scenarioKey: room!.scenarioKey, scenarioVersion: 1, title: 'Rate fixture', timeZone: 'UTC', localDate: room!.localDate, status: 'setup', constraintsVersion: 0, nextProposalVersion: 1, nextRunNo: 1, writeSeq: 0, createdBy: h.users.customer, provenance: 'live', createdAt: 1 });
    });
    await expect(h.as('customer').mutation(followUpRef, { executionId: execution.executionId! })).rejects.toThrow('run.rate_limited');
    expect(await h.t.run(async ctx => (await ctx.db.query('rooms').withIndex('by_followsExecutionId', q => q.eq('followsExecutionId', execution.executionId!)).collect()).length)).toBe(0);
  });
  it('PV-12 execution share honors the last pre-execution audience, withdrawal and brief version', async () => {
    for (const mode of ['shared','withdrawn','old_version'] as const) {
      const h = await harness();
      await h.t.run(async ctx => {
        await ctx.db.insert('sharedFacts', { roomId: h.roomId, fromRole: 'finance', field: 'committedCents', seq: 1, value: { kind: 'cents', cents: 400_000 }, audience: ['customer'], briefVersion: mode === 'old_version' ? 0 : 1, source: 'manual', createdBy: h.users.finance, provenance: 'live', createdAt: 1 });
        if (mode === 'withdrawn') await ctx.db.insert('sharedFacts', { roomId: h.roomId, fromRole: 'finance', field: 'committedCents', seq: 2, value: null, audience: [], briefVersion: 1, source: 'manual', createdBy: h.users.finance, provenance: 'live', createdAt: 1 });
      });
      await h.execute();
      const result = await h.as('customer').query(executionRef, { roomId: h.roomId });
      if (mode === 'shared') expect(result?.changeOrder.amountChain).toMatchObject({ baselineCents: 400_000, committedAfterCents: 480_000 });
      else expect(result?.changeOrder.amountChain).toMatchObject({ committedAfterCents: null, thisChangeCents: 80000 });
    }
  });
});


describe('W2-2 rules-aware controls and post-execution budget', () => {
  it('12.17 executed proposal is not counted as a second pending commitment', async () => {
    const h = await harness();
    await h.execute();
    const view = await h.as('finance').query(viewRef, { roomId: h.roomId });
    expect(view?.budget).toMatchObject({ visibility: 'finance', committedCents: 480_000, headroomCents: 0, proposalCents: null, totalAfterCents: null, overByCents: null, status: 'no_proposal' });
    expect(view?.currentProposal?.allApproved).toBe(true);
    expect(view?.execution?.approvalsSnapshot).toHaveLength(3);
  });
  it('13.8 blocked card disables deciding while preserving a current approval withdrawal', async () => {
    const h = await harness();
    await h.approve('customer');
    await h.t.run(async ctx => {
      const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).first();
      await ctx.db.patch(brief!._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 479_999 } });
    });
    const customer = await h.as('customer').query(viewRef, { roomId: h.roomId });
    expect(customer?.currentProposal?.myAction).toMatchObject({ canDecide: false, disabledReasonCode: 'approval.not_executable', canWithdraw: true });
    const provider = await h.as('provider').query(viewRef, { roomId: h.roomId });
    expect(provider?.currentProposal?.fit).toEqual({ audience: 'provider', value: 'blocked' });
    expect(provider?.currentProposal?.myAction.canDecide).toBe(false);
    expect((await h.as('finance').query(viewRef, { roomId: h.roomId }))?.budget).toMatchObject({ status: 'over', overByCents: 1 });
  });
});

describe('W2-2 privacy perturbations', () => {
  it('TC-PRIV-24 provider query bytes stay unchanged when private odd-cent budget inputs change [construct]', async () => {
    const h = await harness();
    const queryAll = async () => [await h.as('provider').query(viewRef, { roomId: h.roomId }), await h.as('provider').query(proposalRef, { proposalId: h.proposalId }), await h.as('provider').query(executionRef, { roomId: h.roomId }), await h.as('provider').query(inboxRef, { paginationOpts: { numItems: 20, cursor: null } })];
    const before = await queryAll();
    await h.t.run(async ctx => {
      const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId).eq('role', 'finance')).first();
      await ctx.db.patch(brief!._id, { hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 482_137 } });
      const baseline = await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', h.roomId).eq('kind', 'baseline')).first();
      await ctx.db.patch(baseline!._id, { amountCents: 401_791 });
    });
    const after = await queryAll();
    expect(after).toEqual(before);
    expect(findCanaries(after, [482_137, 401_791, 80_346])).toEqual([]);
  });
});

describe('W2-2 follow-up chain execution', () => {
  it('TC-EXE-11 [serial] follow-up commits only remaining scope as CO-2 with a newly confirmed baseline', async () => {
    const h = await harness(); const first = await h.execute();
    const next = await h.as('customer').mutation(followUpRef, { executionId: first.executionId! });
    // TEST-ONLY W2-1/W2-4 setup seam: confirmation and run construction belong to those lanes.
    const proposal = await h.t.run(async ctx => {
      const room = (await ctx.db.get(next.roomId))!;
      const draft = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', next.roomId)).unique();
      expect(draft?.itemKey).toBe('extra_item');
      await ctx.db.patch(draft!._id, { status: 'confirmed', revision: 1, confirmedBy: h.users.provider, confirmedAt: 1 });
      const briefs = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', h.roomId)).collect();
      for (const b of briefs) {
        const { _id, _creationTime, ...fields } = b; void _id; void _creationTime;
        await ctx.db.insert('briefs', { ...fields, roomId: next.roomId, hardFields: b.role === 'customer' ? { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['extra_item'], deadline: room.localDate } : b.role === 'finance' ? { schemaKey: 'scope_change.finance.v1', capCents: 490000 } : b.hardFields });
      }
      await ctx.db.insert('ledgerEntries', { roomId: next.roomId, kind: 'baseline', amountCents: 480000, recordedByUserId: h.users.finance, provenance: 'live', createdAt: 1 });
      const oldRun = (await ctx.db.get(h.runId))!;
      const { _id, _creationTime, currentProposalId, endedAt, endedReason, ...runFields } = oldRun; void _id; void _creationTime; void currentProposalId; void endedAt; void endedReason;
      const runId = await ctx.db.insert('runs', { ...runFields, roomId: next.roomId, runNo: 1, status: 'pending_approval' });
      const terms = { itemKeys: ['extra_item'], modifiers: [], amountCents: 10000, deliveryDate: room.localDate };
      const { canonicalJson } = await import('@core/engine');
      const termsKey = canonicalJson(terms);
      const proposalId = await ctx.db.insert('proposals', { roomId: next.roomId, runId, version: 1, origin: 'human_choice', authorRole: 'customer', candidateKey: 'extra_item', terms, termsKey, lines: [{ itemKey: 'extra_item', kind: 'item', revision: 1, title: draft!.title, priceCents: 10000, leadDays: 0 }], plannedTasks: [], requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }], createdAtConstraintsVersion: 1, status: 'active', statusChangedAt: 1, provenance: 'live', createdAt: 1 });
      await ctx.db.patch(runId, { currentProposalId: proposalId });
      await ctx.db.patch(next.roomId, { status: 'open', constraintsVersion: 1, currentRunId: runId, nextRunNo: 2, nextProposalVersion: 2 });
      return { proposalId, termsKey };
    });
    let result;
    for (const role of ['customer','provider','finance'] as const) result = await h.as(role).mutation(recordRef, h.args('approve', { proposalId: proposal.proposalId, expectedTermsKey: proposal.termsKey }));
    expect(result?.status).toBe('executed');
    const record = await h.as('finance').query(executionRef, { roomId: next.roomId });
    expect(record?.changeOrder).toMatchObject({ number: 2, terms: { itemKeys: ['extra_item'] }, amountChain: { baselineCents: 480000, approvedToDateCents: 0, committedBeforeCents: 480000, thisChangeCents: 10000, committedAfterCents: 490000 } });
    const { registerRoomInvariantAudit } = await import('../../tests/convex-helpers/setup');
    const { invariantsRef } = await import('../../tests/convex-helpers/w2Execution.fixture');
    registerRoomInvariantAudit(String(next.roomId), () => h.t.query(invariantsRef, { roomId: next.roomId }));
  });
});

// W2-11: public endpoints must compose the same phase and action source.
for (const state of ['negotiating','needs_input','pending_approval','one-approved','last-vote','provider-last-vote','withdrawn','bumped'] as const) {
  it(`W2-11 12.17 role matrix ${state}`, async () => {
    const h=await harness();
    if(['one-approved','last-vote','provider-last-vote','withdrawn','bumped'].includes(state))await h.approve('customer');
    if(state==='last-vote')await h.approve('provider');
    if(state==='provider-last-vote')await h.approve('finance');
    if(state==='withdrawn')await h.as('customer').mutation(recordRef,h.args('withdraw'));
    if(state==='bumped')await bump(h,{cap:490_000});
    if(state==='negotiating'||state==='needs_input')await h.t.run(async ctx=>{
      await ctx.db.patch(h.runId,{status:state});
      if(state==='needs_input')await ctx.db.insert('humanRequests',{roomId:h.roomId,runId:h.runId,kind:'rounds_exhausted',toRole:'customer',questionKey:'rounds_exhausted',constraintsVersion:1,options:[{optionKey:'end',templateKey:'end_run',effect:{type:'end_run'},shown:{amountCents:123}}],status:'open',expiresAt:9999999999999,provenance:'live',createdAt:1});
    });
    const pending=state==='one-approved'?['provider','finance']:state==='last-vote'?['finance']:state==='provider-last-vote'?['provider']:['customer','provider','finance'];
    for(const role of ['customer','provider','finance'] as const){
      const view=(await h.as(role).query(viewRef,{roomId:h.roomId}))!;
      const inbox=(await h.as(role).query(inboxRef,{paginationOpts:{numItems:10,cursor:null}}))!.page[0]!;
      const awaiting=!['negotiating','needs_input'].includes(state);
      expect(view.header.phase).toEqual(awaiting?{phase:'awaiting_approval',proposalVersion:1,pendingRoles:pending,youPending:pending.includes(role)}:state==='negotiating'?{phase:'negotiating',roundNo:1}:{phase:'needs_input',you:role==='customer',...(role==='finance'?{waitingOn:'customer'}:{})});
      const kind=state==='needs_input'&&role==='customer'?'answer_request':awaiting?(state==='bumped'&&role==='customer'?'redecide_proposal':pending.includes(role)?'decide_proposal':null):null;
      expect(view.todos.map(t=>t.kind)).toEqual(kind?[kind]:[]);
      if(awaiting&&kind)expect(view.todos[0]?.refs).toEqual({proposalId:h.proposalId,proposalVersion:1});
      expect(inbox.phase).toEqual(view.header.phase);
      expect(inbox.topTodo?.kind??null).toBe(kind);
      expect(inbox.inboxSection).toBe(kind?'needs_you':state==='negotiating'?'agents_working':'waiting');
      expect(inbox.waitingOn).toEqual(kind?null:awaiting?pending.filter(pendingRole=>pendingRole!==role):state==='needs_input'&&role!=='customer'?(role==='provider'?'others':['customer']):null);
      if(role==='finance')expect(view.budget).toEqual({visibility:'finance',capCents:state==='bumped'?490_000:480_000,committedCents:400_000,headroomCents:state==='bumped'?90_000:80_000,baselineRecorded:true,baselineSuggestionCents:null,proposalCents:80_000,totalAfterCents:480_000,overByCents:0,status:'within'});
      if(state==='needs_input'&&role==='customer'){
        const request=view.openRequest!;
        if(!request.mine)throw new Error('Expected own request');
        const detail=await h.as(role).query(api.humanRequests.get,{requestId:request.requestId});
        expect(detail&&detail.mine&&detail.options).toEqual(request.options);
        expect(request.options[0]?.effectView).toEqual({amountCents:123});
      }
    }
  });
}

it('DX-1 DX-6 W2-11 provider bytes outside disclosed approval fields stay equal as slots change',async()=>{
 const h=await harness();
 const before=(await h.as('provider').query(viewRef,{roomId:h.roomId}))!;
 await h.approve('customer');
 const after=(await h.as('provider').query(viewRef,{roomId:h.roomId}))!;
 expect(before.header.phase.pendingRoles).not.toEqual(after.header.phase.pendingRoles);
 expect(before.currentProposal?.approvals).not.toEqual(after.currentProposal?.approvals);
 const stable=(view:NonNullable<typeof before>)=>({...view,header:{...view.header,phase:{...view.header.phase,pendingRoles:null,youPending:null}},currentProposal:{...view.currentProposal,approvals:view.currentProposal?.approvals.map(slot=>({...slot,state:null,boundConstraintsVersion:null}))}});
 expect(JSON.stringify(stable(after))).toBe(JSON.stringify(stable(before)));
});
for(const status of ['negotiating','needs_input','pending_approval'] as const)it(`W2-11 Δ2 ${status} over by one cent`,async()=>{
 const h=await harness();
 await h.t.run(async ctx=>{
  await ctx.db.patch(h.runId,{status});
  const brief=(await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',h.roomId).eq('role','finance')).first())!;
  await ctx.db.patch(brief._id,{hardFields:{schemaKey:'scope_change.finance.v1',capCents:479_999}});
 });
 const view=await h.as('finance').query(viewRef,{roomId:h.roomId});
 expect(view?.budget).toMatchObject({proposalCents:80_000,totalAfterCents:480_000,overByCents:1,status:'over'});
});
it('W2-11 invalidating bump removes active proposal Δ2 and approval todos',async()=>{
 const h=await harness();await h.approve('customer');await bump(h,{cap:479_999});
 for(const role of ['customer','provider','finance'] as const){
  const view=(await h.as(role).query(viewRef,{roomId:h.roomId}))!;
  const inbox=(await h.as(role).query(inboxRef,{paginationOpts:{numItems:10,cursor:null}}))!.page[0]!;
  expect(view.header.phase).toEqual({phase:'needs_input',you:role==='customer',...(role==='finance'?{waitingOn:'customer'}:{})});
  expect(view.currentProposal).toBeNull();expect(view.todos.map(t=>t.kind)).toEqual(role==='customer'?['answer_request']:[]);
  expect(inbox.phase).toEqual(view.header.phase);expect(inbox.topTodo?.kind??null).toBe(role==='customer'?'answer_request':null);expect(inbox.waitingOn).toEqual(role==='customer'?null:role==='provider'?'others':['customer']);expect(inbox.inboxSection).toBe(role==='customer'?'needs_you':'waiting');
  if(role==='finance')expect(view.budget).toEqual({visibility:'finance',capCents:479_999,committedCents:400_000,headroomCents:79_999,baselineRecorded:true,baselineSuggestionCents:null,proposalCents:null,totalAfterCents:null,overByCents:null,status:'no_proposal'});
 }
});


it('W2-11 F3 listMine uses approval slots without card construction or rule evaluation',async()=>{
 const h=await harness();
 await h.approve('customer');
 await bump(h,{cap:490_000});
 const card=vi.spyOn(decisionViews,'buildProposalCard').mockRejectedValue(new Error('Inbox must not build cards'));
 const rules=vi.spyOn(approvalHelpers,'loadRuleInput').mockRejectedValue(new Error('Inbox must not evaluate rules'));
 try{
  for(const role of ['customer','provider','finance'] as const){
   const inbox=(await h.as(role).query(inboxRef,{paginationOpts:{numItems:10,cursor:null}}))!.page[0]!;
   expect(inbox.inboxSection).toBe('needs_you');
   expect(inbox.topTodo?.kind).toBe(role==='customer'?'redecide_proposal':'decide_proposal');
  }
  expect(card).not.toHaveBeenCalled();expect(rules).not.toHaveBeenCalled();
 }finally{vi.restoreAllMocks();}
});

it('DX-7 W2-11 customer-caused and finance-caused kept bumps produce byte-equal provider DTOs',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
 try{
  const customer=await harness(),finance=await harness();
  for(const h of [customer,finance]){await h.approve('customer');await h.approve('provider');}
  await bump(customer,{deadline:'2026-11-25'});
  await bump(finance,{cap:490_000});
  const a=(await customer.as('provider').query(viewRef,{roomId:customer.roomId}))!;
  const b=(await finance.as('provider').query(viewRef,{roomId:finance.roomId}))!;
  expect(a.header.phase).toMatchObject({phase:'awaiting_approval',pendingRoles:['customer','provider','finance'],youPending:true});
  expect(a.todos.map(todo=>todo.kind)).toEqual(['redecide_proposal']);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
 }finally{vi.useRealTimers();}
});
it('DX-6 W2-11 customer approval with and without a private note produces byte-equal provider DTOs',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
 try{
  const plain=await harness(),noted=await harness();
  await plain.approve('customer');await noted.approve('customer',{note:'PRIVATE_APPROVAL_NOTE'});
  const raw=await noted.t.run(ctx=>ctx.db.query('approvals').collect());
  expect(raw[0]?.note).toBe('PRIVATE_APPROVAL_NOTE');
  const a=await plain.as('provider').query(viewRef,{roomId:plain.roomId});
  const b=await noted.as('provider').query(viewRef,{roomId:noted.roomId});
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
 }finally{vi.useRealTimers();}
});

for(const staleRole of ['customer','provider','finance'] as const)it(`W2-11 stale ${staleRole} remains the final pending role after other new-cv votes`,async()=>{
 const h=await harness();await h.approve(staleRole);await bump(h,{cap:490_000});
 for(const role of ['customer','provider','finance'] as const)if(role!==staleRole)await h.approve(role,{expectedConstraintsVersion:2});
 for(const role of ['customer','provider','finance'] as const){
  const view=(await h.as(role).query(viewRef,{roomId:h.roomId}))!;
  const inbox=(await h.as(role).query(inboxRef,{paginationOpts:{numItems:10,cursor:null}}))!.page[0]!;
  expect(view.header.phase).toEqual({phase:'awaiting_approval',proposalVersion:1,pendingRoles:[staleRole],youPending:role===staleRole});
  expect(view.todos.map(todo=>todo.kind)).toEqual(role===staleRole?['redecide_proposal']:[]);
  expect(inbox.topTodo?.kind??null).toBe(role===staleRole?'redecide_proposal':null);
  expect(inbox.waitingOn).toEqual(role===staleRole?null:[staleRole]);
  expect(inbox.inboxSection).toBe(role===staleRole?'needs_you':'waiting');
 }
});
