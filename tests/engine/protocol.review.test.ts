import { expect, it } from 'vitest';
import { resolveRound, type Evaluation } from '../../core/engine/protocol/resolveRound';
import { buildHumanRequests, answerEffect } from '../../core/engine/protocol/humanRequests';
import { assertOptionsProjected } from '../../core/engine/disclosure';
import { cents } from '../../core/engine/money';
import { viewFor } from '../../core/engine/rules/view';
import { input, plugin, proposal } from './rules/fixture';
const p = { proposalId: 'p', version: 1, passesChecks: true };
const ctx = { roundNo: 1, maxRounds: 3, plugin, proposalCounts: {} };
const a: Evaluation = { role: 'customer', action: 'recommend_accept', proposalVersion: 1 };
const f: Evaluation = { ...a, role: 'finance' };
const counter: Evaluation = { role: 'customer', action: 'counter', candidateKey: 'other', counterPasses: true, optionKey: 'O2' };
const clarify: Evaluation = { role: 'finance', action: 'clarify', handledBy: 'human', toRole: 'customer' };
const escalate: Evaluation = { role: 'finance', action: 'escalate', accepted: true, toRole: 'customer', requestKind: 'infeasible' };
it('D08 row 1: any human clarify takes priority', () => {
  expect(resolveRound({ ...p, passesChecks: false }, [counter, clarify], ctx)).toEqual({ kind: 'needs_input', requestKind: 'clarify', toRole: 'customer' });
});
it('D08 row 2: accepted escalation requires human input', () => {
  expect(resolveRound({ ...p, passesChecks: false }, [{ role: 'customer', action: 'reject', reasonKey: 'other' }, escalate], ctx)).toEqual({ kind: 'needs_input', requestKind: 'infeasible', toRole: 'customer' });
});
it('D08 row 3: unanimous recommendations and current checks permit approval', () => {
  expect(resolveRound(p, [a, f], ctx).kind).toBe('pending_approval');
  expect(resolveRound({ ...p, passesChecks: false }, [a,f], ctx)).toMatchObject({ kind: 'next_round', feedback: { fit: 'blocked' } });
  expect(resolveRound(p, [{ ...a, proposalVersion: 2 }, f], ctx).kind).toBe('next_round');
});
it('D08 row 4: feasible customer counter goes to next proposer or exhausted request', () => {
  expect(resolveRound({ ...p, passesChecks: false }, [counter, f], ctx)).toMatchObject({ kind: 'next_round', feedback: { counter: { candidateKey: 'other' } } });
  expect(resolveRound(p, [counter, f], { ...ctx, roundNo: 3 }).kind).toBe('rounds_exhausted');
});
it('D08 row 5: other outcomes advance or exhaust rounds', () => {
  for (const e of [{ ...counter, counterPasses: false }, { role: 'customer', action: 'reject', reasonKey: 'other' }, { role: 'customer', action: 'clarify', handledBy: 'code' }, { role: 'customer', action: 'escalate', accepted: false }] as Evaluation[]) {
    expect(resolveRound(p, [e,f], ctx)).toMatchObject({ kind: 'next_round', feedback: { kind: 'not_accepted' } });
    expect(resolveRound(p, [e,f], { ...ctx, providerHasCandidates: false }).kind).toBe('rounds_exhausted');
  }
});
it('S1 blocked proposals skip evaluation, initially blocked evaluations violate the contract', () => {
  expect(resolveRound({ ...p, passesChecks: false }, [], ctx)).toMatchObject({ feedback: { fit: 'blocked' } });
  expect(() => resolveRound({ ...p, passesChecks: false, initiallyBlocked: true }, [a], ctx)).toThrow('non_serial_evaluations');
});
it('S2 rejects evaluations after a human short circuit and invalid serial order', () => {
  for (const e of [clarify, escalate]) expect(() => resolveRound(p, [{ ...e, role: 'customer' }, f], ctx)).toThrow('non_serial_evaluations');
  expect(() => resolveRound(p, [f,a], ctx)).toThrow('non_serial_evaluations');
  expect(() => resolveRound(p, [a,f,f], ctx)).toThrow('non_serial_evaluations');
  for (const e of [clarify, escalate]) expect(() => resolveRound(p, [{ ...e, role: 'customer', toRole: undefined }], ctx)).toThrow('missing_request_role');
});
const context = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true, providerHasCandidates: true };
const view = (r: string) => viewFor(plugin, input, {}, r);
it('customer escalations preserve plugin rank with the current candidate first', () => {
  const first = proposal().candidateKey;
  const second = proposal(['audit_log_export', 'sso_login', 'usage_dashboard']).candidateKey;
  const ranked = { ...plugin, rankForOwner: () => (a: { candidateKey: string }, b: { candidateKey: string }) => [second, first].indexOf(a.candidateKey) - [second, first].indexOf(b.candidateKey), relaxations: () => { throw new Error('relaxations must not enumerate choices'); } };
  for (const kind of ['rounds_exhausted', 'agent_escalated'] as const) {
    const r = buildHumanRequests(kind, 'customer', view, { ...context, plugin: ranked });
    expect(r.options[0]?.effect).toEqual({ kind: 'choose_candidate', candidateKey: second });
    const preferred = buildHumanRequests(kind, 'customer', view, { ...context, plugin: ranked, currentCandidateKey: first });
    expect(preferred.options[0]?.effect).toEqual({ kind: 'choose_candidate', candidateKey: first });
    assertOptionsProjected('customer', preferred.options);
  }
});
it('provider cannot_deliver keeps the same turn even at the last round', () => {
  const r = buildHumanRequests('agent_escalated', 'provider', view, { ...context, canContinue: false });
  expect(r.options.map(o => o.effect.kind)).toEqual(['keep_as_is', 'end_run']);
  expect(answerEffect(r.options[0]!.effect, r, { ...context, canContinue: false, providerHasCandidates: true }).next).toBe('same_turn');
  expect(buildHumanRequests('agent_escalated', 'provider', view, { ...context, retryAllowed: false }).options.map(o => o.effect.kind)).toEqual(['end_run']);
  expect(() => buildHumanRequests('agent_escalated', 'finance', view, context)).toThrow('invalid_escalation_role');
  expect(() => answerEffect({ kind: 'keep_as_is' }, { kind: 'agent_escalated', toRole: 'finance' }, context)).toThrow('invalid_escalation_role');
});
it('request error branches reject empty order, invalid recipient, and invalid clarify', () => {
  expect(() => buildHumanRequests('infeasible', 'customer', view, { ...context, plugin: { ...plugin, relaxationOrder: [] } })).toThrow('empty_relaxation_order');
  expect(() => buildHumanRequests('agent_failed', 'missing', view, context)).toThrow('unknown_request_role');
  expect(() => buildHumanRequests('clarify', 'customer', view, context)).toThrow('invalid_clarify_field');
});
it('answer effects cover choice, retry, end and all keep_as_is exits', () => {
  const request = { kind: 'rounds_exhausted' as const, toRole: 'customer' };
  expect(answerEffect({ kind: 'choose_candidate', candidateKey: 'x' }, request, context).next).toBe('recheck_candidate');
  expect(answerEffect({ kind: 'retry_turn' }, request, context).next).toBe('same_turn');
  expect(answerEffect({ kind: 'end_run' }, request, context).next).toBe('ended_no_agreement');
  expect(answerEffect({ kind: 'keep_as_is' }, request, { ...context, keepAsIsUsed: true }).next).toBe('ended_no_agreement');
  expect(answerEffect({ kind: 'keep_as_is' }, { kind: 'agent_escalated', toRole: 'customer' }, context).next).toBe('next_round');
  expect(answerEffect({ kind: 'keep_as_is' }, { kind: 'agent_escalated', toRole: 'provider' }, { ...context, retryAllowed: false }).next).toBe('ended_no_agreement');
  expect(answerEffect({ kind: 'keep_as_is' }, { kind: 'clarify', toRole: 'finance' }, context).next).toBe('same_turn');
});
it('infeasible relaxation limits keep options within A..E and reject ineffective changes', () => {
  const full = { ...input, catalog: input.catalog.map(r => r.itemKey === 'audit_log_export' ? { ...r, status: 'retired' as const } : r) };
  const scope = { ...plugin, candidateSpace: () => ({ drafts: [{ itemKeys: ['sso_login'], modifiers: [] }], emptyReasons: [] }), relaxations: () => [
    ...Array.from({ length: 6 }, () => ({ optionKey: '', templateKey: 'drop', effect: { kind: 'drop_items' as const, itemKeys: ['audit_log_export'] }, shown: {} })),
    { optionKey: '', templateKey: 'ineffective', effect: { kind: 'drop_items' as const, itemKeys: ['sso_login'] }, shown: {} },
  ] };
  const r = buildHumanRequests('infeasible', 'customer', role => viewFor(scope, full, {}, role), { ...context, plugin: scope });
  expect(r.options.map(o => o.effect.kind)).toEqual(['drop_items', 'drop_items', 'pass_to_next', 'end_run']);
  expect(r.options.map(o => o.optionKey)).toEqual(['A', 'B', 'C', 'D']);
});
it('deadline relaxations are capped at one and independently restore feasibility', () => {
  const full = { ...input, deadline: input.localDate };
  const deadline = { ...plugin, relaxations: () => Array.from({ length: 6 }, () => ({ optionKey: '', templateKey: 'extend', effect: { kind: 'extend_deadline' as const, date: proposal().terms.deliveryDate }, shown: {} })) };
  const r = buildHumanRequests('infeasible', 'customer', role => viewFor(deadline, full, {}, role), { ...context, plugin: deadline });
  expect(r.options.map(o => o.effect.kind)).toEqual(['extend_deadline', 'pass_to_next', 'end_run']);
});
it('raise_cap fallback cannot solve a non-budget conflict and cannot offer an unchanged cap', () => {
  const impossible = { ...input, deadline: input.localDate };
  const financeFirst = { ...plugin, relaxationOrder: ['finance.raise_cap' as const] };
  const r = buildHumanRequests('infeasible', 'finance', role => viewFor(financeFirst, impossible, { requiredItemKeys: ['finance'], deadline: ['finance'] }, role), { ...context, plugin: financeFirst });
  expect(r.options.map(o => o.effect.kind)).toEqual(['end_run']);
});

it('current valid candidate is included even if omitted from the plugin ranking', () => {
  const first = proposal().candidateKey;
  const second = proposal(['audit_log_export', 'sso_login', 'usage_dashboard']).candidateKey;
  const ranked = { ...plugin, relaxations: () => [{ optionKey: '', templateKey: 'choice', effect: { kind: 'choose_candidate' as const, candidateKey: second }, shown: {} }] };
  const r = buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, plugin: ranked, currentCandidateKey: first });
  expect(r.options[0]?.effect).toEqual({ kind: 'choose_candidate', candidateKey: first });
});

it('infeasible escalation opens an infeasible request for the relaxation owner', () => {
  const full = { ...input, capCents: cents(470000), headroomCents: 70000 };
  const r = buildHumanRequests('agent_escalated', 'finance', role => viewFor(plugin, full, { requiredItemKeys: ['finance'], deadline: ['finance'] }, role), { ...context, escalation: { kind: 'infeasible', toRole: 'finance' } });
  expect(r.kind).toBe('infeasible');
  expect(r.toRole).toBe('finance');
  expect(r.options[0]?.effect).toEqual({ kind: 'raise_cap', amountCents: 480000 });
  assertOptionsProjected('finance', r.options);
});
