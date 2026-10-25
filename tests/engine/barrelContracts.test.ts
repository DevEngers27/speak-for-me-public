import { expect, expectTypeOf, it } from 'vitest';
import {
  isCurrentForApproval, allApproved, canExecuteNow, allowedActions,
  MAX_PROPOSALS_PER_ROLE_PER_RUN, evaluateApprovalSet,
  type ExecutableResult, type ActionCtx, type Role, type TurnKind,
} from '../../core/engine';
import { input, plugin, proposal } from './rules/fixture';
it('W1-1F-r01 approval and action contracts are available through the engine barrel', () => {
  const current = { room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'p' }, proposal: { ...proposal(), _id: 'p', status: 'active' }, input };
  const set = evaluateApprovalSet({ required: [{ role: 'customer', kind: 'terms' }], members: [], rows: [], roomConstraintsVersion: 1, termsKey: current.proposal.termsKey });
  expect(isCurrentForApproval(current)).toBe(true);
  expect(allApproved(set)).toBe(false);
  const result: ExecutableResult = canExecuteNow(plugin, { ...current, approvalSet: set });
  expect(result).toMatchObject({ ok: false, reasons: [{ code: 'approval.missing_role' }] });
  expect(MAX_PROPOSALS_PER_ROLE_PER_RUN).toBe(4);
  expectTypeOf<typeof allowedActions>().parameters.toEqualTypeOf<[Role, TurnKind, ActionCtx]>();
});
