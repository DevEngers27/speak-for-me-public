import { encodeBlock } from './projection/encodeBlock';
export { encodeBlock } from './projection/encodeBlock';
/**
 * Context projection, disclosure matrix, untrusted-data delimiter, and
 * deterministic token-budget trimmer (`core/engine/projection.ts`).
 *
 * Pure TypeScript, zero runtime dependencies, engine-purity compliant.
 *
 * Security invariants (canon §1.6, §7, D11, D12 ⑧):
 * 1. `pickExact` & `projectInto` — compile-time and runtime key-list bijection;
 *    never reads uninvited keys on `source` (Proxy read-tracking safe) and
 *    rejects unprojected nested object fields at compile time and runtime.
 * 2. `defineDisclosureMatrix` & `projectForRole` — declarative `field × role`
 *    matrix that rejects widened role tuples at compile time and derives each
 *    role's exact whitelist once.
 * 3. `wrapUntrusted` / `verifyUntrustedBlock` / `scanUntrustedBlocks` — wraps
 *    untrusted user/counterparty text in `<untrusted_data ...>` with NFKC +
 *    control/bidi/variation-selector stripping and `&`, `<`, `>`, `"`, `'`
 *    JSON block escaping (canon D12 ⑧) so inner content can never break out of the
 *    delimiter or forge tags.
 * 4. `trimToBudget` — deterministic, priority-aware token budget trimmer with
 *    integer token accounting.
 */

// ---------------------------------------------------------------------------
// 1. Exact Key Projection (`pickExact` & `projectInto`)
// ---------------------------------------------------------------------------

declare const projectedBrandSymbol: unique symbol;

/**
 * Brand attached to objects produced by `pickExact`, `projectInto`,
 * `projectForRole`, or `markProjected`. Raw unprojected nested objects lack
 * this brand and are rejected by projection helpers (resolves r02).
 */
export type Projected<T extends object = object> = Readonly<T> & {
  readonly [projectedBrandSymbol]: true;
};

const projectedObjects = new WeakSet<object>();

/**
 * Explicitly mark an already-sanitized, immutable value object as safe for
 * inclusion inside a parent projected DTO. Freezes the object and any nested
 * arrays/objects recursively.
 */
export function markProjected<const T extends object>(value: T): Projected<T> {
  if (!isProjected(value)) throw new TypeError('markProjected requires a projection helper result');
  return value as Projected<T>;
}

/** Check at runtime whether `value` was produced by a projection helper. */
export function isProjected(value: unknown): value is Projected<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    projectedObjects.has(value)
  );
}

/**
 * Allowed field value types inside a projected DTO (resolves r02):
 * - primitives (`string | number | boolean | bigint | symbol | null | undefined`)
 * - objects explicitly branded as `Projected<...>`
 * - readonly arrays of allowed field values
 *
 * Raw unprojected nested objects (`{ privateFloor: number }`) fail compile-time
 * checking so nested private fields cannot leak through shallow projection.
 */
export type SafeProjectablePrimitive =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

export type IsSafeProjectableValue<V> = [NonNullable<V>] extends [ never ]
  ? true
  : NonNullable<V> extends SafeProjectablePrimitive
    ? true
    : NonNullable<V> extends Projected<object>
      ? true
      : NonNullable<V> extends readonly (infer Elem)[]
        ? IsSafeProjectableValue<Elem>
        : false;

export type UnsafeNestedFieldKeys<
  Source extends object,
  Keys extends keyof Source,
> = {
  [K in Keys]: IsSafeProjectableValue<Source[K]> extends true ? never : K;
}[Keys];

type HasDuplicates<T extends readonly PropertyKey[]> =
  T extends readonly [infer Head, ...infer Tail extends readonly PropertyKey[]]
    ? Head extends Tail[number]
      ? true
      : HasDuplicates<Tail>
    : false;

type IsTuple<T extends readonly unknown[]> = number extends T['length']
  ? false
  : true;

/**
 * Compile-time constraint ensuring `Keys` is a literal tuple of unique keys
 * that matches `TargetKeys` 1-to-1 and contains no unprojected nested objects.
 */
export type ExactKeyList<
  TargetKeys extends PropertyKey,
  Keys extends readonly PropertyKey[],
  Source extends object = Record<TargetKeys, SafeProjectablePrimitive>,
> = IsTuple<Keys> extends false
  ? never
  : [TargetKeys] extends [Keys[number]]
    ? [Keys[number]] extends [TargetKeys]
      ? HasDuplicates<Keys> extends true
        ? never
        : [UnsafeNestedFieldKeys<Source, Extract<TargetKeys, keyof Source>>] extends [
              never,
            ]
          ? Keys
          : never
      : never
    : never;

function validateKeyList(keys: readonly PropertyKey[]): readonly string[] {
  if (!Array.isArray(keys)) {
    throw new TypeError('pickExact: keys must be an array of string property names');
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof k !== 'string' || k.length === 0) {
      throw new TypeError(
        `pickExact: key at index ${i} must be a non-empty string`,
      );
    }
    if (seen.has(k)) {
      throw new Error(`pickExact: duplicate key "${k}" in projection list`);
    }
    seen.add(k);
    normalized.push(k);
  }
  return normalized;
}

function validateAndFreezeFieldValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (projectedObjects.has(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const len = value.length;
    const copy = new Array<unknown>(len);
    for (let i = 0; i < len; i++) {
      copy[i] = validateAndFreezeFieldValue(`${key}[${i}]`, value[i]);
    }
    return Object.freeze(copy);
  }
  throw new TypeError(
    `pickExact: field "${key}" is an unprojected nested object; project it with pickExact/projectForRole or markProjected() first`,
  );
}

/**
 * Module-private key copier (resolves r05 & r08):
 * - Reads ONLY the listed `keys` from `source` (`source[k]` once per key).
 * - Never calls `Object.keys(source)` or touches unlisted properties on `source`.
 * - Uses `Object.defineProperty` on a fresh object so `"__proto__"` can never
 *   mutate prototypes.
 * - Rejects unprojected nested objects at runtime and freezes the result.
 */
function copyListedKeys<T extends object>(
  source: object,
  keys: readonly string[],
): Projected<Readonly<T>> {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('pickExact: source must be a non-null plain object');
  }
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (!(k in src)) {
      throw new Error(`pickExact: source is missing required key "${k}"`);
    }
    const rawVal = src[k];
    const safeVal = validateAndFreezeFieldValue(k, rawVal);
    Object.defineProperty(out, k, {
      value: safeVal,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  Object.freeze(out);
  projectedObjects.add(out);
  return out as unknown as Projected<Readonly<T>>;
}

/**
 * Project `source` onto the exact literal tuple `keys`.
 *
 * - Fails at compile time if `keys` is widened (`string[]`), has duplicate
 *   keys, omits a key of `K`, or selects an unprojected nested object field.
 * - At runtime, accesses ONLY `keys` on `source` (Proxy canary safe) and
 *   returns a frozen `Projected<Readonly<Pick<Source, K>>>`.
 */
export function pickExact<
  Source extends object,
  const Keys extends readonly (keyof Source & string)[],
>(
  source: Source,
  keys: Keys & ExactKeyList<Keys[number], Keys, Source>,
): Projected<Readonly<Pick<Source, Keys[number]>>> {
  const validated = validateKeyList(keys);
  return copyListedKeys<Pick<Source, Keys[number]>>(source, validated);
}

/**
 * Project `Source` into an explicit target DTO interface `Target` (`Target` must
 * be a subtype of `Source`). If `Target` adds/removes a field and `keys` is not
 * updated, compilation fails at `ExactKeyList<keyof Target & string, Keys, Source>`.
 */
export function projectInto<Target extends object>(): <
  Source extends Target,
  const Keys extends readonly (keyof Target & string)[],
>(
  source: Source,
  keys: Keys & ExactKeyList<keyof Target & string, Keys, Source>,
) => Projected<Readonly<Target>> {
  return (source, keys) => {
    const validated = validateKeyList(keys);
    return copyListedKeys<Target>(source, validated);
  };
}

// ---------------------------------------------------------------------------
// 2. Declarative Field × Role Disclosure Matrix (`defineDisclosureMatrix` & `projectForRole`)
// ---------------------------------------------------------------------------

export type MatrixSpec<
  Source extends object,
  Role extends string,
> = {
  readonly roles: readonly Role[];
  readonly fields: {
    readonly [K in keyof Source & string]: readonly Role[];
  };
};

/**
 * Reject widened `roles` (`string[]` instead of `const` tuple of literal strings)
 * and widened per-field role lists (resolves `context-projection-r01`).
 */
type ValidateRolesTuple<Roles extends readonly string[]> =
  number extends Roles['length']
    ? never
    : string extends Roles[number]
      ? never
      : HasDuplicates<Roles> extends true
        ? never
        : Roles;

type ValidateFieldRoles<
  Source extends object,
  Role extends string,
  Fields extends { readonly [K in keyof Source & string]: readonly Role[] },
> = [UnsafeNestedFieldKeys<Source, keyof Source & string>] extends [never]
  ? {
      readonly [K in keyof Source & string]: number extends Fields[K]['length']
        ? never
        : string extends Fields[K][number]
          ? never
          : HasDuplicates<Fields[K]> extends true
            ? never
            : Fields[K][number] extends Role
              ? Fields[K]
              : never;
    }
  : never;

export interface AnyMatrixSpec {
  readonly roles: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
}

/** Keys of `S['fields']` whose role tuple includes `R`. */
export type KeysForRole<
  S extends AnyMatrixSpec,
  R extends S['roles'][number],
> = {
  [K in keyof S['fields'] & string]: R extends S['fields'][K][number]
    ? K
    : never;
}[keyof S['fields'] & string];

/** Static projected DTO type for role `R` under matrix `S`. */
export type ProjectedForRole<
  Source extends object,
  S extends AnyMatrixSpec,
  R extends S['roles'][number],
> = Projected<Readonly<Pick<Source, KeysForRole<S, R> & keyof Source>>>;

export interface DisclosureMatrix<
  Source extends object,
  S extends AnyMatrixSpec,
> {
  readonly roles: S['roles'];
  readonly fields: S['fields'];
  readonly byRole: {
    readonly [R in S['roles'][number]]: readonly KeysForRole<S, R>[];
  };
  allowedKeysFor<R extends S['roles'][number]>(
    role: R,
  ): readonly KeysForRole<S, R>[];
  canRoleSee(role: S['roles'][number], field: keyof Source & string): boolean;
  projectForRole<R extends S['roles'][number]>(
    role: R,
    source: Source,
  ): ProjectedForRole<Source, S, R>;
}

/**
 * Define a declarative `field × role` disclosure matrix for `Source`.
 *
 * Enforces at compile time:
 * - `roles` is a `const` tuple of unique string literal role names (not `string[]`).
 * - `fields` lists every key of `Source` with a `const` tuple of valid role names.
 * - `Source` has no unbranded nested object fields that would leak via shallow copy.
 */
export function defineDisclosureMatrix<Source extends object>() {
  return <
    const Roles extends readonly string[],
    const Fields extends {
      readonly [K in keyof Source & string]: readonly Roles[number][];
    },
  >(spec: {
    readonly roles: Roles & ValidateRolesTuple<Roles>;
    readonly fields: Fields & ValidateFieldRoles<Source, Roles[number], Fields>;
  }): DisclosureMatrix<
    Source,
    { readonly roles: Roles; readonly fields: Fields }
  > => {
    if (!spec || typeof spec !== 'object') {
      throw new TypeError('defineDisclosureMatrix: spec must be an object');
    }
    if (!Array.isArray(spec.roles) || spec.roles.length === 0) {
      throw new Error(
        'defineDisclosureMatrix: roles must be a non-empty array',
      );
    }

    const roleSet = new Set<string>();
    for (const r of spec.roles) {
      if (typeof r !== 'string' || r.length === 0) {
        throw new TypeError(
          'defineDisclosureMatrix: role names must be non-empty strings',
        );
      }
      if (roleSet.has(r)) {
        throw new Error(`defineDisclosureMatrix: duplicate role "${r}"`);
      }
      roleSet.add(r);
    }

    if (
      !spec.fields ||
      typeof spec.fields !== 'object' ||
      Array.isArray(spec.fields)
    ) {
      throw new TypeError(
        'defineDisclosureMatrix: fields must be a plain object',
      );
    }

    const buckets = Object.create(null) as Record<string, string[]>;
    for (const r of spec.roles) {
      buckets[r] = [];
    }

    const frozenFields = Object.create(null) as Record<
      string,
      readonly string[]
    >;
    const fieldNames = Object.keys(spec.fields);

    for (const field of fieldNames) {
      const allowedRoles = (spec.fields as Record<string, readonly string[]>)[
        field
      ];
      if (!Array.isArray(allowedRoles)) {
        throw new TypeError(
          `defineDisclosureMatrix: roles for field "${field}" must be an array`,
        );
      }
      const seenForField = new Set<string>();
      for (const r of allowedRoles) {
        if (!roleSet.has(r)) {
          throw new Error(
            `defineDisclosureMatrix: field "${field}" references undeclared role "${String(r)}"`,
          );
        }
        if (seenForField.has(r)) {
          throw new Error(
            `defineDisclosureMatrix: duplicate role "${r}" on field "${field}"`,
          );
        }
        seenForField.add(r);
        buckets[r]!.push(field);
      }
      Object.defineProperty(frozenFields, field, {
        value: Object.freeze([...allowedRoles]),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }

    const byRole = Object.create(null) as Record<string, readonly string[]>;
    for (const r of spec.roles) {
      Object.defineProperty(byRole, r, {
        value: Object.freeze(buckets[r]!),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }

    const frozenRoles = Object.freeze([...spec.roles]);
    Object.freeze(frozenFields);
    Object.freeze(byRole);

    type SpecType = { readonly roles: Roles; readonly fields: Fields };

    function allowedKeysFor<R extends SpecType['roles'][number]>(
      role: R,
    ): readonly KeysForRole<SpecType, R>[] {
      if (typeof role !== 'string' || !roleSet.has(role)) {
        throw new Error(
          `DisclosureMatrix: unknown role "${String(role)}"`,
        );
      }
      return byRole[role] as readonly KeysForRole<SpecType, R>[];
    }

    function canRoleSee(
      role: SpecType['roles'][number],
      field: keyof Source & string,
    ): boolean {
      const list = allowedKeysFor(role) as readonly string[];
      return list.includes(field);
    }

    function projectRole<R extends SpecType['roles'][number]>(
      role: R,
      source: Source,
    ): ProjectedForRole<Source, SpecType, R> {
      const keys = allowedKeysFor(role) as readonly string[];
      return copyListedKeys(source, keys) as ProjectedForRole<
        Source,
        SpecType,
        R
      >;
    }

    return Object.freeze({
      roles: frozenRoles,
      fields: frozenFields,
      byRole,
      allowedKeysFor,
      canRoleSee,
      projectForRole: projectRole,
    }) as unknown as DisclosureMatrix<Source, SpecType>;
  };
}

/**
 * Curried role projector factory (`projectByRole(matrix)` / `createRoleProjector(matrix)`):
 * returns a bound `projectForRole(role, dto)` function for the given `matrix`.
 */
export function createRoleProjector<
  Source extends object,
  S extends MatrixSpec<Source, string>,
>(
  matrix: DisclosureMatrix<Source, S>,
): <R extends S['roles'][number]>(
  role: R,
  dto: Source,
) => ProjectedForRole<Source, S, R> {
  if (!matrix || typeof matrix.allowedKeysFor !== 'function') {
    throw new TypeError(
      'createRoleProjector: expected a DisclosureMatrix from defineDisclosureMatrix()',
    );
  }
  return <R extends S['roles'][number]>(
    role: R,
    dto: Source,
  ): ProjectedForRole<Source, S, R> => {
    const keys = matrix.allowedKeysFor(role) as readonly string[];
    return copyListedKeys(dto, keys) as ProjectedForRole<Source, S, R>;
  };
}

/** Alias for `createRoleProjector` matching `lab/foundation/context-projection`. */
export const projectByRole = createRoleProjector;

/**
 * Project `dto` for `role` using `matrix` (canon §1.6 `projectForRole`).
 *
 * Supports both:
 * - Direct invocation: `projectForRole(matrix, role, dto)`
 * - Curried invocation: `const project = projectForRole(matrix); project(role, dto)`
 */
export function projectMatrixForRole<
  Source extends object,
  S extends MatrixSpec<Source, string>,
>(
  matrix: DisclosureMatrix<Source, S>,
): <R extends S['roles'][number]>(
  role: R,
  dto: Source,
) => ProjectedForRole<Source, S, R>;
export function projectMatrixForRole<
  Source extends object,
  S extends MatrixSpec<Source, string>,
  R extends S['roles'][number],
>(
  matrix: DisclosureMatrix<Source, S>,
  role: R,
  dto: Source,
): ProjectedForRole<Source, S, R>;
export function projectMatrixForRole<
  Source extends object,
  S extends MatrixSpec<Source, string>,
  R extends S['roles'][number],
>(
  matrix: DisclosureMatrix<Source, S>,
  role?: R,
  dto?: Source,
):
  | ProjectedForRole<Source, S, R>
  | (<RoleArg extends S['roles'][number]>(
      r: RoleArg,
      d: Source,
    ) => ProjectedForRole<Source, S, RoleArg>) {
  const projector = createRoleProjector(matrix);
  if (arguments.length === 1) {
    return projector;
  }
  return projector(role as R, dto as Source);
}

// ---------------------------------------------------------------------------
// 3. `<untrusted_data>` Delimiter & Sanitization (canon D12 ⑧)
// ---------------------------------------------------------------------------

/** Canonical XML delimiter tag for untrusted user / counterparty text (canon D12 ⑧). */
export const UNTRUSTED_TAG = 'untrusted_data' as const;

export const UNTRUSTED_TEXT_POLICY = Object.freeze({tag: UNTRUSTED_TAG, maxChars: 2000, unicodeNormalization: 'NFKC'});
const SOURCE_ID_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
// Unicode categories cover supplementary format controls as well as BMP probes.
// LF and TAB are explicitly preserved by the replacement callback below.
const STRIPPED_UNTRUSTED_CHAR_RE =
  /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}\u034F\u115F\u1160\u180B-\u180F\u3164\uFE00-\uFE0F\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E01EF}]/gu;

function replaceLoneSurrogates(input: string): {
  readonly text: string;
  readonly replaced: number;
} {
  let replaced = 0;
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input.slice(i, i + 2);
        i += 1;
      } else {
        out += '\uFFFD';
        replaced += 1;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
      replaced += 1;
    } else {
      out += input[i];
    }
  }
  return { text: out, replaced };
}


export const escapeUntrustedPayload = encodeBlock;
export function fnv1a64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
export interface SanitizedUntrustedText {
  readonly text: string;
  readonly escaped: string;
  readonly charCount: number;
  readonly originalCharCount: number;
  readonly truncated: boolean;
  readonly strippedControlChars: number;
}
export function sanitizeUntrustedText(raw: string, options?: {readonly maxChars?: number}): SanitizedUntrustedText {
  if (typeof raw !== 'string') throw new TypeError('Untrusted text must be a string');
  const max = options?.maxChars ?? UNTRUSTED_TEXT_POLICY.maxChars;
  if (!Number.isSafeInteger(max) || max < 0) throw new RangeError('Invalid maxChars');
  const clean = replaceLoneSurrogates(raw);
  const normalized = clean.text.replace(/\r\n?/g, '\n').normalize('NFKC');
  let removed = clean.replaced;
  const stripped = normalized.replace(STRIPPED_UNTRUSTED_CHAR_RE, ch => { if (ch === '\n' || ch === '\t') return ch; removed++; return ''; });
  // Encoded angle brackets cannot conceal the delimiter vocabulary.
  const neutral = stripped.replace(/(?:&lt;|\\u003c)/gi, '<')
    .replace(/untrusted_data|room_state|candidates|shared_facts|clarify_answers|principal_brief|principal_notes|turn_instruction|system/gi, '[removed-delimiter]');
  const points = Array.from(neutral);
  const text = points.slice(0, max).join('');
  return Object.freeze({text, escaped: encodeBlock(text), charCount: Array.from(text).length,
    originalCharCount: points.length, truncated: points.length > max, strippedControlChars: removed});
}
export interface WrapUntrustedOptions {readonly source: string; readonly field?: string; readonly maxChars?: number}
export interface WrappedUntrustedBlock extends SanitizedUntrustedText {
  readonly tag: typeof UNTRUSTED_TAG; readonly source: string; readonly field?: string;
  readonly boundary: string; readonly block: string;
}
function envelope(source: string, value: unknown): {boundary: string; block: string} {
  if (!SOURCE_ID_RE.test(source)) throw new TypeError('Invalid untrusted source');
  const payload = encodeBlock(value);
  const boundary = fnv1a64Hex(source + '\u0000' + payload);
  return {boundary, block: `<untrusted_data source="${source}" boundary="${boundary}">\n${payload}\n</untrusted_data>`};
}
export function wrapUntrusted(raw: string, optionsOrSource: WrapUntrustedOptions | string = 'user_input'): WrappedUntrustedBlock {
  const options = typeof optionsOrSource === 'string' ? {source: optionsOrSource} : optionsOrSource;
  if (options.field !== undefined && !SOURCE_ID_RE.test(options.field)) throw new TypeError('Invalid untrusted field');
  const sanitized = sanitizeUntrustedText(raw, options);
  return Object.freeze({...sanitized, tag: UNTRUSTED_TAG, source: options.source, ...envelope(options.source, sanitized.text)});
}
/** Titles are rejected on normalized length, before delimiter replacement can expand them. */
export function sanitizeCatalogTitle(title: string): string {
  const normalized = replaceLoneSurrogates(title).text.normalize('NFKC');
  if (/[\r\n\u2028\u2029]/u.test(normalized)) throw new TypeError('Catalog titles must be single-line');
  if (Array.from(normalized).length > 80) throw new RangeError('Catalog title exceeds 80 code points');
  return sanitizeUntrustedText(title, {maxChars: Number.MAX_SAFE_INTEGER}).text;
}
export function wrapCatalogTitles(titles: Readonly<Record<string, string>>): string {
  const clean = Object.fromEntries(Object.entries(titles).map(([key, title]) => [key, sanitizeCatalogTitle(title)]));
  return envelope('provider.catalog_titles', clean).block;
}
export interface VerifiedUntrustedBlock {
  readonly ok: true; readonly source: string; readonly chars: number; readonly originalChars: number;
  readonly truncated: boolean; readonly decoded: string;
}
export interface InvalidUntrustedBlock {readonly ok: false; readonly reason: string}
export type VerifyUntrustedResult = VerifiedUntrustedBlock | InvalidUntrustedBlock;
export function verifyUntrustedBlock(block: string, options?: {readonly maxChars?: number}): VerifyUntrustedResult {
  const match = /^<untrusted_data source="([a-z][a-z0-9_.:-]{0,63})" boundary="([0-9a-f]{16})">\n([\s\S]*)\n<\/untrusted_data>$/.exec(block);
  if (!match) return {ok: false, reason: 'Invalid untrusted envelope'};
  const source = match[1]!, boundary = match[2]!, payload = match[3]!;
  if (/[<>&]/.test(payload) || boundary !== fnv1a64Hex(source + '\u0000' + payload)) return {ok: false, reason: 'Invalid payload or boundary'};
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== 'string' && (!value || typeof value !== 'object' || Array.isArray(value))) return {ok: false, reason: 'Invalid payload type'};
    const texts = typeof value === 'string' ? [value] : value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) as unknown[] : [];
    if (texts.some(text => typeof text !== 'string' || sanitizeUntrustedText(text, {maxChars: Number.MAX_SAFE_INTEGER}).text !== text)) return {ok: false, reason: 'Payload is not sanitized'};
    const decoded = typeof value === 'string' ? value : JSON.stringify(value);
    const chars = Array.from(decoded).length;
    if (chars > (options?.maxChars ?? UNTRUSTED_TEXT_POLICY.maxChars)) return {ok: false, reason: 'Payload exceeds length cap'};
    return {ok: true, source, chars, originalChars: chars, truncated: false, decoded};
  } catch { return {ok: false, reason: 'Invalid JSON payload'}; }
}

export interface ScanUntrustedBlocksResult {
  readonly ok: boolean;
  readonly blocks: readonly VerifiedUntrustedBlock[];
  readonly errors: readonly string[];
}

/**
 * Scan an entire assembled context string for `<untrusted_data>` blocks,
 * verify every block with `verifyUntrustedBlock`, and ensure no stray
 * `<untrusted_data` or `</untrusted_data` tag fragments appear outside
 * verified blocks (resolves `context-projection-r03`).
 */
export function scanUntrustedBlocks(
  context: string,
  options?: { readonly maxChars?: number },
): ScanUntrustedBlocksResult {
  if (typeof context !== 'string') {
    return Object.freeze({
      ok: false,
      blocks: Object.freeze([]),
      errors: Object.freeze(['context must be a string']),
    });
  }

  const blockFinderRe = new RegExp(
    `<${UNTRUSTED_TAG}\\b[\\s\\S]*?</${UNTRUSTED_TAG}>`,
    'g',
  );
  const strayTagRe = new RegExp(`</?${UNTRUSTED_TAG}\\b`, 'i');

  const verifiedBlocks: VerifiedUntrustedBlock[] = [];
  const errors: string[] = [];
  let lastIndex = 0;

  for (const match of context.matchAll(blockFinderRe)) {
    const matchIndex = match.index ?? 0;
    const outsideSegment = context.slice(lastIndex, matchIndex);
    if (strayTagRe.test(outsideSegment)) {
      errors.push(
        `Stray <${UNTRUSTED_TAG}> tag fragment outside block before index ${matchIndex}`,
      );
    }

    const candidate = match[0];
    const verification = verifyUntrustedBlock(candidate, options);
    if (!verification.ok) {
      errors.push(
        `Invalid <${UNTRUSTED_TAG}> block at index ${matchIndex}: ${verification.reason}`,
      );
    } else {
      verifiedBlocks.push(verification);
    }
    lastIndex = matchIndex + candidate.length;
  }

  const trailingSegment = context.slice(lastIndex);
  if (strayTagRe.test(trailingSegment)) {
    errors.push(
      `Stray <${UNTRUSTED_TAG}> tag fragment after index ${lastIndex}`,
    );
  }

  return Object.freeze({
    ok: errors.length === 0,
    blocks: Object.freeze(verifiedBlocks),
    errors: Object.freeze(errors),
  });
}

// ---------------------------------------------------------------------------
// 4. Deterministic Token-Budget Trimmer (`estimateTokens` & `trimToBudget`)
// ---------------------------------------------------------------------------

/**
 * Conservative, deterministic token estimator (~1 token per 4 UTF-8 bytes +
 * structural punctuation weight). Pure and runtime-independent.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let utf8Bytes = 0;
  let structural = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      utf8Bytes += 1;
      if (
        code === 0x0a || // \n
        code === 0x22 || // "
        code === 0x2c || // ,
        code === 0x3a || // :
        code === 0x7b || // {
        code === 0x7d || // }
        code === 0x5b || // [
        code === 0x5d // ]
      ) {
        structural += 1;
      }
    } else if (code < 0x800) {
      utf8Bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      utf8Bytes += 4;
      i += 1;
    } else {
      utf8Bytes += 3;
    }
  }
  return Math.ceil((utf8Bytes + structural * 0.5) / 4);
}

export interface BudgetSectionInput {
  readonly id: string;
  readonly content: string;
  /** Lower number = higher priority (kept first). */
  readonly priority: number;
  /** Pinned sections must fit in full or `trimToBudget` throws `BudgetOverflowError`. */
  readonly pinned?: boolean;
  /** Allow deterministic head-truncation if the full section does not fit. */
  readonly allowTruncate?: boolean;
  /** Minimum tokens required for a truncated section to be worth keeping. */
  readonly minTokens?: number;
}

export type SectionDisposition = 'kept' | 'truncated' | 'dropped';

export interface TrimmedSection {
  readonly id: string;
  readonly priority: number;
  readonly pinned: boolean;
  readonly disposition: SectionDisposition;
  readonly content: string;
  readonly tokens: number;
  readonly originalTokens: number;
}

export interface TrimBudgetOptions {
  readonly maxTokens: number;
  readonly reservedTokens?: number;
  readonly truncationMarker?: string;
  readonly estimator?: (text: string) => number;
}

export interface TrimBudgetResult {
  readonly effectiveBudget: number;
  readonly usedTokens: number;
  readonly remainingBudget: number;
  readonly sections: readonly TrimmedSection[];
  readonly keptIds: readonly string[];
  readonly truncatedIds: readonly string[];
  readonly droppedIds: readonly string[];
}

export class BudgetOverflowError extends Error {
  readonly requiredTokens: number;
  readonly availableBudget: number;
  readonly sectionId: string;

  constructor(
    sectionId: string,
    requiredTokens: number,
    availableBudget: number,
  ) {
    super(
      `Pinned section "${sectionId}" requires ${requiredTokens} tokens, exceeding remaining budget of ${availableBudget} tokens`,
    );
    this.name = 'BudgetOverflowError';
    this.sectionId = sectionId;
    this.requiredTokens = requiredTokens;
    this.availableBudget = availableBudget;
  }
}

const DEFAULT_TRUNCATION_MARKER = '\n...[truncated to fit token budget]';

/** Normalize any token estimate to a non-negative integer (resolves r06). */
function normalizeTokenEstimate(
  estimator: (text: string) => number,
  text: string,
): number {
  if (text.length === 0) return 0;
  const raw = estimator(text);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new RangeError(
      `Token estimator must return a finite non-negative number, got ${String(raw)}`,
    );
  }
  return Math.max(0, Math.ceil(raw));
}

function truncateTextToTokens(
  text: string,
  budgetTokens: number,
  marker: string,
  estimator: (t: string) => number,
): { readonly content: string; readonly tokens: number } | null {
  const markerTokens = normalizeTokenEstimate(estimator, marker);
  if (budgetTokens <= markerTokens) return null;

  const codePoints = Array.from(text);
  let low = 1;
  let high = codePoints.length;
  let bestContent: string | null = null;
  let bestTokens = 0;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const candidate = codePoints.slice(0, mid).join('') + marker;
    const t = normalizeTokenEstimate(estimator, candidate);
    if (t <= budgetTokens) {
      bestContent = candidate;
      bestTokens = t;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestContent === null) return null;
  return { content: bestContent, tokens: bestTokens };
}

/**
 * Deterministically trim `sections` to fit within `options.maxTokens - options.reservedTokens`.
 */
export function trimToBudget(
  sections: readonly BudgetSectionInput[],
  options: TrimBudgetOptions,
): TrimBudgetResult {
  if (!Array.isArray(sections)) {
    throw new TypeError('trimToBudget: sections must be an array');
  }
  if (
    !options ||
    !Number.isInteger(options.maxTokens) ||
    options.maxTokens < 0
  ) {
    throw new RangeError(
      'trimToBudget: maxTokens must be a non-negative integer',
    );
  }
  const reserved = options.reservedTokens ?? 0;
  if (!Number.isInteger(reserved) || reserved < 0) {
    throw new RangeError(
      'trimToBudget: reservedTokens must be a non-negative integer',
    );
  }
  const effectiveBudget = options.maxTokens - reserved;
  if (effectiveBudget < 0) {
    throw new RangeError(
      `trimToBudget: reservedTokens (${reserved}) exceeds maxTokens (${options.maxTokens})`,
    );
  }

  const estimator = options.estimator ?? estimateTokens;
  const marker = options.truncationMarker ?? DEFAULT_TRUNCATION_MARKER;

  const seenIds = new Set<string>();
  const indexed = sections.map((sec, index) => {
    if (!sec || typeof sec.id !== 'string' || sec.id.length === 0) {
      throw new TypeError(
        `trimToBudget: section at index ${index} must have a non-empty string id`,
      );
    }
    if (seenIds.has(sec.id)) {
      throw new Error(`trimToBudget: duplicate section id "${sec.id}"`);
    }
    seenIds.add(sec.id);
    if (typeof sec.content !== 'string') {
      throw new TypeError(
        `trimToBudget: section "${sec.id}" content must be a string`,
      );
    }
    if (typeof sec.priority !== 'number' || !Number.isFinite(sec.priority)) {
      throw new TypeError(
        `trimToBudget: section "${sec.id}" priority must be a finite number`,
      );
    }
    const originalTokens = normalizeTokenEstimate(estimator, sec.content);
    return {
      index,
      input: sec,
      pinned: Boolean(sec.pinned),
      allowTruncate: Boolean(sec.allowTruncate),
      minTokens: sec.minTokens ?? 1,
      originalTokens,
    };
  });

  // Allocation order:
  // 1. Pinned sections first
  // 2. Lower priority number first
  // 3. Original array index as deterministic tie-breaker
  const allocationOrder = [...indexed].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.input.priority !== b.input.priority) {
      return a.input.priority - b.input.priority;
    }
    return a.index - b.index;
  });

  let remaining = effectiveBudget;
  const decisions = new Map<string, TrimmedSection>();

  for (const item of allocationOrder) {
    const { input, pinned, allowTruncate, minTokens, originalTokens } = item;

    if (pinned) {
      if (originalTokens > remaining) {
        throw new BudgetOverflowError(input.id, originalTokens, remaining);
      }
      remaining -= originalTokens;
      decisions.set(
        input.id,
        Object.freeze({
          id: input.id,
          priority: input.priority,
          pinned: true,
          disposition: 'kept',
          content: input.content,
          tokens: originalTokens,
          originalTokens,
        }),
      );
      continue;
    }

    if (originalTokens <= remaining) {
      remaining -= originalTokens;
      decisions.set(
        input.id,
        Object.freeze({
          id: input.id,
          priority: input.priority,
          pinned: false,
          disposition: 'kept',
          content: input.content,
          tokens: originalTokens,
          originalTokens,
        }),
      );
      continue;
    }

    if (allowTruncate && remaining >= minTokens) {
      const markerTokens = normalizeTokenEstimate(estimator, marker);
      const minRequiredWithMarker = Math.max(minTokens, markerTokens + 1);
      if (remaining >= minRequiredWithMarker) {
        const truncated = truncateTextToTokens(
          input.content,
          remaining,
          marker,
          estimator,
        );
        if (truncated !== null && truncated.tokens >= minTokens) {
          remaining -= truncated.tokens;
          decisions.set(
            input.id,
            Object.freeze({
              id: input.id,
              priority: input.priority,
              pinned: false,
              disposition: 'truncated',
              content: truncated.content,
              tokens: truncated.tokens,
              originalTokens,
            }),
          );
          continue;
        }
      }
    }

    decisions.set(
      input.id,
      Object.freeze({
        id: input.id,
        priority: input.priority,
        pinned: false,
        disposition: 'dropped',
        content: '',
        tokens: 0,
        originalTokens,
      }),
    );
  }

  const orderedSections = indexed.map((item) => decisions.get(item.input.id)!);
  const keptIds: string[] = [];
  const truncatedIds: string[] = [];
  const droppedIds: string[] = [];

  for (const sec of orderedSections) {
    if (sec.disposition === 'kept') keptIds.push(sec.id);
    else if (sec.disposition === 'truncated') truncatedIds.push(sec.id);
    else droppedIds.push(sec.id);
  }

  const usedTokens = effectiveBudget - remaining;

  return Object.freeze({
    effectiveBudget,
    usedTokens,
    remainingBudget: remaining,
    sections: Object.freeze(orderedSections),
    keptIds: Object.freeze(keptIds),
    truncatedIds: Object.freeze(truncatedIds),
    droppedIds: Object.freeze(droppedIds),
  });
}

/** D13 catalog titles are bounded single-line text inside an untrusted block. */
export function wrapCatalogTitle(title: string, sourceId = 'provider.catalog_titles') {
  if (
    typeof title !== 'string' ||
    title.trim() !== title ||
    [...title].length === 0 ||
    [...title].length > 80 ||
    /[<>\r\n\uD800-\uDFFF]/u.test(title)
  ) {
    throw new TypeError('INVALID_CATALOG_TITLE');
  }
  // Reject normalized overflow; delimiter replacement may expand a valid title,
  // so never apply an 80-character truncation after sanitizing it.
  sanitizeCatalogTitle(title);
  return wrapUntrusted(title, sourceId);
}
