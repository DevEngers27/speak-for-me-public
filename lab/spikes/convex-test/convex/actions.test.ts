import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { countEvents, log, makeT, rejectionOf, seed } from "./test.helpers";

describe("(f) actions are not transactional", () => {
  test("throw between two runMutation calls: first write persists, second never happens", async () => {
    const t = makeT();
    const { roomId } = await seed(t);
    const err = await rejectionOf(t.action(api.actions.twoStepAction, { roomId, failBetween: true }));
    log("action error", (err as Error).message.split("\n")[0]);
    const counts = { step1: await countEvents(t, "step1"), step2: await countEvents(t, "step2") };
    log("events after failed action", counts);
    expect(counts).toEqual({ step1: 1, step2: 0 });
  });

  test("happy path writes both", async () => {
    const t = makeT();
    const { roomId } = await seed(t);
    await t.action(api.actions.twoStepAction, { roomId, failBetween: false });
    expect(await countEvents(t, "step1")).toBe(1);
    expect(await countEvents(t, "step2")).toBe(1);
  });
});

describe("(g) Convex 1.48 nested ctx.runMutation inside a mutation = sub-transaction", () => {
  test("inner throws and outer catches: inner writes rolled back, outer writes kept", async () => {
    const t = makeT();
    const r = await t.mutation(api.nested.outerCatchesInner, { rethrow: false });
    const counts = {
      before: await countEvents(t, "nested.outer.before"),
      inner: await countEvents(t, "nested.inner"),
      after: await countEvents(t, "nested.outer.after"),
    };
    log("nested (caught)", { r, counts });
    expect(r).toBe("caught");
    expect(counts).toEqual({ before: 1, inner: 0, after: 1 });
  });

  test("outer rethrows: everything rolled back", async () => {
    const t = makeT();
    await rejectionOf(t.mutation(api.nested.outerCatchesInner, { rethrow: true }));
    expect(await countEvents(t, "nested.outer.before")).toBe(0);
    expect(await countEvents(t, "nested.inner")).toBe(0);
  });
});
