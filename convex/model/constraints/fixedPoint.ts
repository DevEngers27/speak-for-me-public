import type { Doc } from '../../_generated/dataModel';

type Run = Pick<Doc<'runs'>, '_id' | 'status' | 'constraintsVersionAtStart' | 'currentProposalId'>;
type Proposal = Pick<Doc<'proposals'>, '_id' | 'status'>;
type Request = Pick<Doc<'humanRequests'>, 'runId' | 'status' | 'constraintsVersion'>;
/** Reads and passesChecks must all come from the same caller-held transaction. */
export type FixedPointSnapshot = {
  room: Pick<Doc<'rooms'>, 'status' | 'constraintsVersion' | 'currentRunId'>;
  run: Run | null;
  proposals: readonly Proposal[];
  requests: readonly Request[];
  currentProposalPassesChecks: boolean;
};
export function assertFixedPoint(snapshot: FixedPointSnapshot): void {
  const { room, run, proposals, requests } = snapshot;
  const nonterminal = run && !['superseded', 'canceled', 'ended_no_agreement', 'executed'].includes(run.status);
  if (room.status === 'open' && (!nonterminal || run._id !== room.currentRunId || run.constraintsVersionAtStart !== room.constraintsVersion)) throw new Error('constraints.F1');
  if (run?.status === 'needs_input' && requests.filter(r => r.status === 'open' && r.runId === run._id).length !== 1) throw new Error('constraints.F2');
  if (run?.status === 'pending_approval' && (!proposals.some(p => p._id === run.currentProposalId && p.status === 'active') || !snapshot.currentProposalPassesChecks)) throw new Error('constraints.F2');
  if (requests.some(r => r.status === 'open' && r.constraintsVersion < room.constraintsVersion)) throw new Error('constraints.F3');
  if (proposals.some(p => p.status === 'active' && p._id !== run?.currentProposalId)) throw new Error('constraints.F4');
}
