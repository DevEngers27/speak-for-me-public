import type { Cents } from '../money';
import type { IsoDate } from '../dates';
import type { ReasonCode, ReasonParams } from '../reasonCodes';
export type RoleKey = string;
export type ItemKey = string;
export type CatalogTitle = string;
export type Terms = { itemKeys: ItemKey[]; modifiers: ItemKey[]; deliveryDate: IsoDate; amountCents: Cents };
export type Line = { itemKey: ItemKey; revision: number; title: CatalogTitle; priceCents: Cents; leadDays: number };
export type CatalogRow = Line & { kind: 'item' | 'modifier'; status: 'confirmed' | 'retired'; taskTemplates: readonly { title: CatalogTitle; assigneeRole: RoleKey }[]; provenance: 'live' | 'seeded' | 'stub' };
export type RuleInputBase = { localDate: IsoDate; catalog: readonly CatalogRow[]; capCents: Cents | undefined; committedCents: Cents | undefined; headroomCents: number | undefined };
export type View<RI extends RuleInputBase> = Readonly<RI> & { readonly viewer: RoleKey | 'system' };
export type ProposalLike = { terms: Terms; lines: readonly Line[] };
export type CheckOutcome = { ok: true; params?: ReasonParams } | { ok: false; code: ReasonCode; params?: ReasonParams } | { unknown: true };
export type CheckCtx<RI extends RuleInputBase> = { input: View<RI>; proposal: ProposalLike; terms: Terms; lines: readonly Line[] };
export type CheckDecl<RI extends RuleInputBase> = { checkId: string; owner: RoleKey | null; requires: readonly (readonly string[])[]; dependsOn: readonly string[]; run(ctx: CheckCtx<RI>): CheckOutcome };
export type CheckResult = { checkId: string; owner: RoleKey | null; status: 'pass' | 'fail' | 'not_evaluated' | 'unknown'; code: ReasonCode | null; params: ReasonParams };
export type Evaluation = { terms: Terms | null; checks: CheckResult[]; blocking: ReasonCode[]; passesChecks: boolean; amounts: { amountCents: Cents; capCents?: Cents; committedCents?: Cents; committedAfterCents?: Cents; headroomCents?: number; overByCents?: Cents }; provenance: { seededCatalog: boolean; seededLedger: boolean } };
export type CandidateDraft = { itemKeys: ItemKey[]; modifiers: ItemKey[] };
export type Materialized = ProposalLike & { candidateKey: string; termsKey: string; lines: Line[]; plannedTasks: { itemKey: ItemKey; templateIndex: number; title: CatalogTitle; assigneeRole: RoleKey; dueDate: IsoDate }[] };
export type SnapshotItem = CandidateDraft & { optionKey: string; candidateKey: string; amountCents: Cents; deliveryDate: IsoDate };
export type HumanRequestKind = 'infeasible' | 'rounds_exhausted' | 'agent_escalated' | 'clarify' | 'agent_failed';
export type Effect = { kind: 'pass_to_next'; toRole: RoleKey } | { kind: 'raise_cap'; amountCents: Cents } | { kind: 'drop_items'; itemKeys: ItemKey[] } | { kind: 'extend_deadline'; date: IsoDate } | { kind: 'choose_candidate'; candidateKey: string } | { kind: 'disclose'; field: string; toRoles: RoleKey[] } | { kind: 'retry_turn' | 'keep_as_is' | 'end_run' };
export type RequestOption = { optionKey: string; templateKey: string; effect: Effect; shown: { itemKeys?: ItemKey[]; modifiers?: ItemKey[]; amountCents?: Cents; deliveryDate?: IsoDate; deltaCents?: Cents } };
export class PluginContractError extends Error {}
export class IntegrityError extends Error {}
