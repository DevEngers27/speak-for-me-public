import { expect, it } from 'vitest';
import { buildHumanRequests, answerEffect, ANSWER_EFFECTS } from '../../core/engine/protocol/humanRequests';
import { viewFor } from '../../core/engine/rules/view';
import { input, plugin, type Input } from './rules/fixture';
import type { ScenarioPlugin } from '../../core/engine/plugin';
import { checkRoundTable, checkRequestPrivacy } from './protocolChecks';
it('covers every D08 decision row, serial evaluation and D12 caps', checkRoundTable);
it('generates one request using only the target view and preserves the open room', checkRequestPrivacy);
it('uses customer relaxations when required scope cannot fit', () => {
  const p: ScenarioPlugin<Input> = { ...plugin, relaxations: (r, v) => r === 'customer' ? [{ optionKey: '', templateKey: 'drop_items', effect: { kind: 'drop_items', itemKeys: [...v.requiredItemKeys!] }, shown: {} }] : [] };
  const full = { ...input, requiredItemKeys: ['custom_theme'] };
  const r = buildHumanRequests('infeasible', 'finance', r => viewFor(p, full, {}, r), { plugin: p, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true });
  expect(r.toRole).toBe('customer'); expect(r.options[0]?.effect.kind).toBe('drop_items');
});
it('clarify discloses only an owned field and resumes without bumping constraints', () => {
  const context = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: true, providerHasCandidates: true, clarify: { field: 'deadline', askerRole: 'provider' } };
  const r = buildHumanRequests('clarify', 'customer', r => viewFor(plugin, input, {}, r), context);
  expect(r.options.map(o => o.effect.kind)).toEqual(['disclose', 'keep_as_is', 'end_run']);
  expect(answerEffect(r.options[0]!.effect, r, context)).toEqual({ bumpsConstraints: false, next: 'same_turn' });
  expect(answerEffect({ kind: 'keep_as_is' }, { kind: 'rounds_exhausted', toRole: 'customer' }, context).next).toBe('extend_round');
  for (const kind of ['raise_cap', 'drop_items', 'extend_deadline'] as const) expect(ANSWER_EFFECTS[kind].bumpsConstraints).toBe(true);
});

it('does not offer an extra round when limits are exhausted and rejects wrong-role views', () => {
  const context = { plugin, excludedCandidateKeys: [], providerExcludedCandidateKeys: [], openRequestCount: 0, keepAsIsUsed: false, canContinue: false, providerHasCandidates: true, exhaustedCause: 'call_limit' as const };
  const view = (r: string) => viewFor(plugin, input, {}, r);
  const r = buildHumanRequests('rounds_exhausted', 'finance', view, context);
  expect(r.options.some(o => o.effect.kind === 'keep_as_is')).toBe(false);
  expect(answerEffect({ kind: 'keep_as_is' }, r, context).next).toBe('ended_no_agreement');
  expect(() => buildHumanRequests('rounds_exhausted', 'customer', () => input, context)).toThrow('wrong_request_view');
  expect(answerEffect({ kind: 'keep_as_is' }, { kind: 'agent_escalated', toRole: 'provider' }, context).next).toBe('same_turn');
});
