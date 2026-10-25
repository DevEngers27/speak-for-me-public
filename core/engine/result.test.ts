import { describe, expect, expectTypeOf, it } from "vitest";
import {
  all,
  andThen,
  collect,
  err,
  fromNullable,
  isErr,
  isOk,
  isResult,
  map,
  mapErr,
  match,
  ok,
  orElse,
  partition,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapErr,
  unwrapOr,
  unwrapOrElse,
  UnwrapError,
  type Result,
} from "./result";

const parsePositive = (n: number): Result<number, "negative"> => (n >= 0 ? ok(n) : err("negative"));

describe("Result basics", () => {
  it("has a plain, serializable shape", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("x")).toEqual({ ok: false, error: "x" });
    expect(ok()).toEqual({ ok: true, value: null });
    expectTypeOf(ok()).toEqualTypeOf<{ readonly ok: true; readonly value: null }>();
    const r: Result<{ a: number[] }, { code: string }> = ok({ a: [1, 2] });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("narrows with isOk / isErr and the ok discriminant", () => {
    const r = parsePositive(3);
    if (isOk(r)) expectTypeOf(r.value).toEqualTypeOf<number>();
    if (isErr(r)) expectTypeOf(r.error).toEqualTypeOf<"negative">();
    if (r.ok) expect(r.value).toBe(3);
    expect(isErr(parsePositive(-1))).toBe(true);
  });

  it("maps and chains", () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err("e") as Result<number, string>, (n) => n * 2)).toEqual(err("e"));
    expect(mapErr(err("e"), (e) => `${e}!`)).toEqual(err("e!"));
    expect(andThen(ok(-5), parsePositive)).toEqual(err("negative"));
    expect(andThen(ok(5), parsePositive)).toEqual(ok(5));
    expect(orElse(err("negative") as Result<number, "negative">, () => ok(0))).toEqual(ok(0));
    expect(unwrapOr(parsePositive(-1), 7)).toBe(7);
    expect(unwrapOrElse(parsePositive(-1), (e) => e.length)).toBe(8);
    expect(match(parsePositive(1), { ok: (v) => `v${v}`, err: (e) => e })).toBe("v1");
  });

  it("unwrap throws a fixed message and keeps the error only as cause", () => {
    const secret = { amount: 123456 };
    try {
      unwrap(err(secret));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnwrapError);
      expect((e as Error).message).not.toContain("123456");
      expect((e as Error).cause).toBe(secret);
    }
    expect(unwrapErr(err("x"))).toBe("x");
    expect(() => unwrapErr(ok(1))).toThrow(UnwrapError);
  });
});

describe("combinators", () => {
  it("all short-circuits on the first error and preserves tuple types", () => {
    const a = all([ok(1), ok("s")]);
    expectTypeOf(a).toEqualTypeOf<Result<[number, string], never>>();
    const mixed = all([parsePositive(1), ok("s")]);
    expectTypeOf(mixed).toEqualTypeOf<Result<[number, string], "negative">>();
    expect(a).toEqual(ok([1, "s"]));
    const b = all([ok(1), err("first"), err("second")]);
    expect(b).toEqual(err("first"));
  });

  it("collect returns every error in order", () => {
    expect(collect([ok(1), err("a"), ok(2), err("b")])).toEqual(err(["a", "b"]));
    expect(collect([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(collect([])).toEqual(ok([]));
    expect(partition([ok(1), err("a"), ok(2)])).toEqual({ values: [1, 2], errors: ["a"] });
  });

  it("fromNullable and tryCatch", async () => {
    expect(fromNullable(null, "missing")).toEqual(err("missing"));
    expect(fromNullable(0, "missing")).toEqual(ok(0));
    expect(tryCatch(() => JSON.parse("{"), () => "bad_json" as const)).toEqual(err("bad_json"));
    expect(tryCatch(() => 1, () => "x")).toEqual(ok(1));
    expect(await tryCatchAsync(() => Promise.reject(new Error("boom")), () => "failed")).toEqual(err("failed"));
    expect(await tryCatchAsync(async () => 2, () => "failed")).toEqual(ok(2));
  });

  it("isResult recognises results after a serialization round trip", () => {
    expect(isResult(JSON.parse(JSON.stringify(ok(null))))).toBe(true);
    expect(isResult(JSON.parse(JSON.stringify(err({ code: "x" }))))).toBe(true);
    expect(isResult({ ok: true })).toBe(false);
    expect(isResult({ ok: "yes", value: 1 })).toBe(false);
    expect(isResult(null)).toBe(false);
  });
});
