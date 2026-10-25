export const SCENARIO_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
import type { AgentAction, AgentModelOutputRoot } from './actions';
import type { IsoDate } from './dates';
import type { ReasonCode } from './reasonCodes';
import type { CandidateDraft, CatalogRow, CheckDecl, HumanRequestKind, Materialized, RequestOption, RuleInputBase, SnapshotItem, View } from './rules/types';
export type { CandidateDraft, Materialized, RuleInputBase, View } from './rules/types';
export type RoleDecl = { role: string; label: string; side: 'buyer' | 'seller'; approvalKind: 'terms' | 'budget'; budgetOwner?: true };
export type ClarifyTopicDecl = {
  topicKey: string;
  toRole: string;
  askableBy: readonly string[];
  field: string;
  answer: 'human' | 'code';
  questionTemplateKey: string;
};
export type ProtocolDecl = {
  proposerRole: string;
  evaluatorOrder: readonly string[];
  counterRoles: readonly string[];
  maxRounds: number;
  maxCandidates: number;
  maxProposalsPerRolePerRun: number;
  tradeoffOwner: string;
  topics: readonly ClarifyTopicDecl[];
  reasonKeys: readonly { reasonKey: string; usableBy: readonly string[] }[];
  roleCharters: Readonly<Record<string, string>>;
};
export type RelaxEntry = `${string}.${'drop_items' | 'raise_cap' | 'extend_deadline'}`;
export type FieldDecl = { key: string; owner: string; owners?: readonly string[]; requiresAck?: boolean; class: 'hard' | 'soft' | 'note' | 'derived'; valueKind: 'cents' | 'isoDate' | 'itemKeys' | 'text'; disclosableTo: readonly string[]; semantic?: 'budget_cap' | 'ledger_committed' | 'ledger_headroom' };
export type CatalogDecl = { ownerRole: string; maxItemRows: 12; maxModifierRows: 2; maxRowCents: 8_000_000_000; maxLeadDays: 365; titleMaxCodePoints: 80; maxTaskTemplatesPerRow: number };
export type RuleDocs = Readonly<Record<string, unknown>>;
export type TemplateRegistry = Readonly<Record<string, { reads: readonly string[]; variants: Readonly<Record<string, unknown>> }>>;
export type ScenarioFixture = Readonly<Record<string, unknown>>;
export type RelaxCtx = { kind: HumanRequestKind; excludedCandidateKeys: readonly string[] };
export type StubInput = { role: string; turnKind: 'propose' | 'evaluate'; snapshot: readonly SnapshotItem[]; currentProposal: { version: number; candidateKey: string; itemKeys: string[]; passesInMyView: boolean } | null; ownSoft: Readonly<Record<string, unknown>>; sharedSoft: Readonly<Record<string, unknown>>; allowedActions: readonly AgentAction[] };
export type ReadinessGap =
  | 'seat_vacant'
  | 'brief_unconfirmed'
  | 'brief_field_missing'
  | 'catalog_empty'
  | 'baseline_missing';
export type HumanReasonKeyDecl = {
  readonly key: string;
  readonly audience: 'room' | 'buyers';
  readonly usableBy?: readonly string[];
};
/**
 * ScenarioPlugin contract (06 §12.1, CN-004 #3):
 * 16 required members (1–16, including `readiness(view)`) + 2 optional members
 * (17 `rankForOwner`, 18 `humanReasonKeys`).
 */
export interface ScenarioPlugin<RI extends RuleInputBase = RuleInputBase> {
  readonly id: { key: string; version: number };
  readonly roles: readonly RoleDecl[];
  readonly protocol: ProtocolDecl;
  readonly relaxationOrder: readonly RelaxEntry[];
  readonly fields: readonly FieldDecl[];
  readonly catalog: CatalogDecl;
  toRuleInput(docs: RuleDocs): View<RI>;
  hardProjection(input: View<RI>): string;
  readonly checks: readonly CheckDecl<RI>[];
  candidateSpace(view: View<RI>): { drafts: CandidateDraft[]; emptyReasons: ReasonCode[] };
  materialize(d: CandidateDraft, catalog: readonly CatalogRow[], localDate: IsoDate): Materialized | null;
  relaxations(role: string, view: View<RI>, ctx: RelaxCtx): RequestOption[];
  stubDecide(input: StubInput): AgentModelOutputRoot;
  readonly templates: TemplateRegistry;
  readonly fixtures: Readonly<Record<string, ScenarioFixture>>;
  readiness(input: View<RI>): { gap: ReadinessGap; ownerRole: string }[];
  rankForOwner?(role: string, view: View<RI>): (a: SnapshotItem, b: SnapshotItem) => number;
  readonly humanReasonKeys?: readonly HumanReasonKeyDecl[];
}

type RequiredPluginMember = { [K in keyof ScenarioPlugin]-?: undefined extends ScenarioPlugin[K] ? never : K }[keyof ScenarioPlugin];
/** One declaration drives both presence and runtime kind checks. */
const PLUGIN_MEMBERS = {
  id: 'object', roles: 'array', protocol: 'object', relaxationOrder: 'array', fields: 'array',
  catalog: 'object', toRuleInput: 'function', hardProjection: 'function', checks: 'array',
  candidateSpace: 'function', materialize: 'function', relaxations: 'function', stubDecide: 'function',
  templates: 'object', fixtures: 'object', readiness: 'function',
} as const satisfies Record<RequiredPluginMember, 'object' | 'array' | 'function'>;

export function defineScenario<RI extends RuleInputBase>(plugin: ScenarioPlugin<RI>): ScenarioPlugin<RI> {
  if (!plugin || typeof plugin !== 'object' || !plugin.id || !SCENARIO_KEY_PATTERN.test(plugin.id.key) || !Number.isSafeInteger(plugin.id.version) || plugin.id.version < 1) throw new Error('Invalid scenario id');
  for (const [key, kind] of Object.entries(PLUGIN_MEMBERS)) {
    const value: unknown = Reflect.get(plugin, key);
    if (value === undefined) throw new Error('Missing plugin member');
    if (kind === 'array' ? !Array.isArray(value) : typeof value !== kind || value === null || (kind === 'object' && Array.isArray(value))) throw new Error(kind === 'function' ? 'Invalid plugin hook' : 'Invalid plugin member');
  }
  if (plugin.rankForOwner !== undefined && typeof plugin.rankForOwner !== 'function') throw new Error('Invalid rankForOwner hook');
  const roles = plugin.roles.map(r => r.role);
  if (!roles.length || new Set(roles).size !== roles.length) throw new Error('Duplicate roles or empty roles');
  const owners = plugin.roles.filter(r => r.budgetOwner);
  if (owners.length > 1 || (plugin.fields.some(f => f.semantic === 'budget_cap') && owners.length !== 1)) throw new Error('Invalid budget owner');
  for (const r of plugin.roles) if ((r.approvalKind === 'budget') !== !!r.budgetOwner) throw new Error('Invalid approval kind');
  for (const f of plugin.fields) {
    if (f.owners?.some(r => !roles.includes(r)) || (f.owners && (!f.owners.includes(f.owner) || f.class !== 'note')) || !roles.includes(f.owner) || f.disclosableTo.some(r => !roles.includes(r) || r === f.owner) || (f.class === 'note' && f.disclosableTo.length)) throw new Error('Invalid field declaration');
    if (f.semantic && f.disclosableTo.some(r => plugin.roles.find(x => x.role === r)?.side === 'seller')) throw new Error('Invalid budget disclosure');
  }
  const ids = new Set(['terms_shape', 'items_known', 'items_live', 'source_current', 'amount_consistent', 'date_window']);
  for (const c of plugin.checks) {
    if (ids.has(c.checkId) || ['budget_state', 'budget_fit'].includes(c.checkId) || c.dependsOn.some(id => !ids.has(id)) || (c.owner !== null && !roles.includes(c.owner)) || c.requires.flat().some(k => !plugin.fields.some(f => f.key === k))) throw new Error('Invalid check declaration');
    ids.add(c.checkId);
  }
  const protocol = plugin.protocol;
  if (!roles.includes(protocol.proposerRole) || !roles.includes(protocol.tradeoffOwner) || protocol.maxCandidates < 1 || protocol.maxCandidates > 12 || new Set(protocol.evaluatorOrder).size !== roles.length - 1 || roles.some(r => r !== protocol.proposerRole && !protocol.evaluatorOrder.includes(r)) || protocol.counterRoles.some(r => !protocol.evaluatorOrder.includes(r))) throw new Error('Invalid protocol');
  if (!plugin.relaxationOrder.length || !roles.includes(plugin.catalog.ownerRole)) throw new Error('Invalid scenario ownership or relaxation order');
  for (const entry of plugin.relaxationOrder) {
    const at = entry.lastIndexOf('.');
    const role = entry.slice(0, at);
    const effect = entry.slice(at + 1);
    if (!roles.includes(role) || !['drop_items', 'raise_cap', 'extend_deadline'].includes(effect) || (effect === 'raise_cap' && !owners.some(r => r.role === role))) throw new Error('Invalid relaxation order');
  }
  if (!Number.isSafeInteger(protocol.maxRounds) || protocol.maxRounds < 1 || !Number.isSafeInteger(protocol.maxCandidates) || !Number.isSafeInteger(protocol.maxProposalsPerRolePerRun) || protocol.maxProposalsPerRolePerRun < 1) throw new Error('Invalid protocol limits');
  if (protocol.evaluatorOrder.includes(protocol.proposerRole) || protocol.evaluatorOrder.some(r => !roles.includes(r))) throw new Error('Invalid evaluator order');
  if (new Set(plugin.fields.map(f => f.key)).size !== plugin.fields.length) throw new Error('Duplicate field');
  if (
    new Set(protocol.topics.map(t => t.topicKey)).size !== protocol.topics.length ||
    protocol.topics.some(t =>
      t.topicKey === 'option_fits_constraints' ||
      !roles.includes(t.toRole) ||
      t.askableBy.some(r => !roles.includes(r) || r === t.toRole) ||
      !t.field ||
      !plugin.fields.some(f => f.key === t.field && f.owner === t.toRole && f.class !== 'note') ||
      (t.answer !== 'human' && t.answer !== 'code') ||
      typeof t.questionTemplateKey !== 'string' ||
      t.questionTemplateKey.length === 0
    )
  ) throw new Error('Invalid topics');
  if (new Set(protocol.reasonKeys.map(r => r.reasonKey)).size !== protocol.reasonKeys.length || protocol.reasonKeys.some(r => r.usableBy.some(role => role !== 'human' && !roles.includes(role)))) throw new Error('Invalid reason keys');
  if (plugin.humanReasonKeys !== undefined) {
    if (
      !Array.isArray(plugin.humanReasonKeys) ||
      new Set(plugin.humanReasonKeys.map(r => r.key)).size !== plugin.humanReasonKeys.length ||
      plugin.humanReasonKeys.some(r => {
        const usable = r.usableBy;
        return (
          !r.key ||
          (r.audience !== 'room' && r.audience !== 'buyers') ||
          (usable !== undefined &&
            (!Array.isArray(usable) ||
              usable.length === 0 ||
              usable.some((role: string) => !roles.includes(role))))
        );
      })
    ) {
      throw new Error('Invalid humanReasonKeys');
    }
  }
  return plugin;
}
