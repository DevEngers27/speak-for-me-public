import { inspect } from "node:util";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AppError,
  defineErrors,
  ErrorRegistryDefinitionError,
  ExhaustivenessError,
  field,
  mergeErrorSpecs,
  type ClientError,
  type ErrorSpecMap,
} from "../src/index.js";
import { CANARY_NUMBER, CANARY_TEXT, coreSpecs, E, exampleScenarioSpecs } from "./fixtures.js";

type S = typeof E.specs;

const limitError = () =>
  E.create("example.limit_exceeded", { resource: "seats", limitMinor: CANARY_NUMBER, note: CANARY_TEXT });

describe("definition-time validation", () => {
  const base = { severity: "error", retryable: false, exposure: "public", message: "Oops." } as const;
  const def = (specs: ErrorSpecMap, fallback: string) => () => defineErrors(specs, { fallback } as never);

  it("rejects malformed registries", () => {
    expect(def({ internal: base }, "missing")).toThrow(ErrorRegistryDefinitionError);
    expect(def({ internal: { ...base, exposure: "internal" } }, "internal")).toThrow(/must be public/);
    expect(def({ internal: { ...base, data: { x: field.client<number>() } } }, "internal")).toThrow(/must not declare/);
    expect(def({ internal: base, "bad code": base }, "internal")).toThrow(/Invalid error code/);
    expect(def({ internal: base, "4xx": base }, "internal")).toThrow(/Invalid error code/);
    expect(def({ internal: base, x: { ...base, message: " " } }, "internal")).toThrow(/message/);
    expect(def({ internal: base, x: { ...base, severity: "fatal" as never } }, "internal")).toThrow(/severity/);
    expect(
      def({ internal: base, x: { ...base, exposure: "internal", data: { a: field.client<number>() } } }, "internal"),
    ).toThrow(/internal codes cannot have client fields/);
    expect(def({ internal: base, x: { ...base, data: { a: { visibility: "public" as never } } } }, "internal")).toThrow(
      /visibility/,
    );
  });

  it("refuses to merge groups that redefine a code", () => {
    expect(() => mergeErrorSpecs(coreSpecs, { not_found: coreSpecs.not_found })).toThrow(/Duplicate error codes: not_found/);
    expect(Object.keys(mergeErrorSpecs(coreSpecs, exampleScenarioSpecs))).toHaveLength(5);
  });
});

describe("create / fail / is", () => {
  it("creates typed AppErrors with a static message", () => {
    const e = E.create("rate_limited", { retryAfterMs: 500, bucket: "writes" });
    expect(e).toBeInstanceOf(AppError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("rate_limited");
    expect(e.message).toBe("Too many requests. Please wait and retry.");
    expect(e.retryable).toBe(true);
    expect(e.severity).toBe("warning");
    expect(e.data).toEqual({ retryAfterMs: 500, bucket: "writes" });
    expect(Object.isFrozen(e.data)).toBe(true);
    expectTypeOf(e.data).toEqualTypeOf<{ readonly retryAfterMs: number; readonly bucket: string }>();
    expectTypeOf(E.create("not_found").data).toEqualTypeOf<{}>();
  });

  it("enforces data at compile time", () => {
    // @ts-expect-error data is required for codes with fields
    expect(() => E.create("rate_limited")).toThrow(TypeError);
    // @ts-expect-error wrong field type
    E.create("rate_limited", { retryAfterMs: "soon", bucket: "w" });
    // @ts-expect-error unknown code
    expect(() => E.create("nope")).toThrow(/Unknown error code/);
  });

  it("enforces data at runtime (undeclared, missing, non-JSON)", () => {
    const bad = (data: unknown) => () => E.create("rate_limited", data as never);
    expect(bad({ retryAfterMs: 1 })).toThrow(/missing \[bucket\]/);
    expect(bad({ retryAfterMs: 1, bucket: "b", extra: 1 })).toThrow(/unexpected \[extra\]/);
    expect(bad({ retryAfterMs: Number.NaN, bucket: "b" })).toThrow(/not JSON-safe/);
    expect(bad({ retryAfterMs: new Date(), bucket: "b" })).toThrow(/not JSON-safe/);
    expect(bad({ retryAfterMs: undefined, bucket: "b" })).toThrow(/not JSON-safe/);
  });

  it("fail returns an Err; is() narrows and is registry-scoped", () => {
    const r = E.fail("not_found");
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("not_found");
    const thrown: unknown = E.create("rate_limited", { retryAfterMs: 1, bucket: "b" });
    if (E.is(thrown, "rate_limited")) expectTypeOf(thrown.data.retryAfterMs).toEqualTypeOf<number>();
    expect(E.is(thrown)).toBe(true);
    expect(E.is(thrown, "not_found")).toBe(false);
    const other = defineErrors({ not_found: { ...coreSpecs.not_found } }, { fallback: "not_found" });
    expect(E.is(other.create("not_found"))).toBe(false);
    expect(E.is(new Error("x"))).toBe(false);
  });

  it("keeps the cause for debugging without serializing it", () => {
    const cause = new Error(CANARY_TEXT);
    const e = E.create("dependency_unavailable", { attempt: 2, detail: "db" }, { cause });
    expect(e.cause).toBe(cause);
    expect(JSON.stringify(e)).not.toContain(CANARY_TEXT);
    expect(JSON.stringify(E.toLogRecord(e))).not.toContain(CANARY_TEXT);
    expect(JSON.stringify(E.toPayload(e))).not.toContain(CANARY_TEXT);
    // Documented limitation: Node's inspect prints the cause chain.
    expect(inspect(e)).toContain(CANARY_TEXT);
  });
});

describe("toPayload (server boundary, ConvexError data)", () => {
  it("public code: static message + client fields only", () => {
    expect(E.toPayload(E.create("rate_limited", { retryAfterMs: 250, bucket: "writes" }))).toEqual({
      code: "rate_limited",
      message: "Too many requests. Please wait and retry.",
      data: { retryAfterMs: 250 },
    });
    expect(E.toPayload(limitError())).toEqual({
      code: "example.limit_exceeded",
      message: "This exceeds an allowed limit.",
      data: { resource: "seats" },
    });
  });

  it("internal codes, foreign errors and garbage all become the fallback", () => {
    const fallback = { code: "internal", message: "Something went wrong. Please try again.", data: {} };
    expect(E.toPayload(E.create("dependency_unavailable", { attempt: 1, detail: CANARY_TEXT }))).toEqual(fallback);
    expect(E.toPayload(new Error(`db password ${CANARY_TEXT}`))).toEqual(fallback);
    expect(E.toPayload(`raw ${CANARY_TEXT}`)).toEqual(fallback);
    expect(E.toPayload(undefined)).toEqual(fallback);
    expect(E.toPayload({ code: "rate_limited", message: "m" })).toEqual(fallback);
    expect(E.toPayload({ code: "made_up", message: CANARY_TEXT, data: {} })).toEqual(fallback);
    expect(E.toPayload({ code: "dependency_unavailable", message: "x", data: {} })).toEqual(fallback);
  });

  it("re-derives message and fields from the registry for wire payloads", () => {
    const forged = { code: "rate_limited", message: `forged ${CANARY_TEXT}`, data: { retryAfterMs: 9, bucket: CANARY_TEXT } };
    expect(E.toPayload(forged)).toEqual({
      code: "rate_limited",
      message: "Too many requests. Please wait and retry.",
      data: { retryAfterMs: 9 },
    });
    // A declared client field is missing -> not trustworthy -> fallback.
    expect(E.toPayload({ code: "rate_limited", message: "m", data: {} }).code).toBe("internal");
  });
});

describe("toClientError (client-side mapper)", () => {
  it("maps known public errors with flags and narrows data by code", () => {
    const ce = E.toClientError(E.create("rate_limited", { retryAfterMs: 100, bucket: "b" }));
    expect(ce).toEqual({
      code: "rate_limited",
      message: "Too many requests. Please wait and retry.",
      data: { retryAfterMs: 100 },
      retryable: true,
      severity: "warning",
      isFallback: false,
    });
    if (ce.code === "rate_limited") expectTypeOf(ce.data).toEqualTypeOf<{ readonly retryAfterMs: number }>();
    if (ce.code === "example.limit_exceeded") expectTypeOf(ce.data).toEqualTypeOf<{ readonly resource: string }>();
  });

  it("never offers internal codes to the UI type", () => {
    type Code = ClientError<S, "internal">["code"];
    expectTypeOf<Code>().toEqualTypeOf<"internal" | "not_found" | "rate_limited" | "example.limit_exceeded">();
    const ce = E.toClientError(new TypeError("Cannot read properties of undefined (reading 'budget')"));
    expect(ce).toMatchObject({ code: "internal", isFallback: true, retryable: false, data: {} });
    expect(ce.message).toBe("Something went wrong. Please try again.");
  });
});

describe("logging and the privacy canary", () => {
  it("log records keep client + log fields and drop secrets", () => {
    expect(E.toLogRecord(E.create("dependency_unavailable", { attempt: 3, detail: CANARY_TEXT }))).toEqual({
      code: "dependency_unavailable",
      severity: "error",
      retryable: true,
      exposure: "internal",
      data: { attempt: 3 },
      known: true,
    });
    expect(E.toLogRecord(new RangeError(CANARY_TEXT))).toEqual({
      code: "internal",
      severity: "error",
      retryable: false,
      exposure: "internal",
      data: {},
      known: false,
      errorName: "RangeError",
    });
    expect(E.toLogRecord({ boom: 1 }).errorName).toBe("object");
  });

  it("secret fields never appear in any serialized or printed form", () => {
    const e = limitError();
    const surfaces = [
      e.message,
      String(e),
      e.stack ?? "",
      JSON.stringify(e),
      inspect(e),
      inspect(e, { depth: 10 }),
      JSON.stringify(E.toPayload(e)),
      JSON.stringify(E.toClientError(e)),
      JSON.stringify(E.toLogRecord(e)),
      JSON.stringify(E.describe()),
    ];
    for (const s of surfaces) {
      expect(s).not.toContain(CANARY_TEXT);
      expect(s).not.toContain(String(CANARY_NUMBER));
    }
    // The data is still available in-process for code that needs it.
    expect(e.data.limitMinor).toBe(CANARY_NUMBER);
  });
});

describe("exhaustiveness", () => {
  it("match requires a handler for every code", () => {
    const label = (e: Parameters<typeof E.match>[0]) =>
      E.match(e, {
        internal: () => "i",
        not_found: () => "nf",
        rate_limited: (x) => `rl${x.data.retryAfterMs}`,
        dependency_unavailable: (x) => `du${x.data.attempt}`,
        "example.limit_exceeded": (x) => x.data.resource,
      });
    expect(label(E.create("rate_limited", { retryAfterMs: 5, bucket: "b" }))).toBe("rl5");
    // @ts-expect-error missing handlers is a compile error
    expect(() => E.match(E.create("not_found"), { internal: () => 1 })).toThrow(/No handler/);
  });

  it("table must cover every code, at compile time and runtime", () => {
    const httpStatus = E.table({
      internal: 500,
      not_found: 404,
      rate_limited: 429,
      dependency_unavailable: 503,
      "example.limit_exceeded": 422,
    });
    expect(httpStatus.rate_limited).toBe(429);
    // @ts-expect-error missing keys
    expect(() => E.table({ internal: 500 })).toThrow(ExhaustivenessError);
    expect(E.codes).toEqual(Object.keys(E.describe()));
  });

  it("describe is a JSON-safe catalog with field visibilities", () => {
    const catalog = E.describe();
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    expect(catalog["example.limit_exceeded"]?.fields).toEqual({ resource: "client", limitMinor: "secret", note: "secret" });
  });
});
