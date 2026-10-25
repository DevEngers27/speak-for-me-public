/** Independent executable §12.17 contracts for temporary query fixtures.
 * These validate the client seam; they do not claim backend privacy coverage.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@/lib/api";
import { buildRoomView, buildBriefQuery, buildCatalogQuery, buildExecution, buildTimeline, buildInboxCard } from "./fixtures";

const role = z.enum(["customer", "provider", "finance"]);
const provenance = z.enum(["live", "seeded", "stub"]);
const status = z.enum(["setup", "open", "executed", "closed"]);
const phase = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("setup"), gaps: z.array(z.strictObject({ gap: z.enum(["seat_vacant", "brief_unconfirmed", "brief_field_missing", "catalog_empty", "baseline_missing"]), ownerRole: role })) }),
  z.strictObject({ phase: z.literal("negotiating"), roundNo: z.number(), activeRole: role }),
  z.strictObject({ phase: z.literal("needs_input"), you: z.boolean(), waitingOn: role.optional() }),
  z.strictObject({ phase: z.literal("awaiting_approval"), proposalVersion: z.number(), pendingRoles: z.array(role), youPending: z.boolean() }),
  z.strictObject({ phase: z.literal("stopped"), reason: z.enum(["ended_no_agreement", "canceled"]) }),
  z.strictObject({ phase: z.literal("executed") }), z.strictObject({ phase: z.literal("closed") }),
]);
const terms = z.strictObject({ itemKeys: z.array(z.string()), modifiers: z.array(z.string()), deliveryDate: z.string(), amountCents: z.number() });
const line = z.strictObject({ itemKey: z.string(), kind: z.enum(["item", "modifier"]), title: z.string(), priceCents: z.number() });
const slot = z.strictObject({ role, kind: z.enum(["terms", "budget"]), displayName: z.string(), isMe: z.boolean(), state: z.enum(["pending", "approved", "rejected", "stale_approve", "stale_reject", "withdrawn"]), boundConstraintsVersion: z.number().nullable(), reasonKey: z.string().nullable() });
const fit = z.discriminatedUnion("audience", [z.strictObject({ audience: z.literal("provider"), value: z.enum(["ok", "blocked"]) }), z.strictObject({ audience: z.literal("buyer"), passesChecks: z.boolean(), checks: z.array(z.strictObject({ code: z.string(), owner: z.enum(["self", "other"]), text: z.string() })) })]);
const proposal = z.strictObject({ proposalId: z.string(), status: z.enum(["active", "stale", "superseded", "rejected", "executed"]).optional(), version: z.number(), termsKey: z.string(), origin: z.enum(["agent", "human_choice"]), provenance, createdAtConstraintsVersion: z.number(), terms, lines: z.array(line), summaryText: z.string(), diffFromPrevious: z.strictObject({ previousVersion: z.number(), changes: z.array(z.string()) }).nullable(), fit: fit.nullable(), notIncludedForMe: z.array(z.string()).nullable(), approvals: z.array(slot), allApproved: z.boolean(), myAction: z.strictObject({ canDecide: z.boolean(), kind: z.enum(["terms", "budget"]), disabledReasonCode: z.string().nullable(), current: z.enum(["approve", "reject", "withdraw"]).nullable(), completesSet: z.boolean(), canWithdraw: z.boolean() }), recordsPreview: z.strictObject({ changeOrderNumber: z.number(), taskCount: z.number(), myTaskTitles: z.array(z.string()), commitCents: z.number() }), myAgentSuggestion: z.strictObject({ action: z.enum(["recommend_accept", "reject", "counter"]), proposalVersion: z.number(), rationale: z.string(), isSimulated: z.boolean() }).nullable() });
const factValue = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("date"), date: z.string() }), z.strictObject({ kind: z.literal("itemKeys"), itemKeys: z.array(z.string()) }), z.strictObject({ kind: z.literal("cents"), cents: z.number() }), z.strictObject({ kind: z.literal("enum"), value: z.string() })]).nullable();
const fact = z.strictObject({ fromRole: role, field: z.enum(["deadline", "requiredItemKeys", "capCents", "committedCents", "headroomCents", "preferredItemKeys"]), value: factValue, asOfBriefVersion: z.number().nullable() });
const budget = z.discriminatedUnion("visibility", [z.strictObject({ visibility: z.literal("none") }), z.strictObject({ visibility: z.literal("customer"), capCents: z.number().nullable(), committedCents: z.number().nullable(), headroomCents: z.number().nullable() }), z.strictObject({ visibility: z.literal("finance"), capCents: z.number(), committedCents: z.number(), headroomCents: z.number(), baselineRecorded: z.boolean(), baselineSuggestionCents: z.number().nullable(), proposalCents: z.number().nullable(), totalAfterCents: z.number().nullable(), overByCents: z.number().nullable(), status: z.enum(["within", "over", "no_proposal"]) })]);
const catalog = z.strictObject({ itemKey: z.string(), kind: z.enum(["item", "modifier"]), title: z.string(), priceCents: z.number(), leadDays: z.number(), revision: z.number() });
const catalogRow = catalog.extend({ editNo: z.number(), status: z.enum(["draft", "confirmed", "retired"]), taskTemplates: z.array(z.strictObject({ title: z.string(), assigneeRole: role })) });
const shown = z.strictObject({ amountCents:z.number().optional(), deliveryDate:z.string().optional(), itemKeys:z.array(z.string()).optional(), modifiers:z.array(z.string()).optional(), deltaCents:z.number().optional() });
const option = z.strictObject({ optionKey: z.string(), text:z.string(), answerable:z.boolean(), type:z.enum(["choose_candidate","raise_cap","drop_items","extend_deadline","keep_as_is","end_run","pass_to_next","disclose","blocked","retry_turn"]), shown, effectView:shown });
const requestKind = z.enum(["infeasible", "agent_escalated", "rounds_exhausted", "agent_failed", "clarify"]);
const request = z.union([z.strictObject({ mine: z.literal(true), requestId: z.string(), kind: requestKind, options: z.array(option), expiresAt: z.number() }), z.strictObject({ mine: z.literal(false), kind: requestKind, waitingOnRole: role }), z.strictObject({ mine: z.literal(false), kind: z.literal("run_waiting") })]);
const snapshot = z.strictObject({ role, displayName: z.string(), decidedAt: z.number() });
const run = z.strictObject({ runId: z.string(), runNo: z.number(), status: z.enum(["negotiating", "pending_approval", "needs_input", "executed", "superseded", "ended_no_agreement", "canceled", "run_waiting"]), roundNo: z.number(), maxRounds: z.number(), activeRole: role.nullable(), turnStatus: z.string().nullable(), attemptStatus: z.string().nullable(), waiting: z.enum(["backoff", "spend_deferred", "draining", "run_cap"]).nullable(), staleDiscarded: z.number(), cause: z.enum(["room_opened", "constraints_changed", "renegotiation_requested", "manual_start"]), endedReason: z.string().nullable(), agentMode: z.enum(["stub", "live"]) });
const room = z.strictObject({
  header: z.strictObject({ roomId: z.string(), title: z.string(), scenarioKey: z.string(), status, phase, constraintsVersion: z.number(), proposalVersion: z.number().nullable(), viewingAs: role, isCreator: z.boolean(), provenanceBadge: provenance }),
  members: z.array(z.strictObject({ role, displayName: z.string(), isMe: z.boolean(), joinedVia: z.enum(["creator", "invite", "follow_up"]), briefConfirmed: z.boolean(), briefVersion: z.number().nullable() })),
  seats: z.array(z.strictObject({ role, state: z.enum(["filled", "invited", "empty"]), inviteMode: z.enum(["email", "link"]).nullable(), invitedEmail: z.string().nullable(), inviteExpiresAt: z.number().nullable() })).nullable(),
  todos: z.array(z.strictObject({ kind: z.string(), priority: z.number(), refs: z.strictObject({ proposalId: z.string().optional(), proposalVersion: z.number().optional(), requestId: z.string().optional(), runId: z.string().optional() }) })),
  catalog: z.array(catalog), sharedFacts: z.array(fact), budget, currentProposal: proposal.nullable(),
  proposalHistory: z.array(z.strictObject({ proposalId: z.string(), version: z.number(), status: z.enum(["active", "stale", "superseded", "rejected", "executed"]), amountCents: z.number(), deliveryDate: z.string(), createdAtConstraintsVersion: z.number() })).nullable(),
  run: run.nullable(), openRequest: request.nullable(),
  execution: z.strictObject({ executionId: z.string(), proposalVersion: z.number(), executedAt: z.number(), changeOrderNumber: z.number(), approvalsSnapshot: z.array(snapshot), followUpRoomId: z.string().nullable() }).nullable(),
  followUpOf: z.strictObject({ previousRoomId: z.string(), changeOrderNumber: z.number(), deliveredItems: z.array(z.strictObject({ itemKey: z.string(), title: z.string() })) }).nullable(),
});
const timeline = z.strictObject({ eventId: z.string(), type: z.string(), at: z.number(), actorKind: z.enum(["human", "agent", "rules", "system"]), actorRole: z.union([role, z.literal("system")]), text: z.string(), refs: z.strictObject({ proposalVersion: z.number().nullable(), constraintsVersion: z.number().nullable(), runNo: z.number().nullable() }), privateToYou: z.boolean(), provenance });
const hard = z.discriminatedUnion("schemaKey", [z.strictObject({ schemaKey: z.literal("scope_change.customer.v1"), requiredItemKeys: z.array(z.string()), deadline: z.string() }), z.strictObject({ schemaKey: z.literal("scope_change.provider.v1") }), z.strictObject({ schemaKey: z.literal("scope_change.finance.v1"), capCents: z.number() })]);
const soft = z.discriminatedUnion("schemaKey", [z.strictObject({ schemaKey: z.literal("scope_change.customer.v1"), preferredItemKeys: z.array(z.string()), notes: z.string() }), z.strictObject({ schemaKey: z.literal("scope_change.provider.v1"), notes: z.string() }), z.strictObject({ schemaKey: z.literal("scope_change.finance.v1"), notes: z.string() })]);
const brief = z.strictObject({ role, latest: z.strictObject({ version: z.number(), hardFields: hard, softFields: soft, disclosures: z.record(z.string(), z.array(role)), confirmedAt: z.number(), source: z.enum(["form", "set_cap", "request_answer"]) }).nullable(), versions: z.array(z.strictObject({ version: z.number(), confirmedAt: z.number(), source: z.string(), changedHardFields: z.array(z.string()), notes: z.string().nullable() })), othersSee: z.array(z.strictObject({ role, fields: z.array(z.strictObject({ field: z.string(), value: factValue, asOfBriefVersion: z.number() })) })), finance: z.strictObject({ committedCents: z.number(), baselineRecorded: z.boolean(), baselineSuggestionCents: z.number().nullable() }).nullable() });
const execution = z.strictObject({ executionId: z.string(), proposalVersion: z.number(), constraintsVersion: z.number(), executedAt: z.number(), provenance, whyChain: z.array(z.strictObject({ step: z.string(), constraintsVersion: z.number().nullable(), proposalVersion: z.number().nullable(), text: z.string(), href: z.string().nullable() })), approvalsSnapshot: z.array(snapshot), changeOrder: z.strictObject({ number: z.number(), terms, lines: z.array(line), amountChain: z.strictObject({ baselineCents: z.number().nullable(), approvedToDateCents: z.number().nullable(), committedBeforeCents: z.number().nullable(), thisChangeCents: z.number(), committedAfterCents: z.number().nullable(), capCentsAtExecution: z.number().nullable(), headroomAfterCents: z.number().nullable() }).nullable() }), tasks: z.array(z.strictObject({ taskId: z.string(), taskKey: z.string(), title: z.string(), assigneeRole: role, dueDate: z.string(), status: z.enum(["open", "done"]), canMarkDone: z.boolean() })) }).nullable();
const inbox = z.strictObject({ roomId: z.string(), title: z.string(), myRole: role, status, phase, inboxSection: z.enum(["needs_you", "agents_working", "waiting", "done"]), topTodo: z.strictObject({ kind: z.string(), proposalVersion: z.number().nullable(), constraintsVersion: z.number() }).nullable(), waitingOn: z.union([z.array(role), z.literal("others")]).nullable(), notice: z.enum(["approval_no_longer_applies", "request_closed"]).nullable(), provenanceBadge: provenance, updatedAt: z.number() });

describe("F2/F3/F8 §12 temporary query contract validation", () => {
  // fit nullability, suggestion action/version, and room request shown projection.
  it.each(["customer", "provider", "finance"] as const)("%s query fixtures match strict canonical DTOs in every walkthrough state", (role) => {
    for (const phase of ["S3", "S5", "S7", "S11"] as const) {
      room.parse(buildRoomView(role, phase));
      brief.parse(buildBriefQuery(role, phase));
      z.strictObject({ items: z.array(catalogRow), mine: z.strictObject({ drafts: z.array(catalogRow), history: z.array(catalogRow) }).nullable() }).parse(buildCatalogQuery());
      execution.parse(buildExecution(role, phase)); z.array(timeline).parse(buildTimeline(role, phase)); inbox.parse(buildInboxCard(role, phase));
    }
  });

  // fit is omitted on needs_input cards; API requires FitView | null.
  it.each(["customer", "provider", "finance"] as const)("%s needs_input card has canonical fit nullability", role => {
    fit.nullable().parse(buildRoomView(role, 'S7').currentProposal!.fit);
  });
  it.each(["fit", "notIncludedForMe", "myAgentSuggestion"] as const)("strict %s contract across every role and phase", field => {
    for (const role of ["customer", "provider", "finance"] as const) for (const phase of ["S3", "S5", "S7", "S11"] as const) {
      const card = buildRoomView(role, phase).currentProposal;
      if (card) { proposal.shape[field].parse(card[field]); if (field === "notIncludedForMe" && role === "customer") z.array(z.string()).parse(card[field]); }
    }
  });
  it("rejects invented aggregate fields and noncanonical attempt objects", () => {
    const view = buildRoomView("provider", "S7");
    expect(room.safeParse({ ...view, constraintBanner: "Finance updated" }).success).toBe(false);
    expect(room.safeParse({ ...view, run: { ...view.run, attemptStatus: { role: "finance", status: "error" } } }).success).toBe(false);
  });
  it("TC-PRIV-21-style fixture projection is byte-equal for buyer-caused bumps; backend verification pending", () => {
    const finance = { room: buildRoomView("provider", "S7", { constraintActor: "finance", zeroDisclosures: true }), timeline: buildTimeline("provider", "S7", { constraintActor: "finance", zeroDisclosures: true }) };
    const customer = { room: buildRoomView("provider", "S7", { constraintActor: "customer", zeroDisclosures: true }), timeline: buildTimeline("provider", "S7", { constraintActor: "customer", zeroDisclosures: true }) };
    expect(JSON.stringify(finance)).toBe(JSON.stringify(customer));
  });
});

// Compile-time integration counterexamples. This function is never executed.
export function assertMutationContracts() {
  const roomId = "room" as Id<"rooms">;
  const runId = "run" as Id<"runs">;
  const retry: FunctionArgs<typeof api.runs.retryTurn> = { runId };
  // @ts-expect-error retry uses a run ID, not a room ID
  const wrongRetry: FunctionArgs<typeof api.runs.retryTurn> = { runId: roomId };
  // @ts-expect-error approvals require nullable reasonKey and note
  const incompleteDecision: FunctionArgs<typeof api.approvals.record> = { proposalId: "proposal" as Id<"proposals">, decision: "approve", expectedConstraintsVersion: 1, expectedTermsKey: "terms" };
  // @ts-expect-error no business DTO can be read without handling null
  const missingRoom: NonNullable<FunctionReturnType<typeof api.rooms.view>> = null;
  // @ts-expect-error hard fields require the role schema discriminator
  const wrongBrief: FunctionArgs<typeof api.briefs.confirm> = { roomId, expectedConstraintsVersion: 0, hardFields: { capCents: 700000 }, softFields: { schemaKey: "scope_change.finance.v1", notes: "" }, disclosures: {} };
  return { retry, wrongRetry, incompleteDecision, missingRoom, wrongBrief };
}
