/** Action/mutation adapters may inject audited JS primitives when Web Crypto is unavailable. */
export type CryptoFallback = {
  randomBytes(length: number): Uint8Array;
  sha256(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
};
export function randomToken(fallback?: Pick<CryptoFallback, 'randomBytes'>): string {
  const bytes = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(32))
    : fallback?.randomBytes(32);
  if (!bytes || bytes.length !== 32) throw new TypeError('Secure randomness unavailable');
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function sha256Hex(value: string, fallback?: Pick<CryptoFallback, 'sha256'>): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    : await fallback?.sha256(bytes);
  if (!digest || digest.length !== 32) throw new TypeError('SHA-256 unavailable');
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
