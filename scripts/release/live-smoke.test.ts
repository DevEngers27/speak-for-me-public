import { describe, expect, it } from 'vitest';
import { validateTarget, approvalArgs, assertPrivateProjection, assertExecutionCounts, sanitizedErrorCode } from './live-smoke.mjs';

const env = { CONVEX_DEPLOYMENT: 'dev:isolated-test-1', CONVEX_URL: 'https://isolated-test-1.convex.cloud', CONVEX_ADMIN_KEY: 'never-log-this-secret', CLERK_JWT_ISSUER_DOMAIN: 'https://example.clerk.accounts.dev' };
const markers = { customer: 'secret-customer', provider: 'secret-provider', finance: 'secret-finance' };
describe('release live verification guards', () => {
  it('requires exact dev selector, URL and explicit deployment acknowledgment', () => {
    expect(validateTarget(env, 'isolated-test-1')).toBe('isolated-test-1');
    for (const [changes, confirmed] of [
      [{}, undefined], [{}, 'other'], [{ CONVEX_DEPLOYMENT: 'prod:isolated-test-1' }, 'isolated-test-1'],
      [{ CONVEX_URL: 'https://other.convex.cloud' }, 'isolated-test-1'],
      [{ CONVEX_ADMIN_KEY: '' }, 'isolated-test-1'],
      [{ CONVEX_DEPLOY_KEY: 'prod:anything|secret' }, 'isolated-test-1'],
      [{ CONVEX_SELF_HOSTED_URL: 'https://other' }, 'isolated-test-1'],
      [{ CLERK_JWT_ISSUER_DOMAIN: 'https://issuer/path' }, 'isolated-test-1'],
    ] as const) {
      expect(() => validateTarget({ ...env, ...changes }, confirmed)).toThrow();
      try { validateTarget({ ...env, ...changes }, confirmed); } catch (error) { expect(String(error)).not.toContain(env.CONVEX_ADMIN_KEY); }
    }
  });
  it('binds every approval to the observed constraints and exact proposal terms', () => {
    const view = { header: { constraintsVersion: 17 }, currentProposal: { proposalId: 'proposal-6', termsKey: 'terms-800' } };
    expect(approvalArgs(view)).toEqual({ proposalId: 'proposal-6', decision: 'approve', expectedConstraintsVersion: 17, expectedTermsKey: 'terms-800', reasonKey: null, note: null });
    expect(() => approvalArgs({ ...view, currentProposal: null })).toThrow();
  });
  it('rejects cross-role private text even when nested in public timeline/export', () => {
    expect(() => assertPrivateProjection('provider', [{ own: markers.provider }, { budget: { visibility: 'none' }, amountChain: null }], markers)).not.toThrow();
    for (const role of ['provider', 'customer', 'finance']) {
      const other = role === 'finance' ? 'customer' : 'finance';
      expect(() => assertPrivateProjection(role, { page: [{ text: `prefix ${markers[other]} suffix` }] }, markers)).toThrow('Cross-role');
    }
    expect(() => assertPrivateProjection('provider', { changeOrder: { amountChain: { capCentsAtExecution: 480000 } } }, markers)).toThrow('financial');
  });
  it('rejects partial/duplicate execution records and unsafe approval state', () => {
    const counts = { executions: 1, ledgerCommits: 1, changeOrders: 1, executedEvents: 1, tasks: 2, unsafeExecutedDecision: false };
    expect(() => assertExecutionCounts(counts, 2)).not.toThrow();
    for (const changes of [{ executions: 2 }, { ledgerCommits: 0 }, { changeOrders: 0 }, { executedEvents: 2 }, { tasks: 3 }, { unsafeExecutedDecision: true }]) {
      expect(() => assertExecutionCounts({ ...counts, ...changes }, 2)).toThrow();
    }
  });
  it('allows only structured error codes; never emits error messages or payloads', () => {
    expect(sanitizedErrorCode({ data: { code: 'approval.stale', note: markers.finance } })).toBe('approval.stale');
    expect(sanitizedErrorCode({ data: '{"code":"auth.role_forbidden"}' })).toBe('auth.role_forbidden');
    for (const error of [new Error(markers.finance), { data: { code: markers.finance } }, { data: 'private finance data' }, null]) expect(sanitizedErrorCode(error)).toBe('verification.failed');
  });
});

import { parseCliOutput, extractCliErrorCode } from './cli-session.mjs';
describe('installed CLI transport compatibility', () => {
  it('treats successful empty stdout as Convex null (no-access read), without accepting malformed JSON', () => {
    expect(parseCliOutput('  \n')).toBeNull();
    expect(parseCliOutput('{"status":"setup"}\n')).toEqual({ status: 'setup' });
    expect(() => parseCliOutput('not a successful result')).toThrow();
  });
  it('extracts only structured safe backend codes from CLI failures', () => {
    expect(extractCliErrorCode('Error: {"code":"auth.role_forbidden","params":{}}')).toBe('auth.role_forbidden');
    expect(extractCliErrorCode('private secret')).toBe('verification.failed');
    expect(extractCliErrorCode('{"code":"PRIVATE_RELEASE_FINANCE"}')).toBe('verification.failed');
  });
});
