import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import schema from '../../../convex/schema';
import { modules } from '../../convex-helpers/setup';
import { internal } from '../../../convex/_generated/api';
import { runConcurrencyRound, type ClientFactory } from '../../../scripts/probes/concurrency';
import { PROBE_TABLE } from '../../../scripts/probes/lib/evidence';
beforeEach(() => { vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('AGENT_MODE', 'stub'); });
afterEach(() => vi.unstubAllEnvs());
for (const probe of PROBE_TABLE.filter(name => name !== 'complete_vs_bump')) {
  it(`production fixture and public operations for ${probe} (L1 only)`, async () => {
    const t = convexTest(schema, modules);
    const factory: ClientFactory = identity => {
      const client = identity ? t.withIdentity({ ...identity, tokenIdentifier: `${identity.issuer}|${identity.subject}` }) : t;
      return { mutation: (name, args) => client.mutation(makeFunctionReference<'mutation'>(name), args), query: (name, args) => client.query(makeFunctionReference<'query'>(name), args) };
    };
    const round = await runConcurrencyRound(probe, `test_${probe}`, factory);
    expect(round.findings).toEqual([]);
    expect(round.pass, JSON.stringify({ before: round.before, after: round.after, results: round.results })).toBe(true);
    // convex-test does not establish real HTTP/OCC overlap. No L2 evidence is written.
  });
}
it('isolated fixtures use unique users and both link invites', async () => {
  const t = convexTest(schema, modules);
  const a = await t.mutation(internal.devProbes.prepareConcurrency, { key: 'isolated_a', mode: 'join' });
  const b = await t.mutation(internal.devProbes.prepareConcurrency, { key: 'isolated_b', mode: 'join' });
  expect(a.roomId).not.toBe(b.roomId);
  expect(a.subjects.some(subject => b.subjects.includes(subject))).toBe(false);
  expect(a.tokens).toHaveLength(2);
});
