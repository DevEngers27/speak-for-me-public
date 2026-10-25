// Maps thrown errors to a closed set of transport failure kinds, using the SDK's typed error
// classes (most specific first) rather than message string matching.
import Anthropic from "@anthropic-ai/sdk";
import type { FailureKind, TransportFailureKind } from "./types.ts";

export interface ClassifiedError {
  readonly kind: TransportFailureKind;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  /** Log-safe summary. The SDK message for 4xx may echo request details, so it is truncated. */
  readonly detail: string;
}

/** Retried in-process (within the budget) and reported as retryable to the caller. */
export const TRANSIENT_KINDS: ReadonlySet<TransportFailureKind> = new Set<TransportFailureKind>([
  "rate_limited",
  "overloaded",
  "server_error",
  "conflict",
  "timeout",
  "connection",
]);

/** Output failures worth another attempt by the caller (possibly with changed inputs). */
const RETRYABLE_OUTPUT_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "max_tokens",
  "no_output",
  "invalid_json",
  "schema_mismatch",
]);

export function isRetryable(kind: FailureKind): boolean {
  return TRANSIENT_KINDS.has(kind as TransportFailureKind) || RETRYABLE_OUTPUT_KINDS.has(kind);
}

/** Parses `retry-after-ms` (ms) or `retry-after` (seconds or HTTP date) from response headers. */
export function retryAfterMsFrom(headers: Headers | undefined, nowMs: number): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get("retry-after-ms");
  if (ms !== null) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  const ra = headers.get("retry-after");
  if (ra !== null) {
    const seconds = Number(ra);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const date = Date.parse(ra);
    if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  }
  return undefined;
}

function short(message: string): string {
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

/**
 * Classifies an error thrown by a transport. Non-SDK errors (TypeError, our own bugs) are
 * rethrown so they surface instead of being disguised as API failures.
 */
export function classifyError(err: unknown, nowMs: number): ClassifiedError {
  // Abort and connection errors extend APIError with status undefined: check them first.
  if (err instanceof Anthropic.APIUserAbortError) return { kind: "aborted", detail: "aborted by caller" };
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout", detail: "request timed out" };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "connection", detail: "connection error" };
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const retryAfterMs = retryAfterMsFrom(err.headers, nowMs);
    const withRetry = retryAfterMs !== undefined ? { retryAfterMs } : {};
    if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError || status === 413) {
      return { kind: "bad_request", httpStatus: status ?? 400, detail: `bad request (${String(status)}): ${short(err.message)}` };
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return { kind: "auth", httpStatus: status ?? 401, detail: `auth/permission error (${String(status)})` };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { kind: "not_found", httpStatus: 404, detail: `not found: ${short(err.message)}` };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { kind: "rate_limited", httpStatus: 429, detail: "rate limited", ...withRetry };
    }
    if (err instanceof Anthropic.ConflictError) {
      return { kind: "conflict", httpStatus: 409, detail: "conflict (409)", ...withRetry };
    }
    if (status === 408) return { kind: "timeout", httpStatus: 408, detail: "request timeout (408)", ...withRetry };
    if (status === 529) return { kind: "overloaded", httpStatus: 529, detail: "overloaded (529)", ...withRetry };
    if (typeof status === "number" && status >= 500) {
      return { kind: "server_error", httpStatus: status, detail: `server error (${status})`, ...withRetry };
    }
    return {
      kind: "api_error",
      ...(typeof status === "number" ? { httpStatus: status } : {}),
      detail: `api error (${String(status)})`,
    };
  }
  throw err;
}
