import { expect, test } from 'vitest';
import { inheritProvenance, type Provenance } from './provenance';

test('03-3.3.3 provenance precedence is seeded then stub then live', () => {
  const values: Provenance[] = ['live', 'stub', 'seeded'];
  for (const a of values) for (const b of values) {
    expect(inheritProvenance(a, b)).toBe(values[Math.max(values.indexOf(a), values.indexOf(b))]);
  }
  expect(inheritProvenance()).toBe('live');
});
