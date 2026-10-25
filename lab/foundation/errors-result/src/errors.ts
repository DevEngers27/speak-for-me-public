/**
 * Typed error-code registry with a ConvexError-compatible wire payload and a
 * client-side mapper that never exposes internal details.
 *
 * Server:  throw new ConvexError(registry.toPayload(e))
 * Client:  const shown = registry.toClientError(caught)
 */
import {
  AppError,
  CLIENT_ONLY,
  ErrorRegistryDefinitionError,
  logRecordFor,
  payloadCandidate,
  pickFields,
  sanitizeErrorName,
  SPEC,
} from "./appError.js";
import { diffKeys, exhaustiveTable } from "./exhaustive.js";
import type { JsonObject } from "./json.js";
import { isJsonValue, isValidCode } from "./json.js";
import { err, type Err } from "./result.js";
import {
  EXPOSURES,
  FIELD_VISIBILITIES,
  SEVERITIES,
  type ClientError,
  type CreateArgs,
  type CreateOptions,
  type ErrorCatalogEntry,
  type ErrorCode,
  type ErrorDataOf,
  type ErrorLogRecord,
  type ErrorPayload,
  type ErrorSpec,
  type ErrorSpecMap,
} from "./errorSpec.js";

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function definitionError(msg: string): never {
  throw new ErrorRegistryDefinitionError(msg);
}

function validateSpecs(specs: ErrorSpecMap, fallback: string): void {
  for (const [code, spec] of Object.entries(specs)) {
    if (!isValidCode(code)) definitionError(`Invalid error code "${code}"`);
    if (!SEVERITIES.includes(spec.severity)) definitionError(`${code}: invalid severity`);
    if (!EXPOSURES.includes(spec.exposure)) definitionError(`${code}: invalid exposure`);
    if (typeof spec.retryable !== "boolean") definitionError(`${code}: retryable must be boolean`);
    if (typeof spec.message !== "string" || spec.message.trim() === "") {
      definitionError(`${code}: message must be a non-empty static string`);
    }
    for (const [name, f] of Object.entries(spec.data ?? {})) {
      if (!FIELD_NAME.test(name)) definitionError(`${code}: invalid field name "${name}"`);
      if (!FIELD_VISIBILITIES.includes(f.visibility)) {
        definitionError(`${code}.${name}: invalid visibility`);
      }
      if (spec.exposure === "internal" && f.visibility === "client") {
        definitionError(`${code}.${name}: internal codes cannot have client fields`);
      }
    }
  }
  const fb = Object.hasOwn(specs, fallback) ? specs[fallback] : undefined;
  if (fb === undefined) definitionError(`Fallback code "${fallback}" is not defined`);
  if (fb.exposure !== "public") definitionError(`Fallback "${fallback}" must be public`);
  if (Object.keys(fb.data ?? {}).length > 0) {
    definitionError(`Fallback "${fallback}" must not declare data fields`);
  }
}

/** Every AppError a registry can produce, discriminated by `code`. */
export type AnyAppError<S extends ErrorSpecMap> = {
  [C in ErrorCode<S>]: AppError<C, ErrorDataOf<S, C>>;
}[ErrorCode<S>];

export interface ErrorRegistry<S extends ErrorSpecMap, F extends ErrorCode<S>> {
  readonly specs: S;
  readonly codes: readonly ErrorCode<S>[];
  readonly fallbackCode: F;
  has(code: unknown): code is ErrorCode<S>;
  /** Create an AppError. Throws TypeError on undeclared/missing/non-JSON data (a bug). */
  create<C extends ErrorCode<S>>(code: C, ...args: CreateArgs<S, C>): AppError<C, ErrorDataOf<S, C>>;
  /** `err(create(...))`, for functions that return Result instead of throwing. */
  fail<C extends ErrorCode<S>>(code: C, ...args: CreateArgs<S, C>): Err<AppError<C, ErrorDataOf<S, C>>>;
  /** True only for AppErrors created from this registry's specs. */
  is(thrown: unknown): thrown is AnyAppError<S>;
  is<C extends ErrorCode<S>>(thrown: unknown, code: C): thrown is AppError<C, ErrorDataOf<S, C>>;
  /** Exhaustive dispatch on code. */
  match<R>(
    error: AnyAppError<S>,
    handlers: { readonly [C in ErrorCode<S>]: (error: AppError<C, ErrorDataOf<S, C>>) => R },
  ): R;
  /** A lookup table that must cover every code (compile time and runtime). */
  table<V>(entries: { readonly [C in ErrorCode<S>]: V }): Readonly<Record<ErrorCode<S>, V>>;
  /** ConvexError data for any thrown value. Unknown/internal -> fallback. */
  toPayload(thrown: unknown): ErrorPayload;
  /** Client-side mapper. Accepts ConvexError, payload, AppError or anything else. */
  toClientError(thrown: unknown): ClientError<S, F>;
  /** Server-log projection (no secret fields, never an unknown error's message). */
  toLogRecord(thrown: unknown): ErrorLogRecord;
  describe(): { readonly [code: string]: ErrorCatalogEntry };
}

/**
 * Identity helper that keeps literal types, so spec groups (engine, scenario)
 * can be declared separately and merged with {@link mergeErrorSpecs}.
 */
export function errorSpecs<const S extends ErrorSpecMap>(specs: S): S {
  return specs;
}

/** Merge spec groups; throws on a duplicated code instead of silently overriding. */
export function mergeErrorSpecs<const A extends ErrorSpecMap, const B extends ErrorSpecMap>(
  a: A,
  b: B,
): A & B {
  const dup = Object.keys(b).filter((k) => Object.hasOwn(a, k));
  if (dup.length > 0) definitionError(`Duplicate error codes: ${dup.join(", ")}`);
  return { ...a, ...b };
}

export function defineErrors<const S extends ErrorSpecMap, F extends ErrorCode<S>>(
  specs: S,
  options: { readonly fallback: F },
): ErrorRegistry<S, F> {
  validateSpecs(specs, options.fallback);
  const frozen = Object.freeze({ ...specs });
  const codes = Object.freeze(Object.keys(frozen)) as readonly ErrorCode<S>[];
  const fallbackSpec = frozen[options.fallback] as ErrorSpec;
  const fallbackPayload: ErrorPayload = Object.freeze({
    code: options.fallback,
    message: fallbackSpec.message,
    data: Object.freeze({}),
  });

  const specOf = (code: string): ErrorSpec | undefined =>
    Object.hasOwn(frozen, code) ? (frozen[code] as ErrorSpec) : undefined;

  const isOwnError = (thrown: unknown): thrown is AppError<string, JsonObject> =>
    thrown instanceof AppError && specOf(thrown.code) === thrown[SPEC];

  function resolve(thrown: unknown): { payload: ErrorPayload; fellBack: boolean } {
    if (isOwnError(thrown)) {
      const spec = thrown[SPEC];
      if (spec.exposure !== "public") return { payload: fallbackPayload, fellBack: true };
      return {
        payload: { code: thrown.code, message: spec.message, data: pickFields(spec, thrown.data, CLIENT_ONLY) },
        fellBack: thrown.code === options.fallback,
      };
    }
    const candidate = payloadCandidate(thrown);
    const spec = candidate === null ? undefined : specOf(candidate.code);
    if (candidate === null || spec === undefined || spec.exposure !== "public") {
      return { payload: fallbackPayload, fellBack: true };
    }
    // Re-derive from the registry: message from the spec, only declared client fields.
    const clientNames = Object.entries(spec.data ?? {})
      .filter(([, f]) => f.visibility === "client")
      .map(([n]) => n);
    if (clientNames.some((n) => !Object.hasOwn(candidate.data, n))) {
      return { payload: fallbackPayload, fellBack: true };
    }
    return {
      payload: { code: candidate.code, message: spec.message, data: pickFields(spec, candidate.data, CLIENT_ONLY) },
      fellBack: candidate.code === options.fallback,
    };
  }

  function create(code: string, data?: JsonObject, opts?: CreateOptions): AppError<string, JsonObject> {
    const spec = specOf(code);
    if (spec === undefined) throw new TypeError(`Unknown error code "${String(code)}"`);
    const value: JsonObject = data ?? {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(`Error data for "${code}" must be an object`);
    }
    const { missing, unexpected } = diffKeys(Object.keys(spec.data ?? {}), value);
    if (missing.length > 0 || unexpected.length > 0) {
      throw new TypeError(
        `Error data for "${code}" is invalid: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
      );
    }
    for (const [name, v] of Object.entries(value)) {
      if (!isJsonValue(v)) throw new TypeError(`Error data field "${code}.${name}" is not JSON-safe`);
    }
    return new AppError(code, value, spec, opts);
  }

  const registry = {
    specs: frozen,
    codes,
    fallbackCode: options.fallback,
    has: (code: unknown): boolean => typeof code === "string" && specOf(code) !== undefined,
    create,
    fail: (code: string, data?: JsonObject, opts?: CreateOptions) => err(create(code, data, opts)),
    is: (thrown: unknown, code?: string): boolean =>
      isOwnError(thrown) && (code === undefined || thrown.code === code),
    match: (error: AppError, handlers: Record<string, (e: AppError) => unknown>): unknown => {
      const handler = Object.hasOwn(handlers, error.code) ? handlers[error.code] : undefined;
      if (handler === undefined) throw new TypeError(`No handler for error code "${error.code}"`);
      return handler(error);
    },
    table: <V>(entries: Record<string, V>) => exhaustiveTable(codes as readonly string[], entries, "error table"),
    toPayload: (thrown: unknown): ErrorPayload => resolve(thrown).payload,
    toClientError: (thrown: unknown) => {
      const { payload, fellBack } = resolve(thrown);
      const spec = specOf(payload.code) as ErrorSpec;
      return {
        code: payload.code,
        message: payload.message,
        data: payload.data,
        retryable: spec.retryable,
        severity: spec.severity,
        isFallback: fellBack,
      };
    },
    toLogRecord: (thrown: unknown): ErrorLogRecord => {
      if (isOwnError(thrown)) return logRecordFor(thrown.code, thrown[SPEC], thrown.data, true);
      const candidate = payloadCandidate(thrown);
      const spec = candidate === null ? undefined : specOf(candidate.code);
      if (candidate !== null && spec !== undefined) {
        return logRecordFor(candidate.code, spec, candidate.data, true);
      }
      return {
        ...logRecordFor(options.fallback, { ...fallbackSpec, severity: "error", exposure: "internal" }, {}, false),
        errorName: sanitizeErrorName(thrown),
      };
    },
    describe: () =>
      Object.fromEntries(
        codes.map((code) => {
          const s = frozen[code] as ErrorSpec;
          const fields = Object.fromEntries(Object.entries(s.data ?? {}).map(([n, f]) => [n, f.visibility]));
          return [code, { severity: s.severity, retryable: s.retryable, exposure: s.exposure, message: s.message, fields }];
        }),
      ),
  };
  return Object.freeze(registry) as unknown as ErrorRegistry<S, F>;
}
