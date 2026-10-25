import type { Id } from '../_generated/dataModel';
import type { RoomTx } from '../lib/db';
import { eventWriteContext } from '../lib/db';
import { appError } from '../lib/errors';
import type { Role } from './common';
/** D24 / 03 §3.14: the sole membership writer, including fixture/follow-up paths. */
export async function addMember(tx: RoomTx, args: {userId: Id<'users'>; role: Role; via: 'creator' | 'invite' | 'follow_up'; inviteId?: Id<'invites'>}) {
  const {db, createdAt} = eventWriteContext(tx);
  const occupied = await db.query('members').withIndex('by_room_role', q => q.eq('roomId', tx.room._id).eq('role', args.role)).unique();
  if (occupied) throw appError('invite.seat_taken', {role: args.role});
  const existing = await db.query('members').withIndex('by_room_user', q => q.eq('roomId', tx.room._id).eq('userId', args.userId)).unique();
  if (existing) throw appError('invite.already_member', {role: existing.role});
  const user = await db.get(args.userId);
  if (!user || args.via === 'invite' && !args.inviteId) throw appError('internal');
  return await tx.insert('members', {roomId: tx.room._id, userId: args.userId, role: args.role, displayName: user.displayName, joinedVia: args.via, ...(args.inviteId ? {inviteId: args.inviteId} : {}), joinedAt: createdAt});
}
