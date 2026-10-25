import { rollLocalDateTx } from './clock';
import {assertDailyConstraintBucket} from './constraintRates';
import {nowMs} from '../lib/time';
import {appendSharedFact,materializeDisclosures} from './sharedFacts';
import {insertBriefVersion} from './briefs';
import { setStatus, appendEvents, assertWithinRate, type RoomTx } from './runtimeTx';
import { loadRuleInput, roleView } from './runtimeSources';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { addDays, isoDate, isCents, enumerateCandidates, answerEffect, type Role } from '@core/engine';
import { publicOpsLog } from '../lib/opsLog';
import { appError } from '../lib/errors';
import { plugin, checkStored } from './_parallelStubs.w2-4';
import { createTurnTx, draining, disposeCurrentRun, exclusions, insertProposal, openHumanRequestTx, precheck, withConstraintChange, RESERVE_MICRO_USD } from './runs';
/** Public entries run these read-only guards before acquiring the room lock. */
export async function prepareHumanAnswer(ctx: MutationCtx, request: Doc<'humanRequests'>, optionKey: string, role: Role, actorUserId: Id<'users'> | null) {
  const run = await ctx.db.get(request.runId);
  const room = (await ctx.db.get(request.roomId))!;
  if (role !== request.toRole) throw appError('auth.role_forbidden');
  if (request.status !== 'open') {
    if (request.status === 'answered' && request.answeredBy === actorUserId && request.answerOptionKey === optionKey) return null;
    throw appError('request.not_open');
  }
  if (nowMs(ctx) >= request.expiresAt) throw appError('request.not_open');
  if (room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
  if (!run || room.currentRunId !== run._id || run.status !== 'needs_input') throw appError('run.invalid_state', { guard: 'run_status' });
  const option = request.options.find(o => o.optionKey === optionKey);
  if (!option || option.effect.type === 'blocked') throw appError('request.option_unknown');
  const effect = option.effect;
  if (effect.type !== 'end_run' && await draining(ctx)) throw appError('run.draining');
  await assertWithinRate(ctx, room._id, actorUserId);
  return { run, room, effect };
}
export type PreparedHumanAnswer = NonNullable<Awaited<ReturnType<typeof prepareHumanAnswer>>>;

/** The caller owns the RoomTx, including its event sequence. */
export async function applyHumanAnswer(tx: RoomTx, request: Doc<'humanRequests'>, optionKey: string, role: Role, prepared?: PreparedHumanAnswer) {
  const ctx = tx.ctx;
  const plan = prepared ?? await prepareHumanAnswer(ctx, request, optionKey, role, tx.actorUserId);
  if (!plan) return { outcome: 'already_answered' as const };
  const { run, effect } = plan;
  let {room}=plan;
  if(effect.type==='choose_candidate'){
    await rollLocalDateTx({...ctx,tx:tx.tx},room._id,nowMs(ctx),true);
    room=(await ctx.db.get(room._id))!;
    if(room.currentRunId!==run._id){const next=room.currentRunId?await ctx.db.query('humanRequests').withIndex('by_run_status',q=>q.eq('runId',room.currentRunId!).eq('status','open')).first():null;if(!next)throw appError('request.not_open');return {outcome:'regenerated' as const,requestId:next._id};}
  }
  if(['raise_cap','drop_items','extend_deadline'].includes(effect.type))await assertDailyConstraintBucket(ctx,room,'hard_fields');
  if (effect.type !== 'choose_candidate') await setStatus(tx, { table: 'humanRequests', id: request._id, patch: { status: 'answered', answeredBy: tx.actorUserId!, answerOptionKey: optionKey, answeredAt: nowMs(ctx) } });
  await appendEvents(tx, [{ type: 'human_request_answered', runNo: run.runNo }], { runId: run._id }, { table: 'humanRequests', id: request._id });
  let proposalId: Id<'proposals'> | null = null;
  const source = request.sourceTurnId ? await ctx.db.get(request.sourceTurnId) : null;
  if (effect.type === 'end_run') await disposeCurrentRun(tx, 'no_agreement');
  else if (effect.type === 'raise_cap' || effect.type === 'drop_items' || effect.type === 'extend_deadline') {
    const { full, data } = await loadRuleInput(ctx, room);
    const brief = data.briefs.find(b => b.role === role);
    if (!brief) throw appError('internal');
    let hardFields = brief.hardFields;
    if (effect.type === 'raise_cap') {
      if (role !== 'finance' || !isCents(effect.amountCents)) throw appError('disclosure.blocked');
      if (effect.amountCents < (full.committedCents ?? 0)) throw appError('budget.below_committed', { minAllowedCapCents: full.committedCents ?? 0 });
      hardFields = { schemaKey: 'scope_change.finance.v1', capCents: effect.amountCents };
    } else if (effect.type === 'drop_items') {
      if (role !== 'customer' || !('requiredItemKeys' in hardFields)) throw appError('disclosure.blocked');
      const requiredItemKeys = hardFields.requiredItemKeys.filter(k => !effect.itemKeys.includes(k));
      if (!requiredItemKeys.length) throw appError('item.required_missing', { field: 'requiredItemKeys' });
      hardFields = { ...hardFields, requiredItemKeys };
    } else {
      if (role !== 'customer' || !('deadline' in hardFields)) throw appError('disclosure.blocked');
      if (effect.date < room.localDate || effect.date > addDays(isoDate(room.localDate), 365)) throw appError('date.out_of_range', { field: 'deadline' });
      try { isoDate(effect.date); } catch { throw appError('date.out_of_range', { field: 'deadline' }); }
      hardFields = { ...hardFields, deadline: effect.date };
    }
    const changed = await withConstraintChange(tx, { cause: 'human_answer' }, async () => {
      const next = await insertBriefVersion(tx.tx,{userId:tx.actorUserId!},{role,hardFields,softFields:brief.softFields,disclosures:brief.disclosures,source:'request_answer',humanRequestId:request._id});
      await materializeDisclosures(ctx,tx.tx,next,{userId:tx.actorUserId!});
      await appendEvents(tx,[{type:'brief_confirmed',role,version:next.version,hardChanged:JSON.stringify(brief.hardFields)!==JSON.stringify(hardFields)}],{},{table:'briefs',id:next._id});
      const briefId=next._id;
      return [{ kind: 'humanRequest', humanRequestId: request._id }, { kind: 'brief', briefId, role, version: brief.version + 1 }];
    });
    if (!changed.changed) { publicOpsLog('request.effect_noop', { fn: 'humanRequests.answer' }); await precheck(tx, run._id); }
  } else if (effect.type === 'choose_candidate') {
    if (role !== 'customer') throw appError('auth.role_forbidden');
    const { full } = await loadRuleInput(ctx, room);
    const choices = enumerateCandidates(plugin, full, { mode: 'feasibility' }).items;
    const selected = choices.find(c => c.candidateKey === effect.candidateKey);
    const current = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
    if (selected && current?.status === 'active' && current.candidateKey === selected.candidateKey && checkStored(full, current).passesChecks) proposalId = current._id;
    else if (selected) proposalId = await insertProposal(tx, run._id, selected, { type: 'human_choice', requestId: request._id });
    if (!proposalId) {
      await setStatus(tx, { table: 'humanRequests', id: request._id, patch: { status: 'superseded', closedReason: 'regenerated', closedAt: nowMs(ctx), answeredBy: tx.actorUserId!, answerOptionKey: optionKey, answeredAt: nowMs(ctx) } });
      await appendEvents(tx, [{ type: 'human_request_closed', runNo: run.runNo, status: 'superseded' }], { runId: run._id }, { table: 'humanRequests', id: request._id });
      const requestId = await openHumanRequestTx(tx, run._id, { kind: request.kind, toRole: role, sourceTurnId: request.sourceTurnId, topicKey: request.topicKey });
      return { outcome: 'regenerated' as const, requestId };
    }
    await setStatus(tx, { table: 'humanRequests', id: request._id, patch: { status: 'answered', answeredBy: tx.actorUserId!, answerOptionKey: optionKey, answeredAt: nowMs(ctx) } });
    await setStatus(tx, { table: 'runs', id: run._id, patch: { status: 'pending_approval', currentProposalId: proposalId, activeTurnSeq: null } });
    const proposal = (await ctx.db.get(proposalId))!;
    await appendEvents(tx, [{ type: 'run_awaiting_approval', runNo: run.runNo, proposalVersion: proposal.version }], { runId: run._id, proposalId });
  } else if (effect.type === 'disclose') {
    const declaration = plugin.fields.find(f => f.key === effect.field && f.owner === role && f.class !== 'note');
    if (!declaration || effect.toRoles.some(r => !declaration.disclosableTo.includes(r) || r === role)) throw appError('disclosure.blocked');
    const { own } = await roleView(ctx, room, role);
    if (!own) throw appError('disclosure.needs_own_confirmation', { field: effect.field });
    const ownFields = { ...own.hardFields, ...own.softFields } as Record<string, unknown>;
    const full = (await loadRuleInput(ctx, room)).full;
    const raw = effect.field === 'headroomCents' && role === 'finance' ? full.headroomCents : effect.field === 'committedCents' && role === 'finance' ? full.committedCents : ownFields[effect.field];
    const value: Doc<'sharedFacts'>['value'] = declaration.valueKind === 'cents' && typeof raw === 'number' ? { kind: 'cents', cents: raw } : declaration.valueKind === 'isoDate' && typeof raw === 'string' ? { kind: 'date', date: raw } : declaration.valueKind === 'itemKeys' && Array.isArray(raw) ? { kind: 'itemKeys', itemKeys: raw as string[] } : null;
    if (!value) throw appError('disclosure.blocked');
    const latest = await ctx.db.query('sharedFacts').withIndex('by_room_from_field', q => q.eq('roomId', room._id).eq('fromRole', role).eq('field', effect.field)).order('desc').first();
    const shared = await appendSharedFact(tx.tx, { fromRole:role,field:effect.field,value, audience: [...new Set([...(latest?.audience ?? []), ...effect.toRoles])], briefVersion: own.version, source: 'request_answer', humanRequestId: request._id, createdBy: tx.actorUserId,  });
    if(shared.changed)await appendEvents(tx,[{type:'disclosure_changed',fromRole:role}],{}, {table:'sharedFacts',id:shared.id});
    if (request.kind === 'clarify' && source) { await setStatus(tx, { table: 'runs', id: run._id, patch: { status: 'negotiating' } }); await createTurnTx(tx, run._id, { role: source.role, kind: source.kind, baseProposalId: source.baseProposalId }); }
    else await precheck(tx, run._id);
  } else if (effect.type === 'retry_turn') {
    if (!source || source.status !== 'failed') throw appError('run.invalid_state', { guard: 'no_failed_turn' });
    await setStatus(tx, { table: 'runs', id: run._id, patch: { status: 'negotiating' } });
    await createTurnTx(tx, run._id, { role: source.role, kind: source.kind, baseProposalId: source.baseProposalId, retryOfTurnId: source._id, origin: 'retry_turn' });
  } else if (effect.type === 'pass_to_next') {
    const order = ['customer', 'finance'];
    const history = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', run._id)).collect();
    const used = history.some(r => r._id !== request._id && r.toRole === role && r.status === 'answered' && r.options.find(o => o.optionKey === r.answerOptionKey)?.effect.type === 'pass_to_next');
    if (request.kind !== 'infeasible' || order[order.indexOf(role) + 1] !== effect.toRole || used) throw appError('request.option_unknown');
    await openHumanRequestTx(tx, run._id, { kind: 'infeasible', toRole: effect.toRole, rerouted: true });
  } else {
    const ex = await exclusions(ctx, run._id);
    const { view } = await roleView(ctx, room, 'provider');
    const available = enumerateCandidates(plugin, view, { mode: 'feasibility', excludedCandidateKeys: ex.provider }).items.length > 0;
    const decision = answerEffect({ kind: 'keep_as_is' }, request, { plugin, keepAsIsUsed: run.roundsExtended, canContinue: run.attemptCount < run.maxAttempts && (run.agentMode === 'stub' || run.spentMicroUsd + run.reservedMicroUsd + RESERVE_MICRO_USD <= run.spendCapMicroUsd), providerHasCandidates: available, proposalCounts: { provider: ex.turns.filter(t => t.result?.action === 'propose').length } });
    if (decision.next === 'ended_no_agreement' || (decision.next === 'next_round' && run.roundNo >= run.maxRounds)) await disposeCurrentRun(tx, 'no_agreement');
    else {
      const extend = decision.next === 'extend_round';
      const same = decision.next === 'same_turn';
      await setStatus(tx, { table: 'runs', id: run._id, patch: { status: 'negotiating', ...(extend ? { roundsExtended: true, maxRounds: run.maxRounds + 1 } : {}), ...(!same ? { roundNo: run.roundNo + 1 } : {}) } });
      await createTurnTx(tx, run._id, { role: same && source ? source.role : 'provider', kind: same && source ? source.kind : 'propose', ...(same && source?.baseProposalId ? { baseProposalId: source.baseProposalId } : {}) });
    }
  }
  const updated = (await ctx.db.get(room._id))!;
  const resumed = updated.currentRunId === run._id ? await ctx.db.get(run._id) : null;
  if (resumed?.status === 'negotiating') await appendEvents(tx, [{ type: 'run_resumed', runNo: resumed.runNo, roundNo: resumed.roundNo }], { runId: resumed._id });
  return { outcome: 'applied' as const, effect: effect.type, constraintsVersion: updated.constraintsVersion, runId: updated.currentRunId ?? null, proposalId };
}
