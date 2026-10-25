import { expect, test, vi } from 'vitest';
import { randomToken, sha256Hex } from './crypto';
import { todayInTimeZone } from './time';
test('12.7 token uses 256 random bits and SHA-256 returns the known vector', async () => {
  expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomToken()).not.toBe(randomToken());
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('12.7 crypto uses injected fallback when Web Crypto is unavailable', async () => {
  vi.stubGlobal('crypto', undefined);
  try {
    expect(randomToken({randomBytes: () => new Uint8Array(32).fill(1)})).toBe('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE');
    expect(await sha256Hex('abc', {sha256: bytes => {
      expect([...bytes]).toEqual([97, 98, 99]);
      return new Uint8Array(32).fill(2);
    }})).toBe('02'.repeat(32));
    expect(() => randomToken()).toThrow(/unavailable/);
    await expect(sha256Hex('abc')).rejects.toThrow(/unavailable/);
  } finally {vi.unstubAllGlobals();}
});
test('12.2 todayInTimeZone respects local midnight without changing an instant', () => {
  const instant = Date.parse('2026-10-24T01:00:00Z');
  expect(todayInTimeZone(instant, 'UTC')).toBe('2026-10-24');
  expect(todayInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-23');
});
