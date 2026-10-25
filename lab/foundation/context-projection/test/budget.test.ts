import { describe, expect, test } from 'vitest';
import { estimateTokens, trimToBudget, wrapUntrusted, type ContextBlock } from '../src/index.ts';

describe('estimateTokens', () => {
  test('ASCII uses ceil(chars / 3) by default', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('x'.repeat(300))).toBe(100);
  });

  test('non-ASCII code points cost one token each by default (surrogate pairs count once)', () => {
    expect(estimateTokens('协商工作台')).toBe(5);
    expect(estimateTokens('😀')).toBe(1);
    expect(estimateTokens('ab协')).toBe(2); // ceil(2/3 + 1)
  });

  test('constants are configurable and validated', () => {
    expect(estimateTokens('x'.repeat(40), { asciiCharsPerToken: 4 })).toBe(10);
    expect(estimateTokens('协商', { nonAsciiTokensPerChar: 1.5 })).toBe(3);
    expect(() => estimateTokens('x', { asciiCharsPerToken: 0 })).toThrow(RangeError);
    expect(() => estimateTokens('x', { nonAsciiTokensPerChar: -1 })).toThrow(RangeError);
  });

  test('is conservative for typical English (over-counts relative to ~4 chars/token)', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(Math.ceil(text.length / 4));
  });
});

const ids = (bs: readonly ContextBlock[]) => bs.map((b) => b.id);
const fixedCost = (text: string) => text.length; // 1 char = 1 token, makes tests readable

describe('trimToBudget', () => {
  const blocks: ContextBlock[] = [
    { id: 'policy', text: 'p'.repeat(10), priority: 100, required: true },
    { id: 'old-history', text: 'o'.repeat(30), priority: 1 },
    { id: 'shared-facts', text: 's'.repeat(20), priority: 50 },
    { id: 'recent-history', text: 'r'.repeat(30), priority: 10 },
    { id: 'self-brief', text: 'b'.repeat(15), priority: 90, required: true },
  ];

  test('keeps everything when it fits', () => {
    const r = trimToBudget(blocks, { budgetTokens: 105, estimate: fixedCost });
    expect(r.ok).toBe(true);
    expect(ids(r.kept)).toEqual(ids(blocks));
    expect(r.dropped).toEqual([]);
    expect(r.usedTokens).toBe(105);
  });

  test('drops lowest priority first and preserves original order of kept blocks', () => {
    const r = trimToBudget(blocks, { budgetTokens: 80, estimate: fixedCost });
    expect(r.ok).toBe(true);
    expect(ids(r.dropped)).toEqual(['old-history']);
    expect(ids(r.kept)).toEqual(['policy', 'shared-facts', 'recent-history', 'self-brief']);
    expect(r.usedTokens).toBe(75);
  });

  test('keeps dropping in priority order until it fits', () => {
    const r = trimToBudget(blocks, { budgetTokens: 50, estimate: fixedCost });
    expect(ids(r.dropped)).toEqual(['old-history', 'recent-history']);
    expect(ids(r.kept)).toEqual(['policy', 'shared-facts', 'self-brief']);
    expect(r.usedTokens).toBe(45);
  });

  test('never drops required blocks; reports failure when they alone exceed the budget', () => {
    const r = trimToBudget(blocks, { budgetTokens: 20, estimate: fixedCost });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('REQUIRED_BLOCKS_EXCEED_BUDGET');
    expect(ids(r.kept)).toEqual(['policy', 'self-brief']);
    expect(r.usedTokens).toBe(25);
  });

  test('ties drop the later block first', () => {
    const tie: ContextBlock[] = [
      { id: 'a', text: 'aaaa', priority: 5 },
      { id: 'b', text: 'bbbb', priority: 5 },
      { id: 'c', text: 'cccc', priority: 5 },
    ];
    expect(ids(trimToBudget(tie, { budgetTokens: 8, estimate: fixedCost }).dropped)).toEqual(['c']);
  });

  test('monotonic invariant: kept optional priorities >= dropped priorities (randomised)', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 200; round += 1) {
      const n = 1 + Math.floor(rand() * 12);
      const bs: ContextBlock[] = Array.from({ length: n }, (_, i) => ({
        id: `b${i}`,
        text: 'x'.repeat(Math.floor(rand() * 50)),
        priority: Math.floor(rand() * 5),
        required: rand() < 0.15,
      }));
      const budget = Math.floor(rand() * 200);
      const r = trimToBudget(bs, { budgetTokens: budget, estimate: fixedCost, perBlockOverheadTokens: 1 });
      if (!r.ok) continue;
      expect(r.usedTokens).toBeLessThanOrEqual(budget);
      const keptOptional = r.kept.filter((b) => b.required !== true).map((b) => b.priority);
      const droppedP = r.dropped.map((b) => b.priority);
      if (keptOptional.length && droppedP.length) {
        expect(Math.min(...keptOptional)).toBeGreaterThanOrEqual(Math.max(...droppedP));
      }
      expect(r.kept.length + r.dropped.length).toBe(n);
      expect(r.kept.every((b) => bs.indexOf(b) >= 0)).toBe(true);
      // kept preserves input order
      const positions = r.kept.map((b) => bs.indexOf(b));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  test('per-block overhead is charged to every block', () => {
    const r = trimToBudget(
      [
        { id: 'a', text: 'aaaa', priority: 2 },
        { id: 'b', text: 'bbbb', priority: 1 },
      ],
      { budgetTokens: 10, estimate: fixedCost, perBlockOverheadTokens: 2 },
    );
    expect(ids(r.kept)).toEqual(['a']);
    expect(r.costById.get('b')).toBe(6);
  });

  test('default estimator works on wrapped untrusted blocks', () => {
    const wrapped = wrapUntrusted('a note from another party '.repeat(50), { source: 'peer.note' });
    const r = trimToBudget(
      [
        { id: 'policy', text: 'Follow the protocol.', priority: 100, required: true },
        { id: 'peer-note', text: wrapped.text, priority: 1 },
      ],
      { budgetTokens: 50 },
    );
    expect(ids(r.kept)).toEqual(['policy']);
    expect(ids(r.dropped)).toEqual(['peer-note']);
  });

  test('validates inputs', () => {
    expect(() => trimToBudget([], { budgetTokens: -1 })).toThrow(RangeError);
    expect(() => trimToBudget([], { budgetTokens: 10, perBlockOverheadTokens: Number.NaN })).toThrow(RangeError);
    expect(() =>
      trimToBudget(
        [
          { id: 'a', text: '', priority: 1 },
          { id: 'a', text: '', priority: 2 },
        ],
        { budgetTokens: 10 },
      ),
    ).toThrow(/duplicate block id/);
    expect(() => trimToBudget([{ id: '', text: '', priority: 1 }], { budgetTokens: 10 })).toThrow(TypeError);
    expect(() => trimToBudget([{ id: 'a', text: '', priority: Number.POSITIVE_INFINITY }], { budgetTokens: 10 })).toThrow(RangeError);
    expect(() => trimToBudget([{ id: 'a', text: 'x', priority: 1 }], { budgetTokens: 10, estimate: () => -1 })).toThrow(RangeError);
  });

  test('empty input fits trivially', () => {
    expect(trimToBudget([], { budgetTokens: 0 })).toMatchObject({ ok: true, kept: [], dropped: [], usedTokens: 0 });
  });
});
