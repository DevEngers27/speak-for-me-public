/* Hand-written stand-in for generated `api` module (see dataModel.ts).
 * Add each new top-level module to `fullApi` below. */
import { anyApi, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";
import type * as actions from "../actions";
import type * as approvals from "../approvals";
import type * as execution from "../execution";
import type * as nested from "../nested";
import type * as runs from "../runs";
import type * as users from "../users";
import type * as validation from "../validation";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  approvals: typeof approvals;
  execution: typeof execution;
  nested: typeof nested;
  runs: typeof runs;
  users: typeof users;
  validation: typeof validation;
}>;

export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;
export const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">> =
  anyApi as any;
