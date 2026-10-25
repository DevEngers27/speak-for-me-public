import { expect } from 'vitest';
import { type GenericValidator } from 'convex/values';
import { eventPayloadV } from '../../convex/schema';
import { EVENT_FIELDS, isEventPayload } from '../../core/engine';

export function accepts(validator: GenericValidator, value: unknown): boolean {
  if (validator.isOptional === 'optional' && value === undefined) return true;
  if (validator.kind === 'union') return validator.members.some((member: GenericValidator) => accepts(member, value));
  if (validator.kind === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const data = value as Record<string, unknown>;
    return Object.keys(data).every(k => Object.hasOwn(validator.fields, k)) && Object.entries(validator.fields).every(([k, v]) => accepts(v as GenericValidator, data[k]));
  }
  if (validator.kind === 'array') return Array.isArray(value) && value.every(v => accepts(validator.element, v));
  if (validator.kind === 'literal') return value === validator.value;
  if (validator.kind === 'id') return typeof value === 'string';
  if (validator.kind === 'null') return value === null;
  return typeof value === (validator.kind === 'float64' ? 'number' : validator.kind);
}
function descriptor(validator: GenericValidator): string {
  if (validator.kind === 'union') return validator.members.map((v: GenericValidator) => descriptor(v)).join('|');
  if (validator.kind === 'literal') return String(validator.value);
  if (validator.kind === 'id') return `id:${validator.tableName}`;
  if (validator.kind === 'array') return validator.element.kind === 'object' ? 'items' : 'keys';
  return validator.kind === 'float64' ? 'number' : validator.kind;
}
function expectedDescriptor(spec: string): string {
  return spec === 'key' || spec === 'itemKey' || spec === 'date' ? 'string' : spec === 'role' ? 'customer|provider|finance' : spec;
}
export function eventContractParity() {
  expect(eventPayloadV.members.map(m => m.fields.type.value).sort()).toEqual(Object.keys(EVENT_FIELDS).sort());
  for (const member of eventPayloadV.members) {
    const type = member.fields.type.value as keyof typeof EVENT_FIELDS;
    const actual = Object.fromEntries(Object.entries(member.fields).filter(([key]) => key !== 'type').map(([key, validator]) => [key + (validator.isOptional === 'optional' ? '?' : ''), descriptor(validator)]));
    const expected = Object.fromEntries(Object.entries(EVENT_FIELDS[type]).map(([key, spec]) => [key, expectedDescriptor(spec)]));
    expect(actual, type).toEqual(expected);
  }
}
export function rejectsBuyersReason() {
  const event = { type: 'approval_recorded', proposalVersion: 1, role: 'finance', decision: 'reject', boundConstraintsVersion: 1, reasonKey: 'over_our_limit' };
  expect(isEventPayload(event)).toBe(false);
  expect(accepts(eventPayloadV, event)).toBe(false);
  expect(isEventPayload({ ...event, reasonKey: 'other' })).toBe(true);
  expect(accepts(eventPayloadV, { ...event, reasonKey: 'other' })).toBe(true);
}
