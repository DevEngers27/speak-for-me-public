import { expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { withSanitizedErrors } from '../../convex/lib/errors';
import * as ops from '../../convex/lib/opsLog';
import { renderPublicText } from '../../core/engine/publicText';

it('11.6 normalized ConvexError passes through', async () => {
  for (const data of [{code: 'approval.stale', params: {currentConstraintsVersion: 2}}, {code: 'run.rate_limited', params: {retryAfterMs: 1000}}]) {
    const error = new ConvexError(data);
    await expect(withSanitizedErrors('health.whoami', async () => { throw error; })).rejects.toBe(error);
  }
});
it('canon-1.2 33–40-char itemKey renders via renderPublicText', () => {
  for (let length = 33; length <= 40; length++) {
    const key = 'a'.repeat(length);
    expect(renderPublicText('constraints_updated', {changedItemKeys: [key], severity: 'high', effectiveDate: '2026-10-24'} as never)).toContain(key);
  }
});
it.each([['unknown code', {code: 'unknown.code', params: {}}], ['undeclared params', {code: 'approval.stale', params: {currentConstraintsVersion: 2, secret: 'CANARY'}}]])('11.6 %s becomes internal', async (_name, data) => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const publicLog = vi.spyOn(ops, 'publicOpsLog');
  await expect(withSanitizedErrors('health.whoami', async () => {throw new ConvexError(data);})).rejects.toMatchObject({data: {code: 'internal', params: {}}});
  expect(publicLog).toHaveBeenCalledExactlyOnceWith('unhandled', {fn: 'health.whoami', errorClass: 'Other'});
  expect(log.mock.calls).toEqual([[JSON.stringify({fn: 'health.whoami', code: 'unhandled', errorClass: 'Other'})]]);
  publicLog.mockRestore();
  log.mockRestore();
});
it('11.6 plain Error becomes internal and logs only errorClass', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await expect(withSanitizedErrors('health.whoami', async () => {throw new Error('CANARY');})).rejects.toMatchObject({data: {code: 'internal', params: {}}});
  expect(log.mock.calls).toEqual([[JSON.stringify({fn: 'health.whoami', code: 'unhandled', errorClass: 'Other'})]]);
  log.mockRestore();
});
it('11.6 auth.unauthenticated is lowercase', async () => {
  const {convexTest} = await import('convex-test');
  const {default: schema} = await import('../../convex/schema');
  const {modules} = await import('../convex-helpers/setup');
  const {api} = await import('../../convex/_generated/api');
  await expect(convexTest(schema, modules).mutation(api.users.ensureViewer, {})).rejects.toThrow(/auth.unauthenticated/);
});
it('11.6 hostile thrown values become internal', async () => {
  const error = new Proxy({}, {getPrototypeOf() {throw Error('CANARY');}});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await expect(withSanitizedErrors('health.ping', async () => {throw error;})).rejects.toMatchObject({data: {code: 'internal', params: {}}});
    expect(log.mock.calls).toEqual([[JSON.stringify({fn: 'health.ping', code: 'unhandled', errorClass: 'Other'})]]);
  } finally {log.mockRestore();}
});

it.each([new TypeError('CANARY'), new RangeError('CANARY'), new SyntaxError('CANARY'), Object.assign(new Error('CANARY'), {name: 'ArgumentValidationError'})])('11.6 errorClassOf whitelists $name', error => {
  expect(ops.errorClassOf(error)).toBe(error.name);
});
