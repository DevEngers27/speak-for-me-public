import {describe, expect, it} from 'vitest';
import * as m from './money';

describe('integer-cent money', () => {
  it('enforces the canon ceiling even with a custom limit', () => {
    expect(m.cents(1e11)).toBe(1e11);
    for (const value of [-1, 0.1, NaN, Infinity, 1e11 + 1]) expect(() => m.cents(value)).toThrow(m.MoneyError);
    expect(() => m.cents(1, {max: 1e11 + 1})).toThrow(m.MoneyError);
    expect(Object.is(m.cents(-0), -0)).toBe(false);
  });
  it('revalidates every operand instead of trusting erased brands', () => {
    const good = m.cents(10);
    for (const bad of [-1, 1.5, NaN, Infinity, 1e11 + 1]) {
      const cast = bad as m.Cents;
      for (const op of [m.addCents, m.subtractCents]) {
        expect(() => op(cast, good)).toThrow(m.MoneyError);
        expect(() => op(good, cast)).toThrow(m.MoneyError);
      }
      for (const op of [() => m.multiplyCents(cast, 0), () => m.scaleCents(cast, 0, 1, 'floor'),
        () => m.allocateCents(cast, [1]), () => m.sumCents([cast]), () => m.splitCentsEvenly(cast, 1),
        () => m.centsToInputString(cast), () => m.toCents(cast)]) expect(op).toThrow(m.MoneyError);
    }
    for (const bad of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const cast = bad as m.SignedCents;
      for (const op of [m.differenceCents, m.compareCents]) {
        expect(() => op(cast, good)).toThrow(m.MoneyError);
        expect(() => op(good, cast)).toThrow(m.MoneyError);
      }
      for (const op of [() => m.absCents(cast), () => m.minCents(good, cast), () => m.maxCents(cast, good),
        () => m.formatCents(cast), () => m.centsToDecimalString(cast)]) expect(op).toThrow(m.MoneyError);
    }
  });
  it('checks output bounds and exact rounding', () => {
    expect(() => m.addCents(m.MAX_CENTS, m.cents(1))).toThrow(m.MoneyError);
    expect(() => m.multiplyCents(m.MAX_CENTS, 2)).toThrow(m.MoneyError);
    expect(() => m.scaleCents(m.MAX_CENTS, 2, 1, 'floor')).toThrow(m.MoneyError);
    expect(() => m.subtractCents(m.cents(1), m.cents(2))).toThrow(m.MoneyError);
    expect(m.differenceCents(m.cents(1), m.cents(2))).toBe(-1);
    expect(m.scaleCents(m.cents(5), 1, 2, 'half-even')).toBe(2);
    expect(m.scaleCents(m.cents(5), 1, 2, 'half-up')).toBe(3);
    expect(m.scaleCents(m.cents(5), 1, 2, 'floor')).toBe(2);
    expect(m.scaleCents(m.cents(5), 1, 2, 'ceil')).toBe(3);
    expect(() => m.scaleCents(m.cents(5), 1, 1, 'bad' as m.RoundingMode)).toThrow(m.MoneyError);
  });
  it('allocates exactly, deterministically, and bounds even splits before allocation', () => {
    expect(m.allocateCents(m.cents(5), [1, 1, 0, 1])).toEqual([2, 2, 0, 1]);
    for (let total = 0; total < 100; total++) for (let n = 1; n < 20; n++) {
      const split = m.splitCentsEvenly(m.cents(total), n);
      expect(split.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
    }
    expect(m.splitCentsEvenly(m.cents(0), 10_000)).toHaveLength(10_000);
    for (const n of [0, -1, 1.5, 10_001, 2**32]) expect(() => m.splitCentsEvenly(m.cents(100), n)).toThrow(m.MoneyError);
    expect(() => m.allocateCents(m.cents(5), [0, 0])).toThrow(m.MoneyError);
  });
  it('parses decimal text without floating point or silent rounding', () => {
    expect(m.parseCents('$4,800.50')).toEqual({ok: true, value: 480050});
    for (const text of ['1.555', '-0', '4,80', '1e3', '1000000000.01']) expect(m.parseCents(text).ok).toBe(false);
    for (let value = 0; value < 10000; value += 37) {
      const cents = m.cents(value);
      expect(m.parseCents(m.centsToInputString(cents))).toEqual({ok: true, value});
    }
    expect(m.formatCents(m.signedCents(-123))).toBe('-$1.23');
  });
});
it('keeps money brands distinct at compile time', () => {
  function compileOnly() {
    // @ts-expect-error plain numbers are not validated cents
    const amount: m.Cents = 100;
    // @ts-expect-error signed amounts cannot be stored as nonnegative cents
    const stored: m.Cents = m.signedCents(-1);
    // @ts-expect-error arithmetic requires validated operands
    m.addCents(m.cents(1), 2);
    void amount; void stored;
  }
  void compileOnly;
});
