import type { TurnKind } from '../actions';
import { codeUnitCmp, enumerateCandidates } from '../candidates/enumerate';
import type {
  CandidateSnapshotResult,
  FullViewInput,
  ScenarioCandidateSlice,
} from '../candidates/types';
import { isRoleView, viewFor } from '../candidates/view';
import type { ScenarioPlugin } from '../plugin';
import type { Cents } from '../money';
import type { IsoDate } from '../dates';
import type { RuleInputBase, SnapshotItem, View } from '../rules/types';
import type { RoundFeedback } from './resolveRound';

/**
 * Turn snapshot builder and run exclusion collector
 * (05 §5.7, 07 §7.14.2, canon D10, CN-002 #5, CN-003 #1/#2/#5).
 *
 * Pure TypeScript: zero runtime dependencies.
 */

export type ProposalExclusionRow = {
  readonly candidateKey: string;
  readonly runId?: string;
  readonly status?: string;
  readonly fit?: 'ok' | 'blocked';
};

export type RunExclusionsInput = {
  readonly runId?: string;
  /** Proposals in the current run or room (proposed incl. rule-blocked, plus human-rejected in room). */
  readonly proposals?: readonly ProposalExclusionRow[];
  /** Explicit candidateKeys already proposed in this run (including rule-blocked). */
  readonly proposedCandidateKeys?: readonly string[];
  /** Explicit candidateKeys blocked by rules in this run. */
  readonly blockedCandidateKeys?: readonly string[];
  /** Explicit candidateKeys rejected by a human in this room. */
  readonly humanRejectedCandidateKeys?: readonly string[];
  /** Explicit candidateKeys that failed a `choose_candidate` recheck in this run. */
  readonly failedChooseCandidateKeys?: readonly string[];
  /** Additional pre-computed excluded candidateKeys. */
  readonly excludedCandidateKeys?: readonly string[];
};

/**
 * Computes `excludedCandidateKeys(run)` (05 §5.7.2 #2):
 * Union of:
 * 1. Every `candidateKey` proposed in the current run (including rule-blocked proposals).
 * 2. Every `candidateKey` rejected by a human in this room (`status === 'rejected'`).
 * 3. Every `candidateKey` that failed a `choose_candidate` recheck in this run.
 */
export function excludedCandidateKeys(
  run?: RunExclusionsInput | readonly string[],
): readonly string[] {
  if (!run) return [];
  if (Array.isArray(run)) {
    return [...new Set(run)].sort(codeUnitCmp);
  }
  const input = run as RunExclusionsInput;
  const set = new Set<string>();

  for (const k of input.proposedCandidateKeys ?? []) {
    if (typeof k === 'string' && k.length > 0) set.add(k);
  }
  for (const k of input.blockedCandidateKeys ?? []) {
    if (typeof k === 'string' && k.length > 0) set.add(k);
  }
  for (const k of input.humanRejectedCandidateKeys ?? []) {
    if (typeof k === 'string' && k.length > 0) set.add(k);
  }
  for (const k of input.failedChooseCandidateKeys ?? []) {
    if (typeof k === 'string' && k.length > 0) set.add(k);
  }
  for (const k of input.excludedCandidateKeys ?? []) {
    if (typeof k === 'string' && k.length > 0) set.add(k);
  }

  for (const p of input.proposals ?? []) {
    if (typeof p.candidateKey !== 'string' || p.candidateKey.length === 0) {
      continue;
    }
    const inCurrentRun =
      input.runId === undefined ||
      p.runId === undefined ||
      p.runId === input.runId;
    const isHumanRejected = p.status === 'rejected';
    if (inCurrentRun || isHumanRejected) {
      set.add(p.candidateKey);
    }
  }

  return [...set].sort(codeUnitCmp);
}

export type ProviderTurnFeedback =
  | { readonly fit: 'blocked' }
  | {
      readonly kind: 'not_accepted';
      readonly counter?: {
        readonly optionKey: string;
        readonly itemKeys: readonly string[];
        readonly modifiers: readonly string[];
        readonly amountCents: Cents;
        readonly deliveryDate: IsoDate;
      };
    };

export type BuildTurnSnapshotParams<RI extends RuleInputBase = RuleInputBase> = {
  readonly scenario: ScenarioCandidateSlice<RI> | ScenarioPlugin<RI>;
  /** Role whose turn snapshot is being built (`'provider' | 'customer' | 'finance'`). */
  readonly role: string;
  readonly turnKind: TurnKind;
  readonly roundNo: number;
  /** Either pass an already-projected `view` from `viewFor(...)` or `fullInput` + `disclosures`. */
  readonly view?: View<RI>;
  readonly fullInput?: RI;
  readonly disclosures?: Readonly<Record<string, readonly string[]>>;
  /** Required in `'evaluate'` turns to exclude the active proposal from counter candidates. */
  readonly baseCandidateKey?: string;
  /** Run exclusion sources (proposed incl. blocked, human-rejected, failed `choose_candidate`). */
  readonly run?: RunExclusionsInput | readonly string[];
  readonly excludedCandidateKeys?: readonly string[];
  /** Previous round's `RoundFeedback` (for provider `propose` turns in round >= 2, CN-002 #5). */
  readonly feedback?: RoundFeedback | null;
  /** Explicit counter `candidateKey` from previous round to force-include in `O1..O12`. */
  readonly counterCandidateKey?: string;
  readonly limit?: number;
};

export type TurnSnapshotOutput = CandidateSnapshotResult & {
  readonly excludedCandidateKeys: readonly string[];
  readonly feedback: ProviderTurnFeedback | null;
};

/**
 * Builds the canonical turn `candidateSnapshot` (`O1..On`, `n <= 12`) for `createTurnTx`
 * (05 §5.7, 07 §7.14.2, canon D10, CN-002 #5, CN-003 #1/#2/#5):
 *
 * - Projects the role view via `viewFor(scenario, fullInput, disclosures, role)` if `view` is not already projected.
 * - Subtracts `excludedCandidateKeys(run)` (proposed incl. blocked ∪ human-rejected ∪ failed `choose_candidate`).
 * - In `'evaluate'` turns: excludes `baseCandidateKey` for counter-capable evaluators (`customer`);
 *   returns `[]` for non-counter evaluators (`finance`).
 * - In `'propose'` turns: round 1 places the lowest-`amountCents` candidate containing disclosed required items at `O1`;
 *   round >= 2 sorts strictly by `candidateKey` and includes any passing `counter.candidateKey` via `mustInclude`
 *   (replacing `O12` if outside top 12), resolving its `optionKey` into `feedback.counter`.
 */
export function buildTurnSnapshot<RI extends RuleInputBase>(
  params: BuildTurnSnapshotParams<RI>,
): TurnSnapshotOutput {
  if (params.view && isRoleView(params.view) && params.view.viewer !== params.role) {
    throw new Error('Snapshot view must belong to the turn role');
  }
  const roleView: View<RI> =
    params.view && isRoleView(params.view)
      ? params.view
      : viewFor(
          params.scenario as ScenarioPlugin<RI>,
          (params.fullInput ?? params.view) as unknown as FullViewInput<RI>,
          params.disclosures,
          params.role,
        );

  const runExcluded = excludedCandidateKeys(params.run);
  const combinedExcluded = excludedCandidateKeys({
    excludedCandidateKeys: [
      ...runExcluded,
      ...(params.excludedCandidateKeys ?? []),
    ],
  });

  const counterCandidateKey =
    params.counterCandidateKey ??
    (params.feedback &&
    'kind' in params.feedback &&
    params.feedback.kind === 'not_accepted'
      ? params.feedback.counter?.candidateKey
      : undefined);

  const mustInclude =
    params.turnKind === 'propose' &&
    typeof counterCandidateKey === 'string' &&
    counterCandidateKey.length > 0
      ? [counterCandidateKey]
      : [];

  const result = enumerateCandidates(params.scenario, roleView, {
    mode: 'snapshot',
    turnKind: params.turnKind,
    roundNo: params.roundNo,
    baseCandidateKey: params.baseCandidateKey,
    excludedCandidateKeys: combinedExcluded,
    mustInclude,
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });

  let feedback: ProviderTurnFeedback | null = null;
  if (params.turnKind === 'propose' && params.feedback) {
    if ('fit' in params.feedback && params.feedback.fit === 'blocked') {
      feedback = Object.freeze({ fit: 'blocked' as const });
    } else if ('kind' in params.feedback && params.feedback.kind === 'not_accepted') {
      const counterEntry: SnapshotItem | undefined =
        typeof counterCandidateKey === 'string'
          ? result.items.find((item) => item.candidateKey === counterCandidateKey)
          : undefined;
      feedback = Object.freeze({
        kind: 'not_accepted' as const,
        ...(counterEntry
          ? {
              counter: Object.freeze({
                optionKey: counterEntry.optionKey,
                itemKeys: Object.freeze([...counterEntry.itemKeys]),
                modifiers: Object.freeze([...counterEntry.modifiers]),
                amountCents: counterEntry.amountCents,
                deliveryDate: counterEntry.deliveryDate,
              }),
            }
          : {}),
      });
    }
  }

  return {
    items: result.items,
    materialized: result.materialized,
    emptyReasons: result.emptyReasons,
    excludedCandidateKeys: combinedExcluded,
    feedback,
  };
}
