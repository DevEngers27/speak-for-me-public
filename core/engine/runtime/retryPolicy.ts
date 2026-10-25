import type { AttemptStatus } from '../stateMachines';
export type RetryInput = { origin: 'turn_start' | 'auto_retry' | 'retry_turn'; status: AttemptStatus; reasonCode?: string; errorCode?: string };
export type RetryDecision = { kind: 'retry'; delayMs: number; retryNote?: string } | { kind: 'replace_turn' } | { kind: 'fail'; failureCode: string };
/** CN-001: transport, deadline and truncation retries belong exclusively to the gateway. */
export function decideRetry(a: RetryInput, rand: () => number): RetryDecision {
  if (a.status === 'stale') return { kind: 'replace_turn' };
  const code = a.reasonCode ?? a.errorCode ?? 'internal';
  const output = a.status === 'invalid_output' && (['output.not_json', 'output.schema_violation', 'output.unknown_reference'].includes(code) || code.startsWith('action.'));
  const crash = (a.status === 'timeout' && code === 'watchdog_timeout') || (a.status === 'error' && code === 'action_crashed');
  if (a.origin === 'auto_retry' || (!output && !crash)) return { kind: 'fail', failureCode: code };
  return { kind: 'retry', delayMs: output ? 0 : Math.round(2000 * (0.8 + 0.4 * rand())), ...(output ? { retryNote: code } : {}) };
}
