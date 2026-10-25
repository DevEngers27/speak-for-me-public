/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as engine_auth from "../engine/auth.js";
import type * as engine_health from "../engine/health.js";
import type * as engine_tables from "../engine/tables.js";
import type * as scenarios_scopeChange_tables from "../scenarios/scopeChange/tables.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "engine/auth": typeof engine_auth;
  "engine/health": typeof engine_health;
  "engine/tables": typeof engine_tables;
  "scenarios/scopeChange/tables": typeof scenarios_scopeChange_tables;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
