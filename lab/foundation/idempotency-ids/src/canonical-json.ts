/**
 * Canonical JSON: one byte-exact string per JSON value, suitable as hash input.
 *
 * Rules (a strict subset of RFC 8785 / JCS that agrees with it on every accepted value):
 * - Object keys are sorted by UTF-16 code units (same order as JCS and as JS `<`).
 * - No whitespace. Strings and numbers are serialised exactly as `JSON.stringify`
 *   does (ECMAScript Number::toString; `-0` becomes `0`; lone surrogates are escaped
 *   as `\udxxx`, so distinct strings never collapse to the same output).
 * - Object properties whose value is `undefined` are omitted (matches JSON.stringify
 *   and Convex, which drops undefined fields), so `{ a: undefined }` equals `{}`.
 * - Everything that JSON.stringify would silently coerce or drop is rejected:
 *   NaN/Infinity, bigint, functions, symbols, `undefined` as a value or array element,
 *   sparse arrays, symbol keys, non-plain objects (Date, Map, Set, class instances,
 *   typed arrays), cycles, and nesting deeper than `maxDepth`.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue | undefined };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export interface CanonicalJsonOptions {
  /** Maximum nesting depth of arrays/objects. Default 64. */
  readonly maxDepth?: number;
}

/** Thrown for values that have no canonical JSON form. `path` is a JSONPath-like locator. */
export class CanonicalJsonError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

const DEFAULT_MAX_DEPTH = 64;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function childPath(parent: string, key: string): string {
  return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const ctor: unknown = (value as { constructor?: unknown }).constructor;
  return typeof ctor === "function" && ctor.name !== "" ? ctor.name : "object";
}

export function canonicalJson(value: JsonValue, options: CanonicalJsonOptions = {}): string {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError(`maxDepth must be a non-negative integer, got ${String(maxDepth)}`);
  }
  const out: string[] = [];
  const ancestors = new Set<object>();

  const write = (v: unknown, path: string, depth: number): void => {
    switch (typeof v) {
      case "string":
        out.push(JSON.stringify(v));
        return;
      case "boolean":
        out.push(v ? "true" : "false");
        return;
      case "number":
        if (!Number.isFinite(v)) throw new CanonicalJsonError(`Non-finite number ${String(v)}`, path);
        out.push(JSON.stringify(v));
        return;
      case "object":
        break;
      default:
        throw new CanonicalJsonError(`Unsupported value of type ${typeof v}`, path);
    }
    if (v === null) {
      out.push("null");
      return;
    }
    if (depth >= maxDepth) throw new CanonicalJsonError(`Nesting deeper than maxDepth=${maxDepth}`, path);
    if (ancestors.has(v)) throw new CanonicalJsonError("Circular reference", path);
    ancestors.add(v);

    if (Array.isArray(v)) {
      out.push("[");
      for (let i = 0; i < v.length; i++) {
        const itemPath = `${path}[${i}]`;
        if (!Object.prototype.hasOwnProperty.call(v, i)) throw new CanonicalJsonError("Sparse array hole", itemPath);
        const item: unknown = v[i];
        if (item === undefined) throw new CanonicalJsonError("undefined array element", itemPath);
        if (i > 0) out.push(",");
        write(item, itemPath, depth + 1);
      }
      out.push("]");
    } else {
      if (!isPlainObject(v)) throw new CanonicalJsonError(`Non-plain object (${describe(v)})`, path);
      if (Object.getOwnPropertySymbols(v).length > 0) throw new CanonicalJsonError("Symbol-keyed property", path);
      const record = v as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodeUnits);
      out.push("{");
      let first = true;
      for (const key of keys) {
        const item = record[key];
        if (item === undefined) continue;
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(key), ":");
        write(item, childPath(path, key), depth + 1);
      }
      out.push("}");
    }
    ancestors.delete(v);
  };

  write(value, "$", 0);
  return out.join("");
}

/** True when both values have the same canonical form (both must be canonicalisable). */
export function canonicalEquals(a: JsonValue, b: JsonValue, options?: CanonicalJsonOptions): boolean {
  return canonicalJson(a, options) === canonicalJson(b, options);
}
