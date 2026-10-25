import type { ScenarioPlugin } from '../plugin';
import {
  enumerateCandidates as rulesEnumerateCandidates,
  type EnumerateOpts,
} from '../rules/candidates';
import { PluginContractError } from '../rules/types';
import type { RuleInputBase, View } from '../rules/types';
import type {
  CandidateSnapshotResult,
  EnumerateCandidatesOptions,
  ScenarioCandidateSlice,
} from './types';
import { validateViewForEnumeration } from './view';

export function codeUnitCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertScenarioCandidateSlice<RI extends RuleInputBase>(
  scenario: ScenarioCandidateSlice<RI> | ScenarioPlugin<RI>,
): void {
  if (
    typeof scenario !== 'object' ||
    scenario === null ||
    !Array.isArray(scenario.roles) ||
    scenario.roles.length === 0 ||
    !Array.isArray(scenario.fields) ||
    !Array.isArray(scenario.checks) ||
    typeof scenario.candidateSpace !== 'function' ||
    typeof scenario.materialize !== 'function'
  ) {
    throw new PluginContractError('invalid_scenario_slice');
  }
}

/**
 * Enumerates candidate options for a role's view using the given scenario plugin or slice
 * (canon D10, 05 §5.7.2, 06 §10, CN-003, i11):
 * - Requires a scenario with `roles`, `fields`, `checks`, `candidateSpace`, and `materialize` (no scenario defaults in engine).
 * - In `'snapshot'` mode, accepts only a role `View<RI>` produced by `viewFor(plugin, full, disclosures, role)`
 *   (`isRoleView(view)`) and throws `PluginContractError('unprojected_view')` for anything else.
 * - Rejects `viewer === 'system'` in `'snapshot'` mode (`system_view_in_snapshot_mode`).
 * - Requires `turnKind` and `roundNo` in `'snapshot'` mode; computes `anchor = role === proposerRole && turnKind === 'propose' && roundNo === 1` with no override.
 * - Returns `{ items: [], materialized: [], emptyReasons: [] }` for non-counter evaluators in `'evaluate'` turns.
 * - Excludes `excludedCandidateKeys` and (in `'evaluate'` turns) `baseCandidateKey`.
 */
export function enumerateCandidates<RI extends RuleInputBase>(
  scenario: ScenarioCandidateSlice<RI> | ScenarioPlugin<RI>,
  view: View<RI>,
  options: EnumerateCandidatesOptions | EnumerateOpts,
): CandidateSnapshotResult {
  assertScenarioCandidateSlice(scenario);

  if (!options || typeof options !== 'object') {
    throw new PluginContractError('invalid_enumerate_options');
  }

  const mode = options.mode ?? 'snapshot';
  if (mode !== 'snapshot' && mode !== 'feasibility') {
    throw new PluginContractError('invalid_enumerate_options');
  }

  const validatedView = validateViewForEnumeration(scenario, view, mode);

  if (options.mode === 'feasibility') {
    const legacyExclude = (options as { readonly exclude?: readonly string[] }).exclude;
    const excluded =
      (options as { readonly excludedCandidateKeys?: readonly string[] }).excludedCandidateKeys ??
      legacyExclude ??
      [];
    return rulesEnumerateCandidates(scenario as ScenarioPlugin<RI>, validatedView, {
      mode: 'feasibility',
      anchor: false,
      exclude: [...excluded],
      mustInclude: [],
    });
  }

  if ('anchor' in options) {
    throw new PluginContractError('anchor_override_forbidden');
  }

  if (options.turnKind !== 'propose' && options.turnKind !== 'evaluate') {
    throw new PluginContractError('invalid_turn_kind');
  }

  if (
    typeof options.roundNo !== 'number' ||
    !Number.isSafeInteger(options.roundNo) ||
    options.roundNo < 1
  ) {
    throw new PluginContractError('invalid_round_no');
  }

  const proposerRole =
    scenario.protocol?.proposerRole ??
    scenario.roles.find((r) => r.side === 'seller')?.role;
  if (!proposerRole) {
    throw new PluginContractError('invalid_scenario_slice');
  }

  const counterRoles =
    scenario.protocol?.counterRoles ??
    scenario.roles.filter((r) => r.side === 'buyer' && !r.budgetOwner).map((r) => r.role);

  // Non-counter evaluators in an evaluate turn cannot counter; their turn snapshot is empty (05 §5.7.2).
  if (options.turnKind === 'evaluate' && !counterRoles.includes(validatedView.viewer)) {
    return { items: [], materialized: [], emptyReasons: [] };
  }

  const excludeSet = new Set<string>(options.excludedCandidateKeys ?? []);
  if (
    options.turnKind === 'evaluate' &&
    typeof options.baseCandidateKey === 'string' &&
    options.baseCandidateKey.length > 0
  ) {
    excludeSet.add(options.baseCandidateKey);
  }

  const anchor =
    validatedView.viewer === proposerRole &&
    options.turnKind === 'propose' &&
    options.roundNo === 1;

  const limit = options.limit ?? scenario.protocol?.maxCandidates ?? 12;

  return rulesEnumerateCandidates(scenario as ScenarioPlugin<RI>, validatedView, {
    mode: 'snapshot',
    limit,
    anchor,
    exclude: [...excludeSet],
    mustInclude: [...(options.mustInclude ?? [])],
  });
}
