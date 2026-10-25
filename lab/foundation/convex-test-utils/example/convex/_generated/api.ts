/* Hand-written stand-in for the generated `api` module. In a real project this
 * file comes from `npx convex dev` / `npx convex codegen` and is committed.
 * Add each new module to `fullApi` below. */
import { anyApi, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";
import type * as identity from "../identity";
import type * as items from "../items";
import type * as lib_access from "../lib/access";
import type * as notes from "../notes";

declare const fullApi: ApiFromModules<{
  identity: typeof identity;
  items: typeof items;
  "lib/access": typeof lib_access;
  notes: typeof notes;
}>;

export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;
export const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">> = anyApi as any;
