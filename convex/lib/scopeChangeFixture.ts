import { SCENARIO_KEY } from '../../core/scenarios/scope-change/constants';
import type { ScopeChangeFixture } from '../../core/scenarios/scope-change/fixtures/main';
import { loadFixture } from './fixtureSchema';

/** Explicit adapter from D27's seed format to the generic validated loader. */
export function loadScopeChangeFixture(seed: ScopeChangeFixture) {
  const roles = seed.confirmOrder.map(id => ({id, label: id}));
  return loadFixture({
    schemaVersion: 1, id: seed.key, scenarioKey: seed.room.scenarioKey,
    title: seed.room.title, provenance: seed.provenance, localDate: seed.goldenAnchor,
    roles, members: roles.map(({id}) => ({userId: id, role: id, displayName: id})),
    briefs: Object.fromEntries(Object.entries(seed.briefs).map(([role, brief]) => [role, {
      hardFields: brief.hardFields, softFields: brief.softFields, disclosures: brief.disclosures,
    }])),
    ledgerEntries: [{kind: seed.ledgerBaseline.kind, amountCents: seed.ledgerBaseline.amountCents, provenance: seed.ledgerBaseline.provenance}],
    catalogItems: seed.catalog.map(({itemKey, kind, title, priceCents, leadDays, taskTemplates, revision, status}) => ({itemKey, kind, title, priceCents, leadDays, taskTemplates: taskTemplates.map(({title}) => ({title})), revision, status})),
    constraintSets: [{version: 1, constraints: []}],
    steps: [{id: 'seed', label: seed.label, constraintSetVersion: 1, expectations: [{
      id: 'catalog', description: 'Catalog price checksum',
      candidate: {itemKeys: seed.catalog.map(row => row.itemKey)},
      outcome: {itemsTotalCents: seed.catalog.reduce((sum, row) => sum + row.priceCents, 0)},
    }]}],
  }, {expectedScenarioKey: SCENARIO_KEY});
}
