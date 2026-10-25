import { describe, expect, test } from "vitest";
import { api } from "../example/convex/_generated/api";
import { expectConvexErrorCode, outcomeOf, rejectionOf, roleMatrix, roleOutcomes } from "../src";
import { makeT, roles, seedItem, withRole, type Accessor } from "./fixtures";

describe("roleMatrix", () => {
  test("read permission matrix in one assertion", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    expect(await roleMatrix(t, roles, (as) => as.query(api.items.get, { itemId }))).toEqual({
      owner: "ok",
      member: "ok",
      outsider: "FORBIDDEN",
      anonymous: "UNAUTHENTICATED",
    });
  });

  test("write permission matrix; `only` and includeAnonymous narrow the run", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const rename = (as: Accessor) => as.mutation(api.items.rename, { itemId, title: "Renamed" });
    expect(await roleMatrix(t, roles, rename)).toEqual({
      owner: "ok",
      member: "FORBIDDEN",
      outsider: "FORBIDDEN",
      anonymous: "UNAUTHENTICATED",
    });
    expect(await roleMatrix(t, roles, rename, { only: ["member"], includeAnonymous: false })).toEqual({
      member: "FORBIDDEN",
    });
  });

  test("roleOutcomes keeps values and errors for detailed assertions", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const out = await roleOutcomes(t, roles, (as) => as.query(api.items.get, { itemId }));
    expect(out.owner).toMatchObject({ ok: true, value: { isOwner: true } });
    expect(out.member).toMatchObject({ ok: true, value: { isOwner: false } });
    expect(out.outsider).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  test("uncoded errors are labelled with their message", async () => {
    const t = makeT();
    const labels = await roleMatrix(t, roles, async () => {
      throw new Error("plain");
    }, { only: ["owner"], includeAnonymous: false });
    expect(labels).toEqual({ owner: "error:plain" });
  });
});

describe("error helpers", () => {
  test("expectConvexErrorCode passes on match and explains mismatches", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const err = await expectConvexErrorCode(
      withRole(t, "outsider").query(api.items.get, { itemId }),
      "FORBIDDEN",
    );
    expect(err.data).toEqual({ code: "FORBIDDEN" });
    await expect(
      expectConvexErrorCode(withRole(t, "outsider").query(api.items.get, { itemId }), "NOT_FOUND"),
    ).rejects.toThrow(/expected code NOT_FOUND, got FORBIDDEN/);
    await expect(expectConvexErrorCode(Promise.resolve(1), "X")).rejects.toThrow(/resolved/);
    await expect(rejectionOf(Promise.resolve(1))).rejects.toThrow(/resolved/);
    expect(await outcomeOf(async () => 7)).toEqual({ ok: true, value: 7 });
  });
});
