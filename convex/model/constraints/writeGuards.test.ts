import { describe, expect, it } from 'vitest';
import type { Doc } from '../../_generated/dataModel';
import { assertBaselineSetup, assertCapAboveCommitted, assertItemRepriceWithinRun, assertOpenWriteBucket } from './writeGuards';
const now = 100_000_000;
function event(n: number, payload: Doc<'events'>['payload'], at = now - 60_000) {
  return { commitTs: BigInt(n), _creationTime: at, payload };
}
const price = { type: 'catalog_item_confirmed', items: [], priceChanged: true } as const;
const hard = { type: 'brief_confirmed', role: 'customer', version: 1, hardChanged: true } as const;
describe('W2-3 open write guards', () => {
  for (const [bucket, payload, limit] of [['price_writes', price, 3], ['hard_fields', hard, 6]] as const) {
    it(`12.2-7 ${bucket} over limit → run.rate_limited`, () => {
      const rows = Array.from({ length: limit }, (_, i) => event(i, payload));
      expect(() => assertOpenWriteBucket('open', bucket, rows.slice(1), now)).not.toThrow();
      expect(() => assertOpenWriteBucket('open', bucket, rows, now)).toThrowError(expect.objectContaining({ data: { code: 'run.rate_limited', params: { retryAfterMs: 86_340_000 } } }));
      expect(() => assertOpenWriteBucket('setup', bucket, rows, now)).not.toThrow();
      expect(() => assertOpenWriteBucket('open', bucket, rows, now + 25 * 3_600_000)).not.toThrow();
    });
    it(`TC-AUTH-13 ${bucket} counts distinct commits and excludes non-hard writes`, () => {
      const rows = Array.from({ length: limit - 1 }, (_, i) => event(i, payload));
      rows.push(event(0, payload));
      expect(() => assertOpenWriteBucket('open', bucket, rows, now)).not.toThrow();
      expect(() => assertOpenWriteBucket('open', bucket, [
        ...rows, event(99, { type: 'brief_confirmed', role: 'finance', version: 2, hardChanged: false }),
        event(100, { ...price, priceChanged: false }),
      ], now)).not.toThrow();
    });
    it(`CC-18 ${bucket} rolling window excludes the exact lower boundary`, () => {
      const rows = Array.from({ length: limit }, (_, i) => event(i, payload, now - 86_400_000));
      expect(() => assertOpenWriteBucket('open', bucket, rows, now)).not.toThrow();
    });
  }
  it('CC-19 retirement shares price bucket with confirmations', () => {
    const rows = [event(1, price), event(2, price), event(3, { type: 'catalog_item_retired', itemKey: 'login', revision: 2 })];
    expect(() => assertOpenWriteBucket('open', 'price_writes', rows, now)).toThrow();
  });
  it('CC-04 same item can be repriced at most once per open run', () => {
    expect(() => assertItemRepriceWithinRun('open', now - 100, now - 101, now)).not.toThrow();
    expect(() => assertItemRepriceWithinRun('open', now - 100, now - 100, now)).toThrow();
    expect(() => assertItemRepriceWithinRun('setup', now - 100, now, now)).not.toThrow();
    expect(() => assertItemRepriceWithinRun('open', undefined, now, now)).not.toThrow();
  });
  it('TC-VER-10 below committed rejects before any writer runs', () => {
    expect(() => assertCapAboveCommitted(99, 100)).toThrowError(expect.objectContaining({ data: { code: 'budget.below_committed', params: { minAllowedCapCents: 100 } } }));
    expect(() => assertCapAboveCommitted(100, 100)).not.toThrow();
  });
  it('CC-08 baseline is setup-only', () => {
    expect(() => assertBaselineSetup('setup')).not.toThrow();
    for (const status of ['open', 'executed', 'closed'] as const) expect(() => assertBaselineSetup(status)).toThrowError(expect.objectContaining({ data: { code: 'run.invalid_state', params: { guard: 'room_status' } } }));
  });
});
