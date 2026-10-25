// convex/lib/protocol.ts  (storage side: Convex validators only; Zod stays in model-output.ts)
// Envelope = server facts about a turn. Written ONLY by startTurn / retryTurn.
import { v, type Infer } from "convex/values";

export const agentRoleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));
export const turnKindV = v.union(v.literal("draft"), v.literal("evaluate"), v.literal("revise"));
export const agentModeV = v.union(v.literal("live"), v.literal("stub"), v.literal("replay"));

export const turnEnvelopeV = v.object({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  turnSeq: v.number(), // run.nextTurnSeq at creation; two evaluate turns get two seqs
  round: v.number(), // 1..run.maxRounds
  turnKind: turnKindV,
  sourceRole: agentRoleV, // derived from the schedule, never from the model
  baseProposalId: v.optional(v.id("proposals")), // proposal under evaluation (evaluate/revise)
  baseProposalVersion: v.number(), // room.proposalVersion at turn start (0 = none yet)
  constraintsVersion: v.number(), // room.constraintsVersion at turn start == run.constraintsVersionAtStart
  promptVersion: v.string(), // e.g. "proto-1.0/scope_change-1.0" — part of the cache key, no timestamps
  agentMode: agentModeV,
});
export type TurnEnvelope = Infer<typeof turnEnvelopeV>;

// Candidate snapshot: resolved terms for each positional optionKey, frozen at turn start.
export const candidateV = v.object({
  optionKey: v.string(), // "O1".."On"
  itemKeys: v.array(v.string()),
  deferredItemKeys: v.array(v.string()),
  termIds: v.array(v.string()),
  deliveryDate: v.string(), // YYYY-MM-DD
  amountCents: v.number(), // computed by the scenario pricing fn from confirmed catalog; assertCents
  termsKey: v.string(), // canonical "LOGIN+REPORTS|RUSH|2026-11-14"
  rank: v.number(), // plugin ranking, 0 = best by the plugin's objective
});

// Storage mirror of AgentMove (validated before insert). Kept in agentTurns.output.
const clarifyQuestionV = v.union(
  v.object({ topic: v.literal("item_required"), itemKeys: v.array(v.string()) }),
  v.object({ topic: v.literal("date_acceptable"), deliveryDate: v.string() }),
  v.object({ topic: v.literal("term_acceptable"), termIds: v.array(v.string()) }),
  v.object({ topic: v.literal("option_fits_constraints"), optionKey: v.string() }),
);
export const objectionV = v.union(
  v.literal("SCOPE_INSUFFICIENT"), v.literal("DELIVERY_TOO_LATE"), v.literal("PRICE_POOR_VALUE"),
  v.literal("TERM_UNACCEPTABLE"), v.literal("CAPACITY_CONFLICT"), v.literal("OTHER"),
);
export const agentMoveV = v.union(
  v.object({ action: v.literal("propose"), optionKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("counter"), optionKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("clarify"), targetRole: agentRoleV, question: clarifyQuestionV, rationale: v.string() }),
  v.object({ action: v.literal("recommend_accept"), rationale: v.string() }),
  v.object({ action: v.literal("reject"), objection: objectionV, rationale: v.string() }),
  v.object({
    action: v.literal("request_tradeoff"),
    axis: v.union(v.literal("scope_vs_date"), v.literal("scope_vs_cost"), v.literal("date_vs_cost")),
    optionKeys: v.array(v.string()),
    rationale: v.string(),
  }),
);

// What the agent action hands to completeTurn. Note: NO envelope fields.
export const agentDecisionV = v.union(
  v.object({
    kind: v.literal("ok"),
    move: agentMoveV,
    provenance: v.object({
      mode: agentModeV,
      model: v.optional(v.string()), // msg.model (actual model; may differ under fallback)
      attempts: v.number(), // HTTP-level logical attempts made inside this action
    }),
  }),
  v.object({
    kind: v.literal("failed"),
    errorCode: v.string(), // TurnErrorCode, see call-model.ts
    retryable: v.boolean(),
    provenance: v.object({ mode: agentModeV, model: v.optional(v.string()), attempts: v.number() }),
  }),
);

// Persistence guard used by completeTurn (round-based because evaluate turns run in parallel).
export type GuardInput = {
  turn: { status: string; attempt: number; round: number; runId: string; constraintsVersion: number; baseProposalVersion: number; turnKind: string };
  run: { _id: string; status: string; round: number };
  room: { currentRunId?: string; constraintsVersion: number; proposalVersion: number };
  attempt: number;
};
export function persistenceGuard(g: GuardInput): "ok" | "STALE_ATTEMPT" | "STALE_RUN" | "STALE_ROUND" | "STALE_CONSTRAINTS" | "STALE_PROPOSAL" {
  if (g.turn.status !== "running" || g.turn.attempt !== g.attempt) return "STALE_ATTEMPT";
  if (g.room.currentRunId !== g.turn.runId || g.run.status !== "negotiating") return "STALE_RUN";
  if (g.run.round !== g.turn.round) return "STALE_ROUND";
  if (g.room.constraintsVersion !== g.turn.constraintsVersion) return "STALE_CONSTRAINTS";
  if (g.turn.turnKind === "evaluate" && g.room.proposalVersion !== g.turn.baseProposalVersion) return "STALE_PROPOSAL";
  return "ok";
}
