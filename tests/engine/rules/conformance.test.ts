import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { defineScenario, canonicalJson, candidateKey } from '../../../core/engine';
import type { ScenarioPlugin, RuleInputBase } from '../../../core/engine';
import { checkProposal, enumerateCandidates } from '../../../core/engine/rules';
import { input, plugin } from './fixture';
import { requiredMembers } from './peerPlugin';
import { scopeChangePlugin } from '../../../core/scenarios/scope-change';

function assertOutputKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(assertOutputKeys); return; }
  for (const [key, child] of Object.entries(value)) {
    expect(key).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    assertOutputKeys(child);
  }
}
export function runPluginConformance<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, docs: Parameters<ScenarioPlugin<RI>['toRuleInput']>[0]) {
  expect(() => defineScenario(p)).not.toThrow();
  const view = p.toRuleInput(docs);
  expect(p.toRuleInput(docs)).toEqual(view);
  expect(p.hardProjection(view)).toBe(p.hardProjection(view));
  expect(p.candidateSpace(view)).toEqual(p.candidateSpace(view));
  const all = enumerateCandidates(p, view, { mode: 'feasibility', limit: Infinity, anchor: false, exclude: [], mustInclude: [] });
  expect(all.items.length).toBeGreaterThan(0);
  for (const draft of p.candidateSpace(view).drafts) {
    const x = p.materialize(draft, view.catalog, view.localDate);
    expect(p.materialize(draft, view.catalog, view.localDate)).toEqual(x);
    if (!x) continue;
    expect(x.candidateKey).toBe(candidateKey(x.terms.itemKeys, x.terms.modifiers));
    expect(x.termsKey).toBe(canonicalJson(x.terms));
    expect(x.terms.amountCents).toBe(x.lines.reduce((sum, row) => sum + row.priceCents, 0));
    assertOutputKeys(x.plannedTasks);
    const evaluation = checkProposal(p, view, x);
    expect(checkProposal(p, view, x)).toEqual(evaluation);
    evaluation.checks.forEach(check => assertOutputKeys(check.params));
  }
  for (const role of p.roles) {
    const options = p.relaxations(role.role, { ...view, viewer: role.role }, { kind: 'infeasible', excludedCandidateKeys: [] });
    options.forEach(option => assertOutputKeys(option.shown));
  }
}
it('T06-S3 runPluginConformance against merged main scope_change and procurement_rfq', () => {
  const scopeChange = scopeChangePlugin;
  expect(scopeChange.id.key).toBe('scope_change');
  runPluginConformance(scopeChange, { ...input });
  const rename = (role: string) => ({ customer: 'requester', provider: 'supplier', finance: 'controller' })[role] ?? role;
  const procurement = defineScenario({
    ...plugin, id: { key: 'procurement_rfq', version: 1 },
    roles: plugin.roles.map(role => ({ ...role, role: rename(role.role) })),
    protocol: { ...plugin.protocol, proposerRole: 'supplier', tradeoffOwner: 'requester', evaluatorOrder: ['requester', 'controller'], counterRoles: ['requester'] },
    catalog: { ...plugin.catalog, ownerRole: 'supplier' },
    relaxationOrder: ['requester.drop_items', 'controller.raise_cap'],
    fields: plugin.fields.map(field => ({ ...field, owner: rename(field.owner), disclosableTo: field.disclosableTo.map(rename) })),
    checks: plugin.checks.map(check => ({ ...check, owner: check.owner === null ? null : rename(check.owner) })),
  });
  runPluginConformance(procurement, {});
}, 30000);
it('06-12.2#1 all 16 required members present, read from the contract type', () => {
  const required = requiredMembers(readFileSync('core/engine/plugin.ts', 'utf8'));
  expect(required).toHaveLength(16);
  for (const key of required) expect(Reflect.get(scopeChangePlugin, key), key).toBeDefined();
  expect(() => defineScenario(scopeChangePlugin)).not.toThrow();
});
it.each([
  [2, 'field owner', { fields: [{ ...plugin.fields[0]!, owner: 'absent' }] }],
  [3, 'check dependency', { checks: [{ ...plugin.checks[0]!, dependsOn: ['absent'] }] }],
  [4, 'relaxation owner', { relaxationOrder: ['provider.raise_cap'] }],
  [5, 'protocol role', { protocol: { ...plugin.protocol, proposerRole: 'absent' } }],
] as const)('06-12.2#%s rejects %s', (_number, _name, patch) => {
  expect(() => defineScenario({ ...plugin, ...patch } as ScenarioPlugin)).toThrow();
});
it('06-12.2#8 rejects invalid persisted output keys', () => {
  expect(() => assertOutputKeys({ valid: [{ 'bad.key': 1 }] })).toThrow();
  expect(() => assertOutputKeys({ shown: { itemKeys: ['audit_log_export'] } })).not.toThrow();
});

it('06-12.2#1 rejects each missing required local member and tolerates valid peer extensions', () => {
  const members = requiredMembers(readFileSync('core/engine/plugin.ts', 'utf8'));
  for (const member of members) {
    const copy = { ...plugin };
    Reflect.deleteProperty(copy, member);
    expect(() => defineScenario(copy), member).toThrow();
  }
  expect(() => defineScenario({ ...plugin, readiness: () => [], rankForOwner: () => () => 0, humanReasonKeys: [] } as typeof plugin)).not.toThrow();
  expect(() => defineScenario({ ...plugin, readiness: 'bad' } as unknown as typeof plugin)).toThrow('Invalid plugin hook');
});
