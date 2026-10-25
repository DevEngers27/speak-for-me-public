/**
 * Parameter kinds for reason codes. There is deliberately no free-text
 * string kind: a reason carries identifiers, integers (amounts in minor
 * units), booleans, ISO dates and enum members only, so rendered text is
 * always produced by templates and an amount can never hide inside prose.
 */

/** `YYYY-MM-DD`. Validated as a real calendar date at runtime. */
export type IsoDate = `${number}-${number}-${number}`;

export const PARAM_KINDS = [
  "int", // any safe integer
  "count", // safe integer >= 0
  "cents", // safe integer, money in minor units (may be negative for deltas)
  "bool",
  "date", // IsoDate
  "key", // identifier: letter first, then [A-Za-z0-9_.:-], <= 64 chars
  "keys", // array of `key`, <= 256 items
  "id", // opaque document id: [A-Za-z0-9_-], <= 128 chars
  "enum", // one of a fixed list of `key`-shaped literals
] as const;
export type ParamKind = (typeof PARAM_KINDS)[number];

/** A parameter declaration. `T` is phantom (type-only). */
export interface ParamSpec<T = unknown, R extends boolean = boolean> {
  readonly kind: ParamKind;
  /**
   * Restricted params are withheld by `project(..., { includeRestricted: false })`.
   * Who may see them is a permissions decision made by the caller.
   */
  readonly restricted: R;
  /** Allowed values, `enum` only. */
  readonly values?: readonly string[];
  readonly __type?: T;
}

function build<T>(kind: ParamKind, values?: readonly string[]): ParamSpec<T, false> {
  return Object.freeze(
    values === undefined
      ? { kind, restricted: false as const }
      : { kind, restricted: false as const, values: Object.freeze([...values]) },
  );
}

/**
 * Param builders. Every builder returns a non-restricted spec with a fixed
 * literal type; wrap it in `param.restricted(...)` to mark it restricted.
 * (A generic `{ restricted: true }` option is avoided on purpose: inside a
 * `const` registry literal TypeScript widens the inferred `true` to
 * `boolean`, which silently breaks the public/restricted split at type level.)
 */
export const param = Object.freeze({
  int: () => build<number>("int"),
  count: () => build<number>("count"),
  cents: () => build<number>("cents"),
  bool: () => build<boolean>("bool"),
  date: () => build<IsoDate>("date"),
  key: () => build<string>("key"),
  // `string[]` (not readonly) so reasons stay assignable to Convex `Value`; frozen at runtime.
  keys: () => build<string[]>("keys"),
  id: () => build<string>("id"),
  oneOf: <const V extends readonly [string, ...string[]]>(values: V) =>
    build<V[number]>("enum", values),
  /** Mark a param restricted: withheld by `project` unless the caller allows it. */
  restricted: <T>(spec: ParamSpec<T, false>): ParamSpec<T, true> =>
    Object.freeze({ ...spec, restricted: true as const }),
});

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_KEYS = 256;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = DATE_PATTERN.exec(value);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const isKey = (v: unknown): v is string => typeof v === "string" && KEY_PATTERN.test(v);

/** Runtime check of one value against its declaration. */
export function isValidParam(spec: ParamSpec, value: unknown): boolean {
  switch (spec.kind) {
    case "int":
    case "cents":
      return Number.isSafeInteger(value);
    case "count":
      return Number.isSafeInteger(value) && (value as number) >= 0;
    case "bool":
      return typeof value === "boolean";
    case "date":
      return isIsoDate(value);
    case "key":
      return isKey(value);
    case "keys":
      return Array.isArray(value) && value.length <= MAX_KEYS && value.every(isKey);
    case "id":
      return typeof value === "string" && ID_PATTERN.test(value);
    case "enum":
      return typeof value === "string" && (spec.values ?? []).includes(value);
    default: {
      const unreachable: never = spec.kind;
      void unreachable;
      return false;
    }
  }
}

/** Definition-time check of a declaration (catches hand-written or JS specs). */
export function paramSpecProblem(spec: ParamSpec): string | null {
  if (!PARAM_KINDS.includes(spec.kind)) return "unknown kind";
  if (typeof spec.restricted !== "boolean") return "restricted must be boolean";
  if (spec.kind === "enum") {
    const values = spec.values ?? [];
    if (values.length === 0) return "enum needs at least one value";
    if (!values.every(isKey)) return "enum values must be key-shaped identifiers";
    if (new Set(values).size !== values.length) return "enum values must be unique";
  } else if (spec.values !== undefined) {
    return "values is only allowed for enum";
  }
  return null;
}
