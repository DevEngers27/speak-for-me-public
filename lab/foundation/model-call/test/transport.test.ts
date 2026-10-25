import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  anthropicTransport,
  callStructured,
  estimateCostMicroUsd,
  type MessagesClient,
  sequenceResponder,
  stubTransport,
  toUsageRecord,
} from "../src/index.ts";
import { baseParams, FakeClock, msg, text, usage, VALID } from "./helpers.ts";

describe("stubTransport (deterministic stub mode)", () => {
  it("labels results as stub and derives a stable id from the request", async () => {
    const run = async () =>
      callStructured(baseParams(), {
        transport: stubTransport(() => ({ type: "output", output: VALID })),
        clock: new FakeClock(),
      });
    const a = await run();
    const b = await run();
    assert.equal(a.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.meta.source, "stub");
    assert.deepEqual(a.output, VALID);
    assert.match(a.meta.messageId ?? "", /^msg_stub_[0-9a-f]{24}$/);
    assert.equal(a.meta.messageId, b.meta.messageId);
    assert.equal(a.usage.totalPromptTokens, 0);
    assert.equal(a.meta.servedModel, "claude-opus-5-5");
  });

  it("gives the responder the fully built request (system, messages, schema)", async () => {
    let seen: Anthropic.MessageCreateParamsNonStreaming | undefined;
    await callStructured(baseParams(), {
      transport: stubTransport((req) => {
        seen = req;
        return { type: "output", output: VALID };
      }),
    });
    assert.equal(seen?.output_config?.format?.type, "json_schema");
    assert.deepEqual(seen?.messages, [{ role: "user", content: "Is this a test?" }]);
  });

  it("still validates stub output with Zod and supports refusal/text/error replies", async () => {
    const transport = stubTransport(
      sequenceResponder([
        { type: "output", output: { verdict: "perhaps" } },
        { type: "refusal", category: "bio", explanation: null },
        { type: "text", text: '{"verdict":', stopReason: "max_tokens" },
        Anthropic.APIError.generate(429, undefined, "slow down", new Headers()),
        { type: "output", output: VALID },
      ]),
    );
    const deps = { transport, clock: new FakeClock() };
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await callStructured(baseParams(), deps);
      kinds.push(r.ok ? "ok" : r.kind);
    }
    // The 429 (call #4) is retried in-process and the 5th scripted reply succeeds.
    assert.deepEqual(kinds, ["schema_mismatch", "refusal", "max_tokens", "ok"]);
  });

  it("sequenceResponder fails loudly when the script runs out", async () => {
    const transport = stubTransport(sequenceResponder([]));
    await assert.rejects(callStructured(baseParams(), { transport }), /no reply scripted/);
  });
});

describe("anthropicTransport with a fake client", () => {
  it("disables SDK retries and forwards timeout and signal", async () => {
    const calls: Array<{ body: unknown; options: Anthropic.RequestOptions | undefined }> = [];
    const fake: MessagesClient = {
      messages: {
        create: async (body, options) => {
          calls.push({ body, options });
          return msg({ content: [text(JSON.stringify(VALID))] });
        },
      },
    };
    const controller = new AbortController();
    const r = await callStructured(baseParams({ timeoutMs: 45_000, signal: controller.signal }), {
      transport: anthropicTransport(fake),
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.options?.maxRetries, 0);
    assert.equal(calls[0]?.options?.timeout, 45_000);
    assert.equal(calls[0]?.options?.signal, controller.signal);
  });
});

describe("usage helpers", () => {
  it("falls back to attributing cache writes to 5m when no TTL breakdown is present", () => {
    const u = toUsageRecord(usage({ input_tokens: 10, cache_creation_input_tokens: 50, output_tokens: 5 }), 7);
    assert.equal(u.cacheWrite5mTokens, 50);
    assert.equal(u.cacheWrite1hTokens, 0);
    assert.equal(u.latencyMs, 7);
  });

  it("estimates cost in integer micro-USD at list price", () => {
    const u = toUsageRecord(
      usage({
        input_tokens: 1_200,
        output_tokens: 900,
        cache_creation_input_tokens: 6_000,
        cache_creation: { ephemeral_5m_input_tokens: 6_000, ephemeral_1h_input_tokens: 0 },
      }),
      0,
    );
    assert.equal(estimateCostMicroUsd(u, "claude-opus-5-5"), 1_200 * 4 + 900 * 20 + 6_000 * 5);
    assert.equal(estimateCostMicroUsd(u, "some-unknown-model"), null);
  });
});
