import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReferenceFormatters, createRenderer, emptyFragment, fragment, type Formatters } from '../src/index.ts';
import { deferredItemsClause, proposalSummary } from '../src/examples/negotiation.ts';

const GOLDEN = 'Provider proposes LOGIN + REPORTS for $1,234.50, delivery 2026-11-14; EXPORT + AUDIT deferred.';
const values = () => ({
  actor: 'provider' as const,
  items: ['LOGIN', 'REPORTS'],
  amount: 123450,
  deliveryDate: '2026-11-14',
  deferred: fragment(deferredItemsClause, { items: ['EXPORT', 'AUDIT'] }),
});

describe('determinism', () => {
  it('same input gives byte-identical output across repeated renders and fresh renderers', () => {
    const outputs = new Set<string>();
    for (let i = 0; i < 500; i++) {
      outputs.add(createRenderer({ formatters: createReferenceFormatters() }).render(proposalSummary, values()));
    }
    assert.deepEqual([...outputs], [GOLDEN]);
  });

  it('field insertion order does not matter', () => {
    const r = createRenderer({ formatters: createReferenceFormatters() });
    const v = values();
    const reversed = Object.fromEntries(Object.entries(v).reverse()) as typeof v;
    assert.deepEqual(Object.keys(reversed), Object.keys(v).reverse());
    assert.equal(r.render(proposalSummary, reversed), GOLDEN);
  });

  it('does not read the clock, randomness or locale while rendering', () => {
    const r = createRenderer({ formatters: createReferenceFormatters() });
    const saved = { now: Date.now, random: Math.random, toLocaleString: Number.prototype.toLocaleString };
    const boom = () => {
      throw new Error('non-deterministic API used');
    };
    Date.now = boom;
    Math.random = boom;
    Number.prototype.toLocaleString = boom;
    try {
      assert.equal(r.render(proposalSummary, values()), GOLDEN);
    } finally {
      Date.now = saved.now;
      Math.random = saved.random;
      Number.prototype.toLocaleString = saved.toLocaleString;
    }
  });

  it('a fragment is a snapshot: mutating the source array afterwards has no effect', () => {
    const r = createRenderer({ formatters: createReferenceFormatters() });
    const items = ['EXPORT', 'AUDIT'];
    const deferred = fragment(deferredItemsClause, { items });
    items[0] = 'CANARY_CHANGED';
    items.push('MORE');
    assert.equal(r.render(proposalSummary, { ...values(), deferred }), GOLDEN);
  });

  it('formatters receive canonical values and are called once per slot', () => {
    const calls: string[] = [];
    const base = createReferenceFormatters();
    const spy: Formatters = {
      amount: (v) => (calls.push(`amount:${v}`), base.amount(v)),
      date: (v) => (calls.push(`date:${v}`), base.date(v)),
      integer: (v) => (calls.push(`integer:${v}`), base.integer(v)),
      list: (v) => (calls.push(`list:${v.join(',')}`), base.list(v)),
    };
    const r = createRenderer({ formatters: spy });
    r.render(proposalSummary, { ...values(), deferred: emptyFragment });
    assert.deepEqual(calls, ['list:LOGIN,REPORTS', 'amount:123450', 'date:2026-11-14']);
  });

  it('injected formatters change presentation only', () => {
    const eur = createRenderer({ formatters: { ...createReferenceFormatters({ currencySymbol: 'EUR ', listSeparator: ', ' }), date: (d) => d.split('-').reverse().join('.') } });
    assert.equal(eur.render(proposalSummary, values()), 'Provider proposes LOGIN, REPORTS for EUR 1,234.50, delivery 14.11.2026; EXPORT, AUDIT deferred.');
  });
});

describe('reference formatters', () => {
  it('format amounts with integer arithmetic', () => {
    const f = createReferenceFormatters();
    assert.equal(f.amount(0), '$0');
    assert.equal(f.amount(5), '$0.05');
    assert.equal(f.amount(90000), '$900');
    assert.equal(f.amount(123456789), '$1,234,567.89');
    assert.equal(f.amount(-480000), '-$4,800');
    assert.equal(f.amount(Number.MAX_SAFE_INTEGER), '$90,071,992,547,409.91');
    assert.equal(createReferenceFormatters({ omitZeroMinor: false }).amount(90000), '$900.00');
    assert.equal(createReferenceFormatters({ currencySymbol: 'JPY ', minorDigits: 0 }).amount(1500), 'JPY 1,500');
  });
});
