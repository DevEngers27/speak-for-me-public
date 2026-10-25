import type { Doc } from '../../_generated/dataModel';
import { appError } from '../../lib/errors';

export type ConstraintBucket = 'price_writes' | 'hard_fields';
const DAY_MS = 86_400_000;
type CommandEvent = Pick<Doc<'events'>, '_creationTime' | 'commitTs' | 'payload'>;

/** The caller supplies this room's committed events from the indexed 24h window.
 * Count transactions, never individual events (raise_cap emits two commands).
 * Run before any write; unchanged and setup paths must bypass these open buckets.
 */
export function assertOpenWriteBucket(
  status: Doc<'rooms'>['status'], bucket: ConstraintBucket,
  events: readonly CommandEvent[], now: number,
): void {
  if (status !== 'open') return;
  const commits = new Map<CommandEvent['commitTs'], number>();
  for (const event of events) {
    if (event._creationTime <= now - DAY_MS) continue;
    const p = event.payload;
    const matches = bucket === 'price_writes'
      ? p.type === 'catalog_item_retired' || (p.type === 'catalog_item_confirmed' && p.priceChanged)
      : p.type === 'brief_confirmed' && p.hardChanged;
    if (matches) commits.set(event.commitTs, Math.min(commits.get(event.commitTs) ?? Infinity, event._creationTime));
  }
  const limit = bucket === 'price_writes' ? 3 : 6;
  if (commits.size >= limit) {
    // When over limit, enough oldest commits must expire to leave limit - 1.
    const times = [...commits.values()].sort((a, b) => a - b);
    throw appError('run.rate_limited', { retryAfterMs: Math.ceil(times[times.length - limit]! + DAY_MS - now) });
  }
}

/** Current pricing revision's confirmedAt, not the most recent title edit time.
 * A first confirmation is not a reprice; callers pass only existing changed prices.
 */
export function assertItemRepriceWithinRun(
  status: Doc<'rooms'>['status'], runStartedAt: number | undefined,
  previousPricingConfirmedAt: number | undefined, now: number,
): void {
  if (status === 'open' && runStartedAt !== undefined && previousPricingConfirmedAt !== undefined && previousPricingConfirmedAt >= runStartedAt) {
    throw appError('run.rate_limited', { retryAfterMs: Math.max(1, runStartedAt + DAY_MS - now) });
  }
}

export function assertCapAboveCommitted(capCents: number, committedCents: number): void {
  if (capCents < committedCents) throw appError('budget.below_committed', { minAllowedCapCents: committedCents });
}
export function assertBaselineSetup(status: Doc<'rooms'>['status']): void {
  if (status !== 'setup') throw appError('run.invalid_state', { guard: 'room_status' });
}
