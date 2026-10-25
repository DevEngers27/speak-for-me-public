/**
 * Type-level vocabulary for the error-code registry.
 * Runtime behaviour lives in `errors.ts`.
 */
import type { JsonObject, JsonValue } from "./json.js";

export const SEVERITIES = ["info", "warning", "error", "critical"] as const;
/**
 * - `info`: expected, caller-caused (bad input, not found).
 * - `warning`: expected but worth watching (conflict, rate limit, stale write).
 * - `error`: unexpected failure of a dependency or of our code.
 * - `critical`: an invariant was violated; page someone.
 */
export type Severity = (typeof SEVERITIES)[number];

export const EXPOSURES = ["public", "internal"] as const;
/**
 * - `public`: the code, its static message and its `client` fields may reach
 *   the browser.
 * - `internal`: the browser only ever sees the registry's fallback code.
 */
export type Exposure = (typeof EXPOSURES)[number];

export const FIELD_VISIBILITIES = ["client", "log", "secret"] as const;
/**
 * Every data field of an error is classified exactly once:
 * - `client`: may be sent to the browser (only if the code is `public`) and logged.
 * - `log`: may appear in server logs / telemetry (ids, counts), never sent to clients.
 * - `secret`: stays in process memory; never serialized by this package.
 */
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number];

/** A data-field declaration. `T` is phantom (type-only). */
export interface FieldSpec<
  T extends JsonValue = JsonValue,
  V extends FieldVisibility = FieldVisibility,
> {
  readonly visibility: V;
  readonly __type?: T;
}

/** Field builders: `field.client<number>()`, `field.log<string>()`, `field.secret<number>()`. */
export const field = Object.freeze({
  client: <T extends JsonValue>(): FieldSpec<T, "client"> =>
    Object.freeze({ visibility: "client" as const }),
  log: <T extends JsonValue>(): FieldSpec<T, "log"> =>
    Object.freeze({ visibility: "log" as const }),
  secret: <T extends JsonValue>(): FieldSpec<T, "secret"> =>
    Object.freeze({ visibility: "secret" as const }),
});

export interface ErrorSpec {
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly exposure: Exposure;
  /**
   * Static, user-safe text. Never interpolated: anything dynamic belongs in
   * a classified data field, so the message can be shown, logged and bundled
   * into the client without review.
   */
  readonly message: string;
  readonly data?: { readonly [fieldName: string]: FieldSpec };
}

export type ErrorSpecMap = { readonly [code: string]: ErrorSpec };

type NoFields = Record<never, never>;

export type FieldsOf<Spec> = Spec extends { readonly data: infer F }
  ? F
  : NoFields;

export type FieldType<F> =
  F extends FieldSpec<infer T extends JsonValue, FieldVisibility> ? T : never;

export type ErrorCode<S extends ErrorSpecMap> = keyof S & string;

/** Full data type of code `C` (all visibilities). */
export type ErrorDataOf<S extends ErrorSpecMap, C extends keyof S> = {
  readonly [K in keyof FieldsOf<S[C]>]: FieldType<FieldsOf<S[C]>[K]>;
};

/** Only the `client` fields of code `C`. */
export type ClientDataOf<S extends ErrorSpecMap, C extends keyof S> = {
  readonly [K in keyof FieldsOf<S[C]> as FieldsOf<S[C]>[K] extends FieldSpec<
    JsonValue,
    "client"
  >
    ? K
    : never]: FieldType<FieldsOf<S[C]>[K]>;
};

/** Codes whose exposure is `public`. */
export type PublicErrorCode<S extends ErrorSpecMap> = {
  [C in keyof S]: S[C] extends { readonly exposure: "public" } ? C : never;
}[keyof S] &
  string;

/** Optional-vs-required data argument for `create` / `fail`. */
export type CreateArgs<S extends ErrorSpecMap, C extends keyof S> =
  keyof FieldsOf<S[C]> extends never
    ? [data?: ErrorDataOf<S, C>, options?: CreateOptions]
    : [data: ErrorDataOf<S, C>, options?: CreateOptions];

export interface CreateOptions {
  /**
   * Original exception, for server-side debugging only. Never included in
   * payloads, client errors or log records (but `util.inspect` prints it).
   */
  readonly cause?: unknown;
}

/**
 * ConvexError-compatible payload: `throw new ConvexError(payload)`.
 * A type alias (not an interface) so it is assignable to Convex `Value`.
 */
export type ErrorPayload = {
  readonly code: string;
  readonly message: string;
  readonly data: JsonObject;
};

/** What UI code receives. Discriminated by `code`. */
export type ClientError<S extends ErrorSpecMap, F extends ErrorCode<S>> = {
  [C in PublicErrorCode<S> | F]: {
    readonly code: C;
    readonly message: string;
    readonly data: ClientDataOf<S, C>;
    readonly retryable: boolean;
    readonly severity: Severity;
    /** True when the input was not a recognisable public error. */
    readonly isFallback: boolean;
  };
}[PublicErrorCode<S> | F];

/** Log-safe projection: `client` + `log` fields only. */
export type ErrorLogRecord = {
  readonly code: string;
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly exposure: Exposure;
  readonly data: JsonObject;
  /** False when the thrown value was not an error from this registry. */
  readonly known: boolean;
  /** Sanitised `Error.name` of an unknown thrown value (never its message). */
  readonly errorName?: string;
};

/** JSON-safe description of one code, for docs and design catalogs. */
export interface ErrorCatalogEntry {
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly exposure: Exposure;
  readonly message: string;
  readonly fields: { readonly [fieldName: string]: FieldVisibility };
}
