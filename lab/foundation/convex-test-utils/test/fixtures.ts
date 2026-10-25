import { convexTest } from "convex-test";
import { api } from "../example/convex/_generated/api";
import type { DataModel, Id } from "../example/convex/_generated/dataModel";
import schema from "../example/convex/schema";
import { modules } from "../example/convex/test.setup";
import { bindRoles, defineRoles, type TestAccessor } from "../src";

/** The suite's actors. Generic names on purpose; the engine will declare its own. */
export const roles = defineRoles({ owner: {}, member: {}, outsider: {} });
export const withRole = bindRoles(roles);

export function makeT() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof makeT>;
/** Any accessor (root `t` or one carrying an identity). */
export type Accessor = TestAccessor<DataModel>;

/** Owner creates one item and adds `member` to it. */
export async function seedItem(t: T): Promise<{ itemId: Id<"items"> }> {
  const owner = withRole(t, "owner");
  const { itemId } = await owner.mutation(api.items.create, { key: "k1", title: "First" });
  await owner.mutation(api.items.addMember, { itemId, memberToken: roles.tokenIdentifier("member") });
  return { itemId };
}
