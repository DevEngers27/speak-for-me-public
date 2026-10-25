import { isoDate } from '../dates';
import { cents, MAX_CENTS, signedCents } from '../money';
import type { ScenarioPlugin } from '../plugin';
import { pickExact, type Projected } from '../projection';
import { PluginContractError } from '../rules/types';
import type { RuleInputBase, View } from '../rules/types';
import {
  isRoleView,
  normalizeCatalogRow,
  validateFieldValue,
  viewFor,
  type CatalogRowInput,
} from '../rules/view';
import type { ScenarioCandidateSlice } from './types';

export { isRoleView, normalizeCatalogRow, validateFieldValue, viewFor };

function projectConstructed<T extends object>(value: T): Projected<T> {
  const copy = pickExact as unknown as (source: T, keys: readonly string[]) => Projected<T>;
  return copy(value, Object.keys(value));
}

function validateBudgetBase(rec: Record<string, unknown>): {
  capCents: ReturnType<typeof cents> | undefined;
  committedCents: ReturnType<typeof cents> | undefined;
  headroomCents: number | undefined;
} {
  const capCents = rec.capCents !== undefined ? cents(rec.capCents as number) : undefined;
  const committedCents =
    rec.committedCents !== undefined ? cents(rec.committedCents as number) : undefined;
  let headroomCents: number | undefined;
  if (rec.headroomCents !== undefined) {
    const val = signedCents(rec.headroomCents as number);
    if (Math.abs(val) > MAX_CENTS) throw new PluginContractError('invalid_amount');
    headroomCents = val as number;
  } else if (capCents !== undefined && committedCents !== undefined) {
    headroomCents = capCents - committedCents;
  }
  return { capCents, committedCents, headroomCents };
}

/**
 * Validates and prepares a `View<RI>` for candidate enumeration (06 §5.2, §10.1, CN-003, i11):
 * - Rejects `viewer === 'system'` in `'snapshot'` mode (`system_view_in_snapshot_mode`).
 * - Accepts ONLY a role `View<RI>` branded by `viewFor(plugin, full, disclosures, role)`
 *   (`isRoleView(view)`), throwing `PluginContractError('unprojected_view')` for spread copies,
 *   unprojected objects, or objects forged via `pickExact` (no silent re-projection).
 * - In `'feasibility'` mode, continues to accept the `viewer === 'system'` view.
 */
export function validateViewForEnumeration<RI extends RuleInputBase>(
  scenario: ScenarioCandidateSlice<RI> | ScenarioPlugin<RI>,
  view: View<RI>,
  mode: 'snapshot' | 'feasibility',
): View<RI> {
  if (!view || typeof view !== 'object') {
    throw new PluginContractError('unknown_viewer');
  }
  const rawViewer = typeof view.viewer === 'string' ? view.viewer : undefined;
  if (!rawViewer) {
    throw new PluginContractError('unknown_viewer');
  }

  if (rawViewer === 'system') {
    if (mode !== 'feasibility') {
      throw new PluginContractError('system_view_in_snapshot_mode');
    }
    const rec = view as unknown as Record<string, unknown>;
    const localDate = isoDate(view.localDate);
    const catalog = (view.catalog as readonly CatalogRowInput[]).map((r) =>
      normalizeCatalogRow(r, scenario.catalog?.ownerRole),
    );
    const { capCents, committedCents, headroomCents } = validateBudgetBase(rec);
    const out: Record<string, unknown> = {
      localDate,
      catalog,
      viewer: 'system',
      capCents,
      committedCents,
      headroomCents,
    };
    for (const f of scenario.fields) {
      if (f.key in out && out[f.key] !== undefined) continue;
      out[f.key] = validateFieldValue(f, rec[f.key]);
    }
    return projectConstructed(out) as unknown as View<RI>;
  }

  const roleDecl = scenario.roles.find((r) => r.role === rawViewer);
  if (!roleDecl) {
    throw new PluginContractError('unknown_viewer');
  }

  if (mode === 'snapshot' && !isRoleView(view)) {
    throw new PluginContractError('unprojected_view');
  }

  const rec = view as unknown as Record<string, unknown>;
  isoDate(view.localDate);
  for (const r of view.catalog as readonly CatalogRowInput[]) {
    normalizeCatalogRow(r, scenario.catalog?.ownerRole);
  }
  if (roleDecl.side === 'seller') {
    if (
      rec.capCents !== undefined ||
      rec.committedCents !== undefined ||
      rec.headroomCents !== undefined
    ) {
      throw new PluginContractError('unprojected_view');
    }
  } else {
    validateBudgetBase(rec);
  }
  for (const f of scenario.fields) {
    if (roleDecl.side === 'seller' && f.semantic !== undefined) {
      if (rec[f.key] !== undefined) {
        throw new PluginContractError('unprojected_view');
      }
      continue;
    }
    validateFieldValue(f, rec[f.key]);
  }

  return view;
}
