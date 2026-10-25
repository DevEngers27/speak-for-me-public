import { expect, it } from 'vitest';
import { allowedActions, type ActionCtx } from '../../core/engine/protocol/allowedActions';
const ctx: ActionCtx = { snapshotSize: 1, clarifyUsedInRun: false, escalateUsedInRun: false, proposeCountInRun: 0, counterCountInRun: 0, providerRejectLocked: false, topicKeys: ['scope'] };
it.each([
  ['empty propose snapshot', 'provider', 'propose', { snapshotSize: 0 }, 'propose'],
  ['propose limit', 'provider', 'propose', { proposeCountInRun: 4 }, 'propose'],
  ['empty counter snapshot', 'customer', 'evaluate', { snapshotSize: 0 }, 'counter'],
  ['counter limit', 'customer', 'evaluate', { counterCountInRun: 4 }, 'counter'],
  ['clarify used', 'customer', 'evaluate', { clarifyUsedInRun: true }, 'clarify'],
  ['no topics', 'customer', 'evaluate', { topicKeys: [] }, 'clarify'],
  ['escalate used', 'customer', 'evaluate', { escalateUsedInRun: true }, 'escalate'],
  ['provider reject locked', 'provider', 'propose', { providerRejectLocked: true }, 'reject'],
] as const)('05-5.3.3 %s', (_branch, role, kind, patch, action) => {
  expect(allowedActions(role, kind, { ...ctx, ...patch })).not.toContain(action);
});
it('05-5.3.3 lock affects only provider reject', () => {
  expect(allowedActions('customer', 'evaluate', { ...ctx, providerRejectLocked: true })).toContain('reject');
});
it('CN-003-2 counter allowed at n = 1', () => {
  expect(allowedActions('customer', 'evaluate', ctx)).toContain('counter');
  expect(allowedActions('provider', 'propose', { ...ctx, proposeCountInRun: 3 })).toContain('propose');
  expect(allowedActions('finance', 'evaluate', ctx)).not.toContain('counter');
});
