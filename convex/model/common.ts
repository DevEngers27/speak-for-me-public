import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { appError, API_PARAM_NAMES, type ErrorPayload } from '../lib/errors';
import { PARAM_AUDIENCE, type ErrorCode } from '../../core/engine';
export type Role = Doc<'members'>['role'];
export type Actor = { userId: Id<'users'>; provenance?: Doc<'rooms'>['provenance'] };
export async function requireActor(ctx: QueryCtx, actor: Actor, roomId: Id<'rooms'>, roles?: readonly Role[], creatorOnly = false) {
  const room = await ctx.db.get(roomId);
  const member = await ctx.db.query('members').withIndex('by_room_user', q => q.eq('roomId', roomId).eq('userId', actor.userId)).unique();
  if (!room || !member) throw appError('auth.not_member');
  if (roles && !roles.includes(member.role)) throw appError('auth.role_forbidden');
  if (creatorOnly && room.createdBy !== actor.userId) throw appError('auth.not_creator');
  return { room, member };
}
export function assertStatus(room: Doc<'rooms'>, allow: readonly Doc<'rooms'>['status'][] = ['setup', 'open']) {
  if (!allow.includes(room.status)) throw appError('run.invalid_state', {guard: 'room_status'});
}
export function assertVersion(room: Doc<'rooms'>, expected: number) {
  if (expected !== room.constraintsVersion) throw appError('version.stale_constraints', {currentConstraintsVersion: room.constraintsVersion});
}
export function checked(result: {ok: boolean; code?: string; params?: Readonly<Record<string, unknown>>}, field?: string) {
  if (result.ok) return;
  const code = result.code as ErrorCode;
  const names = new Set(API_PARAM_NAMES[code] ?? Object.keys(PARAM_AUDIENCE[code as keyof typeof PARAM_AUDIENCE] ?? {}));
  const params: ErrorPayload['params'] = {};
  for (const [key, value] of Object.entries(result.params ?? {})) if (names.has(key)) params[key] = value as ErrorPayload['params'][string];
  if (field && names.has('field') && !('field' in params)) params.field = field;
  throw appError(code, params);
}
export function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
    return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(k => Object.hasOwn(bb, k) && same(aa[k], bb[k]));
  }
  return a === b;
}
export async function latestBrief(ctx: QueryCtx, roomId: Id<'rooms'>, role: Role) {
  return await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', role)).order('desc').first();
}
export async function catalogRows(ctx: QueryCtx, roomId: Id<'rooms'>) {
  return await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', roomId)).collect();
}
export function currentCatalog<T extends Pick<Doc<'catalogItems'>, 'itemKey' | 'revision' | 'editNo'>>(rows: readonly T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const old = map.get(row.itemKey);
    if (!old || row.revision > old.revision || row.revision === old.revision && row.editNo > old.editNo) map.set(row.itemKey, row);
  }
  return [...map.values()].sort((a,b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0);
}
export async function ledgerState(ctx: QueryCtx, roomId: Id<'rooms'>) {
  const rows = await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', roomId)).collect();
  return { committedCents: rows.reduce((sum, row) => sum + row.amountCents, 0), baseline: rows.find(row => row.kind === 'baseline') ?? null };
}
