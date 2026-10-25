import { expect, it } from 'vitest';
import { v } from 'convex/values';
import { validatorLeaves, noDeferredStorageFields, disclosureLeaves } from './privacyInventory';
it('r06 validatorLeaves flattens nested nullable unions and expands arrays', () => {
  const nested = v.union(v.union(v.object({ cents: v.number() }), v.object({ date: v.string() })), v.null());
  expect(validatorLeaves(nested, 'value').sort()).toEqual(['value.cents', 'value.date']);
  expect(validatorLeaves(v.union(v.null(), v.union(v.array(v.object({ key: v.string() })), v.null())), 'rows')).toEqual(['rows[].key']);
  expect(validatorLeaves(v.union(v.string(), v.null()), 'scalar')).toEqual(['scalar']);
});
it('i05 INV-07 storage leaves exclude every deferred prefix', noDeferredStorageFields);
it('i03 generated leaves retain audience variants and transforms', () => {
  const leaves = disclosureLeaves();
  for (const path of ['briefs.version', 'briefs.confirmedAt', 'runs.status', 'approvals.reasonKey', 'humanRequests.kind', 'humanRequests.toRole', 'turns.status']) {
    expect(leaves[path]?.variant, path).toBeDefined();
    expect(leaves[path]?.transform, path).toBeTypeOf('function');
  }
});
