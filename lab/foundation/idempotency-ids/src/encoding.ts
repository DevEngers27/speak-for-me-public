/**
 * Byte-to-text encodings shared by operation ids and public ids.
 *
 * Base32 uses Crockford's alphabet in lowercase: digits plus letters without
 * i, l, o, u. It is case-insensitive for humans, avoids look-alike characters,
 * contains no URL-reserved characters, and each character carries exactly 5 bits,
 * so slicing an encoding of uniform random bytes yields uniform characters.
 */

export const BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Encode bytes as unpadded lowercase Crockford base32, most significant bit first.
 * The final group is right-padded with zero bits. Output length is ceil(bits / 5).
 */
export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET.charAt((buffer >>> bits) & 31);
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  }
  return out;
}

/** Lowercase hexadecimal encoding. */
export function encodeHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
