/**
 * Runtime-neutral access to the few Web Platform globals this package needs.
 *
 * The package compiles against `lib: ["ES2022"]` only (no DOM, no @types/node), so
 * it cannot accidentally depend on browser- or Node-only APIs. The globals below
 * exist in Node >= 20, browsers, edge runtimes and (to be verified on a real
 * deployment) the Convex default runtime.
 */

/** SHA-256 implementation: bytes in, 32-byte digest out. Injectable for tests or exotic runtimes. */
export type Sha256Fn = (data: Uint8Array) => Promise<Uint8Array>;

/** Source of cryptographically strong random bytes. Injectable for deterministic tests. */
export type RandomBytesFn = (byteLength: number) => Uint8Array;

interface WebCryptoLike {
  readonly subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
  };
  getRandomValues<T extends Uint8Array>(array: T): T;
}

interface TextEncoderLike {
  encode(input: string): Uint8Array;
}

interface GlobalsLike {
  readonly crypto?: WebCryptoLike;
  readonly TextEncoder?: new () => TextEncoderLike;
}

const globals = globalThis as unknown as GlobalsLike;

function webCrypto(): WebCryptoLike {
  const c = globals.crypto;
  if (c === undefined || typeof c.subtle?.digest !== "function" || typeof c.getRandomValues !== "function") {
    throw new Error("Web Crypto (globalThis.crypto with subtle.digest and getRandomValues) is not available in this runtime");
  }
  return c;
}

let encoder: TextEncoderLike | undefined;

/** UTF-8 encode a string. Lone surrogates become U+FFFD (WHATWG behaviour). */
export function utf8Encode(input: string): Uint8Array {
  if (encoder === undefined) {
    const Ctor = globals.TextEncoder;
    if (Ctor === undefined) throw new Error("TextEncoder is not available in this runtime");
    encoder = new Ctor();
  }
  return encoder.encode(input);
}

/** Default SHA-256 backed by `crypto.subtle.digest`. */
export const webCryptoSha256: Sha256Fn = async (data) => {
  const digest = await webCrypto().subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
};

/** Max bytes per getRandomValues call (Web Crypto quota). */
const RANDOM_CHUNK = 65_536;

/** Default random source backed by `crypto.getRandomValues`. */
export const webCryptoRandomBytes: RandomBytesFn = (byteLength) => {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError(`byteLength must be a non-negative safe integer, got ${String(byteLength)}`);
  }
  const out = new Uint8Array(byteLength);
  const c = webCrypto();
  for (let offset = 0; offset < byteLength; offset += RANDOM_CHUNK) {
    c.getRandomValues(out.subarray(offset, Math.min(offset + RANDOM_CHUNK, byteLength)));
  }
  return out;
};
