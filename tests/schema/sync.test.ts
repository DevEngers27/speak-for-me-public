/// <reference types="vite/client" />
import {expect, it} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../../convex/schema';
import {modules} from '../convex-helpers/setup';

it.each([
  ['revisionCauseV', 'revision', 'scenario_migrated', 'scenario_migration'],
  ['requestEffectV', 'effect', {type: 'pass_to_next', toRole: 'finance'}, {type: 'pass_to_next', toRole: 'buyer'}],
  ['requestEffectV', 'effect', {type: 'disclose', field: 'deadline', toRoles: ['finance']}, {type: 'disclose', field: 'deadline', toRoles: ['buyer']}],
  ['waitingReason', 'waiting', 'run_cap', 'run_caps'],
  ['staleGuard', 'stale', 'G3', 'G4'],
  ['eventPayloadV', 'event', {type: 'brief_confirmed', role: 'customer', version: 1, hardChanged: true}, {type: 'brief_confirmed', role: 'customer', version: 1, hardChanged: 'true'}],
  ['eventPayloadV', 'event', {type: 'catalog_item_confirmed', items: [], priceChanged: true}, {type: 'catalog_item_confirmed', items: [], priceChanged: 1}],
 ].map(([validator, name, valid, invalid]) => ({title: `03 ${validator} accepts ${JSON.stringify(valid)}`, name, valid, invalid})))('$title', async ({name, valid, invalid}) => {
  // Module keys must share the Convex root used by modules.
  const fixture = await import('../convex-helpers/foundation.fixture');
  const tester = convexTest(schema, {...modules, './test/foundation.fixture.ts': async () => fixture});
  const ref = makeFunctionReference<'query', {value: unknown}>(`test/foundation.fixture:${name}`);
  await expect(tester.query(ref, {value: valid})).resolves.toBeNull();
  await expect(tester.query(ref, {value: invalid})).rejects.toThrow();
});
