import { plugin } from '../engine/rules/fixture';
import type { GenericValidator } from 'convex/values';
import schema from '../../convex/schema';
import { privacy } from '../../core/engine';
const { DISCLOSURE, disclosureRules } = privacy;
type FieldRule = privacy.FieldRule;
import { REVIEWED_LEAF_RULES } from './disclosureExpected';
import { expect } from 'vitest';

/** A nullable union still has the same leaf; objects and arrays are always expanded. */
export function validatorLeaves(validator: GenericValidator, prefix: string): string[] {
  if (validator.kind === 'object') return Object.entries(validator.fields).flatMap(([key, value]) => validatorLeaves(value as GenericValidator, `${prefix}.${key}`));
  if (validator.kind === 'union') {
    // Flatten nested unions before deciding whether null denotes absence of a structure.
    const flatten = (v: GenericValidator): GenericValidator[] => v.kind === 'union' ? v.members.flatMap((m: GenericValidator) => flatten(m)) : [v];
    const members = flatten(validator);
    const structured = members.some(v => v.kind === 'object' || v.kind === 'array');
    return [...new Set(members.filter(v => !structured || v.kind !== 'null').flatMap(v => validatorLeaves(v, prefix)))];
  }
  if (validator.kind === 'array') return validatorLeaves(validator.element, `${prefix}[]`);
  return [prefix];
}
const VARIANTS: Readonly<Record<string, FieldRule['variant']>> = {
  'briefs.version': '●′', 'briefs.confirmedAt': '●′', 'runs.status': '●′', 'approvals.reasonKey': '●‴',
  ...Object.fromEntries(['kind', 'toRole', 'id', 'status', 'expiresAt'].map(field => [`humanRequests.${field}`, '●″' as const])),
  ...Object.fromEntries(['status', 'currentAttemptNo', 'roundNo', 'createdAt', 'completedAt'].map(field => [`turns.${field}`, '●⁗' as const])),
};
function topRule(path: string, registry: Record<string, Readonly<Record<string, FieldRule>>>): FieldRule | undefined {
  const [table, field] = path.split('.');
  return registry[table!]?.[field!.replace(/\[\]$/, '')];
}
function allPaths(registry: Record<string, Readonly<Record<string, FieldRule>>>): string[] {
  const leaves = Object.entries(schema.tables).flatMap(([table, definition]) => validatorLeaves(definition.validator, table));
  return [...new Set([...leaves, ...Object.entries(registry).flatMap(([table, fields]) => Object.keys(fields).filter(field => !leaves.some(path => path === `${table}.${field}` || path.startsWith(`${table}.${field}.`) || path.startsWith(`${table}.${field}[]`))).map(field => `${table}.${field}`))])];
}
/** Actual leaf→rule inventory is generated from schema plus the plugin-instantiated matrix. */
export function disclosureLeaves() {
  const registry = Object.fromEntries(Object.keys(DISCLOSURE).map(family => [family, disclosureRules(family as keyof typeof DISCLOSURE, plugin)]));
  return Object.fromEntries(allPaths(registry).map(path => [path, topRule(path, registry)]));
}
export function schemaPrivacyCompleteness() {
  const registry: Record<string, Readonly<Record<string, FieldRule>>> = { ...DISCLOSURE, budget: disclosureRules('budget', plugin) };
  const leaves = Object.entries(schema.tables).flatMap(([table, definition]) => validatorLeaves(definition.validator, table));
  const DISCLOSURE_LEAVES = disclosureLeaves();
  for (const [path, actual] of Object.entries(DISCLOSURE_LEAVES)) {
    const expected = REVIEWED_LEAF_RULES[path];
    expect(expected, path).toBeDefined();
    expect(actual, path).toBeDefined();
    const [table, field] = path.split('.');
    const variant = VARIANTS[`${table}.${field!.replace(/\[\]$/, '')}`];
    expect(actual, path).toMatchObject({ ...expected, ...(variant ? { variant } : {}) });
    if (variant) expect(actual!.transform, path).toBeTypeOf('function');
  }
  // Derived DTOs do not occur in persisted validators and must be accounted for separately.
  for (const [table, fields] of Object.entries({ rooms: ['isCreator'], members: ['isMe'], briefs: ['confirmed'], budget: ['capCents', 'committedCents', 'headroomCents', 'overByCents', 'shortfallCents', 'minAllowedCapCents'], proposals: ['fit', 'checks', 'notIncludedItemKeys'], approvals: ['effective', 'isMe', 'memberId'], turns: ['action', 'optionKey', 'proposalVersion', 'reasonKey', 'topicKey', 'toRole', 'rationale'], humanRequests: ['effect'], constraintRevisions: ['constraintsVersion'], events: ['id', 'type', 'at', 'actorLabel', 'text'] })) {
    for (const field of fields) expect(DISCLOSURE_LEAVES[`${table}.${field}` as keyof typeof DISCLOSURE_LEAVES], `${table}.${field}`).toMatchObject({ audience: registry[table]![field]!.audience, agent: registry[table]![field]!.agent });
  }
  expect(Object.keys(DISCLOSURE_LEAVES).sort()).toEqual([...new Set([...leaves, ...Object.entries(registry).flatMap(([table, fields]) => Object.keys(fields).filter(field => !leaves.some(path => path === `${table}.${field}` || path.startsWith(`${table}.${field}.`) || path.startsWith(`${table}.${field}[]`))).map(field => `${table}.${field}`))])].sort());
}

/** INV-07 storage half; prefix matching covers renamed deferred collections and nested fields. */
export function noDeferredStorageFields() {
  for (const [table, definition] of Object.entries(schema.tables)) {
    for (const path of validatorLeaves(definition.validator, table)) expect(path.split('.').some(segment => /^deferred/i.test(segment)), path).toBe(false);
  }
}
