// Usage capture and a list-price cost estimate. Pure functions.
import type Anthropic from "@anthropic-ai/sdk";
import type { UsageRecord } from "./types.ts";

export function toUsageRecord(usage: Anthropic.Usage, latencyMs: number): UsageRecord {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  // When the per-TTL breakdown is missing, attribute writes to the 5m default.
  const write5m = usage.cache_creation ? usage.cache_creation.ephemeral_5m_input_tokens : cacheCreation;
  const write1h = usage.cache_creation ? usage.cache_creation.ephemeral_1h_input_tokens : 0;
  return {
    inputTokens: usage.input_tokens,
    cacheCreationInputTokens: cacheCreation,
    cacheReadInputTokens: cacheRead,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    totalPromptTokens: usage.input_tokens + cacheCreation + cacheRead,
    outputTokens: usage.output_tokens,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    latencyMs,
  };
}

/** USD per million tokens, equivalently micro-USD per token. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

/**
 * Anthropic first-party list prices (claude-api skill, cached 2026-10-06). An estimate for
 * dashboards and budgets, not a bill. Haiku 5.5 prompts over 100K tokens use the higher tier.
 */
export const LIST_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
};
const HAIKU_LONG: ModelPrice = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 };

/** Integer micro-USD, or null when the model has no known price. */
export function estimateCostMicroUsd(
  usage: UsageRecord,
  model: string,
  prices: Readonly<Record<string, ModelPrice>> = LIST_PRICES,
): number | null {
  let price = prices[model];
  if (!price) return null;
  if (model === "claude-haiku-5-5" && prices === LIST_PRICES && usage.totalPromptTokens > 100_000) price = HAIKU_LONG;
  const cost =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadInputTokens * price.cacheRead +
    usage.cacheWrite5mTokens * price.cacheWrite5m +
    usage.cacheWrite1hTokens * price.cacheWrite1h;
  return Math.round(cost);
}
