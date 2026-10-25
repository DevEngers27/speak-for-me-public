// Timezone-free ISO 8601 calendar dates ("YYYY-MM-DD").
//
// A calendar date is a label for a day, not an instant. Nothing in this module
// constructs a Date, reads the host timezone, or uses Intl, so results are the
// same on a laptop in Tokyo, a server in UTC and the Convex isolate runtime.
// Day arithmetic goes through an integer "epoch day" (days since 1970-01-01 in
// the proleptic Gregorian calendar).
//
// The accepted range is 0000-01-01 .. 9999-12-31, which is exactly the set
// zod's `z.iso.date()` accepts, so a value that passes one validator passes
// the other (the old prototype had two disagreeing validators).

declare const isoDateBrand: unique symbol;

/** A validated "YYYY-MM-DD" calendar date. Lexicographic order == calendar order. */
export type IsoDate = string & { readonly [isoDateBrand]: true };

export type DateErrorCode = "INVALID_FORMAT" | "INVALID_DATE" | "OUT_OF_RANGE" | "INVALID_ARGUMENT";

export class DateError extends Error {
  readonly code: DateErrorCode;
  constructor(code: DateErrorCode, message: string) {
    super(message);
    this.name = "DateError";
    this.code = code;
  }
}

export const MIN_ISO_DATE = "0000-01-01" as IsoDate;
export const MAX_ISO_DATE = "9999-12-31" as IsoDate;

const MS_PER_DAY = 86_400_000;
const MAX_OFFSET_MINUTES = 18 * 60;

// ---------------------------------------------------------------------------
// Calendar primitives

export function isLeapYear(year: number): boolean {
  if (!Number.isInteger(year)) throw new DateError("INVALID_ARGUMENT", "year must be an integer");
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new DateError("INVALID_ARGUMENT", "month must be an integer from 1 to 12");
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

// Howard Hinnant's days_from_civil / civil_from_days (public domain),
// valid for the whole proleptic Gregorian calendar.
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(epochDay: number): { year: number; month: number; day: number } {
  const z = epochDay + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const MIN_EPOCH_DAY = daysFromCivil(0, 1, 1);
const MAX_EPOCH_DAY = daysFromCivil(9999, 12, 31);

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ---------------------------------------------------------------------------
// Validation and construction

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ParseIsoDateResult =
  | { readonly ok: true; readonly value: IsoDate }
  | { readonly ok: false; readonly error: "INVALID_FORMAT" | "INVALID_DATE" };

/**
 * Strictly validate "YYYY-MM-DD": no surrounding whitespace, no time part, no
 * sign or expanded year, and a real calendar day (2026-02-30 is INVALID_DATE,
 * 2028-02-29 is fine). Callers trim free-text input themselves.
 */
export function parseIsoDate(input: unknown): ParseIsoDateResult {
  if (typeof input !== "string") return { ok: false, error: "INVALID_FORMAT" };
  const match = ISO_DATE_RE.exec(input);
  if (match === null) return { ok: false, error: "INVALID_FORMAT" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, error: "INVALID_DATE" };
  }
  return { ok: true, value: input as IsoDate };
}

export function isIsoDate(value: unknown): value is IsoDate {
  return parseIsoDate(value).ok;
}

export function assertIsoDate(value: unknown): asserts value is IsoDate {
  const result = parseIsoDate(value);
  if (!result.ok) throw new DateError(result.error, `expected a YYYY-MM-DD calendar date (${result.error})`);
}

/** Validating constructor. */
export function isoDate(value: string): IsoDate {
  assertIsoDate(value);
  return value;
}

export function isoDateFromParts(year: number, month: number, day: number): IsoDate {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new DateError("OUT_OF_RANGE", "year must be an integer from 0 to 9999");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new DateError("INVALID_DATE", "month must be an integer from 1 to 12");
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new DateError("INVALID_DATE", "day is not valid for that month");
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as IsoDate;
}

export function isoDateParts(date: IsoDate): { year: number; month: number; day: number } {
  assertIsoDate(date);
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

// ---------------------------------------------------------------------------
// Epoch-day conversion and arithmetic

/** Days since 1970-01-01 (negative before it). */
export function toEpochDay(date: IsoDate): number {
  const { year, month, day } = isoDateParts(date);
  return daysFromCivil(year, month, day);
}

export function fromEpochDay(epochDay: number): IsoDate {
  if (!Number.isSafeInteger(epochDay) || epochDay < MIN_EPOCH_DAY || epochDay > MAX_EPOCH_DAY) {
    throw new DateError("OUT_OF_RANGE", "date is outside 0000-01-01..9999-12-31");
  }
  const { year, month, day } = civilFromDays(epochDay);
  return isoDateFromParts(year, month, day);
}

/** date + days (days may be negative). */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) throw new DateError("INVALID_ARGUMENT", "days must be a safe integer");
  const target = toEpochDay(date) + days;
  return fromEpochDay(target);
}

/** Signed number of days from `from` to `to`: daysBetween(d, addDays(d, n)) === n. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: IsoDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  // 1970-01-01 (epoch day 0) was a Thursday (4).
  const n = toEpochDay(date);
  return ((((n + 3) % 7) + 7) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

// ---------------------------------------------------------------------------
// Comparison

export function compareIsoDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  assertIsoDate(a);
  assertIsoDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when `date` falls on or before `deadline` (same day counts as on time). */
export function isOnOrBefore(date: IsoDate, deadline: IsoDate): boolean {
  return compareIsoDates(date, deadline) <= 0;
}

export function isOnOrAfter(date: IsoDate, earliest: IsoDate): boolean {
  return compareIsoDates(date, earliest) >= 0;
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return compareIsoDates(a, b) < 0;
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return compareIsoDates(a, b) > 0;
}

export function minIsoDate(first: IsoDate, ...rest: readonly IsoDate[]): IsoDate {
  return rest.reduce((m, d) => (compareIsoDates(d, m) < 0 ? d : m), isoDate(first));
}

export function maxIsoDate(first: IsoDate, ...rest: readonly IsoDate[]): IsoDate {
  return rest.reduce((m, d) => (compareIsoDates(d, m) > 0 ? d : m), isoDate(first));
}

// ---------------------------------------------------------------------------
// Boundary helpers

/**
 * The calendar date at an instant, seen from an explicit fixed UTC offset in
 * minutes (e.g. -420 for UTC-7). There is deliberately no default and no IANA
 * zone lookup: deciding which offset applies (and handling DST) belongs to the
 * caller, which keeps this module free of timezone data and host settings.
 */
export function isoDateFromEpochMs(epochMs: number, utcOffsetMinutes: number): IsoDate {
  if (!Number.isSafeInteger(epochMs)) throw new DateError("INVALID_ARGUMENT", "epochMs must be a safe integer");
  if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > MAX_OFFSET_MINUTES) {
    throw new DateError("INVALID_ARGUMENT", "utcOffsetMinutes must be an integer within +/-18 hours");
  }
  return fromEpochDay(Math.floor((epochMs + utcOffsetMinutes * 60_000) / MS_PER_DAY));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type DateFormatStyle = "iso" | "medium" | "long";

/**
 * Fixed en-US display without Intl or timezone conversion:
 * "iso" -> "2026-11-14", "medium" (default) -> "Nov 14, 2026",
 * "long" -> "Saturday, November 14, 2026".
 */
export function formatIsoDate(date: IsoDate, style: DateFormatStyle = "medium"): string {
  const { year, month, day } = isoDateParts(date);
  const monthName = MONTHS[month - 1] ?? "";
  switch (style) {
    case "iso":
      return date;
    case "medium":
      return `${monthName.slice(0, 3)} ${day}, ${year}`;
    case "long":
      return `${WEEKDAYS[isoWeekday(date) - 1] ?? ""}, ${monthName} ${day}, ${year}`;
  }
}
