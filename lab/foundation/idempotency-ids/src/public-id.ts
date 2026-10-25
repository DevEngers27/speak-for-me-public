/**
 * Short, random, collision-resistant public ids such as `rm_8f3k2q9x0a7b1c4d`.
 *
 * Use them where an opaque, URL-safe, human-copyable handle is needed (share links,
 * support references) and a database id should not be exposed. They are random, so
 * they are NOT idempotency keys: two clicks produce two different ids. Derive
 * idempotency keys with `defineOperationKey` / `composeKey` instead.
 *
 * Body: lowercase Crockford base32 (5 bits per char, no i/l/o/u), produced by slicing
 * the encoding of uniform random bytes, so every character is uniform and unbiased.
 * Default 16 chars = 80 bits: about 4e-7 collision probability after 1e9 ids.
 */

import { BASE32_ALPHABET, encodeBase32 } from "./encoding";
import { webCryptoRandomBytes, type RandomBytesFn } from "./runtime";

export const PUBLIC_ID_DEFAULT_LENGTH = 16;
export const PUBLIC_ID_MIN_LENGTH = 10;
export const PUBLIC_ID_MAX_LENGTH = 64;
/** Prefix: lowercase letter then up to 11 lowercase letters/digits. Separated by `_`. */
export const PUBLIC_ID_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,11}$/;

export interface PublicIdOptions {
  /** Optional type prefix, e.g. "rm" for rooms. */
  readonly prefix?: string;
  /** Body length in characters (5 bits each). Default 16. */
  readonly length?: number;
  /** Random source; defaults to `crypto.getRandomValues`. Inject for deterministic tests. */
  readonly randomBytes?: RandomBytesFn;
}

function assertLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < PUBLIC_ID_MIN_LENGTH || length > PUBLIC_ID_MAX_LENGTH) {
    throw new RangeError(
      `length must be an integer in [${PUBLIC_ID_MIN_LENGTH}, ${PUBLIC_ID_MAX_LENGTH}], got ${String(length)}`,
    );
  }
}

function assertPrefix(prefix: string): void {
  if (!PUBLIC_ID_PREFIX_PATTERN.test(prefix)) {
    throw new TypeError(`Invalid public id prefix ${JSON.stringify(prefix)}: expected ${String(PUBLIC_ID_PREFIX_PATTERN)}`);
  }
}

export function createPublicId(options: PublicIdOptions = {}): string {
  const length = options.length ?? PUBLIC_ID_DEFAULT_LENGTH;
  assertLength(length);
  if (options.prefix !== undefined) assertPrefix(options.prefix);
  const byteLength = Math.ceil((length * 5) / 8);
  const bytes = (options.randomBytes ?? webCryptoRandomBytes)(byteLength);
  if (bytes.length !== byteLength) {
    throw new Error(`randomBytes returned ${bytes.length} bytes, expected ${byteLength}`);
  }
  const body = encodeBase32(bytes).slice(0, length);
  return options.prefix === undefined ? body : `${options.prefix}_${body}`;
}

export interface PublicIdShape {
  readonly prefix?: string;
  readonly length?: number;
}

const BODY_CHAR = new RegExp(`^[${BASE32_ALPHABET}]+$`);

/** Strict format check (lowercase canonical form). Does not prove the id exists. */
export function isPublicId(value: string, shape: PublicIdShape = {}): boolean {
  const length = shape.length ?? PUBLIC_ID_DEFAULT_LENGTH;
  assertLength(length);
  let body = value;
  if (shape.prefix !== undefined) {
    assertPrefix(shape.prefix);
    const head = `${shape.prefix}_`;
    if (!value.startsWith(head)) return false;
    body = value.slice(head.length);
  }
  return body.length === length && BODY_CHAR.test(body);
}

/**
 * Normalise a human-typed id body to canonical form: trims, lowercases, drops hyphens
 * and spaces, and applies Crockford's aliases (i, l -> 1; o -> 0). Returns the input's
 * prefix untouched. Validate the result with `isPublicId`.
 */
export function normalizePublicId(value: string): string {
  const trimmed = value.trim();
  const sep = trimmed.indexOf("_");
  const prefix = sep >= 0 ? `${trimmed.slice(0, sep).toLowerCase()}_` : "";
  const body = trimmed
    .slice(sep + 1)
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
  return prefix + body;
}
