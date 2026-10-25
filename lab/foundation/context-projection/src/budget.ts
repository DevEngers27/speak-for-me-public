/**
 * Approximate token budgeting for assembled context.
 *
 * The estimator is deliberately conservative (it over-counts for typical
 * English) so a trimmed context stays under the real limit. It is NOT a
 * tokenizer: calibrate the constants against `usage.input_tokens` or the
 * token-counting endpoint once real traffic exists.
 *
 * The trimmer drops whole blocks, lowest priority first, until the estimate
 * fits. It never reorders blocks and never splits one.
 */

export interface TokenEstimatorOptions {
  /** ASCII characters per token. Lower = more conservative. Default 3. */
  readonly asciiCharsPerToken?: number;
  /** Tokens charged per non-ASCII code point (CJK, emoji, accents). Default 1. */
  readonly nonAsciiTokensPerChar?: number;
}

export const DEFAULT_ASCII_CHARS_PER_TOKEN = 3;
export const DEFAULT_NON_ASCII_TOKENS_PER_CHAR = 1;

/** Approximate token count of `text`. Always an integer >= 0; empty text is 0. */
export function estimateTokens(text: string, options: TokenEstimatorOptions = {}): number {
  const asciiPerToken = options.asciiCharsPerToken ?? DEFAULT_ASCII_CHARS_PER_TOKEN;
  const nonAsciiPerChar = options.nonAsciiTokensPerChar ?? DEFAULT_NON_ASCII_TOKENS_PER_CHAR;
  if (!(asciiPerToken > 0) || !Number.isFinite(asciiPerToken)) {
    throw new RangeError('estimateTokens: asciiCharsPerToken must be a positive finite number');
  }
  if (!(nonAsciiPerChar >= 0) || !Number.isFinite(nonAsciiPerChar)) {
    throw new RangeError('estimateTokens: nonAsciiTokensPerChar must be a non-negative finite number');
  }
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / asciiPerToken + nonAscii * nonAsciiPerChar);
}

export interface ContextBlock {
  /** Unique within one trim call. */
  readonly id: string;
  readonly text: string;
  /** Higher survives longer. Finite number; ties drop the later block first. */
  readonly priority: number;
  /** Required blocks are never dropped. */
  readonly required?: boolean;
}

export interface TrimOptions {
  /** Maximum estimated tokens for all kept blocks together. */
  readonly budgetTokens: number;
  /** Fixed overhead charged per kept block (separators, wrappers). Default 0. */
  readonly perBlockOverheadTokens?: number;
  /** Custom estimator; defaults to `estimateTokens` with default constants. */
  readonly estimate?: (text: string) => number;
}

interface TrimStats<B extends ContextBlock> {
  /** Kept blocks in their original order. */
  readonly kept: readonly B[];
  /** Dropped blocks in the order they were dropped. */
  readonly dropped: readonly B[];
  /** Estimated tokens of the kept blocks, overhead included. */
  readonly usedTokens: number;
  readonly budgetTokens: number;
  /** Estimated cost per block id, overhead included. */
  readonly costById: ReadonlyMap<string, number>;
}

export type TrimResult<B extends ContextBlock> =
  | (TrimStats<B> & { readonly ok: true })
  | (TrimStats<B> & { readonly ok: false; readonly reason: 'REQUIRED_BLOCKS_EXCEED_BUDGET' });

/**
 * Drops the lowest-priority non-required blocks until the estimate fits.
 *
 * Invariant (when ok): every kept non-required block has priority >= every
 * dropped block's priority. When the required blocks alone exceed the budget,
 * returns `ok: false` with only the required blocks kept, so the caller can
 * fail the turn explicitly instead of sending an over-long prompt.
 */
export function trimToBudget<B extends ContextBlock>(blocks: readonly B[], options: TrimOptions): TrimResult<B> {
  const { budgetTokens } = options;
  const overhead = options.perBlockOverheadTokens ?? 0;
  const estimate = options.estimate ?? ((text: string) => estimateTokens(text));
  if (!Number.isFinite(budgetTokens) || budgetTokens < 0) {
    throw new RangeError('trimToBudget: budgetTokens must be a non-negative finite number');
  }
  if (!Number.isFinite(overhead) || overhead < 0) {
    throw new RangeError('trimToBudget: perBlockOverheadTokens must be a non-negative finite number');
  }

  const costById = new Map<string, number>();
  const costs: number[] = [];
  for (const block of blocks) {
    if (typeof block.id !== 'string' || block.id.length === 0) throw new TypeError('trimToBudget: block id must be a non-empty string');
    if (costById.has(block.id)) throw new TypeError(`trimToBudget: duplicate block id "${block.id}"`);
    if (!Number.isFinite(block.priority)) throw new RangeError(`trimToBudget: block "${block.id}" priority must be finite`);
    const raw = estimate(block.text);
    if (!Number.isFinite(raw) || raw < 0) throw new RangeError(`trimToBudget: estimate for "${block.id}" must be >= 0`);
    const cost = raw + overhead;
    costById.set(block.id, cost);
    costs.push(cost);
  }

  let total = costs.reduce((a, b) => a + b, 0);
  if (total <= budgetTokens) {
    return { ok: true, kept: [...blocks], dropped: [], usedTokens: total, budgetTokens, costById };
  }

  const droppable = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.required !== true)
    .sort((a, b) => a.block.priority - b.block.priority || b.index - a.index);

  const requiredTotal = blocks.reduce((sum, block, i) => (block.required === true ? sum + (costs[i] ?? 0) : sum), 0);
  if (requiredTotal > budgetTokens) {
    return {
      ok: false,
      reason: 'REQUIRED_BLOCKS_EXCEED_BUDGET',
      kept: blocks.filter((b) => b.required === true),
      dropped: droppable.map(({ block }) => block),
      usedTokens: requiredTotal,
      budgetTokens,
      costById,
    };
  }

  const droppedIndexes = new Set<number>();
  const dropped: B[] = [];
  for (const { block, index } of droppable) {
    if (total <= budgetTokens) break;
    droppedIndexes.add(index);
    dropped.push(block);
    total -= costs[index] ?? 0;
  }
  const kept = blocks.filter((_, i) => !droppedIndexes.has(i));
  return { ok: true, kept, dropped, usedTokens: total, budgetTokens, costById };
}
