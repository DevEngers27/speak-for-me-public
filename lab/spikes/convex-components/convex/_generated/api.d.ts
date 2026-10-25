/* eslint-disable */
// Generated offline (equivalent of convex codegen api.d.ts)
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as chain from "../chain.js";
import type * as lib from "../lib.js";
import type * as model from "../model.js";
import type * as observe from "../observe.js";
import type * as retrierChain from "../retrierChain.js";
import type * as rooms from "../rooms.js";
import type * as turns from "../turns.js";
import type * as wf from "../wf.js";
import type * as wfProbe from "../wfProbe.js";
declare const fullApi: ApiFromModules<{
  "chain": typeof chain,
  "lib": typeof lib,
  "model": typeof model,
  "observe": typeof observe,
  "retrierChain": typeof retrierChain,
  "rooms": typeof rooms,
  "turns": typeof turns,
  "wf": typeof wf,
  "wfProbe": typeof wfProbe,
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {
  "workflow": import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">,
  "modelPool": import("@convex-dev/workpool/_generated/component.js").ComponentApi<"modelPool">,
  "actionRetrier": import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">,
  "rateLimiter": import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">,
};
