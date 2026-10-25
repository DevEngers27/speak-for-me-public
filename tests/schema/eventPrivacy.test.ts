import type { Infer, GenericId } from 'convex/values';
import { expect, expectTypeOf, it } from 'vitest';
import { eventPayloadV } from '../../convex/schema';
import { accepts, eventContractParity, rejectsBuyersReason } from './eventPrivacy';
import { isEventPayload } from '../../core/engine';
it('03-3.11.1 EVENT_FIELDS equals eventPayloadV', eventContractParity);
it('I23 over_our_limit rejected by both payload validators', rejectsBuyersReason);
it('03-3.8 run_ended has exactly seven ended reasons and room_closed accepts optional ops', () => {
  for (const endedReason of ['executed', 'constraints_changed', 'renegotiation_requested', 'no_agreement', 'request_expired', 'canceled_by_creator', 'room_closed', 'canceled', 'unknown']) {
    const event = { type: 'run_ended', runNo: 1, status: 'canceled', endedReason };
    expect(isEventPayload(event)).toBe(!['canceled', 'unknown'].includes(endedReason));
    expect(accepts(eventPayloadV, event)).toBe(isEventPayload(event));
  }
  for (const event of [{ type: 'room_closed' }, { type: 'room_closed', by: 'ops' }]) {
    expect(isEventPayload(event)).toBe(true);
    expect(accepts(eventPayloadV, event)).toBe(true);
  }
});

it('r01 event spec generator supports W1-7 kinds and rejects unknown specs', async () => {
  const { eventSpecValidator } = await import('../../convex/lib/eventPayload');
  expect(eventSpecValidator('boolean').kind).toBe('boolean');
  expect(accepts(eventSpecValidator('boolean'), true)).toBe(true);
  expect(accepts(eventSpecValidator('boolean'), 'boolean')).toBe(false);
  expect(eventSpecValidator('itemKey').kind).toBe('string');
  expect(eventSpecValidator('id:rooms')).toMatchObject({ kind: 'id', tableName: 'rooms' });
  expect(() => eventSpecValidator('boolen')).toThrow('Unknown event field spec');
  expect(() => eventSpecValidator('id:unknown')).toThrow('Unknown event field spec');
});

it('i09 follow-up room references preserve their Convex ID type', () => {
  type FollowUp = Extract<Infer<typeof eventPayloadV>, { type: 'follow_up_started' }>;
  expectTypeOf<FollowUp['followUpRoomId']>().toEqualTypeOf<GenericId<'rooms'>>();
  const variant = eventPayloadV.members.find(member => member.fields.type.value === 'follow_up_started');
  expect(variant?.fields.followUpRoomId).toMatchObject({ kind: 'id', tableName: 'rooms' });
});
