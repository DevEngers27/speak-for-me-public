// Integer-cent money utilities.
//
// Every amount is a JavaScript number holding an integer count of cents inside
// Number.isSafeInteger range, so it is exact, JSON-safe, and fits Convex
// `v.number()` without a bigint. Floats never enter the arithmetic: parsing is
// done on the digit string, and scaling/allocation use bigint internally.
//
// Error messages never echo the offending value. Amounts can be private (for
// example a finance-only budget) and errors tend to end up in logs or in
// another party's response; callers that need the value already have it.

declare const signedCentsBrand: unique symbol;
declare const nonNegativeBrand: unique symbol;

/** Any integer number of cents (may be negative), e.g. a signed headroom. */
export type SignedCents = number & { readonly [signedCentsBrand]: true };

/** A non-negative integer number of cents. Assignable to SignedCents. */
export type Cents = SignedCents & { readonly [nonNegativeBrand]: true };

export type MoneyErrorCode =
  | "NOT_SAFE_INTEGER"
  | "NEGATIVE"
  | "OUT_OF_RANGE"
  | "NEGATIVE_RESULT"
  | "INVALID_ARGUMENT"
  | ParseCentsErrorCode;

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/** Absolute ceiling for any Cents value. Callers may pass a lower `max`. */
export const MAX_CENTS = Number.MAX_SAFE_INTEGER as Cents;
export const ZERO_CENTS = 0 as Cents;

export interface CentsLimit {
  /** Inclusive upper bound; defaults to MAX_CENTS. Must itself be valid Cents. */
  readonly max?: number;
}

function resolveMax(limit: CentsLimit | undefined): number {
  const max = limit?.max ?? MAX_CENTS;
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new MoneyError("INVALID_ARGUMENT", "max must be a non-negative safe integer");
  }
  return max;
}

// -0 is a safe integer but would format as "-$0"; normalize it away.
const normalize = (n: number): number => (n === 0 ? 0 : n);

// ---------------------------------------------------------------------------
// Guards and constructors

export function isSignedCents(value: unknown): value is SignedCents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function isCents(value: unknown, limit?: CentsLimit): value is Cents {
  return isSignedCents(value) && value >= 0 && value <= resolveMax(limit);
}

/** Throws MoneyError unless `value` is a non-negative safe integer <= max. */
export function assertCents(value: unknown, limit?: CentsLimit): asserts value is Cents {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MoneyError("NOT_SAFE_INTEGER", "amount must be an integer number of cents");
  }
  if (value < 0) throw new MoneyError("NEGATIVE", "amount must not be negative");
  if (value > resolveMax(limit)) {
    throw new MoneyError("OUT_OF_RANGE", "amount exceeds the allowed maximum");
  }
}

/** Validating constructor for Cents. */
export function cents(value: number, limit?: CentsLimit): Cents {
  assertCents(value, limit);
  return normalize(value) as Cents;
}

/** Validating constructor for SignedCents. */
export function signedCents(value: number): SignedCents {
  if (!isSignedCents(value)) {
    throw new MoneyError("NOT_SAFE_INTEGER", "amount must be an integer number of cents");
  }
  return normalize(value) as SignedCents;
}

function checkedSigned(n: number): SignedCents {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError("OUT_OF_RANGE", "result is outside the safe integer range");
  }
  return normalize(n) as SignedCents;
}

function checkedCents(n: number): Cents {
  const s = checkedSigned(n);
  if (s < 0) throw new MoneyError("NEGATIVE_RESULT", "result would be negative");
  return s as Cents;
}

// ---------------------------------------------------------------------------
// Arithmetic and comparison

export function addCents(a: Cents, b: Cents): Cents {
  return checkedCents(a + b);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total = checkedCents(total + v);
  }
  return total as Cents;
}

/** a - b; throws NEGATIVE_RESULT when b > a. Use differenceCents for signed. */
export function subtractCents(a: Cents, b: Cents): Cents {
  return checkedCents(a - b);
}

/** a - b as a signed amount (for headroom / shortfall style values). */
export function differenceCents(a: SignedCents, b: SignedCents): SignedCents {
  return checkedSigned(a - b);
}

export function absCents(value: SignedCents): Cents {
  return checkedCents(Math.abs(value));
}

/** Narrow a SignedCents to Cents; throws NEGATIVE when it is below zero. */
export function toCents(value: SignedCents): Cents {
  return cents(value);
}

export function compareCents(a: SignedCents, b: SignedCents): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minCents<T extends SignedCents>(first: T, ...rest: readonly T[]): T {
  return rest.reduce((m, v) => (v < m ? v : m), first);
}

export function maxCents<T extends SignedCents>(first: T, ...rest: readonly T[]): T {
  return rest.reduce((m, v) => (v > m ? v : m), first);
}

function assertNonNegativeInt(n: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new MoneyError("INVALID_ARGUMENT", `${name} must be a non-negative safe integer`);
  }
}

/** unit * quantity, e.g. a per-unit price times an integer quantity. */
export function multiplyCents(unit: Cents, quantity: number): Cents {
  assertNonNegativeInt(quantity, "quantity");
  const product = BigInt(unit) * BigInt(quantity);
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError("OUT_OF_RANGE", "result is outside the safe integer range");
  }
  return Number(product) as Cents;
}

export type RoundingMode = "floor" | "ceil" | "half-up" | "half-even";

function divideRounded(num: bigint, den: bigint, mode: RoundingMode): bigint {
  // num >= 0, den > 0 (enforced by callers).
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  switch (mode) {
    case "floor":
      return q;
    case "ceil":
      return q + 1n;
    case "half-up":
      return 2n * r >= den ? q + 1n : q;
    case "half-even": {
      const twice = 2n * r;
      if (twice > den) return q + 1n;
      if (twice < den) return q;
      return q % 2n === 0n ? q : q + 1n;
    }
  }
}

/**
 * amount * numerator / denominator with an explicit rounding mode, computed
 * exactly. Use for ratios such as basis points (numerator=bps, denominator=10000).
 * The rounding policy is the caller's business decision, hence no default.
 */
export function scaleCents(
  amount: Cents,
  numerator: number,
  denominator: number,
  rounding: RoundingMode,
): Cents {
  assertNonNegativeInt(numerator, "numerator");
  assertNonNegativeInt(denominator, "denominator");
  if (denominator === 0) throw new MoneyError("INVALID_ARGUMENT", "denominator must be positive");
  const result = divideRounded(BigInt(amount) * BigInt(numerator), BigInt(denominator), rounding);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError("OUT_OF_RANGE", "result is outside the safe integer range");
  }
  return Number(result) as Cents;
}

/**
 * Split `total` into parts proportional to integer `weights` with no cent lost
 * or invented (largest-remainder method). Leftover cents go to the parts with
 * the largest remainders; ties go to the lower index, so the result is
 * deterministic. A zero weight always receives zero.
 */
export function allocateCents(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new MoneyError("INVALID_ARGUMENT", "weights must not be empty");
  let weightSum = 0n;
  for (const w of weights) {
    assertNonNegativeInt(w, "weight");
    weightSum += BigInt(w);
  }
  if (weightSum === 0n) throw new MoneyError("INVALID_ARGUMENT", "at least one weight must be positive");

  const t = BigInt(total);
  const parts = weights.map((w, index) => {
    const exact = t * BigInt(w);
    return { index, share: exact / weightSum, remainder: exact % weightSum };
  });
  let leftover = t - parts.reduce((acc, p) => acc + p.share, 0n);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const p of order) {
    if (leftover === 0n) break;
    p.share += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => Number(p.share) as Cents);
}

/** Split `total` into `count` parts differing by at most one cent; earlier parts get the extra cents. */
export function splitCentsEvenly(total: Cents, count: number): Cents[] {
  assertNonNegativeInt(count, "count");
  if (count === 0) throw new MoneyError("INVALID_ARGUMENT", "count must be positive");
  return allocateCents(total, new Array<number>(count).fill(1));
}

// ---------------------------------------------------------------------------
// Parsing user input

export type ParseCentsErrorCode = "EMPTY" | "NEGATIVE" | "INVALID_FORMAT" | "TOO_MANY_DECIMALS" | "OUT_OF_RANGE";

export type ParseCentsResult =
  | { readonly ok: true; readonly value: Cents }
  | { readonly ok: false; readonly error: ParseCentsErrorCode };

const MAX_INPUT_LENGTH = 64;
// Optional "$", optional space, US-style integer part (plain digits, or
// correctly grouped thousands with no leading zero group), optional fraction.
const AMOUNT_RE = /^\$?\s*([1-9]\d{0,2}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/;
const NEGATIVE_RE = /^(?:\$?\s*[-−]|\(.*\)$)/;

/**
 * Parse a user-typed US dollar amount into Cents without floating point.
 * Accepts "$4,800", "4800", "4800.50", "4,800.5", "$ 0.99", ".99".
 * Rejects negatives, more than two decimals (never rounds), European-style
 * separators ("4.800,00", "4,80"), exponents, and anything else.
 */
export function parseCents(input: string, limit?: CentsLimit): ParseCentsResult {
  const max = resolveMax(limit);
  if (typeof input !== "string") return { ok: false, error: "INVALID_FORMAT" };
  const text = input.trim();
  if (text === "" || text === "$") return { ok: false, error: "EMPTY" };
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, error: "INVALID_FORMAT" };
  if (NEGATIVE_RE.test(text)) return { ok: false, error: "NEGATIVE" };

  const match = AMOUNT_RE.exec(text);
  if (match === null) return { ok: false, error: "INVALID_FORMAT" };
  const [, intPart, fracPart] = match;
  if (intPart === undefined && fracPart === undefined) return { ok: false, error: "INVALID_FORMAT" };
  if (fracPart !== undefined && fracPart.length > 2) return { ok: false, error: "TOO_MANY_DECIMALS" };

  const whole = BigInt((intPart ?? "0").replaceAll(",", ""));
  const frac = BigInt((fracPart ?? "").padEnd(2, "0"));
  const total = whole * 100n + frac;
  if (total > BigInt(max)) return { ok: false, error: "OUT_OF_RANGE" };
  return { ok: true, value: Number(total) as Cents };
}

/** parseCents, throwing MoneyError (with the parse error code) on failure. */
export function parseCentsOrThrow(input: string, limit?: CentsLimit): Cents {
  const result = parseCents(input, limit);
  if (!result.ok) throw new MoneyError(result.error, `invalid amount (${result.error})`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Formatting (no Intl: its availability in the Convex runtime is unverified,
// and a fixed en-US format keeps server-rendered templates deterministic)

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function splitAbs(value: SignedCents): { negative: boolean; whole: string; frac: string } {
  if (!isSignedCents(value)) {
    throw new MoneyError("NOT_SAFE_INTEGER", "amount must be an integer number of cents");
  }
  const abs = Math.abs(value);
  return {
    negative: value < 0,
    whole: String(Math.floor(abs / 100)),
    frac: String(abs % 100).padStart(2, "0"),
  };
}

export interface FormatCentsOptions {
  /** "auto" (default) drops ".00" on whole dollars; "always" shows two decimals. */
  readonly fraction?: "auto" | "always";
}

/** Display format: "$4,800", "$4,800.50", "-$12.30". */
export function formatCents(value: SignedCents, options?: FormatCentsOptions): string {
  const { negative, whole, frac } = splitAbs(value);
  const showFrac = options?.fraction === "always" || frac !== "00";
  return `${negative ? "-" : ""}$${groupThousands(whole)}${showFrac ? `.${frac}` : ""}`;
}

/** Text to pre-fill an amount input: "4800" or "4800.50". Round-trips via parseCents. */
export function centsToInputString(value: Cents): string {
  assertCents(value);
  const { whole, frac } = splitAbs(value);
  return frac === "00" ? whole : `${whole}.${frac}`;
}

/** Canonical machine form with exactly two decimals: "4800.00", "-0.05". */
export function centsToDecimalString(value: SignedCents): string {
  const { negative, whole, frac } = splitAbs(value);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
