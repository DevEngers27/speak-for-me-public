import { describe, expect, it } from 'vitest';
import { assertNoCanaries, canaryNeedles, lintCanaries, scanCanaries, type CanaryNeedle } from '../convex-helpers/canary';
import { canaryFixture } from '../../core/scenarios/scope-change/fixtures/variants';
import { publicMoneyText } from '../../core/scenarios/scope-change/fixtures/canaries';

const money: CanaryNeedle = { id: 'private.amount', ownerRole: 'finance', kind: 'money', value: 481_731, allowedRoles: [], origin: 'derived', provenance: 'seeded' };
const text: CanaryNeedle = { ...money, id: 'private.note', kind: 'string', value: 'CANARY-FIN-7731' };

describe('W2-2 canary harness', () => {
  it('CE-163 ignores timestamp and opaque id values and respects numeric boundaries', () => {
    expect(scanCanaries({ _creationTime: 1700481731000, id: '481731', otherId: '481731', at: 481731, commitTs: 481731, cursor: '481731', requestId: '481731', unrelated: '1700481731000' }, [money])).toEqual([]);
    expect(scanCanaries({ leaked: 481731 }, [money])).toEqual([{ path: '$.leaked', secretId: money.id }]);
    expect(scanCanaries({ nested: [{ harmless: 'timestamp 1700481731000', leaked: '$4,817.31' }] }, [money])).toEqual([{ path: '$.nested.0.leaked', secretId: money.id }]);
  });

  it('TC-PRIV-17 catches normalized, encoded, reversed text without echoing it', () => {
    for (const value of ['canary-fin-7731', 'ＣＡＮＡＲＹ-ＦＩＮ-７７３１', 'CANARY\u200b-FIN-7731', btoa(String(text.value)), encodeURIComponent(String(text.value)), [...String(text.value)].reverse().join('')]) {
      expect(scanCanaries({ line: value }, [text])).toHaveLength(1);
      expect(() => assertNoCanaries({ line: value }, [text])).toThrow('$.line');
      try { assertNoCanaries({ line: value }, [text]); } catch (error) { expect(String(error)).not.toContain(value); }
    }
  });

  it('TC-PRIV-17 derives odd-cent pins and validates all catalog subset sums', () => {
    const needles = canaryNeedles(canaryFixture);
    expect(needles.find(pin => pin.id === 'finance.capCents.v1')?.value).toBe(512347);
    expect(needles.find(pin => pin.id === 'finance.capCents.v2')?.value).toBe(481237);
    expect(needles.find(pin => pin.id === 'finance.headroomCents.v1')?.value).toBe(112128);
    expect(needles.find(pin => pin.id === 'finance.headroomCents.v2')?.value).toBe(81018);
    expect(needles.find(pin => pin.id === 'finance.overByCentsAfterCut')?.value).toBe(8982);
    expect(needles.find(pin => pin.id === 'finance.committedAfterExecuteCents')?.value).toBe(480219);
    const publicTexts = [];
    for (let mask = 0; mask < (1 << canaryFixture.catalog.length); mask++) {
      const sum = canaryFixture.catalog.reduce((value, row, i) => mask & (1 << i) ? value + row.priceCents : value, 0);
      publicTexts.push({ label: 'public subset', text: publicMoneyText(sum) });
    }
    expect(lintCanaries(needles, publicTexts)).toEqual([]);
    expect(lintCanaries([money], [{ label: 'collision', text: '$4,817.31' }])).toMatchObject([{ code: 'COLLIDES_WITH_PUBLIC_VALUE' }]);
  });

  it('TC-PRIV-01 disclosure configurations grant only the owner and current audience', () => {
    expect(scanCanaries({ amount: money.value }, [money], { viewer: 'provider' })).toHaveLength(1);
    expect(scanCanaries({ amount: money.value }, [money], { viewer: 'finance' })).toEqual([]);
    expect(scanCanaries({ amount: money.value }, [money], { viewer: 'customer', allowedRoles: { [money.id]: ['customer'] } })).toEqual([]);
    expect(scanCanaries({ amount: money.value }, [money], { viewer: 'customer', allowedRoles: { [money.id]: [] } })).toHaveLength(1);
    expect(scanCanaries({ amount: money.value }, [money], { viewer: 'outsider' })).toHaveLength(1);
    expect(scanCanaries({ amount: money.value }, [money])).toHaveLength(1);
  });
});
