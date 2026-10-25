/** 03 §3.3.3: seeded dominates stub, which dominates live. */
export type Provenance = 'live' | 'seeded' | 'stub';
export function inheritProvenance(...sources: readonly Provenance[]): Provenance {
  return sources.includes('seeded') ? 'seeded' : sources.includes('stub') ? 'stub' : 'live';
}
