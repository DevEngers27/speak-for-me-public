/** Minimal public boundary logger (15 §15.6.2). No exception text enters logLines. */
export type { InternalCtx } from './functions';
export type ErrorClassName = 'TypeError' | 'RangeError' | 'SyntaxError' | 'ArgumentValidationError' | 'Other';
export type PublicFnName = 'testing.listRoomIds' | 'testing.checkLiveness' | 'health.ping' | 'health.whoami'
  | 'users.viewer' | 'users.ensureViewer' | 'users.resolve' | 'users.validateReturnIds'
  | 'rooms.create' | 'rooms.forceClose' | 'rooms.close' | 'rooms.view' | 'rooms.listMine'
  | 'invites.create' | 'invites.createLink' | 'invites.authorizeLink' | 'invites.insertLink' | 'invites.listMine' | 'invites.accept'
  | 'briefs.updateSoft' | 'humanRequests.get' | 'briefs.confirm' | 'briefs.mine' | 'budget.setCap' | 'ledger.recordBaseline'
  | 'sharedFacts.add' | 'catalog.confirm' | 'catalog.retire' | 'catalog.list' | 'timeline.page'
  | 'rooms.startFollowUp' | 'rooms.previewChange'
  | 'runs.start' | 'runs.retryTurn' | 'runs.requestRenegotiation' | 'runs.cancel' | 'runs.reconcile'
  | 'humanRequests.answer' | 'humanRequests.expireDue' | 'approvals.record' | 'proposals.get'
  | 'tasks.markDone' | 'executions.forRoom' | 'turns.mine' | 'turns.beginAttempt' | 'turns.complete' | 'turns.fail'
  | 'agents.loadTurnContext' | 'agents.runAttempt' | 'agents.watchdog' | 'clock.rollLocalDate'
  | 'ops.configHealth' | 'ops.activeAttemptCount' | 'ops.metrics' | 'ops.auditUsers'
  | 'ops.setDraining' | 'ops.livenessSweep' | 'ops.purgeRawOutputs' | 'privacy.redact'
  | 'seed.fromFixture' | 'seed.reset' | 'constraints.replayRuleInput' | 'executions.checkInvariants';
export function errorClassOf(error: unknown): ErrorClassName {
  try {
    if (error instanceof TypeError) return 'TypeError';
    if (error instanceof RangeError) return 'RangeError';
    if (error instanceof SyntaxError) return 'SyntaxError';
    if (error instanceof Error && error.name === "ArgumentValidationError") return "ArgumentValidationError";
  } catch { /* Hostile exception objects still map to the closed fallback. */ }
  // Only the closed class name is emitted, even for custom errors.
  return 'Other';
}
export type PublicOpsLogCode = 'unhandled' | 'request.effect_noop' | 'invariant.room_already_executed' | 'invariant.duplicate_execution' | 'invariant.guard_bypassed' | 'approval.not_executable' | 'invariant.open_request_at_execution' | 'view.vacant_slot' | 'approval.self_conflict';
export function publicOpsLog(code: PublicOpsLogCode, fields: {fn: PublicFnName; errorClass?: ErrorClassName}): void {
  console.log(JSON.stringify({fn: fields.fn, code, errorClass: fields.errorClass ?? null}));
}

export type InternalFnName = PublicFnName | 'ops.checkModelConfig' | 'ops.warmSchemas'
  | 'testing.roomCounts' | 'devProbes.schedulerSemantics' | 'devProbes.scheduledIdentity'
  | 'devProbes.limitsProbe' | 'devProbes.runtimeProbe' | 'devProbes.commitTsProbe' | 'devProbes.schedulerSemanticsKick' | 'devProbes.schedulerSemanticsState' | 'devProbes.prepareConcurrency' | 'devProbes.observeConcurrency';
export type OpsLogCode = 'unhandled' | 'config_invalid' | 'draining_set' | 'stuck_run' | 'react_depth_exceeded'
  | 'model_call' | 'attempt_failed' | 'rate_limited' | 'spend_deferred' | 'seed_reset' | 'restore' | 'alert'
  | 'turn_commit_threw' | 'constraints_drift' | 'cache_miss_unexpected' | 'state.illegal_transition'
  | 'reconcile.finding' | 'plugin_contract' | 'rule_integrity' | 'request.no_relaxation' | 'turn_attempt_limit' | 'room_force_closed';
const SAFE_FIELDS = ['roomId', 'runId', 'turnId', 'attemptId', 'role', 'kind', 'attemptNo', 'origin', 'status',
  'reasonCode', 'errorCode', 'httpStatus', 'latencyMs', 'inputTokens', 'outputTokens', 'thinkingTokens',
  'cacheCreationInputTokens', 'cacheReadInputTokens', 'costMicroUsd', 'provenance', 'schemaVersion', 'promptVersion',
  'staleGuard', 'why', 'count', 'severity', 'fn', 'errorClass'] as const;
export type SafeFieldName = typeof SAFE_FIELDS[number];
const SAFE_ENUMS = ['customer', 'provider', 'finance', 'propose', 'evaluate', 'running', 'completed', 'error',
  'live', 'stub', 'seeded', 'auth', 'model_not_found', 'config_invalid', 'transport', 'internal',
  'TypeError', 'RangeError', 'SyntaxError', 'ArgumentValidationError', 'Other', 'schema_warm'] as const;
export type SafeEnum = typeof SAFE_ENUMS[number] | InternalFnName;
export type IdString = `${import('../_generated/dataModel').TableNames}:${string}`;
export type SafeValue = IdString | SafeEnum | number | boolean;
export type SafeLogFields = Partial<Record<SafeFieldName, SafeValue>>;
import type { InternalCtx } from './functions';
const internalNames = new Set<string>([
  'testing.listRoomIds',
  'testing.checkLiveness',
  'health.ping',
  'health.whoami',
  'users.viewer',
  'users.ensureViewer',
  'users.resolve',
  'users.validateReturnIds',
  'rooms.create',
  'rooms.forceClose',
  'rooms.close',
  'rooms.view',
  'rooms.listMine',
  'invites.create',
  'invites.createLink',
  'invites.authorizeLink',
  'invites.insertLink',
  'invites.listMine',
  'invites.accept',
  'briefs.confirm',
  'briefs.mine',
  'budget.setCap',
  'ledger.recordBaseline',
  'sharedFacts.add',
  'catalog.confirm',
  'catalog.retire',
  'catalog.list',
  'timeline.page',
  'rooms.startFollowUp',
  'rooms.previewChange',
  'runs.start',
  'runs.retryTurn',
  'runs.requestRenegotiation',
  'runs.cancel',
  'runs.reconcile',
  'humanRequests.answer',
  'humanRequests.expireDue',
  'approvals.record',
  'proposals.get',
  'tasks.markDone',
  'executions.forRoom',
  'executions.checkInvariants',
  'turns.mine',
  'turns.beginAttempt',
  'turns.complete',
  'turns.fail',
  'agents.loadTurnContext',
  'agents.runAttempt',
  'agents.watchdog',
  'clock.rollLocalDate',
  'ops.configHealth',
  'ops.activeAttemptCount',
  'ops.metrics',
  'ops.auditUsers',
  'ops.setDraining',
  'ops.livenessSweep',
  'ops.purgeRawOutputs',
  'privacy.redact',
  'seed.fromFixture',
  'seed.reset',
  'constraints.replayRuleInput',
  'ops.checkModelConfig',
  'ops.warmSchemas',
  'testing.roomCounts',
  'devProbes.schedulerSemantics',
  'devProbes.scheduledIdentity',
  'devProbes.limitsProbe',
  'devProbes.runtimeProbe',
  'devProbes.commitTsProbe',
  'devProbes.schedulerSemanticsKick',
  'devProbes.schedulerSemanticsState', 'devProbes.prepareConcurrency', 'devProbes.observeConcurrency'
]);
const codes = new Set<string>([
'unhandled','config_invalid','draining_set','stuck_run','react_depth_exceeded','model_call','attempt_failed','rate_limited','spend_deferred','seed_reset','restore','alert','turn_commit_threw','constraints_drift','cache_miss_unexpected','state.illegal_transition','reconcile.finding','plugin_contract','rule_integrity','request.no_relaxation','turn_attempt_limit','room_force_closed'
]);
/** Closed operational records. Runtime checks also reject values passed through casts. */
export function opsLog(ctx: InternalCtx, code: OpsLogCode, fields: SafeLogFields = {}): void {
  if (!ctx || !codes.has(code)) throw new TypeError('Invalid internal log');
  const safe: Record<string, SafeValue | OpsLogCode> = { code };
  for (const [key, value] of Object.entries(fields)) {
    if (!(SAFE_FIELDS as readonly string[]).includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' ||
      typeof value === 'string' && ((SAFE_ENUMS as readonly string[]).includes(value) || internalNames.has(value) ||
        /^(rooms|runs|turns|attempts):[A-Za-z0-9_-]{1,128}$/.test(value))) safe[key] = value as SafeValue;
  }
  console.log(JSON.stringify(safe));
}
export function schedulerOpsLog(ctx: InternalCtx, code: 'draining_set' | 'stuck_run', fields: { draining: boolean; reason: string } | { attemptId: string }): void {
  opsLog(ctx, code, 'attemptId' in fields ? { attemptId: `attempts:${fields.attemptId}` } : {});
}
export function forceCloseOpsLog(ctx: InternalCtx, roomId: string): void { opsLog(ctx, 'room_force_closed', { roomId: `rooms:${roomId}` }); }


const RECONCILE_CHECKS = ['R1.approval_sequence', 'R1.brief_sequence', 'R1.proposal_sequence', 'R10.baseline_count', 'R10.chain', 'R11.complete_but_not_executed', 'R11.execution_key', 'R11.execution_proposal_missing', 'R11.liveness_input_invalid', 'R11.open_request', 'R11.proposal_status', 'R11.room_status', 'R11.run_status', 'R2.commit_counter', 'R2.proposal_counter', 'R3.amount_range', 'R4.execution_cap', 'R4.ledger_over_cap', 'R5.orphan_commitment', 'R6.orphan_change_order', 'R6.orphan_task', 'R6.record_count', 'R6.task_snapshot', 'R7.signature_set', 'R8.proposal_terms', 'R8.terms_snapshot', 'R9.price_source'] as const;
export function reconcileOpsLog(code: import('@core/engine').ReconcileCode, check: string): void {
  if (!(RECONCILE_CHECKS as readonly string[]).includes(check) || !check.startsWith(`${code}.`)) return;
  console.log(JSON.stringify({ code: 'reconcile.finding', findingCode: code, check }));
}
