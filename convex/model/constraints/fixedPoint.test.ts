import { expect, it } from 'vitest';
import type { Id } from '../../_generated/dataModel';
import { assertFixedPoint } from './fixedPoint';
const runId = 'run' as Id<'runs'>;
const proposalId = 'proposal' as Id<'proposals'>;
function snapshot() {
  return {
    room: { status: 'open' as const, currentRunId: runId, constraintsVersion: 2 },
    run: { _id: runId, status: 'pending_approval' as const, constraintsVersionAtStart: 2, currentProposalId: proposalId },
    proposals: [{ _id: proposalId, status: 'active' as const }],
    requests: [] as { runId: Id<'runs'>; status: 'open'; constraintsVersion: number }[],
    currentProposalPassesChecks: true,
  };
}
it('CC-05 F1–F4 accept an executable current proposal retained by R2', () => {
  expect(() => assertFixedPoint(snapshot())).not.toThrow();
});
it('CC-05 F1 rejects a stale run version', () => {
  const s = snapshot(); s.run.constraintsVersionAtStart = 1;
  expect(() => assertFixedPoint(s)).toThrow('constraints.F1');
});
it('CC-05 F2 rejects failing checks and zero or multiple requests', () => {
  expect(() => assertFixedPoint({ ...snapshot(), currentProposalPassesChecks: false })).toThrow('constraints.F2');
  const s = snapshot();
  const waiting = { ...s, run: { ...s.run, status: 'needs_input' as const } };
  expect(() => assertFixedPoint(waiting)).toThrow('constraints.F2');
  waiting.requests.push({ runId, status: 'open', constraintsVersion: 2 });
  expect(() => assertFixedPoint(waiting)).not.toThrow();
  waiting.requests.push({ runId, status: 'open', constraintsVersion: 2 });
  expect(() => assertFixedPoint(waiting)).toThrow('constraints.F2');
});
it('CC-05 F3 rejects old open requests even outside current run', () => {
  const s = snapshot(); s.requests.push({ runId: 'old' as Id<'runs'>, status: 'open', constraintsVersion: 1 });
  expect(() => assertFixedPoint(s)).toThrow('constraints.F3');
});
it('CC-05 F4 rejects active proposals outside the current pointer', () => {
  const s = snapshot(); s.proposals.push({ _id: 'other' as Id<'proposals'>, status: 'active' });
  expect(() => assertFixedPoint(s)).toThrow('constraints.F4');
});
