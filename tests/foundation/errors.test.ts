import {expect, it} from 'vitest';
import {ConvexError, convexToJson, jsonToConvex} from 'convex/values';
import {defineErrors, param, type Audience} from '../../convex/lib/errors';
const specs = {
  'budget.over': {params: {
    overByCents: param('cents', ['finance']),
    itemKeys: param('keys', ['customer', 'provider', 'finance']),
    hidden: param('int'),
  }},
  'date.after_deadline': {params: {deadline: param('date', ['provider', 'customer'])}},
  'run.invalid_state': {internal: true, params: {}},
} as const;
const errors = defineErrors(specs);
it('returns only declared audience params, and types the same split', () => {
  const error = errors.create('budget.over', {overByCents: 120, itemKeys: ['sso_login'], hidden: 7});
  expect(errors.toPayload(error, 'provider')).toEqual({code: 'budget.over', params: {itemKeys: ['sso_login']}});
  expect(errors.toPayload(error, 'finance')).toEqual({code: 'budget.over', params: {overByCents: 120, itemKeys: ['sso_login']}});
  const projected = errors.project(error, 'provider');
  // @ts-expect-error restricted amount absent from provider type
  void projected.params.overByCents;
  // @ts-expect-error unmarked param is fail-closed at type level
  void projected.params.hidden;
  expect(projected.params.itemKeys).toEqual(['sso_login']);
  expect(errors.toPayload(errors.create('date.after_deadline', {deadline: '0000-02-29'}), 'provider').params).toEqual({});
  expect(JSON.stringify(error)).not.toContain('120');
});
it('rejects sparse arrays, float amounts, strings in numbers, and invalid dates at creation', () => {
  for (const value of [1.5, -1, 1e11 + 1, 'CANARY', NaN]) {
    expect(() => errors.create('budget.over', {overByCents: value as number, itemKeys: [], hidden: 1})).toThrow(TypeError);
  }
  expect(() => errors.create('budget.over', {overByCents: 0, itemKeys: new Array<string>(2), hidden: 1})).toThrow(TypeError);
  expect(() => errors.create('date.after_deadline', {deadline: '2026-02-30'})).toThrow(TypeError);
  const error = errors.create('budget.over', {overByCents: 0, itemKeys: ['sso_login'], hidden: 1});
  expect(Object.isFrozen(error.params.itemKeys)).toBe(true);
});
it('round-trips a client-safe payload through real Convex serialization and the mapper', () => {
  const error = errors.create('budget.over', {overByCents: 120, itemKeys: ['sso_login'], hidden: 1});
  const payload = errors.toPayload(error, 'provider');
  const wire = jsonToConvex(convexToJson(payload));
  expect(wire).toEqual(payload);
  expect(errors.toClientError(new ConvexError(wire), 'provider')).toEqual(payload);
  expect(errors.toConvexError(error, 'provider').data).toEqual(payload);
});
it('maps unknown, internal, foreign, malformed, or hostile thrown values to a safe fallback', () => {
  const fallback = {code: 'internal', params: {}};
  const foreign = defineErrors(specs).create('budget.over', {overByCents: 99, itemKeys: ['SECRET'], hidden: 1});
  for (const value of [new Error('CANARY'), foreign, errors.create('run.invalid_state', {}),
    {code: 'budget.over', params: {itemKeys: ['x'], overByCents: 'CANARY'}},
    {code: 'unknown.code', params: {}}, {get code() {throw Error('CANARY');}},
    {code: 'budget.over', params: {'café': 1}}, {code: 'budget.over', params: {'a\nb': 1}},
    {code: 'budget.over', params: {['x'.repeat(1025)]: 1}}]) {
    expect(errors.toPayload(value, 'finance')).toEqual(fallback);
  }
});
it('clones and freezes registry definitions', () => {
  const spec: {'item.unknown': {params: {itemKey: {kind: 'key'; audiences: Audience[]}}}} = {'item.unknown': {params: {itemKey: {kind: 'key' as const, audiences: ['finance' as const]}}}};
  const registry = defineErrors(spec);
  spec['item.unknown'].params.itemKey.audiences.push('provider');
  const e = registry.create('item.unknown', {itemKey: 'sso_login'});
  expect(registry.toPayload(e, 'provider').params).toEqual({});
  expect(() => defineErrors({'UPPER_CASE': {params: {}}})).toThrow();
});

it('sanitizes thrown values before Convex can serialize private exception content', async () => {
  const {withSanitizedErrors} = await import('../../convex/lib/errors');
  for (const error of [Error('PRIVATE_CANARY'), new ConvexError({code: 'private', params: {secret: 'PRIVATE_CANARY'}})]) {
    const handler = () => withSanitizedErrors("health.ping", async () => {throw error;});
    try { await handler(); expect.fail('expected rejection'); } catch (thrown) {
      expect(thrown).toBeInstanceOf(ConvexError);
      expect((thrown as ConvexError<{code: string}>).data).toEqual({code: 'internal', params: {}});
      expect(String(thrown)).not.toContain('PRIVATE_CANARY');
    }
  }
});
