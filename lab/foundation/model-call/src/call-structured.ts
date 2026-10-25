// callStructured(): one structured-output model call.
//
// Why messages.create() and not messages.parse(): in SDK 1.1.0, parse() throws on truncated
// JSON, partial refusal text, multiple text blocks and Zod mismatches, and the thrown error
// drops the Message (usage, id, request id). We send the same output_config.format that
// zodOutputFormat() produces, then check stop_reason first and parse/validate ourselves so that
// usage survives every failure mode (inputs/04 §4.4, spikes/anthropic-zod §4.1.5).
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { type ClassifiedError, classifyError, isRetryable, TRANSIENT_KINDS } from "./classify.ts";
import { buildRequest, schemaFingerprint } from "./request.ts";
import type {
  AttemptRecord,
  CallFailure,
  CallMeta,
  CallStructuredParams,
  CallStructuredResult,
  Clock,
  FailureKind,
  ModelCallDeps,
  UsageRecord,
} from "./types.ts";
import { toUsageRecord } from "./usage.ts";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 8_000;

export const systemClock: Clock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

function requestIdOf(msg: Anthropic.Message): string | null {
  // The SDK attaches a non-enumerable `_request_id` from the `request-id` response header.
  return (msg as Anthropic.Message & { _request_id?: string | null })._request_id ?? null;
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "<root>" : path.map((k) => String(k)).join(".");
}

export async function callStructured<S extends z.ZodType>(
  params: CallStructuredParams<S>,
  deps: ModelCallDeps,
): Promise<CallStructuredResult<z.output<S>>> {
  const built = buildRequest(params); // throws ModelCallConfigError before anything is sent
  const clock = deps.clock ?? systemClock;
  const fingerprint = await schemaFingerprint(built.jsonSchema);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelay = params.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelay = params.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  let retriesLeft: number = params.retryBudget ?? 1;
  const started = clock.now();
  const attempts: AttemptRecord[] = [];

  const meta = (msg: Anthropic.Message | null): CallMeta => ({
    source: deps.transport.kind,
    requestedModel: built.model,
    servedModel: msg?.model ?? null,
    effort: params.effort,
    maxTokens: params.maxTokens,
    stopReason: msg?.stop_reason ?? null,
    messageId: msg?.id ?? null,
    requestId: msg ? requestIdOf(msg) : null,
    schemaFingerprint: fingerprint,
    attempts: [...attempts],
    totalLatencyMs: clock.now() - started,
  });

  const transportFailure = (c: ClassifiedError): CallFailure => ({
    ok: false,
    kind: c.kind,
    retryable: isRetryable(c.kind),
    usage: null,
    detail: c.detail,
    rawText: null,
    ...(c.httpStatus !== undefined ? { httpStatus: c.httpStatus } : {}),
    ...(c.retryAfterMs !== undefined ? { retryAfterMs: c.retryAfterMs } : {}),
    meta: meta(null),
  });

  if (params.signal?.aborted) return transportFailure({ kind: "aborted", detail: "aborted before sending" });

  for (let attempt = 1; ; attempt++) {
    const t0 = clock.now();
    let msg: Anthropic.Message;
    try {
      msg = await deps.transport.create(built.request, {
        timeoutMs,
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch (err) {
      const c = classifyError(err, clock.now()); // rethrows non-SDK errors (bugs)
      attempts.push({
        attempt,
        outcome: c.kind,
        latencyMs: clock.now() - t0,
        ...(c.httpStatus !== undefined ? { httpStatus: c.httpStatus } : {}),
      });
      if (!TRANSIENT_KINDS.has(c.kind) || retriesLeft <= 0 || params.signal?.aborted) return transportFailure(c);
      const delay = c.retryAfterMs ?? Math.round(baseDelay * (0.75 + 0.5 * clock.random()));
      if (delay > maxDelay) return transportFailure(c); // let the caller reschedule with retryAfterMs
      if (params.totalBudgetMs !== undefined && clock.now() - started + delay + timeoutMs > params.totalBudgetMs) {
        return transportFailure(c);
      }
      retriesLeft--;
      try {
        await clock.sleep(delay, params.signal);
      } catch {
        return transportFailure({ kind: "aborted", detail: "aborted while waiting to retry" });
      }
      continue;
    }
    const latencyMs = clock.now() - t0;
    attempts.push({ attempt, outcome: "response", latencyMs });
    return interpret(msg, toUsageRecord(msg.usage, latencyMs), params, meta(msg));
  }
}

function interpret<S extends z.ZodType>(
  msg: Anthropic.Message,
  usage: UsageRecord,
  params: CallStructuredParams<S>,
  meta: CallMeta,
): CallStructuredResult<z.output<S>> {
  // Thinking blocks come first and are ignored; only text blocks carry the JSON.
  const texts = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText = texts.length > 0 ? texts.map((t) => t.text).join("") : null;
  const fail = (
    kind: FailureKind,
    detail: string,
    extra: Pick<CallFailure, "refusal" | "issuePaths"> = {},
  ): CallFailure => ({ ok: false, kind, retryable: isRetryable(kind), usage, detail, rawText, ...extra, meta });

  const stop = msg.stop_reason;
  switch (stop) {
    case "end_turn":
      break;
    case "refusal": {
      // Branch on stop_reason, not stop_details; category may be null or a value newer than the SDK's union.
      const category: string | null = msg.stop_details?.category ?? null;
      return fail("refusal", `refusal (category: ${category ?? "none"})`, {
        refusal: { category, explanation: msg.stop_details?.explanation ?? null },
      });
    }
    case "max_tokens":
      return fail(
        "max_tokens",
        `truncated at max_tokens=${params.maxTokens} (output=${usage.outputTokens}, thinking=${usage.thinkingTokens})`,
      );
    case "model_context_window_exceeded":
      return fail("context_window_exceeded", "context window exceeded");
    case "tool_use":
    case "pause_turn":
    case "stop_sequence":
    case null:
      return fail("unexpected_stop", `unexpected stop_reason ${String(stop)}`);
    default: {
      const unknownStop: never = stop;
      return fail("unexpected_stop", `unknown stop_reason ${String(unknownStop)}`);
    }
  }

  if (rawText === null) return fail("no_output", "end_turn without a text block");
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return fail("invalid_json", `output is not valid JSON (${texts.length} text block(s))`);
  }
  const parsed = params.schema.safeParse(json);
  if (!parsed.success) {
    const issuePaths = parsed.error.issues.map((i) => issuePath(i.path));
    return fail("schema_mismatch", `${parsed.error.issues.length} schema issue(s)`, { issuePaths });
  }
  return { ok: true, output: parsed.data as z.output<S>, usage, rawText, meta };
}
