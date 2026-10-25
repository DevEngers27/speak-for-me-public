import { buildRequestForTest } from '../helpers/modelGateway';
import { expect, vi } from 'vitest';
import {
  anthropicTransport,
  assertBudgetInequalities,
  buildRequest,
  callModel,
  GatewayConfigError,
  classifyError,
  MODEL_BUDGET,
  SDK_MAX_RETRIES,
  stubTransport,
} from '../../convex/model/agents/modelGateway';

const params = {
  messages: [{ role: 'user' as const, content: 'context' }, { role: 'system' as const, content: 'This turn: kind propose. Allowed actions: propose, clarify, escalate.' }],
  schema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  },
  validate: (value: unknown) => ({ success: true as const, data: value }),
};
export async function gatewayWhitelistChecks() {
  const body = buildRequest(params);
  expect(body).toMatchObject({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema' } },
  });
  expect(SDK_MAX_RETRIES).toBe(0); // CN-001 overrides the frozen registry title.
  expect(MODEL_BUDGET.CALL_DEADLINE_MS).toBeLessThan(
    MODEL_BUDGET.WATCHDOG_FIRST_MS,
  );
  assertBudgetInequalities();
  for (const key of [
    'thinking',
    'temperature',
    'top_p',
    'top_k',
    'tools',
    'tool_choice',
    'stop_sequences',
    'fallbacks',
    'betas',
  ]) {
    expect(() =>
      buildRequestForTest({ ...params, extraBody: { [key]: null } }),
    ).toThrow();
  }
  let finalized = false;
  const response = await stubTransport(() => ({ kind: 'ok', data: {} })).send(
    body,
    { timeoutMs: 100 },
  );
  const transport = anthropicTransport({
    messages: {
      stream(_body, options) {
        expect(options?.maxRetries).toBe(0);
        expect(options?.signal).toBeDefined();
        return {
          async finalMessage() {
            finalized = true;
            return response.message;
          },
        };
      },
    },
  });
  expect((await callModel({ ...params, transport })).ok).toBe(true);
  expect(finalized).toBe(true);
}
export async function thinkingTruncationChecks() {
  let sends = 0;
  const base = stubTransport(() => ({
    kind: 'stop',
    stopReason: 'max_tokens',
    usage: {
      input_tokens: 7,
      output_tokens: 11,
      output_tokens_details: { thinking_tokens: 3 },
    },
  }));
  const result = await callModel({
    ...params,
    transport: {
      provenance: 'stub',
      async send(body, options) {
        sends++;
        const response = await base.send(body, options);
        return {
          ...response,
          message: {
            ...response.message,
            content: [{ type: 'thinking', thinking: 'PRIVATE' }],
          },
        };
      },
    },
  });
  expect(sends).toBe(2);
  expect(result).toMatchObject({
    kind: 'output.truncated',
    attemptStatus: 'invalid_output',
    gatewayRetryable: false,
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  const perAttempt = {
    inputTokens: 7,
    outputTokens: 11,
    thinkingTokens: 3,
    estimatedCostMicroUsd: 310,
  };
  expect(result).toMatchObject({
    usage: perAttempt,
    totalUsage: {
      inputTokens: 14,
      outputTokens: 22,
      thinkingTokens: 6,
      estimatedCostMicroUsd: 620,
    },
  });
  expect(result.attemptLogs).toHaveLength(2);
  for (const attempt of result.attemptLogs)
    expect(attempt).toMatchObject({
      usage: perAttempt,
      stopReason: 'max_tokens',
    });
}
export async function budgetMutationChecks() {
  const send = vi.fn(stubTransport(() => ({ kind: 'ok', data: {} })).send);
  for (const budget of [
    { ...MODEL_BUDGET, CALL_DEADLINE_MS: 480000 },
    { ...MODEL_BUDGET, SDK_MAX_RETRIES: 1 },
  ]) {
    let caught: unknown;
    try {
      // Model startup preflight: invalid budget must fail before entering the transport.
      assertBudgetInequalities(budget);
      await callModel({ ...params, transport: { provenance: 'stub', send } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayConfigError);
    expect(caught).toMatchObject({ code: 'config_invalid' });
    expect(classifyError(caught)).toMatchObject({
      errorCode: 'config_invalid',
      gatewayRetryable: false,
    });
  }
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
}
