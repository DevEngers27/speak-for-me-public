import { v, type Infer } from 'convex/values';
import { usageV } from '../schema';
export const actorV = v.union(v.id('users'), v.null());
export const originV = v.union(v.literal('turn_start'), v.literal('auto_retry'), v.literal('retry_turn'));
export const modelResponseV = v.object({ usage: usageV, stopReason: v.string(), stopCategory: v.union(v.string(), v.null()), requestId: v.union(v.string(), v.null()), messageId: v.union(v.string(), v.null()), responseModel: v.union(v.string(), v.null()), rawText: v.string() });
export const failOutcomeV = v.union(v.object({ kind: v.literal('stale_context') }), v.object({ kind: v.union(v.literal('invalid_output'), v.literal('refused'), v.literal('timeout'), v.literal('error')), errorCode: v.string(), response: v.union(modelResponseV, v.null()), httpStatus: v.optional(v.number()), retryAfterMs: v.optional(v.number()), issuePaths:v.optional(v.array(v.string())) }));
export type ModelResponse = Infer<typeof modelResponseV>;
export type FailOutcome = Infer<typeof failOutcomeV>;
export const beginResultV = v.union(
  v.object({ kind: v.literal('dispatched'), attemptId: v.id('attempts') }),
  v.object({ kind: v.literal('deferred'), until: v.number(), reason: v.union(v.literal('spend_deferred'), v.literal('run_cap')) }),
  v.object({ kind: v.literal('parked'), code: v.literal('run.draining') }),
  v.object({ kind: v.literal('limit'), cause: v.union(v.literal('call_limit'), v.literal('spend_limit'), v.literal('turn_attempts')) }),
  v.object({ kind: v.literal('stale') }),
);
export type BeginResult = Infer<typeof beginResultV>;
