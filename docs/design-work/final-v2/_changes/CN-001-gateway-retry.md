# CN-001 · Model gateway retry budget: runtime chapter must follow canon D09

Raised by: W0-F verification review (grok-4.7-high), 2026-10-24. Status: applied to 10-agent-runtime (repo sync #44 / #53); verified by the W2-GW invariant check.

## What the code does now (merged via W0-F)
- SDK retries are off (`SDK_MAX_RETRIES = 0`; the transport rejects a non-zero value). The gateway is the single retry layer: one retry, only for 429 and connection errors; 408/409/5xx are not retried.
- A total deadline bounds the whole call (first attempt + backoff + retry) and fires before `WATCHDOG_FIRST_MS` (275 000 ms). `CALL_DEADLINE_MS = 448 000` is gone.
- `stop_reason = max_tokens` records `output.truncated` and is retried exactly once inside `callNegotiationModel`; a second truncation returns `retryable: false`.

## Design text that is now stale
- 10-agent-runtime R11: still assigns 429, 529, 5xx, 408, 409, connection errors and pre-stream timeout to SDK `maxRetries = 1`.
- 10-agent-runtime §10.11: still publishes `CALL_DEADLINE_MS = 448 000`, which is after the watchdog.
- 10-agent-runtime §10.10.2: still retries `output.truncated` as a new attempt row; copying that into `decideRetry` would truncate twice.

## Requested change
Rewrite R11, §10.11 and §10.10.2 to match canon D09 and the code above (one gateway retry layer, total deadline < watchdog, truncation retried once inside the call). Do not change the code back. Add the rule "deadline expiry is a non-retryable timeout, including during backoff" (W0-F-r01) to R11 so the next implementer does not re-introduce it.
