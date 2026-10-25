import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { type CallFailure, type CallStructuredResult, callStructured, ModelCallConfigError } from "../src/index.ts";
import { apiError, baseParams, FakeClock, msg, ScriptedTransport, text, thinking, usage, VALID } from "./helpers.ts";

function failure(r: CallStructuredResult<unknown>): CallFailure {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  return r;
}

describe("callStructured: response handling", () => {
  it("parses the text block after thinking blocks and captures usage", async () => {
    const t = new ScriptedTransport([
      msg({
        content: [thinking(), text(JSON.stringify(VALID))],
        usage: usage({
          input_tokens: 120,
          cache_read_input_tokens: 6_000,
          cache_creation_input_tokens: 300,
          cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
          output_tokens: 900,
          output_tokens_details: { thinking_tokens: 700 },
        }),
      }),
    ]);
    const clock = new FakeClock(5);
    const r = await callStructured(baseParams(), { transport: t, clock });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.output, VALID);
    assert.deepEqual(r.usage, {
      inputTokens: 120,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 6_000,
      cacheWrite5mTokens: 200,
      cacheWrite1hTokens: 100,
      totalPromptTokens: 6_420,
      outputTokens: 900,
      thinkingTokens: 700,
      latencyMs: 5,
    });
    assert.equal(r.meta.source, "anthropic");
    assert.equal(r.meta.servedModel, "claude-opus-5-5");
    assert.equal(r.meta.stopReason, "end_turn");
    assert.equal(r.meta.messageId, "msg_test_1");
    assert.deepEqual(r.meta.attempts, [{ attempt: 1, outcome: "response", latencyMs: 5 }]);
    assert.match(r.meta.schemaFingerprint, /^[0-9a-f]{16}$/);
    assert.equal(t.calls[0]?.options.timeoutMs, 120_000);
  });

  it("max_tokens: kept usage and raw text, retryable hint, no in-process retry", async () => {
    const t = new ScriptedTransport([
      msg({ stop_reason: "max_tokens", content: [text('{"verdict":"ye')], usage: usage({ output_tokens: 4_000 }) }),
    ]);
    const f = failure(await callStructured(baseParams(), { transport: t, clock: new FakeClock() }));
    assert.equal(f.kind, "max_tokens");
    assert.equal(f.retryable, true);
    assert.equal(f.usage?.outputTokens, 4_000);
    assert.equal(f.rawText, '{"verdict":"ye');
    assert.equal(t.calls.length, 1);
  });

  it("refusal with empty content (parsed_output null case) and with partial text", async () => {
    const t = new ScriptedTransport([
      msg({ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: "cyber", explanation: "x" } }),
      msg({ stop_reason: "refusal", content: [text('{"verd')], stop_details: null }),
    ]);
    const deps = { transport: t, clock: new FakeClock() };
    const a = failure(await callStructured(baseParams(), deps));
    assert.equal(a.kind, "refusal");
    assert.equal(a.retryable, false);
    assert.deepEqual(a.refusal, { category: "cyber", explanation: "x" });
    assert.notEqual(a.usage, null);
    const b = failure(await callStructured(baseParams(), deps));
    assert.equal(b.kind, "refusal");
    assert.deepEqual(b.refusal, { category: null, explanation: null });
  });

  it("end_turn without a text block is no_output", async () => {
    const t = new ScriptedTransport([msg({ content: [thinking()] })]);
    const f = failure(await callStructured(baseParams(), { transport: t, clock: new FakeClock() }));
    assert.equal(f.kind, "no_output");
    assert.equal(f.rawText, null);
  });

  it("invalid JSON and schema mismatch are distinguished; issue paths carry no values", async () => {
    const t = new ScriptedTransport([
      msg({ content: [text("not json")] }),
      msg({ content: [text(JSON.stringify({ verdict: "maybe", reasons: [], note: null }))] }),
      msg({ content: [text(JSON.stringify(VALID)), text("trailing note")] }),
    ]);
    const deps = { transport: t, clock: new FakeClock() };
    assert.equal(failure(await callStructured(baseParams(), deps)).kind, "invalid_json");
    const m = failure(await callStructured(baseParams(), deps));
    assert.equal(m.kind, "schema_mismatch");
    assert.deepEqual([...(m.issuePaths ?? [])].sort(), ["reasons", "verdict"]);
    assert.doesNotMatch(m.detail, /maybe/);
    assert.equal(failure(await callStructured(baseParams(), deps)).kind, "invalid_json");
  });

  it("unexpected stop reasons", async () => {
    const t = new ScriptedTransport([
      msg({ stop_reason: "tool_use", content: [] }),
      msg({ stop_reason: "pause_turn", content: [] }),
      msg({ stop_reason: null, content: [] }),
      msg({ stop_reason: "model_context_window_exceeded", content: [] }),
      msg({ stop_reason: "something_new" as never, content: [] }),
    ]);
    const deps = { transport: t, clock: new FakeClock() };
    const kinds = [];
    for (let i = 0; i < 5; i++) kinds.push(failure(await callStructured(baseParams(), deps)).kind);
    assert.deepEqual(kinds, ["unexpected_stop", "unexpected_stop", "unexpected_stop", "context_window_exceeded", "unexpected_stop"]);
  });
});

describe("callStructured: errors and the single retry budget", () => {
  const ok = () => msg({ content: [text(JSON.stringify(VALID))] });

  it("BadRequestError is not retried", async () => {
    const t = new ScriptedTransport([apiError(400), ok()]);
    const f = failure(await callStructured(baseParams(), { transport: t, clock: new FakeClock() }));
    assert.equal(f.kind, "bad_request");
    assert.equal(f.retryable, false);
    assert.equal(f.httpStatus, 400);
    assert.equal(f.usage, null);
    assert.equal(t.calls.length, 1);
  });

  it("auth, not_found and 413 are not retried", async () => {
    for (const [status, kind] of [[401, "auth"], [403, "auth"], [404, "not_found"], [413, "bad_request"], [422, "bad_request"]] as const) {
      const t = new ScriptedTransport([apiError(status), ok()]);
      const f = failure(await callStructured(baseParams(), { transport: t, clock: new FakeClock() }));
      assert.equal(f.kind, kind, `status ${status}`);
      assert.equal(t.calls.length, 1);
    }
  });

  it("rate limit then success: one retry with jittered delay", async () => {
    const t = new ScriptedTransport([apiError(429), ok()]);
    const clock = new FakeClock(5, 0.5);
    const r = await callStructured(baseParams(), { transport: t, clock });
    assert.equal(r.ok, true);
    assert.deepEqual(clock.sleeps, [1_000]);
    assert.deepEqual(
      r.meta.attempts.map((a) => [a.outcome, a.httpStatus]),
      [["rate_limited", 429], ["response", undefined]],
    );
  });

  it("529 twice exhausts the budget and reports retryable overloaded", async () => {
    const t = new ScriptedTransport([apiError(529), apiError(529), ok()]);
    const f = failure(await callStructured(baseParams(), { transport: t, clock: new FakeClock(5, 0) }));
    assert.equal(f.kind, "overloaded");
    assert.equal(f.retryable, true);
    assert.equal(t.calls.length, 2);
    assert.equal(f.meta.attempts.length, 2);
  });

  it("5xx and timeout are retried; retryBudget 0 disables the retry", async () => {
    const a = new ScriptedTransport([apiError(503), ok()]);
    assert.equal((await callStructured(baseParams(), { transport: a, clock: new FakeClock() })).ok, true);
    const b = new ScriptedTransport([new Anthropic.APIConnectionTimeoutError(), ok()]);
    assert.equal((await callStructured(baseParams(), { transport: b, clock: new FakeClock() })).ok, true);
    const c = new ScriptedTransport([new Anthropic.APIConnectionTimeoutError(), ok()]);
    const f = failure(await callStructured(baseParams({ retryBudget: 0 }), { transport: c, clock: new FakeClock() }));
    assert.equal(f.kind, "timeout");
    assert.equal(f.retryable, true);
    assert.equal(c.calls.length, 1);
  });

  it("honours retry-after when within the cap, otherwise hands it back", async () => {
    const clock = new FakeClock();
    const a = new ScriptedTransport([apiError(429, { "retry-after": "2" }), ok()]);
    assert.equal((await callStructured(baseParams(), { transport: a, clock })).ok, true);
    assert.deepEqual(clock.sleeps, [2_000]);
    const b = new ScriptedTransport([apiError(429, { "retry-after-ms": "30000" }), ok()]);
    const f = failure(await callStructured(baseParams(), { transport: b, clock: new FakeClock() }));
    assert.equal(f.kind, "rate_limited");
    assert.equal(f.retryAfterMs, 30_000);
    assert.equal(b.calls.length, 1);
  });

  it("skips the retry when totalBudgetMs cannot fit delay + another attempt", async () => {
    const t = new ScriptedTransport([apiError(500), ok()]);
    const f = failure(
      await callStructured(baseParams({ timeoutMs: 60_000, totalBudgetMs: 60_500 }), { transport: t, clock: new FakeClock() }),
    );
    assert.equal(f.kind, "server_error");
    assert.equal(t.calls.length, 1);
  });

  it("abort before sending and during the retry wait", async () => {
    const pre = new AbortController();
    pre.abort();
    const t = new ScriptedTransport([ok()]);
    const f = failure(await callStructured(baseParams({ signal: pre.signal }), { transport: t, clock: new FakeClock() }));
    assert.equal(f.kind, "aborted");
    assert.equal(t.calls.length, 0);

    const mid = new AbortController();
    const clock = new FakeClock();
    clock.sleep = async () => {
      mid.abort();
      throw new Error("aborted");
    };
    const t2 = new ScriptedTransport([apiError(429), ok()]);
    const g = failure(await callStructured(baseParams({ signal: mid.signal }), { transport: t2, clock }));
    assert.equal(g.kind, "aborted");
    assert.equal(g.retryable, false);
    assert.equal(t2.calls.length, 1);

    const t3 = new ScriptedTransport([new Anthropic.APIUserAbortError()]);
    assert.equal(failure(await callStructured(baseParams(), { transport: t3, clock: new FakeClock() })).kind, "aborted");
  });

  it("non-SDK errors propagate instead of being disguised as API failures", async () => {
    const t = new ScriptedTransport([new TypeError("bug")]);
    await assert.rejects(callStructured(baseParams(), { transport: t, clock: new FakeClock() }), TypeError);
  });

  it("config errors reject before the transport is called", async () => {
    const t = new ScriptedTransport([ok()]);
    await assert.rejects(
      callStructured(baseParams({ maxTokens: 50_000 }), { transport: t, clock: new FakeClock() }),
      ModelCallConfigError,
    );
    assert.equal(t.calls.length, 0);
  });
});
