// Calendar dates as YYYY-MM-DD labels. Day math is integer epoch-day arithmetic
// (Howard Hinnant, public domain): no clock, no locale formatter, no host zone.

export type IsoDate = string & { readonly __isoDate: true };

export interface DayOffset {
  readonly offsetDays: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

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

export function isoDate(value: string): IsoDate {
  const match = ISO_DATE_RE.exec(value);
  if (match === null) throw new Error(`expected a YYYY-MM-DD calendar date, got ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`expected a real calendar day, got ${value}`);
  }
  return value as IsoDate;
}

export const GOLDEN_ANCHOR = isoDate("2026-11-02");

export function addDays(localDate: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) throw new Error("days must be a safe integer");
  const match = ISO_DATE_RE.exec(localDate);
  if (match === null) throw new Error(`expected a YYYY-MM-DD calendar date, got ${localDate}`);
  const epoch = daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
  const { year, month, day } = civilFromDays(epoch + days);
  return isoDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = ISO_DATE_RE.exec(from);
  const b = ISO_DATE_RE.exec(to);
  if (a === null || b === null) throw new Error("expected YYYY-MM-DD calendar dates");
  return daysFromCivil(Number(b[1]), Number(b[2]), Number(b[3])) - daysFromCivil(Number(a[1]), Number(a[2]), Number(a[3]));
}

/** Resolve a day offset against a room `localDate` (the seed anchor). */
export function resolveDayOffset(localDate: IsoDate, offset: DayOffset): IsoDate {
  if (!Number.isSafeInteger(offset.offsetDays)) throw new Error("offsetDays must be a safe integer");
  return addDays(localDate, offset.offsetDays);
}
