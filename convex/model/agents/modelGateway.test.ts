import { buildRequestForTest as buildRequest } from '../../../tests/helpers/modelGateway';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ACTION_WALL_MAX_MS,
  anthropicTransport,
  assertBudgetInequalities,
  assertWhitelisted,
  type AttemptTelemetry,
  CALL_DEADLINE_MS,
  callModel,
  classifyError,
  createFetchStreamClient,
  estimateCostMicroUsd,
  GatewayAPIError,
  GatewayTimeoutError,
  type JsonSchemaObject,
  LIST_PRICES,
  MAX_TOKENS,
  MODEL_BUDGET,
  GatewayConfigError,
  type ModelPrice,
  NEGOTIATION_EFFORT,
  NEGOTIATION_MODEL,
  REQUEST_TIMEOUT_MS,
  sequenceResponder,
  stubTransport,
  toUsageRecord,
  WATCHDOG_FINAL_MS,
  WATCHDOG_FIRST_MS,
  WATCHDOG_REARM_MS,
} from './modelGateway';

interface CounterOfferDecision {
  readonly action: 'accept' | 'counter' | 'escalate';
  readonly totalPriceCents: number;
  readonly includedItemKeys: readonly string[];
}

const DECISION_JSON_SCHEMA: JsonSchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action', 'totalPriceCents', 'includedItemKeys'],
  properties: {
    action: {
      type: 'string',
      enum: ['accept', 'counter', 'escalate'],
    },
    totalPriceCents: {
      type: 'integer',
    },
    includedItemKeys: {
      type: 'array',
      items: { type: 'string' },
    },
  },
});

const DecisionZodSchema = z.strictObject({
  action: z.enum(['accept', 'counter', 'escalate']),
  totalPriceCents: z.number().int().nonnegative(),
  includedItemKeys: z.array(z.string()),
});

function validateDecision(raw: unknown) {
  return DecisionZodSchema.safeParse(raw);
}

const SAMPLE_MESSAGES = [
  {
    role: 'user' as const,
    content: 'Evaluate Round 2 scope change proposal.',
  },
  { role: 'system' as const, content: 'This turn: kind evaluate. Allowed actions: counter, escalate.' },
];

describe('convex/model/agents/modelGateway — Canon D09 budget & parameter whitelist', () => {
  it('verifies derived timeout and watchdog budget inequalities', () => {
    expect(MAX_TOKENS).toBe(16_000);
    expect(REQUEST_TIMEOUT_MS).toBe(220_000);
    expect(CALL_DEADLINE_MS).toBe(230_000);
    expect(ACTION_WALL_MAX_MS).toBe(270_000);
    expect(WATCHDOG_FIRST_MS).toBe(275_000);
    expect(WATCHDOG_REARM_MS).toBe(220_000);
    expect(WATCHDOG_FINAL_MS).toBe(935_000);

    expect(() => assertBudgetInequalities(MODEL_BUDGET)).not.toThrow();

    // r03: budget violations throw GatewayConfigError
    expect(() =>
      assertBudgetInequalities({
        ...MODEL_BUDGET,
        REQUEST_TIMEOUT_MS: 100_000,
      }),
    ).toThrow(GatewayConfigError);

    expect(() =>
      assertBudgetInequalities({
        ...MODEL_BUDGET,
        WATCHDOG_FIRST_MS: 200_000,
      }),
    ).toThrow(GatewayConfigError);
  });

  it('builds a canonical request with claude-opus-5-5, max_tokens 16000, output_config.effort, and output_config.format json_schema', () => {
    const req = buildRequest({
      system: 'Negotiation engine system prompt.',
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
    });

    expect(req.model).toBe('claude-opus-5-5');
    expect(req.max_tokens).toBe(16_000);
    expect(req.output_config).toEqual({
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: DECISION_JSON_SCHEMA,
      },
    });
    expect('betas' in req).toBe(false);
    expect('fallbacks' in req).toBe(false);
  });

  it('10.14.3 MODEL_FALLBACKS=on rejected', () => {
    for (const flags of [
      { env: { MODEL_FALLBACKS: 'on' } },
      { enableFallbacks: true },
      { enableFallbacks: false, env: { MODEL_FALLBACKS: 'on' } },
    ]) {
      expect(() =>
        buildRequest({
          messages: SAMPLE_MESSAGES,
          schema: DECISION_JSON_SCHEMA,
          ...flags,
        }),
      ).toThrow(GatewayConfigError);
    }
    vi.stubEnv('MODEL_FALLBACKS', 'on');
    try {
      expect(() =>
        buildRequest({
          messages: SAMPLE_MESSAGES,
          schema: DECISION_JSON_SCHEMA,
        }),
      ).toThrow(GatewayConfigError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects forbidden parameters (thinking, sampling, tools, tool_choice, stop_sequences, assistant prefill, system role at position zero)', () => {
    const forbiddenExtras: Array<Record<string, unknown>> = [
      { thinking: { type: 'enabled', budget_tokens: 4000 } },
      { temperature: 0.2 },
      { top_p: 0.9 },
      { top_k: 40 },
      { tools: [] },
      { tool_choice: { type: 'auto' } },
      { stop_sequences: ['STOP'] },
      { metadata: { user_id: 'u1' } },
      { service_tier: 'auto' },
      { unknown_param: 123 },
    ];

    for (const extraBody of forbiddenExtras) {
      expect(() =>
        buildRequest({
          messages: SAMPLE_MESSAGES,
          schema: DECISION_JSON_SCHEMA,
          extraBody,
        }),
      ).toThrow(GatewayConfigError);
    }

    // Disallowed model
    expect(() =>
      buildRequest({
        model: 'claude-3-5-sonnet-20241022' as never,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
      }),
    ).toThrow(GatewayConfigError);

    // Assistant prefill (trailing assistant message) is forbidden by Canon D09
    expect(() =>
      buildRequest({
        messages: [
          { role: 'user', content: 'Start' },
          { role: 'assistant', content: '{' },
        ],
        schema: DECISION_JSON_SCHEMA,
      }),
    ).toThrow(/assistant history and prefill are forbidden/);

    // Initial system roles remain forbidden after V3/V10 PASS.
    expect(() =>
      assertWhitelisted({
        model: NEGOTIATION_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: 'bad' },
          { role: 'user', content: 'hi' },
        ],
        output_config: {
          effort: NEGOTIATION_EFFORT,
          format: { type: 'json_schema', schema: DECISION_JSON_SCHEMA },
        },
      }),
    ).toThrow(/exactly one user/);

    // >4 cache breakpoints or 1h after 5m TTL ordering violation
    expect(() =>
      buildRequest({
        system: [
          {
            type: 'text',
            text: 's1',
            cache_control: { type: 'ephemeral', ttl: '5m' },
          },
          {
            type: 'text',
            text: 's2',
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
      }),
    ).toThrow(/1h cache entries must precede all 5m cache entries/);

    expect(() =>
      buildRequest({
        system: [
          { type: 'text', text: 's1', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 's2', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 's3', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 's4', cache_control: { type: 'ephemeral' } },
        ],
        cacheControl: { type: 'ephemeral' },
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
      }),
    ).toThrow(/Too many cache breakpoints/);
  });
});

describe('convex/model/agents/modelGateway — Canon D09 stop_reason branching & pre-parse telemetry', () => {
  it('succeeds on end_turn with valid JSON and caller validate(obj), recording usage and requestId', async () => {
    const sampleDecision: CounterOfferDecision = {
      action: 'counter',
      totalPriceCents: 1_850_000,
      includedItemKeys: ['electrical_panel', 'hvac_duct'],
    };

    const transport = stubTransport<CounterOfferDecision>(() => ({
      kind: 'ok',
      data: sampleDecision,
      requestId: 'req_01H_OK',
      messageId: 'msg_01H_OK',
      usage: {
        input_tokens: 1_000,
        output_tokens: 200,
        cache_creation_input_tokens: 400,
        cache_read_input_tokens: 2_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 400,
        },
      },
    }));

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.kind).toBe('ok');
    expect(result.attemptStatus).toBe('completed');
    expect(result.data).toEqual(sampleDecision);
    expect(result.value).toEqual(sampleDecision);
    expect(result.requestId).toBe('req_01H_OK');
    expect(result.messageId).toBe('msg_01H_OK');
    expect(result.provenance).toBe('stub');
    expect(result.usage.inputTokens).toBe(1_000);
    expect(result.usage.outputTokens).toBe(200);
    expect(result.usage.cacheCreation1hTokens).toBe(400);
    expect(result.usage.cacheReadInputTokens).toBe(2_000);
    expect(result.usage.totalPromptTokens).toBe(3_400);
    // Cost: 1000*5 + 200*25 + 400*10 + 2000*0.5 = 5000 + 5000 + 4000 + 1000 = 15,000 micro-USD
    expect(result.usage.estimatedCostMicroUsd).toBe(15_000);
  });

  it('branches stop_reason === "max_tokens" -> output.truncated and records usage/requestId BEFORE JSON.parse', async () => {
    const telemetry: AttemptTelemetry[] = [];
    const transport = stubTransport(() => ({
      kind: 'stop',
      stopReason: 'max_tokens',
      partialText: '{"action":"counter","totalPriceCents":185',
      requestId: 'req_trunc_01',
      usage: { input_tokens: 500, output_tokens: 16_000 },
    }));

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
      onAttempt: (t) => telemetry.push(t),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('output.truncated');
    expect(result.reasonCode).toBe('output.truncated');
    expect(result.attemptStatus).toBe('invalid_output');
    expect(result.stopReason).toBe('max_tokens');
    expect(result.gatewayRetryable).toBe(false);
    expect(result.requestId).toBe('req_trunc_01');
    expect(result.attempts).toBe(2);
    expect(telemetry).toHaveLength(2);
    expect(telemetry[0]?.requestId).toBe('req_trunc_01');
    expect(result.totalUsage.outputTokens).toBe(32_000);
    expect(result.usage?.outputTokens).toBe(16_000);
    expect(telemetry[0]?.outcomeKind).toBe('output.truncated');
    expect(telemetry[0]?.usage?.outputTokens).toBe(16_000);
  });

  it('branches stop_reason === "refusal" -> refused (reasonCode: output.refusal) with usage recorded', async () => {
    const transport = stubTransport(() => ({
      kind: 'stop',
      stopReason: 'refusal',
      partialText: 'CANARY_REFUSAL_PROSE_NEVER_ECHOED',
      requestId: 'req_refusal_01',
      usage: { input_tokens: 400, output_tokens: 25 },
    }));

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('refused');
    expect(result.reasonCode).toBe('output.refusal');
    expect(result.attemptStatus).toBe('refused');
    expect(result.stopReason).toBe('refusal');
    expect(result.requestId).toBe('req_refusal_01');
    expect(result.usage?.inputTokens).toBe(400);
    expect(JSON.stringify(result)).not.toContain('CANARY_REFUSAL_PROSE');
  });

  it('branches stop_reason === "model_context_window_exceeded" -> error (errorCode: context_overflow)', async () => {
    const transport = stubTransport(() => ({
      kind: 'stop',
      stopReason: 'model_context_window_exceeded',
      requestId: 'req_ctx_01',
      usage: { input_tokens: 199_999, output_tokens: 0 },
    }));

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'error') throw new Error('expected error');
    expect(result.errorCode).toBe('context_overflow');
    expect(result.reasonCode).toBe(null);
    expect(result.stopReason).toBe('model_context_window_exceeded');
    expect(result.gatewayRetryable).toBe(false);
    expect(result.requestId).toBe('req_ctx_01');
    expect(result.usage?.inputTokens).toBe(199_999);
  });

  it('maps unexpected stop_reason (tool_use, pause_turn, stop_sequence, null) to errorCode: unexpected_stop', async () => {
    for (const stopReason of [
      'tool_use',
      'pause_turn',
      'stop_sequence',
      null,
    ] as const) {
      const transport = stubTransport(() => ({
        kind: 'stop',
        stopReason,
        requestId: 'req_unexp',
      }));
      const result = await callModel({
        transport,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
      });
      expect(result.ok).toBe(false);
      if (result.ok || result.kind !== 'error')
        throw new Error('expected error');
      expect(result.errorCode).toBe('unexpected_stop');
      expect(result.reasonCode).toBe(null);
      expect(result.gatewayRetryable).toBe(false);
    }
  });

  it('maps malformed JSON or missing text block on end_turn to output.not_json without echoing model text', async () => {
    const transportBadJson = stubTransport(() => ({
      kind: 'raw_text',
      text: '{not valid json CANARY_RAW_MODEL_TEXT_8812',
      requestId: 'req_badjson',
    }));

    const res1 = await callModel({
      transport: transportBadJson,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });
    expect(res1.ok).toBe(false);
    if (res1.ok || res1.kind !== 'output.not_json') {
      throw new Error('expected output.not_json');
    }
    expect(res1.reasonCode).toBe('output.not_json');
    expect(res1.issues).toEqual([{ path: '<root>', code: 'invalid_json' }]);
    expect(JSON.stringify(res1)).not.toContain('CANARY_RAW_MODEL_TEXT_8812');

    const transportNoBlock = stubTransport(() => ({
      kind: 'no_text_block',
      requestId: 'req_noblock',
    }));
    const res2 = await callModel({
      transport: transportNoBlock,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });
    expect(res2.ok).toBe(false);
    if (res2.ok || res2.kind !== 'output.not_json') {
      throw new Error('expected output.not_json');
    }
    expect(res2.issues).toEqual([
      { path: '<root>', code: 'missing_text_block' },
    ]);
  });

  it('maps caller validate(obj) failures to output.schema_violation and masks unknown property names as "*"', async () => {
    const transport = stubTransport(() => ({
      kind: 'raw_text',
      text: JSON.stringify({
        action: 'counter',
        totalPriceCents: -50,
        includedItemKeys: ['ok'],
        CANARY_SECRET_UNRECOGNIZED_KEY: 'CANARY_VALUE_999',
      }),
    }));

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: () => ({
        ok: false,
        issues: [
          { path: ['totalPriceCents'], code: 'too_small' },
          {
            path: ['CANARY_SECRET_UNRECOGNIZED_KEY', 0, 'leakedSubKey'],
            code: 'unrecognized_key',
          },
        ],
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'output.schema_violation') {
      throw new Error('expected output.schema_violation');
    }
    expect(result.reasonCode).toBe('output.schema_violation');
    expect(result.issues).toEqual([
      { path: 'totalPriceCents', code: 'too_small' },
      { path: '*[0].*', code: 'unrecognized_key' },
    ]);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });
});

describe('convex/model/agents/modelGateway — REVIEW item regressions (r01..r08)', () => {
  it('r01 & D16: classifyError and CallError.detail NEVER embed err.message or server error message prose', async () => {
    const sensitiveLeakMessage =
      'Invalid request: prompt contained CANARY_OWNER_RESERVATION_PRICE_390K and model said CANARY_MODEL_DRAFT';

    for (const status of [400, 401, 403, 404, 408, 413, 422, 429, 500, 529]) {
      const apiErr = new GatewayAPIError(
        status,
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: sensitiveLeakMessage,
          },
        },
        sensitiveLeakMessage,
        { 'request-id': `req_err_${status}` },
      );

      const classified = classifyError(apiErr);
      expect(classified.detail).not.toContain('CANARY');
      expect(classified.detail).not.toContain('Invalid request:');
      expect(classified.requestId).toBe(
        [401, 403, 404, 408].includes(status) ? null : `req_err_${status}`,
      );
    }

    // A 400 remains bad_request even when the echoed message mentions context overflow.
    // Classification retains only safe HTTP metadata, never that message.
    const overflowErr = new GatewayAPIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'prompt is too long: 205000 tokens > 200000 maximum (CANARY_PROMPT_BODY)',
        },
      },
      'prompt is too long: CANARY_PROMPT_BODY',
      { 'request-id': 'req_overflow_400' },
    );

    const overflowClassified = classifyError(overflowErr);
    expect(overflowClassified.errorCode).toBe('bad_request');
    expect(overflowClassified.detail).toBe('http_status=400');
    expect(overflowClassified.detail).not.toContain('CANARY');
  });

  it('r02: totalBudgetMs bounds the first attempt timeout (Math.min(timeoutMs, remainingBudgetMs))', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    try {
      let observedTimeoutMs = 0;
      const customTransport: ReturnType<typeof stubTransport> = {
        provenance: 'stub',
        async send(body, options) {
          observedTimeoutMs = options.timeoutMs;
          return stubTransport(() => ({
            kind: 'ok',
            data: {
              action: 'accept' as const,
              totalPriceCents: 100,
              includedItemKeys: ['a'],
            },
          })).send(body, options);
        },
      };

      const res = await callModel({
        transport: customTransport,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
        timeoutMs: 220_000,
        totalBudgetMs: 15_000,
      });

      expect(res.ok).toBe(true);
      expect(observedTimeoutMs).toBe(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('r04 & r05: estimateCostMicroUsd uses integer micro-USD math and data-driven longContextThresholdTokens', () => {
    const customPrices: Record<'claude-opus-5-5', ModelPrice> = {
      'claude-opus-5-5': {
        ...LIST_PRICES['claude-opus-5-5'],
        longContextThresholdTokens: 200_000,
        longContextMultiplierNum: 2,
        longContextMultiplierDen: 1,
      },
    };

    const baseCost = estimateCostMicroUsd(
      'claude-opus-5-5',
      {
        input_tokens: 150_000,
        output_tokens: 1_000,
      },
      customPrices,
    );
    // 150,000 * $5/MTok = 750,000 micro-USD; 1,000 * $25/MTok = 25,000 micro-USD => 775,000
    expect(baseCost).toBe(775_000);
    expect(Number.isInteger(baseCost)).toBe(true);

    const longContextCost = estimateCostMicroUsd(
      'claude-opus-5-5',
      {
        input_tokens: 250_000,
        output_tokens: 1_000,
      },
      customPrices,
    );
    // (250,000 * 5 + 1,000 * 25) * 2 = 1,275,000 * 2 = 2,550,000 micro-USD
    expect(longContextCost).toBe(2_550_000);

    const usageRec = toUsageRecord('claude-opus-5-5', {
      input_tokens: 333,
      output_tokens: 77,
      cache_creation_input_tokens: 111,
      cache_read_input_tokens: 222,
    });
    expect(Number.isInteger(usageRec.estimatedCostMicroUsd)).toBe(true);
  });

  it('r06: validates timing & retry config up front with GatewayConfigError', async () => {
    const transport = stubTransport(() => ({
      kind: 'ok',
      data: { action: 'accept', totalPriceCents: 0, includedItemKeys: [] },
    }));

    await expect(
      callModel({
        transport,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
        timeoutMs: 0,
      }),
    ).rejects.toThrow(GatewayConfigError);

    await expect(
      callModel({
        transport,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
        totalBudgetMs: -10,
      }),
    ).rejects.toThrow(GatewayConfigError);

    await expect(
      callModel({
        transport,
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
        retryBaseDelayMs: 5_000,
        maxRetryDelayMs: 1_000,
      }),
    ).rejects.toThrow(GatewayConfigError);
  });

  it('r07: checks signal.aborted in catch block so external abort during stream returns kind: "aborted"', async () => {
    const controller = new AbortController();
    const transport: ReturnType<typeof stubTransport> = {
      provenance: 'stub',
      async send() {
        controller.abort();
        // Throw a generic Error (not named AbortError) after signal is aborted
        throw new Error('socket closed mid-stream');
      },
    };

    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected aborted');
    expect(result.kind).toBe('aborted');
    expect(result.attemptStatus).toBe('timeout');
    expect(result.reasonCode).toBe(null);
  });

  it('r08: preserves requestId on transport errors into attemptLogs and CallFailure.requestId', async () => {
    const transport = stubTransport(
      sequenceResponder([
        {
          kind: 'throw',
          error: new GatewayAPIError(
            429,
            { type: 'error', error: { type: 'rate_limit_error' } },
            'Rate limited',
            { 'request-id': 'req_429_first', 'retry-after-ms': '10' },
          ),
        },
        {
          kind: 'throw',
          error: new GatewayAPIError(
            529,
            { type: 'error', error: { type: 'overloaded_error' } },
            'Overloaded',
            { 'request-id': 'req_529_second' },
          ),
        },
      ]),
    );

    let fakeNow = 1_000;
    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
      maxRetries: 1,
      now: () => {
        fakeNow += 5;
        return fakeNow;
      },
      sleep: async () => {},
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'error') throw new Error('expected error');
    expect(result.errorCode).toBe('transport');
    expect(result.requestId).toBe('req_529_second');
    expect(result.attemptLogs).toHaveLength(2);
    expect(result.attemptLogs[0]?.requestId).toBe('req_429_first');
    expect(result.attemptLogs[1]?.requestId).toBe('req_529_second');
  });
});

describe('convex/model/agents/modelGateway — anthropicTransport & in-process SSE stream fetch client', () => {
  it('calls client.messages.stream(body, { timeout, maxRetries: 0, signal }).finalMessage() over fake SSE fetch', async () => {
    const recordedRequests: Array<{
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }> = [];

    const sseBody = [
      'event: message_start',
      `data: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_sse_01',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 640,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 120,
          },
        },
      })}`,
      '',
      'event: content_block_start',
      `data: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: '{"action":"accept","totalPriceCents":1800000,',
        },
      })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: '"includedItemKeys":["electrical_panel"]}',
        },
      })}`,
      '',
      'event: message_delta',
      `data: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 42 },
      })}`,
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      recordedRequests.push({ url, headers, body });

      return new Response(sseBody, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'request-id': 'req_sse_live_01',
        },
      });
    };

    const client = createFetchStreamClient({
      fetch: fakeFetch,
      baseURL: 'http://stub.invalid',
      apiKey: 'sk-ant-stub',
    });

    const result = await callModel({
      client,
      system: 'Negotiation rules',
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.provenance).toBe('live');
    expect(result.requestId).toBe('req_sse_live_01');
    expect(result.messageId).toBe('msg_sse_01');
    expect(result.data).toEqual({
      action: 'accept',
      totalPriceCents: 1_800_000,
      includedItemKeys: ['electrical_panel'],
    });
    expect(result.usage.inputTokens).toBe(640);
    expect(result.usage.outputTokens).toBe(42);
    expect(result.usage.cacheReadInputTokens).toBe(120);

    expect(recordedRequests).toHaveLength(1);
    const wire = recordedRequests[0]!;
    expect(wire.url).toBe('http://stub.invalid/v1/messages');
    expect(wire.headers).not.toHaveProperty('anthropic-beta');
    expect(wire.body).not.toHaveProperty('betas');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.model).toBe('claude-opus-5-5');
    expect(wire.body.max_tokens).toBe(16_000);
    expect(wire.body).not.toHaveProperty('fallbacks');
    expect(wire.body.output_config).toEqual({
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: DECISION_JSON_SCHEMA,
      },
    });
  });

  it('retries once on APIConnectionError and succeeds on second send', async () => {
    const transport = stubTransport<CounterOfferDecision>(
      sequenceResponder([
        {
          kind: 'throw',
          error: Object.assign(new Error('connection failed'), {
            name: 'APIConnectionError',
          }),
        },
        {
          kind: 'ok',
          data: {
            action: 'escalate',
            totalPriceCents: 2_000_000,
            includedItemKeys: ['structural_beam'],
          },
          requestId: 'req_retry_ok',
        },
      ]),
    );

    let clock = 0;
    const result = await callModel({
      transport,
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
      validate: validateDecision,
      maxRetries: 1,
      now: () => {
        clock += 10;
        return clock;
      },
      sleep: async () => {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.attempts).toBe(2);
    expect(result.attemptLogs[0]?.errorCode).toBe('transport');
    expect(result.attemptLogs[1]?.outcomeKind).toBe('ok');
    expect(result.requestId).toBe('req_retry_ok');
  });

  it('rejects anthropicTransport when client lacks messages.stream', () => {
    expect(() => anthropicTransport({} as never)).toThrow(GatewayConfigError);
  });
});

describe('wave-0 gateway regressions', () => {
  it('pins negotiation parameters and rejects nested wire extensions', () => {
    const body = buildRequest({
      messages: SAMPLE_MESSAGES,
      schema: DECISION_JSON_SCHEMA,
    });
    for (const patch of [
      { max_tokens: 100 },
      { output_config: { ...body.output_config, effort: 'high' } },
      { system: [{ type: 'image', text: 'private' }] },
      { messages: [{ role: 'user', content: 'hello', secret: 'private' }] },
    ])
      expect(() => assertWhitelisted({ ...body, ...patch })).toThrow(
        GatewayConfigError,
      );
    expect(() =>
      anthropicTransport(createFetchStreamClient({ fetch }), {
        sdkMaxRetries: 1,
      }),
    ).toThrow();
    expect(CALL_DEADLINE_MS).toBeLessThan(WATCHDOG_FIRST_MS);
  });
  it('retries only 429 and connection failures', () => {
    for (const status of [408, 409, 500, 529])
      expect(classifyError({ status }).gatewayRetryable).toBe(false);
    expect(
      classifyError(new GatewayAPIError(429, {}, 'rate limited'))
        .gatewayRetryable,
    ).toBe(true);
    expect(classifyError(new GatewayTimeoutError())).toMatchObject({
      gatewayRetryable: false,
      reasonCode: null,
    });
  });
  it('enforces the deadline even when a transport ignores timeout options', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    // Native AbortSignal.timeout uses real timers, so bind its signals to the
    // same fake clock as the gateway's deadline race.
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(
          () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
          ms,
        );
        return controller.signal;
      });
    try {
      let signal: AbortSignal | undefined;
      const pending = callModel({
        transport: {
          provenance: 'stub',
          send: async (_body, options) => {
            signal = options.signal;
            return new Promise(() => {});
          },
        },
        messages: SAMPLE_MESSAGES,
        schema: DECISION_JSON_SCHEMA,
        validate: validateDecision,
        timeoutMs: 10,
        totalBudgetMs: 10,
      });
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(9);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        errorCode: 'model_timeout',
        attempts: 1,
      });
      expect(signal?.aborted).toBe(true);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
});

it('counts transport and truncation retries independently and preserves all response usage', async () => {
  let sends = 0;
  const transport = stubTransport((_body, index) => {
    sends++;
    if (index === 0)
      return {
        kind: 'throw',
        error: new GatewayAPIError(
          429,
          { type: 'rate_limit_error' },
          'PRIVATE_CANARY',
        ),
      };
    if (index === 1)
      return {
        kind: 'stop',
        stopReason: 'max_tokens',
        requestId: 'first-response',
        usage: { input_tokens: 10, output_tokens: 16000 },
      };
    return {
      kind: 'ok',
      data: {
        action: 'accept',
        totalPriceCents: 100,
        includedItemKeys: ['sso_login'],
      },
      requestId: 'second-response',
    };
  });
  const result = await callModel({
    transport,
    messages: SAMPLE_MESSAGES,
    schema: DECISION_JSON_SCHEMA,
    validate: validateDecision,
    sleep: async () => {},
  });
  expect(result.ok).toBe(true);
  expect(sends).toBe(3);
  expect(result.attemptLogs[1]).toMatchObject({
    requestId: 'first-response',
    outcomeKind: 'output.truncated',
    usage: { outputTokens: 16000 },
  });
  expect(result.attemptLogs[2]?.attemptStatus).toBe('completed');
  expect(result.totalUsage.outputTokens).toBeGreaterThanOrEqual(16000);
});

describe('total-deadline timeout phases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
        ms,
      );
      return controller.signal;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const request = () => ({
    messages: SAMPLE_MESSAGES,
    schema: DECISION_JSON_SCHEMA,
    validate: validateDecision,
    totalBudgetMs: 10,
    now: () => Date.now(),
  });

  it('returns a non-gatewayRetryable timeout when the budget expires before send', async () => {
    const send = vi.fn();
    let reads = 0;
    const result = await callModel({
      ...request(),
      now: () => (reads++ === 0 ? 0 : 10),
      transport: { provenance: 'stub', send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'error',
      errorCode: 'model_timeout',
      gatewayRetryable: false,
    });
    expect(result.attemptLogs[0]).toMatchObject({
      outcomeKind: 'error',
      errorCode: 'model_timeout',
    });
  });

  it('returns a non-gatewayRetryable timeout when the total deadline fires during backoff', async () => {
    const caller = new AbortController();
    const sleep = vi.fn(async () => new Promise<void>(() => {}));
    const send = vi.fn(async () => {
      throw new GatewayAPIError(429, {}, 'rate limited');
    });
    const pending = callModel({
      ...request(),
      signal: caller.signal,
      sleep,
      retryBaseDelayMs: 1,
      maxRetryDelayMs: 1,
      transport: { provenance: 'stub', send },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sleep).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(caller.signal.aborted).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: 'error',
      errorCode: 'model_timeout',
      gatewayRetryable: false,
    });
    if (result.ok || result.kind !== 'error')
      throw new Error('expected timeout');
    expect(result.detail).not.toContain('request aborted');
  });

  it('returns a non-gatewayRetryable timeout when the total deadline fires during send', async () => {
    const caller = new AbortController();
    const send = vi.fn(async () => new Promise<never>(() => {}));
    const pending = callModel({
      ...request(),
      signal: caller.signal,
      transport: { provenance: 'stub', send },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(caller.signal.aborted).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(await pending).toMatchObject({
      kind: 'error',
      errorCode: 'model_timeout',
      gatewayRetryable: false,
    });
  });

  it('preserves caller cancellation during backoff as aborted', async () => {
    const caller = new AbortController();
    const pending = callModel({
      ...request(),
      signal: caller.signal,
      sleep: async () => new Promise<void>(() => {}),
      retryBaseDelayMs: 1,
      maxRetryDelayMs: 1,
      transport: {
        provenance: 'stub',
        send: async () => {
          throw new GatewayAPIError(429, {}, 'rate limited');
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    expect(await pending).toMatchObject({
      kind: 'aborted',
      errorCode: 'model_timeout',
      gatewayRetryable: false,
    });
  });
});
