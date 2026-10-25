import type { ModelResponse } from '../runtimeValidators';
/** Design 15 §15.7 estimate table; updating prices never rewrites attempts. */
export const PRICE_TABLE = { asOf: '2026-10-06', models: { 'claude-opus-5-5': { inputMicroUsdPerMTok: 4_000_000, outputMicroUsdPerMTok: 20_000_000, cacheReadMicroUsdPerMTok: 200_000, cacheWrite5mMicroUsdPerMTok: 5_000_000 } } } as const;
export function estimateCostMicroUsd(usage: ModelResponse['usage'], model: string) {
  if (model !== 'claude-opus-5-5') return null;
  const p = PRICE_TABLE.models[model];
  return { microUsd: Math.ceil((usage.inputTokens * p.inputMicroUsdPerMTok + usage.outputTokens * p.outputMicroUsdPerMTok + usage.cacheCreationInputTokens * p.cacheWrite5mMicroUsdPerMTok + usage.cacheReadInputTokens * p.cacheReadMicroUsdPerMTok) / 1_000_000), asOf: PRICE_TABLE.asOf, estimate: true as const };
}
