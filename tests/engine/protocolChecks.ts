import { assertOptionsProjected } from '../../core/engine/disclosure';
import { expect } from 'vitest';
import { resolveRound, type Evaluation } from '../../core/engine/protocol/resolveRound';
import { buildHumanRequests, ANSWER_EFFECTS } from '../../core/engine/protocol/humanRequests';
import { enumerateCandidates } from '../../core/engine/rules/candidates';
import { viewFor } from '../../core/engine/rules/view';
import { cents } from '../../core/engine/money';
import { input, plugin } from './rules/fixture';

const proposal = { proposalId: 'p', version: 1, passesChecks: true };
const ctx = { roundNo: 1, maxRounds: 3, plugin, proposalCounts: {} };
const accept: Evaluation[] = [{ role: 'customer', action: 'recommend_accept', proposalVersion: 1 }, { role: 'finance', action: 'recommend_accept', proposalVersion: 1 }];
export function checkRoundTable() {
  expect(resolveRound(proposal, [{ role: 'customer', action: 'clarify', handledBy: 'human', toRole: 'finance' }], ctx)).toMatchObject({ kind: 'needs_input', requestKind: 'clarify' });
  expect(resolveRound(proposal, [{ role: 'customer', action: 'escalate', accepted: true, toRole: 'customer' }], ctx)).toMatchObject({ kind: 'needs_input', requestKind: 'agent_escalated' });
  expect(resolveRound(proposal, accept, ctx)).toEqual({ kind: 'pending_approval', proposalId: 'p' });
  expect(resolveRound(proposal, accept.slice(0, 1), ctx)).toEqual({ kind: 'next_evaluator', role: 'finance' });
  const counter: Evaluation = { role: 'customer', action: 'counter', candidateKey: 'sso_login', optionKey: 'O2', counterPasses: true };
  expect(resolveRound(proposal, [counter, accept[1]!], ctx)).toMatchObject({ kind: 'next_round', feedback: { counter: { candidateKey: 'sso_login' } } });
  for (const move of [{ ...counter, counterPasses: false }, { role: 'customer', action: 'reject', reasonKey: 'other' }, { role: 'customer', action: 'clarify', handledBy: 'code' }, { role: 'customer', action: 'escalate', accepted: false }] as Evaluation[]) {
    expect(resolveRound(proposal, [move, accept[1]!], ctx)).toEqual({ kind: 'next_round', role: 'provider', roundNo: 2, feedback: { kind: 'not_accepted' } });
    expect(resolveRound(proposal, [move, accept[1]!], { ...ctx, roundNo: 3 }).kind).toBe('rounds_exhausted');
  }
  expect(resolveRound({ ...proposal, passesChecks: false }, [], ctx)).toMatchObject({ kind: 'next_round', feedback: { fit: 'blocked' } });
  expect(resolveRound({ ...proposal, passesChecks: false }, [], { ...ctx, proposalCounts: { provider: 4 } }).kind).toBe('rounds_exhausted');
  expect(resolveRound(proposal, [{ ...counter }, accept[1]!], { ...ctx, proposalCounts: { customer: 5 } })).toMatchObject({ feedback: { kind: 'not_accepted' } });
}

export function checkRequestPrivacy() {
  const full = { ...input, capCents: cents(470000), headroomCents: 70000 };
  const disclosures = { requiredItemKeys: ['finance'], deadline: ['finance'], capCents: ['customer'] };
  const view = (r: string) => viewFor(plugin, full, disclosures, r);
  const context = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true, providerHasCandidates: true };
  const req = buildHumanRequests('infeasible', 'customer', view, context);
  assertOptionsProjected('finance', req.options);
  expect(req.toRole).toBe('finance');
  expect(req.options.map(o => o.effect)).toEqual([{ kind: 'raise_cap', amountCents: 480000 }, { kind: 'end_run' }]);
  const rounds = buildHumanRequests('rounds_exhausted', 'finance', view, context);
  assertOptionsProjected('customer', rounds.options);
  expect(() => assertOptionsProjected('provider', rounds.options)).toThrow();
  expect(rounds.toRole).toBe('customer');
  expect(rounds.options.filter(o => o.effect.kind === 'choose_candidate')).toHaveLength(2);
  expect(JSON.stringify(rounds)).not.toContain('400000');
  expect(buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, keepAsIsUsed: true }).options.some(o => o.effect.kind === 'keep_as_is')).toBe(false);
  expect(() => buildHumanRequests('infeasible', 'customer', view, { ...context, openRequestCount: 1 })).toThrow('human_request_already_open');
  expect(buildHumanRequests('agent_failed', 'provider', view, context).options.map(o => o.effect.kind)).toEqual(['retry_turn', 'end_run']);
  expect(buildHumanRequests('agent_failed', 'provider', view, { ...context, retryAllowed: false }).options.map(o => o.effect.kind)).toEqual(['end_run']);
  const canary = { ...full, capCents: cents(987654321), committedCents: cents(876543210), headroomCents: 111111111 };
  expect(buildHumanRequests('rounds_exhausted', 'customer', r => viewFor(plugin, canary, {}, r), context)).toEqual(buildHumanRequests('rounds_exhausted', 'customer', r => viewFor(plugin, full, {}, r), context));
  const leaking = { ...plugin, relaxations: () => [{ optionKey: '', templateKey: 'choose_candidate', effect: { kind: 'choose_candidate' as const, candidateKey: 'audit_log_export+sso_login' }, shown: { amountCents: cents(987654321) } }] };
  expect(buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, plugin: leaking })).toEqual(rounds);
  expect(Object.values(ANSWER_EFFECTS).every(e => !e.next.includes('close'))).toBe(true);
}

/** Pure clauses of INV-74; scheduler/persistence assertions remain in Convex battery todos. */
export function checkPureRoundInvariant() {
  checkRoundTable();
  const one = { ...plugin, candidateSpace: () => ({ drafts: [{ itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] }], emptyReasons: [] }) };
  expect(enumerateCandidates(one, input, { mode: 'feasibility', limit: 1, anchor: false, exclude: [], mustInclude: [] }).items).toHaveLength(1);
  const single = { ...ctx, plugin: one };
  expect(resolveRound(proposal, [], single)).toEqual({ kind: 'next_evaluator', role: 'customer' });
  expect(resolveRound(proposal, accept.slice(0,1), single)).toEqual({ kind: 'next_evaluator', role: 'finance' });
  expect(resolveRound(proposal, accept, single).kind).toBe('pending_approval');
  const exhausted = resolveRound(proposal, [{ role: 'customer', action: 'reject', reasonKey: 'other' }, accept[1]!], { ...ctx, roundNo: 3 });
  expect(exhausted).toMatchObject({ kind: 'rounds_exhausted', toRole: 'customer', cause: 'rounds' });
  const request = buildHumanRequests('rounds_exhausted', 'customer', role => viewFor(one, input, {}, role), { plugin: one, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true, exhaustedCause: 'rounds' });
  expect(request.options.map(o => o.effect.kind)).toEqual(['choose_candidate', 'keep_as_is', 'end_run']);
}
