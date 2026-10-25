import { addDays, daysBetween, isIsoDate, isoDate, type IsoDate, assertOptionsProjected, projectEngineRequestOptions, type RequestOptionView, cents, isCents, type Cents, enumerateCandidates, hardProjection, pickExact, type Projected, PluginContractError, type CatalogRow, type CheckDecl, type CheckOutcome, type Effect, type ItemKey, type Materialized, type RequestOption, type RuleInputBase, type SnapshotItem, type View, type ReadinessGap, type RelaxCtx, type RuleDocs, type ScenarioCandidateSlice } from '../../engine';
import { SCOPE_CHANGE_CATALOG, validateCatalogTitle } from './catalog';
import { codeUnitCmp, ITEM_KEY_RE, SCOPE_CHANGE_FIELDS } from './fields';
import { SCOPE_CHANGE_ROLES, SCOPE_CHANGE_PROTOCOL, type ScopeChangeRole } from './protocol';

export { codeUnitCmp };

export type ScopeChangeRuleInput = RuleInputBase & {
  readonly requiredItemKeys: readonly ItemKey[] | undefined;
  readonly deadline: IsoDate | undefined;
  readonly preferredItemKeys?: readonly ItemKey[];
  readonly notes?: string;
};

function resolveCatalogRows(raw: unknown): readonly CatalogRow[] {
  if (!Array.isArray(raw)) {
    throw new PluginContractError('missing_catalog');
  }

  const byKey = new Map<
    string,
    { readonly row: CatalogRow; readonly editNo: number; readonly index: number }
  >();

  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new PluginContractError('invalid_catalog_row');
    }
    const r = entry as Record<string, unknown>;

    if (r.status !== 'draft' && r.status !== 'confirmed' && r.status !== 'retired') {
      throw new PluginContractError('invalid_catalog_status');
    }
    if (r.status === 'draft') {
      continue;
    }

    if (typeof r.itemKey !== 'string' || !ITEM_KEY_RE.test(r.itemKey)) {
      throw new PluginContractError('invalid_catalog_item_key');
    }
    if (r.kind !== 'item' && r.kind !== 'modifier') {
      throw new PluginContractError('invalid_catalog_kind');
    }
    if (!validateCatalogTitle(r.title, 'title').ok) {
      throw new PluginContractError('invalid_catalog_title');
    }
    if (
      typeof r.priceCents !== 'number' ||
      !isCents(r.priceCents) ||
      r.priceCents > SCOPE_CHANGE_CATALOG.maxRowCents
    ) {
      throw new PluginContractError('invalid_catalog_price');
    }
    const minLead = r.kind === 'modifier' ? 1 : 0;
    if (
      typeof r.leadDays !== 'number' ||
      !Number.isSafeInteger(r.leadDays) ||
      r.leadDays < minLead ||
      r.leadDays > SCOPE_CHANGE_CATALOG.maxLeadDays
    ) {
      throw new PluginContractError('invalid_catalog_lead_days');
    }
    if (
      typeof r.revision !== 'number' ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1
    ) {
      throw new PluginContractError('invalid_catalog_revision');
    }
    if (
      r.provenance !== 'live' &&
      r.provenance !== 'seeded' &&
      r.provenance !== 'stub'
    ) {
      throw new PluginContractError('invalid_catalog_provenance');
    }
    const normalizedProvenance = r.provenance;

    const rawTemplates = r.taskTemplates ?? [];
    if (!Array.isArray(rawTemplates)) {
      throw new PluginContractError('invalid_task_templates');
    }
    if (r.kind === 'modifier' && rawTemplates.length > 0) {
      throw new PluginContractError('invalid_modifier_task_templates');
    }
    if (rawTemplates.length > SCOPE_CHANGE_CATALOG.maxTaskTemplatesPerRow) {
      throw new PluginContractError('invalid_task_templates_limit');
    }

    const taskTemplates = rawTemplates.map((tRaw) => {
      if (typeof tRaw !== 'object' || tRaw === null || Array.isArray(tRaw)) {
        throw new PluginContractError('invalid_task_template');
      }
      const t = tRaw as Record<string, unknown>;
      if (!validateCatalogTitle(t.title, 'taskTemplates.title').ok) {
        throw new PluginContractError('invalid_task_template_title');
      }
      if (
        t.assigneeRole !== undefined &&
        t.assigneeRole !== SCOPE_CHANGE_CATALOG.ownerRole
      ) {
        throw new PluginContractError('invalid_task_assignee');
      }
      return {
        title: (t.title as string).normalize('NFC'),
        assigneeRole: SCOPE_CHANGE_CATALOG.ownerRole,
      };
    });

    const editNo =
      typeof r.editNo === 'number' && Number.isSafeInteger(r.editNo) && r.editNo >= 0
        ? r.editNo
        : 0;

    const existing = byKey.get(r.itemKey);
    if (existing && existing.row.kind !== r.kind) {
      throw new PluginContractError('conflicting_catalog_kind');
    }
    const shouldReplace =
      !existing ||
      r.revision > existing.row.revision ||
      (r.revision === existing.row.revision &&
        (editNo > existing.editNo || (editNo === existing.editNo && index >= existing.index)));

    if (shouldReplace) {
      byKey.set(r.itemKey, {
        row: {
          itemKey: r.itemKey,
          kind: r.kind,
          title: (r.title as string).normalize('NFC'),
          priceCents: cents(r.priceCents),
          leadDays: r.leadDays,
          status: r.status,
          revision: r.revision,
          provenance: normalizedProvenance,
          taskTemplates,
        },
        editNo,
        index,
      });
    }
  }

  return [...byKey.values()]
    .map((x) => x.row)
    .sort((a, b) => codeUnitCmp(a.itemKey, b.itemKey));
}

function resolveIsoDateOrOffset(raw: unknown, localDate: IsoDate): IsoDate | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    if (!isIsoDate(raw)) {
      throw new PluginContractError('invalid_deadline');
    }
    return isoDate(raw);
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'offsetDays' in raw &&
    typeof (raw as { offsetDays: unknown }).offsetDays === 'number' &&
    Number.isSafeInteger((raw as { offsetDays: number }).offsetDays)
  ) {
    return addDays(localDate, (raw as { offsetDays: number }).offsetDays);
  }
  throw new PluginContractError('invalid_deadline');
}

/**
 * Derive `View<ScopeChangeRuleInput>` from room / brief / catalog / ledger docs (06 §5.1, 14 §6.1).
 * - Never defaults missing `localDate`, `status`, `priceCents`, `leadDays`, `revision`, or `provenance`
 *   (throws `PluginContractError`).
 * - Keeps the latest non-draft row per `itemKey` (`confirmed` or `retired`) with its actual status.
 */
export function toRuleInput(docs: RuleDocs): View<ScopeChangeRuleInput> {
  if (typeof docs !== 'object' || docs === null || Array.isArray(docs)) {
    throw new PluginContractError('invalid_rule_docs');
  }
  const room = (docs.room as Record<string, unknown> | undefined) ?? {};
  const rawLocalDate =
    (typeof docs.localDate === 'string' ? docs.localDate : undefined) ??
    (typeof room.localDate === 'string' ? room.localDate : undefined);
  if (typeof rawLocalDate !== 'string' || !isIsoDate(rawLocalDate)) {
    throw new PluginContractError('invalid_local_date');
  }
  const localDate = isoDate(rawLocalDate);

  const rawCatalog = docs.catalogRows !== undefined ? docs.catalogRows : docs.catalog;
  const catalog = resolveCatalogRows(rawCatalog);

  const briefs = (docs.briefs as Record<string, Record<string, unknown>> | undefined) ?? {};
  const financeBrief = briefs.finance;
  const customerBrief = briefs.customer;

  const financeHard = (financeBrief?.hardFields as Record<string, unknown> | undefined) ?? {};
  const customerHard = (customerBrief?.hardFields as Record<string, unknown> | undefined) ?? {};

  const rawCap = docs.capCents !== undefined ? docs.capCents : financeHard.capCents;
  let capCents: Cents | undefined;
  if (rawCap !== undefined) {
    if (typeof rawCap !== 'number' || !isCents(rawCap)) {
      throw new PluginContractError('invalid_cap_cents');
    }
    capCents = cents(rawCap);
  }

  const ledgerBaseline = docs.ledgerBaseline as { amountCents?: unknown } | undefined;
  const rawCommitted =
    docs.committedCents !== undefined
      ? docs.committedCents
      : docs.ledgerSumCents !== undefined
        ? docs.ledgerSumCents
        : docs.ledgerBaselineCents !== undefined
          ? docs.ledgerBaselineCents
          : ledgerBaseline?.amountCents;
  let committedCents: Cents | undefined;
  if (rawCommitted !== undefined) {
    if (typeof rawCommitted !== 'number' || !isCents(rawCommitted)) {
      throw new PluginContractError('invalid_committed_cents');
    }
    committedCents = cents(rawCommitted);
  }

  const headroomCents =
    typeof docs.headroomCents === 'number' && Number.isSafeInteger(docs.headroomCents)
      ? docs.headroomCents
      : capCents !== undefined && committedCents !== undefined
        ? capCents - committedCents
        : undefined;

  const rawRequired =
    docs.requiredItemKeys !== undefined ? docs.requiredItemKeys : customerHard.requiredItemKeys;
  let requiredItemKeys: readonly ItemKey[] | undefined;
  if (rawRequired !== undefined) {
    if (
      !Array.isArray(rawRequired) ||
      rawRequired.some((k) => typeof k !== 'string' || !ITEM_KEY_RE.test(k))
    ) {
      throw new PluginContractError('invalid_required_item_keys');
    }
    requiredItemKeys = [...rawRequired].sort(codeUnitCmp);
  }

  const deadline = resolveIsoDateOrOffset(
    docs.deadline !== undefined ? docs.deadline : customerHard.deadline,
    localDate,
  );

  return {
    viewer: 'system',
    localDate,
    catalog,
    capCents,
    committedCents,
    headroomCents,
    requiredItemKeys,
    deadline,
  };
}

/**
 * Scenario readiness hook (member 16 of `ScenarioPlugin`, 04 §4.2.1, 06 §12.1, CN-004 #3).
 * Inspects `view` for scenario-owned setup/open readiness gaps:
 * - `catalog_empty` (`ownerRole: 'provider'`) when no confirmed `kind === 'item'` catalog row exists.
 * - `brief_field_missing` (`ownerRole: 'customer'`) when `requiredItemKeys` (non-empty) or `deadline` is missing.
 * - `brief_field_missing` (`ownerRole: 'finance'`) when `capCents` is missing.
 * - `baseline_missing` (`ownerRole: 'finance'`) when `committedCents` is missing in the system/finance view.
 */
export function readiness(
  view: View<ScopeChangeRuleInput>,
): { gap: ReadinessGap; ownerRole: string }[] {
  const gaps: { gap: ReadinessGap; ownerRole: string }[] = [];

  const hasConfirmedItem = view.catalog.some(
    (r) => r.kind === 'item' && r.status === 'confirmed',
  );
  if (!hasConfirmedItem) {
    gaps.push({ gap: 'catalog_empty', ownerRole: 'provider' });
  }

  if (view.viewer === 'system' || view.viewer === 'customer') {
    const hasRequired =
      Array.isArray(view.requiredItemKeys) && view.requiredItemKeys.length > 0;
    const hasDeadline = typeof view.deadline === 'string' && isIsoDate(view.deadline);
    if (!hasRequired || !hasDeadline) {
      gaps.push({ gap: 'brief_field_missing', ownerRole: 'customer' });
    }
  }

  if (view.viewer === 'system' || view.viewer === 'finance') {
    if (view.capCents === undefined || !isCents(view.capCents)) {
      gaps.push({ gap: 'brief_field_missing', ownerRole: 'finance' });
    }
    if (view.committedCents === undefined || !isCents(view.committedCents)) {
      gaps.push({ gap: 'baseline_missing', ownerRole: 'finance' });
    }
  }

  return gaps;
}

/**
 * Optional candidate ranking hook for human choice requests (`rankForOwner`, member 17 of `ScenarioPlugin`).
 */
export function rankForOwner(
  _role: string,
  _view: View<ScopeChangeRuleInput>,
): (a: SnapshotItem, b: SnapshotItem) => number {
  void _role;
  void _view;
  return (a, b) =>
    a.amountCents - b.amountCents ||
    codeUnitCmp(a.deliveryDate, b.deliveryDate) ||
    codeUnitCmp(a.candidateKey, b.candidateKey);
}

/**
 * Deterministic hard-constraint projection string for `scope_change` (14 §7.1, 06 §5.3).
 */
export function scopeChangeHardProjection(input: View<ScopeChangeRuleInput>): string {
  return hardProjection({ fields: SCOPE_CHANGE_FIELDS }, input);
}

function live(v: View<ScopeChangeRuleInput>, kind: 'item' | 'modifier'): ItemKey[] {
  return v.catalog
    .filter((r) => r.kind === kind && r.status === 'confirmed')
    .map((r) => r.itemKey)
    .sort(codeUnitCmp);
}

/**
 * Scenario checks for `scope_change` (14 §7):
 * - `required_offered`: every required item is in the confirmed catalog (`reason: 'not_offered'`)
 * - `required_included`: every required item is included in `terms.itemKeys` (`reason: 'not_included'`)
 * - `by_deadline`: `terms.deliveryDate <= input.deadline` (`date.after_deadline`)
 */
export const SCOPE_CHANGE_CHECKS: readonly CheckDecl<ScopeChangeRuleInput>[] = [
  {
    checkId: 'required_offered',
    owner: 'customer',
    requires: [['requiredItemKeys']],
    dependsOn: [],
    run: ({ input }): CheckOutcome => {
      if (input.requiredItemKeys === undefined) return { unknown: true };
      const liveItems = new Set(live(input, 'item'));
      const miss = input.requiredItemKeys.filter((k) => !liveItems.has(k));
      return miss.length
        ? {
            ok: false,
            code: 'item.required_missing',
            params: { itemKeys: miss, missingItemKeys: miss, reason: 'not_offered' },
          }
        : { ok: true };
    },
  },
  {
    checkId: 'required_included',
    owner: 'customer',
    requires: [['requiredItemKeys']],
    dependsOn: ['terms_shape'],
    run: ({ input, terms }): CheckOutcome => {
      if (input.requiredItemKeys === undefined) return { unknown: true };
      const miss = input.requiredItemKeys.filter((k) => !terms.itemKeys.includes(k));
      return miss.length
        ? {
            ok: false,
            code: 'item.required_missing',
            params: { itemKeys: miss, missingItemKeys: miss, reason: 'not_included' },
          }
        : { ok: true };
    },
  },
  {
    checkId: 'by_deadline',
    owner: 'customer',
    requires: [['deadline']],
    dependsOn: ['terms_shape'],
    run: ({ input, terms }): CheckOutcome =>
      input.deadline === undefined
        ? { unknown: true }
        : terms.deliveryDate <= input.deadline
          ? { ok: true }
          : {
              ok: false,
              code: 'date.after_deadline',
              params: {
                deadline: input.deadline,
                daysLate: daysBetween(input.deadline, terms.deliveryDate),
              },
            },
  },
] as const;

import {
  candidateSpace,
  effectiveLeadDays as effectiveLeadDaysForRows,
  materialize,
  stubDecide,
} from './algorithms';
export { candidateSpace, effectiveLeadDaysForRows, materialize, stubDecide };

function cheapest(ms: readonly Materialized[]): Materialized | undefined {
  return [...ms].sort(
    (a, b) => a.terms.amountCents - b.terms.amountCents || codeUnitCmp(a.candidateKey, b.candidateKey),
  )[0];
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const out: T[][] = [];
  function walk(start: number, current: T[]) {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (k - current.length); i++) {
      current.push(items[i]!);
      walk(i + 1, current);
      current.pop();
    }
  }
  walk(0, []);
  return out;
}

function makeOption(
  kind: 'choose_candidate' | 'drop_items' | 'extend_deadline' | 'raise_cap',
  effect: Effect,
  m: Materialized,
  deltaCents?: Cents,
): RequestOption {
  return {
    optionKey: '',
    templateKey: `request.${kind}`,
    effect,
    shown: {
      itemKeys: [...m.terms.itemKeys],
      modifiers: [...m.terms.modifiers],
      amountCents: m.terms.amountCents,
      deliveryDate: m.terms.deliveryDate,
      ...(deltaCents !== undefined ? { deltaCents } : {}),
    },
  };
}

/**
 * Generate relaxation / human-request options for `role` using ONLY `v` (`toRole`'s view) (14 §6.4).
 * Uses the engine's `enumerateCandidates(..., { mode: 'feasibility' })` as the single feasibility algorithm.
 */
export function relaxations(
  role: string,
  v: View<ScopeChangeRuleInput>,
  ctx: RelaxCtx,
): RequestOption[] {
  const feas = (w: View<ScopeChangeRuleInput>): readonly Materialized[] =>
    enumerateCandidates(candidateScenario, w, {
      mode: 'feasibility',
      anchor: false,
      exclude: ctx.excludedCandidateKeys,
      mustInclude: [],
    }).materialized;

  if (ctx.kind === 'rounds_exhausted' || ctx.kind === 'agent_escalated') return [];

  if (role === 'customer') {
    const out: RequestOption[] = [];
    const req = [...(v.requiredItemKeys ?? [])];
    for (let size = 1; size <= req.length && out.length === 0; size++) {
      for (const drop of combinations(req, size)) {
        const remaining = req.filter((k) => !drop.includes(k));
        const m = cheapest(feas({ ...v, requiredItemKeys: remaining }));
        if (m) {
          out.push(
            makeOption('drop_items', { kind: 'drop_items', itemKeys: drop }, m),
          );
        }
      }
    }
    if (v.deadline !== undefined) {
      let lastAmount = Infinity;
      const byDelivery = [...feas({ ...v, deadline: undefined })].sort(
        (a, b) =>
          codeUnitCmp(a.terms.deliveryDate, b.terms.deliveryDate) ||
          a.terms.amountCents - b.terms.amountCents ||
          codeUnitCmp(a.candidateKey, b.candidateKey),
      );
      for (const m of byDelivery) {
        if (
          m.terms.deliveryDate <= v.deadline ||
          m.terms.deliveryDate > addDays(v.localDate, 365)
        ) {
          continue;
        }
        if (m.terms.amountCents < lastAmount) {
          out.push(
            makeOption(
              'extend_deadline',
              { kind: 'extend_deadline', date: m.terms.deliveryDate },
              m,
            ),
          );
          lastAmount = m.terms.amountCents;
        }
      }
    }
    return out.slice(0, 3);
  }

  if (role === 'finance' && v.capCents !== undefined && v.committedCents !== undefined) {
    const needs = new Map<number, Materialized>();
    for (const m of feas({
      ...v,
      capCents: undefined,
      committedCents: undefined,
      headroomCents: undefined,
    })) {
      const need = v.committedCents + m.terms.amountCents;
      if (
        need > v.capCents &&
        (!needs.has(need) ||
          m.terms.amountCents < needs.get(need)!.terms.amountCents ||
          (m.terms.amountCents === needs.get(need)!.terms.amountCents &&
            codeUnitCmp(m.candidateKey, needs.get(need)!.candidateKey) < 0))
      ) {
        needs.set(need, m);
      }
    }
    return [...needs.entries()]
      .sort(([a], [b]) => a - b)
      .slice(0, 3)
      .map(([need, m]) =>
        makeOption(
          'raise_cap',
          { kind: 'raise_cap', amountCents: cents(need) },
          m,
          cents(need - v.capCents!),
        ),
      );
  }

  return [];
}

/**
 * Project a role's `View<ScopeChangeRuleInput>` into a branded `Projected<RequestOptionView>`
 * and project + verify `options` via `core/engine/disclosure`'s `projectRequestOptions` and
 * `assertOptionsProjected` (06 §11.3, INV-10).
 */
export function buildProjectedOptionView(
  role: ScopeChangeRole,
  view: View<ScopeChangeRuleInput>,
): Projected<RequestOptionView> {
  const feas = (w: View<ScopeChangeRuleInput>) =>
    enumerateCandidates(candidateScenario, w, {
      mode: 'feasibility',
      anchor: false,
      exclude: [],
      mustInclude: [],
    }).items;
  const derivation: View<ScopeChangeRuleInput> = {
    ...view,
    requiredItemKeys: [],
    deadline: undefined,
    capCents: undefined,
    committedCents: undefined,
    headroomCents: undefined,
  };
  const available = [
    ...new Map(
      [
        ...feas(view),
        ...feas({ ...view, capCents: undefined, headroomCents: undefined }),
        ...feas(derivation),
      ].map((c) => [c.candidateKey, c] as const),
    ).values(),
  ];
  const candidates = available.map((c) =>
    pickExact(c, ['candidateKey', 'itemKeys', 'modifiers', 'amountCents', 'deliveryDate']),
  );
  return pickExact(
    {
      role,
      capCents: view.capCents,
      committedCents: view.committedCents,
      deadline: view.deadline,
      requiredItemKeys:
        view.requiredItemKeys === undefined ? undefined : [...view.requiredItemKeys],
      candidates,
    },
    ['role', 'capCents', 'committedCents', 'deadline', 'requiredItemKeys', 'candidates'],
  ) satisfies Projected<RequestOptionView>;
}

export function projectScopeChangeOptions(
  role: ScopeChangeRole,
  view: View<ScopeChangeRuleInput>,
  options: readonly RequestOption[],
) {
  const projectedView = buildProjectedOptionView(role, view);
  const projected = projectEngineRequestOptions(role, options, projectedView);
  assertOptionsProjected(role, projected);
  return projected;
}

// Candidate enumeration needs only this slice. Importing the registered plugin here
// creates plugin -> rules -> plugin and can run registration before checks exist.
const candidateScenario: ScenarioCandidateSlice<ScopeChangeRuleInput> = {
  roles: SCOPE_CHANGE_ROLES,
  fields: SCOPE_CHANGE_FIELDS,
  checks: SCOPE_CHANGE_CHECKS,
  protocol: SCOPE_CHANGE_PROTOCOL,
  catalog: SCOPE_CHANGE_CATALOG,
  candidateSpace,
  materialize,
};
