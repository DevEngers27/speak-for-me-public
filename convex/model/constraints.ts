/** Public constraint facade composes the lifecycle with its dependency-free port. */
import type { RoomCtx } from '../lib/db';
import type { Doc, Id } from '../_generated/dataModel';
import { hardProjection } from '@core/engine';
import { scenarioOf } from '../scenarios/registry';
import { assertStatus } from './common';
import { loadRuleInput } from './constraintInput';
import { disposeCurrentRun, startRunTx, openIfReady as openLifecycle } from './runs';
import { bindRoomTx } from './runtimeTx';
import { appError } from '../lib/errors';
import { bump, type ConstraintTx } from './constraints/protocol';
import { createConstraintTx } from './constraints/adapter';
import { readinessGaps } from './constraints/readiness';
export { bump, react, MAX_REACT_DEPTH, DEV_ASSERTS, CONSTRAINT_BUMPERS, type ConstraintTx } from './constraints/protocol';
export { readinessGaps, roomReadiness, type ReadinessGap } from './constraints/readiness';
type Revision = Omit<Doc<'constraintRevisions'>, '_id' | '_creationTime' | 'createdAt' | 'roomId' | 'version' | 'previousVersion' | 'localDate' | 'supersededRunId' | 'staleProposalId'>;
export type ConstraintChange={cause:Revision['cause'];sourceRefs:Revision['sourceRefs'];actorUserId:Id<'users'>};
export function withConstraintChange(ctx:ConstraintTx, change:Pick<Revision,'cause'|'actorUserId'>, apply:()=>Promise<Revision['sourceRefs']>):Promise<{changed:boolean;constraintsVersion:number}>;
export function withConstraintChange<T>(ctx:RoomCtx,roomId:Id<'rooms'>,change:ConstraintChange,write:()=>Promise<T>):Promise<T>;
export async function withConstraintChange<T>(context:ConstraintTx|RoomCtx,arg:Id<'rooms'>|Pick<Revision,'cause'|'actorUserId'>,callback:ConstraintChange|(()=>Promise<Revision['sourceRefs']>),write?:()=>Promise<T>):Promise<T|{changed:boolean;constraintsVersion:number}> {
  if('tx'in context){
    const ctx=context, roomId=arg as Id<'rooms'>,change=callback as ConstraintChange;
    if(ctx.tx.room._id!==roomId)throw new TypeError('Cross-room constraint write');
    const room=(await ctx.db.get(roomId))!;assertStatus(room);
    const before=room.status==='open'?(await loadRuleInput(ctx,roomId)):null;
    const result=await write!();
    let bumped=false;
    if(before&&hardProjection(scenarioOf(room),before)!==hardProjection(scenarioOf(room),await loadRuleInput(ctx,roomId))){
      await bump(makeConstraintTx(ctx,roomId),{...change,depth:0});bumped=true;
    }else if(room.status==='setup'){await openIfReady(ctx,roomId,change.actorUserId);bumped=(await ctx.db.get(roomId))!.constraintsVersion!==room.constraintsVersion;}
    const current=(await ctx.db.get(roomId))!;
    return result&&typeof result==='object'&&'constraintsVersion'in result?{...result,constraintsVersion:current.constraintsVersion,bumped}:result;
  }
  const tx=context, change=arg as Pick<Revision,'cause'|'actorUserId'>,apply=callback as ()=>Promise<Revision['sourceRefs']>;

  const room = await tx.room();
  if (room.status !== 'setup' && room.status !== 'open') throw appError('run.invalid_state', { guard: 'room_status' });
  if (room.status === 'setup') {
    await apply();
    await tx.openIfReady(change.actorUserId);
    return { changed: false, constraintsVersion: (await tx.room()).constraintsVersion };
  }
  const before = await tx.hardProjection();
  const sourceRefs = await apply();
  if (before === await tx.hardProjection()) return { changed: false, constraintsVersion: room.constraintsVersion };
  return { changed: true, constraintsVersion: await bump(tx, { ...change, sourceRefs, depth: 0 }) };
}


export async function openIfReady(ctx:RoomCtx,roomId:Id<'rooms'>,actorUserId?:Id<'users'>){
 if(roomId!==ctx.tx.room._id)throw new TypeError('Cross-room readiness');
 await openLifecycle(bindRoomTx(ctx,ctx.tx,actorUserId??null));
 return readinessGaps(ctx,(await ctx.db.get(roomId))!);
}
export function makeConstraintTx(ctx:RoomCtx,roomId:Id<'rooms'>):ConstraintTx {
  return createConstraintTx(ctx,roomId,{disposeCurrentRun,startRunTx,openIfReady:openLifecycle});
}
