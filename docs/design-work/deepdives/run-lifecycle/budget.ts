// convex/agentRuntime/budget.ts
// The ONE place where retry / timeout / cap numbers live. Everything else derives from here.
// Initial values are placeholders until inputs/04 pending item #5 (Opus 5.5 p95 turn latency) is measured.

export const TURN_BUDGET = {
  /** Per HTTP attempt inside the SDK. Owned by SDK. */
  sdkTimeoutMs: 45_000,
  /** SDK transport retries (429/5xx/408/409/connection/timeout). Owned by SDK only. */
  sdkMaxRetries: 1,
  /** SDK max backoff between its retries (SDK source: 0.5s start, cap 8s, jitter). */
  sdkMaxBackoffMs: 8_000,
  /** App-level automatic retries for semantic failures and lost actions, per non-auto attempt. */
  appAutoRetries: 1,
  /** Delay before an app-level automatic retry attempt is dispatched. */
  appRetryDelayMs: 2_000,
  /** Time reserved after the model call for loadTurnContext + completeTurn mutation. */
  persistMarginMs: 15_000,
  /** Extra slack before the watchdog declares an attempt lost. */
  watchdogSlackMs: 15_000,
  /** Assumed Convex action wall-clock limit (inputs/04 pending #1; docs usually say 10 min). */
  assumedActionLimitMs: 600_000,
  /** max_tokens for a negotiation turn: thinking + output. Must stay < ~21_333 for non-streaming. */
  turnMaxTokens: 8_000,
} as const;

export const CALL_CAPS = {
  /** Logical calls (attempt rows) per run, live + stub. Snapshotted into runs.maxCalls. */
  perRunDefault: 12,
  /** Live attempts per room per UTC day. */
  perRoomPerDay: 60,
  /** Live attempts per deployment per UTC day. */
  globalPerDay: 2_000,
} as const;

/** Upper bound of one runTurn action's wall clock, including SDK retries and persistence. */
export const ACTION_WALL_MAX_MS =
  TURN_BUDGET.sdkTimeoutMs * (TURN_BUDGET.sdkMaxRetries + 1) +
  TURN_BUDGET.sdkMaxBackoffMs * TURN_BUDGET.sdkMaxRetries +
  TURN_BUDGET.persistMarginMs;

/** Hard stop for the whole SDK call (all HTTP attempts), via AbortSignal.timeout(). */
export const MODEL_CALL_ABORT_MS = ACTION_WALL_MAX_MS - TURN_BUDGET.persistMarginMs;

/** Watchdog fires this long after the attempt row is created. */
export const WATCHDOG_DELAY_MS =
  TURN_BUDGET.appRetryDelayMs + ACTION_WALL_MAX_MS + TURN_BUDGET.watchdogSlackMs;

/** Worst-case HTTP requests for one slot = app attempts x SDK attempts. */
export const WORST_HTTP_PER_SLOT =
  (TURN_BUDGET.appAutoRetries + 1) * (TURN_BUDGET.sdkMaxRetries + 1);

// Module-load assertions: a bad edit fails the deploy instead of silently multiplying cost.
if (ACTION_WALL_MAX_MS * 2 > TURN_BUDGET.assumedActionLimitMs) {
  throw new Error("TURN_BUDGET: action wall max must be < 50% of the Convex action limit");
}
if (TURN_BUDGET.turnMaxTokens > 21_000) {
  throw new Error("TURN_BUDGET: non-streaming max_tokens must stay below the SDK streaming guard");
}
if (WORST_HTTP_PER_SLOT > 4) {
  throw new Error("TURN_BUDGET: worst-case HTTP requests per slot exceeds 4; revisit the budget ADR");
}

// With the initial numbers:
//   ACTION_WALL_MAX_MS  = 45s*2 + 8s + 15s = 113s
//   MODEL_CALL_ABORT_MS = 98s
//   WATCHDOG_DELAY_MS   = 2s + 113s + 15s = 130s
//   WORST_HTTP_PER_SLOT = 4
// Worst case per run (first scenario, 3 slots/round x maxRounds 3) = 36 HTTP requests,
// additionally capped by runs.maxCalls (logical calls) = 12 by default.

/** SDK per-request options; the client itself is created with maxRetries/timeout from the same budget. */
export function sdkRequestOptions() {
  return {
    timeout: TURN_BUDGET.sdkTimeoutMs,
    maxRetries: TURN_BUDGET.sdkMaxRetries,
    signal: AbortSignal.timeout(MODEL_CALL_ABORT_MS),
  };
}
