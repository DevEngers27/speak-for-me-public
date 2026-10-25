/** Deterministic xorshift32 byte source for reproducible tests. Not for production. */
export function seededBytes(seed: number): (n: number) => Uint8Array {
  let x = seed >>> 0 || 1;
  const next = (): number => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = next() & 0xff;
    return out;
  };
}
