import { assertOptionsProjected, projectEngineRequestOptions, type Role, type RequestOptionView } from '../disclosure';
import { pickExact } from '../projection';
import type { ScenarioPlugin } from '../plugin';
import { enumerateCandidates } from '../rules/candidates';
import { cents } from '../money';
import { PluginContractError } from '../rules/types';
import type { Effect, HumanRequestKind, RequestOption, RuleInputBase, View } from '../rules/types';

export const HUMAN_REQUEST_TTL_DAYS = 7;
export type ExhaustedCause = 'rounds' | 'no_candidates' | 'call_limit' | 'spend_limit';
export type HumanRequestDraft = { kind: HumanRequestKind; toRole: string; questionKey: string; options: RequestOption[] };
export type RequestContext<RI extends RuleInputBase> = {
  plugin: ScenarioPlugin<RI>;
  excludedCandidateKeys: readonly string[];
  /** Full proposer snapshot exclusions: proposed, blocked, rejected and failed rechecks. */
  providerExcludedCandidateKeys: readonly string[];
  openRequestCount: number;
  keepAsIsUsed: boolean;
  canContinue: boolean;
  exhaustedCause?: ExhaustedCause;
  reroutedToRole?: string;
  proposalCounts?: Readonly<Record<string, number>>;
  passedPairs?: readonly { fromRole: string; toRole: string }[];
  retryAllowed?: boolean;
  disclosures?: Readonly<Record<string, readonly string[]>>;
  escalation?: { kind: 'infeasible' | 'needs_tradeoff'; toRole: string };
  clarify?: { field: string; askerRole: string };
  /** Only an active, currently passing, non-rejected candidate may be supplied. */
  currentCandidateKey?: string;
};
export type RoundExtensionEligibility = {
  exhaustedCause?: ExhaustedCause;
  keepAsIsUsed: boolean;
  /** Answer-time availability after applying the full provider snapshot exclusions. */
  providerHasCandidates: boolean;
  canContinue: boolean;
  retryAllowed?: boolean;
  proposalCounts?: Readonly<Record<string, number>>;
  plugin: Pick<ScenarioPlugin, 'protocol'>;
};

/** The offer and answer share the same extension guard, using current run inputs. */
export function canExtendRound(ctx: RoundExtensionEligibility): boolean {
  const protocol = ctx.plugin.protocol;
  return (ctx.exhaustedCause ?? 'rounds') === 'rounds' && !ctx.keepAsIsUsed &&
    ctx.providerHasCandidates && ctx.canContinue && ctx.retryAllowed !== false &&
    (ctx.proposalCounts?.[protocol.proposerRole] ?? 0) < Math.min(4, protocol.maxProposalsPerRolePerRun);
}

const option = (effect: Effect, shown: RequestOption['shown'] = {}): RequestOption => ({ optionKey: '', templateKey: `request.${effect.kind}`, effect, shown });

/** Produces one draft; persistence must supersede any old request before opening it. */
export function buildHumanRequests<RI extends RuleInputBase>(kind: HumanRequestKind, toRole: string, viewForRole: (role: string) => View<RI>, ctx: RequestContext<RI>): HumanRequestDraft {
  if (kind === 'agent_escalated' && ctx.escalation?.kind === 'infeasible') kind = 'infeasible';
  if (!Number.isSafeInteger(ctx.openRequestCount) || ctx.openRequestCount < 0) throw new PluginContractError('invalid_open_request_count');
  if (ctx.openRequestCount !== 0) throw new PluginContractError('human_request_already_open');
  const p = ctx.plugin;
  const roles = [...new Set(p.relaxationOrder.map(e => e.slice(0, e.lastIndexOf('.'))))];
  const owner = roles[0];
  if (!owner && kind !== 'agent_failed' && kind !== 'clarify') throw new PluginContractError('empty_relaxation_order');
  const view = (role: string) => {
    if (!p.roles.some(r => r.role === role)) throw new PluginContractError('unknown_request_role');
    const v = viewForRole(role);
    if (v.viewer !== role) throw new PluginContractError('wrong_request_view');
    return v;
  };
  const candidates = (v: View<RI>) => enumerateCandidates(p, v, { mode: 'feasibility', anchor: false, exclude: ctx.excludedCandidateKeys, mustInclude: [] }).items;
  const fields = (v: View<RI>) => v as Readonly<Record<string, unknown>>;
  const relaxedView = (v: View<RI>, effect: Effect): View<RI> => {
    if (effect.kind === 'raise_cap') return { ...v, capCents: effect.amountCents, headroomCents: v.committedCents === undefined ? undefined : effect.amountCents - v.committedCents };
    const key = p.fields.find(f => f.owner === v.viewer && f.class === 'hard' && f.valueKind === (effect.kind === 'drop_items' ? 'itemKeys' : 'isoDate'))?.key;
    if (!key) throw new PluginContractError('missing_relaxation_field');
    return { ...v, [key]: effect.kind === 'drop_items' ? (fields(v)[key] as readonly string[]).filter(k => !effect.itemKeys.includes(k)) : effect.kind === 'extend_deadline' ? effect.date : fields(v)[key] };
  };
  let options: RequestOption[] = [];
  const infeasible = kind === 'infeasible';
  if (infeasible) {
    toRole = ctx.reroutedToRole ?? owner!;
    if (!roles.includes(toRole)) throw new PluginContractError('invalid_reroute_role');
    const order = ctx.reroutedToRole ? [ctx.reroutedToRole] : roles;
    for (const role of order) {
      const v = view(role);
      if (candidates(v).length) continue;
      let relaxed = p.relaxations(role, v, { kind: 'infeasible', excludedCandidateKeys: ctx.excludedCandidateKeys });
      if (!relaxed.length && p.roles.find(r => r.role === role)?.budgetOwner && v.committedCents !== undefined && v.capCents !== undefined) {
        const cheapest = candidates({ ...v, capCents: undefined, headroomCents: undefined }).sort((a,b) => a.amountCents - b.amountCents)[0];
        if (cheapest) relaxed = [option({ kind: 'raise_cap', amountCents: cents(v.committedCents + cheapest.amountCents) })];
      }
      const counts: Record<string, number> = {};
      relaxed = relaxed.filter(o => {
        const e = o.effect;
        if (!['raise_cap', 'drop_items', 'extend_deadline'].includes(e.kind)) return false;
        if (e.kind === 'raise_cap' && (v.capCents === undefined || e.amountCents <= v.capCents)) return false;
        if (!candidates(relaxedView(v, e)).length) return false;
        counts[e.kind] = (counts[e.kind] ?? 0) + 1;
        return counts[e.kind]! <= (e.kind === 'drop_items' ? 2 : e.kind === 'extend_deadline' ? 1 : 3);
      });
      if (relaxed.length) { toRole = role; options = relaxed; break; }
    }
    if (!options.length) options = p.fields.filter(f => f.owner === toRole && f.class === 'hard').flatMap(f => {
      const toRoles = roles.filter(r => r !== toRole && f.disclosableTo.includes(r) && !ctx.disclosures?.[f.key]?.includes(r));
      return toRoles.length ? [option({ kind: 'disclose', field: f.key, toRoles })] : [];
    });
  } else if (kind === 'clarify') {
    const v = view(toRole), c = ctx.clarify;
    const field = p.fields.find(f => f.key === c?.field && f.owner === toRole);
    if (!c || !field || !field.disclosableTo.includes(c.askerRole) || fields(v)[field.key] === undefined) throw new PluginContractError('invalid_clarify_field');
    options = [option({ kind: 'disclose', field: c.field, toRoles: [c.askerRole] }), option({ kind: 'keep_as_is' })];
  } else if (kind === 'agent_failed') {
    view(toRole);
    if (ctx.retryAllowed !== false) options.push(option({ kind: 'retry_turn' }));
  } else {
    const tradeoffOwner = p.protocol.tradeoffOwner ?? owner!;
    if (kind === 'rounds_exhausted') toRole = tradeoffOwner;
    if (kind === 'agent_escalated' && ctx.escalation?.kind === 'needs_tradeoff') toRole = tradeoffOwner;
    if (kind === 'agent_escalated' && toRole !== tradeoffOwner && toRole !== p.protocol.proposerRole) throw new PluginContractError('invalid_escalation_role');
    const v = view(toRole);
    if (toRole === tradeoffOwner) {
      const items = candidates(v);
      const sortedItems = p.rankForOwner ? [...items].sort(p.rankForOwner(toRole, v)) : items;
      options = sortedItems.map(c => option({ kind: 'choose_candidate', candidateKey: c.candidateKey }, { itemKeys: c.itemKeys, modifiers: c.modifiers, amountCents: c.amountCents, deliveryDate: c.deliveryDate }));
      if (options.some(o => o.effect.kind === 'choose_candidate' && !items.some(c => c.candidateKey === (o.effect as { candidateKey: string }).candidateKey))) throw new PluginContractError('candidate_not_in_view');
      const current = items.find(c => c.candidateKey === ctx.currentCandidateKey);
      if (current && !options.some(o => o.effect.kind === 'choose_candidate' && o.effect.candidateKey === current.candidateKey)) options.unshift(option({ kind: 'choose_candidate', candidateKey: current.candidateKey }, { itemKeys: current.itemKeys, modifiers: current.modifiers, amountCents: current.amountCents, deliveryDate: current.deliveryDate }));
      options.sort((a,b) => Number(b.effect.kind === 'choose_candidate' && b.effect.candidateKey === ctx.currentCandidateKey) - Number(a.effect.kind === 'choose_candidate' && a.effect.candidateKey === ctx.currentCandidateKey));
      options = options.slice(0,3);
    }
    const providerHasCandidates = enumerateCandidates(p, view(p.protocol.proposerRole), { mode: 'feasibility', anchor: false, exclude: [...ctx.excludedCandidateKeys, ...ctx.providerExcludedCandidateKeys], mustInclude: [] }).items.length > 0;
    const mayExtend = canExtendRound({ ...ctx, providerHasCandidates });
    if (kind === 'agent_escalated' ? toRole !== p.protocol.proposerRole || ctx.retryAllowed !== false : mayExtend) options.push(option({ kind: 'keep_as_is' }));
  }
  const v = view(toRole);
  const nextRole = roles[roles.indexOf(toRole) + 1];
  const mayPass = kind === 'infeasible' && nextRole !== undefined && !ctx.passedPairs?.some(pair => pair.fromRole === toRole && pair.toRole === nextRole);
  options = options.slice(0, mayPass ? 3 : 4);
  if (mayPass) options.push(option({ kind: 'pass_to_next', toRole: nextRole }));
  options.push(option({ kind: 'end_run' }));
  options = options.map((o,n) => ({ ...o, optionKey: String.fromCharCode(65+n) }));
  // Public catalog combinations are derivable in this view even when the current hard
  // constraints block them; use them to validate relaxation dates and cap arithmetic.
  const derivation = { ...v } as Record<string, unknown>;
  for (const f of p.fields) if (f.class === 'hard') derivation[f.key] = f.valueKind === 'itemKeys' ? [] : undefined;
  derivation.headroomCents = undefined;
  const available = [...new Map([...candidates(v), ...candidates({ ...v, capCents: undefined, headroomCents: undefined }), ...candidates(derivation as View<RI>)].map(c => [c.candidateKey, c])).values()];
  const projectionView = pickExact({ role: toRole as Role, capCents: v.capCents as RuleInputBase['capCents'], committedCents: v.committedCents as RuleInputBase['committedCents'], deadline: fields(v).deadline as string | undefined, requiredItemKeys: fields(v).requiredItemKeys === undefined ? undefined : [...fields(v).requiredItemKeys as readonly string[]], candidates: available.map(candidate => pickExact(candidate, ['candidateKey', 'amountCents', 'deliveryDate', 'itemKeys', 'modifiers'])) }, ['role', 'capCents', 'committedCents', 'deadline', 'requiredItemKeys', 'candidates']) satisfies import('../projection').Projected<RequestOptionView>;
  options = projectEngineRequestOptions(toRole as Role, options, projectionView, p);
  assertOptionsProjected(toRole as Role, options);
  return { kind, toRole, questionKey: kind === 'rounds_exhausted' ? `request.rounds_exhausted.${ctx.exhaustedCause ?? 'rounds'}` : `request.${kind}`, options };
}

export const ANSWER_EFFECTS = {
  pass_to_next: { bumpsConstraints: false, next: 'reroute_infeasible' },
  raise_cap: { bumpsConstraints: true, next: 'superseded' },
  drop_items: { bumpsConstraints: true, next: 'superseded' },
  extend_deadline: { bumpsConstraints: true, next: 'superseded' },
  choose_candidate: { bumpsConstraints: false, next: 'recheck_candidate' },
  disclose: { bumpsConstraints: false, next: 'by_request_kind' },
  retry_turn: { bumpsConstraints: false, next: 'same_turn' },
  keep_as_is: { bumpsConstraints: false, next: 'by_request_kind' },
  end_run: { bumpsConstraints: false, next: 'ended_no_agreement' },
} as const;

/** Candidate selection still requires full-rule validation at the mutation boundary (R15/R19). */
export function answerEffect(effect: Effect, request: Pick<HumanRequestDraft, 'kind' | 'toRole'> & Partial<Pick<HumanRequestDraft, 'questionKey'>>, ctx: RoundExtensionEligibility & { plugin: Pick<ScenarioPlugin, 'protocol' | 'relaxationOrder'> }) {
  const proposer = ctx.plugin.protocol.proposerRole;
  const owner = ctx.plugin.relaxationOrder[0]?.split('.')[0];
  if (effect.kind === 'disclose') return { bumpsConstraints: false, next: request.kind === 'clarify' ? 'same_turn' : 'rerun_precheck' } as const;
  if (effect.kind !== 'keep_as_is') return ANSWER_EFFECTS[effect.kind];
  if (request.kind === 'agent_escalated' && request.toRole !== proposer && request.toRole !== owner) throw new PluginContractError('invalid_escalation_role');
  const sameTurn = request.kind === 'clarify' || (request.kind === 'agent_escalated' && request.toRole === proposer && ctx.retryAllowed !== false);
  const exhaustedCause = request.questionKey === undefined ? ctx.exhaustedCause : (['rounds', 'no_candidates', 'call_limit', 'spend_limit'] as const).find(cause => request.questionKey === `request.rounds_exhausted.${cause}`);
  const extend = request.kind === 'rounds_exhausted' && (request.questionKey === undefined || exhaustedCause !== undefined) && canExtendRound({ ...ctx, exhaustedCause });
  return { bumpsConstraints: false, next: sameTurn ? 'same_turn' : extend ? 'extend_round' : request.kind === 'agent_escalated' && request.toRole !== proposer && ctx.canContinue ? 'next_round' : 'ended_no_agreement' } as const;
}
