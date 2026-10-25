/** Dev-only probe fixtures: all state transitions use production cores. */
import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { runSeedChain } from './seedChain';
import { assertTier } from './config';
import { readConfig } from './config';
import { appError } from './errors';
import { upsertFixtureActors, ensureViewerCore } from '../model/users';
import { createCore } from '../model/rooms';
import { insertLinkCore } from '../model/invites';
import { sha256Hex } from './crypto';
import { commitAttempt } from '../model/runs';
import { applyHumanAnswer } from '../model/humanRequests';
import { openRoomTx } from '../model/runtimeTx';
import { loadRuleInput } from '../model/runtimeSources';
import { scopeChangePlugin } from '../../core/scenarios/scope-change';
import { checkProposal, RUN_TERMINAL } from '../../core/engine';

export const fixtureV = v.object({ roomId: v.id('rooms'), runId: v.union(v.id('runs'), v.null()), proposalId: v.union(v.id('proposals'), v.null()),
  constraintsVersion: v.number(), termsKey: v.string(), plannedTasks: v.number(), capCents: v.number(), issuer: v.string(), subjects: v.array(v.string()), tokens: v.array(v.string()) });
export type ProbeFixture = { roomId: Id<'rooms'>; runId: Id<'runs'> | null; proposalId: Id<'proposals'> | null; constraintsVersion: number; termsKey: string; plannedTasks: number; capCents: number; issuer: string; subjects: string[]; tokens: string[] };
export const fixtureModeV = v.union(v.literal('approval'), v.literal('ended'), v.literal('join'));
export async function prepareConcurrencyCore(ctx: MutationCtx, key: string, mode: 'approval' | 'ended' | 'join'): Promise<ProbeFixture> {
  await assertTier(ctx, ['dev', 'test']);
  if (!/^[a-z0-9_-]{1,64}$/.test(key) || readConfig().agentMode !== 'stub') throw appError('input.invalid', { field: 'probe' });
  const issuer = 'https://probe.invalid';
  const subjects = ['customer', 'provider', 'finance'].map(role => `${key}_${role}`);
  const env = { ...process.env, DEPLOYMENT_TIER: 'dev', CLERK_JWT_ISSUER_DOMAIN: issuer,
    E2E_CUSTOMER_SUBJECT: subjects[0], E2E_PROVIDER_SUBJECT: subjects[1], E2E_FINANCE_SUBJECT: subjects[2] };
  const actors = await upsertFixtureActors(ctx, env);
  if (mode === 'join') {
    const { roomId } = await createCore(ctx, actors.customer, { title: 'Concurrency probe', scenarioKey: 'scope_change', timeZone: 'UTC', myRole: 'customer' });
    const tokens = ['provider', 'finance'].map(role => `${key}_${role}_invite`);
    for (const [index, role] of (['provider', 'finance'] as const).entries()) await insertLinkCore(ctx, actors.customer, { roomId, role, tokenHash: await sha256Hex(tokens[index]!) });
    const contenders = Array.from({ length: 5 }, (_, i) => `${key}_contender_${i}`);
    for (const subject of contenders) await ensureViewerCore(ctx, { issuer, subject, tokenIdentifier: `${issuer}|${subject}`, name: 'Probe member' }, {});
    return { roomId, runId: null, proposalId: null, constraintsVersion: 0, termsKey: '', plannedTasks: 0, capCents: 0, issuer, subjects: contenders, tokens };
  }
  const { roomId } = await runSeedChain(ctx, {}, env);
  let room = (await ctx.db.get(roomId))!;
  const runId = room.currentRunId!;
  if (mode === 'ended') {
    const turn = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId).eq('turnSeq', 1)).unique();
    const attempt = turn ? await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id)).first() : null;
    if (!attempt) throw appError('internal');
    await commitAttempt(ctx, { attemptId: attempt._id, actorUserId: actors.provider.userId, latencyMs: 0,
      move: { action: 'reject', proposalVersion: null, reasonKey: 'cannot_deliver', rationale: 'Probe fixture' } });
    const request = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'open')).unique();
    const option = request?.options.find(option => option.effect.type === 'end_run');
    if (!request || !option) throw appError('internal');
    await applyHumanAnswer(await openRoomTx(ctx, roomId, ['open'], actors.provider.userId), request, option.optionKey, 'provider');
    return { roomId, runId, proposalId: null, constraintsVersion: room.constraintsVersion, termsKey: '', plannedTasks: 0, capCents: 0, issuer, subjects, tokens: [] };
  }
  // Consume the three genuine production attempts. Scheduled actions later see
  // terminal attempts and no-op; no proposals/approvals/executions are inserted here.
  for (let i = 0; i < 3; i++) {
    room = (await ctx.db.get(roomId))!;
    const run = (await ctx.db.get(runId))!;
    const turn = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId).eq('turnSeq', run.activeTurnSeq!)).unique();
    if (!turn) throw appError('internal');
    const attempt = await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id)).order('desc').first();
    if (!attempt) throw appError('internal');
    const { full } = await loadRuleInput(ctx, room);
    const selected = turn.candidateSnapshot.find(candidate => {
      const value = scopeChangePlugin.materialize(candidate, full.catalog, full.localDate);
      return value && checkProposal(scopeChangePlugin, full, value).passesChecks;
    });
    const move = turn.kind === 'propose'
      ? { action: 'propose' as const, optionKey: selected?.optionKey ?? '', rationale: 'Probe fixture' }
      : { action: 'recommend_accept' as const, proposalVersion: turn.baseProposalVersion!, rationale: 'Probe fixture' };
    await commitAttempt(ctx, { attemptId: attempt._id, actorUserId: actors[turn.role].userId, move, latencyMs: 0 });
  }
  const run = (await ctx.db.get(runId))!;
  const proposal = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  const finance = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', 'finance')).order('desc').first();
  if (run.status !== 'pending_approval' || !proposal || finance?.hardFields.schemaKey !== 'scope_change.finance.v1') throw appError('internal');
  return { roomId, runId, proposalId: proposal._id, constraintsVersion: room.constraintsVersion, termsKey: proposal.termsKey, plannedTasks: proposal.plannedTasks.length, capCents: finance.hardFields.capCents, issuer, subjects, tokens: [] };
}
export const observationV = v.object({ executions: v.number(), ledgerCommits: v.number(), changeOrders: v.number(), tasks: v.number(), executedEvents: v.number(), followUps: v.number(), writeSeq: v.number(), activeRuns: v.number(), firstAttempts: v.number(), members: v.number(), providerMembers: v.number(), maxMembersPerUser: v.number(), maxApprovalsPerUser: v.number(), executionIds: v.array(v.id('executions')), unsafeExecutedDecision: v.boolean() });
export async function observeConcurrencyCore(ctx: QueryCtx, roomId: Id<'rooms'>, proposalId?: Id<'proposals'>) {
  await assertTier(ctx, ['dev', 'test']);
  const room = await ctx.db.get(roomId);
  if (!room) throw appError('input.invalid', { field: 'roomId' });
  const executions = await ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', roomId)).collect();
  const ledger = await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', roomId).eq('kind', 'commit')).collect();
  const orders = await ctx.db.query('changeOrders').withIndex('by_room', q => q.eq('roomId', roomId)).collect();
  const tasks = await ctx.db.query('tasks').withIndex('by_room_assignee', q => q.eq('roomId', roomId)).collect();
  const events = await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', roomId)).collect();
  const members = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', roomId)).collect();
  const rows = proposalId ? await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposalId)).collect() : [];
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if ((latest.get(row.userId)?.seq ?? 0) < row.seq) latest.set(row.userId, row);
  const runs = await ctx.db.query('runs').withIndex('by_room_runNo', q => q.eq('roomId', roomId)).collect();
  const current = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const first = current ? await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', current._id).eq('turnSeq', 1)).unique() : null;
  const attempts = first ? await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', first._id)).collect() : [];
  const followUps = room.executionId ? await ctx.db.query('rooms').withIndex('by_followsExecutionId', q => q.eq('followsExecutionId', room.executionId!)).collect() : [];
  const maxGroup = (values: string[]) => Math.max(0, ...values.map(value => values.filter(other => other === value).length));
  return { executions: executions.length, ledgerCommits: ledger.length, changeOrders: orders.length, tasks: tasks.length,
    executedEvents: events.filter(e => e.payload.type === 'room_executed').length, followUps: followUps.length, writeSeq: room.writeSeq,
    activeRuns: runs.filter(run => !RUN_TERMINAL.has(run.status)).length, firstAttempts: attempts.length, members: members.length,
    providerMembers: members.filter(m => m.role === 'provider').length, maxMembersPerUser: maxGroup(members.map(m => m.userId)),
    maxApprovalsPerUser: maxGroup(rows.filter(row => row.decision === 'approve').map(row => `${row.userId}:${row.boundConstraintsVersion}`)),
    executionIds: executions.map(e => e._id), unsafeExecutedDecision: executions.length > 0 && [...latest.values()].some(row => row.decision !== 'approve') };
}
export type ProbeObservation = Awaited<ReturnType<typeof observeConcurrencyCore>>;
