import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { appError } from '../lib/errors';
import { openRoomTx,createRoomTx } from '../lib/db';
import { setStatus } from '../lib/status';
import { nowMs, todayInTimeZone } from '../lib/time';
import { assertWithinRate } from '../lib/rateLimit';
import { latestScenarioVersion } from '../scenarios/registry';
import {disposeCurrentRun} from './runs';
import {bindRoomTx} from './runtimeTx';
import {scheduleNextMidnight} from './clock';
import { addMember } from './members';
import { appendEvents } from './events';
import { assertStatus, requireActor, type Actor, type Role } from './common';
export async function createCore(ctx: MutationCtx, actor: Actor, args: {title: string; scenarioKey: 'scope_change'; timeZone: string; myRole: Role}) {
  const title = args.title.normalize('NFC').trim();
  if (![...title].length || [...title].length > 120 || /[<>\p{Cc}]/u.test(title)) throw appError('input.invalid', {field:'title'});
  const scenarioVersion = latestScenarioVersion(args.scenarioKey);
  const now = nowMs(ctx);
  let localDate: string;
  try {localDate = todayInTimeZone(now, args.timeZone);} catch {throw appError('input.invalid', {field:'timeZone'});}
  await assertWithinRate(ctx, {kind:'room_create', actorUserId:actor.userId});
  const tx = await createRoomTx(ctx, {scenarioKey:args.scenarioKey, scenarioVersion, title, timeZone:args.timeZone, localDate, status:'setup', constraintsVersion:0, nextProposalVersion:1, nextRunNo:1, writeSeq:0, createdBy:actor.userId, provenance:actor.provenance??'live', createdAt:now});
  const roomId = tx.room._id;
  await addMember(tx, {userId:actor.userId, role:args.myRole, via:'creator'});
  await appendEvents(tx, [{payload:{type:'room_created',scenarioKey:args.scenarioKey,scenarioVersion},actor:{kind:'user',role:args.myRole},actorUserId:actor.userId},{payload:{type:'member_joined',role:args.myRole},actor:{kind:'user',role:args.myRole},actorUserId:actor.userId}]);
  await scheduleNextMidnight(ctx,roomId,args.timeZone);
  return {roomId};
}
export async function closeCore(ctx: MutationCtx, actor: Actor, args: {roomId: Id<'rooms'>}) {
  const {room,member} = await requireActor(ctx,actor,args.roomId,undefined,true);
  if (room.status === 'closed') return {status:'unchanged' as const};
  if (room.status === 'open') {
    const tx=await openRoomTx(ctx,room._id,{allow:['open']});
    await disposeCurrentRun(bindRoomTx(ctx,tx,actor.userId),'room_closed');
    await setStatus({...ctx,tx},'rooms',room._id,'open','closed',{closedAt:nowMs(ctx)});
    await appendEvents(tx,[{payload:{type:'room_closed'},actor:{kind:'user',role:member.role},actorUserId:actor.userId}]);
    return {status:'closed' as const};
  }
  assertStatus(room,['setup']);
  const tx=await openRoomTx(ctx,room._id,{allow:['setup']});
  await setStatus({...ctx,tx},'rooms',room._id,'setup','closed',{closedAt:nowMs(ctx)});
  await appendEvents(tx,[{payload:{type:'room_closed'},actor:{kind:'user',role:member.role},actorUserId:actor.userId}]);
  return {status:'closed' as const};
}
