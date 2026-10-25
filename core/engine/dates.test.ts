import {expect, it} from 'vitest';
import * as d from './dates';
it('validates the Gregorian calendar, including year zero', () => {
  for (const value of ['0000-02-29', '2000-02-29', '2028-02-29', '9999-12-31']) expect(d.isIsoDate(value)).toBe(true);
  for (const value of ['1900-02-29', '2100-02-29', '2026-02-30', '2026-1-01', ' 2026-01-01']) expect(d.isIsoDate(value)).toBe(false);
  expect(d.formatIsoDate(d.isoDate('0005-01-01'))).toBe('Jan 1, 0005');
});
it('round-trips epoch days across the supported calendar', () => {
  for (let day = d.toEpochDay(d.MIN_ISO_DATE); day <= d.toEpochDay(d.MAX_ISO_DATE); day += 997) {
    const date = d.fromEpochDay(day);
    expect(d.toEpochDay(date)).toBe(day);
    expect(d.daysBetween(date, d.addDays(date, 7))).toBe(7);
    expect(d.isBefore(date, d.addDays(date, 7))).toBe(true);
  }
  expect(d.addDays(d.isoDate('2028-02-28'), 1)).toBe('2028-02-29');
  expect(() => d.addDays(d.MAX_ISO_DATE, 1)).toThrow(d.DateError);
  expect(() => d.compareIsoDates('bad' as d.IsoDate, d.MIN_ISO_DATE)).toThrow(d.DateError);
});
it('accepts fractional epoch milliseconds with explicit offsets and floors before epoch', () => {
  expect(d.isoDateFromEpochMs(-0.1, 0)).toBe('1969-12-31');
  expect(d.isoDateFromEpochMs(0.9, 0)).toBe('1970-01-01');
  expect(d.isoDateFromEpochMs(1729700000000.123, 0)).toBe('2024-10-23');
  expect(d.isoDateFromEpochMs(0, -60)).toBe('1969-12-31');
  for (const ms of [NaN, Infinity, -Infinity, 1e30]) expect(() => d.isoDateFromEpochMs(ms, 0)).toThrow(d.DateError);
  expect(() => d.isoDateFromEpochMs(0, 1081)).toThrow(d.DateError);
});
