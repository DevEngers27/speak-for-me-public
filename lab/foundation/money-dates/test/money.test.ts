import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  MAX_CENTS,
  MoneyError,
  absCents,
  addCents,
  allocateCents,
  assertCents,
  cents,
  centsToDecimalString,
  centsToInputString,
  compareCents,
  differenceCents,
  formatCents,
  isCents,
  maxCents,
  minCents,
  multiplyCents,
  parseCents,
  parseCentsOrThrow,
  scaleCents,
  signedCents,
  splitCentsEvenly,
  subtractCents,
  sumCents,
  toCents,
  type Cents,
  type RoundingMode,
  type SignedCents,
} from "../src";

const RUNS = { numRuns: 2000 };
const anyCents = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }).map((n) => n as Cents);
// Small enough that sums of a handful never overflow.
const smallCents = fc.integer({ min: 0, max: 1_000_000_000_000 }).map((n) => n as Cents);
const anySigned = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }).map((n) => n as SignedCents);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof MoneyError) return e.code;
    throw e;
  }
  return undefined;
}

describe("guards and constructors", () => {
  test("accepts non-negative safe integers only", () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(480000)).toBe(true);
    expect(isCents(Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const bad of [-1, 0.5, 4800.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "480000", null, undefined, 1n]) {
      expect(isCents(bad)).toBe(false);
    }
  });

  test("assertCents reports a specific code and never echoes the value", () => {
    expect(codeOf(() => assertCents(1.5))).toBe("NOT_SAFE_INTEGER");
    expect(codeOf(() => assertCents(-100))).toBe("NEGATIVE");
    expect(codeOf(() => assertCents(100_000_001, { max: 100_000_000 }))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => assertCents(100_000_000, { max: 100_000_000 }))).toBeUndefined();
    try {
      assertCents(-987654);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("987654");
    }
  });

  test("normalizes -0", () => {
    expect(Object.is(cents(-0), 0)).toBe(true);
    expect(Object.is(signedCents(-0), 0)).toBe(true);
    expect(formatCents(cents(-0))).toBe("$0");
  });
});

describe("arithmetic", () => {
  test("worked budget example stays exact", () => {
    const total = parseCentsOrThrow("$5,000");
    const committed = parseCentsOrThrow("$4,000");
    const phaseOne = parseCentsOrThrow("$900");
    const lowered = parseCentsOrThrow("$4,800");
    const projected = addCents(committed, phaseOne);
    expect(projected).toBe(490000);
    expect(compareCents(projected, total)).toBe(-1);
    expect(compareCents(projected, lowered)).toBe(1);
    expect(differenceCents(lowered, projected)).toBe(-10000);
    expect(absCents(differenceCents(lowered, projected))).toBe(10000);
    expect(subtractCents(lowered, committed)).toBe(80000);
  });

  test("ten dimes are exactly one dollar (no float drift)", () => {
    const dime = parseCentsOrThrow("0.10");
    expect(sumCents(new Array<Cents>(10).fill(dime))).toBe(100);
    expect(centsToDecimalString(addCents(parseCentsOrThrow("0.1"), parseCentsOrThrow("0.2")))).toBe("0.30");
  });

  test("negative results and overflow are rejected", () => {
    expect(codeOf(() => subtractCents(cents(100), cents(101)))).toBe("NEGATIVE_RESULT");
    expect(codeOf(() => addCents(MAX_CENTS, cents(1)))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => toCents(signedCents(-1)))).toBe("NEGATIVE");
    expect(codeOf(() => multiplyCents(MAX_CENTS, 2))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => multiplyCents(cents(5), 1.5))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => sumCents([cents(1), -5 as Cents]))).toBe("NEGATIVE");
  });

  test("property: add is commutative, associative, and inverted by subtract", () => {
    fc.assert(
      fc.property(smallCents, smallCents, smallCents, (a, b, c) => {
        expect(addCents(a, b)).toBe(addCents(b, a));
        expect(addCents(addCents(a, b), c)).toBe(addCents(a, addCents(b, c)));
        expect(subtractCents(addCents(a, b), b)).toBe(a);
        expect(sumCents([a, b, c])).toBe(a + b + c);
      }),
      RUNS,
    );
  });

  test("property: difference is antisymmetric and consistent with compare", () => {
    fc.assert(
      fc.property(smallCents, smallCents, (a, b) => {
        const d = differenceCents(a, b);
        expect(differenceCents(b, a)).toBe(-d === 0 ? 0 : -d);
        expect(Math.sign(d)).toBe(compareCents(a, b));
        if (compareCents(a, b) >= 0) expect(subtractCents(a, b)).toBe(d);
        else expect(() => subtractCents(a, b)).toThrow(MoneyError);
        expect(minCents(a, b)).toBe(Math.min(a, b));
        expect(maxCents(a, b)).toBe(Math.max(a, b));
      }),
      RUNS,
    );
  });

  test("property: multiply matches bigint arithmetic", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 100_000 }), (u, q) => {
        expect(multiplyCents(u as Cents, q)).toBe(Number(BigInt(u) * BigInt(q)));
      }),
      RUNS,
    );
  });
});

describe("scaleCents", () => {
  test("examples per rounding mode", () => {
    // 25 * 1/2 = 12.5
    expect(scaleCents(cents(25), 1, 2, "floor")).toBe(12);
    expect(scaleCents(cents(25), 1, 2, "ceil")).toBe(13);
    expect(scaleCents(cents(25), 1, 2, "half-up")).toBe(13);
    expect(scaleCents(cents(25), 1, 2, "half-even")).toBe(12);
    expect(scaleCents(cents(35), 1, 2, "half-even")).toBe(18);
    // 10% of $1,400 in basis points
    expect(scaleCents(cents(140000), 1000, 10000, "half-even")).toBe(14000);
    expect(codeOf(() => scaleCents(cents(1), 1, 0, "floor"))).toBe("INVALID_ARGUMENT");
  });

  test("property: modes bracket the exact quotient", () => {
    const modes: RoundingMode[] = ["floor", "ceil", "half-up", "half-even"];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }).map((n) => n as Cents), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (a, n, d) => {
        const [lo, hi, hu, he] = modes.map((m) => scaleCents(a, n, d, m));
        const exact = BigInt(a) * BigInt(n);
        expect(BigInt(lo!) * BigInt(d) <= exact).toBe(true);
        expect(BigInt(hi!) * BigInt(d) >= exact).toBe(true);
        expect(hi! - lo!).toBeLessThanOrEqual(1);
        expect([lo, hi]).toContain(hu);
        expect([lo, hi]).toContain(he);
        expect(scaleCents(a, d, d, "floor")).toBe(a);
      }),
      RUNS,
    );
    expect(codeOf(() => scaleCents(MAX_CENTS, 3, 2, "floor"))).toBe("OUT_OF_RANGE");
  });
});

describe("allocation", () => {
  test("examples", () => {
    expect(splitCentsEvenly(cents(100), 3)).toEqual([34, 33, 33]);
    expect(allocateCents(cents(100), [1, 1, 1])).toEqual([34, 33, 33]);
    // Exact shares 1.5 and 3.5: equal remainders, so the spare cent goes to the lower index.
    expect(allocateCents(cents(5), [3, 7])).toEqual([2, 3]);
    expect(allocateCents(cents(10), [1, 2])).toEqual([3, 7]); // 3.33 / 6.67: larger remainder wins
    expect(allocateCents(cents(1000), [0, 1, 0])).toEqual([0, 1000, 0]);
    expect(allocateCents(cents(0), [2, 5])).toEqual([0, 0]);
    expect(codeOf(() => allocateCents(cents(1), []))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => allocateCents(cents(1), [0, 0]))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => allocateCents(cents(1), [1, -1]))).toBe("INVALID_ARGUMENT");
  });

  test("property: no cent lost or invented, each part within one cent of its exact share", () => {
    fc.assert(
      fc.property(anyCents, fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 }), (total, weights) => {
        fc.pre(weights.some((w) => w > 0));
        const parts = allocateCents(total, weights);
        const W = BigInt(weights.reduce((s, w) => s + w, 0));
        expect(parts).toHaveLength(weights.length);
        expect(parts.reduce((s, p) => s + BigInt(p), 0n)).toBe(BigInt(total));
        parts.forEach((p, i) => {
          expect(isCents(p)).toBe(true);
          const exact = BigInt(total) * BigInt(weights[i]!);
          const scaled = BigInt(p) * W;
          expect(scaled > exact - W && scaled < exact + W).toBe(true);
          if (weights[i] === 0) expect(p).toBe(0);
        });
        expect(allocateCents(total, weights)).toEqual(parts); // deterministic
      }),
      RUNS,
    );
  });

  test("property: even split differs by at most one cent, extras first", () => {
    fc.assert(
      fc.property(anyCents, fc.integer({ min: 1, max: 50 }), (total, n) => {
        const parts = splitCentsEvenly(total, n);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        expect([...parts].sort((a, b) => b - a)).toEqual(parts);
      }),
      RUNS,
    );
  });
});

describe("parseCents", () => {
  test.each([
    ["$4,800", 480000],
    ["4800", 480000],
    ["4800.50", 480050],
    ["4,800.5", 480050],
    ["$ 1,234,567.89", 123456789],
    ["  $12.3  ", 1230],
    [".99", 99],
    ["$.05", 5],
    ["0", 0],
    ["$0.00", 0],
    ["007", 700],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("accepts %j", (input, expected) => {
    expect(parseCents(input)).toEqual({ ok: true, value: expected });
  });

  test.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["$", "EMPTY"],
    ["-5", "NEGATIVE"],
    ["-$5", "NEGATIVE"],
    ["$-5", "NEGATIVE"],
    ["−5", "NEGATIVE"],
    ["($5.00)", "NEGATIVE"],
    ["4.555", "TOO_MANY_DECIMALS"],
    ["1.500", "TOO_MANY_DECIMALS"],
    ["4,80", "INVALID_FORMAT"],
    ["48,00", "INVALID_FORMAT"],
    ["4.800,00", "INVALID_FORMAT"],
    ["1,2345", "INVALID_FORMAT"],
    [",100", "INVALID_FORMAT"],
    ["0,100", "INVALID_FORMAT"],
    ["4 800", "INVALID_FORMAT"],
    ["4800.", "INVALID_FORMAT"],
    [".", "INVALID_FORMAT"],
    ["1e3", "INVALID_FORMAT"],
    ["Infinity", "INVALID_FORMAT"],
    ["NaN", "INVALID_FORMAT"],
    ["0x10", "INVALID_FORMAT"],
    ["+5", "INVALID_FORMAT"],
    ["USD 5", "INVALID_FORMAT"],
    ["$$5", "INVALID_FORMAT"],
    ["１２", "INVALID_FORMAT"],
    ["1".repeat(65), "INVALID_FORMAT"],
    ["90071992547409.92", "OUT_OF_RANGE"],
    ["99999999999999999999", "OUT_OF_RANGE"],
  ])("rejects %j as %s", (input, error) => {
    expect(parseCents(input)).toEqual({ ok: false, error });
  });

  test("max option and throwing variant", () => {
    expect(parseCents("$1,000,000.00", { max: 100_000_000 })).toEqual({ ok: true, value: 100_000_000 });
    expect(parseCents("$1,000,000.01", { max: 100_000_000 })).toEqual({ ok: false, error: "OUT_OF_RANGE" });
    expect(codeOf(() => parseCentsOrThrow("-1"))).toBe("NEGATIVE");
    expect(parseCents(42 as unknown as string)).toEqual({ ok: false, error: "INVALID_FORMAT" });
  });

  test("property: format / input / decimal strings round-trip", () => {
    fc.assert(
      fc.property(anyCents, (c) => {
        expect(parseCentsOrThrow(formatCents(c))).toBe(c);
        expect(parseCentsOrThrow(formatCents(c, { fraction: "always" }))).toBe(c);
        expect(parseCentsOrThrow(centsToInputString(c))).toBe(c);
        expect(parseCentsOrThrow(centsToDecimalString(c))).toBe(c);
      }),
      RUNS,
    );
  });

  test("property: equivalent spellings of the same amount parse identically", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 90_071_992_547_408 }), fc.integer({ min: 0, max: 99 }), fc.boolean(), (whole, frac, dollar) => {
        const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        const f2 = frac.toString().padStart(2, "0");
        const expected = whole * 100 + frac;
        const prefix = dollar ? "$" : "";
        expect(parseCentsOrThrow(`${prefix}${whole}.${f2}`)).toBe(expected);
        expect(parseCentsOrThrow(`${prefix}${grouped}.${f2}`)).toBe(expected);
        if (frac % 10 === 0) expect(parseCentsOrThrow(`${prefix}${grouped}.${frac / 10}`)).toBe(expected);
        if (frac === 0) expect(parseCentsOrThrow(`${prefix}${grouped}`)).toBe(expected);
      }),
      RUNS,
    );
  });

  test("property: never throws and only ever returns valid Cents", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        const r = parseCents(s);
        if (r.ok) expect(isCents(r.value)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("formatting", () => {
  test.each([
    [0, "$0", "$0.00", "0", "0.00"],
    [5, "$0.05", "$0.05", "0.05", "0.05"],
    [480000, "$4,800", "$4,800.00", "4800", "4800.00"],
    [480050, "$4,800.50", "$4,800.50", "4800.50", "4800.50"],
    [123456789, "$1,234,567.89", "$1,234,567.89", "1234567.89", "1234567.89"],
  ])("%d", (value, auto, always, input, decimal) => {
    const c = cents(value);
    expect(formatCents(c)).toBe(auto);
    expect(formatCents(c, { fraction: "always" })).toBe(always);
    expect(centsToInputString(c)).toBe(input);
    expect(centsToDecimalString(c)).toBe(decimal);
  });

  test("signed values", () => {
    expect(formatCents(signedCents(-1230))).toBe("-$12.30");
    expect(formatCents(signedCents(-10000))).toBe("-$100");
    expect(centsToDecimalString(signedCents(-5))).toBe("-0.05");
    expect(codeOf(() => formatCents(1.5 as SignedCents))).toBe("NOT_SAFE_INTEGER");
  });

  test("property: decimal string matches bigint rendering for signed values", () => {
    fc.assert(
      fc.property(anySigned, (s) => {
        const abs = BigInt(Math.abs(s));
        const expected = `${s < 0 ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
        expect(centsToDecimalString(s)).toBe(expected);
      }),
      RUNS,
    );
  });
});
