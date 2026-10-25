import { isoDate } from '../dates';
import type { IsoDate } from '../dates';
import { cents, MAX_CENTS, signedCents } from '../money';
import type { Cents } from '../money';
import type { CatalogDecl, FieldDecl, RoleDecl, ScenarioPlugin } from '../plugin';
import { pickExact, type Projected } from '../projection';
import { PARAM_AUDIENCE } from '../reasonCodes';
import type { ParamAudience, ReasonParams } from '../reasonCodes';
import { PluginContractError } from './types';
import type { CatalogRow, CheckResult, Evaluation, ItemKey, RuleInputBase, View } from './types';

function projectConstructed<T extends object>(value: T): Projected<T> {
  const copy = pickExact as unknown as (source: T, keys: readonly string[]) => Projected<T>;
  return copy(value, Object.keys(value));
}

const roleViews = new WeakSet<object>();

/**
 * Checks at runtime whether `view` was produced by `viewFor(plugin, full, disclosures, viewer)`.
 * Uses a module-private WeakSet so neither spread copies (`{ ...viewFor(...) }`) nor objects
 * branded via the public `pickExact` helper are accepted as role views (i11).
 */
export function isRoleView<RI extends RuleInputBase = RuleInputBase>(
  view: unknown,
): view is Projected<View<RI>> {
  return typeof view === 'object' && view !== null && roleViews.has(view);
}

export interface CatalogRowInput {
  readonly itemKey: ItemKey;
  readonly kind: 'item' | 'modifier';
  readonly revision: number;
  readonly title: string;
  readonly priceCents: Cents | number;
  readonly leadDays: number;
  readonly status: 'confirmed' | 'retired';
  readonly taskTemplates: readonly {
    readonly title: string;
    readonly assigneeRole?: string;
  }[];
  readonly provenance: 'live' | 'seeded' | 'stub';
}

export function normalizeCatalogRow(
  row: CatalogRowInput,
  ownerRole?: string,
): Projected<CatalogRow> {
  if (
    !row ||
    typeof row !== 'object' ||
    (row.provenance !== 'live' && row.provenance !== 'seeded' && row.provenance !== 'stub')
  ) {
    throw new PluginContractError('invalid_provenance');
  }
  if (row.status !== 'confirmed' && row.status !== 'retired') {
    throw new PluginContractError('invalid_catalog_status');
  }
  if (row.kind !== 'item' && row.kind !== 'modifier') {
    throw new PluginContractError('invalid_catalog_kind');
  }
  if (
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new PluginContractError('invalid_catalog_revision');
  }
  if (
    typeof row.leadDays !== 'number' ||
    !Number.isSafeInteger(row.leadDays) ||
    row.leadDays < 0 ||
    row.leadDays > 365
  ) {
    throw new PluginContractError('invalid_lead_days');
  }
  const priceCents = cents(row.priceCents);
  const taskTemplates = row.taskTemplates.map((t) => {
    const assigneeRole = t.assigneeRole ?? ownerRole;
    if (typeof assigneeRole !== 'string' || assigneeRole.length === 0) {
      throw new PluginContractError('missing_assignee_role');
    }
    return projectConstructed({
      title: t.title,
      assigneeRole,
    });
  });
  return projectConstructed({
    itemKey: row.itemKey,
    kind: row.kind,
    revision: row.revision,
    title: row.title,
    priceCents,
    leadDays: row.leadDays,
    status: row.status,
    provenance: row.provenance,
    taskTemplates,
  });
}

export type ScenarioViewSlice<RI extends RuleInputBase = RuleInputBase> = {
  readonly roles: readonly RoleDecl[];
  readonly fields: readonly FieldDecl[];
  readonly catalog?: Pick<CatalogDecl, 'ownerRole'>;
  readonly _ri?: RI;
};

export function validateFieldValue(f: FieldDecl, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (f.valueKind === 'cents') {
    if (f.semantic === 'ledger_headroom') {
      const val = signedCents(raw as number);
      if (Math.abs(val) > MAX_CENTS) throw new PluginContractError('invalid_amount');
      return val as number;
    }
    return cents(raw as number);
  }
  if (f.valueKind === 'isoDate') {
    return isoDate(raw as string);
  }
  if (f.valueKind === 'itemKeys') {
    if (!Array.isArray(raw) || raw.some((k) => typeof k !== 'string')) {
      throw new PluginContractError('invalid_field_value');
    }
    return [...(raw as readonly string[])];
  }
  return raw;
}

export type FullViewInput<RI extends RuleInputBase> = Omit<
  View<RI>,
  'viewer' | 'localDate' | 'catalog'
> & {
  readonly viewer?: string;
  readonly localDate: IsoDate | string;
  readonly catalog: readonly CatalogRowInput[];
};

export function viewFor<RI extends RuleInputBase>(
  p: ScenarioPlugin<RI> | ScenarioViewSlice<RI>,
  full: View<RI> | FullViewInput<RI>,
  disclosures: Readonly<Record<string, readonly string[] | undefined>> | undefined,
  viewer: string,
): Projected<View<RI>> {
  if (!p || !Array.isArray(p.roles) || !Array.isArray(p.fields)) {
    throw new PluginContractError('invalid_scenario_slice');
  }
  const roleDecl = p.roles.find((r) => r.role === viewer);
  if (!roleDecl) throw new PluginContractError('unknown_viewer');

  const localDate = isoDate(full.localDate);
  const catalog = full.catalog.map((r) => normalizeCatalogRow(r, p.catalog?.ownerRole));
  const fullRec = full as unknown as Record<string, unknown>;
  const disc = disclosures ?? {};

  const isVisible = (f: FieldDecl): boolean => {
    if (roleDecl.side === 'seller' && f.semantic !== undefined) return false;
    return (
      f.owner === viewer ||
      (f.disclosableTo.includes(viewer) &&
        Array.isArray(disc[f.key]) &&
        disc[f.key]!.includes(viewer))
    );
  };

  const out: Record<string, unknown> = {
    localDate,
    catalog,
    viewer,
    capCents: undefined,
    committedCents: undefined,
    headroomCents: undefined,
  };

  for (const f of p.fields) {
    out[f.key] = isVisible(f) ? validateFieldValue(f, fullRec[f.key]) : undefined;
  }

  const capField = p.fields.find((f) => f.semantic === 'budget_cap');
  const committedField = p.fields.find((f) => f.semantic === 'ledger_committed');
  const headroomField = p.fields.find((f) => f.semantic === 'ledger_headroom');
  if (headroomField && roleDecl.side !== 'seller' && out[headroomField.key] === undefined) {
    if (
      capField &&
      committedField &&
      out[capField.key] !== undefined &&
      out[committedField.key] !== undefined
    ) {
      out[headroomField.key] = (out[capField.key] as number) - (out[committedField.key] as number);
    } else if (
      isVisible(headroomField) &&
      capField &&
      committedField &&
      fullRec[capField.key] !== undefined &&
      fullRec[committedField.key] !== undefined
    ) {
      out[headroomField.key] =
        cents(fullRec[capField.key] as number) - cents(fullRec[committedField.key] as number);
    }
  }

  const projected = projectConstructed(out) as unknown as Projected<View<RI>>;
  roleViews.add(projected);
  return projected;
}

export type ProjectedCheck = Pick<CheckResult, 'checkId' | 'status' | 'code' | 'params'>;
export type EvaluationView = { audience: 'provider'; fit: 'ok' | 'blocked' } | { audience: 'buyer'; passesChecks: boolean; checks: ProjectedCheck[]; masked: { code: 'private.constraint_unmet' } | null; amounts: Partial<Evaluation['amounts']> };
export function projectEvaluation<RI extends RuleInputBase>(ev: Evaluation, viewer: string, p: ScenarioPlugin<RI>, disclosures: Readonly<Record<string, readonly string[]>>): EvaluationView {
  const role = p.roles.find(r => r.role === viewer);
  if (!role) throw new PluginContractError('unknown_viewer');
  if (role.side === 'seller') return { audience: 'provider', fit: ev.passesChecks ? 'ok' : 'blocked' };
  const visible = (key: string) => p.fields.some(f => f.key === key && (f.owner === viewer || disclosures[key]?.includes(viewer)));
  const checks: ProjectedCheck[] = [];
  let masked = false;
  for (const c of ev.checks) {
    const decl = p.checks.find(d => d.checkId === c.checkId);
    const requires = decl?.requires ?? (c.checkId.startsWith('budget_') ? [['capCents', 'committedCents'], ['headroomCents']] : []);
    const exact = c.owner === null || c.owner === viewer || requires.some(g => g.every(visible));
    if (!exact) { if (c.status === 'fail') masked = true; continue; }
    const params: ReasonParams = {};
    const audience: Readonly<Record<string, ParamAudience>> = c.code ? PARAM_AUDIENCE[c.code] : {};
    // Structural engine failures describe public terms, not a private owner.
    const publicStructural = c.owner === null && ['terms_shape', 'amount_consistent', 'date_window'].includes(c.checkId);
    for (const [key, value] of Object.entries(c.params)) {
      const rule = audience[key];
      if (rule === 'room' || ((rule === 'owner' || rule === 'caller') && (publicStructural || c.owner === viewer)) || (typeof rule === 'object' && (c.owner === viewer || visible(rule.ifDisclosed)))) params[key] = value;
    }
    checks.push({ checkId: c.checkId, status: c.status, code: c.code, params });
  }
  const amounts: Partial<Evaluation['amounts']> = { amountCents: ev.amounts.amountCents };
  if (visible('capCents') && ev.amounts.capCents !== undefined) amounts.capCents = ev.amounts.capCents;
  if (visible('committedCents')) {
    if (ev.amounts.committedCents !== undefined) amounts.committedCents = ev.amounts.committedCents;
    if (ev.amounts.committedAfterCents !== undefined) amounts.committedAfterCents = ev.amounts.committedAfterCents;
  }
  if (visible('headroomCents')) {
    if (ev.amounts.headroomCents !== undefined) amounts.headroomCents = ev.amounts.headroomCents;
    if (ev.amounts.overByCents !== undefined) amounts.overByCents = ev.amounts.overByCents;
  }
  return { audience: 'buyer', passesChecks: ev.passesChecks, checks, masked: masked ? { code: 'private.constraint_unmet' } : null, amounts };
}
