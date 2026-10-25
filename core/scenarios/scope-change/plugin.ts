import { defineScenario, type ScenarioFixture, type ScenarioPlugin } from '../../engine';
import { SCOPE_CHANGE_CATALOG } from './catalog';
import { SCOPE_CHANGE_FIELDS } from './fields';
import { canaryFixture, main } from './fixtures';
import { SCOPE_CHANGE_ID, SCOPE_CHANGE_ROLES, SCOPE_CHANGE_PROTOCOL, SCOPE_CHANGE_RELAXATION_ORDER, SCOPE_CHANGE_HUMAN_REASON_KEYS } from './protocol';
import { toRuleInput, scopeChangeHardProjection, SCOPE_CHANGE_CHECKS, candidateSpace, materialize, relaxations, stubDecide, readiness, rankForOwner, type ScopeChangeRuleInput } from './rules';
import { SCOPE_CHANGE_TEMPLATES } from './templates';

export const SCOPE_CHANGE_FIXTURES: Readonly<Record<string, ScenarioFixture>> = Object.freeze({
  main: main as unknown as ScenarioFixture,
  canary: canaryFixture as unknown as ScenarioFixture,
});

export const scopeChange: ScenarioPlugin<ScopeChangeRuleInput> = defineScenario<ScopeChangeRuleInput>({
  id: SCOPE_CHANGE_ID,
  roles: SCOPE_CHANGE_ROLES,
  protocol: SCOPE_CHANGE_PROTOCOL,
  relaxationOrder: SCOPE_CHANGE_RELAXATION_ORDER,
  fields: SCOPE_CHANGE_FIELDS,
  catalog: SCOPE_CHANGE_CATALOG,
  toRuleInput,
  hardProjection: scopeChangeHardProjection,
  checks: SCOPE_CHANGE_CHECKS,
  candidateSpace,
  materialize,
  relaxations,
  stubDecide,
  templates: SCOPE_CHANGE_TEMPLATES,
  fixtures: SCOPE_CHANGE_FIXTURES,
  readiness,
  rankForOwner,
  humanReasonKeys: SCOPE_CHANGE_HUMAN_REASON_KEYS,
});

export const scopeChangePlugin = scopeChange;

