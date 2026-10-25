import type { ScenarioPlugin } from '../plugin';
import { PluginContractError } from '../rules/types';

export type Evaluation = { role: string } & (
  | { action: 'recommend_accept'; proposalVersion: number }
  | { action: 'reject'; reasonKey: string }
  | { action: 'counter'; candidateKey: string; optionKey?: string; counterPasses: boolean }
  | { action: 'clarify'; handledBy: 'human' | 'code'; toRole?: string }
  | { action: 'escalate'; accepted: boolean; toRole?: string; requestKind?: 'infeasible' | 'agent_escalated' }
);
export type RoundProposal = {
  proposalId: string; version: number;
  /** Current check result, rechecked at S3; false with no evaluations is S1. */
  passesChecks: boolean;
  /** Explicit S1 history flag: an initially blocked proposal cannot be evaluated. */
  initiallyBlocked?: boolean;
};
export type RoundContext = {
  /** maxRounds already includes any granted extension. */
  roundNo: number; maxRounds: number; plugin: Pick<ScenarioPlugin, 'protocol' | 'relaxationOrder'>;
  /** Completed propose/counter moves, including this round. */
  proposalCounts: Readonly<Record<string, number>>;
  maxProposalsPerRolePerRun?: number;
  providerHasCandidates?: boolean;
  limitCause?: 'call_limit' | 'spend_limit';
};
export type RoundFeedback = { fit: 'blocked' } | { kind: 'not_accepted'; counter?: { candidateKey: string } };
export type RoundDecision =
  | { kind: 'needs_input'; requestKind: 'clarify' | 'infeasible' | 'agent_escalated'; toRole: string }
  | { kind: 'pending_approval'; proposalId: string }
  | { kind: 'next_evaluator'; role: string }
  | { kind: 'next_round'; role: string; roundNo: number; feedback: RoundFeedback }
  | { kind: 'rounds_exhausted'; requestKind: 'rounds_exhausted'; toRole: string; cause: 'rounds' | 'no_candidates' | 'call_limit' | 'spend_limit' };

/** Pure serial planner. Check results and escalation policy decisions are supplied by the caller. */
export function resolveRound(proposal: RoundProposal, evaluations: readonly Evaluation[], ctx: RoundContext): RoundDecision {
  const tradeoffRole = ctx.plugin.relaxationOrder[0]?.split('.')[0];
  if (!tradeoffRole) throw new PluginContractError('empty_relaxation_order');
  const protocol = ctx.plugin.protocol;
  const cap = Math.min(4, ctx.maxProposalsPerRolePerRun ?? protocol.maxProposalsPerRolePerRun);
  const exhausted = (): RoundDecision => ({
    kind: 'rounds_exhausted', requestKind: 'rounds_exhausted', toRole: tradeoffRole,
    cause: ctx.limitCause ?? (ctx.providerHasCandidates === false ? 'no_candidates' : (ctx.proposalCounts[protocol.proposerRole] ?? 0) >= cap ? 'no_candidates' : 'rounds'),
  });
  const next = (feedback: RoundFeedback): RoundDecision =>
    ctx.limitCause !== undefined || ctx.roundNo >= ctx.maxRounds || (ctx.proposalCounts[protocol.proposerRole] ?? 0) >= cap || ctx.providerHasCandidates === false
      ? exhausted() : { kind: 'next_round', role: protocol.proposerRole, roundNo: ctx.roundNo + 1, feedback };
  // A blocked proposal never consumes an evaluation turn or exposes check details.
  if (evaluations.length === 0 && !proposal.passesChecks) return next({ fit: 'blocked' });
  if (proposal.initiallyBlocked && evaluations.length > 0) throw new PluginContractError('non_serial_evaluations');
  if (evaluations.some((e, n) => e.role !== protocol.evaluatorOrder[n]) || evaluations.length > protocol.evaluatorOrder.length || evaluations.some((e, n) => n < evaluations.length - 1 && ((e.action === 'clarify' && e.handledBy === 'human') || (e.action === 'escalate' && e.accepted)))) throw new PluginContractError('non_serial_evaluations');
  const clarify = evaluations.find(e => e.action === 'clarify' && e.handledBy === 'human');
  if (clarify) {
    if (clarify.action !== 'clarify' || !clarify.toRole) throw new PluginContractError('missing_request_role');
    return { kind: 'needs_input', requestKind: 'clarify', toRole: clarify.toRole };
  }
  const escalation = evaluations.find(e => e.action === 'escalate' && e.accepted);
  if (escalation) {
    if (escalation.action !== 'escalate' || !escalation.toRole) throw new PluginContractError('missing_request_role');
    return { kind: 'needs_input', requestKind: escalation.requestKind ?? 'agent_escalated', toRole: escalation.toRole };
  }
  const missing = protocol.evaluatorOrder[evaluations.length];
  if (missing) return { kind: 'next_evaluator', role: missing };
  if (evaluations.length > 0 && evaluations.every(e => e.action === 'recommend_accept' && e.proposalVersion === proposal.version)) return proposal.passesChecks ? { kind: 'pending_approval', proposalId: proposal.proposalId } : next({ fit: 'blocked' });
  const counter = evaluations.find(e => e.action === 'counter' && e.counterPasses && protocol.counterRoles.includes(e.role) && (ctx.proposalCounts[e.role] ?? 0) <= cap);
  return next(counter?.action === 'counter' ? { kind: 'not_accepted', counter: { candidateKey: counter.candidateKey } } : { kind: 'not_accepted' });
}
