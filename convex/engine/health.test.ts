import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { modules } from '../../tests/convex-helpers/setup';

test('12.5 health.ping is anonymous and returns only ok', async () => {
  await expect(convexTest(schema, modules).query(api.health.ping, {})).resolves.toEqual({ ok: true });
});
