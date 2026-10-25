// Exercises the real @anthropic-ai/sdk 1.1.0 client through anthropicTransport, with an
// in-process fake `fetch`. No network: baseURL is a reserved .invalid host and every request is
// answered by the fake. The apiKey is a placeholder string, which also stops the SDK from
// reading credentials from the environment or profile files.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicTransport, callStructured } from "../src/index.ts";
import { baseParams, FakeClock, VALID } from "./helpers.ts";

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "hang";

function fakeClient(replies: Reply[]): { client: Anthropic; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const reply = replies[seen.length - 1];
    if (reply === undefined) throw new Error("fake fetch: no reply scripted");
    if (reply === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  const client = new Anthropic({
    apiKey: "test-placeholder-not-a-credential",
    baseURL: "http://stub.invalid",
    fetch,
    maxRetries: 5, // deliberately high: the transport must override it to 0 per request
  });
  return { client, seen };
}

const okBody = {
  id: "msg_wire_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: JSON.stringify(VALID), citations: null },
  ],
  stop_reason: "end_turn",
  stop_details: null,
  stop_sequence: null,
  container: null,
  diagnostics: null,
  usage: {
    input_tokens: 50,
    output_tokens: 80,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 4_000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    output_tokens_details: { thinking_tokens: 60 },
    inference_geo: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
  },
};
const errBody = (type: string) => ({ type: "error", error: { type, message: type } });

describe("real SDK client + fake fetch", () => {
  it("sends exactly the expected body and captures request id and usage", async () => {
    const { client, seen } = fakeClient([{ status: 200, body: okBody, headers: { "request-id": "req_wire_1" } }]);
    const r = await callStructured(baseParams({ cacheTail: "5m" }), { transport: anthropicTransport(client) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.output, VALID);
    assert.equal(r.meta.requestId, "req_wire_1");
    assert.equal(r.usage.cacheReadInputTokens, 4_000);
    assert.equal(r.usage.thinkingTokens, 60);
    const req = seen[0];
    assert.ok(req);
    assert.equal(req.url, "http://stub.invalid/v1/messages");
    assert.equal(req.headers.get("anthropic-version"), "2026-10-21");
    assert.deepEqual(Object.keys(req.body).sort(), [
      "cache_control",
      "max_tokens",
      "messages",
      "model",
      "output_config",
      "system",
    ]);
    for (const banned of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools", "stream"]) {
      assert.equal(banned in req.body, false, banned);
    }
  });

  it("400 maps to bad_request with a single HTTP call", async () => {
    const { client, seen } = fakeClient([{ status: 400, body: errBody("invalid_request_error") }]);
    const r = await callStructured(baseParams(), { transport: anthropicTransport(client), clock: new FakeClock() });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.kind, "bad_request");
    assert.equal(seen.length, 1);
  });

  it("429 with retry-after is retried once by the wrapper, not by the SDK", async () => {
    const { client, seen } = fakeClient([
      { status: 429, body: errBody("rate_limit_error"), headers: { "retry-after": "1" } },
      { status: 200, body: okBody },
    ]);
    const clock = new FakeClock();
    const r = await callStructured(baseParams(), { transport: anthropicTransport(client), clock });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 2);
    assert.deepEqual(clock.sleeps, [1_000]);
  });

  it("500 twice: exactly two HTTP calls in total (SDK retries are off)", async () => {
    const { client, seen } = fakeClient([
      { status: 500, body: errBody("api_error") },
      { status: 500, body: errBody("api_error") },
      { status: 200, body: okBody },
    ]);
    const r = await callStructured(baseParams(), { transport: anthropicTransport(client), clock: new FakeClock() });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.kind, "server_error");
    assert.equal(seen.length, 2);
  });

  it("529 maps to overloaded", async () => {
    const { client } = fakeClient([{ status: 529, body: errBody("overloaded_error") }]);
    const r = await callStructured(baseParams({ retryBudget: 0 }), { transport: anthropicTransport(client) });
    assert.equal(r.ok ? "ok" : r.kind, "overloaded");
  });

  it("client-side timeout maps to timeout", async () => {
    const { client, seen } = fakeClient(["hang"]);
    const r = await callStructured(baseParams({ timeoutMs: 50, retryBudget: 0 }), { transport: anthropicTransport(client) });
    assert.equal(r.ok ? "ok" : r.kind, "timeout");
    assert.equal(seen.length, 1);
  });
});
