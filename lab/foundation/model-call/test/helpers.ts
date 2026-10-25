// Shared test fixtures. Domain-free sample schema; no network, no credentials.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CallStructuredParams, Clock, ModelRequest, Transport, TransportOptions } from "../src/index.ts";

export const Answer = z.strictObject({
  verdict: z.enum(["yes", "no"]),
  reasons: z.array(z.string().min(1)).min(1),
  note: z.string().nullable(),
});
export type Answer = z.output<typeof Answer>;

export const VALID: Answer = { verdict: "yes", reasons: ["fits"], note: null };

export function baseParams(overrides: Partial<CallStructuredParams<typeof Answer>> = {}): CallStructuredParams<typeof Answer> {
  return {
    effort: "low",
    maxTokens: 4_000,
    system: [{ text: "You answer questions as JSON.", cache: "5m" }],
    messages: [{ role: "user", content: "Is this a test?" }],
    schema: Answer,
    ...overrides,
  };
}

/** Deterministic clock: every now() call advances by `step` ms; sleep() records and advances. */
export class FakeClock implements Clock {
  t = 1_000_000;
  readonly sleeps: number[] = [];
  readonly step: number;
  readonly rand: number;
  constructor(step = 5, rand = 0.5) {
    this.step = step;
    this.rand = rand;
  }
  now(): number {
    const v = this.t;
    this.t += this.step;
    return v;
  }
  random(): number {
    return this.rand;
  }
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.sleeps.push(ms);
    this.t += ms;
  }
}

export function usage(partial: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    input_tokens: 0,
    output_tokens: 0,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...partial,
  };
}

export function msg(partial: Partial<Anthropic.Message> & Pick<Anthropic.Message, "content">): Anthropic.Message {
  return {
    id: "msg_test_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    container: null,
    diagnostics: null,
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: usage(),
    ...partial,
  };
}

export const text = (t: string): Anthropic.TextBlock => ({ type: "text", text: t, citations: null });
export const thinking = (): Anthropic.ThinkingBlock => ({ type: "thinking", thinking: "", signature: "sig" });

/** Fake transport that plays a script of Messages / errors and records every call. */
export class ScriptedTransport implements Transport {
  readonly kind: "anthropic" | "stub";
  readonly calls: Array<{ request: ModelRequest; options: TransportOptions }> = [];
  private readonly script: Array<Anthropic.Message | Error>;
  constructor(script: Array<Anthropic.Message | Error>, kind: "anthropic" | "stub" = "anthropic") {
    this.script = script;
    this.kind = kind;
  }
  async create(request: ModelRequest, options: TransportOptions): Promise<Anthropic.Message> {
    this.calls.push({ request, options });
    const next = this.script[this.calls.length - 1];
    if (next === undefined) throw new Error(`ScriptedTransport: nothing scripted for call ${this.calls.length}`);
    if (next instanceof Error) throw next;
    return next;
  }
}

export function apiError(status: number, headers: Record<string, string> = {}): Error {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: "test_error", message: `status ${status}` } },
    undefined,
    new Headers(headers),
  );
}
