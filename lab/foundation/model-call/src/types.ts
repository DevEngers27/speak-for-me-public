// Public types for the structured model-call wrapper.
// Domain-free: nothing here knows about rooms, proposals or scenarios.
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/** Default model per platform constraints (inputs/04 §4.1). Callers may override. */
export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * The SDK refuses non-streaming requests whose max_tokens implies > 10 minutes
 * (max_tokens * 3600 / 128000 > 600, i.e. above 21,333). We reject earlier with a clear error.
 */
export const NON_STREAMING_MAX_TOKENS = 21_333;

/** Max cache_control breakpoints per request (API limit). */
export const MAX_CACHE_BREAKPOINTS = 4;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export type CacheTtl = "5m" | "1h";

/**
 * One top-level system text block. `cache` places a cache_control breakpoint at the END of
 * this block (everything up to and including it becomes a cacheable prefix).
 * Keep stable text first; never put timestamps or ids in a cached block.
 */
export interface SystemBlock {
  readonly text: string;
  readonly cache?: CacheTtl;
}

/** What the transport receives: a fully built, validated, non-streaming request body. */
export type ModelRequest = Anthropic.MessageCreateParamsNonStreaming;

export interface TransportOptions {
  /** Per-attempt timeout in milliseconds. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * The only seam between this module and the network. `kind` decides how results are labelled:
 * anything produced by a "stub" transport is marked `source: "stub"` so it can never be
 * mistaken for a real model answer (brief core rule 8).
 */
export interface Transport {
  readonly kind: "anthropic" | "stub";
  create(request: ModelRequest, options: TransportOptions): Promise<Anthropic.Message>;
}

/** Injected time/randomness so retries and latency are deterministic in tests. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Returns a number in [0, 1); used for retry jitter only. */
  random(): number;
}

export interface CallStructuredParams<S extends z.ZodType> {
  readonly model?: string;
  /** Always explicit: Opus 5.5 defaults to `medium` when omitted, which we never rely on. */
  readonly effort: Effort;
  /** Thinking tokens count toward this. 1..21,333 (non-streaming). */
  readonly maxTokens: number;
  readonly system: readonly SystemBlock[];
  /** Must start with a user message and must not end with an assistant message (no prefill). */
  readonly messages: readonly Anthropic.MessageParam[];
  /** Authoritative client-side validator. Root must produce a JSON object schema. */
  readonly schema: S;
  /**
   * Optional precomputed JSON Schema sent as output_config.format.schema. Defaults to
   * `zodOutputFormat(schema).schema` (note: the SDK helper moves enum/const/min/max into
   * descriptions, so those are enforced only by the Zod check after the call).
   */
  readonly jsonSchema?: Record<string, unknown>;
  /** Adds request-level automatic caching for the conversation tail (one breakpoint slot). */
  readonly cacheTail?: CacheTtl;
  /** Per-attempt timeout. Default 120,000 ms. */
  readonly timeoutMs?: number;
  /** In-process retries for transient transport failures. 0 or 1; default 1. */
  readonly retryBudget?: 0 | 1;
  /** Base delay before the retry; jittered to [0.75x, 1.25x]. Default 1,000 ms. */
  readonly retryBaseDelayMs?: number;
  /** A server retry-after above this skips the in-process retry. Default 8,000 ms. */
  readonly maxRetryDelayMs?: number;
  /**
   * Optional wall-clock budget for the whole call (all attempts + delay). A retry is only
   * started when delay + a full attempt timeout still fits. Use it to stay under the
   * hosting platform's action time limit.
   */
  readonly totalBudgetMs?: number;
  readonly signal?: AbortSignal;
}

export interface ModelCallDeps {
  readonly transport: Transport;
  readonly clock?: Clock;
}

/** Response received but unusable. Usage is always kept. */
export type OutputFailureKind =
  | "refusal" // stop_reason=refusal; same input will not succeed
  | "max_tokens" // truncated (thinking counts toward max_tokens)
  | "context_window_exceeded"
  | "unexpected_stop" // tool_use / pause_turn / stop_sequence / null / unknown
  | "no_output" // end_turn without any text block (SDK parse() would give parsed_output=null)
  | "invalid_json"
  | "schema_mismatch"; // JSON parsed, Zod rejected

/** No usable response received. */
export type TransportFailureKind =
  | "rate_limited" // 429
  | "overloaded" // 529
  | "server_error" // other 5xx
  | "conflict" // 409
  | "timeout" // client timeout or 408
  | "connection"
  | "aborted" // caller's AbortSignal
  | "bad_request" // 400 / 413 / 422: a bug in how we build requests; never retried
  | "auth" // 401 / 403
  | "not_found" // 404 (e.g. unknown model id)
  | "api_error"; // any other HTTP status

export type FailureKind = OutputFailureKind | TransportFailureKind;

export interface UsageRecord {
  /** Uncached remainder only. */
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  /** input + cache creation + cache read. */
  readonly totalPromptTokens: number;
  /** Includes thinking tokens. */
  readonly outputTokens: number;
  readonly thinkingTokens: number;
  /** Latency of the attempt that produced this response. */
  readonly latencyMs: number;
}

export interface AttemptRecord {
  readonly attempt: number;
  /** "response" when a Message came back (whatever its stop_reason). */
  readonly outcome: "response" | TransportFailureKind;
  readonly latencyMs: number;
  readonly httpStatus?: number;
}

export interface CallMeta {
  readonly source: "anthropic" | "stub";
  readonly requestedModel: string;
  /** msg.model: may differ from requestedModel if a fallback served the request. */
  readonly servedModel: string | null;
  readonly effort: Effort;
  readonly maxTokens: number;
  readonly stopReason: string | null;
  readonly messageId: string | null;
  readonly requestId: string | null;
  /** First 16 hex chars of SHA-256 over the JSON Schema sent to the API. */
  readonly schemaFingerprint: string;
  readonly attempts: readonly AttemptRecord[];
  readonly totalLatencyMs: number;
}

export interface CallSuccess<T> {
  readonly ok: true;
  readonly output: T;
  readonly usage: UsageRecord;
  /** The raw JSON text. Persist only to private storage; never log it. */
  readonly rawText: string;
  readonly meta: CallMeta;
}

export interface CallFailure {
  readonly ok: false;
  readonly kind: FailureKind;
  /**
   * Hint for the caller's own attempt layer. Transport kinds were already retried in-process
   * within `retryBudget`; output kinds are never retried in-process.
   */
  readonly retryable: boolean;
  /** null only when no response was ever received. */
  readonly usage: UsageRecord | null;
  /** Log-safe: never contains model text, prompt text or credentials. */
  readonly detail: string;
  /** Model text if any (private storage only, never logs). */
  readonly rawText: string | null;
  readonly httpStatus?: number;
  /** Server-suggested delay before retrying, when the API sent one. */
  readonly retryAfterMs?: number;
  readonly refusal?: { readonly category: string | null; readonly explanation: string | null };
  /** Zod issue paths only (no values). */
  readonly issuePaths?: readonly string[];
  readonly meta: CallMeta;
}

export type CallStructuredResult<T> = CallSuccess<T> | CallFailure;

/** Thrown (never returned) for programming errors in the call parameters. No request is sent. */
export class ModelCallConfigError extends Error {
  override readonly name = "ModelCallConfigError";
}
