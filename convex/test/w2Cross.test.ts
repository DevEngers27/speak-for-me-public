import { describe, expect, it, vi } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import { harness, invariantsRef, recordRef } from '../../tests/convex-helpers/w2Execution.fixture';
import type { Doc, Id } from '../_generated/dataModel';
import { ConvexError, type Infer } from 'convex/values';
import { checkProposal, evaluateApprovalSet } from '@core/engine';
import { loadRuleInput, asEngineProposal } from '../model/approvalHelpers';
import { roomViewV, executionViewV, proposalCardV } from '../model/views/roomView';
import { scanCanaries, type CanaryNeedle } from '../../tests/convex-helpers/canary';

import { bump } from '../../tests/convex-helpers/w2Constraint.fixture';
type Harness = Awaited<ReturnType<typeof harness>>;
const roomViewRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof roomViewV>|null>('rooms:view');
const listRef = makeFunctionReference<'query', { paginationOpts: { numItems: number; cursor: null } }, unknown>('rooms:listMine');
const executionRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof executionViewV>|null>('executions:forRoom');
const proposalRef = makeFunctionReference<'query', { proposalId: Id<'proposals'> }, { card: Infer<typeof proposalCardV>; decisions: unknown[] }|null>('proposals:get');

const markDoneRef = makeFunctionReference<'mutation', { taskId: Id<'tasks'> }, { status: 'done' | 'unchanged' }>('tasks:markDone');
const followUpRef = makeFunctionReference<'mutation', { executionId: Id<'executions'> }, { roomId: Id<'rooms'>; created: boolean }>('rooms:startFollowUp');

async function clean(h: Harness) { expect(await h.t.query(invariantsRef, { roomId: h.roomId })).toEqual([]); }
async function counts(h: Harness) {
  return h.t.run(async ctx => ({ approvals: (await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', h.proposalId)).collect()).length, events: (await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', h.roomId)).collect()).length, executions: (await ctx.db.query('executions').withIndex('by_room',q => q.eq('roomId',h.roomId)).collect()).length }));
}

/** Model proposal operation uses a feasible canonical materialization. */
async function proposeReplacement(h: Harness): Promise<boolean> {
  return h.t.run(async ctx => {
    const room = (await ctx.db.get(h.roomId))!;
    const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
    if (room.status !== 'open' || run?.status !== 'negotiating') return false;
    const loaded = await loadRuleInput(ctx, room);
    if (!loaded.scenario) return false;
    const history = await ctx.db.query('proposals').withIndex('by_run', q => q.eq('runId', run._id)).collect();
    const excluded = new Set(history.filter(p => p.status === 'rejected').map(p => p.candidateKey));
    const carried = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
    if (carried?.status === 'rejected') excluded.add(carried.candidateKey); // D06 proposal origin may be an older run.
    const candidates = loaded.scenario.candidateSpace(loaded.input).drafts.flatMap(draft => {
      const candidate = loaded.scenario!.materialize(draft, loaded.input.catalog, loaded.input.localDate);
      return candidate && !excluded.has(candidate.candidateKey) && checkProposal(loaded.scenario!, loaded.input, candidate).passesChecks ? [candidate] : [];
    }).sort((a,b) => a.candidateKey.localeCompare(b.candidateKey));
    const candidate = candidates[0];
    if (!candidate) return false; // The below-boundary cap waits for a later budget transition.
    const prior = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
    if (prior?.status === 'active') await ctx.db.patch(prior._id, { status: 'superseded', statusChangedAt: 2 });
    const turns = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect();
    for (const turn of turns) if (turn.status === 'scheduled' || turn.status === 'running') await ctx.db.patch(turn._id, { status: 'completed', completedAt: 2 });
    const proposalId = await ctx.db.insert('proposals', {
      roomId: room._id, runId: run._id, version: room.nextProposalVersion, origin: 'human_choice', authorRole: 'customer', chosenBy: h.users.customer,
      candidateKey: candidate.candidateKey, terms: candidate.terms, termsKey: candidate.termsKey,
      lines: candidate.lines.map(line => ({ ...line, kind: loaded.catalogItems.find(row => row.itemKey === line.itemKey)!.kind })),
      plannedTasks: candidate.plannedTasks.map(task => ({ ...task, assigneeRole: task.assigneeRole as Doc<'members'>['role'] })), requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }],
      createdAtConstraintsVersion: room.constraintsVersion, status: 'active', statusChangedAt: 2, provenance: 'stub', createdAt: 2,
    });
    await ctx.db.patch(run._id, { status: 'pending_approval', currentProposalId: proposalId, activeTurnSeq: null });
    await ctx.db.patch(room._id, { nextProposalVersion: room.nextProposalVersion + 1, writeSeq: room.writeSeq + 1 });
    return true;
  });
}

/** The five per-step invariants are independent of the R-code implementation. */
async function modelInvariants(h: Harness, rejected: Set<Id<'proposals'>>) {
  const data = await h.t.run(async ctx => ({
    rooms: await ctx.db.query('rooms').collect(), runs: await ctx.db.query('runs').collect(), proposals: await ctx.db.query('proposals').collect(),
    approvals: await ctx.db.query('approvals').collect(), members: await ctx.db.query('members').collect(), ledger: await ctx.db.query('ledgerEntries').collect(),
    executions: await ctx.db.query('executions').collect(), orders: await ctx.db.query('changeOrders').collect(), tasks: await ctx.db.query('tasks').collect(),
  }));
  for (const room of data.rooms) {
    await expect(h.t.query(invariantsRef, { roomId: room._id })).resolves.toEqual([]);
    // 1. Each room executes at most once, with the proposal/run/room terminal states together.
    const executions = data.executions.filter(e => e.roomId === room._id);
    expect(executions.length).toBeLessThanOrEqual(1);
    expect(room.status === 'executed').toBe(executions.length === 1);
    for (const proposal of data.proposals.filter(p => p.roomId === room._id)) expect(proposal.status === 'executed').toBe(executions.some(e => e.proposalId === proposal._id));
    for (const execution of executions) {
      const proposal = data.proposals.find(p => p._id === execution.proposalId)!;
      const run = data.runs.find(r => r._id === execution.runId)!;
      expect(proposal.status).toBe('executed'); expect(run.status).toBe('executed'); expect(run.currentProposalId).toBe(proposal._id);
      // 2. There is exactly one matching ledger commit and commitment never exceeds the frozen cap.
      const ledger = data.ledger.filter(row => row.roomId === room._id);
      const commits = ledger.filter(row => row.kind === 'commit');
      expect(commits).toHaveLength(1); expect(commits[0]).toMatchObject({ executionId: execution._id, amountCents: execution.amountCents });
      expect(ledger.reduce((sum,row) => sum+row.amountCents,0)).toBe(execution.committedAfterCents);
      expect(execution.committedAfterCents).toBeLessThanOrEqual(execution.capCentsAtExecution);
      // 3. One change order and exactly the frozen task set are written from the proposal snapshot.
      const orders = data.orders.filter(order => order.executionId === execution._id);
      expect(orders).toHaveLength(1); expect(orders[0]!.termsKey).toBe(proposal.termsKey);
      expect(orders[0]!.terms).toEqual(proposal.terms); expect(orders[0]!.lines).toEqual(proposal.lines);
      const tasks = data.tasks.filter(task => task.executionId === execution._id);
      expect(tasks).toHaveLength(proposal.plannedTasks.length); expect(new Set(tasks.map(task => task.taskKey)).size).toBe(tasks.length);
      for (const task of proposal.plannedTasks) expect(tasks.find(row => row.taskKey === `${execution._id}:${task.itemKey}:${task.templateIndex}`)).toMatchObject(task);
      // 4. Frozen signatures are unique current approvals, bound to this cv and these terms.
      expect(execution.approvalIds).toHaveLength(proposal.requiredApprovals.length);
      const signatures = execution.approvalIds.map(id => data.approvals.find(row => row._id === id)!);
      expect(new Set(signatures.map(row => row.userId)).size).toBe(signatures.length);
      for (const [i, signature] of signatures.entries()) {
        const holders = data.members.filter(member => member.roomId === room._id && member.role === signature.role);
        expect(holders).toHaveLength(1); expect(holders[0]!.userId).toBe(signature.userId);
        expect(signature).toMatchObject({ proposalId: proposal._id, decision: 'approve', role: proposal.requiredApprovals[i]!.role, kind: proposal.requiredApprovals[i]!.kind, boundConstraintsVersion: execution.constraintsVersion, boundTermsKey: proposal.termsKey });
        expect(data.approvals.filter(row => row.proposalId === proposal._id && row.userId === signature.userId).every(row => row.seq <= signature.seq)).toBe(true);
      }
    }
    // 5. A complete executable approval set may never remain pending (liveness).
    const run = data.runs.find(r => r._id === room.currentRunId);
    const proposal = data.proposals.find(p => p._id === run?.currentProposalId);
    if (room.status === 'open' && run?.status === 'pending_approval' && proposal?.status === 'active') {
      const set = evaluateApprovalSet({ required: proposal.requiredApprovals, members: data.members.filter(m => m.roomId === room._id), rows: data.approvals.filter(a => a.proposalId === proposal._id).map(a => ({ ...a, id: a._id })), roomConstraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey });
      if (set.complete) {
        const executable = await h.t.run(async ctx => { const loaded = await loadRuleInput(ctx, room); return loaded.scenario && checkProposal(loaded.scenario, loaded.input, asEngineProposal(proposal)).passesChecks; });
        expect(executable).toBe(false);
      }
    }
  }
  for (const id of rejected) expect(data.proposals.find(p => p._id === id)?.status).toBe('rejected');
  for (const proposal of data.proposals) if (proposal.status === 'rejected') rejected.add(proposal._id);
}

describe('W2-2 cross-lane approval bindings', () => {
  for (const cap of [480_000, 490_000]) it(`TC-VER-03 I4 I5 CC-09 SM-03 SM-14 retained proposal at cap ${cap} requires three fresh approvals`, async () => {
    const h = await harness();
    await h.approve('customer'); await clean(h);
    await h.approve('provider'); await clean(h);
    const cv = await bump(h, { cap }); await clean(h);
    const before = await counts(h);
    await expect(h.approve('finance')).rejects.toThrow('approval.stale');
    await expect(h.approve('finance', { expectedConstraintsVersion: cv, expectedTermsKey: 'old_terms' })).rejects.toThrow('approval.stale');
    expect(await counts(h)).toEqual(before);
    const view = await h.as('customer').query(roomViewRef, { roomId: h.roomId });
    expect(view?.currentProposal?.proposalId).toBe(h.proposalId);
    expect(view?.currentProposal?.approvals.filter(slot => slot.state === 'stale_approve')).toHaveLength(2);
    const run = await h.t.run(ctx => ctx.db.get(h.runId));
    expect(run?.status).toBe('superseded');
    expect(await h.approve('customer', { expectedConstraintsVersion: cv })).toMatchObject({ status: 'recorded' }); await clean(h);
    expect(await h.approve('provider', { expectedConstraintsVersion: cv })).toMatchObject({ status: 'recorded' }); await clean(h);
    expect(await h.approve('finance', { expectedConstraintsVersion: cv })).toMatchObject({ status: 'executed' }); await clean(h);
    const execution = await h.t.run(ctx => ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', h.roomId)).unique());
    expect(execution?.constraintsVersion).toBe(cv);
    expect((await counts(h)).approvals).toBe(5);
    const room = await h.t.run(ctx => ctx.db.get(h.roomId));
    expect(room?.constraintsVersion).toBe(cv);
  });

  it('TC-VER-04 I6 deadline flip invalidates proposal and rejects old approval without writes', async () => {
    const h = await harness();
    await h.approve('customer'); await h.approve('provider');
    await bump(h, { deadline: '2026-10-23' }); await clean(h);
    const before = await counts(h);
    await expect(h.approve('finance')).rejects.toThrow('approval.not_current');
    expect(await counts(h)).toEqual(before);
    expect((await h.t.run(ctx => ctx.db.get(h.proposalId)))?.status).toBe('stale');
    const room = await h.t.run(ctx => ctx.db.get(h.roomId));
    expect((await h.t.run(ctx => ctx.db.get(room!.currentRunId!)))?.status).toBe('needs_input');
    expect(await h.t.run(ctx=>ctx.db.query('humanRequests').withIndex('by_run_status',q=>q.eq('runId',room!.currentRunId!).eq('status','open')).unique())).toMatchObject({kind:'infeasible'});
  });

  it('TC-EXE-08 TC-VER-13 I10 CC-10 rejected proposal never revives after a bump', async () => {
    const h = await harness();
    await h.as('customer').mutation(recordRef, h.args('reject'));
    await clean(h);
    await bump(h, { cap: 500_000 }); await clean(h);
    expect((await h.t.run(ctx => ctx.db.get(h.proposalId)))?.status).toBe('rejected');
    const room = await h.t.run(ctx => ctx.db.get(h.roomId));
    const run = await h.t.run(ctx => ctx.db.get(room!.currentRunId!));
    expect(run?.status).toBe('negotiating');
    expect(run?.currentProposalId).toBeUndefined();
    await expect(h.approve('provider', { expectedConstraintsVersion: 2 })).rejects.toThrow('approval.not_current');
  });

  it('CC-11 title and template edit preserve approvals and execution writes frozen snapshot', async () => {
    const h = await harness();
    await h.approve('customer'); await h.approve('provider');
    await h.t.run(async ctx => {
      const row = await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId',h.roomId).eq('itemKey','scope_item')).unique();
      await ctx.db.patch(row!._id, { title: 'Updated live title', editNo: 1, taskTemplates: [{ title: 'Updated task', assigneeRole: 'provider' }] });
    });
    await clean(h);
    expect(await h.approve('finance')).toMatchObject({ status: 'executed' });
    await clean(h);
    const records = await h.t.run(async ctx => ({ order: await ctx.db.query('changeOrders').withIndex('by_room',q => q.eq('roomId',h.roomId)).unique(), tasks: await ctx.db.query('tasks').withIndex('by_room_assignee',q => q.eq('roomId',h.roomId)).collect(), room: await ctx.db.get(h.roomId) }));
    expect(records.order?.lines[0]?.title).toBe('Scope item');
    expect(records.tasks[0]?.title).toBe('Frozen deliver');
    expect(records.tasks[0]?.assigneeRole).toBe('provider');
    expect(records.room?.constraintsVersion).toBe(1);
  });

  it('TC-EXE-10 I16 room.localDate governs approval until clock fixture advances it', async () => {
    const beforeCron = await harness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));
    try { expect(await beforeCron.execute()).toMatchObject({ status: 'executed' }); }
    finally { vi.useRealTimers(); }
    await clean(beforeCron);
    const afterCron = await harness();
    await afterCron.approve('customer');
    await bump(afterCron, { localDate: '2026-10-25' }); await clean(afterCron);
    const before = await counts(afterCron);
    // S6 currentness precedes S8 version guard: an invalidated proposal is not current.
    await expect(afterCron.approve('finance')).rejects.toThrow('approval.not_current');
    expect(await counts(afterCron)).toEqual(before);
  });

  it('08-I19 TC-PRIV-06/09/14/23 scan all available public decision queries by role', async () => {
    const h = await harness();
    const pins: CanaryNeedle[] = (['customer','provider','finance'] as const).map(role => ({ id: `${role}.notes`, ownerRole: role, kind: 'string', value: `${role.toUpperCase()}_CANARY_731`, allowedRoles: [], origin: 'brief', provenance: 'seeded' }));
    for (const phase of ['before', 'executed'] as const) {
      if (phase === 'executed') await h.execute();
      for (const role of ['customer','provider','finance'] as const) {
        const details = await h.as(role).query(proposalRef,{ proposalId:h.proposalId });
        for (const decision of (details?.decisions ?? []) as { isMe: boolean; note: string|null }[]) {
          if (!decision.isMe) expect(decision.note).toBeNull();
        }
        for (const dto of [await h.as(role).query(roomViewRef,{ roomId:h.roomId }), await h.as(role).query(proposalRef,{ proposalId:h.proposalId }), await h.as(role).query(executionRef,{ roomId:h.roomId }), await h.as(role).query(listRef,{paginationOpts:{numItems:20,cursor:null}})]) {
          expect(scanCanaries(dto,pins,{viewer:role})).toEqual([]);
          expect(JSON.stringify(dto)).not.toMatch(/"(?:userId|tokenIdentifier|softFields|hardFields)":/);
        }
      }
      for (const dto of [await h.t.query(roomViewRef,{roomId:h.roomId}), await h.t.query(proposalRef,{proposalId:h.proposalId}), await h.t.query(executionRef,{roomId:h.roomId}), await h.t.query(listRef,{paginationOpts:{numItems:20,cursor:null}})]) expect(dto).toBeNull();
    }
    await clean(h);
  });

  it('08-MODEL 08-8.9.3 SM-27 200 seeds × 25 non-stalling lifecycle steps preserve five invariants and R1–R11', async () => {
    const allowed = {
      approve: new Set(['approval.not_current','approval.already_executed','approval.stale','approval.not_executable','auth.role_forbidden','run.invalid_state','run.rate_limited']),
      withdraw: new Set(['approval.not_current','approval.already_executed','approval.stale','auth.role_forbidden','run.invalid_state','run.rate_limited']),
      reject: new Set(['approval.not_current','approval.already_executed','approval.stale','auth.role_forbidden','run.invalid_state']),
    };
    const coverage = { invalidatingBumps: 0, replacementProposals: 0, proposalsAfterReject: 0, executions: 0, markedDone: 0, followUps: 0 };
    const capsSeen = new Set<number>();
    const caps = [500_000, 495_000, 480_000, 479_999] as const;
    for (let seed = 1; seed <= 200; seed++) {
      const h = await harness(); const rejected = new Set<Id<'proposals'>>(); let hadRejection = false;
      let state = seed;
      for (let step = 0; step < 25; step++) {
        state = (Math.imul(state,1664525)+1013904223) >>> 0;
        const role = (['customer','provider','finance'] as const)[(state >>> 8) % 3]!;
        const op = (state >>> 16) % 10;
        const room = (await h.t.run(ctx => ctx.db.get(h.roomId)))!;
        const run = room.currentRunId ? await h.t.run(ctx => ctx.db.get(room.currentRunId!)) : null;
        const proposal = run?.currentProposalId ? await h.t.run(ctx => ctx.db.get(run.currentProposalId!)) : null;
        if (room.status === 'executed') {
          if (op % 2 === 0) {
            const task = await h.t.run(ctx => ctx.db.query('tasks').withIndex('by_execution',q => q.eq('executionId',room.executionId!)).first());
            if (task) { const result = await h.as(task.assigneeRole).mutation(markDoneRef,{taskId:task._id}); if(result.status==='done') coverage.markedDone++; }
          } else { const result = await h.as(role).mutation(followUpRef,{executionId:room.executionId!}); if(result.created) coverage.followUps++; }
        } else if (op === 0 || op === 1) {
          const cap = caps[(state >>> 24) % caps.length]!;
          await bump(h,{cap}); capsSeen.add(cap); const after = await h.t.run(ctx=>ctx.db.get(proposal?._id ?? h.proposalId)); if(after?.status==='stale') coverage.invalidatingBumps++;
        } else if (run?.status === 'negotiating') {
          if (await proposeReplacement(h)) { coverage.replacementProposals++; if(hadRejection) coverage.proposalsAfterReject++; }
        } else {
          const decision = op === 2 ? 'reject' : op === 3 ? 'withdraw' : 'approve';
          const currentProposal = proposal ?? (await h.t.run(ctx => ctx.db.get(h.proposalId)))!;
          try {
            const result = await h.as(role).mutation(recordRef,h.args(decision,{proposalId:currentProposal._id,expectedTermsKey:state%7===0?'stale_terms':currentProposal.termsKey,expectedConstraintsVersion:state%5===0?0:room.constraintsVersion}));
            if(result.status==='executed'&&!result.alreadyExecuted) coverage.executions++;
            if(decision==='reject'&&result.status==='recorded') hadRejection=true;
          } catch (error) {
            expect(error).toBeInstanceOf(ConvexError);
            const raw: unknown = error instanceof ConvexError ? error.data : null;
            const data: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
            expect(data).toBeTruthy();
            const payload = data as {code:string;params?:{guard?:string}};
            expect(allowed[decision].has(payload.code), `${decision}: ${payload.code}`).toBe(true);
            expect(payload.code).not.toBe('internal');
            if(decision==='reject') { expect(payload.code).not.toBe('run.rate_limited'); expect(payload.params?.guard).not.toBe('scenario_version'); }
          }
        }
        await modelInvariants(h,rejected);
      }
    }
    expect([...capsSeen].sort((a,b)=>a-b)).toEqual([...caps].sort((a,b)=>a-b));
    for(const [transition,count] of Object.entries(coverage)) expect(count,`${transition} must be reached`).toBeGreaterThan(0);
  }, 120_000);
});
