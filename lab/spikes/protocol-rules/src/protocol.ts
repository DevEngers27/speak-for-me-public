import { z } from "zod";
import { REASON_CODES } from "./reasonCodes.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = "sfm.protocol.v1" as const;

export const Role = z.enum(["customer", "provider", "finance"]);
export type Role = z.infer<typeof Role>;

/** Catalog item key: lower snake case slug, chosen by humans, never by the model. */
export const ItemKey = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);
export const IsoDate = z.iso.date(); // YYYY-MM-DD, real calendar day
export const Cents = z.int().nonnegative(); // integer cents, safe range enforced by z.int()
export const Version = z.int().min(1);

const PublicText = z.string().min(1).max(1000);

// ---------------------------------------------------------------------------
// AgentModelOutput: the ONLY shape the model is allowed to emit.
// Rules: no money, no ids it could forge, no roomId/runId/version of "self";
// it can only reference catalog item keys and proposal versions it was shown.
// ---------------------------------------------------------------------------

/** Scope selection the model may make. Prices and dates are derived by the server. */
const ScopeSelection = {
  includedItemKeys: z.array(ItemKey).min(1).max(32),
  /** null = "earliest feasible date derived from catalog". Must be a confirmed-info date or later. */
  deliveryDate: IsoDate.nullable(),
};

export const AgentRejectReason = z.enum([
  "violates_my_hard_constraint",
  "missing_required_scope",
  "unacceptable_date",
  "unacceptable_price",
  "other",
]);

export const ProposeOutput = z.strictObject({
  action: z.literal("propose"),
  ...ScopeSelection,
  publicRationale: PublicText,
});

export const CounterOutput = z.strictObject({
  action: z.literal("counter"),
  baseProposalVersion: Version,
  ...ScopeSelection,
  publicRationale: PublicText,
});

export const ClarifyOutput = z.strictObject({
  action: z.literal("clarify"),
  toRole: Role,
  topic: z.enum(["scope", "date", "budget", "terms", "other"]),
  question: PublicText,
});

export const RecommendAcceptOutput = z.strictObject({
  action: z.literal("recommend_accept"),
  /** Must equal the current proposal version; checked by the server, not trusted. */
  proposalVersion: Version,
  publicRationale: PublicText,
});

export const RejectOutput = z.strictObject({
  action: z.literal("reject"),
  proposalVersion: Version,
  reason: AgentRejectReason,
  publicRationale: PublicText,
});

/** Agent asks a specific human for a trade-off, or declares no option fits. */
export const EscalateOutput = z.strictObject({
  action: z.literal("escalate"),
  kind: z.enum(["infeasible", "needs_tradeoff"]),
  toRole: Role,
  question: PublicText,
  /** Candidate options as scope selections only; server prices them. */
  options: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(120),
        includedItemKeys: z.array(ItemKey).min(1).max(32),
      }),
    )
    .max(4),
});

export const AgentModelOutput = z.discriminatedUnion("action", [
  ProposeOutput,
  CounterOutput,
  ClarifyOutput,
  RecommendAcceptOutput,
  RejectOutput,
  EscalateOutput,
]);
export type AgentModelOutput = z.infer<typeof AgentModelOutput>;
export type AgentAction = AgentModelOutput["action"];

/**
 * Root wrapper for structured output. jsonSchemaOutputFormat requires a root
 * `type: "object"`, and root-level anyOf acceptance by the API is unverified,
 * so the model emits { turn: <union> }.
 */
export const AgentModelOutputRoot = z.strictObject({ turn: AgentModelOutput });
export type AgentModelOutputRoot = z.infer<typeof AgentModelOutputRoot>;

// ---------------------------------------------------------------------------
// AgentEnvelope: built by the SERVER around a validated model output.
// Every field here comes from server state, never from the model.
// ---------------------------------------------------------------------------

export const OutputSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("model"), model: z.string().min(1), isSimulated: z.literal(false) }),
  z.strictObject({ kind: z.literal("stub"), stubName: z.string().min(1), isSimulated: z.literal(true) }),
  z.strictObject({ kind: z.literal("fixture"), fixtureName: z.string().min(1), isSimulated: z.literal(true) }),
]);
export type OutputSource = z.infer<typeof OutputSource>;

export const AgentEnvelope = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  envelopeId: z.string().min(1),
  roomId: z.string().min(1),
  runId: z.string().min(1),
  /** 0-based position of this turn inside the run. */
  turnIndex: z.int().nonnegative(),
  /** 1-based full round number; a round = each active party took one turn. */
  round: z.int().min(1),
  fromParticipantId: z.string().min(1),
  fromRole: Role,
  constraintsVersion: Version,
  catalogVersion: Version,
  /** Current proposal version the agent saw when it produced this turn (null = none yet). */
  observedProposalVersion: Version.nullable(),
  createdAt: z.int().nonnegative(),
  source: OutputSource,
  output: AgentModelOutput,
});
export type AgentEnvelope = z.infer<typeof AgentEnvelope>;

// ---------------------------------------------------------------------------
// Scenario data (scope_change): catalog (provider, confirmed) + constraints.
// ---------------------------------------------------------------------------

export const CatalogItem = z.strictObject({
  itemKey: ItemKey,
  title: z.string().min(1),
  priceCents: Cents,
  earliestDeliveryDate: IsoDate,
  status: z.enum(["draft", "confirmed", "withdrawn"]),
  origin: z.enum(["manual", "extracted", "fixture"]),
  isSimulated: z.boolean(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const Catalog = z.strictObject({
  catalogVersion: Version,
  items: z.array(CatalogItem),
});
export type Catalog = z.infer<typeof Catalog>;

export const BudgetFacts = z.strictObject({
  totalBudgetCents: Cents,
  /** Derived from the commitment ledger, never a free counter. */
  committedCents: Cents,
});

export const ScopeChangeConstraints = z.strictObject({
  constraintsVersion: Version,
  requiredItemKeys: z.array(ItemKey),
  preferredItemKeys: z.array(ItemKey),
  hardDeadline: IsoDate,
  budget: BudgetFacts,
});
export type ScopeChangeConstraints = z.infer<typeof ScopeChangeConstraints>;

// ---------------------------------------------------------------------------
// ProposalTerms: derived by the server from catalog + selection. Immutable,
// hashed, and the thing humans approve.
// ---------------------------------------------------------------------------

export const ProposalLineItem = z.strictObject({
  itemKey: ItemKey,
  priceCents: Cents,
  earliestDeliveryDate: IsoDate,
});

export const ProposalTerms = z.strictObject({
  catalogVersion: Version,
  includedItemKeys: z.array(ItemKey).min(1), // sorted, unique
  deferredItemKeys: z.array(ItemKey), // catalog minus included, sorted
  lineItems: z.array(ProposalLineItem), // sorted by itemKey
  additionalCostCents: Cents, // sum(lineItems.priceCents)
  earliestDeliveryDate: IsoDate, // max(lineItems.earliestDeliveryDate)
  deliveryDate: IsoDate, // requested ?? earliest
});
export type ProposalTerms = z.infer<typeof ProposalTerms>;

export const RuleIssue = z.strictObject({
  reasonCode: z.enum(REASON_CODES),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
});
