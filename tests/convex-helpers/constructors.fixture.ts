import { v } from 'convex/values';
import { anonQuery, memberMutation, memberQuery, userMutation, userQuery, sysMutation, sysQuery, sysAction, userAction } from '../../convex/lib/functions';

export const userRead = userQuery('rooms.listMine')({ args: {}, returns: v.union(v.null(), v.id('users')), handler: async ctx => ctx.viewer.userId });
export const userWrite = userMutation('rooms.create')({ args: {}, returns: v.id('users'), handler: async ctx => ctx.viewer.userId });
export const memberRead = memberQuery('rooms.view')({ args: { roomId: v.id('rooms') }, returns: v.union(v.null(), v.string()), roles: ['finance'], handler: async ctx => ctx.member.role });
export const resolvedRead = memberQuery('rooms.view')({ args: { taskId: v.id('tasks') }, returns: v.union(v.null(), v.id('rooms')), handler: async ctx => ctx.room._id });
export const memberWrite = memberMutation('rooms.close')({ args: { roomId: v.id('rooms') }, returns: v.string(), roles: ['finance', 'provider'], creatorOnly: true, handler: async ctx => ctx.member.role });
export const rateWrite = memberMutation('rooms.close')({ args: { roomId: v.id('rooms') }, returns: v.null(), creatorOnly: true, rateLimit: async () => { throw new RangeError('CANARY'); }, handler: async () => { throw new Error('HANDLER_RAN'); } });
export const internalRead = sysQuery('users.resolve')({ args: {}, returns: v.boolean(), handler: async ctx => !!ctx.log });
export const internalWrite = sysMutation('users.resolve')({ args: {}, returns: v.boolean(), handler: async ctx => !!ctx.log });
export const internalRun = sysAction('users.resolve')({ args: {}, returns: v.boolean(), handler: async ctx => !!ctx.log });
export const publicRun = userAction('invites.createLink')({ args: {}, returns: v.id('users'), handler: async ctx => ctx.viewer.userId });

// F3: deliberately malformed DTOs never reach the platform return validator.
const badResult=()=>({ok:true as const,extra:'RETURN_SECRET_CANARY'});
export const badUserRead=userQuery('rooms.listMine')({args:{},returns:v.union(v.null(),v.object({ok:v.literal(true)})),handler:async()=>badResult()});
export const badMemberRead=memberQuery('rooms.view')({args:{roomId:v.id('rooms')},returns:v.union(v.null(),v.object({ok:v.literal(true)})),handler:async()=>badResult()});
export const badUserWrite=userMutation('rooms.create')({args:{},returns:v.object({ok:v.literal(true)}),handler:async(ctx)=>{await ctx.db.insert('users',{tokenIdentifier:'bad-return-write',displayName:'Rollback',isTestAccount:true,createdAt:1,updatedAt:1});return badResult();}});
export const badMemberWrite=memberMutation('rooms.close')({args:{roomId:v.id('rooms')},returns:v.object({ok:v.literal(true)}),handler:async()=>badResult()});

export const badAnonRead=anonQuery('health.ping')({args:{},returns:v.object({ok:v.literal(true)}),handler:async()=>badResult()});
export const badAction=userAction('invites.createLink')({args:{},returns:v.object({ok:v.literal(true)}),handler:async()=>badResult()});
export const badActionId=userAction('invites.createLink')({args:{},returns:v.id('users'),handler:async()=> 'RETURN_SECRET_CANARY' as import('../../convex/_generated/dataModel').Id<'users'>});
