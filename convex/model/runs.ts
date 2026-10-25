import { bump as bumpConstraint, react as reactConstraint } from './constraints/protocol';
import { createConstraintTx } from './constraints/adapter';
import { rollLocalDateWith } from './clockDate';
import { hardProjection as projectHard } from '@core/engine';
import {patchGlobal,insertGlobal} from '../lib/db';
import {nowMs} from '../lib/time';
import { setStatus, appendEvents, openRoomTx, type RoomTx } from './runtimeTx';
import { loadRuleInput, roleView, sources, roomReadiness } from './runtimeSources';
import { planHumanRequests as buildHumanRequests } from '@core/engine';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { RUN_TERMINAL, TURN_TERMINAL, canonicalJson, inheritProvenance, buildTurnSnapshot, enumerateCandidates, checkProposal, allowedActions, decideRetry, resolveRound, WATCHDOG_FIRST_MS, WATCHDOG_REARM_MS, MODEL_BUDGET, PROMPT_VERSION, PROTOCOL_VERSION, type Role, type TurnKind, type RoundEvaluation, type View } from '@core/engine';
import { appError } from '../lib/errors';
import { reconcileOpsLog } from '../lib/opsLog';
import { findRoomFindings } from './roomSnapshot';
import { readConfig } from '../lib/config';
import { plugin, checkStored } from './_parallelStubs.w2-4';
import { runAttemptRef, watchdogRef, beginRef } from './runtimeRefs';
import type { BeginResult, FailOutcome, ModelResponse } from './runtimeValidators';
import { PRICE_TABLE, estimateCostMicroUsd } from './agents/pricing';
import type { ScopeChangeRuleInput } from '@core/scenarios/scope-change';

export const MAX_REACT_DEPTH = 4;
const billedResponses = 1 + MODEL_BUDGET.gatewayTruncationRetries;
export const RESERVE_MICRO_USD = estimateCostMicroUsd({ inputTokens: 12_000 * billedResponses, outputTokens: MODEL_BUDGET.maxTokens * billedResponses, thinkingTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, 'claude-opus-5-5')!.microUsd;
export const GLOBAL_DAILY_SPEND_CAP_MICRO_USD = 5_000_000;
export const PRICE_TABLE_AS_OF = PRICE_TABLE.asOf;
export type StartOptions = { cause: Doc<'runs'>['cause']; origin: 'system' | 'user'; keepCandidateId?: Id<'proposals'>; reactDepth?: number };
export type SourceRef = Doc<'constraintRevisions'>['sourceRefs'][number];
export const terminalRun = (r: Doc<'runs'>) => RUN_TERMINAL.has(r.status);
export async function draining(ctx: MutationCtx) { return (await ctx.db.query('opsFlags').withIndex('by_key', q => q.eq('key', 'global')).unique())?.draining === true; }
export { setStatus } from './runtimeTx';

/** Close requests through the runtime status/event helpers under the caller's lock. */
export async function closeOpenHumanRequestsTx(tx: RoomTx, runId: Id<'runs'>, reason: NonNullable<Doc<'humanRequests'>['closedReason']>) {
  const run = await tx.ctx.db.get(runId);
  if (!run) throw appError('internal');
  for (const request of await tx.ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId',runId).eq('status','open')).collect()) {
    await setStatus(tx,{table:'humanRequests',id:request._id,patch:{status:'superseded',closedReason:reason,closedAt:nowMs(tx.ctx)}});
    await appendEvents(tx,[{type:'human_request_closed',runNo:run.runNo,status:'superseded'}],{runId},{table:'humanRequests',id:request._id});
  }
}

export async function disposeCurrentRun(tx: RoomTx, reason: 'constraints_changed' | 'renegotiation_requested' | 'canceled_by_creator' | 'room_closed' | 'no_agreement' | 'request_expired', targetRunId?: Id<'runs'>) {
  const ctx = tx.ctx;
  const room = (await ctx.db.get(tx.room._id))!;
  const run = targetRunId ? await ctx.db.get(targetRunId) : room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (!run || terminalRun(run)) return {};
  const status = reason === 'constraints_changed' || reason === 'renegotiation_requested' ? 'superseded' : reason === 'no_agreement' || reason === 'request_expired' ? 'ended_no_agreement' : 'canceled';
  const proposal = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  if (proposal?.status === 'active') {
    const to = reason === 'constraints_changed' ? 'stale' : 'superseded';
    await setStatus(tx, { table: 'proposals', id: proposal._id, patch: { status: to, statusChangedAt: nowMs(ctx) } });
    await appendEvents(tx, [{ type: 'proposal_status_changed', proposalVersion: proposal.version, to }], { runId: run._id, proposalId: proposal._id });
  }
  for (const request of await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', run._id).eq('status', 'open')).collect()) {
    await setStatus(tx, { table: 'humanRequests', id: request._id, patch: { status: 'superseded', closedAt: nowMs(ctx), closedReason: reason === 'constraints_changed' ? 'constraints_changed' : reason === 'renegotiation_requested' ? 'renegotiation_requested' : reason === 'room_closed' ? 'room_closed' : 'run_canceled' } });
    await appendEvents(tx, [{ type: 'human_request_closed', runNo: run.runNo, status: 'superseded' }], { runId: run._id }, { table: 'humanRequests', id: request._id });
  }
  for (const turn of await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect()) if (!TURN_TERMINAL.has(turn.status)) await setStatus(tx, { table: 'turns', id: turn._id, patch: { status: 'stale', completedAt: nowMs(ctx) } });
  await setStatus(tx, { table: 'runs', id: run._id, patch: { status, endedReason: reason, endedAt: nowMs(ctx), activeTurnSeq: null } });
  await appendEvents(tx, [{ type: 'run_ended', runNo: run.runNo, status, endedReason: reason }], { runId: run._id });
  return { runId: run._id, previousStatus: run.status, staleProposalId: proposal?.status === 'active' ? proposal._id : undefined };
}

// Constraint lifecycle delegates to the authoritative W2-3 fixpoint.
export async function bump(tx:RoomTx,b:{cause:Doc<'constraintRevisions'>['cause'];sourceRefs:SourceRef[];depth?:number}){
 return bumpConstraint(makeConstraintTx({...tx.ctx,tx:tx.tx},tx.room._id),{...b,actorUserId:tx.actorUserId??undefined,depth:b.depth??0});
}
export async function react(tx:RoomTx,r:{depth:number;runCause:'room_opened'|'constraints_changed';keepCandidateId?:Id<'proposals'>}){
 return reactConstraint(makeConstraintTx({...tx.ctx,tx:tx.tx},tx.room._id),{...r,cause:r.runCause});
}
export async function hardProjection(ctx:MutationCtx,room:Doc<'rooms'>){
 return projectHard(plugin,(await loadRuleInput(ctx,room)).full);
}
export async function openIfReady(tx: RoomTx) {
  const ctx = tx.ctx;
  const roomId = tx.room._id;
  await rollLocalDateTx({...ctx,tx:tx.tx},roomId,nowMs(ctx),true);
  const room = await ctx.db.get(roomId);
  if (!room || room.status !== 'setup' || !(await roomReadiness(ctx, roomId)).ready) return false;
  await setStatus(tx, { table: 'rooms', id: roomId, patch: { status: 'open', openedAt: nowMs(ctx) } });
  const data = await sources(ctx, roomId);
  const sourceRefs: SourceRef[] = [ ...data.briefs.map(b => ({ kind: 'brief' as const, briefId: b._id, role: b.role, version: b.version })), ...data.catalog.filter(c => c.status !== 'draft').map(c => ({ kind: 'catalogItem' as const, catalogItemId: c._id, itemKey: c.itemKey, revision: c.revision })), ...data.ledger.map(e => ({ kind: 'ledgerEntry' as const, ledgerEntryId: e._id })) ];
  await appendEvents(tx, [{ type: 'room_opened', constraintsVersion: 1 }]);
  await bump(tx, { cause: 'room_opened', sourceRefs });
  return true;
}
export async function withConstraintChange(tx: RoomTx, c: { cause: Doc<'constraintRevisions'>['cause'] }, apply: () => Promise<SourceRef[]>) {
  const room = (await tx.ctx.db.get(tx.room._id))!;
  if (!['setup', 'open'].includes(room.status)) throw appError('run.invalid_state', { guard: 'room_status' });
  if (room.status === 'setup') { await apply(); await openIfReady(tx); return { changed: false, constraintsVersion: (await tx.ctx.db.get(room._id))!.constraintsVersion }; }
  const before = await hardProjection(tx.ctx, room);
  const sourceRefs = await apply();
  if (before === await hardProjection(tx.ctx, (await tx.ctx.db.get(room._id))!)) return { changed: false, constraintsVersion: room.constraintsVersion };
  return { changed: true, constraintsVersion: await bump(tx, { cause: c.cause, sourceRefs }) };
}

export async function startRunTx(tx: RoomTx, options: StartOptions): Promise<{ runId: Id<'runs'>; created: boolean; status: Doc<'runs'>['status'] }> {
  const ctx = tx.ctx;
  const room = (await ctx.db.get(tx.room._id))!;
  if (room.status !== 'open') throw appError('internal');
  const current = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (current && !terminalRun(current)) {
    // run.start_with_live_run: only a user command may reuse a live run.
    if (options.origin === 'system') throw appError('internal');
    return { runId: current._id, created: false, status: current.status };
  }
  const runId = await tx.tx.insert('runs', { roomId: room._id, runNo: room.nextRunNo, status: 'negotiating', cause: options.cause, constraintsVersionAtStart: room.constraintsVersion, agentMode: readConfig().agentMode, roundNo: 1, maxRounds: 3, roundsExtended: false, activeTurnSeq: null, nextTurnSeq: 1, attemptCount: 0, maxAttempts: 18, reservedMicroUsd: 0, spentMicroUsd: 0, spendCapMicroUsd: 3_000_000, provenance: room.provenance, startedAt: nowMs(ctx), ...(current ? { previousRunId: current._id } : {}), ...(tx.actorUserId ? { startedBy: tx.actorUserId } : {}) });
  await tx.tx.patch('rooms', room._id, { currentRunId: runId, nextRunNo: room.nextRunNo + 1 });
  await appendEvents(tx, [{ type: 'run_started', runNo: room.nextRunNo, cause: options.cause }], { runId });
  if (options.keepCandidateId && room.scenarioVersion === 1) {
    const proposal = await ctx.db.get(options.keepCandidateId);
    const { full } = await loadRuleInput(ctx, room);
    if (proposal?.status === 'stale' && checkStored(full, proposal).passesChecks) {
      await setStatus(tx, { table: 'proposals', id: proposal._id, patch: { status: 'active', statusChangedAt: nowMs(ctx) } });
      await setStatus(tx, { table: 'runs', id: runId, patch: { status: 'pending_approval', currentProposalId: proposal._id } });
      await appendEvents(tx, [{ type: 'reapproval_required', proposalVersion: proposal.version, constraintsVersion: room.constraintsVersion }], { runId, proposalId: proposal._id });
      return { runId, created: true, status: 'pending_approval' };
    }
  }
  await precheck(tx, runId);
  return { runId, created: true, status: (await ctx.db.get(runId))!.status };
}
export async function precheck(tx: RoomTx, runId: Id<'runs'>) {
  const room = (await tx.ctx.db.get(tx.room._id))!;
  if (room.scenarioVersion !== 1) { await openHumanRequestTx(tx, runId, { kind: 'agent_failed', toRole: 'provider', retryAllowed: false }); return; }
  const { full } = await loadRuleInput(tx.ctx, room);
  if (!enumerateCandidates(plugin, full, { mode: 'feasibility' }).items.length) await openHumanRequestTx(tx, runId, { kind: 'infeasible', toRole: 'customer' });
  else { await setStatus(tx, { table: 'runs', id: runId, patch: { status: 'negotiating' } }); await createTurnTx(tx, runId, { role: 'provider', kind: 'propose' }); }
}

export async function exclusions(ctx: Pick<QueryCtx,'db'>, runId: Id<'runs'>) {
  const turns = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId)).collect();
  const proposals = await ctx.db.query('proposals').withIndex('by_run', q => q.eq('runId', runId)).collect();
  const regenerated = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'superseded')).collect();
  const failedChoices = regenerated.filter(r => r.closedReason === 'regenerated').flatMap(r => {
    const effect = r.options.find(o => o.optionKey === r.answerOptionKey)?.effect;
    return effect?.type === 'choose_candidate' ? [effect.candidateKey] : [];
  });
  const rejectedRows = await ctx.db.query('approvals').withIndex('by_run_decision', q => q.eq('runId', runId).eq('decision', 'reject')).collect();
  const rejectedProposals = await Promise.all(rejectedRows.map(row => ctx.db.get(row.proposalId)));
  const rejected = [...new Set([...proposals.filter(p => p.status === 'rejected').map(p => p.candidateKey), ...rejectedProposals.flatMap(p => p ? [p.candidateKey] : []), ...failedChoices])];
  const provider = [...new Set([...rejected, ...turns.filter(t => t.role === 'provider').flatMap(t => t.outcome?.candidateKey ? [t.outcome.candidateKey] : t.outcome?.blockedCandidateKey ? [t.outcome.blockedCandidateKey] : [])])];
  return { turns, proposals, rejected, provider, failedChoices };
}
export async function createTurnTx(tx: RoomTx, runId: Id<'runs'>, args: { role: Role; kind: TurnKind; baseProposalId?: Id<'proposals'>; retryOfTurnId?: Id<'turns'>; origin?: Doc<'attempts'>['origin'] }): Promise<Id<'turns'> | null> {
  const ctx = tx.ctx;
  const room = (await ctx.db.get(tx.room._id))!;
  const run = (await ctx.db.get(runId))!;
  if (room.scenarioVersion !== 1) { await openHumanRequestTx(tx, runId, { kind: 'agent_failed', toRole: args.role, retryAllowed: false }); return null; }
  const ex = await exclusions(ctx, runId);
  if (ex.turns.some(t => !TURN_TERMINAL.has(t.status))) throw appError('internal');
  if (args.role === 'provider' && ex.turns.filter(t => t.result?.action === 'propose').length >= 4) { await openHumanRequestTx(tx, runId, { kind: 'rounds_exhausted', toRole: 'customer', cause: 'no_candidates' }); return null; }
  const { view } = await roleView(ctx, room, args.role);
  const base = args.baseProposalId ? await ctx.db.get(args.baseProposalId) : null;
  const counterCandidateKey=ex.turns.findLast(t=>t.result?.action==='counter'&&t.outcome?.candidateKey)?.outcome?.candidateKey;
  const snapshot = buildTurnSnapshot({scenario:plugin,role:args.role,view,turnKind:args.kind,roundNo:run.roundNo,limit:12,
    baseCandidateKey:base?.candidateKey,excludedCandidateKeys:args.role==='provider'?ex.provider:ex.rejected,
    ...(args.role==='provider'&&counterCandidateKey?{counterCandidateKey}:{})}).items;
  if (args.role === 'provider' && !snapshot.length) { await openHumanRequestTx(tx, runId, { kind: 'rounds_exhausted', toRole: 'customer', cause: 'no_candidates' }); return null; }
  const answered = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'answered')).collect();
  const answeredClarify = answered.some(r => r.kind === 'clarify' && ex.turns.some(t => t._id === r.sourceTurnId && t.role === args.role));
  const mayClarify = !answeredClarify && plugin.protocol.topics.some(topic => topic.askableBy.includes(args.role) && (view as unknown as Record<string, unknown>)[topic.field] === undefined);
  const actions = [...allowedActions(args.role, args.kind, {
    snapshotSize: snapshot.length, clarifyUsedInRun: ex.turns.some(t => t.role === args.role && t.result?.action === 'clarify'),
    escalateUsedInRun: ex.turns.some(t => t.role === args.role && t.result?.action === 'escalate'),
    proposeCountInRun: ex.turns.filter(t => t.role === args.role && t.result?.action === 'propose').length,
    counterCountInRun: ex.turns.filter(t => t.role === args.role && t.result?.action === 'counter').length,
    providerRejectLocked: answered.some(r => r.toRole === 'provider' && r.kind === 'agent_escalated' && r.options.find(o => o.optionKey === r.answerOptionKey)?.effect.type === 'keep_as_is'),
    topicKeys: plugin.protocol.topics.filter(t => t.askableBy.includes(args.role)).map(t => t.topicKey),
  })].filter(a => (a !== 'clarify' || mayClarify) && (a !== 'counter' || ex.turns.filter(t => t.role === args.role && t.result?.action === 'counter').length < 4));
  const turnId = await tx.tx.insert('turns', { roomId: room._id, runId, turnSeq: run.nextTurnSeq, roundNo: run.roundNo, role: args.role, kind: args.kind, status: 'scheduled', constraintsVersion: room.constraintsVersion, candidateSnapshot: snapshot, allowedActions: actions, promptVersion: PROMPT_VERSION, currentAttemptNo: 0, createdAt: nowMs(ctx), ...(base ? { baseProposalId: base._id, baseProposalVersion: base.version } : {}), ...(args.retryOfTurnId ? { retryOfTurnId: args.retryOfTurnId } : {}) });
  await tx.tx.patch('runs', runId, { activeTurnSeq: run.nextTurnSeq, nextTurnSeq: run.nextTurnSeq + 1 });
  await appendEvents(tx, [{ type: 'turn_scheduled', runNo: run.runNo, turnSeq: run.nextTurnSeq, roundNo: run.roundNo, role: args.role, kind: args.kind }], { runId });
  await beginAttemptTx(tx, turnId, { origin: args.origin ?? 'turn_start', delayMs: 0 });
  return turnId;
}

export async function beginAttemptTx(tx: RoomTx, turnId: Id<'turns'>, o: { origin: Doc<'attempts'>['origin']; delayMs: number; retryNote?: string }): Promise<BeginResult> {
  const ctx = tx.ctx;
  const turn = await ctx.db.get(turnId);
  if (!turn) return { kind: 'stale' };
  if (!['scheduled', 'running'].includes(turn.status)) throw appError('internal');
  const attempts = await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turnId)).collect();
  if (attempts.some(a => a.status === 'running')) throw appError('internal');
  const run = await ctx.db.get(turn.runId);
  const room = await ctx.db.get(turn.roomId);
  if (!run || !room) return { kind: 'stale' };
  if (room.currentRunId !== run._id || run.status !== 'negotiating' || run.activeTurnSeq !== turn.turnSeq || room.constraintsVersion !== turn.constraintsVersion) {
    await setStatus(tx, { table: 'turns', id: turnId, patch: { status: 'stale', completedAt: nowMs(ctx) } });
    const guard = room.currentRunId !== run._id || run.status !== 'negotiating' ? 'G1' : run.activeTurnSeq !== turn.turnSeq ? 'G2' : 'G3';
    await appendEvents(tx, [{ type: 'turn_rejected_stale', runNo: run.runNo, turnSeq: turn.turnSeq, guard }], { runId: run._id });
    return { kind: 'stale' };
  }
  if (run.agentMode === 'live' && await draining(ctx)) { await tx.tx.patch('turns', turnId, { waitingReason: 'draining', beginFnId: undefined }); return { kind: 'parked', code: 'run.draining' }; }
  const limit = async (cause: 'call_limit' | 'spend_limit' | 'turn_attempts'): Promise<BeginResult> => {
    await setStatus(tx, { table: 'turns', id: turnId, patch: { status: 'failed', waitingReason: undefined, beginFnId: undefined, completedAt: nowMs(ctx) } });
    if (cause === 'turn_attempts') {
      const current = attempts.find(a => a.attemptNo === turn.currentAttemptNo);
      await onTurnFailed(tx, turn, { failureKind: 'error', errorCode: 'turn_attempt_limit', ...(current ? { attemptId: current._id } : {}) });
    } else {
      await tx.tx.patch('runs', run._id, { lastFailure: { code: 'run.call_limit', at: nowMs(ctx) } });
      await openHumanRequestTx(tx, run._id, { kind: 'rounds_exhausted', toRole: 'customer', sourceTurnId: turnId, cause });
    }
    return { kind: 'limit', cause };
  };
  if (turn.currentAttemptNo >= 2) return limit('turn_attempts');
  if (run.attemptCount >= run.maxAttempts) return limit('call_limit');
  const live = run.agentMode === 'live';
  if (live && run.spentMicroUsd + run.reservedMicroUsd + RESERVE_MICRO_USD > run.spendCapMicroUsd) return limit('spend_limit');
  const now = nowMs(ctx);
  const day = new Date(now).toISOString().slice(0, 10);
  const counter = live ? await ctx.db.query('spendCounters').withIndex('by_scope_day', q => q.eq('scope', 'global').eq('day', day)).unique() : null;
  const defer = async (until: number, reason: 'spend_deferred' | 'run_cap'): Promise<BeginResult> => {
    const beginFnId = await ctx.scheduler.runAfter(Math.max(0, until - now), beginRef, { turnId, origin: o.origin, actorUserId: tx.actorUserId, ...(o.retryNote ? { retryNote: o.retryNote } : {}) });
    await tx.tx.patch('turns', turnId, { waitingReason: reason, beginFnId });
    return { kind: 'deferred', until, reason };
  };
  const dailyCap = process.env.DEPLOYMENT_TIER === 'prod' ? 15_000_000 : GLOBAL_DAILY_SPEND_CAP_MICRO_USD;
  if (live && (counter?.spentMicroUsd ?? 0) + (counter?.reservedMicroUsd ?? 0) + RESERVE_MICRO_USD > dailyCap) return defer(Date.parse(`${day}T00:00:00Z`) + 86400000 + Math.floor(Math.random() * 1000), 'spend_deferred');
  if (run.attemptCount === 0 && run.cause !== 'manual_start') {
    const recent = (await ctx.db.query('runs').withIndex('by_room_runNo', q => q.eq('roomId', room._id)).order('desc').take(7)).filter(r => r.startedAt > now - 86400000);
    if (recent.length > 6) return defer(recent[6]!.startedAt + 86400000 + Math.floor(Math.random() * 1000), 'run_cap');
  }
  const reservedMicroUsd = live ? RESERVE_MICRO_USD : 0;
  const attemptId = await tx.tx.insert('attempts', { roomId: room._id, runId: run._id, turnId, attemptNo: turn.currentAttemptNo + 1, role: turn.role, origin: o.origin, status: 'running', provenance: run.agentMode, model: live ? 'claude-opus-5-5' : 'stub:v1', effort: 'medium', maxTokens: 16000, protocolVersion: String(PROTOCOL_VERSION), promptVersion: PROMPT_VERSION, reservedDay: day, reservedMicroUsd, deadlineAt: now + o.delayMs + WATCHDOG_FIRST_MS, watchdogArmCount: 0, lateUsage: false, startedAt: now, ...(o.retryNote ? { retryNote: o.retryNote } : {}) });
  // The only scheduling seam for the action: state, action and watchdog commit together.
  const actionFnId = await ctx.scheduler.runAfter(o.delayMs, runAttemptRef, { attemptId, actorUserId: tx.actorUserId });
  const watchdogFnId = await ctx.scheduler.runAfter(o.delayMs + WATCHDOG_FIRST_MS, watchdogRef, { attemptId });
  await tx.tx.patch('attempts', attemptId, { actionFnId, watchdogFnId });
  await setStatus(tx, { table: 'turns', id: turnId, patch: { status: 'running', currentAttemptNo: turn.currentAttemptNo + 1, waitingReason: undefined, beginFnId: undefined } });
  await tx.tx.patch('runs', run._id, { attemptCount: run.attemptCount + 1, reservedMicroUsd: run.reservedMicroUsd + reservedMicroUsd });
  if (live) {
    if (counter) await patchGlobal(ctx,'spendCounters',counter._id, { reservedMicroUsd: counter.reservedMicroUsd + reservedMicroUsd, attempts: counter.attempts + 1 });
    else await insertGlobal(ctx,'spendCounters', { scope: 'global', day, reservedMicroUsd, spentMicroUsd: 0, attempts: 1, unknownCostAttempts: 0 });
  }
  return { kind: 'dispatched', attemptId };
}

export async function openHumanRequestTx(tx: RoomTx, runId: Id<'runs'>, args: { kind: Doc<'humanRequests'>['kind']; toRole: Role; sourceTurnId?: Id<'turns'>; topicKey?: string; cause?: 'rounds' | 'no_candidates' | 'call_limit' | 'spend_limit'; retryAllowed?: boolean; excluded?: string[]; rerouted?: boolean; escalation?: { kind: 'infeasible' | 'needs_tradeoff'; toRole: Role } }) {
  const ctx = tx.ctx;
  const old = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'open')).unique();
  if (old) throw appError('internal');
  const room = (await ctx.db.get(tx.room._id))!;
  const run = (await ctx.db.get(runId))!;
  const ex = await exclusions(ctx, runId);
  const requestRoom=room.scenarioVersion===1?room:{...room,scenarioVersion:1};
  const views = await Promise.all((['customer', 'provider', 'finance'] as const).map(role => roleView(ctx, requestRoom, role)));
  const viewForRole = (role: string): View<ScopeChangeRuleInput> => views.find(v => v.view.viewer === role)!.view;
  const passedPairs = (await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId)).collect()).flatMap(r => {
    const effect = r.options.find(o => o.optionKey === r.answerOptionKey)?.effect;
    return r.status === 'answered' && effect?.type === 'pass_to_next' ? [{ fromRole: r.toRole, toRole: effect.toRole }] : [];
  });
  const { full, data } = await loadRuleInput(ctx, requestRoom);
  const disclosures: Record<string, readonly Role[]> = {};
  for (const fact of new Map(data.facts.map(f=>[`${f.fromRole}:${f.field}`,f])).values()) {
    const declaration = plugin.fields.find(f => f.key === fact.field && f.owner === fact.fromRole);
    if (fact.value !== null && declaration) disclosures[fact.field] = fact.audience;
  }
  const current = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  const currentCandidateKey = current?.status === 'active' && !ex.rejected.includes(current.candidateKey) && checkStored(full, current).passesChecks ? current.candidateKey : undefined;
  const field = plugin.protocol.topics.find(t=>t.topicKey===args.topicKey)?.field ?? 'headroomCents';
  const sourceTurn = args.sourceTurnId ? await ctx.db.get(args.sourceTurnId) : null;
  const escalation = args.escalation ?? (sourceTurn?.result?.action === 'escalate' ? { kind: sourceTurn.result.kind, toRole: args.toRole } : undefined);
  const draft = buildHumanRequests(args.kind, args.toRole, viewForRole, { plugin, disclosures, currentCandidateKey, escalation, excludedCandidateKeys: [...ex.rejected, ...(args.excluded ?? [])], providerExcludedCandidateKeys: ex.provider, openRequestCount: 0, keepAsIsUsed: run.roundsExtended, canContinue: run.attemptCount < run.maxAttempts && (run.agentMode === 'stub' || run.spentMicroUsd + run.reservedMicroUsd + RESERVE_MICRO_USD <= run.spendCapMicroUsd), retryAllowed: args.retryAllowed ?? true, exhaustedCause: args.cause, proposalCounts: { provider: ex.turns.filter(t => t.result?.action === 'propose').length }, passedPairs, ...(args.rerouted ? { reroutedToRole: args.toRole } : {}), ...(args.kind === 'clarify' ? { clarify: { field, askerRole: sourceTurn?.role ?? 'provider' } } : {}) });
  const options: Doc<'humanRequests'>['options'] = draft.options.map(o => {
    const { kind, ...effect } = o.effect;
    return { optionKey: o.optionKey, templateKey: o.templateKey, shown: o.shown, effect: { type: kind, ...effect } as Doc<'humanRequests'>['options'][number]['effect'] };
  });
  const id = await tx.tx.insert('humanRequests', { roomId: room._id, runId, kind: draft.kind, toRole: draft.toRole as Role, questionKey: draft.questionKey, constraintsVersion: room.constraintsVersion, options, status: 'open', expiresAt: nowMs(ctx) + 7 * 86400000, provenance: room.provenance, createdAt: nowMs(ctx), ...(args.sourceTurnId ? { sourceTurnId: args.sourceTurnId } : {}), ...(args.topicKey ? { topicKey: args.topicKey } : {}) });
  if (run.status !== 'needs_input') {
    await setStatus(tx, { table: 'runs', id: runId, patch: { status: 'needs_input', activeTurnSeq: null } });
    await appendEvents(tx, [{ type: 'run_needs_input', runNo: run.runNo }], { runId }, { table: 'humanRequests', id });
  }
  await appendEvents(tx, [{ type: 'human_request_opened', runNo: run.runNo }], { runId }, { table: 'humanRequests', id });
  return id;
}

export async function insertProposal(tx: RoomTx, runId: Id<'runs'>, selected: { itemKeys: string[]; modifiers: string[] }, origin: { type: 'agent'; turnId: Id<'turns'> } | { type: 'human_choice'; requestId: Id<'humanRequests'> }) {
  const ctx = tx.ctx;
  const room = (await ctx.db.get(tx.room._id))!;
  const { full } = await loadRuleInput(ctx, room);
  const materialized = plugin.materialize(selected, full.catalog, full.localDate);
  if (!materialized || !checkProposal(plugin, full, materialized).passesChecks) return null;
  const run = (await ctx.db.get(runId))!;
  const previous = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
  if (previous?.status === 'active') { await setStatus(tx, { table: 'proposals', id: previous._id, patch: { status: 'superseded', statusChangedAt: nowMs(ctx) } }); await appendEvents(tx, [{ type: 'proposal_status_changed', proposalVersion: previous.version, to: 'superseded' }], { runId, proposalId: previous._id }); }
  const lines = materialized.lines.map(line => ({ ...line, kind: full.catalog.find(c => c.itemKey === line.itemKey)!.kind }));
  const id = await tx.tx.insert('proposals', { roomId: room._id, runId, version: room.nextProposalVersion, origin: origin.type, authorRole: origin.type === 'agent' ? 'provider' : 'customer', candidateKey: materialized.candidateKey, terms: materialized.terms, termsKey: canonicalJson(materialized.terms), lines, plannedTasks: materialized.plannedTasks.map(t => ({ ...t, assigneeRole: t.assigneeRole as Role })), requiredApprovals: [{ role: 'customer', kind: 'terms' }, { role: 'provider', kind: 'terms' }, { role: 'finance', kind: 'budget' }], createdAtConstraintsVersion: room.constraintsVersion, status: 'active', statusChangedAt: nowMs(ctx), provenance: inheritProvenance(room.provenance,run.agentMode), createdAt: nowMs(ctx), ...(origin.type === 'agent' ? { sourceTurnId: origin.turnId } : { sourceRequestId: origin.requestId, chosenBy: tx.actorUserId! }) });
  await tx.tx.patch('rooms', room._id, { nextProposalVersion: room.nextProposalVersion + 1 });
  await tx.tx.patch('runs', runId, { currentProposalId: id });
  await appendEvents(tx, [{ type: 'proposal_created', proposalVersion: room.nextProposalVersion, origin: origin.type, authorRole: origin.type === 'agent' ? 'provider' : 'customer', ...materialized.terms }], { runId, proposalId: id });
  return id;
}

export async function advanceRun(tx: RoomTx, runId: Id<'runs'>) {
  const ctx = tx.ctx;
  const room = (await ctx.db.get(tx.room._id))!;
  const run = (await ctx.db.get(runId))!;
  if (run.status !== 'negotiating') return;
  const ex = await exclusions(ctx, runId);
  const roundTurns = ex.turns.filter(t => t.roundNo === run.roundNo && t.status === 'completed');
  const propose = roundTurns.findLast(t => t.role === 'provider' && t.kind === 'propose');
  if (!propose) { await createTurnTx(tx, runId, { role: 'provider', kind: 'propose' }); return; }
  const proposal = propose.outcome?.proposalId ? await ctx.db.get(propose.outcome.proposalId) : null;
  const evaluations: RoundEvaluation[] = roundTurns.filter(t => t.kind === 'evaluate' && t.baseProposalId === proposal?._id).flatMap<RoundEvaluation>(t => {
    const m = t.result;
    if (!m) return [];
    if (m.action === 'recommend_accept') return [{ role: t.role, action: m.action, proposalVersion: m.proposalVersion }];
    if (m.action === 'reject') return [{ role: t.role, action: m.action, reasonKey: m.reasonKey }];
    if (m.action === 'counter') return [{ role: t.role, action: m.action, candidateKey: t.outcome?.candidateKey ?? '', counterPasses: Boolean(t.outcome?.candidateKey) }];
    if (m.action === 'escalate') return [{ role: t.role, action: 'escalate', accepted: false }];
    if (m.action === 'clarify' && t.outcome?.answeredFromFacts) return [{ role: t.role, action: 'clarify', handledBy: 'code' }];
    return [];
  });
  const { full } = await loadRuleInput(ctx, room);
  const decision = resolveRound({ proposalId: proposal?._id ?? '', version: proposal?.version ?? 0, passesChecks: proposal ? checkStored(full, proposal).passesChecks : false }, evaluations, { plugin, roundNo: run.roundNo, maxRounds: run.maxRounds, proposalCounts: { provider: ex.turns.filter(t => t.result?.action === 'propose').length } });
  if (decision.kind === 'next_evaluator') await createTurnTx(tx, runId, { role: decision.role as Role, kind: 'evaluate', baseProposalId: proposal!._id });
  else if (decision.kind === 'pending_approval') {
    await setStatus(tx, { table: 'runs', id: runId, patch: { status: 'pending_approval', activeTurnSeq: null } });
    await appendEvents(tx, [{ type: 'run_awaiting_approval', runNo: run.runNo, proposalVersion: proposal!.version }], { runId, proposalId: proposal!._id });
  } else if (decision.kind === 'next_round') {
    await tx.tx.patch('runs', runId, { roundNo: decision.roundNo });
    await createTurnTx(tx, runId, { role: 'provider', kind: 'propose' });
  } else if (decision.kind === 'rounds_exhausted') await openHumanRequestTx(tx, runId, { kind: 'rounds_exhausted', toRole: 'customer', cause: decision.cause });
  else await openHumanRequestTx(tx, runId, { kind: decision.requestKind, toRole: decision.toRole as Role });
}

export async function applyMove(tx: RoomTx, turn: Doc<'turns'>, move: NonNullable<Doc<'turns'>['result']>) {
  const ctx = tx.ctx;
  if (move.action === 'propose' || move.action === 'counter') {
    const selected = turn.candidateSnapshot.find(c => c.optionKey === move.optionKey)!;
    if (move.action === 'propose') {
      const proposalId = await insertProposal(tx, turn.runId, selected, { type: 'agent', turnId: turn._id });
      await tx.tx.patch('turns', turn._id, { outcome: proposalId ? { candidateKey: selected.candidateKey, proposalId } : { blockedCandidateKey: selected.candidateKey } });
    } else {
      const room = (await ctx.db.get(turn.roomId))!;
      const { full } = await loadRuleInput(ctx, room);
      const materialized = plugin.materialize(selected, full.catalog, full.localDate);
      await tx.tx.patch('turns', turn._id, { outcome: materialized && checkProposal(plugin, full, materialized).passesChecks ? { candidateKey: selected.candidateKey } : { blockedCandidateKey: selected.candidateKey } });
    }
  } else if (move.action === 'clarify') {
    const prior = await exclusions(ctx, turn.runId);
    const already = prior.turns.some(t => t._id !== turn._id && t.role === turn.role && t.result?.action === 'clarify' && t.outcome?.answeredFromFacts);
    const declaration = plugin.protocol.topics.find(t=>t.topicKey===move.topicKey);
    const field = declaration?.field ?? 'headroomCents';
    const room = (await ctx.db.get(turn.roomId))!;
    const { view } = await roleView(ctx, room, turn.role);
    if (declaration?.answer === 'code' && !already && (view as unknown as Record<string, unknown>)[field] !== undefined) {
      await tx.tx.patch('turns', turn._id, { outcome: { answeredFromFacts: true } });
      if (turn.role === 'provider') await createTurnTx(tx, turn.runId, { role: turn.role, kind: turn.kind });
      else await advanceRun(tx, turn.runId);
      return;
    }
    await openHumanRequestTx(tx, turn.runId, { kind: 'clarify', toRole: move.toRole, sourceTurnId: turn._id, topicKey: move.topicKey });
    return;
  } else if (move.action === 'reject' && turn.role === 'provider') {
    await openHumanRequestTx(tx, turn.runId, { kind: 'agent_escalated', toRole: 'provider', sourceTurnId: turn._id });
    return;
  } else if (move.action === 'escalate') {
    const room = (await ctx.db.get(turn.roomId))!;
    const run = (await ctx.db.get(turn.runId))!;
    const ex = await exclusions(ctx, turn.runId);
    const excluded = [...ex.rejected, ...ex.turns.flatMap(t => t.outcome?.blockedCandidateKey ? [t.outcome.blockedCandidateKey] : [])];
    const { full } = await loadRuleInput(ctx, room);
    if (move.kind === 'infeasible') {
      if (!enumerateCandidates(plugin, full, { mode: 'feasibility', excludedCandidateKeys: excluded }).items.length) {
        await openHumanRequestTx(tx, turn.runId, { kind: 'infeasible', toRole: 'customer', sourceTurnId: turn._id }); return;
      }
    } else {
      const history = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', turn.runId)).collect();
      const { view } = await roleView(ctx, room, 'customer');
      if (!(turn.role === 'provider' && run.roundNo === 1 && turn.turnSeq === 1) && !history.some(r => r.kind === 'agent_escalated' && r.toRole === 'customer') && enumerateCandidates(plugin, view, { mode: 'feasibility', excludedCandidateKeys: excluded }).items.length >= 2) {
        await openHumanRequestTx(tx, turn.runId, { kind: 'agent_escalated', toRole: 'customer', sourceTurnId: turn._id }); return;
      }
    }
    // Rejected escalation counts as an evaluation, never as a human request.
  }

  await advanceRun(tx, turn.runId);
}

export async function attemptGuard(ctx: Pick<QueryCtx, 'db'>, attemptId: Id<'attempts'>) {
  const attempt = await ctx.db.get(attemptId);
  const turn = attempt ? await ctx.db.get(attempt.turnId) : null;
  const run = attempt ? await ctx.db.get(attempt.runId) : null;
  const room = attempt ? await ctx.db.get(attempt.roomId) : null;
  const g0 = Boolean(attempt && turn && attempt.status === 'running' && turn.currentAttemptNo === attempt.attemptNo);
  const guard = !room || !run || room.currentRunId !== run._id || run.status !== 'negotiating' ? 'G1' as const : !turn || run.activeTurnSeq !== turn.turnSeq ? 'G2' as const : turn.constraintsVersion !== room.constraintsVersion ? 'G3' as const : null;
  return { attempt, turn, run, room, g0, guard };
}
async function settle(tx: RoomTx, a: Doc<'attempts'>, response: ModelResponse | null, late: boolean) {
  const ctx = tx.ctx;
  if (a.usage) return;
  const live = a.provenance === 'live';
  if (response && Object.values(response.usage).some(n => !Number.isSafeInteger(n) || n < 0)) throw appError('internal');
  const costMicroUsd = response && live ? estimateCostMicroUsd(response.usage, a.model)?.microUsd ?? 0 : 0;
  const run = await ctx.db.get(a.runId);
  const firstSettlement = a.status === 'running';
  if (run) await tx.tx.patch('runs', run._id, { reservedMicroUsd: Math.max(0, run.reservedMicroUsd - (firstSettlement ? a.reservedMicroUsd : 0)), spentMicroUsd: run.spentMicroUsd + costMicroUsd });
  if (live) {
    const counter = await ctx.db.query('spendCounters').withIndex('by_scope_day', q => q.eq('scope', 'global').eq('day', a.reservedDay)).unique();
    if (counter) await patchGlobal(ctx,'spendCounters',counter._id, { reservedMicroUsd: Math.max(0, counter.reservedMicroUsd - (firstSettlement ? a.reservedMicroUsd : 0)), spentMicroUsd: counter.spentMicroUsd + costMicroUsd, unknownCostAttempts: Math.max(0, counter.unknownCostAttempts + (response ? firstSettlement ? 0 : -1 : firstSettlement ? 1 : 0)) });
  }
  if (!response) return;
  if(late){await tx.tx.patch('attempts',a._id,{usage:response.usage,lateUsage:true,costMicroUsd,priceTableAsOf:PRICE_TABLE_AS_OF});return;}
  const bytes = new TextEncoder().encode(response.rawText);
  let text = new TextDecoder().decode(bytes.slice(0, 65536));
  while (new TextEncoder().encode(text).length > 65536) text = text.slice(0, -1);
  const rawOutputRef = await insertGlobal(ctx,'rawOutputs', { attemptId: a._id, roomId: a.roomId, text, truncated: bytes.length > 65536, createdAt: nowMs(ctx), expiresAt: nowMs(ctx) + (process.env.DEPLOYMENT_TIER === 'prod' ? 7 : 30) * 86400000 });
  await tx.tx.patch('attempts', a._id, { usage: response.usage, lateUsage: late, costMicroUsd, priceTableAsOf: PRICE_TABLE_AS_OF, stopReason: response.stopReason, stopCategory: response.stopCategory, ...(response.requestId ? { requestId: response.requestId } : {}), ...(response.messageId ? { messageId: response.messageId } : {}), ...(response.responseModel ? { responseModel: response.responseModel } : {}), rawOutputRef, outputBytes: bytes.length });
}
export async function commitAttempt(ctx: MutationCtx, args: { attemptId: Id<'attempts'>; actorUserId: Id<'users'> | null; move?: NonNullable<Doc<'turns'>['result']>; response?: ModelResponse; outcome?: FailOutcome; schemaVersion?: string; latencyMs: number; rationaleTruncated?:boolean }) {
  let g = await attemptGuard(ctx, args.attemptId);
  if (!g.attempt || !g.room) return;
  const response = args.response ?? (args.outcome && 'response' in args.outcome ? args.outcome.response : null);
  if (!g.g0 && (g.attempt.usage || !response) && (!g.run || await decideReconcile(ctx, g.run._id) === 'noop')) return;
  const tx = await openRoomTx(ctx, g.room._id, [g.room.status], args.actorUserId);
  if (!g.g0) {
    if (!g.attempt.usage && response) await settle(tx, g.attempt, response, true);
    if (g.run) await reconcileRun(tx, g.run._id);
    return;
  }
  if(args.move){await rollLocalDateTx({...ctx,tx:tx.tx},g.room._id,nowMs(ctx),true);g=await attemptGuard(ctx,args.attemptId);}
  if(!g.attempt)return;
  await settle(tx, g.attempt, response, Boolean(g.guard));
  if (g.guard || args.outcome?.kind === 'stale_context') {
    await setStatus(tx, { table: 'attempts', id: g.attempt._id, patch: { status: 'stale', finishedAt: nowMs(ctx), ...(g.guard ? { staleGuard: g.guard } : {}) } });
    if (g.turn && g.run && g.guard) {
      if (!TURN_TERMINAL.has(g.turn.status)) await setStatus(tx, { table: 'turns', id: g.turn._id, patch: { status: 'stale', completedAt: nowMs(ctx) } });
      await appendEvents(tx, [{ type: 'turn_rejected_stale', runNo: g.run.runNo, turnSeq: g.turn.turnSeq, guard: g.guard }], { runId: g.run._id });
    }
    if (g.run) await reconcileRun(tx, g.run._id);
    return;
  }
  if (!g.turn || !g.run) return;
  await tx.tx.patch('attempts', g.attempt._id, { ...(args.schemaVersion ? { schemaVersion: args.schemaVersion } : {}), latencyMs: args.latencyMs });
  const move = args.move;
  const ex = await exclusions(ctx, g.run._id);
  let invalid: string | null = null;
  if (move) {
    if (!g.turn.allowedActions.includes(move.action)) invalid = 'action.not_allowed_for_role';
    if ('optionKey' in move) {
      const selected = g.turn.candidateSnapshot.find(c => c.optionKey === move.optionKey);
      if (!selected) invalid = 'action.option_not_in_snapshot';
      else if ((g.turn.role === 'provider' ? ex.provider : ex.rejected).includes(selected.candidateKey)) invalid = 'action.repeats_blocked';
    }
    if ('baseProposalVersion' in move && move.baseProposalVersion !== g.turn.baseProposalVersion) invalid = 'output.unknown_reference';
    if ('proposalVersion' in move && move.proposalVersion !== (g.turn.baseProposalVersion ?? null)) invalid = 'output.unknown_reference';
    if (move.action === 'clarify' && !plugin.protocol.topics.some(t => t.topicKey === move.topicKey && t.toRole === move.toRole && t.askableBy.includes(g.turn!.role))) invalid = 'action.not_allowed_for_role';
    if (move.action === 'reject' && (!plugin.protocol.reasonKeys.some(r => r.reasonKey === move.reasonKey && r.usableBy.includes(g.turn!.role)) || (g.turn.kind === 'propose' && (move.proposalVersion !== null || move.reasonKey !== 'cannot_deliver')))) invalid = 'output.unknown_reference';
    if (move.action === 'escalate' && !['customer', 'provider', 'finance'].includes(move.toRole)) invalid = 'action.not_allowed_for_role';
  }
  if (!move || invalid) {
    const outcome = invalid ? { kind: 'invalid_output' as const, errorCode: invalid, response: null } : args.outcome;
    if (!outcome) return;
    await failAttempt(tx, g.attempt, g.turn, outcome);
    return;
  }
  const normalized = { ...move, rationale: Array.from(move.rationale).slice(0, 1200).join('') };
  await setStatus(tx, { table: 'attempts', id: g.attempt._id, patch: { status: 'completed', move: normalized, rationaleTruncated: args.rationaleTruncated===true||normalized.rationale !== move.rationale, finishedAt: nowMs(ctx) } });
  await setStatus(tx, { table: 'turns', id: g.turn._id, patch: { status: 'completed', result: normalized, completedAt: nowMs(ctx) } });
  await appendEvents(tx, [{ type: 'turn_completed', runNo: g.run.runNo, turnSeq: g.turn.turnSeq, role: g.turn.role }], { runId: g.run._id });
  await applyMove(tx, (await ctx.db.get(g.turn._id))!, normalized);
}
async function failAttempt(tx: RoomTx, a: Doc<'attempts'>, turn: Doc<'turns'>, outcome: Exclude<FailOutcome, { kind: 'stale_context' }>) {
  const ctx = tx.ctx;
  await setStatus(tx, { table: 'attempts', id: a._id, patch: { status: outcome.kind, errorCode: outcome.errorCode, ...(outcome.issuePaths?{issuePaths:outcome.issuePaths}:{}), finishedAt: nowMs(ctx), ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }), ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }) } });
  const decision = decideRetry({ origin: a.origin, status: outcome.kind, ...(outcome.kind === 'invalid_output' ? { reasonCode: outcome.errorCode } : { errorCode: outcome.errorCode }) }, Math.random);
  if (decision.kind === 'retry') {
    const beginFnId = await ctx.scheduler.runAfter(decision.delayMs, beginRef, { turnId: turn._id, origin: 'auto_retry', actorUserId: tx.actorUserId, ...(decision.retryNote ? { retryNote: decision.retryNote } : {}) });
    await tx.tx.patch('turns', turn._id, { waitingReason: 'backoff', beginFnId });
  } else {
    await setStatus(tx, { table: 'turns', id: turn._id, patch: { status: 'failed', waitingReason: undefined, beginFnId: undefined, completedAt: nowMs(ctx) } });
    await onTurnFailed(tx, turn, { failureKind: outcome.kind, errorCode: outcome.errorCode, attemptId: a._id });
  }
}

export async function replaceTurnTx(tx: RoomTx, turn: Doc<'turns'>) {
  for (const a of await tx.ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id)).collect()) if (a.status === 'running') {
    await settle(tx, a, null, true);
    await setStatus(tx, { table: 'attempts', id: a._id, patch: { status: 'stale', staleGuard: 'G2', finishedAt: nowMs(tx.ctx) } });
  }
  if (!TURN_TERMINAL.has(turn.status)) await setStatus(tx, { table: 'turns', id: turn._id, patch: { status: 'stale', completedAt: nowMs(tx.ctx) } });
  return createTurnTx(tx, turn.runId, { role: turn.role, kind: turn.kind, baseProposalId: turn.baseProposalId, retryOfTurnId: turn._id });
}
export async function reconcileRun(tx: RoomTx, runId: Id<'runs'>): Promise<'noop' | 'repaired' | 'redispatched' | 'replaced' | 'needs_input' | 'advanced'> {
  const ctx = tx.ctx;
  for (const finding of await findRoomFindings(ctx, tx.room._id)) reconcileOpsLog(finding.code, finding.check);
  const run = await ctx.db.get(runId);
  const room = await ctx.db.get(tx.room._id);
  if (!run || !room || terminalRun(run)) return 'noop';
  if (room.status !== 'open' || room.currentRunId !== run._id) {
    // A stale old run can never spawn a new chain.
    if (room.currentRunId === run._id) await disposeCurrentRun(tx, 'room_closed');
    else await disposeCurrentRun(tx, 'constraints_changed', runId);
    return 'repaired';
  }
  if (run.constraintsVersionAtStart !== room.constraintsVersion) { await disposeCurrentRun(tx, 'constraints_changed'); await startRunTx(tx, { cause: 'constraints_changed', origin: 'system' }); return 'replaced'; }
  if (run.status !== 'negotiating') return 'noop';
  const turns = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId)).collect();
  const turn = turns.find(t => t.turnSeq === run.activeTurnSeq);
  if (!turn) { await advanceRun(tx, runId); return 'repaired'; }
  if (turn.status === 'stale') { await replaceTurnTx(tx, turn); return 'replaced'; }
  if (turn.status === 'failed') {
    const open = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', runId).eq('status', 'open')).unique();
    if (open) return 'noop';
    await openHumanRequestTx(tx, runId, { kind: 'agent_failed', toRole: turn.role, sourceTurnId: turn._id });
    return 'needs_input';
  }
  if (turn.status === 'completed') { await advanceRun(tx, runId); return 'advanced'; }
  const attempts = await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id)).collect();
  if (attempts.find(a => a.attemptNo === turn.currentAttemptNo)?.status === 'stale') { await replaceTurnTx(tx, turn); return 'replaced'; }
  if (attempts.some(a => a.status === 'running')) return 'noop';
  if (turn.beginFnId) {
    const id = ctx.db.system.normalizeId('_scheduled_functions', turn.beginFnId);
    const scheduled = id ? await ctx.db.system.get(id) : null;
    if (scheduled?.state.kind === 'pending' || scheduled?.state.kind === 'inProgress') return 'noop';
  }
  const result = await beginAttemptTx(tx, turn._id, { origin: turn.currentAttemptNo ? 'auto_retry' : 'turn_start', delayMs: 0 });
  if (result.kind === 'stale') { await replaceTurnTx(tx, (await ctx.db.get(turn._id))!); return 'replaced'; }
  return result.kind === 'limit' ? 'needs_input' : result.kind === 'dispatched' ? 'redispatched' : 'noop';
}
export async function watchdog(ctx: MutationCtx, attemptId: Id<'attempts'>) {
  const a = await ctx.db.get(attemptId);
  if (!a || a.status !== 'running') return;
  for (const finding of await findRoomFindings(ctx, a.roomId)) reconcileOpsLog(finding.code, finding.check);
  const id = a.actionFnId ? ctx.db.system.normalizeId('_scheduled_functions', a.actionFnId) : null;
  const sf = id ? await ctx.db.system.get(id) : null;
  const kind = sf?.state.kind;
  if ((kind === 'pending' || kind === 'inProgress') && a.watchdogArmCount < 3) {
    const room = await ctx.db.get(a.roomId);
    if (!room) return;
    const tx=await openRoomTx(ctx, room._id, [room.status]);
    const watchdogFnId = await ctx.scheduler.runAfter(WATCHDOG_REARM_MS, watchdogRef, { attemptId });
    await tx.tx.patch('attempts', attemptId, { watchdogFnId, watchdogArmCount: a.watchdogArmCount + 1, deadlineAt: nowMs(ctx) + WATCHDOG_REARM_MS });
    return;
  }
  await commitAttempt(ctx, { attemptId, actorUserId: null, latencyMs: 0, outcome: { kind: kind === 'pending' || kind === 'inProgress' ? 'timeout' : 'error', errorCode: kind === 'pending' || kind === 'inProgress' ? 'watchdog_timeout' : kind === 'failed' ? 'action_crashed' : 'internal', response: null } });
}

/** Read-only decision shared by registered reconcile and duplicate-commit paths. */
export async function decideReconcile(ctx: Pick<QueryCtx, 'db'>, runId: Id<'runs'>): Promise<'noop' | 'write'> {
  const run = await ctx.db.get(runId);
  if (run) for (const finding of await findRoomFindings(ctx, run.roomId)) reconcileOpsLog(finding.code, finding.check);
  if (!run || terminalRun(run)) return 'noop';
  const room = await ctx.db.get(run.roomId);
  if (!room) return 'noop';
  if (room.status !== 'open' || room.currentRunId !== runId || run.constraintsVersionAtStart !== room.constraintsVersion) return 'write';
  if (run.status !== 'negotiating') return 'noop';
  const turn = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', runId).eq('turnSeq', run.activeTurnSeq ?? -1)).unique();
  if (!turn || TURN_TERMINAL.has(turn.status)) return 'write';
  const attempts = await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', turn._id)).collect();
  if (attempts.find(a => a.attemptNo === turn.currentAttemptNo)?.status === 'stale') return 'write';
  if (attempts.some(a => a.status === 'running')) return 'noop';
  if (turn.beginFnId) {
    const id = ctx.db.system.normalizeId('_scheduled_functions', turn.beginFnId);
    const sf = id ? await ctx.db.system.get(id) : null;
    if (sf?.state.kind === 'pending' || sf?.state.kind === 'inProgress') return 'noop';
  }
  if (turn.waitingReason === 'draining' && run.agentMode === 'live') {
    const flags = await ctx.db.query('opsFlags').withIndex('by_key', q => q.eq('key', 'global')).unique();
    if (flags?.draining) return 'noop';
  }
  return 'write';
}

export async function onTurnFailed(tx: RoomTx, turn: Doc<'turns'>, failure: { failureKind: 'invalid_output' | 'refused' | 'timeout' | 'error'; errorCode: string; attemptId?: Id<'attempts'> }) {
  const run = (await tx.ctx.db.get(turn.runId))!;
  await tx.tx.patch('runs', run._id, { lastFailure: { code: failure.errorCode, at: nowMs(tx.ctx) } });
  await appendEvents(tx, [{ type: 'turn_failed', runNo: run.runNo, turnSeq: turn.turnSeq, role: turn.role, failureKind: failure.failureKind }], { runId: run._id }, failure.attemptId ? { table: 'attempts', id: failure.attemptId } : undefined);
  await openHumanRequestTx(tx, run._id, { kind: 'agent_failed', toRole: turn.role, sourceTurnId: turn._id });
}

/** Compose ports at call time; no module initialization reads lifecycle bindings. */
function makeConstraintTx(ctx: Parameters<typeof createConstraintTx>[0], roomId: Id<'rooms'>) {
  return createConstraintTx(ctx, roomId, { disposeCurrentRun, startRunTx, openIfReady });
}
async function rollLocalDateTx(ctx: Parameters<typeof rollLocalDateWith>[1], roomId: Id<'rooms'>, now: number, lockHeld: boolean) {
  return rollLocalDateWith(async (roomCtx, id, today) => {
    await bumpConstraint(makeConstraintTx(roomCtx, id), { cause: 'clock', sourceRefs: [{ kind: 'clock', localDate: today }], depth: 0 });
  }, ctx, roomId, now, lockHeld);
}
