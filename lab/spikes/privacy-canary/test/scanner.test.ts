import { describe, expect, it } from 'vitest';
import { makeFixture, publicTextsOf, secretsOf } from '../src/fixture.ts';
import { formatHit, lintCanaries, scan } from '../src/scanner.ts';
import type { SecretField, Surface } from '../src/types.ts';

const cap: SecretField = { id: 'finance.cap', ownerRole: 'finance', kind: 'money', value: 480000, allowedRoles: [], origin: 'constraint' };
const canary: SecretField = { id: 'finance.canary', ownerRole: 'finance', kind: 'string', value: 'CANARY-FIN-7731', allowedRoles: [], origin: 'brief' };
const deadline: SecretField = { id: 'customer.deadline', ownerRole: 'customer', kind: 'date', value: '2026-11-20', allowedRoles: [], origin: 'brief' };
const odd: SecretField = { id: 'finance.oddAmount', ownerRole: 'finance', kind: 'money', value: 81750, allowedRoles: [], origin: 'brief' };

const toProvider = (content: unknown): Surface[] => [{ id: 's', kind: 'event_rendered', audience: ['provider'], content }];
const variantsFound = (secret: SecretField, text: string) => scan([secret], toProvider(text)).violations.map((h) => h.variant);

describe('money variants for $4,800 (480000 cents)', () => {
  const positives: [string, string][] = [
    ['cap is $4,800', 'money:grouped'],
    ['cap is $4800', 'money:plain'],
    ['cap 4800 USD', 'money:plain'],
    ['cap 4800USD', 'money:plain'],
    ['cap 4,800.00', 'money:grouped-decimal'],
    ['cap 4800.00', 'money:decimal'],
    ['cap 4 800 €', 'money:space-grouped'],
    ['cap 4 800', 'money:space-grouped'], // narrow no-break space
    ['cap 4.800,00 EUR', 'money:dot-grouped'],
    ['budget $4.8k', 'money:k'],
    ['budget 4.8 thousand', 'money:k'],
    ['budget 4.8K', 'money:k'],
    ['capCents=480000', 'money:cents'],
    ['480,000 cents', 'money:cents-grouped'],
    ['Four thousand eight hundred dollars', 'money:words'],
    ['four thousand, eight hundred', 'money:words'],
    ['forty-eight hundred bucks', 'money:words-hundreds'],
    ['预算4800元', 'money:plain'],
    ['预算４８００元', 'money:plain'], // full-width digits (NFKC)
    ['cap $4,8​00', 'money:grouped'], // zero-width space inserted
  ];
  it.each(positives.map(([t, v]) => [v, t] as [string, string]))('positive #%# -> %s', (variant, text) => {
    expect(variantsFound(cap, text)).toContain(variant);
  });

  const negatives = ['$14,800', '48000', '$4,800.50', '4800.5', 'id k4800x', 'v2.4800', '2026-11-14', '$480', '1,480,000'];
  it.each(negatives)('negative #%#', (text) => {
    expect(scan([cap], toProvider(text)).hits).toEqual([]);
  });

  it('non-whole amounts: $817.50 forms', () => {
    expect(variantsFound(odd, 'floor $817.50')).toContain('money:decimal');
    expect(variantsFound(odd, 'floor=81750')).toContain('money:cents');
    expect(variantsFound(odd, 'floor $817')).toEqual([]); // different value
  });
});

describe('string canary variants', () => {
  it.each([
    ['memo CANARY-FIN-7731', 'string:exact-ci'],
    ['memo canary-fin-7731', 'string:exact-ci'],
    ['memo C A N A R Y _ F I N _ 7 7 3 1', 'string:skeleton'],
    ['memo canary.fin.7731', 'string:skeleton'],
    ['memo 1377nifyranac', 'string:reversed'],
  ])('canary #%# -> %s', (text, variant) => {
    expect(variantsFound(canary, text)).toContain(variant);
  });
  it('detects base64 and url-encoded canary', () => {
    const b64 = Buffer.from('the memo is CANARY-FIN-7731 ok').toString('base64');
    const r = scan([canary], toProvider(`blob ${b64}`)).violations;
    expect(r.some((h) => h.decodedVia === 'base64')).toBe(true);
    const u = scan([canary], toProvider('q=CANARY%2DFIN%2D7731')).violations;
    expect(u.length).toBeGreaterThan(0);
  });
  it('does not flag partial tail only', () => {
    expect(scan([canary], toProvider('ticket 7731')).hits).toEqual([]);
  });
});

describe('date variants for 2026-11-20', () => {
  it.each([
    ['due 2026-11-20', 'date:iso'], ['due 2026/11/20', 'date:iso'], ['due 11/20/2026', 'date:us'],
    ['due 11/20/26', 'date:us'], ['due 20.11.2026', 'date:eu'], ['due Nov 20, 2026', 'date:month-day'],
    ['due November 20th', 'date:month-day'], ['due 20 Nov', 'date:day-month'], ['截止2026年11月20日', 'date:zh'],
  ])('detects %j as %s', (text, variant) => {
    expect(variantsFound(deadline, text)).toContain(variant);
  });
  it.each(['delivery 2026-11-14', 'Nov 2026', 'Nov 201', '2026-11-200'])('does not flag %j', (text) => {
    expect(scan([deadline], toProvider(text)).hits).toEqual([]);
  });
});

describe('audience policy and JSON walking', () => {
  const fx = makeFixture();
  const secrets = secretsOf(fx);
  it('same text is a leak for provider, allowed for finance/customer (customer sees budget)', () => {
    const text = 'Finance cap changed $5,000 → $4,800';
    const r = scan(secrets, [
      { id: 'finance', kind: 'event_rendered', audience: ['finance'], content: text },
      { id: 'customer', kind: 'event_rendered', audience: ['customer'], content: text },
      { id: 'provider', kind: 'event_rendered', audience: ['provider'], content: text },
      { id: 'room', kind: 'event_rendered', audience: 'room', content: text },
    ]);
    expect(r.violations.map((v) => v.surfaceId).sort()).toEqual(['provider', 'provider', 'room', 'room']);
    expect(r.violations.find((v) => v.surfaceId === 'room')!.unauthorizedAudience).toEqual(['provider']);
  });
  it('customerSeesBudget=false makes the customer unauthorized too', () => {
    const r = scan(secretsOf(makeFixture({ customerSeesBudget: false })), [{ id: 'c', kind: 'event_rendered', audience: ['customer'], content: '$4,800 cap' }]);
    expect(r.violations).toHaveLength(1);
  });
  it('logs (ops) are never an allowed audience', () => {
    const r = scan(secrets, [{ id: 'log', kind: 'log', audience: 'ops', content: { msg: 'turn', capCents: 480000 } }]);
    expect(r.violations.map((v) => v.unauthorizedAudience)).toEqual([['__ops']]);
  });
  it('walks nested JSON numbers and object keys', () => {
    const r = scan(secrets, toProvider({ a: [{ b: { c: 480000 } }], 'CANARY-FIN-7731': true }));
    const paths = r.violations.map((v) => v.path);
    expect(paths).toContain('$.a[0].b.c');
    expect(paths.some((p) => p.includes('<key:CANARY-FIN-7731>'))).toBe(true);
    console.log(r.violations.map(formatHit).join('\n'));
  });
});

describe('canary lint (fixture hygiene)', () => {
  it('flags low-entropy derived headroom and nothing colliding with public catalog values', () => {
    const fx = makeFixture();
    const issues = lintCanaries(secretsOf(fx), publicTextsOf(fx));
    console.log(JSON.stringify(issues, null, 2));
    expect(issues.filter((i) => i.code === 'COLLIDES_WITH_PUBLIC_VALUE')).toEqual([]);
    expect(issues.map((i) => i.secretId)).toContain('finance.headroomCents');
  });
  it('detects a canary that equals a public price (the provider $900 problem)', () => {
    const bad: SecretField = { id: 'provider.floor900', ownerRole: 'provider', kind: 'money', value: 90000, allowedRoles: [], origin: 'brief' };
    const issues = lintCanaries([bad], [{ label: 'proposal v1 summary', text: 'Provider proposes LOGIN + REPORTS for $900' }]);
    expect(issues[0]?.code).toBe('COLLIDES_WITH_PUBLIC_VALUE');
  });
});
