import { expect, it } from 'vitest';
import { main } from '../../core/scenarios/scope-change/fixtures/main';
import { scopeChangePlugin } from '../../core/scenarios/scope-change';
import { wrapCatalogTitle } from '../../core/engine/projection';
import { loadScopeChangeFixture } from '../../convex/lib/scopeChangeFixture';
import { CatalogItem } from '../../convex/lib/fixtureSchema';
it('loads the D27 main seed through its explicit adapter with the runtime scenario key', () => {
  const fixture = loadScopeChangeFixture(main);
  expect(fixture.scenarioKey).toBe(scopeChangePlugin.id.key);
  expect(fixture.catalogItems).toHaveLength(main.catalog.length);
  expect(fixture.briefs.finance?.hardFields.capCents).toBe(main.briefs.finance.hardFields.capCents);
});
it('validates catalog titles at input and wraps them as untrusted text', () => {
  const row = loadScopeChangeFixture(main).catalogItems[0]!;
  expect(CatalogItem.safeParse(row).success).toBe(true);
  for (const title of ['bad\nline', '<instruction>', 'x'.repeat(81), '']) {
    expect(() => wrapCatalogTitle(title)).toThrow();
    expect(CatalogItem.safeParse({...row, title}).success).toBe(false);
  }
  expect(wrapCatalogTitle('😀'.repeat(80)).block).toContain('😀'.repeat(80));
  expect(JSON.stringify(wrapCatalogTitle('Safe title'))).toContain('untrusted_data');
});
