import {expect, it} from 'vitest';
import {API_ERROR_CODES, ERROR_CODES, REASON_CODES, PARAM_AUDIENCE, REDACTABLE_FIELDS} from '../../core/engine';
import {API_PARAM_NAMES, wireKinds, appError} from '../../convex/lib/errors';
import {errorCodeV} from '../../convex/lib/validators';
import {TERMS_KEY_FIELDS} from '../../convex/lib/schemaTypes';

it('11.6 every declared audience and API parameter has a wire validator', () => {
  for (const params of Object.values(PARAM_AUDIENCE)) for (const name of Object.keys(params)) expect(Object.hasOwn(wireKinds, name), name).toBe(true);
  for (const params of Object.values(API_PARAM_NAMES)) for (const name of params) expect(Object.hasOwn(wireKinds, name), name).toBe(true);
  expect(wireKinds.limit!.safeParse(12).success).toBe(true);
  expect(wireKinds.limit!.safeParse(-1).success).toBe(false);
  expect(wireKinds.reasonCodes!.safeParse(['budget.over']).success).toBe(true);
  expect(wireKinds.reasonCodes!.safeParse(['unknown.code']).success).toBe(false);
  expect(API_PARAM_NAMES['item.limit_exceeded']).toContain('limit');
  expect(API_PARAM_NAMES['approval.not_executable']).toEqual(['reasonCodes']);
});
it('12.4 write-boundary parameters are accepted alongside check-result params', () => {
  for (const code of ['date.in_past', 'item.unknown', 'item.duplicate', 'item.retired', 'item.required_missing', 'item.unconfirmed'] as const) expect(appError(code, {field: 'itemKeys'}).data).toEqual({code, params: {field: 'itemKeys'}});
  expect(appError('run.rate_limited', {retryAfterMs: 1000}).data.params).toEqual({retryAfterMs: 1000});
});
it('03 redactable fields never overlap terms-key fields', () => {
  const paths = Object.entries(REDACTABLE_FIELDS).flatMap(([table, fields]) => fields.map(field => `${table}.${field}`));
  for (const path of paths) for (const term of TERMS_KEY_FIELDS) expect(path === term || path.startsWith(`${term}.`) || term.startsWith(`${path}.`), `${path} overlaps ${term}`).toBe(false);
});
it('12.4 API and reason codes are disjoint, API codes are exact, and wire literals equal their union', () => {
  const expected = ['auth.unauthenticated', 'auth.user_not_provisioned', 'auth.not_member', 'auth.role_forbidden', 'auth.not_creator', 'invite.invalid', 'invite.email_unverified', 'invite.seat_taken', 'invite.already_member', 'request.not_open', 'request.option_unknown', 'input.invalid', 'internal'];
  expect([...API_ERROR_CODES].sort()).toEqual(expected.sort());
  expect(API_ERROR_CODES.filter(code => (REASON_CODES as readonly string[]).includes(code))).toEqual([]);
  expect(ERROR_CODES).toEqual([...REASON_CODES, ...API_ERROR_CODES]);
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  expect(errorCodeV.members.map(member => member.value)).toEqual(ERROR_CODES);
});
