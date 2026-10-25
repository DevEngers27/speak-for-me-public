/**
 * AppError and the projection helpers shared by the registry.
 * Internal module: import from the package index instead.
 */
import type { JsonObject } from "./json.js";
import { isJsonObject, isValidCode, ownGet } from "./json.js";
import type {
  CreateOptions,
  ErrorLogRecord,
  ErrorPayload,
  ErrorSpec,
  Exposure,
  FieldVisibility,
  Severity,
} from "./errorSpec.js";

export const SPEC = Symbol("errors-result.spec");
const CONVEX_ERROR_MARK = Symbol.for("ConvexError");
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Thrown at definition time when a registry is malformed. */
export class ErrorRegistryDefinitionError extends Error {
  override readonly name = "ErrorRegistryDefinitionError";
}

/**
 * An error created through a registry. `message` is the spec's static text.
 * `data` is non-enumerable, so `console.log` / `util.inspect` do not print it
 * and `JSON.stringify` goes through {@link AppError.toJSON} (log-safe).
 *
 * `cause` is NOT protected: Node's `util.inspect` prints `[cause]` even though
 * it is non-enumerable. Log errors with `registry.toLogRecord(e)`, never with
 * `console.log(e)`, and do not attach causes whose message embeds private data.
 */
export class AppError<C extends string = string, D = JsonObject> extends Error {
  override readonly name = "AppError";
  readonly code: C;
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly exposure: Exposure;
  declare readonly data: D;
  declare readonly [SPEC]: ErrorSpec;

  constructor(code: C, data: D, spec: ErrorSpec, options?: CreateOptions) {
    super(
      spec.message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.severity = spec.severity;
    this.retryable = spec.retryable;
    this.exposure = spec.exposure;
    Object.defineProperty(this, "data", {
      value: Object.freeze({ ...data }),
      enumerable: false,
    });
    Object.defineProperty(this, SPEC, { value: spec, enumerable: false });
  }

  /** Log-safe JSON: code, flags and `client` + `log` fields only. */
  toJSON(): ErrorLogRecord {
    return logRecordFor(this.code, this[SPEC], this.data as JsonObject, true);
  }
}

export function pickFields(
  spec: ErrorSpec,
  data: JsonObject,
  allowed: ReadonlySet<FieldVisibility>,
): JsonObject {
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(spec.data ?? {})) {
    if (allowed.has(f.visibility) && Object.hasOwn(data, name)) {
      out[name] = data[name];
    }
  }
  return out as JsonObject;
}

export const CLIENT_ONLY: ReadonlySet<FieldVisibility> = new Set(["client"]);
const LOGGABLE: ReadonlySet<FieldVisibility> = new Set(["client", "log"]);

export function logRecordFor(
  code: string,
  spec: ErrorSpec,
  data: JsonObject,
  known: boolean,
): ErrorLogRecord {
  return {
    code,
    severity: spec.severity,
    retryable: spec.retryable,
    exposure: spec.exposure,
    data: pickFields(spec, data, LOGGABLE),
    known,
  };
}

export function sanitizeErrorName(thrown: unknown): string {
  if (thrown instanceof Error && ERROR_NAME.test(thrown.name)) return thrown.name;
  return thrown instanceof Error ? "Error" : typeof thrown;
}

/** Extract a `{ code, message, data }` candidate from a ConvexError or a bare payload. */
export function payloadCandidate(thrown: unknown): ErrorPayload | null {
  if (typeof thrown !== "object" || thrown === null) return null;
  // ConvexError instances carry Symbol.for("ConvexError") === true (convex/values errors.js).
  const isConvexError =
    (thrown as { [CONVEX_ERROR_MARK]?: unknown })[CONVEX_ERROR_MARK] === true ||
    (thrown instanceof Error && thrown.name === "ConvexError");
  const raw: unknown = isConvexError ? (thrown as { data?: unknown }).data : thrown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const code = ownGet(raw, "code");
  const message = ownGet(raw, "message");
  const data = ownGet(raw, "data");
  if (!isValidCode(code) || typeof message !== "string" || !isJsonObject(data)) {
    return null;
  }
  return { code, message, data };
}

