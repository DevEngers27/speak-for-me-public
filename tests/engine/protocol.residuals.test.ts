import { expect, it } from 'vitest';
import { resolveRound, type Evaluation } from '../../core/engine/protocol/resolveRound';
import { answerEffect, buildHumanRequests, type ExhaustedCause, type RequestContext } from '../../core/engine/protocol/humanRequests';
import { buildHumanRequests as compatibilityRequest } from '../../core/engine/rules/humanRequests';
import { viewFor } from '../../core/engine/rules/view';
import { input, plugin, proposal, type Input } from './rules/fixture';

const context = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true };
const view = (role: string) => viewFor(plugin, input, {}, role);
const current = { proposalId: 'p', version: 1, passesChecks: true };
const evaluations: Evaluation[] = [{ role: 'customer', action: 'reject', reasonKey: 'other' }, { role: 'finance', action: 'recommend_accept', proposalVersion: 1 }];
const providerKeys = [proposal().candidateKey, proposal(['audit_log_export', 'sso_login', 'usage_dashboard']).candidateKey];

it('i12 provider propose cap means no_candidates, including at the last round', () => {
  for (const roundNo of [1, 3]) {
    const round = { plugin, roundNo, maxRounds: 3, proposalCounts: { provider: 4 } };
    expect(resolveRound(current, evaluations, round)).toEqual({ kind: 'rounds_exhausted', requestKind: 'rounds_exhausted', toRole: 'customer', cause: 'no_candidates' });
    expect(resolveRound({ ...current, passesChecks: false }, [], round)).toEqual({ kind: 'rounds_exhausted', requestKind: 'rounds_exhausted', toRole: 'customer', cause: 'no_candidates' });
    for (const limitCause of ['call_limit', 'spend_limit'] as const) {
      expect(resolveRound(current, evaluations, { ...round, limitCause })).toEqual({ kind: 'rounds_exhausted', requestKind: 'rounds_exhausted', toRole: 'customer', cause: limitCause });
    }
  }
});
it('i13 every offered rounds keep_as_is grants an extension across the eligibility state space', () => {
  let offered = 0;
  const causes: ExhaustedCause[] = ['rounds', 'no_candidates', 'call_limit', 'spend_limit'];
  for (const exhaustedCause of causes) for (const keepAsIsUsed of [false, true]) for (const canContinue of [false, true]) for (const providerHasCandidates of [false, true]) for (const count of [0, 4]) for (const retryAllowed of [false, true]) {
    const ctx = { ...context, exhaustedCause, keepAsIsUsed, canContinue, retryAllowed, proposalCounts: { provider: count }, providerExcludedCandidateKeys: providerHasCandidates ? [] : providerKeys };
    const request = buildHumanRequests('rounds_exhausted', 'customer', view, ctx);
    const keeps = request.options.filter(option => option.effect.kind === 'keep_as_is');
    const eligible = exhaustedCause === 'rounds' && !keepAsIsUsed && canContinue && providerHasCandidates && count < 4 && retryAllowed;
    expect(keeps.length).toBe(Number(eligible));
    // Test both the offered answer and a stale/unoffered answer against the same rule.
    expect(answerEffect({ kind: 'keep_as_is' }, request, { ...ctx, providerHasCandidates }).next).toBe(eligible ? 'extend_round' : 'ended_no_agreement');
    for (const option of keeps) {
      offered++;
      // extend_round directs the mutation to increment maxRounds by one.
      expect(answerEffect(option.effect, request, { ...ctx, providerHasCandidates })).toEqual({ bumpsConstraints: false, next: 'extend_round' });
    }
  }
  expect(offered).toBeGreaterThan(0);
});
it('i14 provider snapshot exclusions prevent extension even when customer choices remain', () => {
  const request = buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, providerExcludedCandidateKeys: providerKeys });
  expect(request.options.filter(option => option.effect.kind === 'choose_candidate')).toHaveLength(2);
  expect(request.options.some(option => option.effect.kind === 'keep_as_is')).toBe(false);
  const x = { kind: 'rounds_exhausted' as const, full: input, viewOf: view, run: { ...context, providerExcludedCandidateKeys: providerKeys }, disclosures: {} };
  expect(compatibilityRequest(plugin, x)).toEqual(request);
});
it('missing or malformed openRequestCount is a contract error distinct from an existing open request', () => {
  const { openRequestCount: omitted, ...missing } = context;
  expect(omitted).toBe(0);
  expect(() => buildHumanRequests('rounds_exhausted', 'customer', view, missing as unknown as RequestContext<Input>)).toThrow('invalid_open_request_count');
  for (const openRequestCount of [-1, 0.5, NaN, Infinity]) {
    expect(() => buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, openRequestCount })).toThrow('invalid_open_request_count');
  }
  expect(() => buildHumanRequests('rounds_exhausted', 'customer', view, { ...context, openRequestCount: 1 })).toThrow('human_request_already_open');
});
