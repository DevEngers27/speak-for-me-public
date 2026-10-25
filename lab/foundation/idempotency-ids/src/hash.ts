/** SHA-256 helpers over strings, bytes and canonical JSON. */

import { canonicalJson, type CanonicalJsonOptions, type JsonValue } from "./canonical-json";
import { encodeHex } from "./encoding";
import { utf8Encode, webCryptoSha256, type Sha256Fn } from "./runtime";

export interface HashOptions {
  /** Override the SHA-256 implementation (defaults to Web Crypto). */
  readonly sha256?: Sha256Fn;
}

/** SHA-256 of raw bytes, or of the UTF-8 encoding of a string. */
export async function sha256(data: string | Uint8Array, options: HashOptions = {}): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  const digest = await (options.sha256 ?? webCryptoSha256)(bytes);
  if (digest.length !== 32) throw new Error(`SHA-256 implementation returned ${digest.length} bytes, expected 32`);
  return digest;
}

/** Lowercase hex SHA-256 (64 chars). */
export async function sha256Hex(data: string | Uint8Array, options: HashOptions = {}): Promise<string> {
  return encodeHex(await sha256(data, options));
}

/** SHA-256 of the canonical JSON form of `value`: equal for structurally equal values regardless of key order. */
export async function canonicalDigest(
  value: JsonValue,
  options: HashOptions & CanonicalJsonOptions = {},
): Promise<Uint8Array> {
  return sha256(canonicalJson(value, options), options);
}
