import { turnInstruction } from '../../core/engine/protocol';
import { expect, vi } from 'vitest';
import { canonicalJson, resolveRound, TRANSITIONS, assertTransition, type Machine } from '../../core/engine';
import { protocol, materialize } from '../../core/scenarios/scope-change';
import { input } from './rules/fixture';
import { scenarioOf } from '../../convex/model/_parallelStubs.w2-4';
import { callModel, stubTransport } from '../../convex/model/agents/modelGateway';
export const runtimePureCases: Record<string, () => void> = {
  'INV-40': async () => {
    const schema = { type: 'object' as const, properties: { turn: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'], additionalProperties: false } }, required: ['turn'], additionalProperties: false };
    for (const [stopReason, expected] of [['max_tokens', 'invalid_output'], ['refusal', 'refused'], ['model_context_window_exceeded', 'error']] as const) {
      const validate = vi.fn((data: unknown) => ({ ok: true as const, data }));
      const result = await callModel({ transport: stubTransport(() => ({ kind: 'stop', stopReason, partialText: 'PRIVATE-RAW', requestId: 'req', usage: { input_tokens: 100, output_tokens: 10 } })), messages: [{ role: 'user', content: 'test' }, { role: 'system', content: turnInstruction({ turnKind: 'propose', allowedActions: ['propose'] }) }], schema, validate });
      expect(result.attemptStatus).toBe(expected); expect(result.totalUsage.inputTokens).toBeGreaterThanOrEqual(100); expect(result.requestId).toBe('req'); expect(validate).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('PRIVATE-RAW');
    }
    const malformed = await callModel({ transport: stubTransport(() => ({ kind: 'raw_text', text: '{bad', requestId: 'parse', usage: { input_tokens: 1, output_tokens: 1 } })), messages: [{ role: 'user', content: 'test' }, { role: 'system', content: turnInstruction({ turnKind: 'propose', allowedActions: ['propose'] }) }], schema, validate: (data: unknown) => ({ ok: true as const, data }) });
    expect(malformed).toMatchObject({ kind: 'output.not_json', attemptStatus: 'invalid_output', requestId: 'parse' });
  },
  'INV-68':
 () => {
    const ctx = { plugin: { protocol, relaxationOrder: ['customer.drop_items' as const] }, roundNo: 1, maxRounds: 3, proposalCounts: { provider: 1 } };
    const proposal = { proposalId: 'p', version: 1, passesChecks: true };
    expect(resolveRound(proposal, [], ctx)).toEqual({ kind: 'next_evaluator', role: 'customer' });
    expect(resolveRound(proposal, [{ role: 'customer', action: 'recommend_accept', proposalVersion: 1 }], ctx)).toEqual({ kind: 'next_evaluator', role: 'finance' });
    expect(resolveRound(proposal, [{ role: 'customer', action: 'recommend_accept', proposalVersion: 1 }, { role: 'finance', action: 'recommend_accept', proposalVersion: 1 }], ctx)).toEqual({ kind: 'pending_approval', proposalId: 'p' });
    expect(() => resolveRound(proposal, [{ role: 'finance', action: 'recommend_accept', proposalVersion: 1 }], ctx)).toThrow(/non_serial/);
  },
  'CE-143': () => {
    for (const machine of Object.keys(TRANSITIONS) as Machine[]) {
      const table = TRANSITIONS[machine] as Readonly<Record<string, readonly string[]>>;
      for (const [from, allowed] of Object.entries(table)) for (const to of Object.keys(table).filter(s => s !== 'none')) {
        if (allowed.includes(to)) expect(() => assertTransition(machine, from as never, to as never)).not.toThrow();
        else expect(() => assertTransition(machine, from as never, to as never)).toThrow(/state.illegal_transition/);
      }
    }
  },
  'INV-55': () => {
    const p = materialize({ itemKeys: ['sso_login'], modifiers: [] }, input.catalog, input.localDate)!;
    expect(p.termsKey).toBe(canonicalJson(p.terms));
    expect(canonicalJson({ amountCents: p.terms.amountCents, deliveryDate: p.terms.deliveryDate, modifiers: p.terms.modifiers, itemKeys: p.terms.itemKeys })).toBe(p.termsKey);
  },
  'INV-45': () => {
    expect(scenarioOf({ scenarioKey: 'scope_change', scenarioVersion: 1 }).id).toEqual({ key: 'scope_change', version: 1 });
    try { scenarioOf({ scenarioKey: 'scope_change', scenarioVersion: 99 }); throw new Error('Expected scenario guard'); }
    catch (error) { expect(error).toHaveProperty('data', { code: 'run.invalid_state', params: { guard: 'scenario_version' } }); }
  },
};
