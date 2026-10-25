import { describe, expect, expectTypeOf, test } from "vitest";
import schema, { eventPayloadV } from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
import * as states from "../../core/engine/stateMachines";
import * as validators from "../../convex/lib/validators";
import { CONTRACT } from "./contract";

// Canon §1.1, plus the internal tables explicitly required by 03 §§3.7, 3.8.
const TABLES = ["rooms", "users", "members", "invites", "briefs", "sharedFacts",
  "catalogItems", "ledgerEntries", "proposals", "approvals", "humanRequests", "runs",
  "turns", "attempts", "executions", "changeOrders", "tasks", "events", "opsFlags",
  "spendCounters", "constraintRevisions", "rawOutputs"] as const;

const statuses = [
  ["rooms", "status", validators.roomStatusV, states.ROOM_STATUSES],
  ["runs", "status", validators.runStatusV, states.RUN_STATUSES],
  ["turns", "status", validators.turnStatusV, states.TURN_STATUSES],
  ["attempts", "status", validators.attemptStatusV, states.ATTEMPT_STATUSES],
  ["proposals", "status", validators.proposalStatusV, states.PROPOSAL_STATUSES],
  ["approvals", "decision", validators.decisionV, states.APPROVAL_DECISION_STATUSES],
  ["humanRequests", "status", validators.humanRequestStatusV, states.HUMAN_REQUEST_STATUSES],
  ["catalogItems", "status", validators.catalogItemStatusV, states.CATALOG_ITEM_STATUSES],
  ["tasks", "status", validators.taskStatusV, states.TASK_STATUSES],
] as const;

describe("schema v1 contract", () => {
  test("table names exactly match canon and 03 internal tables", () => {
    expect(Object.keys(schema.tables).sort()).toEqual([...TABLES].sort());
    expect(Object.keys(CONTRACT).sort()).toEqual([...TABLES].sort());
  });
  test.each(TABLES)("03 %s fields and indexes", (name) => {
    const table = schema.tables[name];
    expect(Object.keys(table.validator.fields).sort()).toEqual([...CONTRACT[name].fields].sort());
    expect(Object.fromEntries(table[" indexes"]().map(({ indexDescriptor, fields }) =>
      [indexDescriptor, fields]))).toEqual(CONTRACT[name].indexes);
  });
  test.each(statuses)("%s.%s uses engine-derived validator", (table, field, validator, values) => {
    const fields = schema.tables[table].validator.fields;
    expect(Reflect.get(fields, field)).toBe(validator);
    expect(validator.members.map((member) => member.value)).toEqual([...values]);
  });
  test("stored status types equal engine types in both directions", () => {
    expectTypeOf<Doc<"rooms">["status"]>().toEqualTypeOf<states.RoomStatus>();
    expectTypeOf<Doc<"runs">["status"]>().toEqualTypeOf<states.RunStatus>();
    expectTypeOf<Doc<"turns">["status"]>().toEqualTypeOf<states.TurnStatus>();
    expectTypeOf<Doc<"attempts">["status"]>().toEqualTypeOf<states.AttemptStatus>();
    expectTypeOf<Doc<"proposals">["status"]>().toEqualTypeOf<states.ProposalStatus>();
    expectTypeOf<Doc<"approvals">["decision"]>().toEqualTypeOf<states.ApprovalDecision>();
    expectTypeOf<Doc<"humanRequests">["status"]>().toEqualTypeOf<states.HumanRequestStatus>();
    expectTypeOf<Doc<"catalogItems">["status"]>().toEqualTypeOf<states.CatalogItemStatus>();
    expectTypeOf<Doc<"tasks">["status"]>().toEqualTypeOf<states.TaskStatus>();
  });
});

test("event catalog matches 03 §3.11.1", () => {
  expect(eventPayloadV.members.map((member) => member.fields.type.value).sort()).toEqual([
    "room_created", "member_joined", "invite_created", "room_opened", "brief_confirmed", "brief_soft_updated",
    "baseline_recorded", "catalog_item_confirmed", "catalog_item_retired", "disclosure_changed",
    "constraints_changed", "run_started", "run_awaiting_approval", "run_needs_input",
    "human_request_opened", "human_request_answered", "run_renegotiation_requested",
    "human_request_closed", "run_resumed", "run_ended", "turn_scheduled", "turn_completed",
    "turn_failed", "turn_rejected_stale", "proposal_created", "proposal_status_changed",
    "reapproval_required", "approval_recorded", "room_executed", "task_completed",
    "room_closed", "follow_up_started", "pii_redacted",
  ].sort());
});
