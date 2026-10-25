import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../example/convex/_generated/api";
import {
  assertNoCanaries,
  assertNoForbiddenFields,
  assertPatternsMatch,
  convexTestMatchers,
  readAll,
} from "../src";
import { makeT, seedItem, withRole } from "./fixtures";

beforeAll(() => {
  expect.extend(convexTestMatchers);
});

const CANARY = "CANARY-memo-7f3a";

async function setup() {
  const t = makeT();
  const { itemId } = await seedItem(t);
  await withRole(t, "owner").mutation(api.notes.add, { itemId, body: "owner body", privateMemo: CANARY });
  await withRole(t, "member").mutation(api.notes.add, { itemId, body: "member body", privateMemo: "member memo" });
  return { t, itemId };
}

describe("forbidden fields on real query output", () => {
  test("other people's privateMemo and authorToken never leave the query", async () => {
    const { t, itemId } = await setup();

    // Positive control: the raw rows DO contain the fields, so the patterns are not vacuous.
    const raw = await readAll(t, "notes");
    assertPatternsMatch(raw, ["privateMemo", "authorToken"]);

    const asMember = await withRole(t, "member").query(api.notes.listForItem, { itemId });
    const othersNotes = asMember.filter((n) => !n.mine);
    expect(othersNotes).toHaveLength(1);
    assertNoForbiddenFields(othersNotes, ["privateMemo"], { label: "member view of owner notes" });
    assertNoForbiddenFields(asMember, ["authorToken", "itemId"], { label: "member view" });
    assertNoCanaries(asMember, [CANARY], "member view");

    // Matcher form.
    expect(othersNotes).toHaveNoForbiddenFields(["*.privateMemo"]);
    expect(asMember).toContainNoCanaries([CANARY]);
  });

  test("the author does see their own privateMemo (the check is not just 'field absent everywhere')", async () => {
    const { t, itemId } = await setup();
    const asOwner = await withRole(t, "owner").query(api.notes.listForItem, { itemId });
    const mine = asOwner.filter((n) => n.mine);
    expect(mine).toEqual([expect.objectContaining({ privateMemo: CANARY })]);
    expect(mine).not.toHaveNoForbiddenFields(["privateMemo"]);
    expect(asOwner.filter((n) => !n.mine)).toHaveNoForbiddenFields(["privateMemo"]);
  });
});
