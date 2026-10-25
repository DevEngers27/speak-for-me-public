import type { Infer } from "convex/values";
import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
  ESCALATE_KINDS,
  type EscalateKind,
  MODEL_ACTIONS,
  type ModelAction,
  ROLES,
  type Role,
  TURN_KINDS,
  type TurnKind,
} from "../../core/engine/actions";
import { REASON_CODES, type ReasonCode } from "../../core/engine/reasonCodes";
import {
  APPROVAL_DECISION_STATUSES,
  type ApprovalDecision,
  ATTEMPT_STATUSES,
  type AttemptStatus,
  CATALOG_ITEM_STATUSES,
  type CatalogItemStatus,
  HUMAN_REQUEST_STATUSES,
  type HumanRequestStatus,
  PROPOSAL_STATUSES,
  type ProposalStatus,
  ROOM_STATUSES,
  type RoomStatus,
  RUN_STATUSES,
  type RunStatus,
  TASK_STATUSES,
  type TaskStatus,
  TURN_STATUSES,
  type TurnStatus,
} from "../../core/engine/stateMachines";
import {
  apiSubsetViolations,
  countConstraintKeywords,
  toStrictOutputSchema,
} from "../../core/engine/strictSchema";
import {
  VALIDATOR_TYPE_ASSERTIONS,
  agentActionV,
  approvalDecisionV,
  attemptStatusV,
  catalogItemStatusV,
  catalogStatusV,
  decisionV,
  escalateKindV,
  humanRequestStatusV,
  modelActionV,
  proposalStatusV,
  reasonCodeV,
  requestStatusV,
  roleV,
  roomStatusV,
  runStatusV,
  taskStatusV,
  turnKindV,
  turnStatusV,
  vReasonCode,
} from "./validators";

function extractUnionLiterals(validator: { members: Array<{ value: unknown }> }): unknown[] {
  return validator.members.map((m) => m.value);
}

describe("convex/lib/validators", () => {
  test("every validator's runtime literal members match the canonical core/engine arrays (SM-02, SC-T2)", () => {
    expect(extractUnionLiterals(reasonCodeV)).toEqual([...REASON_CODES]);
    expect(vReasonCode).toBe(reasonCodeV);

    expect(extractUnionLiterals(roomStatusV)).toEqual([...ROOM_STATUSES]);
    expect(extractUnionLiterals(runStatusV)).toEqual([...RUN_STATUSES]);
    expect(extractUnionLiterals(turnStatusV)).toEqual([...TURN_STATUSES]);
    expect(extractUnionLiterals(attemptStatusV)).toEqual([...ATTEMPT_STATUSES]);
    expect(extractUnionLiterals(proposalStatusV)).toEqual([...PROPOSAL_STATUSES]);

    expect(extractUnionLiterals(approvalDecisionV)).toEqual([...APPROVAL_DECISION_STATUSES]);
    expect(decisionV).toBe(approvalDecisionV);

    expect(extractUnionLiterals(humanRequestStatusV)).toEqual([...HUMAN_REQUEST_STATUSES]);
    expect(requestStatusV).toBe(humanRequestStatusV);

    expect(extractUnionLiterals(catalogItemStatusV)).toEqual([...CATALOG_ITEM_STATUSES]);
    expect(catalogStatusV).toBe(catalogItemStatusV);

    expect(extractUnionLiterals(taskStatusV)).toEqual([...TASK_STATUSES]);

    expect(extractUnionLiterals(roleV)).toEqual([...ROLES]);
    expect(extractUnionLiterals(turnKindV)).toEqual([...TURN_KINDS]);
    expect(extractUnionLiterals(modelActionV)).toEqual([...MODEL_ACTIONS]);
    expect(agentActionV).toBe(modelActionV);
    expect(extractUnionLiterals(escalateKindV)).toEqual([...ESCALATE_KINDS]);
  });

  test("bidirectional type equality holds for every validator (SC-T2)", () => {
    expect(VALIDATOR_TYPE_ASSERTIONS.every(Boolean)).toBe(true);

    expectTypeOf<Infer<typeof reasonCodeV>>().toEqualTypeOf<ReasonCode>();
    expectTypeOf<Infer<typeof roomStatusV>>().toEqualTypeOf<RoomStatus>();
    expectTypeOf<Infer<typeof runStatusV>>().toEqualTypeOf<RunStatus>();
    expectTypeOf<Infer<typeof turnStatusV>>().toEqualTypeOf<TurnStatus>();
    expectTypeOf<Infer<typeof attemptStatusV>>().toEqualTypeOf<AttemptStatus>();
    expectTypeOf<Infer<typeof proposalStatusV>>().toEqualTypeOf<ProposalStatus>();
    expectTypeOf<Infer<typeof approvalDecisionV>>().toEqualTypeOf<ApprovalDecision>();
    expectTypeOf<Infer<typeof humanRequestStatusV>>().toEqualTypeOf<HumanRequestStatus>();
    expectTypeOf<Infer<typeof catalogItemStatusV>>().toEqualTypeOf<CatalogItemStatus>();
    expectTypeOf<Infer<typeof taskStatusV>>().toEqualTypeOf<TaskStatus>();
    expectTypeOf<Infer<typeof roleV>>().toEqualTypeOf<Role>();
    expectTypeOf<Infer<typeof turnKindV>>().toEqualTypeOf<TurnKind>();
    expectTypeOf<Infer<typeof modelActionV>>().toEqualTypeOf<ModelAction>();
    expectTypeOf<Infer<typeof escalateKindV>>().toEqualTypeOf<EscalateKind>();
  });

  test("Convex boundary z.toJSONSchema -> toStrictOutputSchema integration (D09)", () => {
    const turnZod = z.strictObject({
      turn: z.discriminatedUnion("action", [
        z.strictObject({
          action: z.literal("propose"),
          optionKey: z.enum(["O1", "O2"]),
          rationale: z.string().min(1).max(1200),
        }),
        z.strictObject({
          action: z.literal("counter"),
          optionKey: z.enum(["O1", "O2"]),
          baseProposalVersion: z.int().min(1).max(1_000_000),
          rationale: z.string().min(1).max(1200),
        }),
        z.strictObject({
          action: z.literal("clarify"),
          toRole: z.enum(ROLES),
          topicKey: z.enum(["budget_cap", "scope_priority"]),
          rationale: z.string().min(1).max(1200),
        }),
        z.strictObject({
          action: z.literal("recommend_accept"),
          proposalVersion: z.int().min(1).max(1_000_000),
          rationale: z.string().min(1).max(1200),
        }),
        z.strictObject({
          action: z.literal("reject"),
          proposalVersion: z.int().min(1).max(1_000_000).nullable(),
          reasonKey: z.enum(["scope_insufficient", "delivery_too_late", "price_poor_value", "other"]),
          rationale: z.string().min(1).max(1200),
        }),
        z.strictObject({
          action: z.literal("escalate"),
          kind: z.enum(ESCALATE_KINDS),
          toRole: z.enum(ROLES),
          rationale: z.string().min(1).max(1200),
        }),
      ]),
    });

    const rawJsonSchema = z.toJSONSchema(turnZod, {
      target: "draft-2020-12",
      reused: "inline",
      unrepresentable: "throw",
    });

    const strict = toStrictOutputSchema(rawJsonSchema);
    expect(strict.type).toBe("object");
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(["turn"]);
    expect(strict.properties.turn.oneOf).toBeUndefined();
    expect(Array.isArray(strict.properties.turn.anyOf)).toBe(true);
    expect(countConstraintKeywords(strict)).toEqual({ enum: 7, const: 6 });
    expect(apiSubsetViolations(strict)).toEqual([]);
  });
});
