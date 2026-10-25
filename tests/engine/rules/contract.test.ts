import { expect, it } from 'vitest';
import { defineScenario } from '../../../core/engine/plugin';
import { cents } from '../../../core/engine/money';
import { checkProposal, projectEvaluation, viewFor, enumerateCandidates, PluginContractError } from '../../../core/engine/rules';
import { input, plugin, proposal } from './fixture';

it.each(['missing', 'owner', 'disclosure', 'duplicate_check', 'forward_dependency', 'unknown_field', 'counter', 'limit', 'empty_roles', 'relaxation'])('registration rejects %s', kind => {
  const p = { ...plugin };
  if (kind === 'missing') Reflect.deleteProperty(p, 'fixtures');
  if (kind === 'owner') p.roles = p.roles.map(r => ({ ...r, budgetOwner: undefined }));
  if (kind === 'disclosure') p.fields = p.fields.map(f => ({ ...f, disclosableTo: ['provider'] }));
  if (kind === 'duplicate_check') p.checks = [...p.checks, p.checks[0]!];
  if (kind === 'forward_dependency') p.checks = [{ ...p.checks[0]!, dependsOn: ['later'] }];
  if (kind === 'unknown_field') p.checks = [{ ...p.checks[0]!, requires: [['absent']] }];
  if (kind === 'counter') p.protocol = { ...p.protocol, counterRoles: ['provider'] };
  if (kind === 'limit') p.protocol = { ...p.protocol, maxCandidates: 13 };
  if (kind === 'empty_roles') p.roles = [];
  if (kind === 'relaxation') p.relaxationOrder = ['provider.raise_cap'];
  expect(() => defineScenario(p)).toThrow();
});
it('plugin exceptions fail closed', () => {
  const p = { ...plugin, checks: [{ ...plugin.checks[0]!, run: () => { throw new Error('private value'); } }] };
  expect(() => checkProposal(p, input, proposal())).toThrow(PluginContractError);
});
it('dependency unknown propagates', () => {
  const p = { ...plugin, checks: [{ ...plugin.checks[0]!, run: () => ({ unknown: true as const }) }, { ...plugin.checks[1]!, dependsOn: ['required_offered'], run: () => { throw new Error('must not run'); } }] };
  expect(checkProposal(p, input, proposal()).checks.find(c => c.checkId === 'required_included')?.status).toBe('unknown');
});
it('seller receives only fit while buyer parameters follow disclosures', () => {
  const ev = checkProposal(plugin, { ...input, capCents: cents(479999) }, proposal());
  expect(projectEvaluation(ev, 'provider', plugin, {})).toEqual({ audience: 'provider', fit: 'blocked' });
  const hidden = projectEvaluation(ev, 'customer', plugin, { capCents: ['customer'] });
  expect(hidden.audience).toBe('buyer');
  if (hidden.audience !== 'buyer') throw new Error('wrong audience');
  expect(hidden.masked).toEqual({ code: 'private.constraint_unmet' });
  expect(hidden.checks.some(c => c.checkId === 'budget_fit')).toBe(false);
  const visible = projectEvaluation(ev, 'customer', plugin, { headroomCents: ['customer'] });
  if (visible.audience !== 'buyer') throw new Error('wrong audience');
  expect(visible.checks.find(c => c.checkId === 'budget_fit')?.params).toEqual({ overByCents: 1, headroomCents: 79999 });
});
it('hidden budget changes cannot affect seller candidates', () => {
  const opts = { mode: 'snapshot' as const, limit: 12, anchor: true, exclude: [], mustInclude: [] };
  const a = viewFor(plugin, input, { requiredItemKeys: ['provider'], deadline: ['provider'] }, 'provider');
  const b = viewFor(plugin, { ...input, capCents: cents(400000), committedCents: cents(399999), headroomCents: 1 }, { requiredItemKeys: ['provider'], deadline: ['provider'] }, 'provider');
  expect(enumerateCandidates(plugin, a, opts)).toEqual(enumerateCandidates(plugin, b, opts));
});
it('plugin materialization with inconsistent amount fails as internal', () => {
  const p = { ...plugin, materialize: () => { const m = proposal(); m.terms.amountCents = cents(1); return m; } };
  expect(() => enumerateCandidates(p, input, { mode: 'feasibility', limit: 12, anchor: false, exclude: [], mustInclude: [] })).toThrow(PluginContractError);
});
it('the same engine runs a second scenario with different roles', () => {
  const other = defineScenario({
    ...plugin,
    id: { key: 'procurement_rfq', version: 1 },
    roles: [{ role: 'requester', label: 'Requester', side: 'buyer' as const, approvalKind: 'terms' as const }, { role: 'supplier', label: 'Supplier', side: 'seller' as const, approvalKind: 'terms' as const }, { role: 'controller', label: 'Controller', side: 'buyer' as const, approvalKind: 'budget' as const, budgetOwner: true as const }],
    protocol: { ...plugin.protocol, proposerRole: 'supplier', evaluatorOrder: ['requester', 'controller'], counterRoles: ['requester'], tradeoffOwner: 'requester' },
    relaxationOrder: ['controller.raise_cap'],
    fields: plugin.fields.map(f => ({ ...f, owner: f.owner === 'finance' ? 'controller' : 'requester', disclosableTo: ['requester'].filter(r => r !== (f.owner === 'finance' ? 'controller' : 'requester')) })),
    catalog: { ...plugin.catalog, ownerRole: 'supplier' },
    checks: [],
  });
  const ev = checkProposal(other, { ...input, capCents: cents(479999) }, proposal());
  expect(ev.blocking).toEqual(['budget.over']);
  expect(ev.checks.find(c => c.checkId === 'budget_fit')?.owner).toBe('controller');
  expect(projectEvaluation(ev, 'supplier', other, {})).toEqual({ audience: 'provider', fit: 'blocked' });
});
