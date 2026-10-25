import { describe, expect, test } from "vitest";
import { api } from "../example/convex/_generated/api";
import type { Id } from "../example/convex/_generated/dataModel";
import { DedupRecipeError, countRows, verifyQueryThenInsertDedup } from "../src";
import { makeT, roles, seedItem, withRole, type T } from "./fixtures";

const itemsForKey = (t: T, key: string) => () =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("items")
        .withIndex("by_ownerToken_and_key", (q) =>
          q.eq("ownerToken", roles.tokenIdentifier("owner")).eq("key", key),
        )
        .collect()
    ).length,
  );

describe("query-then-insert dedup recipe", () => {
  test("items.create: one row per (owner, key), fails closed on a bypass duplicate", async () => {
    const t = makeT();
    const owner = withRole(t, "owner");
    const report = await verifyQueryThenInsertDedup({
      callSameKey: () => owner.mutation(api.items.create, { key: "k", title: "T" }),
      callOtherKey: () => owner.mutation(api.items.create, { key: "other", title: "T" }),
      countRows: itemsForKey(t, "k"),
      idOf: (r) => r.itemId,
      bypassInsert: async () => {
        await t.run(async (ctx) => {
          await ctx.db.insert("items", {
            ownerToken: roles.tokenIdentifier("owner"),
            key: "k",
            title: "dup",
            status: "active",
          });
        });
      },
    });
    expect(report.serialIds).toHaveLength(3);
    expect(report.otherKeyId).toBeDefined();
    expect(String(report.bypassError)).toMatch(/unique\(\) query returned more than one result/);
  });

  test("the same key under a different owner is a different row", async () => {
    const t = makeT();
    const a = await withRole(t, "owner").mutation(api.items.create, { key: "k", title: "T" });
    const b = await withRole(t, "outsider").mutation(api.items.create, { key: "k", title: "T" });
    expect(a.itemId).not.toBe(b.itemId);
    expect(await countRows(t, "items")).toBe(2);
  });

  test("items.addMember: one membership per (item, member)", async () => {
    const t = makeT();
    const { itemId } = await seedItem(t);
    const owner = withRole(t, "owner");
    const memberToken = "https://issuer.convex-test.invalid|user_new";
    await verifyQueryThenInsertDedup({
      callSameKey: () => owner.mutation(api.items.addMember, { itemId, memberToken }),
      countRows: () =>
        t.run(async (ctx) =>
          (
            await ctx.db
              .query("itemMembers")
              .withIndex("by_itemId_and_memberToken", (q) =>
                q.eq("itemId", itemId).eq("memberToken", memberToken),
              )
              .collect()
          ).length,
        ),
      idOf: (r) => r.membershipId,
    });
  });

  test("anti-vacuity: the recipe catches an entry point WITHOUT the read-before-insert", async () => {
    const t = makeT();
    const naiveInsert = () =>
      t.mutation(async (ctx) => {
        const itemId: Id<"items"> = await ctx.db.insert("items", {
          ownerToken: roles.tokenIdentifier("owner"),
          key: "naive",
          title: "T",
          status: "active",
        });
        return { itemId };
      });
    const err = await verifyQueryThenInsertDedup({
      callSameKey: naiveInsert,
      countRows: itemsForKey(t, "naive"),
      idOf: (r) => r.itemId,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DedupRecipeError);
    expect((err as DedupRecipeError).step).toBe("serial");
  });

  test("anti-vacuity: the recipe flags entry points that tolerate duplicates via .first()", async () => {
    const t = makeT();
    const lenient = () =>
      t.mutation(async (ctx) => {
        const ownerToken = roles.tokenIdentifier("owner");
        const existing = await ctx.db
          .query("items")
          .withIndex("by_ownerToken_and_key", (q) => q.eq("ownerToken", ownerToken).eq("key", "len"))
          .first();
        if (existing !== null) return { itemId: existing._id };
        return { itemId: await ctx.db.insert("items", { ownerToken, key: "len", title: "T", status: "active" }) };
      });
    const err = await verifyQueryThenInsertDedup({
      callSameKey: lenient,
      countRows: itemsForKey(t, "len"),
      idOf: (r) => r.itemId,
      bypassInsert: async () => {
        await t.run(async (ctx) => {
          await ctx.db.insert("items", { ownerToken: roles.tokenIdentifier("owner"), key: "len", title: "d", status: "active" });
        });
      },
    }).catch((e: unknown) => e);
    expect((err as DedupRecipeError).step).toBe("bypass");
  });

  test("precondition: the key must start clean", async () => {
    const t = makeT();
    const owner = withRole(t, "owner");
    await owner.mutation(api.items.create, { key: "k", title: "T" });
    await expect(
      verifyQueryThenInsertDedup({
        callSameKey: () => owner.mutation(api.items.create, { key: "k", title: "T" }),
        countRows: itemsForKey(t, "k"),
        idOf: (r) => r.itemId,
      }),
    ).rejects.toThrow(/step "clean"/);
  });
});
