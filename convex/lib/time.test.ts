import { afterEach, expect, test, vi } from 'vitest';
import { intlDate, offsetDate, timeZoneMode, todayInTimeZone } from './time';
import { nextLocalMidnight } from '../model/clock';
const originalParts = Intl.DateTimeFormat.prototype.formatToParts;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', { configurable: true, writable: true, value: originalParts });
});
test('D22 offset matches Intl around DST and midnight over the supported date grid', () => {
  for (const year of [2007, 2024, 2025, 2026, 2027, 2030]) {
    for (let now = Date.UTC(year, 0, 1); now < Date.UTC(year + 1, 0, 1); now += 6 * 3_600_000) {
      for (const zone of ['UTC', 'America/Los_Angeles']) {
        expect(offsetDate(now, zone)).toBe(intlDate(now, zone));
      }
    }
  }
});
test('DST transitions and local midnight boundaries match to the millisecond', () => {
  for (const boundary of ['2026-03-08T10:00Z', '2026-11-01T09:00Z', '2026-03-09T07:00Z', '2026-11-02T08:00Z']) {
    for (const delta of [-1, 0, 1]) {
      const now = Date.parse(boundary) + delta;
      expect(offsetDate(now, 'America/Los_Angeles')).toBe(intlDate(now, 'America/Los_Angeles'));
    }
  }
});
test.each(['throws', 'missing parts'] as const)('D22 fallback when Intl %s, including midnight scheduling', mode => {
  if (mode === 'throws') vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new TypeError('no ICU'); });
  else Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', { configurable: true, value: undefined });
  expect(timeZoneMode()).toBe('offset');
  expect(todayInTimeZone(Date.UTC(2026, 9, 24, 1), 'America/Los_Angeles')).toBe('2026-10-23');
  const spring = Date.UTC(2026, 2, 8, 8);
  const fall = Date.UTC(2026, 10, 1, 7);
  expect(nextLocalMidnight(spring, 'America/Los_Angeles') - spring).toBe(23 * 3_600_000);
  expect(nextLocalMidnight(fall, 'America/Los_Angeles') - fall).toBe(25 * 3_600_000);
  expect(() => todayInTimeZone(spring, 'invalid')).toThrow(RangeError);
});
