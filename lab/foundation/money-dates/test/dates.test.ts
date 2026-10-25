import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  DateError,
  MAX_ISO_DATE,
  MIN_ISO_DATE,
  addDays,
  assertIsoDate,
  compareIsoDates,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  fromEpochDay,
  isAfter,
  isBefore,
  isIsoDate,
  isLeapYear,
  isOnOrAfter,
  isOnOrBefore,
  isoDate,
  isoDateFromEpochMs,
  isoDateFromParts,
  isoDateParts,
  isoWeekday,
  maxIsoDate,
  minIsoDate,
  parseIsoDate,
  toEpochDay,
  type IsoDate,
} from "../src";

const RUNS = { numRuns: 2000 };
const MS_PER_DAY = 86_400_000;
const MIN_DAY = toEpochDay(MIN_ISO_DATE);
const MAX_DAY = toEpochDay(MAX_ISO_DATE);
const anyEpochDay = fc.integer({ min: MIN_DAY, max: MAX_DAY });
const anyDate = anyEpochDay.map(fromEpochDay);
const zodDate = z.iso.date();

/** Oracle: the host's UTC calendar (only UTC accessors, so host TZ is irrelevant). */
function oracle(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DateError) return e.code;
    throw e;
  }
  return undefined;
}

describe("validation", () => {
  test.each(["2026-10-24", "2028-02-29", "2000-02-29", "2026-12-31", "0000-01-01", "0000-02-29", "9999-12-31", "1970-01-01"])(
    "accepts %s",
    (s) => {
      expect(isIsoDate(s)).toBe(true);
      expect(parseIsoDate(s)).toEqual({ ok: true, value: s });
    },
  );

  test.each([
    ["2026-02-29", "INVALID_DATE"],
    ["2026-02-30", "INVALID_DATE"],
    ["2100-02-29", "INVALID_DATE"],
    ["1900-02-29", "INVALID_DATE"],
    ["2026-04-31", "INVALID_DATE"],
    ["2026-13-01", "INVALID_DATE"],
    ["2026-00-10", "INVALID_DATE"],
    ["2026-01-00", "INVALID_DATE"],
    ["2026-1-01", "INVALID_FORMAT"],
    ["26-01-01", "INVALID_FORMAT"],
    ["20260101", "INVALID_FORMAT"],
    [" 2026-01-01", "INVALID_FORMAT"],
    ["2026-01-01 ", "INVALID_FORMAT"],
    ["2026-01-01T00:00:00Z", "INVALID_FORMAT"],
    ["+002026-01-01", "INVALID_FORMAT"],
    ["2026/01/01", "INVALID_FORMAT"],
    ["２０２６-01-01", "INVALID_FORMAT"],
    ["", "INVALID_FORMAT"],
  ])("rejects %j as %s", (s, error) => {
    expect(isIsoDate(s)).toBe(false);
    expect(parseIsoDate(s)).toEqual({ ok: false, error });
    expect(codeOf(() => assertIsoDate(s))).toBe(error);
  });

  test("non-strings are rejected", () => {
    for (const v of [null, undefined, 20260101, new Date(0), {}]) {
      expect(parseIsoDate(v)).toEqual({ ok: false, error: "INVALID_FORMAT" });
    }
  });

  test("leap-year rules", () => {
    expect([1900, 2000, 2024, 2026, 2028, 2100, 2400].map(isLeapYear)).toEqual([false, true, true, false, true, false, true]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(codeOf(() => daysInMonth(2026, 13))).toBe("INVALID_ARGUMENT");
  });

  test("agrees with zod z.iso.date() on every month/day combination of edge years", () => {
    for (const year of ["0000", "0004", "0100", "1900", "1970", "2000", "2024", "2026", "2028", "2100", "2400", "9999"]) {
      for (let m = 0; m <= 13; m++) {
        for (let d = 0; d <= 32; d++) {
          const s = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          expect(isIsoDate(s), s).toBe(zodDate.safeParse(s).success);
        }
      }
    }
  });

  test("property: agrees with zod on random date-shaped and arbitrary strings", () => {
    const digits = (n: number) => fc.array(fc.constantFrom(..."0123456789"), { minLength: n, maxLength: n }).map((a) => a.join(""));
    const shaped = fc.tuple(digits(4), digits(2), digits(2)).map(([y, m, d]) => `${y}-${m}-${d}`);
    fc.assert(
      fc.property(fc.oneof(shaped, fc.string({ maxLength: 12 })), (s) => {
        expect(isIsoDate(s)).toBe(zodDate.safeParse(s).success);
      }),
      { numRuns: 5000 },
    );
  });
});

describe("construction and parts", () => {
  test("from parts", () => {
    expect(isoDateFromParts(2026, 11, 14)).toBe("2026-11-14");
    expect(isoDateFromParts(7, 1, 2)).toBe("0007-01-02");
    expect(codeOf(() => isoDateFromParts(2026, 2, 30))).toBe("INVALID_DATE");
    expect(codeOf(() => isoDateFromParts(2026, 13, 1))).toBe("INVALID_DATE");
    expect(codeOf(() => isoDateFromParts(10000, 1, 1))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => isoDate("2026-02-30"))).toBe("INVALID_DATE");
    expect(isoDateParts(isoDate("2028-02-29"))).toEqual({ year: 2028, month: 2, day: 29 });
  });

  test("property: epoch-day conversion matches the UTC oracle and round-trips", () => {
    fc.assert(
      fc.property(anyEpochDay, (n) => {
        const d = fromEpochDay(n);
        expect(d).toBe(oracle(n));
        expect(isIsoDate(d)).toBe(true);
        expect(toEpochDay(d)).toBe(n);
        const { year, month, day } = isoDateParts(d);
        expect(isoDateFromParts(year, month, day)).toBe(d);
      }),
      RUNS,
    );
  });

  test("range limits", () => {
    expect(toEpochDay(isoDate("1970-01-01"))).toBe(0);
    expect(codeOf(() => fromEpochDay(MAX_DAY + 1))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => fromEpochDay(MIN_DAY - 1))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => fromEpochDay(1.5))).toBe("OUT_OF_RANGE");
  });
});

describe("arithmetic", () => {
  test("examples across month, year and leap boundaries", () => {
    expect(addDays(isoDate("2028-02-28"), 1)).toBe("2028-02-29");
    expect(addDays(isoDate("2028-02-28"), 2)).toBe("2028-03-01");
    expect(addDays(isoDate("2026-02-28"), 1)).toBe("2026-03-01");
    expect(addDays(isoDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(isoDate("2027-01-01"), -1)).toBe("2026-12-31");
    expect(addDays(isoDate("2026-10-24"), 0)).toBe("2026-10-24");
    expect(addDays(isoDate("2026-10-24"), 21)).toBe("2026-11-14");
    expect(daysBetween(isoDate("2026-10-24"), isoDate("2026-11-14"))).toBe(21);
    expect(daysBetween(isoDate("2026-11-14"), isoDate("2026-10-24"))).toBe(-21);
    expect(daysBetween(isoDate("2028-01-01"), isoDate("2029-01-01"))).toBe(366);
    expect(codeOf(() => addDays(MAX_ISO_DATE, 1))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => addDays(isoDate("2026-01-01"), 0.5))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => addDays("2026-02-30" as IsoDate, 1))).toBe("INVALID_DATE");
  });

  test("property: addDays and daysBetween are inverse and compose", () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: -40_000, max: 40_000 }), fc.integer({ min: -40_000, max: 40_000 }), (d, a, b) => {
        const n = toEpochDay(d);
        fc.pre(n + a >= MIN_DAY && n + a <= MAX_DAY && n + a + b >= MIN_DAY && n + a + b <= MAX_DAY);
        const da = addDays(d, a);
        expect(daysBetween(d, da)).toBe(a);
        expect(addDays(da, -a)).toBe(d);
        expect(addDays(da, b)).toBe(addDays(d, a + b));
        expect(da).toBe(oracle(n + a));
      }),
      RUNS,
    );
  });

  test("property: comparison agrees with daysBetween", () => {
    fc.assert(
      fc.property(anyDate, anyDate, (a, b) => {
        const sign = Math.sign(daysBetween(b, a));
        expect(compareIsoDates(a, b)).toBe(sign === 0 ? 0 : sign);
        expect(isOnOrBefore(a, b)).toBe(sign <= 0);
        expect(isOnOrAfter(a, b)).toBe(sign >= 0);
        expect(isBefore(a, b)).toBe(sign < 0);
        expect(isAfter(a, b)).toBe(sign > 0);
        expect(minIsoDate(a, b)).toBe(sign <= 0 ? a : b);
        expect(maxIsoDate(a, b)).toBe(sign >= 0 ? a : b);
      }),
      RUNS,
    );
  });
});

describe("deadline semantics", () => {
  const deadline = isoDate("2026-11-14");
  test("delivery on the deadline day is on time; the next day is late", () => {
    expect(isOnOrBefore(isoDate("2026-11-14"), deadline)).toBe(true);
    expect(isOnOrBefore(isoDate("2026-11-13"), deadline)).toBe(true);
    expect(isOnOrBefore(isoDate("2026-11-15"), deadline)).toBe(false);
  });

  test("earliest-delivery style checks", () => {
    const earliest = maxIsoDate(isoDate("2026-11-01"), isoDate("2026-11-10"), isoDate("2026-10-30"));
    expect(earliest).toBe("2026-11-10");
    expect(minIsoDate(isoDate("2026-11-01"), isoDate("2026-11-10"), isoDate("2026-10-30"))).toBe("2026-10-30");
    expect(isOnOrAfter(isoDate("2026-11-12"), earliest)).toBe(true);
    expect(addDays(isoDate("2026-10-24"), 14)).toBe("2026-11-07"); // lead time in days
  });

  test("comparison refuses unvalidated strings", () => {
    expect(codeOf(() => isOnOrBefore("2026-11-14" as IsoDate, "2026-02-30" as IsoDate))).toBe("INVALID_DATE");
  });
});

describe("boundary helpers", () => {
  test("isoDateFromEpochMs uses only the explicit offset", () => {
    const instant = Date.UTC(2026, 9, 24, 6, 30); // 2026-10-24T06:30Z
    expect(isoDateFromEpochMs(instant, 0)).toBe("2026-10-24");
    expect(isoDateFromEpochMs(instant, -420)).toBe("2026-10-23"); // UTC-7
    expect(isoDateFromEpochMs(instant, 540)).toBe("2026-10-24"); // UTC+9
    expect(isoDateFromEpochMs(instant, 18 * 60)).toBe("2026-10-25");
    const midnight = Date.UTC(2026, 9, 24);
    expect(isoDateFromEpochMs(midnight, 0)).toBe("2026-10-24");
    expect(isoDateFromEpochMs(midnight - 1, 0)).toBe("2026-10-23");
    expect(isoDateFromEpochMs(midnight, -1)).toBe("2026-10-23");
    expect(isoDateFromEpochMs(Date.UTC(1969, 11, 31, 23, 59), 0)).toBe("1969-12-31");
    expect(codeOf(() => isoDateFromEpochMs(instant, 19 * 60))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => isoDateFromEpochMs(instant, 0.5))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => isoDateFromEpochMs(Number.NaN, 0))).toBe("INVALID_ARGUMENT");
  });

  test("property: offset 0 matches the UTC oracle", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2_000_000_000_000, max: 4_000_000_000_000 }), (ms) => {
        expect(isoDateFromEpochMs(ms, 0)).toBe(new Date(ms).toISOString().slice(0, 10));
      }),
      RUNS,
    );
  });

  test("weekday and formatting", () => {
    expect(isoWeekday(isoDate("1970-01-01"))).toBe(4);
    expect(isoWeekday(isoDate("2026-10-24"))).toBe(6);
    expect(isoWeekday(isoDate("2026-11-14"))).toBe(6);
    expect(isoWeekday(isoDate("2026-10-26"))).toBe(1);
    expect(isoWeekday(isoDate("1969-12-28"))).toBe(7);
    expect(formatIsoDate(isoDate("2026-11-14"))).toBe("Nov 14, 2026");
    expect(formatIsoDate(isoDate("2026-11-14"), "long")).toBe("Saturday, November 14, 2026");
    expect(formatIsoDate(isoDate("2026-11-04"), "iso")).toBe("2026-11-04");
  });

  test("property: weekday matches the UTC oracle", () => {
    fc.assert(
      fc.property(anyEpochDay, (n) => {
        const jsDay = new Date(n * MS_PER_DAY).getUTCDay(); // 0 = Sunday
        expect(isoWeekday(fromEpochDay(n))).toBe(jsDay === 0 ? 7 : jsDay);
      }),
      RUNS,
    );
  });
});
