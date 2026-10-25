/** Existing boundary harnesses use the fixture plugin explicitly, as W2 must do with the room plugin. */
import { privacy as disclosure } from '../../core/engine';
export const { ROLES, canSee, derivedAudience, DISCLOSURE, DERIVED_FROM, DECLASSIFIED, DECLASSIFIERS, declassified, shareableFields, disclosureRules, assertOptionsProjected, projectRequestOptions, projectEngineRequestOptions } = disclosure;
export type Role = disclosure.Role;
export type Audience = disclosure.Audience;
export type FieldRule = disclosure.FieldRule;
export type FieldTransformContext = disclosure.FieldTransformContext;
export type Family = disclosure.Family;
export type HumanReasonKey = disclosure.HumanReasonKey;
export type DisclosurePlugin = disclosure.DisclosurePlugin;
export type Disclosures = disclosure.Disclosures;
export type DTO = disclosure.DTO;
export type SharedFact = disclosure.SharedFact;
export type CheckResult = disclosure.CheckResult;
export type RequestEffect = disclosure.RequestEffect;
export type RequestOption = disclosure.RequestOption;
export type RequestOptionView = disclosure.RequestOptionView;
import { plugin } from './rules/fixture';
export function projectForRole(role: disclosure.Role, dto: disclosure.DTO, d: disclosure.Disclosures = {}) {
  return disclosure.projectForRole(role, dto, { plugin, ...d });
}
export function projectChecks(role: disclosure.Role, checks: readonly disclosure.CheckResult[], d: disclosure.Disclosures = {}) {
  return disclosure.projectChecks(role, checks, { plugin, ...d });
}
export function projectSharedFacts(role: disclosure.Role, rows: readonly disclosure.SharedFact[], atVersion?: number) {
  return disclosure.projectSharedFacts(role, rows, atVersion, plugin);
}
export function sharing(fields: readonly string[], values: Readonly<Record<string, unknown>> = {}): disclosure.Disclosures {
  return { plugin, sharedFacts: fields.map((field, i) => ({ fromRole: plugin.fields.find(f => f.key === field)?.owner as disclosure.Role ?? 'finance', field, value: { kind: 'cents', cents: typeof values[field] === 'number' ? values[field] : 1 }, audience: ['customer'], briefVersion: 1, seq: i })) };
}
