import { afterEach, vi } from 'vitest';
import type { CallModelParams, ModelCallResult } from '../../convex/model/agents/modelGateway';
const state = vi.hoisted(() => ({ queue: [] as unknown[], recorded: [] as unknown[], exhausted: false }));
vi.mock('../../convex/model/agents/modelGateway', async importOriginal => ({ ...await importOriginal<typeof import('../../convex/model/agents/modelGateway')>(), callModel: async (params: unknown) => {
  state.recorded.push(params);
  if (!state.queue.length) { state.exhausted = true; throw new Error('Scripted model queue exhausted'); }
  const next = state.queue.shift();
  if (next instanceof Error) throw next;
  return typeof next === 'function' ? (next as (p: unknown) => unknown)(params) : next;
} }));
export const script = {
  recorded: state.recorded as CallModelParams<unknown>[],
  enqueue(...results: (ModelCallResult<unknown> | Error | ((params: CallModelParams<unknown>) => ModelCallResult<unknown>))[]) { state.queue.push(...results); },
  assertEmpty() { if (state.exhausted) throw new Error('Scripted model queue exhausted'); if (state.queue.length) throw new Error(`Unconsumed scripted responses: ${state.queue.length}`); },
  reset() { state.queue.length = 0; state.recorded.length = 0; state.exhausted = false; },
};
afterEach(() => { try { script.assertEmpty(); } finally { script.reset(); } });
export function scriptedSuccess(turn: unknown): Extract<ModelCallResult<unknown>,{ok:true}> {
  // A success fixture must satisfy the real schema's nonempty rationale domain.
  if(turn&&typeof turn==='object'&&'rationale' in turn&&turn.rationale==='')turn={...turn,rationale:'Scripted decision.'};
  const usage = { pricingBasis: 'response_model' as const, thinkingTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, totalPromptTokens: 0, estimatedCostMicroUsd: 0 };
  return { ok: true, kind: 'ok', attemptStatus: 'completed', data: { turn }, value: { turn }, stopReason: 'end_turn', stopCategory: null, responseModel: 'claude-opus-5-5', usage, totalUsage: usage, requestId: 'script', messageId: 'script', model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', provenance: 'live', attempts: 1, durationMs: 0, attemptLogs: [] };
}
