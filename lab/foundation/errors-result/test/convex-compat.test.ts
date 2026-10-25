// Uses the real `convex/values` (devDependency only) to prove the payloads
// this package produces survive Convex transport unchanged. Runtime code in
// src/ never imports convex.
import { ConvexError, convexToJson, jsonToConvex, type Value } from "convex/values";
import { describe, expect, it } from "vitest";
import { err, isJsonValue, ok } from "../src/index.js";
import { CANARY_NUMBER, CANARY_TEXT, E, R } from "./fixtures.js";

/** What the Convex client does with a function's errorData (browser/sync/request_manager.js). */
const overTheWire = (data: Value): ConvexError<Value> => {
  const json = JSON.parse(JSON.stringify(convexToJson(data)));
  return new ConvexError(jsonToConvex(json));
};

describe("ConvexError compatibility", () => {
  it("a server payload round-trips into the same client error", () => {
    const serverSide = E.create("rate_limited", { retryAfterMs: 1500, bucket: "writes" });
    const payload = E.toPayload(serverSide);
    const thrown = new ConvexError(payload);
    expect(thrown.data).toBe(payload);
    const received = overTheWire(thrown.data);
    expect(received.data).toEqual(payload);
    expect(E.toClientError(received)).toEqual({
      code: "rate_limited",
      message: "Too many requests. Please wait and retry.",
      data: { retryAfterMs: 1500 },
      retryable: true,
      severity: "warning",
      isFallback: false,
    });
    // Passing the extracted .data works the same way.
    expect(E.toClientError(received.data)).toEqual(E.toClientError(received));
  });

  it("the ConvexError message (what Convex logs and forwards) carries no secrets", () => {
    const thrown = new ConvexError(
      E.toPayload(E.create("example.limit_exceeded", { resource: "seats", limitMinor: CANARY_NUMBER, note: CANARY_TEXT })),
    );
    expect(thrown.message).not.toContain(CANARY_TEXT);
    expect(thrown.message).not.toContain(String(CANARY_NUMBER));
    expect(thrown.message).toContain("example.limit_exceeded");
  });

  it("ConvexErrors not built by the registry map to the fallback or are re-derived", () => {
    expect(E.toClientError(new ConvexError(`Budget is ${CANARY_NUMBER}`)).code).toBe("internal");
    expect(E.toClientError(overTheWire({ code: "made_up", message: CANARY_TEXT, data: {} }))).toMatchObject({
      code: "internal",
      isFallback: true,
      message: "Something went wrong. Please try again.",
    });
    const forged = overTheWire({
      code: "example.limit_exceeded",
      message: CANARY_TEXT,
      data: { resource: "seats", limitMinor: CANARY_NUMBER },
    });
    const mapped = E.toClientError(forged);
    expect(mapped.data).toEqual({ resource: "seats" });
    expect(JSON.stringify(mapped)).not.toContain(CANARY_TEXT);
    expect(JSON.stringify(mapped)).not.toContain(String(CANARY_NUMBER));
  });

  it("errors thrown from a nested function (action -> runMutation) re-map cleanly", () => {
    const inner = overTheWire(E.toPayload(E.create("not_found")));
    expect(E.toPayload(inner)).toEqual({ code: "not_found", message: "That item could not be found.", data: {} });
    expect(E.toLogRecord(inner)).toMatchObject({ code: "not_found", known: true });
  });

  it("generic Errors (what production Convex hides as 'Server Error') become the fallback", () => {
    expect(E.toClientError(new Error("[Request ID: abc] Server Error"))).toMatchObject({ code: "internal", isFallback: true });
  });
});

describe("Convex Value compatibility of reasons and results", () => {
  it("payloads, client errors and reasons are assignable to Convex Value (compile time)", () => {
    const payload: Value = E.toPayload(new Error("x"));
    const client: Value = E.toClientError(new Error("x"));
    const reason: Value = R.make("item.required_missing", { itemKeys: ["A"] });
    const projected: Value = R.project(reason as never, { includeRestricted: false });
    const log: Value = E.toLogRecord(new Error("x"));
    expect([payload, client, reason, projected, log]).toHaveLength(5);
  });

  it("reasons and Results of reasons survive convexToJson / jsonToConvex", () => {
    const reasons = [
      R.make("limit.exceeded", { overByMinor: 10000, limitMinor: 480000 }),
      R.make("item.required_missing", { itemKeys: ["LOGIN"] }),
      R.make("date.too_late", { proposed: "2026-12-20", latestAllowed: "2026-12-15" }),
      R.make("doc.flagged", { docId: "j57abc", confirmed: false, delta: -5 }),
      R.make("empty"),
    ];
    const result = err(reasons);
    const back = jsonToConvex(JSON.parse(JSON.stringify(convexToJson(result as unknown as Value))));
    expect(back).toEqual(result);
    expect(R.parseMany((back as { error: unknown }).error)).toEqual(ok(reasons));
    expect(jsonToConvex(convexToJson(ok() as unknown as Value))).toEqual({ ok: true, value: null });
  });

  it("every value isJsonValue accepts is accepted by convexToJson", () => {
    const samples: unknown[] = [null, 0, -1.5, "", "x", true, [], {}, [1, [2, { a: "b" }]], { nested: { k: [null] } }];
    for (const s of samples) {
      expect(isJsonValue(s)).toBe(true);
      expect(jsonToConvex(convexToJson(s as Value))).toEqual(s);
    }
  });

  it("isJsonValue is stricter than Convex where Convex would change the value", () => {
    const rejected: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      10n,
      new Date(),
      new Map(),
      () => 1,
      Symbol("s"),
      { $reserved: 1 },
      [1, undefined],
      // eslint-disable-next-line no-sparse-arrays
      [1, , 3],
    ];
    for (const r of rejected) expect(isJsonValue(r)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(isJsonValue(cyclic)).toBe(false);
  });
});
