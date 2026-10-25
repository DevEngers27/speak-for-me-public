// engine/rules/engine.ts — scenario-agnostic result assembly and execution readiness.
import type { ReasonCode, ReadinessCheckId } from './codes.ts';
import { READINESS_CHECK_ORDER } from './codes.ts';

export type CheckStatus = 'pass' | 'fail' | 'not_evaluated';
export type Severity = 'block' | 'info';
export type Params = Readonly<Record<string, string | number | boolean | readonly string[]>>;

export type CheckResult<C extends string = string> = {
  checkId: C;
  status: CheckStatus;
  severity: Severity;
  code: ReasonCode; // fail -> failure code; pass -> pass code (FITS_BUDGET or OK); not_evaluated -> OK
  params: Params;
};

/** Sorts by the fixed order, derives blocking/info lists. Pure and order-stable. */
export function assemble<C extends string>(order: readonly C[], results: readonly CheckResult<C>[]) {
  const idx = new Map(order.map((c, i) => [c, i] as const));
  const checks = [...results].sort((a, b) => (idx.get(a.checkId) ?? 1e9) - (idx.get(b.checkId) ?? 1e9));
  const blocking: ReasonCode[] = [];
  const info: ReasonCode[] = [];
  for (const r of checks) {
    if (r.status !== 'fail') continue;
    const list = r.severity === 'block' ? blocking : info;
    if (!list.includes(r.code)) list.push(r.code);
  }
  return { checks, blocking, info, executable: blocking.length === 0 };
}

/** Runs checks in order; a check whose dependency did not pass becomes not_evaluated. */
export function runChecks<C extends string, Ctx>(
  order: readonly C[],
  defs: Readonly<Record<C, CheckDef<C, Ctx>>>,
  ctx: Ctx,
): CheckResult<C>[] {
  const out: CheckResult<C>[] = [];
  const passed = new Set<C>();
  for (const id of order) {
    const def = defs[id];
    const blocked = def.dependsOn.some((d) => !passed.has(d));
    if (blocked) {
      out.push({ checkId: id, status: 'not_evaluated', severity: def.severity, code: 'OK', params: {} });
      continue;
    }
    const r = def.run(ctx);
    const res: CheckResult<C> = r.ok
      ? { checkId: id, status: 'pass', severity: def.severity, code: r.code ?? 'OK', params: r.params ?? {} }
      : { checkId: id, status: 'fail', severity: def.severity, code: r.code, params: r.params ?? {} };
    if (r.ok) passed.add(id);
    out.push(res);
  }
  return out;
}

export type CheckOutcome = { ok: true; code?: ReasonCode; params?: Params } | { ok: false; code: ReasonCode; params?: Params };
export type CheckDef<C extends string, Ctx> = {
  severity: Severity;
  dependsOn: readonly C[];
  run: (ctx: Ctx) => CheckOutcome;
};

// ---------------------------------------------------------------- decisions & readiness

export type DecisionKind = 'approve' | 'reject' | 'withdraw';
export type Decision = {
  participantId: string;
  userId: string; // tokenIdentifier-derived users._id at decision time
  proposalId: string;
  kind: DecisionKind;
  constraintsVersion: number;
  termsKey: string;
  seq: number; // monotonically increasing per room (e.g. commitTs or a counter); latest wins
};
export type RequiredApprover = { participantId: string; userId: string; role: string };
export type DecisionState = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'stale_approve' | 'stale_reject';

export function decisionStates(
  approvers: readonly RequiredApprover[],
  decisions: readonly Decision[],
  binding: { proposalId: string; constraintsVersion: number; termsKey: string },
): Record<string, DecisionState> {
  const out: Record<string, DecisionState> = {};
  for (const a of approvers) {
    const mine = decisions
      .filter((d) => d.participantId === a.participantId && d.userId === a.userId && d.proposalId === binding.proposalId)
      .sort((x, y) => y.seq - x.seq);
    const last = mine[0];
    if (!last) out[a.participantId] = 'pending';
    else if (last.kind === 'withdraw') out[a.participantId] = 'withdrawn';
    else {
      const fresh = last.constraintsVersion === binding.constraintsVersion && last.termsKey === binding.termsKey;
      if (last.kind === 'approve') out[a.participantId] = fresh ? 'approved' : 'stale_approve';
      else out[a.participantId] = fresh ? 'rejected' : 'stale_reject';
    }
  }
  return out;
}

export type ReadinessInput = {
  proposalId: string;
  isCurrentProposal: boolean;
  storedTermsKey: string;
  recomputedTermsKey: string;
  currentConstraintsVersion: number;
  requiredApprovers: readonly RequiredApprover[]; // snapshot stored on the proposal
  decisions: readonly Decision[];
  executionId: string | null; // existing execution for (proposalId, constraintsVersion), if any
  evaluation: { blocking: readonly ReasonCode[] };
};

export type Readiness =
  | { kind: 'already_executed'; executionId: string }
  | { kind: 'evaluated'; ready: boolean; blocking: ReasonCode[]; info: ReasonCode[];
      checks: CheckResult<ReadinessCheckId>[]; states: Record<string, DecisionState> };

/** ALREADY_EXECUTED is decided first, before any budget math (committed already includes this proposal). */
export function evaluateExecutionReadiness(i: ReadinessInput): Readiness {
  if (i.executionId !== null) return { kind: 'already_executed', executionId: i.executionId };
  const states = decisionStates(i.requiredApprovers, i.decisions, {
    proposalId: i.proposalId, constraintsVersion: i.currentConstraintsVersion, termsKey: i.storedTermsKey,
  });
  const ids = Object.keys(states).sort();
  const of = (s: DecisionState[]) => ids.filter((p) => s.includes(states[p]!));
  const userIds = i.requiredApprovers.map((a) => a.userId);
  const defs: Record<ReadinessCheckId, CheckDef<ReadinessCheckId, null>> = {
    is_current: { severity: 'block', dependsOn: [], run: () =>
      i.isCurrentProposal ? { ok: true } : { ok: false, code: 'NOT_CURRENT_PROPOSAL' } },
    terms_key_matches: { severity: 'block', dependsOn: [], run: () =>
      i.storedTermsKey === i.recomputedTermsKey ? { ok: true } : { ok: false, code: 'TERMS_KEY_MISMATCH' } },
    has_required_approvers: { severity: 'block', dependsOn: [], run: () =>
      i.requiredApprovers.length > 0 ? { ok: true } : { ok: false, code: 'NO_REQUIRED_APPROVERS' } },
    distinct_approvers: { severity: 'block', dependsOn: ['has_required_approvers'], run: () =>
      new Set(userIds).size === userIds.length ? { ok: true } : { ok: false, code: 'APPROVER_IDENTITY_CONFLICT' } },
    approvals_not_rejected: { severity: 'block', dependsOn: ['has_required_approvers'], run: () => {
      const r = of(['rejected']);
      return r.length === 0 ? { ok: true } : { ok: false, code: 'APPROVAL_REJECTED', params: { participantIds: r } };
    } },
    approvals_complete: { severity: 'block', dependsOn: ['has_required_approvers'], run: () => {
      const p = of(['pending', 'withdrawn', 'stale_approve', 'stale_reject', 'rejected']);
      return p.length === 0 ? { ok: true } : { ok: false, code: 'APPROVAL_PENDING', params: { participantIds: p } };
    } },
    approvals_fresh: { severity: 'info', dependsOn: ['has_required_approvers'], run: () => {
      const s = of(['stale_approve', 'stale_reject']);
      return s.length === 0 ? { ok: true } : { ok: false, code: 'APPROVAL_STALE', params: { participantIds: s } };
    } },
  };
  const own = assemble(READINESS_CHECK_ORDER, runChecks(READINESS_CHECK_ORDER, defs, null));
  const blocking = [...own.blocking];
  for (const c of i.evaluation.blocking) if (!blocking.includes(c)) blocking.push(c);
  return { kind: 'evaluated', ready: blocking.length === 0, blocking, info: own.info, checks: own.checks, states };
}
