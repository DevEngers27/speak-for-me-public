// Model-output schema for one negotiation turn (what the model returns).
// The server envelope (roomId, runId, agentId, constraintVersion, ...) is NOT here:
// it is attached by deterministic code. No amount/price/currency fields by design:
// prices are derived from the scenario catalog by the rules engine.
import { z } from "zod";

export const PARTY_ROLES = ["customer", "provider", "finance"] as const;
export const PartyRole = z.enum(PARTY_ROLES);

/** Opaque id issued by the server (catalog item, proposal, fact). */
export const RefId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)
  .describe("Server-issued id copied verbatim from context. Never invent ids.");

export const SourceRef = z.strictObject({
  kind: z.enum(["brief_fact", "shared_fact", "catalog_item", "proposal", "constraint"]),
  refId: RefId,
});

/** Proposed terms. Prices are computed by code from scopeItemIds; never by the model. */
export const Terms = z.strictObject({
  scopeItemIds: z.array(RefId).min(1).max(20).describe("Catalog item ids included in scope."),
  deliveryDate: z.iso.date().describe("Proposed delivery date, YYYY-MM-DD."),
});

const PublicRationale = z
  .string()
  .min(1)
  .max(600)
  .describe("Shown to other parties only after the disclosure check. Do not quote private numbers.");

const NoteToPrincipal = z
  .string()
  .max(800)
  .nullable()
  .describe("Private note for your own principal only; null if none.");

export const ProposeAction = z.strictObject({
  action: z.literal("propose"),
  terms: Terms,
  publicRationale: PublicRationale,
  sourceRefs: z.array(SourceRef).min(1).max(12),
  noteToPrincipal: NoteToPrincipal,
});

export const CounterAction = z.strictObject({
  action: z.literal("counter"),
  baseProposalId: RefId,
  terms: Terms,
  publicRationale: PublicRationale,
  sourceRefs: z.array(SourceRef).min(1).max(12),
  noteToPrincipal: NoteToPrincipal,
});

export const ClarifyAction = z.strictObject({
  action: z.literal("clarify"),
  addressee: PartyRole,
  questions: z
    .array(
      z.strictObject({
        topic: z.enum(["scope", "delivery_date", "budget", "priority", "other"]),
        question: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(3),
  noteToPrincipal: NoteToPrincipal,
});

export const RecommendAcceptAction = z.strictObject({
  action: z.literal("recommend_accept"),
  proposalId: RefId,
  publicRationale: PublicRationale,
  noteToPrincipal: NoteToPrincipal,
});

export const REJECT_REASON_CODES = [
  "violates_hard_constraint",
  "missing_required_scope",
  "date_infeasible",
  "insufficient_information",
  "other",
] as const;

export const RejectAction = z.strictObject({
  action: z.literal("reject"),
  proposalId: RefId,
  reasonCode: z.enum(REJECT_REASON_CODES),
  publicRationale: PublicRationale,
  noteToPrincipal: NoteToPrincipal,
});

export const RequestTradeoffAction = z.strictObject({
  action: z.literal("request_tradeoff"),
  addressee: PartyRole,
  question: z.string().min(1).max(400),
  options: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(80),
        terms: Terms,
        consequence: z.string().min(1).max(300),
      }),
    )
    .min(2)
    .max(3),
  noteToPrincipal: NoteToPrincipal,
});

/** Root-level discriminated union (JSON Schema root becomes anyOf). */
export const ModelTurnOutput = z.discriminatedUnion("action", [
  ProposeAction,
  CounterAction,
  ClarifyAction,
  RecommendAcceptAction,
  RejectAction,
  RequestTradeoffAction,
]);
export type ModelTurnOutput = z.infer<typeof ModelTurnOutput>;
export type ModelAction = ModelTurnOutput["action"];

/** Same union wrapped so the JSON Schema root is `type: "object"`. */
export const ModelTurnEnvelope = z.strictObject({ turn: ModelTurnOutput });
export type ModelTurnEnvelope = z.infer<typeof ModelTurnEnvelope>;

/** Property names that must never appear in the model-output schema. */
export const FORBIDDEN_PROPERTY_PATTERN = /amount|price|cost|usd|cents|currency|total|fee/i;
