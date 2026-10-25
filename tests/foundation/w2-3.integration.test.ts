import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import { fixture, cases, previewMatrix, depthRollback, privacyEquivalentChanges, negotiatingCannotKeepActive, staleHistoryNotRecomputed } from '../battery/w2-3.cases';

describe('W2-3 production writer integration', () => {
  it('TC-PRIV-14 stale historical proposals are never recomputed', staleHistoryNotRecomputed);
  it('CC-14 TC-RUN-23 negotiating active proposal cannot be retained', negotiatingCannotKeepActive);
  it('TC-PRIV-21 CC-21 provider view and timeline are author-neutral', privacyEquivalentChanges);
  it('12.17 preview branches and TC-PRIV-13 customer perturbation', previewMatrix);
  it('CC-15 full transaction rolls back an injected recursive reaction', depthRollback);
  it('CC-08 open ledger writes reject', cases.baselineOpen);
  it('TC-RUN-23 rejected proposal cannot revive after bump', cases.rejectedNeverRevives);
  it('TC-VER-09 only customer notes changes neither cv nor run', async () => {
    const f = await fixture(); const before = await f.room();
    expect(await f.confirmCustomer('2026-11-20', ['login'], 'new private note')).toMatchObject({ bumped: false, constraintsVersion: 1 });
    expect((await f.room()).currentRunId).toBe(before.currentRunId); expect(await f.revisions()).toHaveLength(1);
  });
  it('CC-19 retirement consumes the room price bucket', async () => {
    const f = await fixture();
    await f.provider.mutation(api.catalog.retire, { roomId: f.roomId, itemKey: 'reports', expectedConstraintsVersion: 1 });
    expect(await f.cv()).toBe(2);
    expect((await f.revisions())[1]?.cause).toBe('catalog_changed');
  });
});
