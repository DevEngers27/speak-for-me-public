import { ConvexError, type Value } from "convex/values";

/** `Symbol.for("ConvexError")` is the brand convex/values puts on every ConvexError. */
const CONVEX_ERROR_BRAND = Symbol.for("ConvexError");

/**
 * True for ConvexError instances, including ones created by a second copy of
 * the `convex` package (vite may load convex both inlined and external).
 */
export function isConvexError(e: unknown): e is ConvexError<Value> {
  if (e instanceof ConvexError) return true;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<PropertyKey, unknown>)[CONVEX_ERROR_BRAND] === true
  );
}

/** Extracts an application error code from a thrown value. */
export type CodeExtractor = (e: unknown) => string | undefined;

/**
 * Default code extractor: `ConvexError("CODE")` -> "CODE",
 * `ConvexError({ code: "CODE", ... })` -> "CODE", anything else -> undefined.
 * The engine's error shape is not decided yet; pass a custom extractor if it
 * ends up different.
 */
export const defaultCodeOf: CodeExtractor = (e) => {
  if (!isConvexError(e)) return undefined;
  const data: unknown = e.data;
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null && "code" in data) {
    const code = (data as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

/** Await a promise that must reject and return what it rejected with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("rejectionOf: expected the promise to reject, but it resolved");
}

/**
 * Await a promise that must reject with a ConvexError carrying `code`.
 * Returns the error so callers can make further assertions on `data`.
 */
export async function expectConvexErrorCode(
  promise: Promise<unknown>,
  code: string,
  codeOf: CodeExtractor = defaultCodeOf,
): Promise<ConvexError<Value>> {
  const e = await rejectionOf(promise);
  if (!isConvexError(e)) {
    throw new Error(
      `expectConvexErrorCode: expected ConvexError with code ${code}, got non-ConvexError: ${String(e)}`,
    );
  }
  const actual = codeOf(e);
  if (actual !== code) {
    throw new Error(`expectConvexErrorCode: expected code ${code}, got ${String(actual)}`);
  }
  return e;
}

/** Discriminated outcome of calling a function, used by role matrices. */
export type Outcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; code: string | undefined; message: string; error: unknown };

/** Run `fn` and capture success/failure without throwing. */
export async function outcomeOf<T>(
  fn: () => Promise<T>,
  codeOf: CodeExtractor = defaultCodeOf,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: codeOf(error), message, error };
  }
}
