import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { appError } from '../lib/errors';
import { openRoomTx } from '../lib/db';
import { setStatus } from '../lib/status';
import { nowMs } from '../lib/time';
import { sha256Hex } from '../lib/crypto';
import { requireActor, assertStatus, type Actor, type Role } from './common';
import { appendEvents } from './events';
import { addMember } from './members';
import { openIfReady } from './constraints';
export async function authorizeLinkCore(ctx: QueryCtx, actor: Actor, args: {roomId: Id<'rooms'>; role: Role}) {
  const resolved = await requireActor(ctx,actor,args.roomId,undefined,true);
  assertStatus(resolved.room,['setup']);
  if (await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',args.roomId).eq('role',args.role)).unique()) throw appError('invite.seat_taken',{role:args.role});
  return resolved;
}
async function insertInvite(ctx: MutationCtx, actor: Actor, args: {roomId:Id<'rooms'>;role:Role}, value: {mode:'email';invitedEmail:string}|{mode:'link';tokenHash:string}) {
  const {member}=await authorizeLinkCore(ctx,actor,args);
  const tx=await openRoomTx(ctx,args.roomId,{allow:['setup']});
  const old=await ctx.db.query('invites').withIndex('by_room_role',q=>q.eq('roomId',args.roomId).eq('role',args.role)).collect();
  for(const row of old) if(row.status==='open') await setStatus({...ctx,tx},'invites',row._id,'open','superseded');
  if(value.mode==='link') {
    const duplicate=await ctx.db.query('invites').withIndex('by_tokenHash',q=>q.eq('tokenHash',value.tokenHash)).take(1);
    if(duplicate.length) throw appError('internal');
  }
  const now=nowMs(ctx),expiresAt=now+72*3600000;
  const inviteId=await tx.insert('invites',{roomId:args.roomId,role:args.role,...value,status:'open',expiresAt,createdBy:actor.userId,createdAt:now});
  await appendEvents(tx,[{payload:{type:'invite_created',role:args.role,mode:value.mode},actor:{kind:'user',role:member.role},actorUserId:actor.userId}]);
  return {inviteId,expiresAt};
}
export async function createCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;role:Role;invitedEmail:string}) {
  await authorizeLinkCore(ctx,actor,args);
  const invitedEmail=args.invitedEmail.normalize('NFC').toLowerCase();
  if(invitedEmail.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(invitedEmail)) throw appError('input.invalid',{field:'invitedEmail'});
  return await insertInvite(ctx,actor,args,{mode:'email',invitedEmail});
}
export async function insertLinkCore(ctx:MutationCtx,actor:Actor,args:{roomId:Id<'rooms'>;role:Role;tokenHash:string}) {
  if(!/^[0-9a-f]{64}$/.test(args.tokenHash)) throw appError('internal');
  return await insertInvite(ctx,actor,args,{mode:'link',tokenHash:args.tokenHash});
}
export async function acceptCore(ctx:MutationCtx,actor:Actor & {email?:string;emailVerified:boolean},args:{invite:{by:'email';inviteId:Id<'invites'>}|{by:'link';token:string}}) {
  let invite:Doc<'invites'>|null;
  if(args.invite.by==='email') {
    invite=await ctx.db.get(args.invite.inviteId);
    if(!invite || invite.mode!=='email') throw appError('invite.invalid');
    if(!actor.emailVerified) throw appError('invite.email_unverified');
    if(invite.invitedEmail!==actor.email?.normalize('NFC').toLowerCase()) throw appError('invite.invalid');
  } else {
    const hash=await sha256Hex(args.invite.token);
    const rows=await ctx.db.query('invites').withIndex('by_tokenHash',q=>q.eq('tokenHash',hash)).take(2);
    if(rows.length!==1) throw appError('invite.invalid');
    invite=rows[0]!;
  }
  if(invite.status==='accepted' && invite.acceptedBy===actor.userId) return {roomId:invite.roomId,role:invite.role,status:'already_joined' as const};
  if(invite.status!=='open'||nowMs(ctx)>=invite.expiresAt) throw appError('invite.invalid');
  const tx=await openRoomTx(ctx,invite.roomId,{allow:['setup']});
  await addMember(tx,{userId:actor.userId,role:invite.role,via:'invite',inviteId:invite._id});
  await setStatus({...ctx,tx},'invites',invite._id,'open','accepted',{acceptedBy:actor.userId,acceptedAt:nowMs(ctx)});
  await appendEvents(tx,[{payload:{type:'member_joined',role:invite.role},actor:{kind:'user',role:invite.role},actorUserId:actor.userId}]);
  await openIfReady({...ctx,tx},tx.room._id,actor.userId);
  return {roomId:invite.roomId,role:invite.role,status:'joined' as const};
}
