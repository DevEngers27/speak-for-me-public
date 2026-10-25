// W2-2 document adapters and integrated approval orchestration.
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { ConvexError } from 'convex/values';
import { appError } from '../lib/errors';
import { cents, isoDate, checkProposal, projectEvaluation, evaluateApprovalSet } from '@core/engine';
import type { ScenarioPlugin, RuleInputBase, Materialized, EventPayload } from '@core/engine';
import { publicOpsLog } from '../lib/opsLog';
import type { RoomTx } from '../lib/db';
import { appendEvents } from './events';
import { bindRoomTx, setStatus } from './runtimeTx';
import { createTurnTx, openHumanRequestTx, closeOpenHumanRequestsTx } from './runs';
import { loadRuleInput as loadRuntimeInput } from './runtimeSources';
import { scopeChangePlugin } from '@core/scenarios/scope-change';
export type Role = Doc<'members'>['role'];
export type ReadCtx = QueryCtx | MutationCtx;
export type Input = RuleInputBase & { requiredItemKeys: readonly string[] | undefined; deadline: ReturnType<typeof isoDate> | undefined };

export type Tx = { ctx: MutationCtx; room: Doc<'rooms'>; now: number; roomTx: RoomTx };
export async function appendEvent(tx: Tx, payload: EventPayload, member?: Doc<'members'>, restrictedRef?: Doc<'events'>['restrictedRef'], refs: Doc<'events'>['refs'] = {}) {
  await appendEvents(tx.roomTx, [{ payload: payload as Doc<'events'>['payload'], actor: member ? { kind: 'user', role: member.role } : { kind: 'system' }, ...(member ? { actorUserId: member.userId } : {}), ...(restrictedRef ? { restrictedRef } : {}), refs }]);
}
// Main now supplies the complete pinned W1-3 scenario contract.
export const auditScenario: ScenarioPlugin<Input> = scopeChangePlugin;
export function scenarioOf(room: Pick<Doc<'rooms'>, 'scenarioKey' | 'scenarioVersion'>) { return room.scenarioKey === auditScenario.id.key && room.scenarioVersion === auditScenario.id.version ? auditScenario : null; }
export const humanReasonKeys = scopeChangePlugin.humanReasonKeys ?? [];
export function visibleReason(key: string | undefined, role: Role) { const decl = humanReasonKeys.find(k => k.key === key); return decl && (decl.audience === 'room' || role !== 'provider') ? decl.key : null; }
export async function loadRuleInput(ctx: ReadCtx, room: Doc<'rooms'>) {
  const scenario = scenarioOf(room);
  // Diagnostic queries remain readable after an unavailable pinned version.
  // Approval checks still reject that version before accepting a decision.
  const { full: input, data } = await loadRuntimeInput(ctx, scenario ? room : {...room,scenarioKey:'scope_change' as const,scenarioVersion:auditScenario.id.version});
  const briefs = data.briefs, catalogItems = data.catalog.filter(row => row.status !== 'draft');
  const ledgerEntries = data.ledger, sharedFacts = data.facts;
  const latestFacts = new Map<string, Doc<'sharedFacts'>>();
  for (const fact of sharedFacts) { const key = `${fact.fromRole}:${fact.field}`; const previous = latestFacts.get(key); if (!previous || fact.seq > previous.seq) latestFacts.set(key, fact); }
  const activeFacts = [...latestFacts.values()].filter(fact => briefs.find(row => row.role === fact.fromRole)?.version === fact.briefVersion);
  const disclosures = Object.fromEntries(activeFacts.filter(f => f.value !== null).map(f => [f.field, f.audience]));
  return { scenario, input, ledgerEntries, catalogItems, briefs, sharedFacts: activeFacts, disclosures };
}
export function asEngineProposal(p: Doc<'proposals'>): Materialized { return { ...p, terms: { ...p.terms, amountCents: cents(p.terms.amountCents), deliveryDate: isoDate(p.terms.deliveryDate) }, lines: p.lines.map(l => ({ ...l, priceCents: cents(l.priceCents) })), plannedTasks: p.plannedTasks.map(t => ({ ...t, dueDate: isoDate(t.dueDate) })) }; }
export function approvalRows(rows: readonly Doc<'approvals'>[]) { return rows.map(r => ({ ...r, id: r._id })); }
// Adapt optional Convex references to the canonical barrel contract; no predicate copy.
export function currentApprovalInput(room: Doc<'rooms'>, run: Doc<'runs'> | null, proposal: Doc<'proposals'>) {
  return { room: { status: room.status, currentRunId: room.currentRunId ?? null }, run: run ? { _id: run._id, status: run.status, currentProposalId: run.currentProposalId ?? null } : null, proposal: { _id: proposal._id, status: proposal.status } };
}
export async function approvalVerdict(ctx: ReadCtx, room: Doc<'rooms'>, proposal: Doc<'proposals'>, role: Role) {
  const loaded = await loadRuleInput(ctx, room);
  if (!loaded.scenario || loaded.input.capCents === undefined || loaded.input.committedCents === undefined || !loaded.input.requiredItemKeys || !loaded.input.deadline) throw appError('run.invalid_state', { guard: 'scenario_version' });
  const verdict = checkProposal(loaded.scenario, loaded.input, asEngineProposal(proposal));
  const projected = projectEvaluation(verdict, role, loaded.scenario, loaded.disclosures);
  const reasonCodes = projected.audience === 'provider' ? [] : [...new Set([...projected.checks.flatMap(c => c.status === 'fail' && c.code ? [c.code] : []), ...(projected.masked ? ['private.constraint_unmet' as const] : [])])];
  if (!verdict.passesChecks) {
    publicOpsLog('approval.not_executable', { fn: 'approvals.record' });
    throw new ConvexError({ code: 'approval.not_executable', params: role === 'provider' ? {} : { reasonCodes } });
  }
  return { ...loaded, verdict };
}
/** Reject shares the caller's lock and the runtime's sole scheduling chain. */
export async function onProposalRejected(tx: Tx, run: Doc<'runs'>, proposal: Doc<'proposals'>) {
  const runtime = bindRoomTx(tx.ctx, tx.roomTx);
  await setStatus(runtime, {table:'proposals',id:proposal._id,patch:{status:'rejected',statusChangedAt:tx.now}});
  await appendEvent(tx, {type:'proposal_status_changed',proposalVersion:proposal.version,to:'rejected'}, undefined, undefined, {runId:run._id,proposalId:proposal._id});
  await closeOpenHumanRequestsTx(runtime, run._id, 'regenerated');
  if (!scenarioOf(tx.room)) {
    await openHumanRequestTx(runtime,run._id,{kind:'agent_failed',toRole:'provider',retryAllowed:false});
  } else if (run.roundNo >= run.maxRounds) {
    await openHumanRequestTx(runtime,run._id,{kind:'rounds_exhausted',toRole:'customer',cause:'rounds'});
  } else {
    await setStatus(runtime,{table:'runs',id:run._id,patch:{status:'negotiating',roundNo:run.roundNo+1,activeTurnSeq:null}});
    await createTurnTx(runtime,run._id,{role:'provider',kind:'propose'});
  }
}

/** Shared read-side adapter; slot classification stays in evaluateApprovalSet. */
export async function loadApprovalSet(ctx: ReadCtx, room: Doc<'rooms'>, proposal: Doc<'proposals'>) {
  const members = await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',room._id)).collect();
  const rows = await ctx.db.query('approvals').withIndex('by_proposal_user',q=>q.eq('proposalId',proposal._id)).collect();
  return evaluateApprovalSet({required:proposal.requiredApprovals,members,rows:approvalRows(rows),roomConstraintsVersion:room.constraintsVersion,termsKey:proposal.termsKey});
}
