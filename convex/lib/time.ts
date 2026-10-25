import type { ActionCtx, MutationCtx } from '../_generated/server';

/** Queries must use stored room.localDate, never a wall clock. */
export function nowMs(_ctx: MutationCtx | ActionCtx): number {
  void _ctx;
  return Date.now();
}

/** D22 fallback covers the shipped fixture zone and UTC used by rooms/tests.
 * Other IANA zones remain supported through Intl; fail closed without ICU.
 * LA uses US rules since 2007; historical dates require Intl (no guessed offset).
 */
const OFFSETS = { UTC: 0, 'America/Los_Angeles': -480 } as const;
export function intlDate(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => {
    const part = parts.find(part => part.type === type);
    if (!part) throw new TypeError('Missing date part');
    return part.value;
  };
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function offsetDate(now: number, timeZone: string): string {
  if (!Object.hasOwn(OFFSETS, timeZone)) throw new RangeError('Unsupported fallback time zone');
  let minutes: number = OFFSETS[timeZone as keyof typeof OFFSETS];
  if (timeZone === 'America/Los_Angeles') {
    const year = new Date(now).getUTCFullYear();
    if (year < 2007) throw new RangeError('Historical time zone requires Intl');
    // Second Sunday March at 02:00 PST; first Sunday November at 02:00 PDT.
    const sunday = (month: number) => 1 + (7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7;
    const start = Date.UTC(year, 2, sunday(2) + 7, 10);
    const end = Date.UTC(year, 10, sunday(10), 9);
    if (now >= start && now < end) minutes += 60;
  }
  return new Date(now + minutes * 60_000).toISOString().slice(0, 10);
}
export function timeZoneMode(): 'intl' | 'offset' {
  try { intlDate(0, 'America/Los_Angeles'); return 'intl'; }
  catch { return 'offset'; }
}
export function todayInTimeZone(now: number, timeZone: string): string {
  try { return intlDate(now, timeZone); }
  catch { return offsetDate(now, timeZone); }
}

export function rawOutputRetentionMs(tier: string): number { return (tier === "prod" ? 7 : 30) * 86400000; }
