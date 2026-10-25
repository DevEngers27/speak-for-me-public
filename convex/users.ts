import { v } from 'convex/values';
import { userQuery, userMutation, sysQuery } from './lib/functions';
import { appError } from './lib/errors';
import { ensureViewerCore } from './model/users';
import schema from './schema';

export const viewer = userQuery('users.viewer')({
  args: {},
  returns: v.union(v.null(), v.object({ status: v.literal('unprovisioned') }), v.object({
    status: v.literal('ready'), userId: v.id('users'), displayName: v.string(), emailVerified: v.boolean(),
  })),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.viewer.userId);
    if (!user) throw appError('internal');
    return { status: 'ready' as const, userId: user._id, displayName: user.displayName, emailVerified: ctx.viewer.emailVerified };
  },
});
export const ensureViewer = userMutation('users.ensureViewer', { provision: true })({
  args: {}, returns: v.object({ userId: v.id('users'), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError('auth.unauthenticated');
    return await ensureViewerCore(ctx, identity, args);
  },
});
// Internal identity resolution is only used by the allowlisted public action.
export const resolve = sysQuery('users.resolve')({
  args: { tokenIdentifier: v.string() },
  returns: v.union(v.null(), v.object({ ...schema.tables.users.validator.fields, _id: v.id('users'), _creationTime: v.number() })),
  handler: async (ctx, args) => await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', args.tokenIdentifier)).unique(),
});

// F3: actions lack a database reader, so return IDs are normalized internally.
export const validateReturnIds=sysQuery('users.validateReturnIds')({
  args:{ids:v.array(v.object({table:v.string(),id:v.string()}))},returns:v.boolean(),
  handler:async(ctx,args)=>args.ids.every(({table,id})=>Object.hasOwn(schema.tables,table)&&ctx.db.normalizeId(table as import('./_generated/dataModel').TableNames,id)===id),
});
