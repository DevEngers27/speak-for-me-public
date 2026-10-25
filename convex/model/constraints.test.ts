import { describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import { bump, MAX_REACT_DEPTH, react, withConstraintChange, type ConstraintTx } from './constraints';
function fixture(previousStatus: Doc<'runs'>['status'] = 'negotiating') {
  const room = { _id: 'room' as Id<'rooms'>, status: 'open' as Doc<'rooms'>['status'], constraintsVersion: 1, localDate: '2026-10-24' };
  let projection = 'before';
  const tx: ConstraintTx = {
    room: vi.fn(async () => room), hardProjection: vi.fn(async () => projection),
    openIfReady: vi.fn(async () => {}),
    disposeCurrentRun: vi.fn(async () => ({ runId: 'old' as Id<'runs'>, staleProposalId: 'proposal' as Id<'proposals'>, previousStatus })),
    insertRevision: vi.fn(async () => {}), patchVersion: vi.fn(async version => { room.constraintsVersion = version; }),
    appendChanged: vi.fn(async () => {}), startRun: vi.fn(async () => {}),
    currentRun: vi.fn(async () => null), fixedPointSnapshot: vi.fn(async () => ({
      room: { ...room, currentRunId: 'new' as Id<'runs'> },
      run: { _id: 'new' as Id<'runs'>, status: 'negotiating' as const, constraintsVersionAtStart: room.constraintsVersion, currentProposalId: undefined },
      proposals: [], requests: [], currentProposalPassesChecks: false,
    })),
  };
  return { tx, room, change: () => { projection = 'after'; return Promise.resolve([]); } };
}
const args = { cause: 'brief_confirmed' as const, sourceRefs: [], depth: 0 };
describe('W2-3 bump orchestration', () => {
  it('CC-01 one projection change produces exactly one revision, bump and reaction', async () => {
    const { tx, change } = fixture();
    expect(await withConstraintChange(tx, { cause: 'brief_confirmed' }, change)).toEqual({ changed: true, constraintsVersion: 2 });
    expect(tx.insertRevision).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 2, previousVersion: 1, localDate: '2026-10-24' }));
    expect(tx.patchVersion).toHaveBeenCalledExactlyOnceWith(2);
    expect(tx.appendChanged).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(tx.startRun).toHaveBeenCalledOnce();
    expect(tx.fixedPointSnapshot).toHaveBeenCalledOnce();
  });
  it('TC-VER-09 unchanged projection writes no revision and leaves run untouched', async () => {
    const { tx } = fixture();
    expect(await withConstraintChange(tx, { cause: 'brief_confirmed' }, async () => [])).toEqual({ changed: false, constraintsVersion: 1 });
    expect(tx.insertRevision).not.toHaveBeenCalled();
    expect(tx.disposeCurrentRun).not.toHaveBeenCalled();
  });
  it('CC-07 setup sources apply without an intermediate bump', async () => {
    const { tx, room, change } = fixture(); room.status = 'setup';
    await withConstraintChange(tx, { cause: 'catalog_changed' }, change);
    expect(tx.openIfReady).toHaveBeenCalledOnce();
    expect(tx.hardProjection).not.toHaveBeenCalled();
    expect(tx.patchVersion).not.toHaveBeenCalled();
  });
  for (const status of ['negotiating', 'needs_input', 'ended_no_agreement', 'canceled', 'pending_approval'] as const) {
    it(`CC-14 TC-RUN-23 only pending_approval supplies R2 candidate: ${status}`, async () => {
      const { tx } = fixture(status); await bump(tx, args);
      expect(tx.startRun).toHaveBeenCalledExactlyOnceWith({ cause: 'constraints_changed', origin: 'system', reactDepth: 1, keepCandidateId: status === 'pending_approval' ? 'proposal' : undefined });
    });
  }
  it('CC-15 depth guard rejects before any write', async () => {
    const { tx } = fixture();
    await expect(bump(tx, { ...args, depth: MAX_REACT_DEPTH })).rejects.toThrow('constraints.react_depth_exceeded');
    expect(tx.disposeCurrentRun).not.toHaveBeenCalled();
    expect(tx.insertRevision).not.toHaveBeenCalled();
    await expect(react(tx, { depth: MAX_REACT_DEPTH + 1, cause: 'constraints_changed' })).rejects.toThrow('constraints.react_depth_exceeded');
  });
  it('CC-12 terminal rooms reject before applying sources', async () => {
    const { tx, room, change } = fixture(); room.status = 'executed';
    const apply = vi.fn(change);
    await expect(withConstraintChange(tx, { cause: 'brief_confirmed' }, apply)).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });
  it('CC-06 react is idempotent at the current version', async () => {
    const { tx } = fixture();
    tx.currentRun = vi.fn(async () => ({ status: 'negotiating' as const, constraintsVersionAtStart: 1 }));
    await react(tx, { depth: 1, cause: 'constraints_changed' });
    expect(tx.startRun).not.toHaveBeenCalled();
    expect(tx.disposeCurrentRun).not.toHaveBeenCalled();
  });
});
