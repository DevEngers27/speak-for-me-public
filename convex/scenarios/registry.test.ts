import { expect, test } from 'vitest';
import { scenarioOf, latestScenarioVersion } from './registry';
import { scopeChangePlugin } from '../../core/scenarios/scope-change';

test('CE-072 pinned scenario version resolves', () => {
  expect(scenarioOf({ scenarioKey: 'scope_change', scenarioVersion: 1 })).toBe(scopeChangePlugin);
  expect(latestScenarioVersion('scope_change')).toBe(1);
});
test.each([
  { scenarioKey: 'scope_change', scenarioVersion: 2 },
  { scenarioKey: 'missing', scenarioVersion: 1 },
])('CE-072 unregistered scenario fails closed: %j', room => {
  expect(() => scenarioOf(room)).toThrow(/scenario_version/);
});
