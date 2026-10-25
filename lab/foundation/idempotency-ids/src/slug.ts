/**
 * Stable slugs: a pure function of (input, options), identical on every runtime that
 * ships the same Unicode version (normalisation and `\p{...}` classes are Unicode-versioned).
 *
 * Default `script: "ascii"` produces `[a-z0-9-]` only: accents are stripped (NFKD + drop
 * combining marks), a few letters without decompositions are transliterated (ß -> ss,
 * ø -> o, ...), apostrophes are removed ("don't" -> "dont"), and every other run of
 * characters becomes one hyphen. Inputs with no ASCII letters or digits left (CJK,
 * Cyrillic, emoji, punctuation only, empty) get `<fallbackPrefix>-<7-char hash>`, so they
 * still map to distinct, stable slugs instead of all collapsing to the same string.
 *
 * `script: "unicode"` keeps letters, marks and digits of every script (NFKC, lowercase),
 * for human-facing URLs where non-Latin titles should stay readable.
 *
 * Length is counted in code points. Truncation prefers the last hyphen when that keeps
 * at least half of `maxLength`, otherwise cuts hard; it never splits a surrogate pair
 * and never leaves a leading or trailing hyphen.
 */

export interface SlugOptions {
  /** Maximum length in code points. Integer in [8, 256]. Default 64. */
  readonly maxLength?: number;
  /** Character repertoire of the result. Default "ascii". */
  readonly script?: "ascii" | "unicode";
  /** Prefix for the hash fallback; must itself be an ASCII slug. Default "untitled". */
  readonly fallbackPrefix?: string;
}

export const SLUG_DEFAULT_MAX_LENGTH = 64;
export const SLUG_MIN_LENGTH = 8;
export const SLUG_MAX_LENGTH = 256;
const ASCII_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FALLBACK_HASH_CHARS = 7;

const TRANSLITERATION: Readonly<Record<string, string>> = {
  ß: "ss", ẞ: "ss", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ø: "o", Ø: "o",
  đ: "d", Đ: "d", ð: "d", Ð: "d", ł: "l", Ł: "l", þ: "th", Þ: "th",
  ı: "i", ħ: "h", Ħ: "h", ŧ: "t", Ŧ: "t", ŀ: "l", Ŀ: "l",
};
const TRANSLITERATION_PATTERN = new RegExp(`[${Object.keys(TRANSLITERATION).join("")}]`, "gu");
const APOSTROPHES = /['‘’ʼ`´]/gu;

function assertMaxLength(maxLength: number): void {
  if (!Number.isSafeInteger(maxLength) || maxLength < SLUG_MIN_LENGTH || maxLength > SLUG_MAX_LENGTH) {
    throw new RangeError(`maxLength must be an integer in [${SLUG_MIN_LENGTH}, ${SLUG_MAX_LENGTH}], got ${String(maxLength)}`);
  }
}

/** 32-bit FNV-1a over UTF-16 code units, base36, fixed width. Not cryptographic: only spreads fallbacks. */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(FALLBACK_HASH_CHARS, "0");
}

function asciiBody(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(TRANSLITERATION_PATTERN, (ch) => TRANSLITERATION[ch] ?? "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unicodeBody(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/(^|-)\p{M}+/gu, "$1")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Truncate a hyphenated slug to `maxLength` code points without dangling hyphens. */
export function truncateSlug(slug: string, maxLength: number): string {
  const chars = Array.from(slug);
  if (chars.length <= maxLength) return slug;
  let cut = chars.slice(0, maxLength);
  if (chars[maxLength] !== "-") {
    const lastHyphen = cut.lastIndexOf("-");
    if (lastHyphen >= Math.ceil(maxLength / 2)) cut = cut.slice(0, lastHyphen);
  }
  return cut.join("").replace(/^-+|-+$/g, "");
}

export function slugify(input: string, options: SlugOptions = {}): string {
  const maxLength = options.maxLength ?? SLUG_DEFAULT_MAX_LENGTH;
  const script = options.script ?? "ascii";
  const fallbackPrefix = options.fallbackPrefix ?? "untitled";
  assertMaxLength(maxLength);
  if (!ASCII_SLUG.test(fallbackPrefix)) {
    throw new TypeError(`fallbackPrefix must be an ASCII slug, got ${JSON.stringify(fallbackPrefix)}`);
  }
  if (typeof input !== "string") throw new TypeError("slugify input must be a string");

  const body = script === "unicode" ? unicodeBody(input) : asciiBody(input);
  if (body !== "") return truncateSlug(body, maxLength);

  const hash = shortHash(input.normalize("NFC"));
  const prefix = truncateSlug(fallbackPrefix, Math.max(0, maxLength - FALLBACK_HASH_CHARS - 1));
  return prefix === "" ? hash : `${prefix}-${hash}`;
}

/** True if `value` is a non-empty ASCII slug (`[a-z0-9]` groups joined by single hyphens). */
export function isAsciiSlug(value: string, maxLength: number = SLUG_DEFAULT_MAX_LENGTH): boolean {
  return value.length <= maxLength && ASCII_SLUG.test(value);
}

/**
 * Candidate number `attempt` for de-duplicating `base`: attempt 1 is `base`,
 * attempt n >= 2 is `<base truncated>-<n>`, always within `maxLength` code points.
 */
export function slugCandidate(base: string, attempt: number, maxLength: number = SLUG_DEFAULT_MAX_LENGTH): string {
  assertMaxLength(maxLength);
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${String(attempt)}`);
  }
  if (attempt === 1) return truncateSlug(base, maxLength);
  const suffix = `-${attempt}`;
  const head = truncateSlug(base, maxLength - suffix.length);
  return head === "" ? String(attempt) : head + suffix;
}

export interface UniqueSlugOptions {
  readonly maxLength?: number;
  /** Give up after this many candidates. Default 100. */
  readonly maxAttempts?: number;
}

/**
 * First candidate of `base` for which `isTaken` is false. `isTaken` may be async
 * (e.g. an indexed lookup); run it inside the same transaction as the insert so the
 * check-then-write is atomic.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => boolean | Promise<boolean>,
  options: UniqueSlugOptions = {},
): Promise<string> {
  const maxLength = options.maxLength ?? SLUG_DEFAULT_MAX_LENGTH;
  const maxAttempts = options.maxAttempts ?? 100;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${String(maxAttempts)}`);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = slugCandidate(base, attempt, maxLength);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`No free slug for ${JSON.stringify(base)} after ${maxAttempts} attempts`);
}
