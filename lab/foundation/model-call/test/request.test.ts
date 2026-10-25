import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildRequest, DEFAULT_MODEL, ModelCallConfigError, schemaFingerprint } from "../src/index.ts";
import { Answer, baseParams } from "./helpers.ts";

const throwsConfig = (fn: () => unknown, pattern: RegExp): void => {
  assert.throws(fn, (e: unknown) => e instanceof ModelCallConfigError && pattern.test(e.message));
};

describe("buildRequest: body shape", () => {
  it("emits only the expected top-level keys (no thinking, sampling, tools, tool_choice)", () => {
    const { request, model } = buildRequest(baseParams());
    assert.deepEqual(Object.keys(request).sort(), ["max_tokens", "messages", "model", "output_config", "system"]);
    assert.equal(model, DEFAULT_MODEL);
    assert.equal(request.model, "claude-opus-5-5");
    assert.equal(request.max_tokens, 4_000);
    assert.equal(request.output_config?.effort, "low");
    assert.equal(request.output_config?.format?.type, "json_schema");
  });

  it("uses the zodOutputFormat schema by default, and a provided jsonSchema verbatim", () => {
    const { request } = buildRequest(baseParams());
    assert.deepEqual(request.output_config?.format?.schema, zodOutputFormat(Answer).schema);
    const custom = { type: "object", properties: {}, required: [], additionalProperties: false };
    const built = buildRequest(baseParams({ jsonSchema: custom }));
    assert.equal(built.request.output_config?.format?.schema, custom);
  });

  it("rejects a non-object schema root (unions must be wrapped)", () => {
    const Root = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
    throwsConfig(() => buildRequest({ ...baseParams(), schema: Root } as never), /root must be type 'object'/);
  });

  it("copies messages instead of aliasing the caller's array", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const { request } = buildRequest(baseParams({ messages }));
    assert.notEqual(request.messages, messages);
    assert.deepEqual(request.messages, messages);
  });

  it("omits system when no system blocks are given", () => {
    const { request } = buildRequest(baseParams({ system: [] }));
    assert.equal("system" in request, false);
  });
});

describe("buildRequest: cache_control placement", () => {
  it("places breakpoints on the marked system blocks only", () => {
    const { request } = buildRequest(
      baseParams({ system: [{ text: "protocol", cache: "1h" }, { text: "rules", cache: "5m" }, { text: "volatile" }] }),
    );
    assert.deepEqual(request.system, [
      { type: "text", text: "protocol", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
      { type: "text", text: "volatile" },
    ]);
  });

  it("adds request-level cache_control for cacheTail", () => {
    const { request } = buildRequest(baseParams({ cacheTail: "5m" }));
    assert.deepEqual(request.cache_control, { type: "ephemeral" });
  });

  it("allows at most 4 breakpoints, counting system, messages and tail", () => {
    const system = [1, 2, 3].map((i) => ({ text: `s${i}`, cache: "5m" as const }));
    buildRequest(baseParams({ system, cacheTail: "5m" }));
    throwsConfig(
      () =>
        buildRequest(
          baseParams({
            system,
            cacheTail: "5m",
            messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }],
          }),
        ),
      /5 cache breakpoints/,
    );
  });

  it("enforces longer TTL before shorter TTL in render order", () => {
    buildRequest(baseParams({ system: [{ text: "a", cache: "1h" }], cacheTail: "5m" }));
    throwsConfig(() => buildRequest(baseParams({ system: [{ text: "a", cache: "5m" }], cacheTail: "1h" })), /1h cache breakpoint/);
    throwsConfig(
      () => buildRequest(baseParams({ system: [{ text: "a", cache: "5m" }, { text: "b", cache: "1h" }] })),
      /longer TTLs first/,
    );
  });
});

describe("buildRequest: validation", () => {
  it("rejects prefill, empty messages and a non-user first message", () => {
    throwsConfig(
      () => buildRequest(baseParams({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: "{" }] })),
      /prefill/,
    );
    throwsConfig(() => buildRequest(baseParams({ messages: [] })), /must not be empty/);
    throwsConfig(() => buildRequest(baseParams({ messages: [{ role: "assistant", content: "x" }] })), /first message/);
  });

  it("checks mid-conversation system message placement", () => {
    buildRequest(baseParams({ messages: [{ role: "user", content: "q" }, { role: "system", content: "be brief" }] }));
    throwsConfig(
      () =>
        buildRequest(
          baseParams({
            messages: [
              { role: "user", content: "q" },
              { role: "system", content: "x" },
              { role: "user", content: "q2" },
            ],
          }),
        ),
      /last or followed by an assistant/,
    );
    throwsConfig(
      () =>
        buildRequest(
          baseParams({
            messages: [
              { role: "user", content: "q" },
              { role: "assistant", content: "a" },
              { role: "system", content: "x" },
            ],
          }),
        ),
      /must follow a user message/,
    );
  });

  it("bounds maxTokens to the non-streaming limit", () => {
    buildRequest(baseParams({ maxTokens: 21_333 }));
    throwsConfig(() => buildRequest(baseParams({ maxTokens: 21_334 })), /maxTokens/);
    throwsConfig(() => buildRequest(baseParams({ maxTokens: 0 })), /maxTokens/);
    throwsConfig(() => buildRequest(baseParams({ maxTokens: 1.5 })), /maxTokens/);
  });

  it("rejects unknown effort, empty model and empty system text", () => {
    throwsConfig(() => buildRequest(baseParams({ effort: "minimal" as never })), /effort/);
    throwsConfig(() => buildRequest(baseParams({ model: " " })), /model/);
    throwsConfig(() => buildRequest(baseParams({ system: [{ text: "" }] })), /system\[0\]/);
  });
});

describe("schemaFingerprint", () => {
  it("is 16 hex chars and stable for identical schemas", async () => {
    const a = await schemaFingerprint(zodOutputFormat(Answer).schema);
    const b = await schemaFingerprint(zodOutputFormat(Answer).schema);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(a, b);
    const c = await schemaFingerprint(zodOutputFormat(z.object({ other: z.string() })).schema);
    assert.notEqual(a, c);
  });
});
