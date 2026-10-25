import { isProjected, pickExact, wrapCatalogTitles, type Projected } from './projection';
import { isFitOnlyRole, type DisclosurePlugin, type Role } from './disclosure';

export type AgentView = {
  role: Role;
  protocol: Projected<object>;
  principal: Projected<object>;
  sharedFacts: readonly Projected<object>[];
  budget?: Projected<object>;
  catalog: readonly { itemKey: string; kind: 'item' | 'modifier'; priceCents: number; leadDays: number; title: string; status: string }[];
  currentProposal: Projected<object> | null;
  recentProposals: readonly Projected<object>[];
  feedback: { proposalVersion: number; outcome: 'blocked' | 'not_accepted' | 'countered' | 'pending_approval' } | null;
  candidates: readonly Projected<object>[];
  openRequestForMe: Projected<object> | null;
};
function trusted<T extends object>(value: Projected<T>): Projected<T> {
  if (!isProjected(value)) throw new TypeError('Agent context requires projected view');
  return value;
}
function select(value: Projected<object>, keys: readonly string[]): Projected<object> {
  trusted(value);
  const source = value as Readonly<Record<string, unknown>>;
  return projectConstructed(Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]])));
}
/** Only consumes a role-scoped view. No raw party records are accepted. */
export function buildAgentContext(role: Role, view: AgentView, plugin?: DisclosurePlugin) {
  if (view.role !== role) throw new TypeError('Agent view role mismatch');
  const protocol = select(view.protocol, ['scenarioKey', 'scenarioVersion', 'role', 'turnKind', 'roundNo', 'maxRounds', 'allowedActions', 'clarifyTopics']) as Projected<Record<string, unknown>>;
  const topics = protocol.clarifyTopics as readonly string[] | undefined;
  const request = view.openRequestForMe === null ? null : trusted(view.openRequestForMe) as Projected<Record<string, unknown>>;
  if (request && (request.toRole !== role || request.status !== 'open')) throw new TypeError('Open request must target this role');
  return projectConstructed({
    protocol: projectConstructed({ ...protocol, ...(topics ? { clarifyTopics: topics.filter(topic => topic !== 'option_fits_constraints') } : {}) }), principal: select(view.principal, ['briefVersion', 'hard', 'soft', 'notes', 'ownApprovalNotes']),
    sharedFacts: view.sharedFacts.map(value => select(value, ['fromRole', 'field', 'value', 'asOfBriefVersion'])),
    ...(!isFitOnlyRole(role, plugin) && view.budget ? { budget: select(view.budget, role === (plugin ? plugin.roles.find(r => r.budgetOwner)?.role : 'finance') ? ['capCents', 'committedCents', 'headroomCents', 'minAllowedCapCents'] : ['capCents', 'committedCents', 'headroomCents']) } : {}),
    catalog: view.catalog.filter(item => item.status !== 'draft').map(item => projectConstructed({
      itemKey: item.itemKey, kind: item.kind, priceCents: item.priceCents, leadDays: item.leadDays,
    })),
    catalogTitles: wrapCatalogTitles(Object.fromEntries(view.catalog.filter(item => item.status !== 'draft').map(item => [item.itemKey, item.title]))),
    currentProposal: view.currentProposal === null ? null : select(view.currentProposal, isFitOnlyRole(role, plugin) ? ['version', 'terms', 'fit'] : role === 'customer' ? ['version', 'terms', 'checks', 'fit', 'notIncludedItemKeys'] : ['version', 'terms', 'checks', 'fit']),
    recentProposals: view.recentProposals.slice(0, 5).map(value => select(value, ['version', 'status', 'itemKeys', 'amountCents'])),
    feedback: view.feedback === null ? null : projectConstructed({ proposalVersion: view.feedback.proposalVersion, outcome: view.feedback.outcome }),
    candidates: view.candidates.map(value => select(value, ['optionKey', 'candidateKey', 'itemKeys', 'modifiers', 'amountCents', 'deliveryDate'])),
    openRequestForMe: request === null ? null : projectConstructed({ kind: request.kind, options: ((request as { options?: readonly Projected<object>[] }).options ?? []).map(value => select(value, ['optionKey', 'templateKey'])) }),
  });
}

/** Only receives locally constructed records after the role whitelist pass.
 * The runtime picker still rejects every unprojected nested object.
 */
function projectConstructed<T extends object>(value: T): Projected<T> {
  const copy = pickExact as unknown as (source: T, keys: readonly string[]) => Projected<T>;
  return copy(value, Object.keys(value));
}
