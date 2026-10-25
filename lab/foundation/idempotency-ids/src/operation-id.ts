/**
 * Deterministic operation ids (idempotency keys) derived on the server from typed tuples.
 *
 * Two shapes are offered; pick one per operation kind and never mix them for the same kind:
 *
 * 1. Hashed: `defineOperationKey({ kind, fields })` -> `<kind>:v<scheme>:<32 base32 chars>`.
 *    The digest is SHA-256 over canonical JSON of `{ k: kind, v: scheme, f: values }`,
 *    truncated to 160 bits. Use it when the tuple is long, contains free-form values,
 *    or should not be readable from logs.
 * 2. Readable: `composeKey(kind, ...segments)` -> `<kind>:<seg>:<seg>`. Injective
 *    (segments are escaped), cheap, synchronous, and self-explanatory in logs. Use it
 *    when the tuple is a couple of opaque ids.
 *
 * Both are pure functions of their inputs: the same logical operation always maps to
 * the same key, so a retry, a double click or a concurrent duplicate is detected by
 * an indexed lookup on the key inside the writing mutation.
 */

import { canonicalDigest, type HashOptions } from "./hash";
import type { JsonValue } from "./canonical-json";
import { BASE32_ALPHABET, encodeBase32 } from "./encoding";

/** Lowercase kind name: letter first, then letters, digits or hyphens; at most 40 chars. */
export const OPERATION_KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
/** Field names are identifiers so they read well in canonical JSON and error messages. */
export const OPERATION_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Digest bytes kept in a hashed operation id (160 bits -> exactly 32 base32 chars). */
export const OPERATION_DIGEST_BYTES = 20;
const DIGEST_CHARS = (OPERATION_DIGEST_BYTES * 8) / 5;
const MAX_SCHEME_VERSION = 9999;

const HASHED_ID_PATTERN = new RegExp(`^([a-z][a-z0-9-]{0,39}):v([1-9][0-9]{0,3}):([${BASE32_ALPHABET}]{${DIGEST_CHARS}})$`);

export type OperationKeyValues<F extends string> = { readonly [K in F]: JsonValue };

export interface OperationKeySpec<F extends string> {
  /** Operation family, e.g. the name of the side effect being deduplicated. */
  readonly kind: string;
  /**
   * Derivation scheme version (default 1). Bumping it changes every key of this kind,
   * which breaks deduplication against records written under the old version, so it
   * is a migration, not a refactor.
   */
  readonly schemeVersion?: number;
  /** Exact set of tuple fields. Order is irrelevant (canonical JSON sorts keys). */
  readonly fields: readonly F[];
}

export interface OperationKey<F extends string> {
  readonly kind: string;
  readonly schemeVersion: number;
  readonly fields: readonly F[];
  /** Derive the id. Throws if a declared field is missing/undefined or an undeclared one is present. */
  derive(values: OperationKeyValues<F>, options?: HashOptions): Promise<string>;
  /** True if `id` has this key's `<kind>:v<scheme>:` prefix and a well-formed digest. */
  owns(id: string): boolean;
}

export interface ParsedOperationId {
  readonly kind: string;
  readonly schemeVersion: number;
  readonly digest: string;
}

function assertKind(kind: string): void {
  if (!OPERATION_KIND_PATTERN.test(kind)) {
    throw new TypeError(`Invalid operation kind ${JSON.stringify(kind)}: expected ${String(OPERATION_KIND_PATTERN)}`);
  }
}

function assertSchemeVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1 || version > MAX_SCHEME_VERSION) {
    throw new TypeError(`Invalid schemeVersion ${String(version)}: expected an integer in [1, ${MAX_SCHEME_VERSION}]`);
  }
}

/** Declare a typed operation key. Validates the spec eagerly so mistakes fail at module load. */
export function defineOperationKey<const F extends string>(spec: OperationKeySpec<F>): OperationKey<F> {
  const kind = spec.kind;
  const schemeVersion = spec.schemeVersion ?? 1;
  assertKind(kind);
  assertSchemeVersion(schemeVersion);
  const fields = Object.freeze([...spec.fields]);
  const declared = new Set<string>();
  for (const field of fields) {
    if (!OPERATION_FIELD_PATTERN.test(field)) {
      throw new TypeError(`Invalid field name ${JSON.stringify(field)} for operation kind ${kind}`);
    }
    if (declared.has(field)) throw new TypeError(`Duplicate field ${field} for operation kind ${kind}`);
    declared.add(field);
  }
  const prefix = `${kind}:v${schemeVersion}:`;

  return Object.freeze({
    kind,
    schemeVersion,
    fields,
    async derive(values: OperationKeyValues<F>, options: HashOptions = {}): Promise<string> {
      const record = values as Readonly<Record<string, JsonValue | undefined>>;
      for (const field of fields) {
        if (record[field] === undefined) throw new TypeError(`Missing field ${field} for operation kind ${kind}`);
      }
      for (const key of Object.keys(record)) {
        if (!declared.has(key)) throw new TypeError(`Undeclared field ${key} for operation kind ${kind}`);
      }
      const digest = await canonicalDigest({ k: kind, v: schemeVersion, f: record }, options);
      return prefix + encodeBase32(digest.subarray(0, OPERATION_DIGEST_BYTES));
    },
    owns(id: string): boolean {
      const parsed = parseOperationId(id);
      return parsed !== null && parsed.kind === kind && parsed.schemeVersion === schemeVersion;
    },
  });
}

/** Parse a hashed operation id; returns null for anything that is not one. */
export function parseOperationId(id: string): ParsedOperationId | null {
  const m = HASHED_ID_PATTERN.exec(id);
  if (m === null) return null;
  const [, kind, version, digest] = m;
  if (kind === undefined || version === undefined || digest === undefined) return null;
  return { kind, schemeVersion: Number(version), digest };
}

export type KeySegment = string | number;

function encodeSegment(segment: KeySegment, index: number): string {
  if (typeof segment === "number") {
    if (!Number.isSafeInteger(segment)) {
      throw new TypeError(`Numeric key segment ${index} must be a safe integer, got ${String(segment)}`);
    }
    return String(segment);
  }
  if (typeof segment !== "string") throw new TypeError(`Key segment ${index} must be a string or integer`);
  return segment.replace(/%/g, "%25").replace(/:/g, "%3A");
}

/**
 * Readable, injective key: `<kind>:<segment>:<segment>...`.
 * `%` and `:` inside segments are percent-escaped, so distinct segment lists never
 * collide. Integers are written in decimal, so `1` and `"1"` produce the same key:
 * use one type per position.
 */
export function composeKey(kind: string, ...segments: readonly KeySegment[]): string {
  assertKind(kind);
  let out = kind;
  segments.forEach((segment, i) => {
    out += `:${encodeSegment(segment, i)}`;
  });
  return out;
}

/** Inverse of `composeKey` (integers come back as strings). Returns null if malformed. */
export function parseComposedKey(key: string): { kind: string; segments: string[] } | null {
  const [kind, ...raw] = key.split(":");
  if (kind === undefined || !OPERATION_KIND_PATTERN.test(kind)) return null;
  const segments: string[] = [];
  for (const segment of raw) {
    if (/%(?!25|3A)/.test(segment)) return null;
    segments.push(segment.replace(/%(25|3A)/g, (_m, code: string) => (code === "25" ? "%" : ":")));
  }
  return { kind, segments };
}
