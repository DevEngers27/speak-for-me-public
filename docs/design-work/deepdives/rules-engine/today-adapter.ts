// convex/lib/today.ts — NOT part of the pure engine. The only place that turns a clock reading into
// the engine's `today`. Called by loaders in queries/mutations. Intl timeZone support in the Convex
// default runtime is UNVERIFIED (see rules-engine-part3 §7); the fallback is a fixed UTC offset.
import type { IsoDate } from './primitives.ts';

export function todayInTimeZone(nowMs: number, timeZone: string, fallbackOffsetMinutes: number): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(nowMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year'), m = get('month'), d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through to the documented fixed-offset fallback
  }
  const shifted = new Date(nowMs + fallbackOffsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}
