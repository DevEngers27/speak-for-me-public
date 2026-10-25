/**
 * Whitelist projection: copy an explicitly listed, exhaustively checked set of
 * fields from a source object into a fresh plain object.
 *
 * The key list is the single place where "what leaves this boundary" is written
 * down. The compiler rejects the list when it is missing a declared key, names a
 * key that is not declared, repeats a key, or is not a literal tuple. At runtime
 * the projector reads only the listed own properties, so extra fields that sneak
 * in through structural typing (a wider object passed where `T` is expected) can
 * never reach the output.
 */

/** Compile-time error carrier. Never constructed at runtime. */
export interface ProjectionTypeError<Message extends string, Detail = never> {
  readonly __projectionError: Message;
  readonly __detail: Detail;
}

/** String keys of `T` (projection never deals with symbol or numeric keys). */
export type StringKeyOf<T> = Extract<keyof T, string>;

type HasDuplicate<Keys extends readonly unknown[]> = Keys extends readonly [
  infer Head,
  ...infer Rest,
]
  ? [Head] extends [Rest[number]]
    ? true
    : HasDuplicate<Rest>
  : false;

/**
 * Resolves to `Keys` when `Keys` is a literal tuple that lists every member of
 * `K` exactly once and nothing else; otherwise resolves to a
 * `ProjectionTypeError` that the argument cannot satisfy.
 *
 * "Nothing else" is enforced by the `readonly K[]` constraint at the call site;
 * this type adds the missing / duplicate / non-tuple checks.
 */
export type ExactKeyList<K extends string, Keys extends readonly K[]> =
  number extends Keys['length']
    ? ProjectionTypeError<'key list must be a literal tuple (use an inline array literal)'>
    : [Exclude<K, Keys[number]>] extends [never]
      ? HasDuplicate<Keys> extends true
        ? ProjectionTypeError<'key list contains a duplicate key'>
        : Keys
      : ProjectionTypeError<'key list is missing keys', Exclude<K, Keys[number]>>;

/** A compiled projector. `keys` is frozen and safe to expose for audits. */
export interface Projector<T, K extends StringKeyOf<T>> {
  (source: T): Pick<T, K>;
  readonly keys: readonly K[];
}

/**
 * Runtime half shared by every projector in this package: copy only the listed
 * own properties. Inherited properties, getters on the prototype chain and any
 * property that is not listed are ignored. Absent optional properties stay
 * absent (they are not materialised as `undefined`).
 */
export function copyListedKeys(source: object, keys: readonly string[]): Record<string, unknown> {
  if (source === null || typeof source !== 'object') {
    throw new TypeError('projection source must be a non-null object');
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      // defineProperty so a key such as "__proto__" stays an own data property.
      Object.defineProperty(out, key, {
        value: (source as Record<string, unknown>)[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}

/** Validates a runtime key list: non-empty strings, no duplicates. */
export function assertValidKeyList(keys: readonly unknown[], context: string): asserts keys is readonly string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`${context}: keys must be non-empty strings`);
    }
    if (seen.has(key)) {
      throw new TypeError(`${context}: duplicate key "${key}"`);
    }
    seen.add(key);
  }
}

/**
 * `pickExact<T, K>()(keys)` builds a projector from `T` to `Pick<T, K>`.
 *
 * `K` is the reviewed declaration of what may leave (often `keyof SomeDto`);
 * `keys` is its runtime counterpart. The two cannot drift apart:
 *
 * ```ts
 * const toSummary = pickExact<Doc, 'id' | 'title'>()(['id', 'title']);
 * pickExact<Doc, 'id' | 'title'>()(['id']);                 // error: missing "title"
 * pickExact<Doc, 'id' | 'title'>()(['id', 'title', 'note']); // error: "note" not in K
 * ```
 *
 * The curried form exists so `T` and `K` are written explicitly while the key
 * tuple is still inferred as a literal.
 */
export function pickExact<T extends object, K extends StringKeyOf<T>>() {
  return <const Keys extends readonly K[]>(keys: Keys & ExactKeyList<K, Keys>): Projector<T, K> => {
    const list: readonly K[] = Object.freeze([...(keys as readonly K[])]);
    assertValidKeyList(list, 'pickExact');
    const projector = (source: T): Pick<T, K> => copyListedKeys(source, list) as Pick<T, K>;
    return Object.assign(projector, { keys: list });
  };
}

type TargetCompatibility<S, T> =
  [Exclude<keyof T, keyof S>] extends [never]
    ? [Pick<S, Extract<keyof T, keyof S>>] extends [T]
      ? unknown
      : ProjectionTypeError<'source field types are not assignable to the target type'>
    : ProjectionTypeError<'target declares keys the source does not have', Exclude<keyof T, keyof S>>;

/**
 * DTO form: `projectInto<Source, Target>()(keys)` returns `(s: Source) => Target`.
 * The key list must be exactly `keyof Target`, every target key must exist on
 * the source, and each source field type must be assignable to the target's.
 * Use it when the output type is declared elsewhere (for example the type of a
 * function's `returns` validator) and you want a compile error the moment the
 * two disagree.
 */
export function projectInto<S extends object, T extends object>() {
  return <const Keys extends readonly StringKeyOf<T>[]>(
    keys: Keys & ExactKeyList<StringKeyOf<T>, Keys> & TargetCompatibility<S, T>,
  ): ((source: S) => T) & { readonly keys: readonly StringKeyOf<T>[] } => {
    const list: readonly StringKeyOf<T>[] = Object.freeze([...(keys as readonly StringKeyOf<T>[])]);
    assertValidKeyList(list, 'projectInto');
    const projector = (source: S): T => copyListedKeys(source, list) as T;
    return Object.assign(projector, { keys: list });
  };
}
