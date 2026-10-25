/** D14 / schema §3.11: closed room-visible payloads; private details use references. */
import { ITEM_KEY_RE } from './keys';
import { isIsoDate } from './dates';
import type { Role } from './disclosure';
export const RATE_USER_BUCKETS = ['constraint_writes', 'soft_writes'] as const;
export const BRIEF_SOURCES = ['form', 'set_cap', 'request_answer', 'soft_update'] as const;
export const EVENT_FIELDS = {
  "room_created": {
    "scenarioKey": "scope_change",
    "scenarioVersion": "number"
  },
  "member_joined": {
    "role": "role"
  },
  "invite_created": {
    "role": "role",
    "mode": "email|link"
  },
  "room_opened": {
    "constraintsVersion": "number"
  },
  "brief_confirmed": {
    "role": "role",
    "version": "number",
    "hardChanged": "boolean"
  },
  "brief_soft_updated": { "briefVersion": "number" },
  "baseline_recorded": {},
  "catalog_item_confirmed": {
    "items": "items",
    "priceChanged": "boolean"
  },
  "catalog_item_retired": {
    "itemKey": "itemKey",
    "revision": "number"
  },
  "disclosure_changed": {
    "fromRole": "role"
  },
  "constraints_changed": {
    "fromVersion": "number",
    "toVersion": "number"
  },
  "run_started": {
    "runNo": "number",
    "cause": "room_opened|constraints_changed|renegotiation_requested|manual_start"
  },
  "run_awaiting_approval": {
    "runNo": "number",
    "proposalVersion": "number"
  },
  "run_needs_input": {
    "runNo": "number"
  },
  "human_request_opened": {
    "runNo": "number"
  },
  "human_request_answered": {
    "runNo": "number"
  },
  "human_request_closed": {
    "runNo": "number",
    "status": "expired|superseded"
  },
  "run_resumed": {
    "runNo": "number",
    "roundNo": "number"
  },
  "run_renegotiation_requested": {
    "runNo": "number"
  },
  "run_ended": {
    "runNo": "number",
    "status": "superseded|ended_no_agreement|canceled|executed",
    "endedReason": "executed|constraints_changed|renegotiation_requested|no_agreement|request_expired|canceled_by_creator|room_closed"
  },
  "turn_scheduled": {
    "runNo": "number",
    "turnSeq": "number",
    "roundNo": "number",
    "role": "role",
    "kind": "propose|evaluate"
  },
  "turn_completed": {
    "runNo": "number",
    "turnSeq": "number",
    "role": "role"
  },
  "turn_failed": {
    "runNo": "number",
    "turnSeq": "number",
    "role": "role",
    "failureKind": "timeout|invalid_output|error|refused"
  },
  "turn_rejected_stale": {
    "runNo": "number",
    "turnSeq": "number",
    "guard": "G1|G2|G3"
  },
  "proposal_created": {
    "proposalVersion": "number",
    "origin": "agent|human_choice",
    "authorRole": "role",
    "itemKeys": "keys",
    "modifiers": "keys",
    "amountCents": "number",
    "deliveryDate": "date"
  },
  "proposal_status_changed": {
    "proposalVersion": "number",
    "to": "superseded|rejected|stale|executed|active"
  },
  "reapproval_required": {
    "proposalVersion": "number",
    "constraintsVersion": "number"
  },
  "approval_recorded": {
    "proposalVersion": "number",
    "role": "role",
    "decision": "approve|reject|withdraw",
    "boundConstraintsVersion": "number",
    "reasonKey?": "terms_not_acceptable|scope_insufficient|needs_earlier_delivery|other"
  },
  "room_executed": {
    "proposalVersion": "number",
    "amountCents": "number",
    "taskCount": "number",
    "changeOrderNumber": "number"
  },
  "task_completed": {
    "taskKey": "key"
  },
  "room_closed": { "by?": "ops" },
  "follow_up_started": {
    "followUpRoomId": "id:rooms"
  },
  "pii_redacted": {
    "table": "users|members|invites|rooms|briefs|approvals",
    "field": "displayName|invitedEmail|title|softFields.notes|note"
  }
} as const;
type Value<S extends string> = S extends 'boolean' ? boolean : S extends `id:${string}` ? string : S extends 'number' ? number : S extends 'role' ? Role : S extends 'keys' ? readonly string[] : S extends 'items' ? readonly { itemKey: string; kind: 'item' | 'modifier'; revision: number; priceCents: number; leadDays: number }[] : S extends 'key' | 'itemKey' | 'date' ? string : S extends `${infer A}|${infer B}` ? A | Value<B> : S;
type Fields<T> = { readonly [K in keyof T as K extends `${string}?` ? never : K]: Value<T[K] & string> } & { readonly [K in keyof T as K extends `${infer P}?` ? P : never]?: Value<T[K] & string> };
export type EventType = keyof typeof EVENT_FIELDS;
export type EventPayload = { [K in EventType]: { readonly type: K } & Fields<typeof EVENT_FIELDS[K]> }[EventType];
export const RESTRICTED_TABLES = ['briefs', 'humanRequests', 'attempts', 'ledgerEntries', 'approvals', 'constraintRevisions', 'sharedFacts', 'executions'] as const;
export type RestrictedRef = { [T in typeof RESTRICTED_TABLES[number]]: { readonly table: T; readonly id: string } }[typeof RESTRICTED_TABLES[number]];
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function matches(value: unknown, spec: string): boolean {
  if (spec === 'boolean') return typeof value === 'boolean';
  if (spec === 'id:rooms') return matches(value, 'key');
  if (spec === 'itemKey') return typeof value === 'string' && ITEM_KEY_RE.test(value);
  if (spec === 'number') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (spec === 'role') return ['customer', 'provider', 'finance'].includes(value as string);
  if (spec === 'key') return typeof value === 'string' && /^[A-Za-z0-9_:.+-]{1,128}$/.test(value);
  if (spec === 'date') return isIsoDate(value);
  if (spec === 'keys') return Array.isArray(value) && value.every(item => matches(item, 'itemKey'));
  if (spec === 'items') return Array.isArray(value) && value.every(item => record(item) && Object.keys(item).length === 5 && matches(item.itemKey, 'itemKey') && matches(item.kind, 'item|modifier') && ['revision', 'priceCents', 'leadDays'].every(key => matches(item[key], 'number')));
  return typeof value === 'string' && spec.split('|').includes(value);
}
export const REDACTABLE_FIELDS = { users: ['displayName'], members: ['displayName'], invites: ['invitedEmail'], rooms: ['title'], briefs: ['softFields.notes'], approvals: ['note'] } as const;
export function isEventPayload(value: unknown): value is EventPayload {
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(EVENT_FIELDS, value.type)) return false;
  if (value.type === 'pii_redacted' && (!Object.hasOwn(REDACTABLE_FIELDS, value.table as string) || !(REDACTABLE_FIELDS[value.table as keyof typeof REDACTABLE_FIELDS] as readonly unknown[]).includes(value.field))) return false;
  const fields = EVENT_FIELDS[value.type as EventType] as Record<string, string>;
  const allowed = new Set(['type', ...Object.keys(fields).map(key => key.replace(/\?$/, ''))]);
  return Object.keys(value).every(key => allowed.has(key)) && Object.entries(fields).every(([key, spec]) => key.endsWith('?') && !(key.slice(0,-1) in value) || matches(value[key.replace(/\?$/, '')], spec));
}
export function isRestrictedRef(value: unknown): value is RestrictedRef {
  return record(value) && Object.keys(value).length === 2 && RESTRICTED_TABLES.includes(value.table as RestrictedRef['table']) && matches(value.id, 'key');
}
