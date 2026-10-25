// Pure helpers for integer cents and calendar dates. No zod dependency so the
// rules engine stays a plain-TS module usable from Convex queries/mutations.

/** Integer cents: safe, non-negative integer. */
export function isCents(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** Sum cents; returns null if any operand is invalid or the sum leaves the safe range. */
export function sumCents(values: readonly number[]): number | null {
  let total = 0;
  for (const v of values) {
    if (!isCents(v)) return null;
    total += v;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strict calendar date "YYYY-MM-DD" (UTC calendar, no time, no timezone).
 * Rejects 2026-02-30, 2026-13-01, 2026-1-05, 2026/01/05, "" etc.
 */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Lexicographic comparison is correct for validated YYYY-MM-DD strings. */
export function compareIsoDate(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxIsoDate(dates: readonly string[]): string | null {
  let best: string | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

/** Stable JSON: object keys sorted recursively; arrays keep order (callers normalize). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** SHA-256 over stable JSON via Web Crypto (available in Node 24; Convex runtime: to verify). */
export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return (
    "sha256:" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
