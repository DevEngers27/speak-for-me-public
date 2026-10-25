// engine/contract/plugin.ts — the single contract between engine and a scenario.
// Every member is pure: no I/O, no clock (today is passed in), no randomness.
import type { z } from "zod";
import type {
  ApproverRequirement, BriefFieldSpec, BriefView, BudgetView, CatalogItemView, ChangeOrderSpec,
  Check, IsoDate, ItemKey, JsonValue, PriceBreakdown, ReasonCode, ReasonCodeSpec, RoleKey,
  SourceRef, TaskSpec, TradeoffOptionSpec, TradeoffRequestSpec, Cents,
} from "./contract";

/** Generic parameters:
 *  A = catalog attrs, B = union of brief data by role, C = derived constraints,
 *  D = model draft (output of draftTermsSchema), T = normalized immutable proposal terms. */
export interface ScenarioPlugin<A, B extends Record<RoleKey, unknown>, C, D, T> {
  // ---- identity & versioning ----
  key: string;                       // "scope_change"
  version: number;                   // contract version of this plugin code; pinned per room
  supportedVersions: number[];       // versions whose rooms this code can still evaluate
  label: string;
  currency: "USD";                   // v1: one currency per scenario/room

  // ---- participants ----
  roles: { [R in keyof B & string]: RoleSpec<B[R]> };

  // ---- catalog ----
  catalog: {
    ownerRole: RoleKey;              // only this role confirms/edits items (F07.4)
    attrsSchema: z.ZodType<A>;
    allowAgentSuggestions: boolean;  // agent may suggest draft items; owner must confirm (17 roadmap)
    maxItems: number;                // hard cap enforced at write; also bounds enumeration
  };

  // ---- budget (engine ledger) ----
  budget: { enabled: false } | {
    enabled: true;
    ownerRole: RoleKey;              // only role allowed to call updateBudget
    numbersVisibleTo: RoleKey[];     // buyer side (F07.1); others get reasonCode only
  };

  // ---- constraints ----
  deriveConstraints(input: ConstraintInput<A, B>): C;
  /** Only hard fields. Engine hashes canonicalJson(projection) to decide bumps (SP-D6). */
  hardConstraintProjection(c: C): JsonValue;

  // ---- model draft -> terms ----
  /** Selection-only fields. No amounts, versions, ids, roles (SP-I9). Use z.string() for keys. */
  draftTermsSchema: z.ZodType<D>;
  buildTerms(draft: D, ctx: EvalContext<A, C>): { ok: true; terms: T } | { ok: false; checks: Check[] };
  /** Engine derives SourceRef[] from this; model never supplies sourceRefs. */
  sourceItemKeys(terms: T): ItemKey[];
  /** The ONLY amount source. Reads confirmed catalog prices + plugin-declared confirmed terms. */
  priceTerms(terms: T, ctx: EvalContext<A, C>): PriceBreakdown;

  // ---- rules ----
  /** Scenario hard-constraint checks only. Engine checks (current, version, sources, amount,
   *  budget, approvers) are prepended by engine.evaluateProposal and cannot be suppressed. */
  validateProposal(terms: T, price: PriceBreakdown, ctx: EvalContext<A, C>): Check[];
  /** Feasible candidates by code (F06.5). Must be sound: every candidate passes full evaluation. */
  enumerateFeasible(ctx: EvalContext<A, C>, limits: EnumerationLimits): EnumerationResult<T>;
  /** Deterministic stand-in for an agent turn (stub mode, authorKind "rule"). */
  pickStub(candidates: T[], ctx: EvalContext<A, C>): T | null;
  /** Called when enumeration is empty, rounds are exhausted, or budget < committed. */
  buildTradeoffRequests(input: TradeoffInput<A, C, T>): TradeoffRequestSpec[];
  /** Validates an answered option against current constraints before engine applies its effect. */
  checkTradeoffAnswer(option: TradeoffOptionSpec, ctx: EvalContext<A, C>): { ok: true } | { ok: false; reasonCode: ReasonCode };

  // ---- approvals & execution ----
  requiredApprovers(terms: T, price: PriceBreakdown, c: C): ApproverRequirement[];
  deriveExecution(terms: T, price: PriceBreakdown, ctx: ExecutionContext<A, C>): { changeOrder: ChangeOrderSpec; tasks: TaskSpec[] };

  // ---- text ----
  reasonCodes: ReasonCodeSpec[];     // plugin codes; engine merges with its own, checks collisions
  templates: ScenarioTemplates<T>;
  agentInstructions: { [R in keyof B & string]?: string };   // static per-role prompt fragment

  // ---- fixtures ----
  fixtures: Record<string, ScenarioFixture<A, B>>;
  runtime: { maxRounds: number; timeZoneDefault: string };
}

export interface RoleSpec<BR> {
  label: string;
  side: "buyer" | "seller" | "neutral";
  seats: 1;                          // v1: exactly one user per role (Q13 deferred)
  agent: "llm" | "rule" | "none";
  briefSchema: z.ZodType<BR>;
  briefFields: { [F in keyof BR & string]: BriefFieldSpec };
  /** Which role's agent context gets which of this role's fields: own agent sees all;
   *  others see only fields the owner disclosed (sharedFields). Engine enforces; plugin cannot widen. */
  agentView?: (brief: BR) => JsonValue;   // optional reshaping for own agent; still pure
}

export interface ConstraintInput<A, B extends Record<RoleKey, unknown>> {
  briefs: { [R in keyof B & string]?: BriefView<B[R]> };   // confirmed revisions only
  catalog: CatalogItemView<A>[];                            // confirmed, not withdrawn
  budget: BudgetView | null;
  today: IsoDate;                                           // in room time zone, from engine
}

export interface EvalContext<A, C> {
  constraints: C;
  catalog: ReadonlyMap<ItemKey, CatalogItemView<A>>;        // confirmed snapshot
  budget: BudgetView | null;
  today: IsoDate;
}

export interface ExecutionContext<A, C> extends EvalContext<A, C> {
  sourceRefs: SourceRef[];
  executedOn: IsoDate;
}

export interface EnumerationLimits { maxCandidates: number; maxEvaluations: number }
export interface EnumerationResult<T> {
  candidates: T[];                   // sorted by plugin preference, deterministic tie-break
  exhaustive: boolean;               // false => "no candidate" must NOT be reported as infeasible
  blockersSeen: ReasonCode[];        // union of reason codes that excluded combinations
}

export interface TradeoffInput<A, C, T> {
  ctx: EvalContext<A, C>;
  blockers: Check[];                 // failing checks of the current proposal (may be empty)
  enumeration: EnumerationResult<T>;
  trigger: "no_feasible" | "rounds_exhausted" | "below_committed" | "proposal_rejected";
}

/** Template functions receive only structured params and the engine formatter. */
export interface ScenarioTemplates<T> {
  proposalSummary(terms: T, price: PriceBreakdown, audience: "buyer" | "seller" | "neutral",
                  f: import("./contract").Fmt): string;
  sharedFact(role: RoleKey, field: string, value: JsonValue, f: import("./contract").Fmt): string;
  tradeoffOption(option: TradeoffOptionSpec, f: import("./contract").Fmt): string;
  changeOrderTitle(terms: T, f: import("./contract").Fmt): string;
}

export interface ScenarioFixture<A, B extends Record<RoleKey, unknown>> {
  label: string;
  simulated: true;
  timeZone: string;
  /** Pure builder: all dates are addDays(today, n) so seeds never start in the past. */
  build(today: IsoDate): FixtureData<A, B>;
  variants: Record<"feasible" | "tradeoff" | "infeasible" | "below_committed" | string, FixtureVariant<B>>;
}
export interface FixtureData<A, B extends Record<RoleKey, unknown>> {
  catalog: Array<Omit<CatalogItemView<A>, "revision" | "status" | "origin" | "simulated">>;
  briefs: { [R in keyof B & string]: { data: B[R]; sharedFields: (keyof B[R] & string)[] } };
  budget?: { totalCents: Cents; baseline: Array<{ label: string; amountCents: Cents }> };
}
export interface FixtureVariant<B extends Record<RoleKey, unknown>> {
  description: string;
  budgetTotalCents?: Cents;                 // override for the twist
  briefPatches?: { [R in keyof B & string]?: Partial<B[R]> };
  expect: {
    feasibleItemSets: ItemKey[][];          // compared with enumerateFeasible (sorted keys)
    tradeoffTargetRoles?: RoleKey[];
    reasonCodesForInitialProposal?: ReasonCode[];
  };
}
