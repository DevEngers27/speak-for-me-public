import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import { memberMutation,userMutation,userAction,userQuery,sysQuery,sysMutation } from './lib/functions';
import { roleV } from './lib/validators';
import { createCore,acceptCore,authorizeLinkCore,insertLinkCore } from './model/invites';
import { randomToken,sha256Hex } from './lib/crypto';
import type { Id } from './_generated/dataModel';
import type { Role } from './model/common';
const resultV=v.object({inviteId:v.id('invites'),expiresAt:v.number()});
export const create=memberMutation('invites.create')({args:{roomId:v.id('rooms'),role:roleV,invitedEmail:v.string()},returns:resultV,creatorOnly:true,handler:async(ctx,args)=>await createCore(ctx,{userId:ctx.viewer.userId},args)});
export const authorizeLink=sysQuery('invites.authorizeLink')({args:{roomId:v.id('rooms'),role:roleV,actorUserId:v.id('users')},returns:v.null(),handler:async(ctx,args)=>{await authorizeLinkCore(ctx,{userId:args.actorUserId},args);return null;}});
export const insertLink=sysMutation('invites.insertLink')({args:{roomId:v.id('rooms'),role:roleV,tokenHash:v.string(),actorUserId:v.id('users')},returns:resultV,handler:async(ctx,args)=>await insertLinkCore(ctx,{userId:args.actorUserId},args)});
export const createLink=userAction('invites.createLink')({args:{roomId:v.id('rooms'),role:roleV},returns:v.object({inviteId:v.id('invites'),token:v.string(),expiresAt:v.number()}),handler:async(ctx,args)=>{
  const identity={roomId:args.roomId,role:args.role,actorUserId:ctx.viewer.userId};
  await ctx.runQuery(makeFunctionReference<'query',typeof identity,null>('invites:authorizeLink'),identity);
  const token=randomToken(),tokenHash=await sha256Hex(token);
  const result=await ctx.runMutation(makeFunctionReference<'mutation',typeof identity & {tokenHash:string},{inviteId:Id<'invites'>;expiresAt:number}>('invites:insertLink'),{...identity,tokenHash});
  return {inviteId:result.inviteId,token,expiresAt:result.expiresAt};
}});
export const accept=userMutation('invites.accept')({args:{invite:v.union(v.object({by:v.literal('email'),inviteId:v.id('invites')}),v.object({by:v.literal('link'),token:v.string()}))},returns:v.object({roomId:v.id('rooms'),role:roleV,status:v.union(v.literal('joined'),v.literal('already_joined'))}),handler:async(ctx,args)=>{
  const identity=await ctx.auth.getUserIdentity();
  return await acceptCore(ctx,{userId:ctx.viewer.userId,email:identity?.email,emailVerified:ctx.viewer.emailVerified},args);
}});
export const listMine=userQuery('invites.listMine')({args:{},returns:v.union(v.null(),v.object({emailVerified:v.boolean(),invites:v.array(v.object({inviteId:v.id('invites'),roomTitle:v.string(),role:roleV,invitedByDisplayName:v.string(),expiresAt:v.number()}))})),handler:async ctx=>{
  const items:{inviteId:Id<'invites'>;roomTitle:string;role:Role;invitedByDisplayName:string;expiresAt:number}[]=[];
  const identity=await ctx.auth.getUserIdentity();
  if(ctx.viewer.emailVerified && identity?.email) {
    const rows=await ctx.db.query('invites').withIndex('by_email_status',q=>q.eq('invitedEmail',identity.email!.normalize('NFC').toLowerCase()).eq('status','open')).collect();
    for(const row of rows){const room=await ctx.db.get(row.roomId);if(!room||room.status!=='setup')continue;const author=await ctx.db.query('members').withIndex('by_room_user',q=>q.eq('roomId',room._id).eq('userId',row.createdBy)).unique();items.push({inviteId:row._id,roomTitle:room.title,role:row.role,invitedByDisplayName:author?.displayName??'Member',expiresAt:row.expiresAt});}
  }
  return {emailVerified:ctx.viewer.emailVerified,invites:items};
}});
