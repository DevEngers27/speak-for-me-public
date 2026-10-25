import { expect, it } from 'vitest';
import { resolveRound, type Evaluation } from '../../core/engine/protocol/resolveRound';
import { buildHumanRequests, answerEffect, HUMAN_REQUEST_TTL_DAYS } from '../../core/engine/protocol/humanRequests';
import { buildHumanRequests as compatibilityRequest } from '../../core/engine/rules/humanRequests';
import { viewFor } from '../../core/engine/rules/view';
import { enumerateCandidates } from '../../core/engine/rules/candidates';
import { cents } from '../../core/engine/money';
import { plugin, input, proposal } from './rules/fixture';
const ctx = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true, providerHasCandidates: true };
const view = (r: string) => viewFor(plugin, input, {}, r);
const p = { proposalId: 'p', version: 1, passesChecks: true };
const round = { plugin, roundNo: 1, maxRounds: 3, proposalCounts: {} };
const accept: Evaluation[] = [{ role: 'customer', action: 'recommend_accept', proposalVersion: 1 }, { role: 'finance', action: 'recommend_accept', proposalVersion: 1 }];

it('CN-002 answers every option of every generated request kind and recipient', () => {
  const full = { ...input, capCents: cents(470000), headroomCents: 70000 };
  const budgetView = (r: string) => viewFor(plugin, full, { requiredItemKeys: ['finance'], deadline: ['finance'] }, r);
  const requests = [
    buildHumanRequests('infeasible', 'customer', budgetView, ctx),
    buildHumanRequests('agent_escalated', 'finance', budgetView, { ...ctx, escalation: { kind: 'infeasible', toRole: 'finance' } }),
    buildHumanRequests('infeasible', 'customer', view, ctx),
    buildHumanRequests('rounds_exhausted', 'customer', view, ctx),
    buildHumanRequests('agent_escalated', 'finance', view, { ...ctx, escalation: { kind: 'needs_tradeoff', toRole: 'finance' } }),
    buildHumanRequests('agent_escalated', 'provider', view, ctx),
    buildHumanRequests('clarify', 'customer', view, { ...ctx, clarify: { field: 'deadline', askerRole: 'provider' } }),
    ...plugin.roles.map(r => buildHumanRequests('agent_failed', r.role, view, ctx)),
  ];
  const scope = { ...plugin, relaxations: () => [{ optionKey: '', templateKey: 'drop', effect: { kind: 'drop_items' as const, itemKeys: ['custom_theme'] }, shown: {} }] };
  requests.push(buildHumanRequests('infeasible', 'customer', role => viewFor(scope, { ...input, requiredItemKeys: ['custom_theme'] }, {}, role), { ...ctx, plugin: scope }));
  const deadline = { ...plugin, relaxations: () => [{ optionKey: '', templateKey: 'extend', effect: { kind: 'extend_deadline' as const, date: proposal().terms.deliveryDate }, shown: {} }] };
  requests.push(buildHumanRequests('infeasible', 'customer', role => viewFor(deadline, { ...input, deadline: input.localDate }, {}, role), { ...ctx, plugin: deadline }));
  const emittedEffects = new Set<string>();
  for (const request of requests) {
    expect(request.options.at(-1)?.effect.kind).toBe('end_run');
    for (const option of request.options) {
      emittedEffects.add(option.effect.kind);
      const result = answerEffect(option.effect, request, ctx);
      expect(result.next).toBeTruthy();
      expect(result.next).not.toContain('close');
    }
  }
  expect([...emittedEffects].sort()).toEqual(['raise_cap', 'drop_items', 'extend_deadline', 'choose_candidate', 'disclose', 'retry_turn', 'keep_as_is', 'end_run', 'pass_to_next'].sort());
  expect(requests[1]?.kind).toBe('infeasible');
  expect(requests[4]?.toRole).toBe('customer');
});
it('SM-31 pass_to_next follows position, handles fallback, and is once per pair', () => {
  const first = buildHumanRequests('infeasible', 'customer', view, ctx);
  const pass = first.options.find(o => o.effect.kind === 'pass_to_next')!;
  expect(pass.effect).toEqual({ kind: 'pass_to_next', toRole: 'finance' });
  expect(answerEffect(pass.effect, first, ctx)).toEqual({ bumpsConstraints: false, next: 'reroute_infeasible' });
  const passedPairs = [{ fromRole: 'customer', toRole: 'finance' }];
  expect(buildHumanRequests('infeasible', 'customer', view, { ...ctx, passedPairs }).options.some(o => o.effect.kind === 'pass_to_next')).toBe(false);
  const last = buildHumanRequests('infeasible', 'finance', view, { ...ctx, passedPairs, reroutedToRole: 'finance' });
  expect(last.toRole).toBe('finance');
  expect(last.options.some(o => o.effect.kind === 'pass_to_next')).toBe(false);
  const reordered = { ...plugin, relaxationOrder: ['finance.raise_cap', 'customer.drop_items'] as const };
  const reversed = buildHumanRequests('infeasible', 'finance', view, { ...ctx, plugin: reordered });
  expect(reversed.options.find(o => o.effect.kind === 'pass_to_next')?.effect).toEqual({ kind: 'pass_to_next', toRole: 'customer' });
  expect(first.options.length).toBeLessThanOrEqual(5);
});
it('disclosure resumes clarify but reruns infeasible precheck', () => {
  const clarify = buildHumanRequests('clarify', 'customer', view, { ...ctx, clarify: { field: 'deadline', askerRole: 'provider' } });
  const fallback = buildHumanRequests('infeasible', 'customer', view, ctx);
  for (const [request, next] of [[clarify, 'same_turn'], [fallback, 'rerun_precheck']] as const) {
    const disclose = request.options.find(o => o.effect.kind === 'disclose')!;
    expect(answerEffect(disclose.effect, request, ctx).next).toBe(next);
  }
});
it('needs_tradeoff offers next-round keep_as_is, ending when continuation is unavailable', () => {
  const r = buildHumanRequests('agent_escalated', 'finance', view, { ...ctx, escalation: { kind: 'needs_tradeoff', toRole: 'finance' } });
  const keep = r.options.find(o => o.effect.kind === 'keep_as_is')!;
  expect(r.toRole).toBe('customer');
  expect(answerEffect(keep.effect, r, ctx).next).toBe('next_round');
  expect(answerEffect(keep.effect, r, { ...ctx, canContinue: false, providerHasCandidates: true }).next).toBe('ended_no_agreement');
});
it('round exhaustion questionKey and extension eligibility derive from cause, extension, and provider candidates', () => {
  for (const cause of ['rounds', 'no_candidates', 'call_limit', 'spend_limit'] as const) {
    const r = buildHumanRequests('rounds_exhausted', 'customer', view, { ...ctx, exhaustedCause: cause, canContinue: true });
    expect(r.questionKey).toBe(`request.rounds_exhausted.${cause}`);
    expect(r.options.some(o => o.effect.kind === 'keep_as_is')).toBe(cause === 'rounds');
  }
  for (const extra of [{ keepAsIsUsed: true }, { excludedCandidateKeys: [proposal().candidateKey, proposal(['audit_log_export', 'sso_login', 'usage_dashboard']).candidateKey] }, { proposalCounts: { provider: 4 } }]) {
    expect(buildHumanRequests('rounds_exhausted', 'customer', view, { ...ctx, ...extra }).options.some(o => o.effect.kind === 'keep_as_is')).toBe(false);
  }
});
it('recommend_accept requires the exact envelope version, including runtime missing-version inputs', () => {
  for (const version of [undefined, 2]) {
    const bad = [{ role: 'customer', action: 'recommend_accept', proposalVersion: version }, accept[1]] as readonly Evaluation[];
    expect(resolveRound(p, bad, round).kind).not.toBe('pending_approval');
  }
});
it('finance counter is ignored and the fourth customer counter is still forwarded without its O-label', () => {
  const counter: Evaluation = { role: 'customer', action: 'counter', candidateKey: 'suggestion', optionKey: 'O2', counterPasses: true };
  expect(resolveRound(p, [counter, accept[1]!], { ...round, proposalCounts: { customer: 4 } })).toMatchObject({ feedback: { counter: { candidateKey: 'suggestion' } } });
  const decision = resolveRound(p, [counter, accept[1]!], round);
  expect(decision).toEqual({ kind: 'next_round', role: 'provider', roundNo: 2, feedback: { kind: 'not_accepted', counter: { candidateKey: 'suggestion' } } });
  expect(resolveRound(p, [accept[0]!, { ...counter, role: 'finance' }], round)).toMatchObject({ feedback: { kind: 'not_accepted' } });
});
it('$4,799.99 raises cap by one cent, while CE-007 without disclosure reveals no private budget', () => {
  const full = { ...input, capCents: cents(479999), headroomCents: 79999 };
  const r = buildHumanRequests('infeasible', 'customer', role => viewFor(plugin, full, { requiredItemKeys: ['finance'], deadline: ['finance'] }, role), ctx);
  expect(r.options[0]?.effect).toEqual({ kind: 'raise_cap', amountCents: 480000 });
  const own = buildHumanRequests('rounds_exhausted', 'customer', role => viewFor(plugin, full, {}, role), ctx);
  expect(JSON.stringify(own)).not.toMatch(/479999|400000|79999/);
  expect(own.options.filter(o => o.effect.kind === 'choose_candidate')).toHaveLength(2);
});
it('ignores relaxation choices, extended maxRounds boundary, and seven-day TTL', () => {
  const bad = { ...plugin, relaxations: () => [{ optionKey: '', templateKey: 'choice', effect: { kind: 'choose_candidate' as const, candidateKey: 'not_visible' }, shown: {} }] };
  expect(JSON.stringify(buildHumanRequests('rounds_exhausted', 'customer', view, { ...ctx, plugin: bad }))).not.toContain('not_visible');
  const reject: Evaluation = { role: 'customer', action: 'reject', reasonKey: 'other' };
  expect(resolveRound(p, [reject, accept[1]!], { ...round, roundNo: 3, maxRounds: 4 }).kind).toBe('next_round');
  expect(resolveRound(p, [reject, accept[1]!], { ...round, roundNo: 4, maxRounds: 4 }).kind).toBe('rounds_exhausted');
  expect(HUMAN_REQUEST_TTL_DAYS).toBe(7);
});
it('compatibility wrapper forwards open-count and extension inputs with A..E labels', () => {
  const x = { kind: 'rounds_exhausted' as const, full: input, viewOf: view, run: ctx, disclosures: {} };
  expect(() => compatibilityRequest(plugin, { ...x, run: { ...ctx, openRequestCount: 1 } })).toThrow('human_request_already_open');
  const r = compatibilityRequest(plugin, { ...x, run: { ...ctx, exhaustedCause: 'call_limit' } });
  expect(r.questionKey).toBe('request.rounds_exhausted.call_limit');
  expect(r.options.map(o => o.optionKey)).toEqual(r.options.map((_, n) => String.fromCharCode(65+n)));
  expect(r.options.some(o => o.effect.kind === 'keep_as_is')).toBe(false);
});
it('one feasible candidate still completes both serial evaluation turns', () => {
  const one = { ...plugin, candidateSpace: () => ({ drafts: [{ itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] }], emptyReasons: [] }) };
  expect(enumerateCandidates(one, input, { mode: 'feasibility', limit: 1, anchor: false, exclude: [], mustInclude: [] }).items).toHaveLength(1);
  expect(resolveRound(p, [], { ...round, plugin: one })).toEqual({ kind: 'next_evaluator', role: 'customer' });
  expect(resolveRound(p, accept.slice(0,1), { ...round, plugin: one })).toEqual({ kind: 'next_evaluator', role: 'finance' });
  expect(resolveRound(p, accept, { ...round, plugin: one }).kind).toBe('pending_approval');
});
it('CE-007 pure clause: undisclosed required items do not inflate finance raise_cap', () => {
  const ownCatalog = { ...plugin, candidateSpace: () => ({ drafts: [
    ...input.catalog.filter(r => r.kind === 'item').map(r => ({ itemKeys: [r.itemKey], modifiers: [] })),
    { itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] },
  ], emptyReasons: [] }) };
  const full = { ...input, capCents: cents(400000), headroomCents: 0 };
  const r = buildHumanRequests('infeasible', 'customer', role => viewFor(ownCatalog, full, {}, role), { ...ctx, plugin: ownCatalog });
  expect(r.toRole).toBe('finance');
  expect(r.options[0]?.effect).toEqual({ kind: 'raise_cap', amountCents: 410000 });
});
it('accepted infeasible escalation has the same kind and recipient as the generated request', () => {
  const full = { ...input, capCents: cents(470000), headroomCents: 70000 };
  const r = buildHumanRequests('agent_escalated', 'customer', role => viewFor(plugin, full, { requiredItemKeys: ['finance'], deadline: ['finance'] }, role), { ...ctx, escalation: { kind: 'infeasible', toRole: 'customer' } });
  // Accepted escalation metadata contains the code-chosen request role, not the model hint.
  const decision = resolveRound(p, [{ role: 'customer', action: 'escalate', accepted: true, requestKind: 'infeasible', toRole: r.toRole }], round);
  expect(decision).toEqual({ kind: 'needs_input', requestKind: r.kind, toRole: r.toRole });
});
it('round decisions carry the exhaustion cause into the request question', () => {
  const reject: Evaluation = { role: 'customer', action: 'reject', reasonKey: 'other' };
  for (const limitCause of ['call_limit', 'spend_limit'] as const) {
    const decision = resolveRound(p, [reject, accept[1]!], { ...round, limitCause });
    expect(decision).toMatchObject({ kind: 'rounds_exhausted', cause: limitCause });
    const request = buildHumanRequests('rounds_exhausted', 'customer', view, { ...ctx, exhaustedCause: limitCause });
    expect(request.questionKey).toBe(`request.rounds_exhausted.${limitCause}`);
    expect(request.options.some(o => o.effect.kind === 'keep_as_is')).toBe(false);
  }
});
