import { expect, it } from 'vitest';
import { API_ERROR_CODES, ERROR_CODES, REASON_CODES, PARAM_AUDIENCE, audienceParams, cents, addDays, isoDate, checkProposal } from '../../../core/engine';
import { vReasonCode, vErrorCode, zReasonCode, zErrorCode } from '../../../convex/lib/validators';
import { appError, API_PARAM_NAMES, wireKinds } from '../../../convex/lib/errors';
import { input, plugin, proposal } from './fixture';

it.each(ERROR_CODES)('canon-1.5 %s exists with declared audiences', code => {
  expect(PARAM_AUDIENCE).toHaveProperty(code);
  for (const rule of Object.values(PARAM_AUDIENCE[code])) {
    expect(typeof rule === 'object' ? 'ifDisclosed' in rule : ['room', 'owner', 'caller', 'projectedCodes'].includes(rule)).toBe(true);
  }
});
it('12.4 API_ERROR_CODES has 13 codes disjoint from REASON_CODES', () => {
  expect(API_ERROR_CODES).toHaveLength(13);
  expect(API_ERROR_CODES.filter(code => (REASON_CODES as readonly string[]).includes(code))).toEqual([]);
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  expect(PARAM_AUDIENCE['item.limit_exceeded']).toMatchObject({ limit: 'caller' });
  expect(PARAM_AUDIENCE['approval.not_executable']).toEqual({ reasonCodes: 'projectedCodes' });
});
it('06-6.3 provider as caller keeps retryAfterMs', () => {
  expect(audienceParams('run.rate_limited', 'provider', { retryAfterMs: 5000, secret: 1 })).toEqual({ retryAfterMs: 5000 });
  expect(audienceParams('input.invalid', 'provider', { field: 'title' })).toEqual({ field: 'title' });
  expect(audienceParams('budget.over', 'provider', { overByCents: 1 })).toEqual({});
  expect(audienceParams('approval.not_executable', 'provider', { reasonCodes: ['budget.over'] }, { projectedCodes: ['budget.over'] })).toEqual({});
  expect(audienceParams('approval.not_executable', 'customer', { reasonCodes: ['budget.over'] })).toEqual({});
  expect(audienceParams('approval.not_executable', 'customer', { reasonCodes: ['budget.over'] }, { projectedCodes: ['private.constraint_unmet'] })).toEqual({ reasonCodes: ['private.constraint_unmet'] });
});
it('T06-S4 PARAM_AUDIENCE covers every emitted param', () => {
  expect(vReasonCode.members.map(member => member.value)).toEqual(REASON_CODES);
  expect(vErrorCode.members.map(member => member.value)).toEqual(ERROR_CODES);
  expect(zReasonCode.options).toEqual(REASON_CODES);
  expect(zErrorCode.options).toEqual(ERROR_CODES);
  const p = proposal();
  const variants = [p, proposal(input.catalog.filter(r => r.kind === 'item').map(r => r.itemKey)),
    { ...p, terms: { ...p.terms, itemKeys: [] } },
    { ...p, terms: { ...p.terms, itemKeys: ['unknown_item'] } },
    { ...p, terms: { ...p.terms, itemKeys: [...p.terms.itemKeys, p.terms.itemKeys[0]!] } },
    { ...p, terms: { ...p.terms, deliveryDate: isoDate('2026-01-01') } },
    { ...p, terms: { ...p.terms, deliveryDate: addDays(input.localDate, 366) } },
    { ...p, terms: { ...p.terms, amountCents: cents(1) } },
    { ...p, terms: { ...p.terms, deliveryDate: 'invalid' as typeof p.terms.deliveryDate } },
  ];
  const seen = new Set<string>();
  for (const catalog of [input.catalog, input.catalog.map(r => ({ ...r, status: 'retired' as const })), input.catalog.map(r => ({ ...r, revision: r.revision + 1 }))]) {
    for (const capCents of [cents(0), cents(400000), input.capCents]) for (const value of variants) {
      for (const check of checkProposal(plugin, { ...input, catalog, capCents }, value).checks) {
        if (!check.code) continue;
        for (const name of Object.keys(check.params)) {
          seen.add(name);
          expect(Object.hasOwn(PARAM_AUDIENCE[check.code], name), `${check.code}.${name}`).toBe(true);
        }
      }
    }
  }
  // Include values emitted at write boundaries, beyond the proposal-check namespace.
  const writes = [
    appError('item.limit_exceeded', { field: 'catalog', limit: 12 }),
    appError('approval.not_executable', { reasonCodes: ['private.constraint_unmet'] }),
    appError('run.rate_limited', { retryAfterMs: 1000 }),
    appError('invite.seat_taken', { role: 'provider' }),
    appError('version.stale_constraints', { currentConstraintsVersion: 2 }),
  ];
  for (const error of writes) for (const name of Object.keys(error.data.params)) {
    expect(Object.hasOwn(PARAM_AUDIENCE[error.data.code as keyof typeof PARAM_AUDIENCE], name), `${error.data.code}.${name}`).toBe(true);
  }
  for (const [code, names] of Object.entries(API_PARAM_NAMES)) for (const name of names) {
    expect(Object.hasOwn(PARAM_AUDIENCE[code as keyof typeof PARAM_AUDIENCE], name), `${code}.${name}`).toBe(true);
    expect(Object.hasOwn(wireKinds, name), name).toBe(true);
  }
  expect([...seen]).toEqual(expect.arrayContaining(['itemKeys', 'field', 'localDate', 'min', 'max', 'deadline', 'daysLate', 'overByCents', 'headroomCents', 'belowByCents', 'reason']));
});
