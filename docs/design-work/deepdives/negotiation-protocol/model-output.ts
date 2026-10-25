// packages/engine/src/protocol/model-output.ts
// Zod 4 schemas for what the MODEL is allowed to say. Nothing here carries
// identity, versions, ids, or money. Envelope fields live in envelope.ts.
// Design reference: deepdives/negotiation-protocol.md §3.2
import { z } from "zod/v4";

export const AGENT_ROLES = ["customer", "provider", "finance"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ACTIONS = [
  "propose",
  "counter",
  "clarify",
  "recommend_accept",
  "reject",
  "request_tradeoff",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const TURN_KINDS = ["draft", "evaluate", "revise"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

// Coarse, preference-level objections the model may raise. Hard-rule failures
// (OVER_BUDGET, MISSING_REQUIRED_ITEM, DATE_CONFLICT, UNKNOWN_ITEM ...) are
// produced by the rules engine (06), never by the model.
export const OBJECTION_CODES = [
  "SCOPE_INSUFFICIENT", // wants more of the deferrable/should items
  "DELIVERY_TOO_LATE", // soft date preference unmet (hard deadline is code's job)
  "PRICE_POOR_VALUE", // value judgement, not a budget-cap claim
  "TERM_UNACCEPTABLE", // e.g. rush fee
  "CAPACITY_CONFLICT", // provider only: cannot staff this option
  "OTHER",
] as const;
export type ObjectionCode = (typeof OBJECTION_CODES)[number];

export const TRADEOFF_AXES = ["scope_vs_date", "scope_vs_cost", "date_vs_cost"] as const;

export const RATIONALE_MAX = 1200; // chars; NOT enforced by decoding (see §3.6)

/**
 * Per-turn vocabulary. When `strictEnums` is true the factory emits z.enum(...)
 * for keys so our own JSON-schema transform can keep `enum` in the request.
 * The post-parse validator always uses the loose variant (plain strings) and
 * then checks membership against the turn snapshot, so a schema/snapshot
 * mismatch is reported as a semantic error with a precise code.
 */
export type MoveSchemaSpec = {
  allowedActions: readonly AgentAction[]; // from allowedActions(role, turnKind)
  optionKeys: readonly string[]; // positional labels "O1".."On" of this turn's candidates
  clarifyTargets: readonly AgentRole[]; // other roles only
  itemKeys: readonly string[]; // room catalog keys (confirmed)
  termIds: readonly string[]; // confirmed term ids, e.g. "RUSH"
  strictEnums: boolean;
};

function keyOf(values: readonly string[], strict: boolean) {
  if (strict && values.length > 0) return z.enum(values as [string, ...string[]]);
  return z.string().min(1).max(64);
}

const rationale = z
  .string()
  .min(1)
  .max(RATIONALE_MAX)
  .describe(
    "Short note for YOUR OWN principal only (max 3 sentences). Never shown to other parties. Do not restate private numbers unless needed.",
  );

export function buildMoveSchema(spec: MoveSchemaSpec) {
  const S = spec.strictEnums;
  const optionKey = keyOf(spec.optionKeys, S).describe("One optionKey from <candidates>.");
  const itemKey = keyOf(spec.itemKeys, S);
  const termId = keyOf(spec.termIds, S);
  const role = keyOf(spec.clarifyTargets, S);

  const clarifyQuestion = z.discriminatedUnion("topic", [
    z.strictObject({ topic: z.literal("item_required"), itemKeys: z.array(itemKey).min(1).max(5) }),
    z.strictObject({ topic: z.literal("date_acceptable"), deliveryDate: z.iso.date() }),
    z.strictObject({ topic: z.literal("term_acceptable"), termIds: z.array(termId).min(1).max(3) }),
    z.strictObject({ topic: z.literal("option_fits_constraints"), optionKey }),
  ]);

  const variants = {
    propose: z.strictObject({ action: z.literal("propose"), optionKey, rationale }),
    counter: z.strictObject({ action: z.literal("counter"), optionKey, rationale }),
    clarify: z.strictObject({
      action: z.literal("clarify"),
      targetRole: role,
      question: clarifyQuestion,
      rationale,
    }),
    recommend_accept: z.strictObject({ action: z.literal("recommend_accept"), rationale }),
    reject: z.strictObject({
      action: z.literal("reject"),
      objection: z.enum(OBJECTION_CODES),
      rationale,
    }),
    request_tradeoff: z.strictObject({
      action: z.literal("request_tradeoff"),
      axis: z.enum(TRADEOFF_AXES),
      optionKeys: z.array(optionKey).min(2).max(3),
      rationale,
    }),
  } as const;

  const chosen = spec.allowedActions.map((a) => variants[a]);
  if (chosen.length === 0) throw new Error("allowedActions must be non-empty");
  const move =
    chosen.length === 1
      ? chosen[0]
      : z.discriminatedUnion("action", chosen as unknown as [typeof variants.propose, ...(typeof variants.propose)[]]);
  // Root is an object, never a bare anyOf (root-anyOf acceptance is unverified).
  return z.strictObject({ move });
}

// Static, loose schema used for post-parse validation and for typing.
export const LOOSE_SPEC: MoveSchemaSpec = {
  allowedActions: AGENT_ACTIONS,
  optionKeys: [],
  clarifyTargets: [],
  itemKeys: [],
  termIds: [],
  strictEnums: false,
};
export const AgentModelOutput = buildMoveSchema(LOOSE_SPEC);
export type AgentModelOutput = z.infer<typeof AgentModelOutput>;
export type AgentMove = AgentModelOutput["move"];

// ---------------------------------------------------------------------------
// Which actions each role may take in each turn kind (code constant, §3.4).
export const ALLOWED_ACTIONS: Record<AgentRole, Partial<Record<TurnKind, readonly AgentAction[]>>> = {
  provider: {
    draft: ["propose", "clarify", "reject"],
    revise: ["propose", "clarify", "reject", "request_tradeoff"],
  },
  customer: {
    evaluate: ["recommend_accept", "counter", "reject", "clarify", "request_tradeoff"],
  },
  finance: {
    evaluate: ["recommend_accept", "reject", "clarify", "request_tradeoff"],
  },
};

export function allowedActions(role: AgentRole, kind: TurnKind): readonly AgentAction[] {
  const a = ALLOWED_ACTIONS[role][kind];
  if (!a) throw new Error(`role ${role} has no ${kind} turn`);
  return a;
}
