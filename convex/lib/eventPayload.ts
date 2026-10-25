import { v, type GenericValidator, type GenericId } from 'convex/values';
import { EVENT_FIELDS, type EventPayload } from '../../core/engine';
import { roleV, itemKeyV } from './validators';

export function eventSpecValidator(spec: string): GenericValidator {
  if (spec === 'boolean') return v.boolean();
  if (spec === 'itemKey') return itemKeyV;
  if (spec === 'id:rooms') return v.id('rooms');
  if (spec === 'number') return v.number();
  if (spec === 'role') return roleV;
  if (spec === 'key' || spec === 'date') return v.string();
  if (spec === 'keys') return v.array(v.string());
  if (spec === 'items') return v.array(v.object({ itemKey: v.string(), kind: v.union(v.literal('item'), v.literal('modifier')), revision: v.number(), priceCents: v.number(), leadDays: v.number() }));
  if (spec === 'scope_change' || spec === 'ops') return v.literal(spec);
  if (spec.includes('|') && spec.split('|').every(value => /^[A-Za-z0-9_.-]+$/.test(value))) return v.union(...spec.split('|').map(value => v.literal(value)));
  throw new TypeError(`Unknown event field spec: ${spec}`);
}
type SpecFor<T, K extends PropertyKey> = K extends keyof T ? T[K] : `${K & string}?` extends keyof T ? T[`${K & string}?`] : never;
type StoredPayload<P extends EventPayload = EventPayload> = P extends EventPayload ? {
  readonly [K in keyof P]: K extends 'type' ? P[K] : SpecFor<typeof EVENT_FIELDS[P['type']], K> extends `id:${infer Table}` ? GenericId<Table> : P[K];
} : never;
// Generate the wire contract from the pure engine declaration so keys, optionality and literals cannot drift.
export const eventPayloadV = v.union(...Object.entries(EVENT_FIELDS).map(([type, fields]) => v.object({
  type: v.literal(type),
  ...Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key.replace(/\?$/, ''), key.endsWith('?') ? v.optional(eventSpecValidator(spec)) : eventSpecValidator(spec)])),
}))) as unknown as import('convex/values').VUnion<StoredPayload, import('convex/values').VObject<Record<string, unknown>, Record<string, GenericValidator> & { type: import('convex/values').VLiteral<string> }>[]>;
