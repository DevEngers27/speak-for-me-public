/**
 * JSON-safe value types and a structural checker.
 *
 * Everything this package puts on the wire (error payloads, reason codes) is
 * restricted to this subset. It is a strict subset of both JSON and Convex
 * `Value` (no `undefined`, no `bigint`, no `ArrayBuffer`, no non-finite
 * numbers, no class instances), so it survives `JSON.stringify`,
 * `convexToJson` / `jsonToConvex` and `ConvexError` transport unchanged.
 */

export type JsonPrimitive = string | number | boolean | null;
/**
 * Mutable array type on purpose: Convex `Value` uses `Value[]`, and a
 * `readonly` array is not assignable to it. Values produced by this package
 * are frozen at runtime instead.
 */
export type JsonArray = JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/** Max nesting depth accepted by {@link isJsonValue}; guards against cycles. */
const MAX_DEPTH = 32;

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep structural check that `value` is a {@link JsonValue}.
 * Rejects `undefined`, functions, symbols, bigint, NaN/Infinity, class
 * instances (Date, Map, Error, ...), sparse arrays, cycles and keys that
 * Convex reserves (leading `$`).
 */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_DEPTH) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) return false;
          if (!isJsonValue(value[i], depth + 1)) return false;
        }
        return true;
      }
      if (!isPlainObject(value)) return false;
      for (const [key, child] of Object.entries(value)) {
        if (key.startsWith("$")) return false;
        if (!isJsonValue(child, depth + 1)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/** True when `value` is a plain JSON object (not an array, not null). */
export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

/** Safe own-property lookup that ignores the prototype chain. */
export function ownGet(obj: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Identifier format shared by error codes and reason codes:
 * dot-separated segments of `[A-Za-z][A-Za-z0-9_]*`, at most 64 chars.
 * Accepts both `UPPER_SNAKE` and `domain.lower_snake` conventions; the
 * design docs pick one. No spaces, digits-first, currency or punctuation,
 * so a code can never smuggle free text or an amount.
 */
export const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
export const CODE_MAX_LENGTH = 64;

export function isValidCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    code.length <= CODE_MAX_LENGTH &&
    CODE_PATTERN.test(code)
  );
}
