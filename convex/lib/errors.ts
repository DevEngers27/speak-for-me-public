/**
 * Typed errors at the Convex boundary. Wire data is exactly {code, params}.
 * Only declared, validated params with an explicit audience are projected.
 * Throw ConvexError after writes to roll back; returning Result commits writes.
 * Identifiers come from catalogs; their syntax alone does not ensure privacy.
 */
import { ConvexError } from "convex/values";
import { z } from "zod";
import { isIsoDate, isCents, ITEM_KEY_RE, ERROR_CODES, REASON_CODES, PARAM_AUDIENCE, type ErrorCode } from "../../core/engine";

import { opsLog, publicOpsLog, errorClassOf, type PublicFnName, type InternalFnName, type InternalCtx } from "./opsLog";
export { errorClassOf } from "./opsLog";

export type Audience = "customer" | "finance" | "provider";
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/);
const kinds = {
  int: z.int(), count: z.int().nonnegative(), cents: z.custom<number>(isCents),
  bool: z.boolean(), date: z.custom<string>(isIsoDate), key,
  keys: z.array(key).max(256).refine(v => Array.from({length: v.length}, (_, i) => Object.hasOwn(v, i)).every(Boolean)),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
};
export type ParamKind = keyof typeof kinds;
export type ParamSpec<K extends ParamKind = ParamKind, A extends readonly Audience[] = readonly Audience[]> = {
  readonly kind: K; readonly audiences?: A;
};
export function param<const K extends ParamKind, const A extends readonly Audience[] = readonly []>(kind: K, audiences?: A): ParamSpec<K, A> {
  return Object.freeze({kind, ...(audiences === undefined ? {} : {audiences: Object.freeze([...audiences]) as unknown as A})});
}
type Spec = { readonly params: Readonly<Record<string, ParamSpec>>; readonly internal?: boolean };
type Specs = Readonly<Record<string, Spec>>;
type Params<S extends Spec> = { [P in keyof S['params']]: z.output<(typeof kinds)[S['params'][P]['kind']]> };
type Visible<S extends Spec, A extends Audience> = {
  [P in keyof S['params'] as S['params'][P] extends { readonly audiences?: infer R }
    ? R extends readonly Audience[] ? A extends R[number] ? A extends 'provider' ? P extends 'overByCents' | 'headroomCents' | 'deadline' ? never : P : P : never : never : never]: Params<S>[P]
};
export type ErrorPayload = { code: string; params: Record<string, string | number | boolean | string[]> };
const fallback = (): ErrorPayload => ({code: 'internal', params: {}});
const codePattern = /^[a-z]+\.[a-z][a-z0-9_]*$/;
const fieldPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export class AppError<C extends string = string, P = unknown> extends Error {
  declare readonly code: C;
  declare readonly params: P;
  constructor(code: C, params: P) {
    super('Application error');
    this.name = 'AppError';
    Object.defineProperties(this, { code: {value: code}, params: {value: params} });
  }
}
export function defineErrors<const S extends Specs>(input: S) {
  // Clone specs so later mutations cannot alter the registry's disclosure policy.
  const specs = structuredClone(input);
  for (const [code, spec] of Object.entries(specs)) {
    if (!codePattern.test(code)) throw new TypeError('Invalid error definition');
    Object.freeze(spec.params);
    for (const [name, field] of Object.entries(spec.params)) {
      if (!fieldPattern.test(name) || !Object.hasOwn(kinds, field.kind) ||
          field.audiences?.some(a => !['customer', 'finance', 'provider'].includes(a))) throw new TypeError('Invalid error definition');
      if (field.audiences) Object.freeze(field.audiences);
      Object.freeze(field);
    }
    Object.freeze(spec);
  }
  Object.freeze(specs);
  const own = new WeakSet<AppError>();
  function validated(code: string, value: unknown, audience?: Audience): Record<string, unknown> | null {
    if (!Object.hasOwn(specs, code) || typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const fields = specs[code]!.params;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(k => !Object.hasOwn(fields, k))) return null;
    const result: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(fields)) {
      if (audience !== undefined && (!spec.audiences?.includes(audience) || (audience === 'provider' && ['overByCents', 'headroomCents', 'deadline'].includes(name)))) continue;
      if (!Object.hasOwn(record, name)) return null;
      // Zod clones arrays; check density before parsing (parsers can materialize holes).
      const raw = record[name];
      if (Array.isArray(raw) && Array.from({length: raw.length}, (_, i) => !Object.hasOwn(raw, i)).some(Boolean)) return null;
      const parsed = kinds[spec.kind].safeParse(raw);
      if (!parsed.success) return null;
      result[name] = Array.isArray(parsed.data) ? Object.freeze([...parsed.data]) : Object.is(parsed.data, -0) ? 0 : parsed.data;
    }
    return Object.freeze(result);
  }
  function create<C extends keyof S & string>(code: C, params: Params<S[C]>): AppError<C, Params<S[C]>> {
    const checked = validated(code, params);
    if (!checked) throw new TypeError('Invalid error params');
    const error = new AppError(code, checked as Params<S[C]>);
    own.add(error);
    return error;
  }
  function toPayload(thrown: unknown, audience: Audience): ErrorPayload {
    try {
      if (thrown instanceof AppError && !own.has(thrown)) return fallback();
      const value: unknown = thrown instanceof ConvexError ? thrown.data : thrown;
      if (typeof value !== 'object' || value === null) return fallback();
      const record = value as Record<string, unknown>;
      const code = record.code;
      if (typeof code !== 'string' || !Object.hasOwn(specs, code) || specs[code]!.internal) return fallback();
      const checked = validated(code, record.params, audience);
      if (!checked) return fallback();
      const params: ErrorPayload['params'] = {};
      for (const [name, spec] of Object.entries(specs[code]!.params)) {
        if (!spec.audiences?.includes(audience)) continue;
        if (audience === 'provider' && ['overByCents', 'headroomCents', 'deadline'].includes(name)) continue;
        params[name] = checked[name] as ErrorPayload['params'][string];
      }
      return {code, params};
    } catch { return fallback(); }
  }
  function project<C extends keyof S & string, A extends Audience>(error: AppError<C, Params<S[C]>>, audience: A): {code: string; params: Partial<Visible<S[C], A>>} {
    return toPayload(error, audience) as {code: string; params: Partial<Visible<S[C], A>>};
  }
  return Object.freeze({create, project, toPayload, toClientError: toPayload,
    toConvexError: (error: unknown, audience: Audience) => new ConvexError(toPayload(error, audience))});
}

/** Wire params have already been projected by the caller; validate names and values again. */
export const wireKinds: Record<string, z.ZodType> = {
  currentConstraintsVersion: kinds.count, checkedAgainst: kinds.count, retryAfterMs: kinds.count,
  overByCents: kinds.cents, headroomCents: kinds.cents, belowByCents: kinds.cents, minAllowedCapCents: kinds.cents,
  daysLate: kinds.count, deadline: kinds.date, earliestDate: kinds.date, localDate: kinds.date,
  itemKeys: z.array(z.string().regex(ITEM_KEY_RE)).max(256), missingItemKeys: z.array(z.string().regex(ITEM_KEY_RE)).max(256), roles: z.array(z.enum(['customer', 'provider', 'finance'])),
  field: kinds.key, action: z.enum(['propose', 'counter', 'clarify', 'recommend_accept', 'reject', 'escalate']),
  reason: kinds.key, min: z.union([kinds.int, kinds.date]), max: z.union([kinds.int, kinds.date]),
  guard: z.enum(['room_status', 'run_status', 'run_changed', 'not_ready', 'baseline_exists', 'brief_missing', 'no_failed_turn', 'scenario_version']),
  limit: kinds.count, reasonCodes: z.array(z.enum(REASON_CODES)).max(64),
  role: z.enum(['customer', 'provider', 'finance']),
};
/** Wire names derive from the same reviewed audience declarations as rule params. */
export const API_PARAM_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(PARAM_AUDIENCE).map(([code, params]) => [code, Object.keys(params)]),
);
function validateWirePayload(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || !Object.hasOwn(data, 'code') || !Object.hasOwn(data, 'params') || typeof data.code !== 'string' || !(ERROR_CODES as readonly string[]).includes(data.code)) return false;
  if (typeof data.params !== 'object' || data.params === null || Array.isArray(data.params)) return false;
  const prototype: unknown = Object.getPrototypeOf(data.params);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const declared = new Set([
    ...Object.keys(PARAM_AUDIENCE[data.code as keyof typeof PARAM_AUDIENCE] ?? {}),
    ...(API_PARAM_NAMES[data.code] ?? []),
  ]);
  return Object.entries(data.params).every(([name, raw]) => declared.has(name) && wireKinds[name]?.safeParse(raw).success === true);
}
function isWirePayload(value: unknown): boolean {
  try { return validateWirePayload(value); } catch { return false; }
}
export function appError(code: ErrorCode, params: ErrorPayload['params'] = {}): ConvexError<ErrorPayload> {
  const payload = {code, params};
  if (!isWirePayload(payload)) throw new TypeError('Invalid error params');
  return new ConvexError(payload);
}
/** Internal functions log a closed code, never the exception text. */
export async function withInternalErrors<T>(ctx: InternalCtx, fn: InternalFnName, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    let normalized = false;
    try { normalized = error instanceof ConvexError && isWirePayload(error.data); } catch { /* Unknown thrown values fail closed. */ }
    if (normalized) throw error;
    opsLog(ctx, "unhandled", {fn, errorClass: errorClassOf(error)});
    throw new ConvexError({code: "internal", params: {}});
  }
}

/** Last boundary before Convex serializes an exception. */
export async function withSanitizedErrors<T>(fn: PublicFnName, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    let normalized = false;
    try { normalized = error instanceof ConvexError && isWirePayload(error.data); } catch { /* Unknown thrown values fail closed. */ }
    if (normalized) throw error;
    publicOpsLog('unhandled', {fn, errorClass: errorClassOf(error)});
    throw new ConvexError({code: 'internal', params: {}});
  }
}
