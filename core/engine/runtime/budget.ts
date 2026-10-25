export const MODEL_BUDGET = { maxTokens: 16_000, assumedMinOutputTps: 80, ttftBudgetMs: 20_000, sdkMaxRetries: 0, gatewayTransportRetries: 1, gatewayTruncationRetries: 1, gatewayMaxBackoffMs: 8_000, deadlineMarginMs: 2_000, loadMarginMs: 10_000, persistMarginMs: 30_000, watchdogSlackMs: 15_000, assumedActionLimitMs: 600_000, watchdogMaxRearms: 3, maxAttemptsPerTurn: 2 } as const;
const B = MODEL_BUDGET;
export const REQUEST_TIMEOUT_MS = Math.ceil(B.ttftBudgetMs + B.maxTokens * 1000 / B.assumedMinOutputTps);
export const CALL_DEADLINE_MS = REQUEST_TIMEOUT_MS + B.gatewayMaxBackoffMs + B.deadlineMarginMs;
export const ACTION_WALL_MAX_MS = B.loadMarginMs + CALL_DEADLINE_MS + B.persistMarginMs;
export const WATCHDOG_FIRST_MS = B.loadMarginMs + REQUEST_TIMEOUT_MS + B.persistMarginMs + B.watchdogSlackMs;
export const WATCHDOG_REARM_MS = REQUEST_TIMEOUT_MS;
export const WATCHDOG_FINAL_MS = WATCHDOG_FIRST_MS + B.watchdogMaxRearms * WATCHDOG_REARM_MS;
if (!(ACTION_WALL_MAX_MS < B.assumedActionLimitMs && WATCHDOG_FINAL_MS > B.assumedActionLimitMs + B.watchdogSlackMs && B.loadMarginMs + CALL_DEADLINE_MS < WATCHDOG_FIRST_MS)) throw new Error('runtime.budget_invalid');
