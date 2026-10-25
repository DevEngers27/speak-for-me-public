/** Constraint protocol and fixpoint; lifecycle operations arrive through ConstraintTx. */
import type { Doc, Id } from '../../_generated/dataModel';
import type { RoomCtx } from '../../lib/db';
import { assertFixedPoint, type FixedPointSnapshot } from './fixedPoint';
export const MAX_REACT_DEPTH = 4;
export const DEV_ASSERTS = process.env.NODE_ENV !== 'production';
export const CONSTRAINT_BUMPERS = [
  'budget.setCap', 'briefs.confirm', 'catalog.confirm', 'catalog.retire',
  'humanRequests.answer', 'openIfReady', 'clock.rollLocalDate',
] as const;
type Revision = Omit<Doc<'constraintRevisions'>, '_id' | '_creationTime' | 'createdAt' | 'roomId' | 'version' | 'previousVersion' | 'localDate' | 'supersededRunId' | 'staleProposalId'>;
type Room = Pick<Doc<'rooms'>, '_id' | 'status' | 'constraintsVersion' | 'localDate'>;
type Disposal = { runId?: Id<'runs'>; staleProposalId?: Id<'proposals'>; previousStatus?: Doc<'runs'>['status'] };

// The orchestration port is backed by the caller-held W2-1 RoomTx. All writes use the caller's
// existing RoomTx; the adapter must neither open a lock nor catch rollback errors.
export interface ConstraintTx {
  persistence?:RoomCtx;
  room(): Promise<Room>;
  hardProjection(): Promise<string>;
  openIfReady(actorUserId?: Id<'users'>): Promise<void>;
  disposeCurrentRun(): Promise<Disposal>;
  insertRevision(revision: Revision & { version: number; previousVersion: number; localDate: string; supersededRunId?: Id<'runs'>; staleProposalId?: Id<'proposals'> }): Promise<void>;
  patchVersion(version: number): Promise<void>;
  appendChanged(fromVersion: number, toVersion: number): Promise<void>;
  startRun(args: { cause: 'room_opened' | 'constraints_changed'; origin: 'system'; reactDepth: number; keepCandidateId?: Id<'proposals'> }): Promise<void>;
  currentRun(): Promise<Pick<Doc<'runs'>, 'status' | 'constraintsVersionAtStart'> | null>;
  fixedPointSnapshot(): Promise<FixedPointSnapshot>;
}
const TERMINAL = new Set<Doc<'runs'>['status']>(['superseded', 'canceled', 'ended_no_agreement', 'executed']);

export async function bump(tx: ConstraintTx, args: Revision & { depth: number }): Promise<number> {
  if (args.depth >= MAX_REACT_DEPTH) throw new Error('constraints.react_depth_exceeded');
  const room = await tx.room();
  if (room.status !== 'open') throw new Error('constraints.bump_not_open');
  const version = room.constraintsVersion + 1;
  const disposed = await tx.disposeCurrentRun();
  await tx.insertRevision({ cause: args.cause, actorUserId: args.actorUserId, sourceRefs: args.sourceRefs,
    version, previousVersion: version - 1, localDate: room.localDate,
    supersededRunId: disposed.runId, staleProposalId: disposed.staleProposalId });
  if(tx.persistence)await tx.persistence.tx.patch('rooms',room._id,{constraintsVersion:version});else await tx.patchVersion(version);
  await tx.appendChanged(version - 1, version);
  await react(tx, { depth: args.depth + 1, cause: args.cause === 'room_opened' ? 'room_opened' : 'constraints_changed',
    keepCandidateId: disposed.previousStatus === 'pending_approval' ? disposed.staleProposalId : undefined });
  if (DEV_ASSERTS) assertFixedPoint(await tx.fixedPointSnapshot());
  return version;
}

export async function react(tx: ConstraintTx, args: { depth: number; cause: 'room_opened' | 'constraints_changed'; keepCandidateId?: Id<'proposals'> }): Promise<void> {
  if (args.depth > MAX_REACT_DEPTH) throw new Error('constraints.react_depth_exceeded');
  const room = await tx.room();
  if (room.status !== 'open') return;
  const run = await tx.currentRun();
  if (run && !TERMINAL.has(run.status)) {
    if (run.constraintsVersionAtStart === room.constraintsVersion) return;
    await tx.disposeCurrentRun();
  }
  // W2-4 startRun must recheck keepCandidateId with passesChecks, never revive rejected.
  await tx.startRun({ cause: args.cause, origin: 'system', reactDepth: args.depth, keepCandidateId: args.keepCandidateId });
}

