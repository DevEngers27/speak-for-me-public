import { describe, expect, it } from 'vitest';
import { decideRetry } from './retryPolicy';
import { ACTION_WALL_MAX_MS, CALL_DEADLINE_MS, MODEL_BUDGET, WATCHDOG_FIRST_MS, WATCHDOG_FINAL_MS } from './budget';
describe('10.10.2 retry ownership', () => {
  it.each(['output.not_json', 'output.schema_violation', 'output.unknown_reference', 'action.option_not_in_snapshot', 'action.repeats_blocked'])('10.10.2 %s has exactly one zero-delay attempt retry', reasonCode => {
    expect(decideRetry({ origin: 'turn_start', status: 'invalid_output', reasonCode }, () => 0.5)).toEqual({ kind: 'retry', delayMs: 0, retryNote: reasonCode });
    expect(decideRetry({ origin: 'auto_retry', status: 'invalid_output', reasonCode }, () => 0.5)).toEqual({ kind: 'fail', failureCode: reasonCode });
  });
  it.each(['transport', 'model_timeout', 'output.truncated', 'output.refusal', 'bad_request', 'auth', 'quota_exhausted', 'model_not_found', 'context_overflow', 'unexpected_stop', 'api_error', 'agents_disabled', 'config_invalid', 'internal'])('CN-001 %s is never retried by attempts', errorCode => {
    const status = errorCode.startsWith('output.') ? errorCode === 'output.refusal' ? 'refused' : 'invalid_output' : errorCode === 'model_timeout' ? 'timeout' : 'error';
    expect(decideRetry({ origin: 'retry_turn', status, errorCode }, () => 0.5)).toEqual({ kind: 'fail', failureCode: errorCode });
  });
  it.each(['action_crashed', 'watchdog_timeout'])('10.10.2 %s uses bounded two-second jitter', errorCode => {
    const status = errorCode === 'action_crashed' ? 'error' : 'timeout';
    expect(decideRetry({ origin: 'turn_start', status, errorCode }, () => 0)).toEqual({ kind: 'retry', delayMs: 1600 });
    expect(decideRetry({ origin: 'turn_start', status, errorCode }, () => 1)).toEqual({ kind: 'retry', delayMs: 2400 });
  });
  it('INV-68 stale replaces turns and budget inequalities bound every chain', () => {
    expect(decideRetry({ origin: 'auto_retry', status: 'stale' }, () => 0)).toEqual({ kind: 'replace_turn' });
    expect(CALL_DEADLINE_MS + MODEL_BUDGET.loadMarginMs).toBeLessThan(WATCHDOG_FIRST_MS);
    expect(ACTION_WALL_MAX_MS).toBeLessThan(WATCHDOG_FIRST_MS);
    expect(WATCHDOG_FINAL_MS).toBeGreaterThan(MODEL_BUDGET.assumedActionLimitMs);
    expect((1 + MODEL_BUDGET.gatewayTransportRetries + MODEL_BUDGET.gatewayTruncationRetries) * MODEL_BUDGET.maxAttemptsPerTurn).toBe(6);
  });
});
