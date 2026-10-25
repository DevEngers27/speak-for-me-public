import { canonicalJson } from '../canonicalJson';
import type { ScenarioPlugin } from '../plugin';
import type { ReasonCode } from '../reasonCodes';
import type { ProposalLike, RuleInputBase, View } from './types';
import type { ApprovalSetResult } from './approvals';
import { IntegrityError } from './types';
import { checkProposal } from './checkProposal';

type CurrentInput = {
  room: { status: string; currentRunId: string | null };
  run: { _id: string; status: string; currentProposalId: string | null } | null;
  proposal: { _id: string; status: string };
};
export function isCurrentForApproval(x: CurrentInput): boolean {
  return x.room.status === 'open' && x.run !== null && x.room.currentRunId === x.run._id
    && x.run.status === 'pending_approval' && x.run.currentProposalId === x.proposal._id
    && x.proposal.status === 'active';
}
export const allApproved = (set: ApprovalSetResult): boolean => set.complete;
export type ExecutableResult = { ok: true } | { ok: false; reasons: readonly { code: ReasonCode; role?: string }[] };
type ExecutionInput<RI extends RuleInputBase> = CurrentInput & {
  proposal: ProposalLike & { _id: string; status: string; termsKey: string };
  input: View<RI>;
};
/** Currentness and current rules only; approval completeness is a separate predicate. */
export function isExecutable<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, x: ExecutionInput<RI>): ExecutableResult {
  if (x.input.viewer !== 'system') throw new IntegrityError('execution_on_view');
  if (canonicalJson(x.proposal.terms) !== x.proposal.termsKey) throw new IntegrityError('terms_key');
  const reasons: { code: ReasonCode }[] = [];
  if (!isCurrentForApproval(x)) reasons.push({ code: x.proposal.status === 'stale' ? 'version.stale_constraints'
    : x.proposal.status === 'executed' ? 'approval.already_executed' : 'approval.not_current' });
  for (const code of checkProposal(p, x.input, x.proposal).blocking) reasons.push({ code });
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
export function canExecuteNow<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, x: ExecutionInput<RI> & { approvalSet: ApprovalSetResult }): ExecutableResult {
  const result = isExecutable(p, x);
  const reasons = [...(result.ok ? [] : result.reasons), ...x.approvalSet.reasons];
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
