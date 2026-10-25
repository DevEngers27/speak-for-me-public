import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReferenceFormatters, createRenderer, defineTemplate, emptyFragment, fragment, htmlEncoder, slot,
  type Formatters,
} from '../src/index.ts';
import { assertTemplateError, loose } from './helpers.ts';

const formatters = createReferenceFormatters();
const r = createRenderer({ formatters });
const RLO = String.fromCodePoint(0x202e);

const greeting = defineTemplate({
  id: 'test.greeting',
  slots: { who: slot.text({ maxLength: 20 }), n: slot.integer({ min: 1, max: 9 }) },
  text: 'Hello {who}, you have {n} items.',
});

describe('defineTemplate', () => {
  it('returns a frozen template', () => {
    assert.ok(Object.isFrozen(greeting));
    assert.ok(Object.isFrozen(greeting.slots));
  });

  it('rejects text/slot mismatches at runtime (for JS callers or casts)', () => {
    assertTemplateError(() => defineTemplate(loose({ id: 'x.a', slots: { a: slot.integer() }, text: '{a} {b}' })), 'INVALID_TEMPLATE');
    assertTemplateError(() => defineTemplate(loose({ id: 'x.b', slots: { a: slot.integer(), b: slot.integer() }, text: '{a}' })), 'INVALID_TEMPLATE');
  });

  it('rejects malformed text, bad ids and hand-made slot specs', () => {
    assertTemplateError(() => defineTemplate(loose({ id: 'x.c', slots: {}, text: 'stray } brace' })), 'INVALID_TEMPLATE');
    assertTemplateError(() => defineTemplate(loose({ id: 'x.d', slots: {}, text: 'open { brace' })), 'INVALID_TEMPLATE');
    assertTemplateError(() => defineTemplate(loose({ id: 'x.e', slots: {}, text: `bidi ${RLO}` })), 'INVALID_TEMPLATE');
    assertTemplateError(() => defineTemplate(loose({ id: 'Bad Id', slots: {}, text: 'x' })), 'INVALID_TEMPLATE');
    assertTemplateError(() => defineTemplate(loose({ id: 'x.f', slots: { a: { kind: 'text', maxLength: 9 } }, text: '{a}' })), 'INVALID_TEMPLATE');
  });

  it('rejects stateful token patterns', () => {
    assertTemplateError(() => slot.token({ pattern: /[A-Z]+/g }), 'INVALID_TEMPLATE');
  });
});

describe('render: field set is exact', () => {
  it('renders when every slot is supplied', () => {
    assert.equal(r.render(greeting, { who: 'Ana', n: 3 }), 'Hello Ana, you have 3 items.');
  });

  it('rejects unknown fields at runtime without echoing their value', () => {
    const e = assertTemplateError(
      () => r.render(greeting, loose({ who: 'Ana', n: 3, capCents: 480000 })),
      'UNKNOWN_SLOT',
      '480000',
    );
    assert.equal(e.slot, 'capCents');
    assert.equal(e.templateId, 'test.greeting');
  });

  it('does not echo a non-identifier unknown key', () => {
    const e = assertTemplateError(() => r.render(greeting, loose({ who: 'Ana', n: 3, 'CANARY-FIN-7731': 1 })), 'UNKNOWN_SLOT', 'CANARY');
    assert.equal(e.slot, '<non-identifier key>');
  });

  it('rejects missing fields', () => {
    assertTemplateError(() => r.render(greeting, loose({ who: 'Ana' })), 'MISSING_SLOT');
  });

  it('rejects non-plain value objects, symbol keys and accessors', () => {
    assertTemplateError(() => r.render(greeting, loose(null)), 'INVALID_VALUES');
    assertTemplateError(() => r.render(greeting, loose(['Ana', 3])), 'INVALID_VALUES');
    assertTemplateError(() => r.render(greeting, loose(new (class { who = 'Ana'; n = 3; })())), 'INVALID_VALUES');
    assertTemplateError(() => r.render(greeting, loose({ who: 'Ana', n: 3, [Symbol('s')]: 1 })), 'INVALID_VALUES');
    const withGetter = Object.defineProperty({ n: 3 }, 'who', { get: () => 'Ana', enumerable: true });
    assertTemplateError(() => r.render(greeting, loose(withGetter)), 'INVALID_VALUES');
  });

  it('accepts null-prototype value objects', () => {
    const v = Object.assign(Object.create(null) as object, { who: 'Ana', n: 3 });
    assert.equal(r.render(greeting, loose(v)), 'Hello Ana, you have 3 items.');
  });

  it('rejects objects that were not created by defineTemplate', () => {
    assertTemplateError(() => r.render(loose({ id: 'fake', slots: {}, text: 'x' }), loose({})), 'NOT_A_TEMPLATE');
  });
});

describe('render: slot validation', () => {
  it('text: bounds and unsafe characters, value never echoed', () => {
    assertTemplateError(() => r.render(greeting, { who: '', n: 1 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, { who: 'x'.repeat(21), n: 1 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, { who: 'line\nbreak', n: 1 }), 'INVALID_SLOT_VALUE', 'line');
    assertTemplateError(() => r.render(greeting, { who: `a${RLO}b`, n: 1 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, { who: ' padded', n: 1 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, { who: String.fromCharCode(0xd800), n: 1 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, loose({ who: 42, n: 1 })), 'INVALID_SLOT_VALUE');
  });

  it('integer, amount and date', () => {
    assertTemplateError(() => r.render(greeting, { who: 'A', n: 10 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(greeting, { who: 'A', n: 1.5 }), 'INVALID_SLOT_VALUE');
    const t = defineTemplate({ id: 'test.money', slots: { a: slot.amount(), d: slot.date(), s: slot.amount({ signed: true }) }, text: '{a}|{d}|{s}' });
    assert.equal(r.render(t, { a: 123456, d: '2028-02-29', s: -10000 }), '$1,234.56|2028-02-29|-$100');
    assertTemplateError(() => r.render(t, { a: -1, d: '2026-01-01', s: 0 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { a: 0.5, d: '2026-01-01', s: 0 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { a: Number.MAX_SAFE_INTEGER + 1, d: '2026-01-01', s: 0 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { a: 1, d: '2026-02-29', s: 0 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { a: 1, d: '2026-1-01', s: 0 }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { a: 1, d: '2026-11-14T00:00:00Z', s: 0 }), 'INVALID_SLOT_VALUE');
  });

  it('enum renders the authored label and rejects prototype keys', () => {
    const t = defineTemplate({ id: 'test.enum', slots: { r: slot.enum({ OK: 'fits', BAD: 'does not fit' }) }, text: 'It {r}.' });
    assert.equal(r.render(t, { r: 'BAD' }), 'It does not fit.');
    assertTemplateError(() => r.render(t, loose({ r: 'toString' })), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, loose({ r: 'ok' })), 'INVALID_SLOT_VALUE');
  });

  it('token and list', () => {
    const t = defineTemplate({ id: 'test.list', slots: { k: slot.list(slot.token({ pattern: /[A-Z]+/ }), { maxItems: 3 }) }, text: '[{k}]' });
    assert.equal(r.render(t, { k: ['A', 'B'] }), '[A + B]');
    assertTemplateError(() => r.render(t, { k: [] }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { k: ['A', 'B', 'C', 'D'] }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { k: ['A', 'b'] }), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(t, { k: ['AB C'] }), 'INVALID_SLOT_VALUE'); // pattern is anchored
    // eslint-disable-next-line no-sparse-arrays
    assertTemplateError(() => r.render(t, loose({ k: ['A', , 'B'] })), 'INVALID_SLOT_VALUE');
  });
});

describe('render: escaping', () => {
  const t = defineTemplate({ id: 'test.esc', slots: { label: slot.text(), d: slot.date() }, text: '<b>{label}</b> due {d}' });

  it('html encoder escapes slot output but not the trusted literal text', () => {
    const h = createRenderer({ formatters, encoder: htmlEncoder });
    assert.equal(h.render(t, { label: `<img src=x onerror="a('b')"> & co`, d: '2026-11-14' }),
      '<b>&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; co</b> due 2026-11-14');
  });

  it('slot values cannot inject placeholders (single-pass substitution)', () => {
    const two = defineTemplate({ id: 'test.inject', slots: { a: slot.text(), b: slot.text() }, text: '{a}/{b}' });
    assert.equal(r.render(two, { a: '{b}', b: 'B' }), '{b}/B');
  });

  it('formatter output is encoded too', () => {
    const hostile: Formatters = { ...formatters, date: () => `<x>${RLO}` };
    const h = createRenderer({ formatters: hostile, encoder: htmlEncoder });
    assert.equal(h.render(t, { label: 'L', d: '2026-11-14' }), `<b>L</b> due &lt;x&gt;${String.fromCodePoint(0xfffd)}`);
  });

  it('formatter failures are reported without values', () => {
    const throwing = createRenderer({ formatters: { ...formatters, date: () => { throw new Error('2026-11-14 secret'); } } });
    assertTemplateError(() => throwing.render(t, { label: 'L', d: '2026-11-14' }), 'FORMATTER_FAILED', 'secret');
    const wrongType = createRenderer({ formatters: { ...formatters, date: loose(() => 42) } });
    assertTemplateError(() => wrongType.render(t, { label: 'L', d: '2026-11-14' }), 'FORMATTER_FAILED');
  });
});

describe('fragments', () => {
  const clause = defineTemplate({ id: 'test.clause', slots: { k: slot.list(slot.token()) }, text: '; {k} deferred' });
  const other = defineTemplate({ id: 'test.other', slots: { n: slot.integer() }, text: '#{n}' });
  const parent = defineTemplate({ id: 'test.parent', slots: { a: slot.amount(), c: slot.optionalFragment([clause]) }, text: 'For {a}{c}.' });
  const strict = defineTemplate({ id: 'test.strict', slots: { c: slot.fragment([clause]) }, text: 'x{c}' });

  it('renders nested fragments and the empty fragment', () => {
    assert.equal(r.render(parent, { a: 90000, c: fragment(clause, { k: ['EXPORT'] }) }), 'For $900; EXPORT deferred.');
    assert.equal(r.render(parent, { a: 90000, c: emptyFragment }), 'For $900.');
    assert.equal(r.renderFragment(fragment(clause, { k: ['A', 'B'] })), '; A + B deferred');
  });

  it('validates fragment values eagerly', () => {
    assertTemplateError(() => fragment(clause, loose({ k: ['A'], capCents: 1 })), 'UNKNOWN_SLOT');
  });

  it('rejects fragments of unlisted templates, forged fragments and strings', () => {
    assertTemplateError(() => r.render(parent, loose({ a: 1, c: fragment(other, { n: 1 }) })), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(parent, loose({ a: 1, c: { templateId: 'test.clause' } })), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(parent, loose({ a: 1, c: '; cap $4,800' })), 'INVALID_SLOT_VALUE');
    assertTemplateError(() => r.render(strict, loose({ c: emptyFragment })), 'INVALID_SLOT_VALUE');
  });

  it('encodes fragment slots exactly once with the outer encoder', () => {
    const lbl = defineTemplate({ id: 'test.lbl', slots: { l: slot.text() }, text: '<i>{l}</i>' });
    const wrap = defineTemplate({ id: 'test.wrap', slots: { f: slot.fragment([lbl]) }, text: '[{f}]' });
    const h = createRenderer({ formatters, encoder: htmlEncoder });
    assert.equal(h.render(wrap, { f: fragment(lbl, { l: 'a&b' }) }), '[<i>a&amp;b</i>]');
  });
});
