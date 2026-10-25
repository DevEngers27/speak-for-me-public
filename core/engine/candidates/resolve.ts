import { isoDate } from '../dates';
import type { IsoDate } from '../dates';
import { claimMismatch } from '../rules/materialize';
import { PluginContractError } from '../rules/types';
import type { SnapshotItem } from '../rules/types';
import { normalizeCatalogRow } from '../rules/view';
import type {
  CatalogRowInput,
  MaterializeOptionResult,
  ResolveOptionKeyResult,
  ScenarioMaterializeSlice,
} from './types';

const OPTION_KEY_RE = /^O(?:[1-9]|1[0-2])$/;

/**
 * Returns `true` iff `value` is a syntactically valid snapshot `optionKey` (`'O1'`..`'O12'`).
 */
export function isOptionKey(value: unknown): value is string {
  return typeof value === 'string' && OPTION_KEY_RE.test(value);
}

function unwrapSnapshot(
  snapshot: readonly SnapshotItem[] | { readonly items: readonly SnapshotItem[] },
): readonly SnapshotItem[] {
  if (Array.isArray(snapshot)) {
    return snapshot;
  }
  if (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    'items' in snapshot &&
    Array.isArray((snapshot as { readonly items: readonly SnapshotItem[] }).items)
  ) {
    return (snapshot as { readonly items: readonly SnapshotItem[] }).items;
  }
  return [];
}

/**
 * Resolves `optionKey` strictly within the given turn `snapshot` (canon D10, 05 §5.7.1 & §5.7.3, 10 §10.4).
 *
 * - Never re-enumerates candidates.
 * - Returns a defensive copy of the matching `SnapshotItem`, or `null` if `optionKey` is not in `snapshot`.
 */
export function resolveOptionKey(
  snapshot: readonly SnapshotItem[] | { readonly items: readonly SnapshotItem[] },
  optionKey: string,
): SnapshotItem | null {
  if (!isOptionKey(optionKey)) return null;
  const items = unwrapSnapshot(snapshot);
  const found = items.find((item) => item.optionKey === optionKey);
  if (!found) return null;
  return {
    optionKey: found.optionKey,
    candidateKey: found.candidateKey,
    itemKeys: [...found.itemKeys],
    modifiers: [...found.modifiers],
    amountCents: found.amountCents,
    deliveryDate: found.deliveryDate,
  };
}

/**
 * Resolves `optionKey` within `snapshot` and checks against `excludedCandidateKeys` (05 §5.6.2).
 * Returns `{ ok: false, code: 'action.option_not_in_snapshot' }` if `optionKey` is absent,
 * or `{ ok: false, code: 'action.repeats_blocked' }` if its `candidateKey` is in `excludedCandidateKeys`.
 */
export function resolveOptionKeyWithReason(
  snapshot: readonly SnapshotItem[] | { readonly items: readonly SnapshotItem[] },
  optionKey: string,
  excludedCandidateKeys?: readonly string[],
): ResolveOptionKeyResult {
  const entry = resolveOptionKey(snapshot, optionKey);
  if (!entry) {
    return { ok: false, code: 'action.option_not_in_snapshot' };
  }
  if (excludedCandidateKeys && excludedCandidateKeys.includes(entry.candidateKey)) {
    return { ok: false, code: 'action.repeats_blocked' };
  }
  return {
    ok: true,
    entry,
    candidateKey: entry.candidateKey,
  };
}

/**
 * Resolves `optionKey` inside `snapshot` and materializes its terms on the room's current `localDate`
 * using the scenario's `materialize` member (canon D22, 05 §5.7.3).
 *
 * - Verifies `materialized.terms.amountCents === snapshotEntry.amountCents` (`amount.claim_mismatch` on discrepancy).
 * - Allows `deliveryDate` to shift if the turn crossed local midnight (`deliveryDateShifted: true`).
 */
export function materializeSelectedOption(
  scenario: ScenarioMaterializeSlice | ScenarioMaterializeSlice['materialize'],
  snapshot: readonly SnapshotItem[] | { readonly items: readonly SnapshotItem[] },
  optionKey: string,
  catalog: readonly CatalogRowInput[],
  localDate: IsoDate | string,
  excludedCandidateKeys?: readonly string[],
): MaterializeOptionResult {
  const fn = typeof scenario === 'function' ? scenario : scenario?.materialize;
  if (typeof fn !== 'function') {
    throw new PluginContractError('invalid_scenario_slice');
  }
  const ownerRole = typeof scenario === 'object' ? scenario?.catalog?.ownerRole : undefined;

  const resolved = resolveOptionKeyWithReason(snapshot, optionKey, excludedCandidateKeys);
  if (!resolved.ok) {
    return resolved;
  }

  const entry = resolved.entry;
  const date = isoDate(localDate);
  const normalizedCatalog = catalog.map((r) => normalizeCatalogRow(r, ownerRole));
  const materialized = fn(
    { itemKeys: entry.itemKeys, modifiers: entry.modifiers },
    normalizedCatalog,
    date,
  );
  if (materialized === null) {
    return { ok: false, code: 'amount.out_of_range' };
  }

  const claim = claimMismatch(materialized);
  if (!('ok' in claim) || !claim.ok) {
    return {
      ok: false,
      code:
        'code' in claim && claim.code === 'amount.out_of_range'
          ? 'amount.out_of_range'
          : 'amount.claim_mismatch',
    };
  }

  if (
    materialized.terms.amountCents !== entry.amountCents ||
    materialized.candidateKey !== entry.candidateKey
  ) {
    return { ok: false, code: 'amount.claim_mismatch' };
  }

  return {
    ok: true,
    snapshotEntry: entry,
    materialized,
    deliveryDateShifted: materialized.terms.deliveryDate !== entry.deliveryDate,
  };
}
