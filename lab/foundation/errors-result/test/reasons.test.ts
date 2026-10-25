import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertNever,
  defineReasonCodes,
  ExhaustivenessError,
  mergeReasonSpecs,
  param,
  ReasonCodeUsageError,
  ReasonRegistryDefinitionError,
  type IsoDate,
  type ParamSpec,
  type PublicReasonParamsOf,
  type Reason,
  type ReasonSpecMap,
} from "../src/index.js";
import { R, ruleReasonSpecs } from "./fixtures.js";

type AnyReason = Reason<typeof ruleReasonSpecs>;

describe("make", () => {
  it("builds typed, frozen, plain reasons", () => {
    const r = R.make("limit.exceeded", { overByMinor: 10000, limitMinor: 480000 });
    expect(r).toEqual({ reasonCode: "limit.exceeded", params: { overByMinor: 10000, limitMinor: 480000 } });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.params)).toBe(true);
    expectTypeOf(r).toEqualTypeOf<{
      readonly reasonCode: "limit.exceeded";
      readonly params: { readonly overByMinor: number; readonly limitMinor: number };
    }>();
    expect(R.make("empty")).toEqual({ reasonCode: "empty", params: {} });
    const d = R.make("date.too_late", { proposed: "2026-12-20", latestAllowed: "2026-12-15" });
    expectTypeOf(d.params.proposed).toEqualTypeOf<IsoDate>();
    expectTypeOf(R.make("mode.unsupported", { mode: "fast" }).params.mode).toEqualTypeOf<"fast" | "safe">();
  });

  it("serializes canonically regardless of input key order", () => {
    const a = R.make("version.stale", { expected: 2, actual: 3 });
    const b = R.make("version.stale", { actual: 3, expected: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe('{"reasonCode":"version.stale","params":{"expected":2,"actual":3}}');
  });

  it("rejects bad params at compile time", () => {
    // @ts-expect-error amount must be a number in minor units, not text
    expect(() => R.make("limit.within", { headroomMinor: "$4,800" })).toThrow(ReasonCodeUsageError);
    // @ts-expect-error missing param
    expect(() => R.make("version.stale", { expected: 1 })).toThrow(/missing_param at version.stale.actual/);
    // @ts-expect-error not an enum member
    expect(() => R.make("mode.unsupported", { mode: "turbo" })).toThrow(/invalid_param/);
    // @ts-expect-error unknown code
    expect(() => R.make("free text reason")).toThrow(/unknown_code/);
    // @ts-expect-error params required
    expect(() => R.make("item.unknown")).toThrow(/missing_param/);
  });

  it.each([
    ["unsafe integer", "limit.within", { headroomMinor: 2 ** 60 }],
    ["fractional cents", "limit.within", { headroomMinor: 10.5 }],
    ["negative count", "version.stale", { expected: -1, actual: 0 }],
    ["impossible date", "date.too_late", { proposed: "2026-02-30", latestAllowed: "2026-03-01" }],
    ["non-ISO date", "date.too_late", { proposed: "Dec 20", latestAllowed: "2026-03-01" }],
    ["prose in a key", "item.unknown", { itemKey: "over budget by $4,800" }],
    ["digits-first key", "item.unknown", { itemKey: "4800" }],
    ["prose in keys", "item.required_missing", { itemKeys: ["ok", "not ok"] }],
    ["too many keys", "item.required_missing", { itemKeys: Array.from({ length: 257 }, (_, i) => `k${i}`) }],
    ["bad id", "doc.flagged", { docId: "has space", confirmed: true, delta: 0 }],
    ["string bool", "doc.flagged", { docId: "abc123", confirmed: "yes", delta: 0 }],
    ["extra param", "version.stale", { expected: 1, actual: 2, note: "x" }],
  ])("runtime rejects %s without echoing the value", (_label, code, params) => {
    const r = R.tryMake(code as never, params as never);
    expect(r.ok).toBe(false);
    try {
      R.make(code as never, params as never);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReasonCodeUsageError);
      for (const v of Object.values(params)) {
        if (typeof v === "string" && v.length > 3) expect((e as Error).message).not.toContain(v);
      }
    }
  });

  it("accepts negative cents deltas and boundary values", () => {
    expect(R.tryMake("limit.within", { headroomMinor: -100 }).ok).toBe(true);
    expect(R.tryMake("version.stale", { expected: 0, actual: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
    expect(R.tryMake("date.too_late", { proposed: "2028-02-29", latestAllowed: "2028-03-01" }).ok).toBe(true);
    expect(R.tryMake("item.required_missing", { itemKeys: [] }).ok).toBe(true);
    expect(R.tryMake("item.unknown", { itemKey: "item_3:v2.a-b" }).ok).toBe(true);
  });
});

describe("parse (untrusted input)", () => {
  it("round-trips through JSON", () => {
    const original = R.make("item.required_missing", { itemKeys: ["LOGIN", "REPORTS"] });
    const back = R.parse(JSON.parse(JSON.stringify(original)));
    expect(back).toEqual({ ok: true, value: original });
  });

  it("reports structured issues without values", () => {
    expect(R.parse("x")).toEqual({ ok: false, error: { kind: "not_object" } });
    expect(R.parse({ reasonCode: "Budget is $4,800 short", params: {} })).toEqual({
      ok: false,
      error: { kind: "unknown_code" },
    });
    expect(R.parse({ reasonCode: "budget.gone", params: {} })).toEqual({
      ok: false,
      error: { kind: "unknown_code", reasonCode: "budget.gone" },
    });
    expect(R.parse({ reasonCode: "empty", params: {}, text: "free" })).toEqual({
      ok: false,
      error: { kind: "unexpected_param", reasonCode: "empty" },
    });
    expect(R.parse({ reasonCode: "empty", params: { "my note": 1 } })).toEqual({
      ok: false,
      error: { kind: "unexpected_param", reasonCode: "empty" },
    });
    expect(R.is(R.make("empty"))).toBe(true);
    expect(R.is({ reasonCode: "empty" })).toBe(false);
  });

  it("parseMany returns every issue with its index", () => {
    const res = R.parseMany([R.make("empty"), { reasonCode: "nope", params: {} }, R.make("empty"), 7]);
    expect(res).toEqual({
      ok: false,
      error: [
        { kind: "unknown_code", reasonCode: "nope", index: 1 },
        { kind: "not_object", index: 3 },
      ],
    });
    expect(R.parseMany([R.make("empty")]).ok).toBe(true);
    expect(R.parseMany({}).ok).toBe(false);
  });
});

describe("audience projection", () => {
  const over = R.make("limit.exceeded", { overByMinor: 10000, limitMinor: 480000 });

  it("withholds restricted params unless allowed", () => {
    expect(R.project(over, { includeRestricted: false })).toEqual({
      reasonCode: "limit.exceeded",
      params: {},
      withheld: ["limitMinor", "overByMinor"],
    });
    expect(R.project(over, { includeRestricted: true })).toEqual({ ...over, withheld: [] });
    const late = R.make("date.too_late", { proposed: "2026-12-20", latestAllowed: "2026-12-15" });
    expect(R.project(late, { includeRestricted: false })).toEqual({
      reasonCode: "date.too_late",
      params: { proposed: "2026-12-20" },
      withheld: ["latestAllowed"],
    });
    expect(JSON.stringify(R.project(over, { includeRestricted: false }))).not.toContain("480000");
    expect(R.restrictedParams("limit.exceeded")).toEqual(["overByMinor", "limitMinor"]);
    expect(R.restrictedParams("item.unknown")).toEqual([]);
  });

  it("keeps the restricted flag as a literal type inside a registry", () => {
    expectTypeOf(ruleReasonSpecs["limit.exceeded"].params.overByMinor).toEqualTypeOf<ParamSpec<number, true>>();
    expectTypeOf(ruleReasonSpecs["date.too_late"].params.proposed).toEqualTypeOf<ParamSpec<IsoDate, false>>();
    expectTypeOf<PublicReasonParamsOf<typeof ruleReasonSpecs, "date.too_late">>().toEqualTypeOf<{
      readonly proposed: IsoDate;
    }>();
    expectTypeOf<PublicReasonParamsOf<typeof ruleReasonSpecs, "limit.exceeded">>().toEqualTypeOf<{}>();
    expect(param.restricted(param.int())).toEqual({ kind: "int", restricted: true });
  });

  it("exposes typed meta", () => {
    expect(R.meta("limit.exceeded")).toEqual({ blocking: true });
    expectTypeOf(R.meta("limit.exceeded")).toEqualTypeOf<{ readonly blocking: true }>();
    expect(R.meta("empty")).toBeUndefined();
    expectTypeOf(R.meta("empty")).toEqualTypeOf<undefined>();
  });
});

describe("exhaustiveness", () => {
  // A switch with assertNever: adding a code to the registry breaks compilation here.
  function severityOf(r: AnyReason): "block" | "info" {
    switch (r.reasonCode) {
      case "limit.exceeded":
      case "item.unknown":
      case "item.required_missing":
      case "date.too_late":
      case "version.stale":
      case "mode.unsupported":
        return "block";
      case "limit.within":
      case "doc.flagged":
      case "empty":
        return "info";
      default:
        return assertNever(r, "severityOf");
    }
  }

  it("switch + assertNever covers every code", () => {
    expect(severityOf(R.make("empty"))).toBe("info");
    expect(() => severityOf({ reasonCode: "x", params: {} } as never)).toThrow(ExhaustivenessError);
  });

  it("match gives typed params per code and requires all handlers", () => {
    const text = (r: AnyReason) =>
      R.match(r, {
        "limit.within": () => "Within the limit.",
        "limit.exceeded": () => "Over the limit.",
        "item.unknown": (p) => `Unknown item ${p.itemKey}.`,
        "item.required_missing": (p) => `Missing ${p.itemKeys.join(", ")}.`,
        "date.too_late": (p) => `Proposed ${p.proposed} is too late.`,
        "version.stale": (p) => `Version ${p.actual} != ${p.expected}.`,
        "mode.unsupported": (p) => `Mode ${p.mode}.`,
        "doc.flagged": (p) => `Doc ${p.docId}.`,
        empty: () => "Nothing.",
      });
    expect(text(R.make("item.unknown", { itemKey: "EXPORT" }))).toBe("Unknown item EXPORT.");
    // @ts-expect-error missing handlers
    expect(() => R.match(R.make("empty"), { "limit.within": () => "" })).toThrow(ReasonCodeUsageError);
  });

  it("table must be total; describe covers every code and is JSON-safe", () => {
    const templates = R.table({
      "limit.within": "a",
      "limit.exceeded": "b",
      "item.unknown": "c",
      "item.required_missing": "d",
      "date.too_late": "e",
      "version.stale": "f",
      "mode.unsupported": "g",
      "doc.flagged": "h",
      empty: "i",
    });
    expect(Object.keys(templates)).toEqual([...R.codes]);
    // @ts-expect-error incomplete table
    expect(() => R.table({ empty: "i" })).toThrow(/missing \[limit.within/);
    // @ts-expect-error extra key
    expect(() => R.table({ ...templates, bogus: "x" })).toThrow(/unexpected \[bogus\]/);
    const catalog = R.describe();
    expect(Object.keys(catalog)).toEqual([...R.codes]);
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    expect(catalog["mode.unsupported"]).toEqual({
      params: { mode: { kind: "enum", restricted: false, values: ["fast", "safe"] } },
    });
  });
});

describe("definition-time validation", () => {
  const def = (s: ReasonSpecMap) => () => defineReasonCodes(s);
  it("rejects codes, params and enums that could carry free text", () => {
    expect(def({ "over budget by $100": {} })).toThrow(ReasonRegistryDefinitionError);
    expect(def({ ok: { params: { "a b": param.int() } } })).toThrow(/invalid param name/);
    expect(def({ ok: { params: { m: param.oneOf(["fine", "over $5"]) } } })).toThrow(/key-shaped/);
    expect(def({ ok: { params: { m: param.oneOf(["a", "a"]) } } })).toThrow(/unique/);
    expect(def({ ok: { params: { m: { kind: "string" as never, restricted: false } } } })).toThrow(/unknown kind/);
    expect(def({ ok: { params: { m: { kind: "int", restricted: false, values: ["a"] } } } })).toThrow(/only allowed for enum/);
    expect(def({ ok: { meta: { at: new Date() as never } } })).toThrow(/meta/);
    expect(() => mergeReasonSpecs(ruleReasonSpecs, { empty: {} })).toThrow(/Duplicate reason codes: empty/);
    expect(defineReasonCodes(mergeReasonSpecs(ruleReasonSpecs, { "x.other": {} })).codes).toContain("x.other");
  });
});
