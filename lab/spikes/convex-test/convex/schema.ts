import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roomStatus = v.union(
  v.literal("draft"),
  v.literal("negotiating"),
  v.literal("executed"),
);

export const approvalDecision = v.union(v.literal("approve"), v.literal("reject"));

export const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);

// Discriminated union, as recommended in convex/values validator docs.
export const agentMessageBody = v.union(
  v.object({ kind: v.literal("propose"), priceCents: v.number() }),
  v.object({ kind: v.literal("clarify"), question: v.string() }),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  rooms: defineTable({
    title: v.string(),
    status: roomStatus,
    constraintVersion: v.number(),
    ownerId: v.id("users"),
    // optional: field may be absent
    note: v.optional(v.string()),
    // nullable: field must be present, value may be null
    archivedAt: v.union(v.number(), v.null()),
  }),

  proposals: defineTable({
    roomId: v.id("rooms"),
    version: v.number(),
    constraintVersion: v.number(),
    terms: v.object({
      priceCents: v.number(),
      scopeItemIds: v.array(v.string()),
      dueDate: v.string(),
    }),
  }).index("by_roomId_and_version", ["roomId", "version"]),

  // Uniqueness of (proposalId, userId) is enforced only by the single write
  // entry point approvals.setApproval (Convex indexes are not unique).
  approvals: defineTable({
    proposalId: v.id("proposals"),
    userId: v.id("users"),
    decision: approvalDecision,
    constraintVersion: v.number(),
    revision: v.number(),
  }).index("by_proposal_user", ["proposalId", "userId"]),

  // Uniqueness of operationId is enforced only by execution.executeProposal.
  executions: defineTable({
    operationId: v.string(),
    proposalId: v.id("proposals"),
    executedBy: v.id("users"),
  }).index("by_operationId", ["operationId"]),

  commitments: defineTable({
    executionId: v.id("executions"),
    amountCents: v.number(),
  }).index("by_executionId", ["executionId"]),

  runs: defineTable({
    roomId: v.id("rooms"),
    status: runStatus,
    attempt: v.number(),
    actorUserId: v.id("users"),
    output: v.optional(v.string()),
    // What ctx.auth.getUserIdentity() returned inside the scheduled function.
    observedIdentity: v.optional(v.union(v.string(), v.null())),
  }),

  events: defineTable({
    kind: v.string(),
    roomId: v.optional(v.id("rooms")),
    payload: v.optional(v.any()),
  }).index("by_kind", ["kind"]),

  agentMessages: defineTable({
    roomId: v.id("rooms"),
    body: agentMessageBody,
  }),

  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),
});
