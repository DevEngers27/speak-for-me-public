// Shared component clients + constants. Kept separate to avoid import cycles.
import { WorkflowManager } from "@convex-dev/workflow";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { ActionRetrier } from "@convex-dev/action-retrier";
import { components } from "./_generated/api";

export const ROUNDS_MAX = 4;
export const CHAIN_MAX_ATTEMPTS = 3;
export const CHAIN_BACKOFF_BASE_MS = 500;
// A Convex action can run at most 10 min; watchdog fires a bit later.
export const TURN_TIMEOUT_MS = 11 * 60 * 1000;

// Workflow engine: one manager per component instance. Retry policy is per step.
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 10,
    retryActionsByDefault: false,
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 500, base: 2 },
  },
});
export const TURN_RETRY = { maxAttempts: 3, initialBackoffMs: 500, base: 2 };

// Business rate limits (transactional with the calling mutation).
export const limiter = new RateLimiter(components.rateLimiter, {
  runStartsPerRoom: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
});

// Third variant: chain + action-retrier (per-turn retries, chain does orchestration).
export const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 500,
  base: 2,
  maxFailures: 2, // => up to 3 attempts, same as the other engines
});

export function backoffMs(attempt: number): number {
  const base = CHAIN_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.round(base * (0.75 + Math.random() * 0.5)); // jitter
}
