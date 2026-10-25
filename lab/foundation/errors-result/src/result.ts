/**
 * Result<T, E>: an explicit success/failure value.
 *
 * Shape is a plain object discriminated by `ok`, so a Result whose `value`
 * and `error` are JSON-safe can be returned from a Convex function, stored,
 * or compared with `toEqual` without any class instances involved.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

/** Value type of a Result (distributes over unions). */
export type OkType<R> = R extends Ok<infer T> ? T : never;
/** Error type of a Result (distributes over unions). */
export type ErrType<R> = R extends Err<infer E> ? E : never;

/** `ok()` produces `Ok<null>` (not `undefined`) so it stays serializable. */
export function ok(): Ok<null>;
export function ok<T>(value: T): Ok<T>;
export function ok(...args: unknown[]): Ok<unknown> {
  return { ok: true, value: args.length === 0 ? null : args[0] };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function map<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chain a fallible step (a.k.a. flatMap / bind). */
export function andThen<T, E, U, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

/** Recover from an error with another fallible step. */
export function orElse<T, E, U, F>(
  result: Result<T, E>,
  fn: (error: E) => Result<U, F>,
): Result<T | U, F> {
  return result.ok ? result : fn(result.error);
}

export function unwrapOr<T, E, D>(result: Result<T, E>, fallback: D): T | D {
  return result.ok ? result.value : fallback;
}

export function unwrapOrElse<T, E, D>(
  result: Result<T, E>,
  fn: (error: E) => D,
): T | D {
  return result.ok ? result.value : fn(result.error);
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R },
): R {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

/**
 * Thrown by {@link unwrap} / {@link unwrapErr}. The message is fixed; the
 * original payload is attached as `cause` and is never stringified into the
 * message (it may hold private values).
 */
export class UnwrapError extends Error {
  override readonly name = "UnwrapError";
}

/** For tests and scripts. Production code should branch on `ok` instead. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new UnwrapError("Called unwrap on an Err result", {
    cause: result.error,
  });
}

/** For tests and scripts. */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) return result.error;
  throw new UnwrapError("Called unwrapErr on an Ok result");
}

type OkTuple<R extends readonly Result<unknown, unknown>[]> = {
  -readonly [K in keyof R]: OkType<R[K]>;
};

/**
 * Collect values; returns the first Err in input order (short-circuit).
 * Preserves tuple types: `all([a, b])` is `Result<[A, B], EA | EB>`.
 */
export function all<const R extends readonly Result<unknown, unknown>[]>(
  results: R,
): Result<OkTuple<R>, ErrType<R[number]>> {
  const values: unknown[] = [];
  for (const r of results) {
    if (!r.ok) return r as Err<ErrType<R[number]>>;
    values.push(r.value);
  }
  return ok(values as OkTuple<R>);
}

/**
 * Collect values, or *every* error in input order. This is the shape a rule
 * engine wants: run all checks, report all reasons, not just the first.
 */
export function collect<T, E>(
  results: readonly Result<T, E>[],
): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}

/** Split into successes and failures, keeping input order within each. */
export function partition<T, E>(
  results: readonly Result<T, E>[],
): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
}

export function fromNullable<T, E>(
  value: T | null | undefined,
  error: E,
): Result<T, E> {
  return value === null || value === undefined ? err(error) : ok(value);
}

/**
 * Run a throwing function and convert a throw into Err via `onThrow`.
 * `onThrow` receives `unknown`; map it to a typed error explicitly rather
 * than forwarding raw exception text.
 */
export function tryCatch<T, E>(
  fn: () => T,
  onThrow: (thrown: unknown) => E,
): Result<T, E> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(onThrow(thrown));
  }
}

/** Async variant of {@link tryCatch}; also catches rejected promises. */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onThrow: (thrown: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    return err(onThrow(thrown));
  }
}

/** Structural guard for Results that crossed a serialization boundary. */
export function isResult(value: unknown): value is Result<unknown, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["ok"] === true) return Object.prototype.hasOwnProperty.call(v, "value");
  if (v["ok"] === false) return Object.prototype.hasOwnProperty.call(v, "error");
  return false;
}
