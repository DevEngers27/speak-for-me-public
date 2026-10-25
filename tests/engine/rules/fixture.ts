import { main } from '../../../core/scenarios/scope-change/fixtures/main';
import { cents } from '../../../core/engine/money';
import { addDays, daysBetween, isoDate } from '../../../core/engine/dates';
import { defineScenario } from '../../../core/engine/plugin';
import type { ScenarioPlugin } from '../../../core/engine/plugin';
import { hardProjection, materializeTerms } from '../../../core/engine/rules';
import type { CatalogRow, CheckOutcome, RuleInputBase, View } from '../../../core/engine/rules';
export type Input = RuleInputBase & { requiredItemKeys: readonly string[] | undefined; deadline: ReturnType<typeof isoDate> | undefined };
export const input: View<Input> = { viewer: 'system', localDate: isoDate(main.goldenAnchor), catalog: main.catalog.map(r => ({ ...r, priceCents: cents(r.priceCents), taskTemplates: r.taskTemplates.map(t => ({ ...t, assigneeRole: 'provider' })) })), capCents: cents(main.briefs.finance.hardFields.capCents), committedCents: cents(main.ledgerBaseline.amountCents), headroomCents: main.briefs.finance.hardFields.capCents - main.ledgerBaseline.amountCents, requiredItemKeys: main.briefs.customer.hardFields.requiredItemKeys, deadline: addDays(isoDate(main.goldenAnchor), main.briefs.customer.hardFields.deadline.offsetDays) };
const lead = (rows: readonly CatalogRow[]) => Math.max(0, ...rows.filter(r => r.kind === 'item').map(r => r.leadDays)) - rows.filter(r => r.kind === 'modifier').reduce((n, r) => n + r.leadDays, 0);
export const plugin: ScenarioPlugin<Input> = defineScenario<Input>({
  id: { key: 'test_scenario', version: 1 }, roles: [{ role: 'customer', label: 'Buyer', side: 'buyer', approvalKind: 'terms' }, { role: 'provider', label: 'Seller', side: 'seller', approvalKind: 'terms' }, { role: 'finance', label: 'Budget', side: 'buyer', approvalKind: 'budget', budgetOwner: true }],
  protocol: { proposerRole: 'provider', evaluatorOrder: ['customer', 'finance'], counterRoles: ['customer'], maxRounds: 3, maxCandidates: 12, maxProposalsPerRolePerRun: 4, tradeoffOwner: 'customer', topics: [], reasonKeys: [], roleCharters: {} },
  relaxationOrder: ['customer.drop_items', 'finance.raise_cap'],
  fields: [{ key: 'preferredItemKeys', owner: 'customer', class: 'soft', valueKind: 'itemKeys', disclosableTo: ['provider', 'finance'] }, { key: 'committedCents', owner: 'finance', class: 'derived', valueKind: 'cents', semantic: 'ledger_committed', disclosableTo: ['customer'] }, { key: 'headroomCents', owner: 'finance', class: 'derived', valueKind: 'cents', semantic: 'ledger_headroom', disclosableTo: ['customer'] }, { key: 'capCents', owner: 'finance', class: 'hard', valueKind: 'cents', semantic: 'budget_cap', disclosableTo: ['customer'] }, { key: 'requiredItemKeys', owner: 'customer', class: 'hard', valueKind: 'itemKeys', disclosableTo: ['provider', 'finance'] }, { key: 'deadline', owner: 'customer', class: 'hard', valueKind: 'isoDate', disclosableTo: ['provider', 'finance'] }],
  catalog: { ownerRole: 'provider', maxItemRows: 12, maxModifierRows: 2, maxRowCents: 8_000_000_000, maxLeadDays: 365, titleMaxCodePoints: 80, maxTaskTemplatesPerRow: 5 },
  toRuleInput: () => input,
  hardProjection: i => hardProjection(plugin, i),
  checks: [
    { checkId: 'required_offered', owner: 'customer', requires: [['requiredItemKeys']], dependsOn: [], run: ({ input: i }): CheckOutcome => {
      if (!i.requiredItemKeys) return { unknown: true };
      const itemKeys = i.requiredItemKeys.filter(k => !i.catalog.some(r => r.itemKey === k && r.kind === 'item' && r.status === 'confirmed'));
      return itemKeys.length ? { ok: false, code: 'item.required_missing', params: { itemKeys, reason: 'not_offered' } } : { ok: true };
    } },
    { checkId: 'required_included', owner: 'customer', requires: [['requiredItemKeys']], dependsOn: ['terms_shape'], run: ({ input: i, terms }): CheckOutcome => {
      if (!i.requiredItemKeys) return { unknown: true };
      const itemKeys = i.requiredItemKeys.filter(k => !terms.itemKeys.includes(k));
      return itemKeys.length ? { ok: false, code: 'item.required_missing', params: { itemKeys, reason: 'not_included' } } : { ok: true };
    } },
    { checkId: 'by_date', owner: 'customer', requires: [['deadline']], dependsOn: ['terms_shape'], run: ({ input: i, terms }): CheckOutcome => !i.deadline ? { unknown: true } : terms.deliveryDate <= i.deadline ? { ok: true } : { ok: false, code: 'date.after_deadline', params: { deadline: i.deadline, daysLate: daysBetween(i.deadline, terms.deliveryDate) } } },
  ],
  candidateSpace: i => ({ drafts: [{ itemKeys: [...(i.requiredItemKeys?.length ? i.requiredItemKeys : ['audit_log_export', 'sso_login'])].sort(), modifiers: [] }, { itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'], modifiers: [] }], emptyReasons: [] }),
  materialize: (d, catalog, localDate) => materializeTerms(d, catalog, localDate, lead),
  relaxations: () => [], stubDecide: () => ({ turn: { action: 'propose', optionKey: 'O1', rationale: '' } }), templates: {}, fixtures: {}, readiness: () => [],
});
export const proposal = (itemKeys = ['audit_log_export', 'sso_login'], modifiers: string[] = []) => plugin.materialize({ itemKeys, modifiers }, input.catalog, input.localDate)!;
