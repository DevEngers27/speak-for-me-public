// Builds and validates the request body. The body is always constructed as a fresh literal
// here, never spread from caller input, so sampling params, `thinking`, `tool_choice`, tools
// or prefill can never leak onto the wire (all of them are 400s on the target models).
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  type CacheTtl,
  type CallStructuredParams,
  DEFAULT_MODEL,
  EFFORTS,
  MAX_CACHE_BREAKPOINTS,
  ModelCallConfigError,
  type ModelRequest,
  NON_STREAMING_MAX_TOKENS,
} from "./types.ts";

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();

/** JSON Schema for a Zod schema via the SDK helper, memoized per schema object. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  let cached = schemaCache.get(schema);
  if (!cached) {
    cached = zodOutputFormat(schema).schema;
    schemaCache.set(schema, cached);
  }
  return cached;
}

const fingerprintCache = new Map<string, Promise<string>>();

/** First 16 hex chars of SHA-256 over the serialized schema (Web Crypto: portable runtimes). */
export function schemaFingerprint(jsonSchema: Record<string, unknown>): Promise<string> {
  const text = JSON.stringify(jsonSchema);
  let hit = fingerprintCache.get(text);
  if (!hit) {
    hit = crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((buf) =>
      Array.from(new Uint8Array(buf).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join(""),
    );
    fingerprintCache.set(text, hit);
  }
  return hit;
}

function fail(message: string): never {
  throw new ModelCallConfigError(message);
}

function cacheControl(ttl: CacheTtl): Anthropic.CacheControlEphemeral {
  // 5m is the API default; send it bare so the bytes match the common form.
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

function ttlOf(value: unknown): CacheTtl | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as { type?: unknown; ttl?: unknown };
  if (v.type !== "ephemeral") return null;
  return v.ttl === "1h" ? "1h" : "5m";
}

/** Breakpoints the caller placed inside messages, in render order. */
function messageBreakpoints(messages: readonly Anthropic.MessageParam[]): CacheTtl[] {
  const out: CacheTtl[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const block of m.content as readonly unknown[]) {
      if (block !== null && typeof block === "object" && "cache_control" in block) {
        const ttl = ttlOf((block as { cache_control?: unknown }).cache_control);
        if (ttl) out.push(ttl);
      }
    }
  }
  return out;
}

/**
 * Validates cache placement: at most 4 breakpoints, and (API rule) longer-TTL entries must
 * appear before shorter ones, i.e. no 1h breakpoint after a 5m breakpoint in render order
 * (system -> messages -> request-level tail).
 */
export function validateCacheBreakpoints(order: readonly CacheTtl[]): void {
  if (order.length > MAX_CACHE_BREAKPOINTS) {
    fail(`${order.length} cache breakpoints; the API allows at most ${MAX_CACHE_BREAKPOINTS}`);
  }
  let seen5m = false;
  for (const ttl of order) {
    if (ttl === "5m") seen5m = true;
    else if (seen5m) fail("a 1h cache breakpoint may not follow a 5m breakpoint (longer TTLs first)");
  }
}

function validateMessages(messages: readonly Anthropic.MessageParam[]): void {
  if (messages.length === 0) fail("messages must not be empty");
  const first = messages[0];
  if (first?.role !== "user") fail("the first message must have role 'user'");
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    fail("the last message must not be an assistant message (prefill is rejected by the API)");
  }
  // Mid-conversation system messages: must follow a user message (we use no server tools) and
  // must be the last entry or be followed by an assistant turn.
  for (let i = 1; i < messages.length; i++) {
    if (messages[i]?.role !== "system") continue;
    if (messages[i - 1]?.role !== "user") {
      fail(`messages[${i}]: a mid-conversation system message must follow a user message`);
    }
    const next = messages[i + 1];
    if (next !== undefined && next.role !== "assistant") {
      fail(`messages[${i}]: a mid-conversation system message must be last or followed by an assistant message`);
    }
  }
}

export interface BuiltRequest {
  readonly request: ModelRequest;
  readonly model: string;
  readonly jsonSchema: Record<string, unknown>;
}

export function buildRequest<S extends z.ZodType>(p: CallStructuredParams<S>): BuiltRequest {
  const model = p.model ?? DEFAULT_MODEL;
  if (typeof model !== "string" || model.trim() === "") fail("model must be a non-empty string");
  if (!EFFORTS.includes(p.effort)) fail(`effort must be one of ${EFFORTS.join(", ")}`);
  if (!Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > NON_STREAMING_MAX_TOKENS) {
    fail(`maxTokens must be an integer in 1..${NON_STREAMING_MAX_TOKENS} for a non-streaming call`);
  }
  if (p.timeoutMs !== undefined && !(Number.isFinite(p.timeoutMs) && p.timeoutMs > 0)) {
    fail("timeoutMs must be a positive number");
  }
  p.system.forEach((b, i) => {
    if (typeof b.text !== "string" || b.text.trim() === "") fail(`system[${i}].text must be non-empty`);
  });
  validateMessages(p.messages);

  const order: CacheTtl[] = [
    ...p.system.flatMap((b) => (b.cache ? [b.cache] : [])),
    ...messageBreakpoints(p.messages),
    ...(p.cacheTail ? [p.cacheTail] : []),
  ];
  validateCacheBreakpoints(order);

  const jsonSchema = p.jsonSchema ?? jsonSchemaFor(p.schema);
  if (jsonSchema["type"] !== "object") {
    // Root-level anyOf acceptance is unverified (inputs/04 §4.4); wrap unions in an object.
    fail("the output JSON Schema root must be type 'object' (wrap unions in an envelope object)");
  }

  const system: Anthropic.TextBlockParam[] = p.system.map((b) =>
    b.cache ? { type: "text", text: b.text, cache_control: cacheControl(b.cache) } : { type: "text", text: b.text },
  );

  const request: ModelRequest = {
    model,
    max_tokens: p.maxTokens,
    ...(system.length > 0 ? { system } : {}),
    messages: [...p.messages],
    output_config: { effort: p.effort, format: { type: "json_schema", schema: jsonSchema } },
    ...(p.cacheTail ? { cache_control: cacheControl(p.cacheTail) } : {}),
  };
  return { request, model, jsonSchema };
}
