/** The sole event writer; one monotonically increasing sequence per RoomTx. */
import type { Id } from '../_generated/dataModel';
import type { EventActor, EventPayload, EventRefs, RestrictedRef } from '../lib/schemaTypes';
import { eventWriteContext, type RoomTx } from '../lib/db';
import { appError } from '../lib/errors';

export async function appendEvents(tx: RoomTx, events: Array<{
  payload: EventPayload; restrictedRef?: RestrictedRef; actor: EventActor;
  actorUserId?: Id<'users'>; refs?: EventRefs;
}>): Promise<void> {
  const state = eventWriteContext(tx);
  // Validate the entire batch before inserting any event.
  for (const event of events) {
    if (event.restrictedRef) {
      const id = state.db.normalizeId(event.restrictedRef.table, event.restrictedRef.id);
      const row = id ? await state.db.get(id) : null;
      if (!row || row.roomId !== tx.room._id) throw appError('internal');
    }
    if (event.actor.kind === 'user') {
      if (!event.actorUserId) throw appError('internal');
      const member = await state.db.query('members').withIndex('by_room_user', q => q.eq('roomId', tx.room._id).eq('userId', event.actorUserId!)).unique();
      if (!member || member.role !== event.actor.role) throw appError('internal');
    }
  }
  for (const event of events) {
    await tx.insert('events', {
      roomId: tx.room._id, payload: event.payload, actor: event.actor,
      ...(event.payload.type === 'brief_soft_updated' ? {rateUser: 'soft_writes' as const} : {}),
      ...(event.actorUserId === undefined ? {} : { actorUserId: event.actorUserId }),
      ...(event.restrictedRef === undefined ? {} : { restrictedRef: event.restrictedRef }),
      refs: event.refs ?? {}, commitTs: state.commitTs, seq: event.payload.type === 'pii_redacted' ? tx.room.writeSeq : state.nextSeq(),
      provenance: tx.room.provenance, createdAt: state.createdAt,
    });
  }
}
