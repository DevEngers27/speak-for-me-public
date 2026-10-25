// Recommended wrapper for one structured-output model call (not executed against the API).
// Design: messages.create (NOT messages.parse) so that usage + raw response survive every
// failure mode; classify failures into a closed set; caller (Convex action) decides retry.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODEL = "claude-opus-5-5" as const;
/** SDK refuses non-streaming requests whose max_tokens implies > 10 min (≈ 21,333). */
export const NON_STREAMING_MAX_TOKENS = 21_333;

export type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

export type FailureKind =
  | "refusal" // stop_reason=refusal; not retryable with same input
  | "max_tokens" // truncated; retryable once with higher max_tokens or lower effort
  | "context_window_exceeded"
  | "unexpected_stop" // tool_use / pause_turn / stop_sequence / null: we send no tools
  | "no_text_block"
  | "multiple_text_blocks"
  | "invalid_json"
  | "schema_mismatch" // JSON ok, Zod rejected (enum/length/discriminator degraded in schema)
  | "rate_limited"
  | "overloaded_or_server" // 5xx / 529
  | "timeout"
  | "connection"
  | "aborted"
  | "bad_request" // 400/422: our bug (e.g. sampling param, forced tool_choice) - do not retry
  | "auth" // 401/403
  | "api_error_other";

const RETRYABLE: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "max_tokens", "invalid_json", "schema_mismatch", "rate_limited", "overloaded_or_server", "timeout", "connection",
]);

export interface UsageRecord {
  requestedModel: string;
  servedModel: string; // msg.model - differs from requested when a fallback served it
  effort: Effort;
  stopReason: Anthropic.StopReason | null;
  messageId: string;
  requestId: string | null;
  inputTokens: number; // uncached remainder only
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number; // includes thinking
  thinkingTokens: number;
  estimatedCostMicroUsd: number; // integer, Opus 5.5 list price; an estimate, not a bill
  latencyMs: number;
}

export type CallModelResult<T> =
  | { ok: true; output: T; usage: UsageRecord; rawText: string }
  | {
      ok: false;
      kind: FailureKind;
      retryable: boolean;
      usage: UsageRecord | null; // null only when no response was received
      detail: string; // safe for logs: no model text, no private brief content
      rawText: string | null; // persist to a private table if needed; never log it
      refusal?: { category: string | null; explanation: string | null };
      issuePaths?: string[]; // Zod issue paths only
      httpStatus?: number;
    };

export interface CallModelParams<S extends z.ZodType> {
  client: Anthropic;
  schema: S; // client-side validator (authoritative)
  jsonSchema: Record<string, unknown>; // precomputed once per schema version
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  effort: Effort; // always explicit (Opus 5.5 default is medium)
  maxTokens?: number; // thinking counts toward it; default 16000
  timeoutMs?: number; // per HTTP attempt
  maxRetries?: number; // SDK-level retries; keep total < Convex action limit
  signal?: AbortSignal;
}

// $ per MTok == micro-USD per token. Opus 5.5: in 4, out 20, cache read 0.20, write 5m 5, 1h 8.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 } as const;

export function toUsageRecord(msg: Anthropic.Message, effort: Effort, latencyMs: number): UsageRecord {
  const u = msg.usage;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : cacheCreation);
  const w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cost = u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + cacheRead * PRICE.cacheRead + w5 * PRICE.write5m + w1 * PRICE.write1h;
  return {
    requestedModel: MODEL,
    servedModel: msg.model,
    effort,
    stopReason: msg.stop_reason,
    messageId: msg.id,
    requestId: (msg as Anthropic.Message & { _request_id?: string | null })._request_id ?? null,
    inputTokens: u.input_tokens,
    cacheCreationInputTokens: cacheCreation,
    cacheReadInputTokens: cacheRead,
    cacheWrite5mTokens: w5,
    cacheWrite1hTokens: w1,
    outputTokens: u.output_tokens,
    thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
    estimatedCostMicroUsd: Math.round(cost),
    latencyMs,
  };
}

export function classifyApiError(err: unknown): { kind: FailureKind; httpStatus?: number; detail: string } {
  // Order matters: subclasses before base classes.
  if (err instanceof Anthropic.APIUserAbortError) return { kind: "aborted", detail: "aborted by caller" };
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout", detail: "request timed out" };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "connection", detail: "connection error" };
  if (err instanceof Anthropic.RateLimitError) return { kind: "rate_limited", httpStatus: 429, detail: "rate limited" };
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError)
    return { kind: "bad_request", httpStatus: err.status, detail: `bad request: ${err.message.slice(0, 300)}` };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return { kind: "auth", httpStatus: err.status, detail: "auth/permission error" };
  if (err instanceof Anthropic.InternalServerError) return { kind: "overloaded_or_server", httpStatus: err.status, detail: `server error ${err.status}` };
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    if (s === 408 || s === 409) return { kind: "connection", httpStatus: s, detail: `retryable status ${s}` };
    return { kind: "api_error_other", httpStatus: s, detail: `api error ${String(s)}` };
  }
  throw err; // programming error (e.g. TypeError) - let it surface
}

export async function callModel<S extends z.ZodType>(p: CallModelParams<S>): Promise<CallModelResult<z.infer<S>>> {
  const maxTokens = p.maxTokens ?? 16_000;
  if (maxTokens > NON_STREAMING_MAX_TOKENS) throw new RangeError(`max_tokens ${maxTokens} requires streaming`);
  const started = Date.now();
  let msg: Anthropic.Message;
  try {
    msg = await p.client.messages.create(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system: p.system,
        messages: p.messages,
        // No thinking param (Opus 5.5 is always adaptive), no sampling params, no tool_choice.
        output_config: { effort: p.effort, format: { type: "json_schema", schema: p.jsonSchema } },
      },
      { timeout: p.timeoutMs ?? 120_000, maxRetries: p.maxRetries ?? 1, ...(p.signal ? { signal: p.signal } : {}) },
    );
  } catch (err) {
    const c = classifyApiError(err);
    return { ok: false, kind: c.kind, retryable: RETRYABLE.has(c.kind), usage: null, detail: c.detail, rawText: null, ...(c.httpStatus ? { httpStatus: c.httpStatus } : {}) };
  }
  const usage = toUsageRecord(msg, p.effort, Date.now() - started);
  const texts = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText = texts.length > 0 ? texts.map((t) => t.text).join("") : null;
  const fail = (kind: FailureKind, detail: string, extra: Partial<Extract<CallModelResult<never>, { ok: false }>> = {}) =>
    ({ ok: false as const, kind, retryable: RETRYABLE.has(kind), usage, detail, rawText, ...extra });

  switch (msg.stop_reason) {
    case "end_turn":
      break;
    case "refusal":
      return fail("refusal", `refusal (${msg.stop_details?.category ?? "uncategorized"})`, {
        refusal: { category: msg.stop_details?.category ?? null, explanation: msg.stop_details?.explanation ?? null },
      });
    case "max_tokens":
      return fail("max_tokens", `truncated at max_tokens=${maxTokens} (thinking=${usage.thinkingTokens})`);
    case "model_context_window_exceeded":
      return fail("context_window_exceeded", "context window exceeded");
    case "tool_use":
    case "pause_turn":
    case "stop_sequence":
    case null:
      return fail("unexpected_stop", `unexpected stop_reason ${String(msg.stop_reason)}`);
    default: {
      const unknownStop: never = msg.stop_reason;
      return fail("unexpected_stop", `unknown stop_reason ${String(unknownStop)}`);
    }
  }
  if (texts.length === 0) return fail("no_text_block", "end_turn without text block");
  if (texts.length > 1) return fail("multiple_text_blocks", `${texts.length} text blocks`);
  let json: unknown;
  try {
    json = JSON.parse(texts[0]!.text);
  } catch {
    return fail("invalid_json", "text block is not valid JSON");
  }
  const parsed = p.schema.safeParse(json);
  if (!parsed.success) {
    const issuePaths = parsed.error.issues.map((i) => i.path.join(".") || "<root>");
    return fail("schema_mismatch", `${parsed.error.issues.length} schema issue(s)`, { issuePaths });
  }
  return { ok: true, output: parsed.data, usage, rawText: texts[0]!.text };
}
