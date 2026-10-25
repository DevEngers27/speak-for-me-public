import { buildRequestForTest } from '../../../tests/helpers/modelGateway';
import { afterEach, expect, it, vi } from 'vitest';
import {
  abortAfter,
  anySignal,
  buildRequest,
  callModel,
  classifyError,
  GatewayAPIError,
  GatewayConfigError,
  GatewayTimeoutError,
  LIST_PRICES,
  stubTransport,
  toAttemptOutcome,
  toUsageRecord,
  estimateCostMicroUsd,
  type ModelTransport,
} from './modelGateway';
import { ATTEMPT_ERROR_CODES } from '../../../core/engine/attemptErrors';
import { attemptErrorCodeV } from '../../lib/validators';

const schema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {},
};
const messages = [{ role: 'user' as const, content: 'context' }, { role: 'system' as const, content: 'This turn: kind propose. Allowed actions: propose, clarify, escalate.' }];
const params = {
  messages,
  schema,
  validate: (value: unknown) => ({ success: true as const, data: value }),
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const rows = [
  [
    'APIUserAbortError',
    Object.assign(new Error('SECRET'), { name: 'APIUserAbortError' }),
    'timeout',
    'model_timeout',
  ],
  [
    'APIConnectionTimeoutError',
    new GatewayTimeoutError(),
    'timeout',
    'model_timeout',
  ],
  [
    'APIConnectionError',
    Object.assign(new Error('SECRET'), { name: 'APIConnectionError' }),
    'error',
    'transport',
  ],
  [
    'RateLimitError',
    new GatewayAPIError(429, { type: 'rate_limit_error' }, 'SECRET'),
    'error',
    'transport',
  ],
  [
    'InternalServerError',
    new GatewayAPIError(500, {}, 'SECRET'),
    'error',
    'transport',
  ],
  [
    '529 overloaded',
    new GatewayAPIError(529, { type: 'overloaded_error' }, 'SECRET'),
    'error',
    'transport',
  ],
  [
    'stream overloaded_error',
    Object.assign(new Error('SECRET'), {
      name: 'APIError',
      error: { type: 'overloaded_error' },
    }),
    'error',
    'transport',
  ],
  [
    'BadRequestError',
    new GatewayAPIError(400, {}, 'SECRET'),
    'error',
    'bad_request',
  ],
  ['413', new GatewayAPIError(413, {}, 'SECRET'), 'error', 'bad_request'],
  [
    'UnprocessableEntityError',
    new GatewayAPIError(422, {}, 'SECRET'),
    'error',
    'bad_request',
  ],
  [
    'AuthenticationError',
    new GatewayAPIError(401, {}, 'SECRET'),
    'error',
    'auth',
  ],
  [
    'PermissionDeniedError',
    new GatewayAPIError(403, {}, 'SECRET'),
    'error',
    'auth',
  ],
  [
    'GatewayConfigError',
    new GatewayConfigError('SECRET'),
    'error',
    'config_invalid',
  ],
  [
    'billing_error',
    new GatewayAPIError(400, { type: 'billing_error' }, 'SECRET'),
    'error',
    'quota_exhausted',
  ],
  [
    'NotFoundError',
    new GatewayAPIError(404, {}, 'SECRET'),
    'error',
    'model_not_found',
  ],
  [
    'other APIError',
    new GatewayAPIError(409, {}, 'SECRET'),
    'error',
    'api_error',
  ],
  [
    'ConflictError',
    Object.assign(new Error('SECRET'), { name: 'ConflictError', status: 409 }),
    'error',
    'api_error',
  ],
  ...(
    [
      ['RateLimitError', 'transport'],
      ['InternalServerError', 'transport'],
      ['BadRequestError', 'bad_request'],
      ['UnprocessableEntityError', 'bad_request'],
      ['AuthenticationError', 'auth'],
      ['PermissionDeniedError', 'auth'],
      ['NotFoundError', 'model_not_found'],
      ['ConflictError', 'api_error'],
    ] as const
  ).map(
    ([name, code]) =>
      [
        name + ' without status',
        Object.assign(new Error('SECRET'), { name }),
        'error',
        code,
      ] as const,
  ),
  [
    'non-SDK numeric status',
    Object.assign(new TypeError('SECRET'), { status: 500 }),
    'error',
    'internal',
  ],
  ['non-SDK exception', new TypeError('SECRET'), 'error', 'internal'],
] as const;
for (const [name, error, status, code] of rows) {
  it(`10.15.2 ${name} → (${status}, ${code})`, async () => {
    const classified = classifyError(error);
    expect(classified.errorCode).toBe(code);
    expect(JSON.stringify(classified)).not.toContain('SECRET');
    const result = await callModel({
      ...params,
      transport: stubTransport(() => ({ kind: 'throw', error })),
      maxRetries: 0,
    });
    expect(toAttemptOutcome(result)).toEqual({ status, errorCode: code });
    expect(result.attemptStatus).toBe(status);
  });
}
it('10.15.1 error validator derives from the canonical error codes', () => {
  expect(attemptErrorCodeV.members.map((member) => member.value)).toEqual([
    ...ATTEMPT_ERROR_CODES,
  ]);
});
it('10.14.3 body never carries betas or fallbacks', () => {
  const body = buildRequest(params);
  expect(body).not.toHaveProperty('betas');
  expect(body).not.toHaveProperty('fallbacks');
  for (const key of ['betas', 'fallbacks'])
    expect(() =>
      buildRequestForTest({ ...params, extraBody: { [key]: [] } }),
    ).toThrow(GatewayConfigError);
});
it('CN-001 deadline expiry during backoff is timeout', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => {
    throw new GatewayAPIError(429, {}, 'SECRET');
  });
  const pending = callModel({
    ...params,
    transport: { provenance: 'live', send },
    totalBudgetMs: 50,
    retryBaseDelayMs: 1,
    sleep: () => new Promise(() => {}),
  });
  await vi.advanceTimersByTimeAsync(51);
  const result = await pending;
  expect(toAttemptOutcome(result)).toEqual({
    status: 'timeout',
    errorCode: 'model_timeout',
  });
  expect(result).toMatchObject({ gatewayRetryable: false });
  expect(send).toHaveBeenCalledTimes(1);
});
for (const [name, details, expected] of [
  ['present', { thinking_tokens: 12 }, 12],
  ['absent', undefined, 0],
] as const) {
  it(`10.16.1 thinkingTokens ${name}`, () => {
    expect(
      toUsageRecord('claude-opus-5-5', {
        input_tokens: 1,
        output_tokens: 20,
        output_tokens_details: details,
      }).thinkingTokens,
    ).toBe(expected);
  });
}
for (const category of ['safety', null]) {
  it(`10.16.1 stopCategory ${category === null ? 'null' : 'string'}`, async () => {
    const transport: ModelTransport = {
      provenance: 'live',
      async send(body, options) {
        const response = await stubTransport(() => ({
          kind: 'ok',
          data: {},
        })).send(body, options);
        return {
          ...response,
          message: {
            ...response.message,
            stop_details: category === null ? undefined : { category },
          },
        };
      },
    };
    const result = await callModel({ ...params, transport });
    expect(result.stopCategory).toBe(category);
    expect(result.attemptLogs[0]?.stopCategory).toBe(category);
  });
}
it('10.16.2 cost by responseModel', async () => {
  const transport: ModelTransport = {
    provenance: 'live',
    async send(body, options) {
      const response = await stubTransport(() => ({
        kind: 'ok',
        data: {},
        usage: { input_tokens: 1, output_tokens: 1 },
      })).send(body, options);
      return {
        ...response,
        message: { ...response.message, model: 'response-model' },
      };
    },
  };
  const result = await callModel({
    ...params,
    transport,
    prices: {
      ...LIST_PRICES,
      'response-model': {
        ...LIST_PRICES['claude-opus-5-5']!,
        inputPerMTokUsd: 100,
        outputPerMTokUsd: 200,
      },
    },
  });
  expect(result).toMatchObject({
    responseModel: 'response-model',
    usage: { estimatedCostMicroUsd: 300 },
  });
});
it('10.11 abortAfter without AbortSignal.timeout/any', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('AbortSignal', { timeout: undefined, any: undefined });
  const timeout = abortAfter(10);
  const combined = anySignal([timeout.signal]);
  await vi.advanceTimersByTimeAsync(11);
  expect(combined.signal.aborted).toBe(true);
  combined.dispose();
  timeout.dispose();
  const result = await callModel({
    ...params,
    transport: stubTransport(() => ({ kind: 'ok', data: {} })),
  });
  expect(result.ok).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const pending = callModel({
    ...params,
    totalBudgetMs: 10,
    timeoutMs: 10,
    transport: { provenance: 'live', send: () => new Promise(() => {}) },
  });
  await vi.advanceTimersByTimeAsync(11);
  expect(toAttemptOutcome(await pending)).toEqual({
    status: 'timeout',
    errorCode: 'model_timeout',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('W2-GW-r01 NotFoundError retains no HTTP fields', () => {
  expect(
    classifyError(
      new GatewayAPIError(404, {}, 'SECRET', { 'request-id': 'req_404' }),
    ),
  ).toMatchObject({
    errorCode: 'model_not_found',
    status: null,
    requestId: null,
    retryAfterMs: null,
  });
  expect(
    classifyError(
      Object.assign(new Error('SECRET'), {
        name: 'RateLimitError',
        headers: { 'retry-after-ms': '12' },
      }),
    ),
  ).toMatchObject({
    errorCode: 'transport',
    gatewayRetryable: true,
    retryAfterMs: 12,
  });
});
for (const [responseModel, pricingBasis] of [
  ['claude-opus-5-5', 'response_model'],
  ['claude-opus-5-5-20260514', 'model_family'],
  ['unindexed-response-model', 'request_model'],
] as const) {
  it(`W2-GW-r02 prices ${responseModel} by ${pricingBasis} without losing completion`, async () => {
    const raw = { input_tokens: 1, output_tokens: 1 };
    expect(estimateCostMicroUsd(responseModel, raw)).toBe(30);
    expect(toUsageRecord(responseModel, raw)).toMatchObject({
      estimatedCostMicroUsd: 30,
      pricingBasis,
    });
    const result = await callModel({
      ...params,
      transport: stubTransport(() => ({
        kind: 'ok',
        data: {},
        servedModel: responseModel,
        usage: raw,
        requestId: 'paid_response',
      })),
    });
    expect(result).toMatchObject({
      ok: true,
      responseModel,
      requestId: 'paid_response',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostMicroUsd: 30,
        pricingBasis,
      },
    });
    expect(result.attemptLogs[0]).toMatchObject({
      responseModel,
      usage: { pricingBasis },
    });
  });
}
it('W2-GW-r02 incomplete supplied price table preserves paid response usage', async () => {
  const result = await callModel({
    ...params,
    prices: {},
    transport: stubTransport(() => ({
      kind: 'ok',
      data: {},
      servedModel: 'unknown',
      usage: { input_tokens: 2, output_tokens: 3 },
    })),
  });
  expect(result).toMatchObject({
    ok: true,
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      estimatedCostMicroUsd: 85,
      pricingBasis: 'request_model',
    },
  });
});

for (const [name, totalBudgetMs, expectedSends] of [
  ['used-up-429', 1000, 2],
  ['skipped-for-budget', 50, 1],
] as const) {
  it(`W2-GW-i02 ${name} final transport failure is not retryable`, async () => {
    const send = vi.fn(async () => {
      throw new GatewayAPIError(429, {}, 'rate limited');
    });
    const result = await callModel({
      ...params,
      transport: { provenance: 'live', send },
      totalBudgetMs,
      retryBaseDelayMs: 100,
      now: () => 0,
      sleep: async () => {},
    });
    expect(result).toMatchObject({
      kind: 'error',
      errorCode: 'transport',
      gatewayRetryable: false,
    });
    expect(send).toHaveBeenCalledTimes(expectedSends);
  });
}
it('W2-GW-i05 final 404 retains no HTTP metadata', async () => {
  const error = new GatewayAPIError(404, {}, 'SECRET', {
    'request-id': 'secret_request',
    'retry-after-ms': '123',
  });
  const result = await callModel({
    ...params,
    transport: stubTransport(() => ({ kind: 'throw', error })),
  });
  expect(result).toMatchObject({
    errorCode: 'model_not_found',
    status: null,
    requestId: null,
    usage: null,
  });
  expect(result.attemptLogs[0]).toMatchObject({
    httpStatus: null,
    requestId: null,
  });
  expect(JSON.stringify(classifyError(error))).not.toMatch(
    /404|secret_request|123|SECRET/,
  );
});
it('W2-GW-i07 first message must be user and format accepts only type/schema', () => {
  expect(() =>
    buildRequest({
      ...params,
      messages: [{ role: 'assistant', content: 'history' }, ...messages],
    }),
  ).toThrow(GatewayConfigError);
  const body = buildRequest(params);
  for (const extra of [
    { name: 'format' },
    { strict: true },
    { unknown: null },
  ]) {
    expect(() =>
      buildRequestForTest({
        ...params,
        extraBody: {
          output_config: {
            ...body.output_config,
            format: { ...body.output_config.format, ...extra },
          },
        },
      }),
    ).toThrow(GatewayConfigError);
  }
});
it('W2-GW-i07 retry backoff cap rejects >8000 before sending', async () => {
  const send = vi.fn(stubTransport(() => ({ kind: 'ok', data: {} })).send);
  await expect(
    callModel({
      ...params,
      maxRetryDelayMs: 8001,
      transport: { provenance: 'stub', send },
    }),
  ).rejects.toMatchObject({
    name: 'GatewayConfigError',
    code: 'config_invalid',
  });
  expect(send).not.toHaveBeenCalled();
  expect(
    (
      await callModel({
        ...params,
        maxRetryDelayMs: 8000,
        transport: { provenance: 'stub', send },
      })
    ).ok,
  ).toBe(true);
});
it('W2-GW-i07 production builders reject extraBody overrides', async () => {
  expect(() =>
    // @ts-expect-error Malformed-body overrides belong exclusively to the test helper.
    buildRequest({ ...params, extraBody: { model: 'other' } }),
  ).toThrow(GatewayConfigError);
  await expect(
    callModel({
      ...params,
      transport: stubTransport(() => ({ kind: 'ok', data: {} })),
      // @ts-expect-error No production call-time body override seam.
      extraBody: { max_tokens: 1 },
    }),
  ).rejects.toThrow(GatewayConfigError);
});
