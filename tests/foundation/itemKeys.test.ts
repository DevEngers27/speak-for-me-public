import { expect, it } from 'vitest';
import { candidateKey, taskKey } from '../../core/engine';
import { itemKey, renderPublicText } from '../../core/engine/publicText';
import { ItemKey } from '../../convex/lib/fixtureSchema';
import { parseItemKey } from '../../convex/lib/validators';
import { isEventPayload } from '../../core/engine/events';
import { checkProposal } from '../../core/engine/rules';
import { input, plugin, proposal } from '../engine/rules/fixture';
import { projectSharedFacts } from '../../core/engine/disclosure';

const consumers: Record<string, (key: string) => unknown> = {
  checkProposal: key => {
    const p = proposal();
    p.terms.itemKeys = [key];
    p.terms.modifiers = [];
    const view = {...input, catalog: [{...input.catalog[0]!, itemKey: key}]};
    if (checkProposal(plugin, view, p).blocking.includes('item.unknown')) throw Error('invalid');
  },
  candidateKey: key => candidateKey([key]),
  taskKey: key => taskKey('execution1', key, 0),
  publicText: key => itemKey(key),
  renderPublicText: key => renderPublicText('constraints_updated', {changedItemKeys: [key], severity: 'high', effectiveDate: '2026-10-24'} as never),
  fixtureSchema: key => ItemKey.parse(key),
  validators: key => parseItemKey(key),
  events: key => {if (!isEventPayload({type: 'catalog_item_retired', itemKey: key, revision: 1})) throw Error('invalid');},
  eventItems: key => {if (!isEventPayload({type: 'catalog_item_confirmed', items: [{itemKey: key, kind: 'item', revision: 1, priceCents: 1, leadDays: 1}], priceChanged: true})) throw Error('invalid');},
  eventKeys: key => {if (!isEventPayload({type: 'proposal_created', proposalVersion: 1, origin: 'agent', authorRole: 'provider', itemKeys: [key], modifiers: [], amountCents: 1, deliveryDate: '2026-10-24'})) throw Error('invalid');},
  projectSharedFacts: key => {if (projectSharedFacts('customer', [{fromRole: 'customer', field: 'requiredItemKeys', value: {kind: 'itemKeys', itemKeys: [key]}, audience: [], briefVersion: 1, seq: 1}], undefined, plugin) === null) throw Error('invalid');},
};
it.each(Object.entries(consumers))('canon-1.2 invalid itemKey rejected by %s', (_name, consume) => {
  for (const key of ['a'.repeat(41), 'UPPERCASE', '1leading', 'a']) expect(() => consume(key)).toThrow();
  for (const key of ['audit_log_export', 'a'.repeat(40)]) expect(() => consume(key)).not.toThrow();
});
it('canon-1.2 candidateKey audit_log_export+sso_login@rush', () => {
  expect(candidateKey(['sso_login', 'audit_log_export'], ['rush'])).toBe('audit_log_export+sso_login@rush');
});
