// engine/rules/primitives.ts — deterministic money and date predicates. No Date, no Intl, no I/O.
import { MAX_CENTS } from './codes.ts';

export type Cents = number; // safe integer, 0 <= n <= MAX_CENTS
export type IsoDate = string; // YYYY-MM-DD, a real calendar day, interpreted in the room time zone

export function isCents(n: unknown): n is Cents {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS;
}

/** Adds two cent amounts; returns null instead of overflowing past MAX_CENTS. */
export function addCents(a: Cents, b: Cents): Cents | null {
  if (!isCents(a) || !isCents(b)) return null;
  const s = a + b;
  return isCents(s) ? s : null;
}

export function sumCents(xs: readonly Cents[]): Cents | null {
  let acc: Cents | null = 0;
  for (const x of xs) {
    if (acc === null) return null;
    acc = addCents(acc, x);
  }
  return acc;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Strict calendar-day check. Rejects 2026-02-30, 2026-11-31, 2026-02-29, 0000-01-01, leading/trailing spaces. */
export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** Valid ISO dates order lexicographically; callers must validate first. */
export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

export function maxDateOf(xs: readonly IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const x of xs) best = best === null ? x : maxDate(best, x);
  return best;
}

/** Sorted, de-duplicated copy. */
export function sortedUnique(xs: readonly string[]): string[] {
  return [...new Set(xs)].sort();
}

export function duplicatesOf(xs: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const x of xs) (seen.has(x) ? dup : seen).add(x);
  return [...dup].sort();
}

export function isNonEmptyKey(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && s.trim() === s;
}
