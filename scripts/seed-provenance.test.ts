import {expect, it} from 'vitest';
import {buildCommand} from './lib/convex-ops.mjs';
it('D18 seed provenance is seeded or stub only', () => {
  const spec = {function: 'seed:fromFixture', defaultArgs: {provenance: 'seeded'}};
  for (const provenance of ['seeded', 'stub']) expect(JSON.parse(buildCommand(spec, {provenance})[4] ?? '{}').provenance).toBe(provenance);
  for (const provenance of ['live', 'unknown', null]) expect(() => buildCommand(spec, {provenance})).toThrow(/provenance/);
});
