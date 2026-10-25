import type { AgentAction, AgentModelOutputRoot, Role, TurnKind } from '../actions';
import type { IsoDate } from '../dates';
import type { CatalogDecl, FieldDecl, ProtocolDecl, RoleDecl } from '../plugin';
import type { ReasonCode } from '../reasonCodes';
import type {
  CandidateDraft,
  CatalogRow,
  CheckDecl,
  CheckOutcome,
  Evaluation,
  ItemKey,
  Materialized,
  RuleInputBase,
  SnapshotItem,
  View,
} from '../rules/types';
import type { CatalogRowInput, FullViewInput, ScenarioViewSlice } from '../rules/view';

export type {
  CandidateDraft,
  CatalogRow,
  CatalogRowInput,
  CheckDecl,
  CheckOutcome,
  FullViewInput,
  ItemKey,
  Materialized,
  RuleInputBase,
  ScenarioViewSlice,
  SnapshotItem,
  View,
};

/**
 * Field-level disclosure map specifying which roles each field is disclosed to
 * (canon D05, 06 §5.2, 06 §8).
 */
export type RoleDisclosures = Readonly<Record<string, readonly string[] | undefined>>;

/**
 * Scenario slice required by `enumerateCandidates(scenario, view, options)`.
 * Must carry `roles`, `fields`, `checks`, `candidateSpace`, and `materialize` (06 §12.1, §12.3).
 */
export interface ScenarioCandidateSlice<RI extends RuleInputBase = RuleInputBase> {
  readonly roles: readonly RoleDecl[];
  readonly fields: readonly FieldDecl[];
  readonly checks: readonly CheckDecl<RI>[];
  readonly protocol?: Pick<
    ProtocolDecl,
    'proposerRole' | 'evaluatorOrder' | 'counterRoles' | 'maxCandidates'
  >;
  readonly catalog?: Pick<CatalogDecl, 'ownerRole'>;
  candidateSpace(view: View<RI>): { drafts: CandidateDraft[]; emptyReasons: ReasonCode[] };
  materialize(
    draft: CandidateDraft,
    catalog: readonly CatalogRow[],
    localDate: IsoDate,
  ): Materialized | null;
  stubDecide?(input: StubDecideInput): AgentModelOutputRoot;
}

/**
 * Scenario slice required by `materializeSelectedOption`.
 */
export interface ScenarioMaterializeSlice {
  readonly catalog?: Pick<CatalogDecl, 'ownerRole'>;
  materialize(
    draft: CandidateDraft,
    catalog: readonly CatalogRow[],
    localDate: IsoDate,
  ): Materialized | null;
}

/**
 * Options for `enumerateCandidates(scenario, view, options)` (canon D10, 05 §5.7.2, 06 §10, CN-003):
 * - In `'snapshot'` mode (default), `turnKind` and `roundNo` are required; `anchor` is derived
 *   strictly from `role === proposerRole && turnKind === 'propose' && roundNo === 1` with no override.
 * - In `'feasibility'` mode, all feasible candidates are returned sorted by `candidateKey` with no limit.
 */
export type EnumerateCandidatesOptions =
  | {
      readonly mode?: 'snapshot';
      readonly turnKind: TurnKind;
      readonly roundNo: number;
      readonly limit?: number;
      readonly excludedCandidateKeys?: readonly string[];
      readonly baseCandidateKey?: string | null;
      readonly mustInclude?: readonly string[];
    }
  | {
      readonly mode: 'feasibility';
      readonly excludedCandidateKeys?: readonly string[];
    };

/**
 * Ordered candidate snapshot entry (canon D10, 05 §5.7.1).
 */
export type CandidateSnapshotEntry = SnapshotItem;

/**
 * Return type of `enumerateCandidates(scenario, view, options)` per 06 §10.
 */
export interface CandidateSnapshotResult {
  readonly items: SnapshotItem[];
  readonly materialized: Materialized[];
  readonly emptyReasons: ReasonCode[];
}

/**
 * Structured outcome of resolving an `optionKey` against a turn's `candidateSnapshot` (05 §5.6.2, §5.7.3).
 */
export type ResolveOptionKeyResult =
  | {
      readonly ok: true;
      readonly entry: SnapshotItem;
      readonly candidateKey: string;
    }
  | {
      readonly ok: false;
      readonly code: 'action.option_not_in_snapshot' | 'action.repeats_blocked';
    };

/**
 * Structured outcome of resolving an `optionKey` from a snapshot and materializing it on the room's `localDate` (05 §5.7.3, D22).
 */
export type MaterializeOptionResult =
  | {
      readonly ok: true;
      readonly snapshotEntry: SnapshotItem;
      readonly materialized: Materialized;
      readonly evaluation?: Evaluation;
      readonly deliveryDateShifted: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'action.option_not_in_snapshot'
        | 'action.repeats_blocked'
        | 'amount.claim_mismatch'
        | 'amount.out_of_range';
    };

/**
 * Input to `stubDecide` (06 §12.1 member 13, 14 §6.3, `core/engine/plugin.ts`).
 */
export interface StubDecideInput {
  readonly role: Role | string;
  readonly turnKind: TurnKind;
  readonly snapshot: readonly SnapshotItem[];
  readonly currentProposal?: {
    readonly version: number;
    readonly candidateKey: string;
    readonly itemKeys: readonly string[];
    readonly passesInMyView: boolean;
  } | null;
  readonly ownSoft?: Readonly<Record<string, unknown>>;
  readonly sharedSoft?: Readonly<Record<string, unknown>>;
  readonly allowedActions?: readonly AgentAction[];
  /** Optional explicit canary flag (also auto-detected when `ownSoft.notes` contains a `CANARY-` token). */
  readonly canary?: boolean;
}
