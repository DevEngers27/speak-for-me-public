import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { log, makeT, seed, type T } from "./test.helpers";

type Outcome = "accepted" | `rejected: ${string}`;

async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try {
    await p;
    return "accepted";
  } catch (e) {
    return `rejected: ${(e as Error).message.split("\n")[0]!.slice(0, 110)}`;
  }
}

async function baseRoom(t: T) {
  const { aliceId, roomId } = await seed(t);
  return {
    aliceId,
    roomId,
    valid: {
      title: "R",
      status: "draft",
      constraintVersion: 1,
      ownerId: aliceId,
      archivedAt: null,
    } as Record<string, unknown>,
  };
}

describe("(e) schema validation on write (v.union / v.literal / v.optional / v.id)", () => {
  test("insert cases", async () => {
    const t = makeT();
    const { roomId, valid } = await baseRoom(t);
    const ins = (doc: Record<string, unknown>) =>
      outcome(t.mutation(api.validation.insertRoomUnchecked, { doc }));
    const { archivedAt: _drop, ...missingNullable } = valid;
    const results: Record<string, Outcome> = {
      valid_without_optional_note: await ins(valid),
      optional_note_present: await ins({ ...valid, note: "n" }),
      optional_note_wrong_type: await ins({ ...valid, note: 42 }),
      nullable_archivedAt_missing: await ins(missingNullable),
      nullable_archivedAt_number: await ins({ ...valid, archivedAt: 123 }),
      literal_status_bogus: await ins({ ...valid, status: "bogus" }),
      extra_unknown_field: await ins({ ...valid, extra: true }),
      id_wrong_table: await ins({ ...valid, ownerId: roomId }),
      id_garbage_string: await ins({ ...valid, ownerId: "not-an-id" }),
      number_negative_fraction: await ins({ ...valid, constraintVersion: -1.5 }),
      number_NaN: await ins({ ...valid, constraintVersion: Number.NaN }),
      empty_title_string: await ins({ ...valid, title: "" }),
    };
    log("insert outcomes", "\n" + Object.entries(results).map(([k, v]) => `  ${k} => ${v}`).join("\n"));
    expect(results.valid_without_optional_note).toBe("accepted");
    expect(results.optional_note_present).toBe("accepted");
    expect(results.optional_note_wrong_type).toMatch(/^rejected/);
    expect(results.nullable_archivedAt_missing).toMatch(/^rejected/);
    expect(results.nullable_archivedAt_number).toBe("accepted");
    expect(results.literal_status_bogus).toMatch(/^rejected/);
    expect(results.extra_unknown_field).toMatch(/^rejected/);
    expect(results.id_wrong_table).toMatch(/^rejected/);
    // Shape-only: ranges / integer-ness / string length are NOT enforced.
    expect(results.number_negative_fraction).toBe("accepted");
    expect(results.empty_title_string).toBe("accepted");
  });

  test("patch cases", async () => {
    const t = makeT();
    const { roomId } = await baseRoom(t);
    const patch = (p: Record<string, unknown>) =>
      outcome(t.mutation(api.validation.patchRoomUnchecked, { roomId, patch: p }));
    const results: Record<string, Outcome> = {
      patch_valid_status: await patch({ status: "executed" }),
      patch_bogus_status: await patch({ status: "bogus" }),
      patch_unknown_field: await patch({ nope: 1 }),
      patch_set_optional: await patch({ note: "x" }),
      // undefined inside function ARGS is dropped during serialization -> no-op patch
      args_undefined_is_dropped_noop: await patch({ archivedAt: undefined }),
      handler_unset_optional: await outcome(
        t.mutation(api.validation.unsetRoomField, { roomId, field: "note" }),
      ),
      handler_unset_required: await outcome(
        t.mutation(api.validation.unsetRoomField, { roomId, field: "archivedAt" }),
      ),
    };
    const room = await t.run((ctx) => ctx.db.get("rooms", roomId));
    log("patch outcomes", "\n" + Object.entries(results).map(([k, v]) => `  ${k} => ${v}`).join("\n"));
    log("room after patches", room);
    expect(results.patch_valid_status).toBe("accepted");
    expect(results.patch_bogus_status).toMatch(/^rejected/);
    expect(results.patch_unknown_field).toMatch(/^rejected/);
    expect(results.args_undefined_is_dropped_noop).toBe("accepted");
    expect(results.handler_unset_optional).toBe("accepted");
    expect(results.handler_unset_required).toMatch(/^rejected/);
    expect(room !== null && "note" in room).toBe(false); // undefined removed the field
    expect(room?.archivedAt).toBeNull(); // failed unset rolled back
  });

  test("v.id across tables and discriminated unions in nested objects", async () => {
    const t = makeT();
    const { aliceId, roomId, proposalId } = await seed(t);
    const results: Record<string, Outcome> = {
      approval_proposalId_is_users_id: await outcome(
        t.mutation(api.validation.insertApprovalUnchecked, {
          doc: { proposalId: aliceId, userId: aliceId, decision: "approve", constraintVersion: 1, revision: 1 },
        }),
      ),
      approval_decision_maybe: await outcome(
        t.mutation(api.validation.insertApprovalUnchecked, {
          doc: { proposalId, userId: aliceId, decision: "maybe", constraintVersion: 1, revision: 1 },
        }),
      ),
      msg_propose_ok: await outcome(
        t.mutation(api.validation.insertAgentMessageUnchecked, {
          doc: { roomId, body: { kind: "propose", priceCents: 100 } },
        }),
      ),
      msg_propose_with_clarify_field: await outcome(
        t.mutation(api.validation.insertAgentMessageUnchecked, {
          doc: { roomId, body: { kind: "propose", question: "?" } },
        }),
      ),
      msg_unknown_kind: await outcome(
        t.mutation(api.validation.insertAgentMessageUnchecked, {
          doc: { roomId, body: { kind: "accept" } },
        }),
      ),
      msg_propose_negative_fraction_price: await outcome(
        t.mutation(api.validation.insertAgentMessageUnchecked, {
          doc: { roomId, body: { kind: "propose", priceCents: -0.5 } },
        }),
      ),
      t_run_bypasses_functions_but_not_schema: await outcome(
        t.run((ctx) => ctx.db.insert("rooms", { status: "bogus" } as never)),
      ),
    };
    log("id/union outcomes", "\n" + Object.entries(results).map(([k, v]) => `  ${k} => ${v}`).join("\n"));
    expect(results.approval_proposalId_is_users_id).toMatch(/^rejected/);
    expect(results.approval_decision_maybe).toMatch(/^rejected/);
    expect(results.msg_propose_ok).toBe("accepted");
    expect(results.msg_propose_with_clarify_field).toMatch(/^rejected/);
    expect(results.msg_unknown_kind).toMatch(/^rejected/);
    expect(results.msg_propose_negative_fraction_price).toBe("accepted");
    expect(results.t_run_bypasses_functions_but_not_schema).toMatch(/^rejected/);
  });

  test("argument and return validators", async () => {
    const t = makeT();
    const { roomId } = await seed(t);
    const results: Record<string, Outcome> = {
      args_bad_literal: await outcome(
        t.mutation(api.validation.setRoomStatusStrict, { roomId, status: "bogus" as never }),
      ),
      args_extra_field: await outcome(
        t.mutation(api.validation.setRoomStatusStrict, { roomId, status: "draft", x: 1 } as never),
      ),
      args_union_ok: await outcome(
        t.mutation(api.validation.postAgentMessageStrict, {
          roomId,
          body: { kind: "clarify", question: "which SSO?" },
        }),
      ),
      returns_violated: await outcome(t.mutation(api.validation.badReturn, {})),
    };
    log("args/returns outcomes", "\n" + Object.entries(results).map(([k, v]) => `  ${k} => ${v}`).join("\n"));
    expect(results.args_bad_literal).toMatch(/^rejected/);
    expect(results.args_extra_field).toMatch(/^rejected/);
    expect(results.args_union_ok).toBe("accepted");
    expect(results.returns_violated).toMatch(/^rejected/);
  });
});
