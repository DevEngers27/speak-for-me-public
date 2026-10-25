/**
 * Exhaustiveness helpers. The compile-time half comes from mapped types
 * (`{ [K in Code]: V }`); the runtime half protects against `as` casts,
 * plain-JS callers and data read back from storage.
 */

/** Thrown when a supposedly exhaustive table or switch misses a case. */
export class ExhaustivenessError extends Error {
  override readonly name = "ExhaustivenessError";
}

/**
 * Use in the `default` branch of a switch over a discriminant.
 * The message never includes the offending value (it may be private data);
 * only its `typeof` and the optional context label.
 */
export function assertNever(value: never, context?: string): never {
  const where = context === undefined ? "" : ` in ${context}`;
  throw new ExhaustivenessError(
    `Unhandled case${where} (received ${typeof value})`,
  );
}

/**
 * Runtime check that `table` has exactly the keys in `keys`.
 * Returns the missing and unexpected keys (names only).
 */
export function diffKeys(
  keys: readonly string[],
  table: object,
): { missing: string[]; unexpected: string[] } {
  const expected = new Set(keys);
  const actual = Object.keys(table);
  return {
    missing: keys.filter((k) => !Object.prototype.hasOwnProperty.call(table, k)),
    unexpected: actual.filter((k) => !expected.has(k)),
  };
}

/**
 * Build a frozen lookup table that must cover every key exactly once.
 * The mapped type makes a missing or extra key a compile error; the runtime
 * check throws {@link ExhaustivenessError} for the same mistakes.
 */
export function exhaustiveTable<K extends string, V>(
  keys: readonly K[],
  table: { readonly [P in K]: V },
  label = "table",
): Readonly<Record<K, V>> {
  const { missing, unexpected } = diffKeys(keys, table);
  if (missing.length > 0 || unexpected.length > 0) {
    throw new ExhaustivenessError(
      `${label} is not exhaustive: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
    );
  }
  return Object.freeze({ ...table });
}
