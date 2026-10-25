/** W2-1: handwritten authenticated Convex constructors (11 §11.6). */
import {
  query as rawQuery, mutation as rawMutation, action as rawAction,
  internalQuery as rawInternalQuery, internalMutation as rawInternalMutation, internalAction as rawInternalAction,
} from '../_generated/server';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id, TableNames } from '../_generated/dataModel';
import { makeFunctionReference, type RegisteredQuery, type RegisteredMutation, type RegisteredAction, type UserIdentity } from 'convex/server';
import {v,type GenericValidator,type Infer,type ObjectType,type PropertyValidators} from 'convex/values';
import {EngineInvariantError} from '../../core/engine';
import { appError, withInternalErrors, withSanitizedErrors } from './errors';
import {checkedReturn,invalidReturn} from './returns';
import type { PublicFnName, InternalFnName } from './opsLog';

export type Viewer = { userId: Id<'users'>; tokenIdentifier: string; emailVerified: boolean };
export type UserCtx<C = QueryCtx> = C & { viewer: Viewer };
export type MemberCtx<C = QueryCtx> = UserCtx<C> & {
  member: { memberId: Id<'members'>; role: Doc<'members'>['role']; isCreator: boolean };
  room: Doc<'rooms'>;
};
const internalCtxBrand: unique symbol = Symbol('InternalCtx');
export type InternalCtx = { readonly [internalCtxBrand]: true };
const internalLog: InternalCtx = Object.freeze({ [internalCtxBrand]: true });

type Definition<C, A extends PropertyValidators, R extends GenericValidator> = {
  args: A; returns: R;
  handler: (ctx: C, args: ObjectType<A>) => Infer<R> | Promise<Infer<R>>;
};
type MemberOptions<A extends PropertyValidators> = {
  room?: keyof ObjectType<A> & ('roomId' | 'proposalId' | 'requestId' | 'executionId' | 'taskId' | 'runId');
  roles?: readonly Doc<'members'>['role'][];
};
const identityKeys = new Set(['userId', 'actorUserId', 'memberId', 'tokenIdentifier']);
function assertPublicArgs(args: PropertyValidators): void {
  if (Object.keys(args).some(key => identityKeys.has(key))) throw new TypeError('Public args cannot supply identity');
}
async function viewerOf(ctx: QueryCtx | MutationCtx, identity: UserIdentity): Promise<Viewer | null> {
  const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique();
  return user ? { userId: user._id, tokenIdentifier: identity.tokenIdentifier, emailVerified: (identity.emailVerified === true || identity.email_verified === true) } : null;
}
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError('auth.unauthenticated');
  const viewer = await viewerOf(ctx, identity);
  if (!viewer) throw appError('auth.user_not_provisioned');
  return viewer;
}

/** Resolver names are closed; a target document must resolve before membership. */
export async function resolveRoom(ctx: QueryCtx, args: Record<string, unknown>, key?: string): Promise<Doc<'rooms'> | null> {
  const keys = ['roomId', 'proposalId', 'requestId', 'executionId', 'taskId', 'runId'] as const;
  const selected = key ?? keys.find(name => Object.hasOwn(args, name));
  if (!selected || !keys.includes(selected as typeof keys[number])) throw new TypeError('Missing room resolver');
  const id = args[selected];
  if (typeof id !== 'string') return null;
  const tables = { roomId: 'rooms', proposalId: 'proposals', requestId: 'humanRequests', executionId: 'executions', taskId: 'tasks', runId: 'runs' } as const;
  const table = tables[selected as keyof typeof tables];
  const normalized = ctx.db.normalizeId(table, id);
  if (!normalized) return null;
  const target = await ctx.db.get(normalized);
  if (!target) return null;
  return table === 'rooms' ? target as Doc<'rooms'> : 'roomId' in target ? await ctx.db.get(target.roomId) : null;
}
async function memberOf<A extends PropertyValidators>(ctx: QueryCtx | MutationCtx, args: ObjectType<A>, opts: MemberOptions<A>, query: boolean): Promise<MemberCtx | null> {
  // Query failures collapse to null; mutation identity failures preserve their codes.
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) { if (query) return null; throw appError('auth.unauthenticated'); }
  const viewer = await viewerOf(ctx, identity);
  if (!viewer) { if (query) return null; throw appError('auth.user_not_provisioned'); }
  const room = await resolveRoom(ctx, args, opts.room);
  const matches = room ? await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', room._id).eq('userId', viewer.userId)).take(2) : [];
  if (matches.length > 1) { if (query) return null; throw appError('approval.self_conflict'); }
  const member = matches[0];
  if (!room || !member) { if (query) return null; throw appError('auth.not_member'); }
  if (opts.roles && !opts.roles.includes(member.role)) { if (query) return null; throw appError('auth.role_forbidden'); }
  return { ...ctx, viewer, room, member: { memberId: member._id, role: member.role, isCreator: room.createdBy === viewer.userId } };
}

// Registration casts adapt the native builder's optional-args conditional types.
// The exported Definition requires both validators and checks the handler's DTO.
export function anonQuery(fn: 'health.ping') {
  if (fn !== 'health.ping') throw new TypeError('Anonymous query is restricted');
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<QueryCtx, A, R>) => {
    assertPublicArgs(def.args);
    return rawQuery({ args: def.args, returns: v.union(v.null(),def.returns), handler: ((ctx: QueryCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => checkedReturn(fn,def.returns,await def.handler(ctx,args),'query',(table,id)=>ctx.db.normalizeId(table as TableNames,id)))) as never }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>|null>>;
  };
}
function assertNullable(validator: GenericValidator): void {
  if (validator.kind !== 'null' && !(validator.kind === 'union' && validator.members.some((value: GenericValidator) => value.kind === 'null'))) throw new TypeError('Authenticated queries must declare a null return branch');
}
export function userQuery(fn: PublicFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<UserCtx, A, R> & (null extends Infer<R> ? unknown : {returns: never})) => {
    assertPublicArgs(def.args);
    assertNullable(def.returns);
    const handler = (ctx: QueryCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) return null;
      const viewer = await viewerOf(ctx, identity);
      if (!viewer) return checkedReturn(fn,def.returns,fn === 'users.viewer' ? {status:'unprovisioned'} : null,'query',(table,id)=>ctx.db.normalizeId(table as TableNames,id));
      return checkedReturn(fn,def.returns,await def.handler({ ...ctx, viewer }, args),'query',(table,id)=>ctx.db.normalizeId(table as TableNames,id));
    });
    return rawQuery({ args: def.args, returns: def.returns, handler: handler as never }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>>;
  };
}
export function userMutation<P extends boolean = false>(fn: PublicFnName, opts: { provision?: P } = {}) {
  if (opts.provision && fn !== 'users.ensureViewer') throw new TypeError('Provisioning is restricted');
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<P extends true ? MutationCtx : UserCtx<MutationCtx>, A, R>) => {
    assertPublicArgs(def.args);
    const handler = (ctx: MutationCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => {
      if (opts.provision) {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw appError('auth.unauthenticated');
        // ensureViewer uses only ctx.auth; no fabricated user id is injected.
        return checkedReturn(fn,def.returns,await def.handler(ctx as never,args),'mutation',(table,id)=>ctx.db.normalizeId(table as TableNames,id));
      }
      return checkedReturn(fn,def.returns,await def.handler({ ...ctx, viewer: await requireUser(ctx) } as never,args),'mutation',(table,id)=>ctx.db.normalizeId(table as TableNames,id));
    });
    return rawMutation({ args: def.args, returns: def.returns, handler: handler as never }) as RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>>;
  };
}
export function memberQuery(fn: PublicFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<MemberCtx, A, R> & MemberOptions<A> & (null extends Infer<R> ? unknown : {returns: never})) => {
    assertPublicArgs(def.args);
    assertNullable(def.returns);
    const handler = (ctx: QueryCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => {
      const member = await memberOf(ctx, args, def, true);
      return member ? checkedReturn(fn,def.returns,await def.handler(member,args),'query',(table,id)=>ctx.db.normalizeId(table as TableNames,id)) : null;
    });
    return rawQuery({ args: def.args, returns: def.returns, handler: handler as never }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>>;
  };
}
export function memberMutation(fn: PublicFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<MemberCtx<MutationCtx>, A, R> & MemberOptions<A> & {
    creatorOnly?: boolean;
    rateLimit?: (ctx: MemberCtx<MutationCtx>, args: ObjectType<A>) => Promise<void>;
  }) => {
    assertPublicArgs(def.args);
    const handler = (ctx: MutationCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => {
      const member = await memberOf(ctx, args, def, false) as MemberCtx<MutationCtx>;
      if (def.creatorOnly && !member.member.isCreator) throw appError('auth.not_creator');
      if (def.rateLimit) await def.rateLimit(member, args);
      return checkedReturn(fn,def.returns,await def.handler(member,args),'mutation',(table,id)=>ctx.db.normalizeId(table as TableNames,id));
    });
    return rawMutation({ args: def.args, returns: def.returns, handler: handler as never }) as RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>>;
  };
}
export function userAction(fn: 'invites.createLink') {
  if (fn !== 'invites.createLink') throw new TypeError('Public action is restricted');
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<UserCtx<ActionCtx> & { log: InternalCtx }, A, R>) => {
    assertPublicArgs(def.args);
    const handler = (ctx: ActionCtx, args: ObjectType<A>) => withSanitizedErrors(fn, async () => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw appError('auth.unauthenticated');
      const resolve = makeFunctionReference<'query', { tokenIdentifier: string }, Doc<'users'> | null>('users:resolve');
      const user = await ctx.runQuery(resolve, { tokenIdentifier: identity.tokenIdentifier });
      if (!user) throw appError('auth.user_not_provisioned');
      const viewer: Viewer = { userId: user._id, tokenIdentifier: identity.tokenIdentifier, emailVerified: (identity.emailVerified === true || identity.email_verified === true) };
      const ids:{table:string;id:string}[]=[];
      const result=checkedReturn(fn,def.returns,await def.handler({ ...ctx, viewer, log: internalLog },args),'mutation',(table,id)=>{ids.push({table,id});return id;});
      if(ids.length&&!await ctx.runQuery(makeFunctionReference<'query',{ids:typeof ids},boolean>('users:validateReturnIds'),{ids}))invalidReturn(fn);
      return result;
    });
    return rawAction({ args: def.args, returns: def.returns, handler: handler as never }) as RegisteredAction<'public', ObjectType<A>, Promise<Infer<R>>>;
  };
}
export function sysQuery(fn: InternalFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<QueryCtx & { log: InternalCtx }, A, R>) =>
    rawInternalQuery({ args: def.args, returns: def.returns, handler: ((ctx: QueryCtx, args: ObjectType<A>) => (async()=>{try{return await def.handler({...ctx,log:internalLog},args);}catch(error){if(error instanceof EngineInvariantError)throw error;return withInternalErrors(internalLog,fn,()=>Promise.reject(error));}})()) as never }) as RegisteredQuery<'internal', ObjectType<A>, Promise<Infer<R>>>;
}
export function sysMutation(fn: InternalFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<MutationCtx & { log: InternalCtx }, A, R>) =>
    rawInternalMutation({ args: def.args, returns: def.returns, handler: ((ctx: MutationCtx, args: ObjectType<A>) => withInternalErrors(internalLog,fn, async () => def.handler({ ...ctx, log: internalLog }, args))) as never }) as RegisteredMutation<'internal', ObjectType<A>, Promise<Infer<R>>>;
}
export function sysAction(fn: InternalFnName) {
  return <A extends PropertyValidators, R extends GenericValidator>(def: Definition<ActionCtx & { log: InternalCtx }, A, R>) =>
    rawInternalAction({ args: def.args, returns: def.returns, handler: ((ctx: ActionCtx, args: ObjectType<A>) => withInternalErrors(internalLog,fn, async () => def.handler({ ...ctx, log: internalLog }, args))) as never }) as RegisteredAction<'internal', ObjectType<A>, Promise<Infer<R>>>;
}

export const internalQuery = sysQuery;
export const internalMutation = sysMutation;
export const internalAction = sysAction;
