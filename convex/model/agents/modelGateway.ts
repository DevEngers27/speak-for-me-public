import type { AttemptStatus } from '../../../core/engine';
import type { AttemptErrorCode } from '../../../core/engine';
/**
 * Anthropic Opus 5.5 Model Gateway (`convex/model/agents/modelGateway.ts`).
 *
 * Implements Canon D09, D16, and §10.11 / §10.14–10.16:
 * - Streaming transport via `client.messages.stream({...}).finalMessage()`
 *   (never `messages.parse`).
 * - Plain JSON-schema object passed in `output_config.format = { type: 'json_schema', schema }`.
 * - Runtime parameter whitelist:
 *   - `model: 'claude-opus-5-5'`
 *   - `output_config.effort`: explicitly 'medium' for every negotiation turn.
 *   - `max_tokens: 16000`
 *   - Derived timeout & budget inequalities (`REQUEST_TIMEOUT_MS = 220_000`, `CALL_DEADLINE_MS = 230_000`, `SDK maxRetries: 0; gateway retries: 1`)
 *   - Never `thinking`, `temperature`, `top_p`, `top_k`, `tools`, `tool_choice`, `stop_sequences`, or assistant prefill
 *   - Fallback activation is rejected (D09).
 * - Records `usage`, `stop_reason`, and `requestId` BEFORE any branching or parsing.
 * - Branches on `stop_reason`:
 *   - `'max_tokens'` -> `'output.truncated'`
 *   - `'refusal'` -> `'refused'` (`reasonCode: 'output.refusal'`)
 *   - `'model_context_window_exceeded'` -> `'error'` (`errorCode: 'context_overflow'`)
 *   - `'end_turn'` -> `JSON.parse` + caller-supplied `validate(obj)`
 * - Log & error hygiene (Canon D16 + `model-call-r01`): errors never echo model
 *   output, prompt text, or `err.message`.
 */

// ---------------------------------------------------------------------------
// 1. Pinned Model Constants & Derived Timeout / Watchdog Budget (Canon D09)
// ---------------------------------------------------------------------------

export const ALLOWED_MODELS = ['claude-opus-5-5'] as const;
export type ModelId = (typeof ALLOWED_MODELS)[number];

export const NEGOTIATION_MODEL: ModelId = 'claude-opus-5-5';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const NEGOTIATION_EFFORT: EffortLevel = 'medium';

export const MAX_TOKENS = 16_000 as const;
export const SDK_MAX_RETRIES = 0 as const;
export const MAX_CACHE_BREAKPOINTS = 4 as const;

/**
 * Derived timeout & watchdog budget constants (Canon §10.14.1 & D09):
 *
 *   max_tokens = 16,000
 *   ceil(16,000 / 80 tok/s) = 200s + 20s TTFT/reasoning slack = 220,000 ms
 *   SDK retries are disabled; the gateway owns one transport retry (429/connection)
 *   and one independent truncation retry: at most three sends, sharing 230s total.
 *   Each send gets min(220s, remaining budget), including an AbortSignal.
 *   230s call + 40s I/O = 270s, before the 275s first watchdog and 600s action limit.
 */
export const MODEL_BUDGET = Object.freeze({
  MAX_TOKENS: 16_000,
  STREAM_FLOOR_TOKENS_PER_SEC: 80,
  TTFT_AND_REASONING_SLACK_MS: 20_000,
  REQUEST_TIMEOUT_MS: 220_000,
  SDK_MAX_RETRIES: 0,
  RETRY_BACKOFF_CAP_MS: 8_000,
  CALL_DEADLINE_MS: 230_000,
  CONVEX_IO_MARGIN_MS: 40_000,
  ACTION_WALL_MAX_MS: 270_000,
  CONVEX_ACTION_LIMIT_MS: 600_000,
  WATCHDOG_FIRST_MS: 275_000,
  WATCHDOG_REARM_MS: 220_000,
  WATCHDOG_FINAL_MS: 935_000,
} as const);

export const REQUEST_TIMEOUT_MS = MODEL_BUDGET.REQUEST_TIMEOUT_MS;
export const CALL_DEADLINE_MS = MODEL_BUDGET.CALL_DEADLINE_MS;
export const ACTION_WALL_MAX_MS = MODEL_BUDGET.ACTION_WALL_MAX_MS;
export const WATCHDOG_FIRST_MS = MODEL_BUDGET.WATCHDOG_FIRST_MS;
export const WATCHDOG_REARM_MS = MODEL_BUDGET.WATCHDOG_REARM_MS;
export const WATCHDOG_FINAL_MS = MODEL_BUDGET.WATCHDOG_FINAL_MS;

export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const DEFAULT_TOTAL_BUDGET_MS = CALL_DEADLINE_MS;
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_RETRY_DELAY_MS = 8_000;

// ---------------------------------------------------------------------------
// 2. Configuration & Whitelist Error
// ---------------------------------------------------------------------------

export class GatewayConfigError extends Error {
  readonly code = 'config_invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

export type ModelBudgetConfig = {
  readonly [K in keyof typeof MODEL_BUDGET]: number;
};

/**
 * Verify all derived timeout / deadline / watchdog budget inequalities (Canon D09).
 * Throws `GatewayConfigError` on any violation (resolves `model-call-r03`).
 */
export function assertBudgetInequalities(
  b: ModelBudgetConfig = MODEL_BUDGET,
): void {
  const minStreamMs =
    Math.ceil(b.MAX_TOKENS / b.STREAM_FLOOR_TOKENS_PER_SEC) * 1000 +
    b.TTFT_AND_REASONING_SLACK_MS;
  if (b.REQUEST_TIMEOUT_MS < minStreamMs) {
    throw new GatewayConfigError(
      `REQUEST_TIMEOUT_MS (${b.REQUEST_TIMEOUT_MS}) < stream time for ${b.MAX_TOKENS} tokens (${minStreamMs})`,
    );
  }
  const minDeadline =
    (1 + b.SDK_MAX_RETRIES) * b.REQUEST_TIMEOUT_MS + b.RETRY_BACKOFF_CAP_MS;
  if (b.CALL_DEADLINE_MS < minDeadline) {
    throw new GatewayConfigError(
      `CALL_DEADLINE_MS (${b.CALL_DEADLINE_MS}) < ${1 + b.SDK_MAX_RETRIES} * REQUEST_TIMEOUT_MS + backoff (${minDeadline})`,
    );
  }
  if (
    b.ACTION_WALL_MAX_MS < b.CALL_DEADLINE_MS + b.CONVEX_IO_MARGIN_MS ||
    b.ACTION_WALL_MAX_MS >= b.CONVEX_ACTION_LIMIT_MS
  ) {
    throw new GatewayConfigError(
      `ACTION_WALL_MAX_MS (${b.ACTION_WALL_MAX_MS}) must lie in [${b.CALL_DEADLINE_MS + b.CONVEX_IO_MARGIN_MS}, ${b.CONVEX_ACTION_LIMIT_MS})`,
    );
  }
  if (b.WATCHDOG_FIRST_MS <= b.CALL_DEADLINE_MS) {
    throw new GatewayConfigError(
      `WATCHDOG_FIRST_MS (${b.WATCHDOG_FIRST_MS}) must exceed single-attempt timeout (${b.REQUEST_TIMEOUT_MS})`,
    );
  }
  if (b.WATCHDOG_FIRST_MS + b.WATCHDOG_REARM_MS <= b.ACTION_WALL_MAX_MS) {
    throw new GatewayConfigError(
      `WATCHDOG_FIRST_MS + WATCHDOG_REARM_MS (${b.WATCHDOG_FIRST_MS + b.WATCHDOG_REARM_MS}) must exceed ACTION_WALL_MAX_MS (${b.ACTION_WALL_MAX_MS})`,
    );
  }
  if (b.WATCHDOG_FINAL_MS <= 2 * b.CALL_DEADLINE_MS) {
    throw new GatewayConfigError(
      `WATCHDOG_FINAL_MS (${b.WATCHDOG_FINAL_MS}) must exceed 2 * CALL_DEADLINE_MS (${2 * b.CALL_DEADLINE_MS})`,
    );
  }
}

assertBudgetInequalities();

// ---------------------------------------------------------------------------
// 3. Wire Types, JSON Schema, Cache Control, Usage & Pricing
// ---------------------------------------------------------------------------

export type CacheTtl = '5m' | '1h';

export interface EphemeralCacheControl {
  readonly type: 'ephemeral';
  readonly ttl?: CacheTtl;
}

export interface TextBlockParam {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: EphemeralCacheControl;
}

export interface MessageParam {
  readonly role: 'user' | 'system' | 'assistant';
  readonly content: string | readonly TextBlockParam[];
}

/**
 * Plain JSON-schema object passed by the caller into `output_config.format`
 * (Canon D09). Top-level `type` must be `'object'`.
 */
export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

export interface JsonSchemaOutputFormat {
  readonly type: 'json_schema';
  readonly schema: JsonSchemaObject;
}

export interface OutputConfig {
  readonly effort: EffortLevel;
  readonly format: JsonSchemaOutputFormat;
}

export interface WhitelistedRequestBody {
  readonly model: ModelId;
  readonly max_tokens: number;
  readonly system?: string | readonly TextBlockParam[];
  readonly messages: readonly MessageParam[];
  readonly output_config: OutputConfig;
  readonly cache_control?: EphemeralCacheControl;
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded';

export interface RawAnthropicUsage {
  readonly output_tokens_details?: {
    readonly thinking_tokens?: number | null;
  } | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens?: number | null;
    readonly ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export type RawContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'thinking';
      readonly thinking: string;
      readonly signature?: string;
    }
  | { readonly type: 'redacted_thinking'; readonly data: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    };

export interface RawAnthropicMessage {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly model?: string | null;
  readonly content: readonly RawContentBlock[];
  readonly stop_reason: StopReason | string | null;
  readonly stop_details?: { readonly category?: string | null } | null;
  readonly stop_sequence?: string | null;
  readonly usage: RawAnthropicUsage;
  readonly _request_id?: string | null;
}

export type PricingBasis = 'response_model' | 'model_family' | 'request_model';

export interface UsageRecord {
  readonly pricingBasis: PricingBasis;
  readonly thinkingTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreation5mTokens: number;
  readonly cacheCreation1hTokens: number;
  /** Total prompt tokens (`input + cacheCreation + cacheRead`). */
  readonly totalPromptTokens: number;
  /** Estimated cost in integer micro-USD ($1 = 1,000,000 micro-USD). */
  readonly estimatedCostMicroUsd: number;
}

export interface ModelPrice {
  readonly inputPerMTokUsd: number;
  readonly outputPerMTokUsd: number;
  readonly cacheWrite5mPerMTokUsd: number;
  readonly cacheWrite1hPerMTokUsd: number;
  readonly cacheReadPerMTokUsd: number;
  /**
   * Optional long-context pricing tier threshold in total prompt tokens
   * (resolves `model-call-r04` — data-driven instead of reference identity).
   */
  readonly longContextThresholdTokens?: number;
  /** Multiplier numerator when `totalPromptTokens > longContextThresholdTokens`. */
  readonly longContextMultiplierNum?: number;
  /** Multiplier denominator when `totalPromptTokens > longContextThresholdTokens`. */
  readonly longContextMultiplierDen?: number;
}

export const LIST_PRICES: Readonly<Record<ModelId, ModelPrice>> = Object.freeze(
  {
    'claude-opus-5-5': Object.freeze({
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
      cacheWrite5mPerMTokUsd: 6.25,
      cacheWrite1hPerMTokUsd: 10,
      cacheReadPerMTokUsd: 0.5,
    }),
  },
);

/** Resolve dated snapshots without mistaking a different family for the request alias. */
function resolvePrice(
  model: string,
  prices: Readonly<Record<string, ModelPrice>>,
  requestModel: ModelId,
): { price: ModelPrice; basis: PricingBasis } {
  if (prices[model]) return { price: prices[model], basis: 'response_model' };
  const alias = Object.keys(prices)
    .sort((a, b) => b.length - a.length)
    .find(
      (key) =>
        model.startsWith(key + '-') &&
        /^\d{8}$/.test(model.slice(key.length + 1)),
    );
  if (alias) return { price: prices[alias]!, basis: 'model_family' };
  // The pinned request price is always available, even when a supplied table is incomplete.
  return {
    price: prices[requestModel] ?? LIST_PRICES[requestModel],
    basis: 'request_model',
  };
}

/**
 * Compute integer micro-USD cost without floating-point accumulation drift
 * (resolves `model-call-r04` and `model-call-r05`).
 *
 * Since $1 / MTok = 1 micro-USD per token, converting rates to integer
 * nano-USD per token (`Math.round(ratePerMTokUsd * 1000)`) keeps intermediate
 * products in exact safe integers before a single final `Math.round(nano / 1000)`.
 */
export function estimateCostMicroUsd(
  model: string,
  raw: RawAnthropicUsage,
  prices: Readonly<Record<string, ModelPrice>> = LIST_PRICES,
  requestModel: ModelId = NEGOTIATION_MODEL,
): number {
  const p = resolvePrice(model, prices, requestModel).price;
  const input = raw.input_tokens ?? 0;
  const output = raw.output_tokens ?? 0;
  const cacheRead = raw.cache_read_input_tokens ?? 0;
  const totalCacheCreate = raw.cache_creation_input_tokens ?? 0;
  const create1h = raw.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const create5m =
    raw.cache_creation?.ephemeral_5m_input_tokens ??
    Math.max(0, totalCacheCreate - create1h);

  const totalPrompt = input + totalCacheCreate + cacheRead;

  const inputNanoPerTok = Math.round(p.inputPerMTokUsd * 1000);
  const outputNanoPerTok = Math.round(p.outputPerMTokUsd * 1000);
  const write5mNanoPerTok = Math.round(p.cacheWrite5mPerMTokUsd * 1000);
  const write1hNanoPerTok = Math.round(p.cacheWrite1hPerMTokUsd * 1000);
  const readNanoPerTok = Math.round(p.cacheReadPerMTokUsd * 1000);

  const baseNanoUsd =
    input * inputNanoPerTok +
    output * outputNanoPerTok +
    create5m * write5mNanoPerTok +
    create1h * write1hNanoPerTok +
    cacheRead * readNanoPerTok;

  const threshold = p.longContextThresholdTokens;
  if (
    threshold !== undefined &&
    totalPrompt > threshold &&
    p.longContextMultiplierNum !== undefined &&
    p.longContextMultiplierDen !== undefined &&
    p.longContextMultiplierDen > 0
  ) {
    return Math.round(
      (baseNanoUsd * p.longContextMultiplierNum) /
        (p.longContextMultiplierDen * 1000),
    );
  }

  return Math.round(baseNanoUsd / 1000);
}

export function toUsageRecord(
  model: string,
  raw: RawAnthropicUsage,
  prices: Readonly<Record<string, ModelPrice>> = LIST_PRICES,
  requestModel: ModelId = NEGOTIATION_MODEL,
): UsageRecord {
  const inputTokens = raw.input_tokens ?? 0;
  const outputTokens = raw.output_tokens ?? 0;
  const cacheCreationInputTokens = raw.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = raw.cache_read_input_tokens ?? 0;
  const cacheCreation1hTokens =
    raw.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheCreation5mTokens =
    raw.cache_creation?.ephemeral_5m_input_tokens ??
    Math.max(0, cacheCreationInputTokens - cacheCreation1hTokens);

  return Object.freeze({
    thinkingTokens: raw.output_tokens_details?.thinking_tokens ?? 0,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    totalPromptTokens:
      inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    estimatedCostMicroUsd: estimateCostMicroUsd(
      model,
      raw,
      prices,
      requestModel,
    ),
    pricingBasis: resolvePrice(model, prices, requestModel).basis,
  });
}

export function emptyUsageRecord(): UsageRecord {
  return Object.freeze({
    pricingBasis: 'response_model',
    thinkingTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    totalPromptTokens: 0,
    estimatedCostMicroUsd: 0,
  });
}

export function addUsageRecords(a: UsageRecord, b: UsageRecord): UsageRecord {
  return Object.freeze({
    pricingBasis:
      a.pricingBasis === 'request_model' || b.pricingBasis === 'request_model'
        ? 'request_model'
        : a.pricingBasis === 'model_family' || b.pricingBasis === 'model_family'
          ? 'model_family'
          : 'response_model',
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreation5mTokens: a.cacheCreation5mTokens + b.cacheCreation5mTokens,
    cacheCreation1hTokens: a.cacheCreation1hTokens + b.cacheCreation1hTokens,
    totalPromptTokens: a.totalPromptTokens + b.totalPromptTokens,
    estimatedCostMicroUsd: a.estimatedCostMicroUsd + b.estimatedCostMicroUsd,
  });
}

// ---------------------------------------------------------------------------
// 4. Runtime Parameter Whitelist & Request Builder (Canon D09)
// ---------------------------------------------------------------------------

export const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'model',
  'max_tokens',
  'system',
  'messages',
  'output_config',
  'cache_control',
]);

export const FORBIDDEN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'thinking',
  'temperature',
  'top_p',
  'top_k',
  'tools',
  'tool_choice',
  'stop_sequences',
  'metadata',
  'service_tier',
  'stream',
]);

export function isAllowedModel(m: unknown): m is ModelId {
  return (
    typeof m === 'string' && (ALLOWED_MODELS as readonly string[]).includes(m)
  );
}

export function isEffortLevel(e: unknown): e is EffortLevel {
  return (
    typeof e === 'string' && (EFFORT_LEVELS as readonly string[]).includes(e)
  );
}

export function shouldEnableFallbacks(options?: {
  readonly enableFallbacks?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): boolean {
  if (
    options?.enableFallbacks === true ||
    (options?.env ?? process.env).MODEL_FALLBACKS === 'on'
  )
    throw new GatewayConfigError('Model fallbacks are disabled');
  return false;
}

function validateCacheBreakpoints(body: Record<string, unknown>): void {
  const ttls: CacheTtl[] = [];
  const pushCc = (cc: unknown, where: string) => {
    if (cc === undefined) return;
    if (typeof cc !== 'object' || cc === null || Array.isArray(cc)) {
      throw new GatewayConfigError(
        `Invalid cache_control at ${where}: must be an object`,
      );
    }
    const rec = cc as Record<string, unknown>;
    if (rec.type !== 'ephemeral') {
      throw new GatewayConfigError(
        `Invalid cache_control.type at ${where}: must be "ephemeral"`,
      );
    }
    if (Object.keys(rec).some((k) => !['type', 'ttl'].includes(k)))
      throw new GatewayConfigError('Invalid cache_control fields');
    const ttl = rec.ttl ?? '5m';
    if (ttl !== '5m' && ttl !== '1h') {
      throw new GatewayConfigError(
        `Invalid cache_control.ttl at ${where}: expected "5m" or "1h"`,
      );
    }
    ttls.push(ttl);
  };

  if (Array.isArray(body.system)) {
    body.system.forEach((block, idx) => {
      if (typeof block === 'object' && block !== null) {
        pushCc(
          (block as Record<string, unknown>).cache_control,
          `system[${idx}]`,
        );
      }
    });
  }

  if (Array.isArray(body.messages)) {
    body.messages.forEach((msg, mIdx) => {
      if (
        typeof msg === 'object' &&
        msg !== null &&
        Array.isArray((msg as Record<string, unknown>).content)
      ) {
        const blocks = (msg as { content: readonly unknown[] }).content;
        blocks.forEach((block, bIdx) => {
          if (typeof block === 'object' && block !== null) {
            pushCc(
              (block as Record<string, unknown>).cache_control,
              `messages[${mIdx}].content[${bIdx}]`,
            );
          }
        });
      }
    });
  }

  pushCc(body.cache_control, 'top-level');

  if (ttls.length > MAX_CACHE_BREAKPOINTS) {
    throw new GatewayConfigError(
      `Too many cache breakpoints (${ttls.length}); maximum is ${MAX_CACHE_BREAKPOINTS}`,
    );
  }

  let seen5m = false;
  for (const ttl of ttls) {
    if (ttl === '5m') seen5m = true;
    if (ttl === '1h' && seen5m) {
      throw new GatewayConfigError(
        'Cache TTL ordering violation: 1h cache entries must precede all 5m cache entries',
      );
    }
  }
}

/**
 * Runtime parameter whitelist check (Canon D09):
 * Rejects any forbidden or unknown top-level key, enforces `model: 'claude-opus-5-5'`,
 * `max_tokens` bounds, `output_config.effort`, `output_config.format` with plain
 * JSON-schema object (`type: 'object'`). Exactly one user message followed by
 * one system turn instruction; no assistant history. V3/V10 PASS 2026-10-24
 * verified this shape with output_config.format (3/3); system at index 0 fails.
 * Rejects betas/fallbacks.
 */
export function assertWhitelisted(
  rawBody: unknown,
  purpose?: 'schema_warm',
): asserts rawBody is WhitelistedRequestBody {
  if (
    typeof rawBody !== 'object' ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    throw new GatewayConfigError(
      'Request body must be a non-null plain object',
    );
  }
  const body = rawBody as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TOP_LEVEL_KEYS.has(key)) {
      throw new GatewayConfigError(
        `Forbidden request parameter "${key}": Canon D09 bans thinking, sampling params, tools/tool_choice, and stop_sequences`,
      );
    }
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new GatewayConfigError(
        `Non-whitelisted request parameter "${key}"`,
      );
    }
  }

  if (!isAllowedModel(body.model)) {
    throw new GatewayConfigError(
      `Disallowed model ${JSON.stringify(body.model)}; must be "${NEGOTIATION_MODEL}"`,
    );
  }

  if (
    typeof body.max_tokens !== 'number' ||
    !Number.isInteger(body.max_tokens) ||
    body.max_tokens !== (purpose === 'schema_warm' ? 16 : MAX_TOKENS)
  ) {
    throw new GatewayConfigError(
      `Invalid max_tokens ${String(body.max_tokens)}; must equal ${MAX_TOKENS}`,
    );
  }

  if (
    typeof body.output_config !== 'object' ||
    body.output_config === null ||
    Array.isArray(body.output_config)
  ) {
    throw new GatewayConfigError('output_config is required');
  }
  const oc = body.output_config as Record<string, unknown>;
  for (const k of Object.keys(oc)) {
    if (k !== 'effort' && k !== 'format') {
      throw new GatewayConfigError(`Unknown output_config key "${k}"`);
    }
  }
  if (oc.effort !== NEGOTIATION_EFFORT) {
    throw new GatewayConfigError(
      `output_config.effort must be explicitly set to ${NEGOTIATION_EFFORT} (got ${JSON.stringify(oc.effort)})`,
    );
  }
  if (
    typeof oc.format !== 'object' ||
    oc.format === null ||
    Array.isArray(oc.format)
  ) {
    throw new GatewayConfigError('output_config.format is required');
  }
  const fmt = oc.format as Record<string, unknown>;
  if (Object.keys(fmt).some((key) => key !== 'type' && key !== 'schema')) {
    throw new GatewayConfigError(
      'output_config.format accepts only type and schema',
    );
  }
  if (fmt.type !== 'json_schema') {
    throw new GatewayConfigError(
      `output_config.format.type must be "json_schema" (got ${JSON.stringify(fmt.type)})`,
    );
  }
  if (
    typeof fmt.schema !== 'object' ||
    fmt.schema === null ||
    Array.isArray(fmt.schema) ||
    (fmt.schema as Record<string, unknown>).type !== 'object'
  ) {
    throw new GatewayConfigError(
      'output_config.format.schema must be a plain JSON Schema object with top-level type: "object"',
    );
  }

  if (!Array.isArray(body.messages) || body.messages.length !== 2) {
    throw new GatewayConfigError('messages must contain exactly one user message followed by one system turn instruction');
  }
  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (typeof msg !== 'object' || msg === null) {
      throw new GatewayConfigError(`messages[${i}] must be an object`);
    }
    const role = (msg as Record<string, unknown>).role;
    if (role !== (i === 0 ? 'user' : 'system')) {
      throw new GatewayConfigError(
        'messages must contain exactly one user message followed by one system turn instruction; assistant history and prefill are forbidden',
      );
    }
    const content = (msg as Record<string, unknown>).content;
    if (typeof content === 'string') {
      if (content.length === 0) {
        throw new GatewayConfigError(
          `messages[${i}].content string must not be empty`,
        );
      }
    } else if (Array.isArray(content)) {
      if (content.length === 0) {
        throw new GatewayConfigError(
          `messages[${i}].content array must not be empty`,
        );
      }
      for (let j = 0; j < content.length; j++) {
        const block = content[j];
        if (
          typeof block !== 'object' ||
          block === null ||
          (block as Record<string, unknown>).type !== 'text' ||
          typeof (block as Record<string, unknown>).text !== 'string'
        ) {
          throw new GatewayConfigError(
            `messages[${i}].content[${j}] must be a { type: "text", text: string } block`,
          );
        }
      }
    } else {
      throw new GatewayConfigError(
        `messages[${i}].content must be a non-empty string or array of text blocks`,
      );
    }
  }

  const checkBlock = (block: unknown): void => {
    if (!block || typeof block !== 'object' || Array.isArray(block))
      throw new GatewayConfigError('Invalid text block');
    const rec = block as Record<string, unknown>;
    if (
      rec.type !== 'text' ||
      typeof rec.text !== 'string' ||
      Object.keys(rec).some(
        (k) => !['type', 'text', 'cache_control'].includes(k),
      )
    )
      throw new GatewayConfigError('Invalid text block');
  };
  if (body.system !== undefined && typeof body.system !== 'string') {
    if (!Array.isArray(body.system))
      throw new GatewayConfigError('Invalid system');
    body.system.forEach(checkBlock);
  }
  for (const message of body.messages as Record<string, unknown>[]) {
    if (Object.keys(message).some((k) => !['role', 'content'].includes(k)))
      throw new GatewayConfigError('Invalid message fields');
    if (Array.isArray(message.content)) message.content.forEach(checkBlock);
  }

  validateCacheBreakpoints(body);
}

export interface BuildRequestInput {
  readonly purpose?: 'schema_warm';
  readonly model?: ModelId;
  readonly effort?: EffortLevel;
  readonly maxTokens?: number;
  readonly system?: string | readonly TextBlockParam[];
  readonly messages: readonly MessageParam[];
  readonly schema: JsonSchemaObject;
  readonly cacheControl?: EphemeralCacheControl;
  readonly enableFallbacks?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Construct and validate a canonical `WhitelistedRequestBody` (Canon D09).
 */
export function buildRequest(input: BuildRequestInput): WhitelistedRequestBody {
  if ('extraBody' in input)
    throw new GatewayConfigError('extraBody is test-only');
  shouldEnableFallbacks({
    enableFallbacks: input.enableFallbacks,
    env: input.env,
  });

  const candidate: Record<string, unknown> = {
    model: input.model ?? NEGOTIATION_MODEL,
    max_tokens: input.maxTokens ?? MAX_TOKENS,
    ...(input.system !== undefined ? { system: input.system } : {}),
    messages: input.messages,
    output_config: {
      effort: input.effort ?? NEGOTIATION_EFFORT,
      format: {
        type: 'json_schema',
        schema: input.schema,
      },
    },
    ...(input.cacheControl !== undefined
      ? { cache_control: input.cacheControl }
      : {}),
  };

  assertWhitelisted(candidate, input.purpose);
  return Object.freeze(candidate) as unknown as WhitelistedRequestBody;
}

// ---------------------------------------------------------------------------
// 5. Validation & Sanitized Issue Paths (Canon D16)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** Dot/bracket path using only whitelisted schema property names (`*` for unknown segments). */
  readonly path: string;
  /** Short machine-readable validation code; never contains raw model output values. */
  readonly code: string;
}

export type ValidationIssueInput = {
  readonly path?: readonly PropertyKey[] | string;
  readonly code?: string;
};

export type ValidatorResult<T> =
  | { readonly ok: true; readonly data?: T; readonly value?: T }
  | {
      readonly ok: false;
      readonly issues?: readonly ValidationIssueInput[];
    }
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly error: { readonly issues?: readonly ValidationIssueInput[] };
    };

export type ValidatorFn<T> = (raw: unknown) => ValidatorResult<T>;

export interface SchemaValidatorObject<T> {
  readonly schema?: JsonSchemaObject;
  readonly allowedIssuePaths?: ReadonlySet<string>;
  readonly validate?: ValidatorFn<T>;
  readonly safeParse?: (raw: unknown) => ValidatorResult<T>;
}

export type ValidatorInput<T> = ValidatorFn<T> | SchemaValidatorObject<T>;

const SAFE_ISSUE_CODE_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

/**
 * Extract all property names declared inside a `JsonSchemaObject` so issue
 * paths can be whitelisted automatically without leaking arbitrary keys from
 * model output.
 */
export function extractSchemaPropertyNames(
  schema: JsonSchemaObject,
): ReadonlySet<string> {
  const allowed = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.properties === 'object' && rec.properties !== null) {
      for (const [k, v] of Object.entries(
        rec.properties as Record<string, unknown>,
      )) {
        allowed.add(k);
        visit(v);
      }
    }
    if (rec.items !== undefined) visit(rec.items);
    if (Array.isArray(rec.anyOf)) visit(rec.anyOf);
    if (Array.isArray(rec.oneOf)) visit(rec.oneOf);
    if (Array.isArray(rec.allOf)) visit(rec.allOf);
    if (typeof rec.$defs === 'object' && rec.$defs !== null) {
      for (const v of Object.values(rec.$defs as Record<string, unknown>)) {
        visit(v);
      }
    }
  };
  visit(schema);
  return allowed;
}

export function formatSafeIssuePath(
  segments: readonly PropertyKey[] | string | undefined,
  allowedSegments: ReadonlySet<string>,
): string {
  if (segments === undefined) return '<root>';
  const parts: readonly PropertyKey[] =
    typeof segments === 'string'
      ? segments.length === 0
        ? []
        : segments.split('.')
      : segments;

  if (parts.length === 0) return '<root>';
  let out = '';
  for (const seg of parts) {
    if (typeof seg === 'number' || /^\d+$/.test(String(seg))) {
      out += `[${String(seg)}]`;
    } else if (typeof seg === 'string') {
      const safe = allowedSegments.has(seg) ? seg : '*';
      out += out.length === 0 ? safe : `.${safe}`;
    } else {
      out += out.length === 0 ? '*' : '.*';
    }
  }
  return out;
}

function sanitizeIssues(
  rawIssues: readonly ValidationIssueInput[] | undefined,
  allowedSegments: ReadonlySet<string>,
): readonly ValidationIssue[] {
  if (!rawIssues || rawIssues.length === 0) {
    return Object.freeze([{ path: '<root>', code: 'schema_violation' }]);
  }
  return Object.freeze(
    rawIssues.slice(0, 32).map((issue) => {
      const rawCode = issue.code ?? 'invalid_value';
      const safeCode = SAFE_ISSUE_CODE_RE.test(rawCode)
        ? rawCode
        : 'invalid_value';
      return Object.freeze({
        path: formatSafeIssuePath(issue.path, allowedSegments),
        code: safeCode,
      });
    }),
  );
}

function runCallerValidator<T>(
  validator: ValidatorInput<T>,
  parsed: unknown,
  allowedSegments: ReadonlySet<string>,
):
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  try {
    let result: ValidatorResult<T>;
    if (typeof validator === 'function') {
      result = validator(parsed);
    } else if (typeof validator.validate === 'function') {
      result = validator.validate(parsed);
    } else if (typeof validator.safeParse === 'function') {
      result = validator.safeParse(parsed);
    } else {
      throw new GatewayConfigError(
        'Validator must be a function or an object with validate() / safeParse()',
      );
    }

    if (typeof result === 'object' && result !== null) {
      if ('ok' in result) {
        if (result.ok === true) {
          const val = (
            'data' in result && result.data !== undefined
              ? result.data
              : result.value
          ) as T;
          return { ok: true, data: val };
        }
        return {
          ok: false,
          issues: sanitizeIssues(result.issues, allowedSegments),
        };
      }
      if ('success' in result) {
        if (result.success === true) {
          return { ok: true, data: result.data };
        }
        return {
          ok: false,
          issues: sanitizeIssues(result.error?.issues, allowedSegments),
        };
      }
    }

    return {
      ok: false,
      issues: sanitizeIssues(undefined, allowedSegments),
    };
  } catch (err) {
    if (err instanceof GatewayConfigError) throw err;
    const maybeIssues =
      typeof err === 'object' &&
      err !== null &&
      Array.isArray((err as { issues?: unknown }).issues)
        ? (err as { issues: readonly ValidationIssueInput[] }).issues
        : undefined;
    return {
      ok: false,
      issues: sanitizeIssues(maybeIssues, allowedSegments),
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Error Classification & Log Safety (Canon D16 + REVIEW r01, r07, r08)
// ---------------------------------------------------------------------------

export type ModelReasonCode =
  | 'output.truncated'
  | 'output.refusal'
  | 'output.not_json'
  | 'output.schema_violation'
  | null;

export interface ClassifiedError {
  readonly kind: 'error' | 'aborted';
  readonly errorCode: AttemptErrorCode;
  readonly reasonCode: ModelReasonCode;
  readonly status: number | null;
  /** Eligibility only for this call's CN-001 transport retry; never attempt retry policy. */
  readonly gatewayRetryable: boolean;
  readonly retryAfterMs: number | null;
  readonly requestId: string | null;
  /**
   * Safe diagnostic string containing ONLY HTTP status and whitelisted error
   * type token — NEVER `err.message`, server body message, prompt, or model text
   * (Canon D16, resolves `model-call-r01`).
   */
  readonly detail: string;
}

const SAFE_API_ERROR_TYPES = new Set([
  'error',
  'api_error',
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'not_found_error',
  'rate_limit_error',
  'overloaded_error',
  'model_context_window_exceeded',
  'context_length_exceeded',
  'billing_error',
]);
const SAFE_ERROR_TYPE_TOKEN_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

function extractHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const lower = name.toLowerCase();
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get(k: string): string | null | undefined }).get(
      lower,
    );
    if (typeof val === 'string' && val.length > 0) return val;
    const exact = (
      headers as { get(k: string): string | null | undefined }
    ).get(name);
    if (typeof exact === 'string' && exact.length > 0) return exact;
  }
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === lower && typeof v === 'string' && v.length > 0) {
      return v;
    }
  }
  return null;
}

export function extractErrorRequestId(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as Record<string, unknown>;
  if (typeof rec.requestID === 'string' && rec.requestID.length > 0) {
    return rec.requestID;
  }
  if (typeof rec.request_id === 'string' && rec.request_id.length > 0) {
    return rec.request_id;
  }
  return extractHeader(rec.headers, 'request-id');
}

function parseRetryAfterMs(headers: unknown): number | null {
  const msHeader = extractHeader(headers, 'retry-after-ms');
  if (msHeader !== null) {
    const n = Number(msHeader);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  const secHeader = extractHeader(headers, 'retry-after');
  if (secHeader !== null) {
    const secs = Number(secHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  }
  return null;
}

function extractSafeErrorType(err: Record<string, unknown>): string | null {
  const outer = err.error;
  if (typeof outer === 'object' && outer !== null) {
    const outerRec = outer as Record<string, unknown>;
    if (
      typeof outerRec.type === 'string' &&
      SAFE_API_ERROR_TYPES.has(outerRec.type)
    ) {
      const inner = outerRec.error;
      if (typeof inner === 'object' && inner !== null) {
        const innerType = (inner as Record<string, unknown>).type;
        if (
          typeof innerType === 'string' &&
          SAFE_API_ERROR_TYPES.has(innerType)
        ) {
          return innerType;
        }
      }
      return outerRec.type;
    }
    const inner = outerRec.error;
    if (typeof inner === 'object' && inner !== null) {
      const innerType = (inner as Record<string, unknown>).type;
      if (
        typeof innerType === 'string' &&
        SAFE_API_ERROR_TYPES.has(innerType)
      ) {
        return innerType;
      }
    }
  }
  return null;
}

/**
 * Classify any thrown transport/SDK error without EVER copying `err.message`
 * or server body strings into `detail` (Canon D16, resolves `model-call-r01`).
 */
export function classifyError(err: unknown): ClassifiedError {
  const rec =
    err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
  const name = typeof rec.name === 'string' ? rec.name : 'Error';
  const status = typeof rec.status === 'number' ? rec.status : null;
  const sdk =
    err instanceof GatewayAPIError ||
    /^(API.*Error|RateLimitError|InternalServerError|BadRequestError|UnprocessableEntityError|AuthenticationError|PermissionDeniedError|NotFoundError|ConflictError)$/.test(
      name,
    );
  let errorCode: AttemptErrorCode = 'internal';
  let gatewayRetryable = false;
  if (err instanceof GatewayConfigError || name === 'GatewayConfigError')
    errorCode = 'config_invalid';
  else if (
    [
      'APIUserAbortError',
      'APIConnectionTimeoutError',
      'AbortError',
      'TimeoutError',
    ].includes(name)
  )
    errorCode = 'model_timeout';
  else if (sdk) {
    const type = extractSafeErrorType(rec);
    if (type === 'billing_error') errorCode = 'quota_exhausted';
    else if (
      name === 'APIConnectionError' ||
      name === 'RateLimitError' ||
      status === 429
    ) {
      errorCode = 'transport';
      gatewayRetryable = true;
    } else if (
      (status !== null && status >= 500) ||
      name === 'InternalServerError' ||
      type === 'overloaded_error'
    )
      errorCode = 'transport';
    else if (
      status === 400 ||
      status === 413 ||
      status === 422 ||
      name === 'BadRequestError' ||
      name === 'UnprocessableEntityError'
    )
      errorCode = 'bad_request';
    else if (
      status === 401 ||
      status === 403 ||
      name === 'AuthenticationError' ||
      name === 'PermissionDeniedError'
    )
      errorCode = 'auth';
    else if (status === 404 || name === 'NotFoundError')
      errorCode = 'model_not_found';
    else errorCode = 'api_error';
  }
  const retainHttp =
    sdk && ['transport', 'bad_request', 'api_error'].includes(errorCode);
  return Object.freeze({
    kind: 'error',
    errorCode,
    reasonCode: null,
    status: retainHttp ? status : null,
    gatewayRetryable,
    retryAfterMs:
      sdk && (status === 429 || name === 'RateLimitError')
        ? parseRetryAfterMs(rec.headers)
        : null,
    requestId:
      retainHttp && errorCode !== 'api_error'
        ? extractErrorRequestId(err)
        : null,
    detail: retainHttp ? `http_status=${status ?? 'none'}` : name,
  });
}

// ---------------------------------------------------------------------------
// 7. Streaming Client & Injectable Transport Abstraction (Canon D09)
// ---------------------------------------------------------------------------

export interface StreamCallOptions {
  readonly timeout: number;
  readonly maxRetries: number;
  readonly signal?: AbortSignal;
}

export interface MessageStreamLike {
  finalMessage(): Promise<RawAnthropicMessage>;
}

/**
 * Structural interface matching `@anthropic-ai/sdk`'s `Anthropic` client.
 * Uses only the stable `client.messages.stream(body, options).finalMessage()` API.
 */
export interface AnthropicClientLike {
  readonly models?: { retrieve(model: string): Promise<unknown> };
  readonly messages: {
    stream(
      body: WhitelistedRequestBody,
      options?: StreamCallOptions,
    ): MessageStreamLike;
  };
}

export interface TransportResponse {
  readonly message: RawAnthropicMessage;
  readonly requestId: string | null;
  readonly provenance: 'live' | 'stub';
}

export interface ModelTransport {
  readonly provenance: 'live' | 'stub';
  send(
    body: WhitelistedRequestBody,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  ): Promise<TransportResponse>;
}

/**
 * Wrap an Anthropic SDK client (or compatible stream client) in a `ModelTransport`.
 * Calls `client.messages.stream(body, { timeout, maxRetries: 0, signal }).finalMessage()`
 * per Canon D09 (never `messages.parse`).
 */
export function anthropicTransport(
  client: AnthropicClientLike,
  options?: { readonly sdkMaxRetries?: number; readonly purpose?: 'schema_warm' },
): ModelTransport {
  if (
    !client ||
    typeof client !== 'object' ||
    !client.messages ||
    typeof client.messages.stream !== 'function'
  ) {
    throw new GatewayConfigError(
      'anthropicTransport requires a client with client.messages.stream(...).finalMessage()',
    );
  }
  const sdkMaxRetries = options?.sdkMaxRetries ?? SDK_MAX_RETRIES;
  if (sdkMaxRetries !== 0)
    throw new GatewayConfigError(
      'Gateway owns retries; SDK retries must be zero',
    );

  return Object.freeze<ModelTransport>({
    provenance: 'live',
    async send(body, callOpts) {
      assertWhitelisted(body, options?.purpose);
      const streamOpts: StreamCallOptions = {
        timeout: callOpts.timeoutMs,
        maxRetries: sdkMaxRetries,
        ...(callOpts.signal !== undefined ? { signal: callOpts.signal } : {}),
      };

      const stream = client.messages.stream(body, streamOpts);

      const message = await stream.finalMessage();
      return {
        message,
        requestId: message._request_id ?? null,
        provenance: 'live',
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 8. HTTP / SSE Stream Client Adapter (for custom `fetch` & offline wire tests)
// ---------------------------------------------------------------------------

export class GatewayAPIError extends Error {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestID: string | null;
  readonly error: unknown;

  constructor(
    status: number,
    errorBody: unknown,
    message: string,
    headers: Readonly<Record<string, string>> = {},
  ) {
    super(`HTTP ${status}`);
    void message;
    this.name = 'APIError';
    this.status = status;
    this.headers = headers;
    this.requestID = headers['request-id'] ?? headers['Request-Id'] ?? null;
    this.error = {
      type: extractSafeErrorType({ error: errorBody }) ?? 'api_error',
    };
  }
}

export class GatewayTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'APIConnectionTimeoutError';
  }
}

export class GatewayAbortError extends Error {
  constructor(message = 'Request was aborted') {
    super(message);
    this.name = 'APIUserAbortError';
  }
}

function parseSseFinalMessage(
  sseText: string,
  requestId: string | null,
): RawAnthropicMessage {
  let message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: Array<{ type: string; text?: string; [k: string]: unknown }>;
    stop_reason: StopReason | string | null;
    stop_sequence: string | null;
    stop_details?: { category?: string | null } | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      output_tokens_details?: { thinking_tokens?: number | null } | null;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number | null;
        ephemeral_1h_input_tokens?: number | null;
      } | null;
    };
  } | null = null;

  const lines = sseText.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    const evt = JSON.parse(dataStr) as Record<string, unknown>;
    const evtType = evt.type;
    if (
      evtType === 'message_start' &&
      typeof evt.message === 'object' &&
      evt.message !== null
    ) {
      const m = evt.message as Record<string, unknown>;
      const u = (m.usage as Record<string, number | undefined>) ?? {};
      message = {
        id: String(m.id ?? 'msg_stream'),
        type: 'message',
        role: 'assistant',
        model: String(m.model ?? NEGOTIATION_MODEL),
        content: Array.isArray(m.content)
          ? [...(m.content as Array<{ type: string }>)]
          : [],
        stop_reason: (m.stop_reason as StopReason | null) ?? null,
        stop_sequence: (m.stop_sequence as string | null) ?? null,
        stop_details: m.stop_details as
          { category?: string | null } | undefined,
        usage: {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          output_tokens_details: (m.usage as RawAnthropicUsage)
            .output_tokens_details,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        },
      };
    } else if (evtType === 'content_block_start' && message) {
      const idx =
        typeof evt.index === 'number' ? evt.index : message.content.length;
      const block = (evt.content_block as { type: string; text?: string }) ?? {
        type: 'text',
        text: '',
      };
      message.content[idx] = { ...block };
    } else if (evtType === 'content_block_delta' && message) {
      const idx = typeof evt.index === 'number' ? evt.index : 0;
      const delta = evt.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        const existing = message.content[idx] ?? { type: 'text', text: '' };
        existing.text = (existing.text ?? '') + delta.text;
        message.content[idx] = existing;
      }
    } else if (evtType === 'message_delta' && message) {
      const delta = evt.delta as
        | {
            stop_reason?: string | null;
            stop_sequence?: string | null;
            stop_details?: { category?: string | null } | null;
          }
        | undefined;
      if (delta && 'stop_reason' in delta) {
        message.stop_reason = delta.stop_reason ?? null;
      }
      if (delta?.stop_details !== undefined)
        message.stop_details = delta.stop_details;
      const usageDelta = evt.usage as Partial<RawAnthropicUsage> | undefined;
      if (usageDelta && typeof usageDelta.output_tokens === 'number') {
        message.usage.output_tokens = usageDelta.output_tokens;
      }
      if (usageDelta?.output_tokens_details !== undefined)
        message.usage.output_tokens_details = usageDelta.output_tokens_details;
    }
  }

  if (!message) {
    throw new Error('SSE stream ended without message_start event');
  }

  return {
    id: message.id,
    type: 'message',
    role: 'assistant',
    model: message.model,
    content: message.content as unknown as readonly RawContentBlock[],
    stop_reason: message.stop_reason,
    stop_sequence: message.stop_sequence,
    stop_details: message.stop_details,
    usage: message.usage,
    _request_id: requestId,
  };
}

/**
 * Create an `AnthropicClientLike` backed by an injectable `fetch` implementation.
 * Useful for testing wire serialization, headers, SSE assembly, and HTTP status
 * handling against an in-process fake `fetch` without external network calls.
 */
export function createFetchStreamClient(options: {
  readonly fetch: typeof globalThis.fetch;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly purpose?: 'schema_warm';
}): AnthropicClientLike {
  const baseURL = (options.baseURL ?? 'https://api.anthropic.com').replace(
    /\/$/,
    '',
  );
  const apiKey = options.apiKey ?? 'sk-ant-test-key';

  function createStream(
    body: WhitelistedRequestBody,
    streamOpts?: StreamCallOptions,
  ): MessageStreamLike {
    return {
      async finalMessage(): Promise<RawAnthropicMessage> {
        assertWhitelisted(body, options.purpose);
        if (streamOpts?.signal?.aborted) {
          throw new GatewayAbortError();
        }

        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        };
        const wirePayload: Record<string, unknown> = {
          ...body,
          stream: true,
        };

        const resources: { dispose(): void }[] = [];
        try {
          const timeout = abortAfter(streamOpts?.timeout ?? DEFAULT_TIMEOUT_MS);
          resources.push(timeout);
          const combined = anySignal(
            streamOpts?.signal
              ? [streamOpts.signal, timeout.signal]
              : [timeout.signal],
          );
          resources.push(combined);
          const res = await options.fetch(`${baseURL}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(wirePayload),
            signal: combined.signal,
          });

          const headerMap: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headerMap[key.toLowerCase()] = value;
          });
          const requestId = headerMap['request-id'] ?? null;

          const rawText = await res.text();
          if (!res.ok) {
            throw new GatewayAPIError(
              res.status,
              { type: 'api_error' },
              `HTTP ${res.status}`,
              headerMap,
            );
          }

          const contentType = headerMap['content-type'] ?? '';
          if (
            contentType.includes('text/event-stream') ||
            rawText.trimStart().startsWith('event:') ||
            rawText.trimStart().startsWith('data:')
          ) {
            return parseSseFinalMessage(rawText, requestId);
          }

          const parsedMsg = JSON.parse(rawText) as RawAnthropicMessage;
          return {
            ...parsedMsg,
            _request_id: parsedMsg._request_id ?? requestId,
          };
        } finally {
          for (const resource of resources) resource.dispose();
        }
      },
    };
  }

  return Object.freeze({
    models: Object.freeze({
      async retrieve(model: string): Promise<unknown> {
        const deadline = abortAfter(REQUEST_TIMEOUT_MS);
        try {
        const response = await options.fetch(`${baseURL}/v1/models/${encodeURIComponent(model)}`, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          signal: deadline.signal,
        });
        if (!response.ok) throw new GatewayAPIError(response.status, null, 'Model retrieval failed');
        return await response.json();
        } finally { deadline.dispose(); }
      },
    }),
    messages: Object.freeze({
      stream: createStream,
    }),
  });
}

// ---------------------------------------------------------------------------
// 9. Deterministic Stub Transport (`stubTransport` & `sequenceResponder`)
// ---------------------------------------------------------------------------

export type StubOutcome<T> =
  | {
      readonly kind: 'ok';
      readonly value?: T;
      readonly data?: T;
      readonly rawJson?: string;
      readonly usage?: Partial<RawAnthropicUsage>;
      readonly requestId?: string;
      readonly messageId?: string;
      readonly servedModel?: string;
    }
  | {
      readonly kind: 'raw_text';
      readonly text: string;
      readonly stopReason?: StopReason | string | null;
      readonly usage?: Partial<RawAnthropicUsage>;
      readonly requestId?: string;
    }
  | {
      readonly kind: 'no_text_block';
      readonly stopReason?: StopReason;
      readonly usage?: Partial<RawAnthropicUsage>;
      readonly requestId?: string;
    }
  | {
      readonly kind: 'stop';
      readonly stopReason: Exclude<StopReason, 'end_turn'> | string | null;
      readonly partialText?: string;
      readonly usage?: Partial<RawAnthropicUsage>;
      readonly requestId?: string;
    }
  | {
      readonly kind: 'throw';
      readonly error: unknown;
    };

export type StubResponder<T = unknown> = (
  body: WhitelistedRequestBody,
  callIndex: number,
) => StubOutcome<T> | Promise<StubOutcome<T>>;

const DEFAULT_STUB_USAGE: RawAnthropicUsage = Object.freeze({
  input_tokens: 320,
  output_tokens: 96,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

/**
 * Deterministic, zero-network stub transport for tests and simulation harnesses.
 * Still enforces `assertWhitelisted(body)` on every call so stubs cannot hide
 * parameter whitelist violations.
 */
export function stubTransport<T = unknown>(
  responder: StubResponder<T>,
): ModelTransport {
  let callIndex = 0;

  return Object.freeze<ModelTransport>({
    provenance: 'stub',
    async send(body, options) {
      assertWhitelisted(body);
      if (options.signal?.aborted) {
        throw new GatewayAbortError();
      }

      const idx = callIndex++;
      const outcome = await responder(body, idx);

      if (options.signal?.aborted) {
        throw new GatewayAbortError();
      }

      if (outcome.kind === 'throw') {
        throw outcome.error;
      }

      const requestId = outcome.requestId ?? `req_stub_${idx + 1}`;
      const usage: RawAnthropicUsage = {
        ...DEFAULT_STUB_USAGE,
        ...outcome.usage,
      };

      if (outcome.kind === 'ok') {
        const payload =
          outcome.data !== undefined ? outcome.data : outcome.value;
        const text = outcome.rawJson ?? JSON.stringify(payload);
        return {
          provenance: 'stub',
          requestId,
          message: {
            id: outcome.messageId ?? `msg_stub_${idx + 1}`,
            type: 'message',
            role: 'assistant',
            model: outcome.servedModel ?? body.model,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage,
            _request_id: requestId,
          },
        };
      }

      if (outcome.kind === 'raw_text') {
        return {
          provenance: 'stub',
          requestId,
          message: {
            id: `msg_stub_${idx + 1}`,
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text: outcome.text }],
            stop_reason:
              outcome.stopReason === undefined
                ? 'end_turn'
                : outcome.stopReason,
            stop_sequence: null,
            usage,
            _request_id: requestId,
          },
        };
      }

      if (outcome.kind === 'no_text_block') {
        return {
          provenance: 'stub',
          requestId,
          message: {
            id: `msg_stub_${idx + 1}`,
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [],
            stop_reason: outcome.stopReason ?? 'end_turn',
            stop_sequence: null,
            usage,
            _request_id: requestId,
          },
        };
      }

      return {
        provenance: 'stub',
        requestId,
        message: {
          id: `msg_stub_${idx + 1}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content:
            outcome.partialText !== undefined
              ? [{ type: 'text', text: outcome.partialText }]
              : [],
          stop_reason: outcome.stopReason,
          stop_sequence: null,
          usage,
          _request_id: requestId,
        },
      };
    },
  });
}

export function sequenceResponder<T = unknown>(
  outcomes: readonly StubOutcome<T>[],
): StubResponder<T> {
  if (outcomes.length === 0) {
    throw new GatewayConfigError(
      'sequenceResponder requires at least one StubOutcome',
    );
  }
  return (_body, idx) => outcomes[Math.min(idx, outcomes.length - 1)]!;
}

// ---------------------------------------------------------------------------
// 10. Structured Telemetry & Discriminated Result Types (Canon D09)
// ---------------------------------------------------------------------------

export interface AttemptTelemetry {
  readonly attempt: number;
  readonly model: ModelId;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string | null;
  readonly effort: EffortLevel;
  readonly provenance: 'live' | 'stub';
  readonly requestId: string | null;
  readonly messageId: string | null;
  readonly durationMs: number;
  readonly stopReason: StopReason | string | null;
  readonly outcomeKind:
    | 'ok'
    | 'refused'
    | 'output.truncated'
    | 'output.not_json'
    | 'output.schema_violation'
    | 'error'
    | 'aborted';
  readonly attemptStatus: AttemptStatus;
  readonly reasonCode: ModelReasonCode | null;
  readonly errorCode: AttemptErrorCode | null;
  readonly httpStatus: number | null;
  readonly usage: UsageRecord | null;
  readonly validationIssueCount: number;
}

export interface CallSuccess<T> {
  readonly ok: true;
  readonly kind: 'ok';
  readonly attemptStatus: 'completed';
  readonly data: T;
  readonly value: T;
  readonly stopReason: 'end_turn';
  readonly usage: UsageRecord;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string;
  readonly model: ModelId;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export interface CallRefusal {
  readonly ok: false;
  readonly kind: 'refused';
  readonly attemptStatus: 'refused';
  readonly reasonCode: 'output.refusal';
  readonly stopReason: 'refusal';
  readonly gatewayRetryable: false;
  readonly usage: UsageRecord;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export interface CallTruncated {
  readonly ok: false;
  readonly kind: 'output.truncated';
  readonly attemptStatus: 'invalid_output';
  readonly reasonCode: 'output.truncated';
  readonly stopReason: 'max_tokens';
  readonly gatewayRetryable: false;
  readonly usage: UsageRecord;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export interface CallInvalidOutput {
  readonly ok: false;
  readonly kind: 'output.not_json' | 'output.schema_violation';
  readonly attemptStatus: 'invalid_output';
  readonly reasonCode: 'output.not_json' | 'output.schema_violation';
  readonly stopReason: 'end_turn';
  readonly gatewayRetryable: false;
  readonly issues: readonly ValidationIssue[];
  readonly usage: UsageRecord;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export interface CallError {
  readonly ok: false;
  readonly kind: 'error';
  readonly attemptStatus: 'error' | 'timeout';
  readonly errorCode: AttemptErrorCode;
  readonly reasonCode: ModelReasonCode;
  readonly status: number | null;
  readonly stopReason: StopReason | string | null;
  /** Final failures cannot request another gateway or attempt-level transport retry. */
  readonly gatewayRetryable: false;
  readonly detail: string;
  readonly usage: UsageRecord | null;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string | null;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: string | null;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export interface CallAborted {
  readonly ok: false;
  readonly kind: 'aborted';
  readonly attemptStatus: 'error' | 'timeout';
  readonly errorCode: 'model_timeout';
  readonly reasonCode: null;
  readonly status: null;
  readonly stopReason: null;
  readonly gatewayRetryable: false;
  readonly detail: string;
  readonly usage: null;
  readonly totalUsage: UsageRecord;
  readonly requestId: string | null;
  readonly messageId: string | null;
  readonly responseModel: string | null;
  readonly stopCategory: string | null;
  readonly servedModel: null;
  readonly provenance: 'live' | 'stub';
  readonly attempts: number;
  readonly durationMs: number;
  readonly attemptLogs: readonly AttemptTelemetry[];
}

export type CallFailure =
  CallRefusal | CallTruncated | CallInvalidOutput | CallError | CallAborted;

export type ModelCallResult<T> = CallSuccess<T> | CallFailure;

// ---------------------------------------------------------------------------
// 11. `callModel` Execution Pipeline (Canon D09)
// ---------------------------------------------------------------------------

export interface CallModelParams<T> {
  readonly purpose?: 'schema_warm';
  /** Either a `ModelTransport` or an `AnthropicClientLike` with `.messages.stream`. */
  readonly transport?: ModelTransport;
  readonly client?: AnthropicClientLike;
  readonly model?: ModelId;
  readonly effort?: EffortLevel;
  readonly maxTokens?: number;
  readonly system?: string | readonly TextBlockParam[];
  readonly messages: readonly MessageParam[];
  /** Plain JSON Schema object (`{ type: 'object', ... }`) passed to `output_config.format`. */
  readonly schema?: JsonSchemaObject;
  /** Caller-supplied validator (`(obj: unknown) => ValidatorResult<T>`) or schema+validate bundle. */
  readonly validate: ValidatorInput<T>;
  readonly allowedIssuePaths?: ReadonlySet<string>;
  readonly cacheControl?: EphemeralCacheControl;
  readonly enableFallbacks?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Per-attempt timeout in ms (default `REQUEST_TIMEOUT_MS = 220_000`). */
  readonly timeoutMs?: number;
  /** Total deadline budget in ms across all attempts (default `CALL_DEADLINE_MS = 230_000`). */
  readonly totalBudgetMs?: number;
  /** Gateway owns one retry for 429/connection errors by default; SDK retries stay zero. Tests may disable it. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly onAttempt?: (telemetry: AttemptTelemetry) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly prices?: Readonly<Record<string, ModelPrice>>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GatewayAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GatewayAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function computeBackoffMs(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  retryAfterMs: number | null,
  random: () => number,
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attemptIndex));
  const r = Math.max(0, Math.min(1, random()));
  const jittered = Math.round(exp * (0.5 + 0.5 * r));
  if (retryAfterMs !== null) {
    return Math.min(maxDelayMs, Math.max(jittered, retryAfterMs));
  }
  return jittered;
}

function validateTimingConfig(params: {
  readonly timeoutMs: number;
  readonly totalBudgetMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxRetryDelayMs: number;
}): void {
  if (!Number.isFinite(params.timeoutMs) || params.timeoutMs <= 0) {
    throw new GatewayConfigError(
      `timeoutMs must be a positive finite number (got ${String(params.timeoutMs)})`,
    );
  }
  if (!Number.isFinite(params.totalBudgetMs) || params.totalBudgetMs <= 0) {
    throw new GatewayConfigError(
      `totalBudgetMs must be a positive finite number (got ${String(params.totalBudgetMs)})`,
    );
  }
  if (
    !Number.isInteger(params.maxRetries) ||
    params.maxRetries < 0 ||
    params.maxRetries > 1
  ) {
    throw new GatewayConfigError(
      `maxRetries must be a non-negative integer (got ${String(params.maxRetries)})`,
    );
  }
  if (
    !Number.isFinite(params.retryBaseDelayMs) ||
    params.retryBaseDelayMs < 0
  ) {
    throw new GatewayConfigError(
      `retryBaseDelayMs must be a non-negative finite number (got ${String(params.retryBaseDelayMs)})`,
    );
  }
  if (
    !Number.isFinite(params.maxRetryDelayMs) ||
    params.maxRetryDelayMs < params.retryBaseDelayMs ||
    params.maxRetryDelayMs > MODEL_BUDGET.RETRY_BACKOFF_CAP_MS
  ) {
    throw new GatewayConfigError(
      `maxRetryDelayMs (${String(params.maxRetryDelayMs)}) must be >= retryBaseDelayMs (${String(params.retryBaseDelayMs)}) and <= ${MODEL_BUDGET.RETRY_BACKOFF_CAP_MS}`,
    );
  }
}

/**
 * Execute a structured model call through the Canon D09 gateway pipeline:
 *
 * 1. Validate timing/budget parameters and build the whitelisted request body.
 * 2. Stream via `transport.send` (`client.messages.stream(...).finalMessage()`).
 * 3. Record `usage`, `stop_reason`, and `requestId` BEFORE any branching or parsing.
 * 4. Branch on `stop_reason`:
 *    - `'max_tokens'` -> `'output.truncated'`
 *    - `'refusal'` -> `'refused'` (`reasonCode: 'output.refusal'`)
 *    - `'model_context_window_exceeded'` -> `'error'` (`errorCode: 'context_overflow'`)
 *    - `'end_turn'` -> `JSON.parse` + caller-supplied `validate(obj)`
 *    - anything else -> `'error'` (`errorCode: 'unexpected_stop'`)
 */
export async function callModel<T>(
  params: CallModelParams<T>,
): Promise<ModelCallResult<T>> {
  if ('extraBody' in params)
    throw new GatewayConfigError('extraBody is test-only');
  const model = params.model ?? NEGOTIATION_MODEL;
  const effort = params.effort ?? NEGOTIATION_EFFORT;
  const maxTokens = params.maxTokens ?? MAX_TOKENS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalBudgetMs = Math.min(
    params.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS,
    CALL_DEADLINE_MS,
  );
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs =
    params.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxRetryDelayMs = params.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const now = params.now ?? (() => Date.now());
  const sleep = params.sleep ?? defaultSleep;
  const random = params.random ?? (() => 0.5);
  const prices = params.prices ?? LIST_PRICES;

  validateTimingConfig({
    timeoutMs,
    totalBudgetMs,
    maxRetries,
    retryBaseDelayMs,
    maxRetryDelayMs,
  });

  const resolvedTransport: ModelTransport | undefined =
    params.transport ??
    (params.client ? anthropicTransport(params.client) : undefined);

  if (!resolvedTransport || typeof resolvedTransport.send !== 'function') {
    throw new GatewayConfigError(
      'callModel requires either params.transport or params.client',
    );
  }

  const validatorObj =
    typeof params.validate === 'object' && params.validate !== null
      ? params.validate
      : undefined;
  const resolvedSchema = params.schema ?? validatorObj?.schema;
  if (!resolvedSchema) {
    throw new GatewayConfigError(
      'callModel requires a plain JSON-schema object in params.schema (or params.validate.schema)',
    );
  }

  const body = buildRequest({
    purpose: params.purpose,
    model,
    effort,
    maxTokens,
    system: params.system,
    messages: params.messages,
    schema: resolvedSchema,
    cacheControl: params.cacheControl,
    enableFallbacks: params.enableFallbacks,
    env: params.env,
  });

  const allowedIssuePaths =
    params.allowedIssuePaths ??
    validatorObj?.allowedIssuePaths ??
    extractSchemaPropertyNames(resolvedSchema);

  const callStart = now();
  const wallStart = Date.now();
  const resources: { dispose(): void }[] = [];
  try {
    const deadline = abortAfter(Math.ceil(totalBudgetMs));
    resources.push(deadline);
    const callDeadline = deadline.signal;
    const combined = anySignal(
      params.signal ? [params.signal, callDeadline] : [callDeadline],
    );
    resources.push(combined);
    const callSignal = combined.signal;
    const attemptLogs: AttemptTelemetry[] = [];
    let totalUsage = emptyUsageRecord();

    const recordTelemetry = (entry: AttemptTelemetry): void => {
      const frozen = Object.freeze(entry);
      attemptLogs.push(frozen);
      params.onAttempt?.(frozen);
    };

    let transportRetries = 0;
    let truncationRetries = 0;
    for (let attemptIdx = 0; attemptIdx <= maxRetries + 1; attemptIdx++) {
      const attemptNumber = attemptIdx + 1;
      const attemptStart = now();

      // Check caller abort signal before starting attempt
      if (params.signal?.aborted) {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          effort,
          provenance: resolvedTransport.provenance,
          requestId: null,
          messageId: null,
          durationMs: Math.max(0, now() - attemptStart),
          stopReason: null,
          outcomeKind: 'aborted',
          attemptStatus: 'timeout',
          reasonCode: null,
          errorCode: 'model_timeout',
          httpStatus: null,
          usage: null,
          validationIssueCount: 0,
        });
        return Object.freeze({
          ok: false,
          kind: 'aborted',
          attemptStatus: 'timeout',
          errorCode: 'model_timeout',
          reasonCode: null,
          status: null,
          stopReason: null,
          gatewayRetryable: false,
          detail: 'request aborted before attempt start',
          usage: null,
          totalUsage,
          requestId: null,
          messageId: null,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          provenance: resolvedTransport.provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      const elapsedBeforeAttempt = Math.max(
        now() - callStart,
        Date.now() - wallStart,
      );
      const remainingBudgetMs = totalBudgetMs - elapsedBeforeAttempt;
      if (remainingBudgetMs <= 0 || callDeadline.aborted) {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          effort,
          provenance: resolvedTransport.provenance,
          requestId: null,
          messageId: null,
          durationMs: 0,
          stopReason: null,
          outcomeKind: 'error',
          attemptStatus: 'timeout',
          reasonCode: null,
          errorCode: 'model_timeout',
          httpStatus: null,
          usage: null,
          validationIssueCount: 0,
        });
        return Object.freeze({
          ok: false,
          kind: 'error',
          attemptStatus: 'timeout',
          errorCode: 'model_timeout',
          reasonCode: null,
          status: null,
          stopReason: null,
          gatewayRetryable: false,
          detail: `total call budget (${totalBudgetMs}ms) exhausted`,
          usage: null,
          totalUsage,
          requestId: null,
          messageId: null,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          provenance: resolvedTransport.provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      // Bound EVERY attempt (including attempt 1) by `remainingBudgetMs`
      // (resolves `model-call-r02`).
      const attemptTimeoutMs = Math.min(timeoutMs, remainingBudgetMs);

      let attemptSignal: AbortSignal | undefined;
      const attemptResources: { dispose(): void }[] = [];
      let transportResponse: TransportResponse;
      let usage: UsageRecord;
      try {
        const timeout = abortAfter(Math.ceil(attemptTimeoutMs));
        attemptResources.push(timeout);
        const combined = anySignal([callSignal, timeout.signal]);
        attemptResources.push(combined);
        attemptSignal = combined.signal;
        transportResponse = await withDeadline(
          resolvedTransport.send(body, {
            timeoutMs: attemptTimeoutMs,
            signal: attemptSignal,
          }),
          attemptTimeoutMs,
          attemptSignal,
        );
        usage = toUsageRecord(
          transportResponse.message.model ?? model,
          transportResponse.message.usage,
          prices,
          model,
        );
        totalUsage = addUsageRecords(totalUsage, usage);
      } catch (err) {
        // Check `params.signal?.aborted` first so an external abort always maps to
        // `aborted` even if the transport threw a generic Error (resolves r07).
        const classified: ClassifiedError = params.signal?.aborted
          ? Object.freeze({
              kind: 'aborted',
              errorCode: 'model_timeout',
              reasonCode: null,
              status: null,
              gatewayRetryable: false,
              retryAfterMs: null,
              requestId: extractErrorRequestId(err),
              detail: 'request aborted by caller signal',
            })
          : classifyError(
              attemptSignal?.aborted ||
                Math.max(now() - callStart, Date.now() - wallStart) >=
                  totalBudgetMs
                ? new GatewayTimeoutError()
                : err,
            );

        const attemptDuration = Math.max(0, now() - attemptStart);
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          effort,
          provenance: resolvedTransport.provenance,
          requestId: classified.requestId,
          messageId: null,
          durationMs: attemptDuration,
          stopReason: null,
          outcomeKind: classified.kind,
          attemptStatus:
            classified.errorCode === 'model_timeout' ? 'timeout' : 'error',
          reasonCode: classified.reasonCode,
          errorCode: classified.errorCode,
          httpStatus: classified.status,
          usage: null,
          validationIssueCount: 0,
        });

        if (classified.kind === 'aborted') {
          return Object.freeze({
            ok: false,
            kind: 'aborted',
            attemptStatus: 'timeout',
            errorCode: 'model_timeout',
            reasonCode: null,
            status: null,
            stopReason: null,
            gatewayRetryable: false,
            detail: classified.detail,
            usage: null,
            totalUsage,
            requestId: classified.requestId,
            messageId: null,
            responseModel: null,
            stopCategory: null,
            servedModel: null,
            provenance: resolvedTransport.provenance,
            attempts: attemptLogs.length,
            durationMs: Math.max(0, now() - callStart),
            attemptLogs: Object.freeze([...attemptLogs]),
          });
        }

        const canRetry =
          classified.gatewayRetryable && transportRetries < maxRetries;
        if (canRetry) {
          transportRetries++;
          const delayMs = computeBackoffMs(
            attemptIdx,
            retryBaseDelayMs,
            maxRetryDelayMs,
            classified.retryAfterMs,
            random,
          );
          const remainingAfterAttempt = totalBudgetMs - (now() - callStart);
          if (delayMs < remainingAfterAttempt) {
            try {
              await withDeadline(
                sleep(delayMs, callSignal),
                Math.max(1, remainingAfterAttempt),
                callSignal,
              );
              continue;
            } catch {
              const callerAborted = params.signal?.aborted === true;
              return Object.freeze({
                ok: false,
                ...(callerAborted
                  ? {
                      kind: 'aborted' as const,
                      errorCode: 'model_timeout' as const,
                    }
                  : {
                      kind: 'error' as const,
                      errorCode: 'model_timeout' as const,
                    }),
                attemptStatus: 'timeout',
                reasonCode: null,
                status: null,
                stopReason: null,
                gatewayRetryable: false,
                detail: callerAborted
                  ? 'request aborted during retry backoff'
                  : 'total call budget exhausted during retry backoff',
                usage: null,
                totalUsage,
                requestId: classified.requestId,
                messageId: null,
                responseModel: null,
                stopCategory: null,
                servedModel: null,
                provenance: resolvedTransport.provenance,
                attempts: attemptLogs.length,
                durationMs: Math.max(0, now() - callStart),
                attemptLogs: Object.freeze([...attemptLogs]),
              });
            }
          }
        }

        return Object.freeze({
          ok: false,
          kind: 'error',
          attemptStatus:
            classified.errorCode === 'model_timeout' ? 'timeout' : 'error',
          errorCode: classified.errorCode,
          reasonCode: classified.reasonCode,
          status: classified.status,
          stopReason: null,
          gatewayRetryable: false,
          detail: classified.detail,
          usage: null,
          totalUsage,
          requestId: classified.requestId,
          messageId: null,
          responseModel: null,
          stopCategory: null,
          servedModel: null,
          provenance: resolvedTransport.provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      } finally {
        for (const resource of attemptResources) resource.dispose();
      }

      // -----------------------------------------------------------------------
      // Canon D09 Step 1: Record `usage`, `stop_reason`, and `requestId` BEFORE
      // any branching, JSON parsing, or validation.
      // -----------------------------------------------------------------------
      const { message, provenance } = transportResponse;
      const requestId =
        transportResponse.requestId ?? message._request_id ?? null;
      const messageId = message.id;
      const servedModel = message.model ?? model;
      const stopReason = message.stop_reason;
      const attemptDuration = Math.max(0, now() - attemptStart);

      // -----------------------------------------------------------------------
      // Canon D09 Step 2: Branch on `stop_reason` BEFORE `JSON.parse`.
      // -----------------------------------------------------------------------
      if (stopReason === 'refusal') {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'refused',
          attemptStatus: 'refused',
          reasonCode: 'output.refusal',
          errorCode: null,
          httpStatus: 200,
          usage,
          validationIssueCount: 0,
        });
        return Object.freeze({
          ok: false,
          kind: 'refused',
          attemptStatus: 'refused',
          reasonCode: 'output.refusal',
          stopReason: 'refusal',
          gatewayRetryable: false,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      if (stopReason === 'max_tokens') {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'output.truncated',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.truncated',
          errorCode: null,
          httpStatus: 200,
          usage,
          validationIssueCount: 0,
        });
        if (params.purpose !== 'schema_warm' && truncationRetries++ === 0) continue;
        return Object.freeze({
          ok: false,
          kind: 'output.truncated',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.truncated',
          stopReason: 'max_tokens',
          gatewayRetryable: false,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      if (stopReason === 'model_context_window_exceeded') {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'error',
          attemptStatus: 'error',
          reasonCode: null,
          errorCode: 'context_overflow',
          httpStatus: 200,
          usage,
          validationIssueCount: 0,
        });
        return Object.freeze({
          ok: false,
          kind: 'error',
          attemptStatus: 'error',
          errorCode: 'context_overflow',
          reasonCode: null,
          status: 200,
          stopReason: 'model_context_window_exceeded',
          gatewayRetryable: false,
          detail: 'stop_reason=model_context_window_exceeded',
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      if (stopReason !== 'end_turn') {
        const safeStop =
          typeof stopReason === 'string' &&
          SAFE_ERROR_TYPE_TOKEN_RE.test(stopReason)
            ? stopReason
            : 'null';
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'error',
          attemptStatus: 'error',
          reasonCode: null,
          errorCode: 'unexpected_stop',
          httpStatus: 200,
          usage,
          validationIssueCount: 0,
        });
        return Object.freeze({
          ok: false,
          kind: 'error',
          attemptStatus: 'error',
          errorCode: 'unexpected_stop',
          reasonCode: null,
          status: 200,
          stopReason,
          gatewayRetryable: false,
          detail: `unexpected stop_reason=${safeStop}`,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      // -----------------------------------------------------------------------
      // Canon D09 Step 3: `stop_reason === 'end_turn'` -> extract text block,
      // `JSON.parse`, and run caller-supplied `validate(obj)`.
      // -----------------------------------------------------------------------
      const textBlock = message.content.find(
        (b): b is { readonly type: 'text'; readonly text: string } =>
          b.type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      );

      if (!textBlock) {
        const issues: readonly ValidationIssue[] = Object.freeze([
          Object.freeze({ path: '<root>', code: 'missing_text_block' }),
        ]);
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'output.not_json',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.not_json',
          errorCode: null,
          httpStatus: 200,
          usage,
          validationIssueCount: 1,
        });
        return Object.freeze({
          ok: false,
          kind: 'output.not_json',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.not_json',
          stopReason: 'end_turn',
          gatewayRetryable: false,
          issues,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(textBlock.text);
      } catch {
        const issues: readonly ValidationIssue[] = Object.freeze([
          Object.freeze({ path: '<root>', code: 'invalid_json' }),
        ]);
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'output.not_json',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.not_json',
          errorCode: null,
          httpStatus: 200,
          usage,
          validationIssueCount: 1,
        });
        return Object.freeze({
          ok: false,
          kind: 'output.not_json',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.not_json',
          stopReason: 'end_turn',
          gatewayRetryable: false,
          issues,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      const validation = runCallerValidator(
        params.validate,
        parsedJson,
        allowedIssuePaths,
      );

      if (!validation.ok) {
        recordTelemetry({
          attempt: attemptNumber,
          model,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          effort,
          provenance,
          requestId,
          messageId,
          durationMs: attemptDuration,
          stopReason,
          outcomeKind: 'output.schema_violation',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.schema_violation',
          errorCode: null,
          httpStatus: 200,
          usage,
          validationIssueCount: validation.issues.length,
        });
        return Object.freeze({
          ok: false,
          kind: 'output.schema_violation',
          attemptStatus: 'invalid_output',
          reasonCode: 'output.schema_violation',
          stopReason: 'end_turn',
          gatewayRetryable: false,
          issues: validation.issues,
          usage,
          totalUsage,
          requestId,
          messageId,
          responseModel: message.model ?? null,
          stopCategory: message.stop_details?.category ?? null,
          servedModel,
          provenance,
          attempts: attemptLogs.length,
          durationMs: Math.max(0, now() - callStart),
          attemptLogs: Object.freeze([...attemptLogs]),
        });
      }

      recordTelemetry({
        attempt: attemptNumber,
        model,
        responseModel: message.model ?? null,
        stopCategory: message.stop_details?.category ?? null,
        servedModel,
        effort,
        provenance,
        requestId,
        messageId,
        durationMs: attemptDuration,
        stopReason,
        outcomeKind: 'ok',
        attemptStatus: 'completed',
        reasonCode: null,
        errorCode: null,
        httpStatus: 200,
        usage,
        validationIssueCount: 0,
      });

      return Object.freeze({
        ok: true,
        kind: 'ok',
        attemptStatus: 'completed',
        data: validation.data,
        value: validation.data,
        stopReason: 'end_turn' as const,
        usage,
        totalUsage,
        requestId,
        messageId,
        model,
        responseModel: message.model ?? null,
        stopCategory: message.stop_details?.category ?? null,
        servedModel,
        provenance,
        attempts: attemptLogs.length,
        durationMs: Math.max(0, now() - callStart),
        attemptLogs: Object.freeze([...attemptLogs]),
      });
    }

    /* c8 ignore next */
    throw new GatewayConfigError('Unreachable retry loop exit');
  } finally {
    for (const resource of resources) resource.dispose();
  }
}

export function toAttemptOutcome<T>(result: ModelCallResult<T>): {
  status: AttemptStatus;
  errorCode: AttemptErrorCode | null;
} {
  const errorCode = 'errorCode' in result ? result.errorCode : null;
  return {
    status: errorCode === 'model_timeout' ? 'timeout' : result.attemptStatus,
    errorCode,
  };
}

async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('Model timeout'), {
                name: 'TimeoutError',
              }),
            ),
          ms,
        );
        abort = () => reject(new GatewayAbortError());
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export function abortAfter(ms: number): {
  signal: AbortSignal;
  dispose(): void;
} {
  if (typeof AbortSignal.timeout === 'function')
    return { signal: AbortSignal.timeout(ms), dispose() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    },
  };
}
export function anySignal(signals: readonly AbortSignal[]): {
  signal: AbortSignal;
  dispose(): void;
} {
  if (typeof AbortSignal.any === 'function')
    return { signal: AbortSignal.any([...signals]), dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const signal of signals) signal.removeEventListener('abort', abort);
    },
  };
}

// --- W2-5 START ---
export interface BuildNegotiationRequestInput {
  readonly system: readonly TextBlockParam[];
  readonly user: readonly TextBlockParam[];
  readonly turnInstruction: string;
  readonly schema: JsonSchemaObject;
  readonly enableFallbacks?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Build the canonical negotiation request body (10 §10.14.1, Canon D09).
 * Uses the `[user, system]` message array where `messages[0]` holds the
 * cached room/history/turn user blocks and `messages[1]` holds the role="system"
 * `turnInstruction` channel.
 */
export function buildNegotiationRequest(
  p: BuildNegotiationRequestInput,
): WhitelistedRequestBody {
  return buildRequest({
    model: NEGOTIATION_MODEL,
    maxTokens: MAX_TOKENS,
    effort: NEGOTIATION_EFFORT,
    system: p.system,
    messages: [
      { role: 'user', content: p.user },
      { role: 'system', content: p.turnInstruction },
    ],
    schema: p.schema,
    ...(p.enableFallbacks !== undefined
      ? { enableFallbacks: p.enableFallbacks }
      : {}),
    ...(p.env !== undefined ? { env: p.env } : {}),
  });
}

/**
 * Construct a live `ModelTransport` inside `modelGateway.ts` with `sdkMaxRetries: 0`
 * (Canon D09, TC-OPS-05: live client construction lives exclusively in the gateway module).
 */
export function createLiveTransport(options?: {
  readonly apiKey?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseURL?: string;
}): ModelTransport {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new GatewayConfigError(
      'Missing ANTHROPIC_API_KEY for live model transport',
    );
  }
  const client = createFetchStreamClient({
    fetch: options?.fetch ?? globalThis.fetch,
    apiKey,
    ...(options?.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
  });
  return anthropicTransport(client, { sdkMaxRetries: SDK_MAX_RETRIES });
}
// --- W2-5 END ---

/** Operations retrieval shares the gateway-owned client and error classifier. */
export async function retrieveConfiguredModel(model: string, apiKey?: string): Promise<void> {
  if (!apiKey?.trim()) throw new GatewayAPIError(401, null, 'Missing key');
  const client = createFetchStreamClient({ fetch: globalThis.fetch, apiKey });
  await client.models!.retrieve(model);
}
/** Explicit operations seam; negotiation transports still require 16000 tokens. */
export function createSchemaWarmTransport(): ModelTransport {
  const client = createFetchStreamClient({ fetch: globalThis.fetch, apiKey: process.env.ANTHROPIC_API_KEY, purpose: 'schema_warm' });
  return anthropicTransport(client, { purpose: 'schema_warm' });
}
