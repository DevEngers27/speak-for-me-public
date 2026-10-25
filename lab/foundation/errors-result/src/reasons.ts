/**
 * reasonCode builder for deterministic rule engines.
 *
 * A reason is `{ reasonCode, params }`: a registered identifier plus typed,
 * structured parameters. It is the only interface between rule code and
 * anything that renders text, projects data per audience, or stores outcomes.
 */
import { exhaustiveTable } from "./exhaustive.js";
import type { JsonObject } from "./json.js";
import { isJsonObject, isValidCode, ownGet } from "./json.js";
import { err, ok, type Result } from "./result.js";
import {
  isValidParam,
  paramSpecProblem,
  type ParamKind,
  type ParamSpec,
} from "./reasonParams.js";

export interface ReasonSpec {
  readonly params?: { readonly [name: string]: ParamSpec };
  /** Free-form, JSON-only metadata the engine attaches (e.g. blocking vs informational). */
  readonly meta?: JsonObject;
}
export type ReasonSpecMap = { readonly [code: string]: ReasonSpec };

type NoParams = Record<never, never>;
type ParamsDecl<Spec> = Spec extends { readonly params: infer P } ? P : NoParams;
type ParamValue<P> = P extends ParamSpec<infer T, boolean> ? T : never;

export type ReasonCode<S extends ReasonSpecMap> = keyof S & string;

export type ReasonParamsOf<S extends ReasonSpecMap, C extends keyof S> = {
  readonly [K in keyof ParamsDecl<S[C]>]: ParamValue<ParamsDecl<S[C]>[K]>;
};

/** Params that survive `project(..., { includeRestricted: false })`. */
export type PublicReasonParamsOf<S extends ReasonSpecMap, C extends keyof S> = {
  readonly [K in keyof ParamsDecl<S[C]> as ParamsDecl<S[C]>[K] extends ParamSpec<unknown, false>
    ? K
    : never]: ParamValue<ParamsDecl<S[C]>[K]>;
};

export type ReasonMetaOf<S extends ReasonSpecMap, C extends keyof S> =
  S[C] extends { readonly meta: infer M } ? M : undefined;

export type Reason<S extends ReasonSpecMap, C extends ReasonCode<S> = ReasonCode<S>> = {
  [K in C]: { readonly reasonCode: K; readonly params: ReasonParamsOf<S, K> };
}[C];

export type ProjectedReason<S extends ReasonSpecMap, C extends ReasonCode<S> = ReasonCode<S>> = {
  [K in C]: {
    readonly reasonCode: K;
    readonly params: Partial<ReasonParamsOf<S, K>>;
    /** Names (never values) of params that were withheld, sorted. */
    readonly withheld: string[];
  };
}[C];

export type MakeArgs<S extends ReasonSpecMap, C extends keyof S> =
  keyof ParamsDecl<S[C]> extends never
    ? [params?: ReasonParamsOf<S, C>]
    : [params: ReasonParamsOf<S, C>];

/** Why a value is not a valid reason. Carries names, never offending values. */
export interface ReasonIssue {
  readonly kind: "not_object" | "unknown_code" | "missing_param" | "unexpected_param" | "invalid_param";
  readonly reasonCode?: string;
  readonly param?: string;
  /** Position in the input array (parseMany only). */
  readonly index?: number;
}

export interface ReasonCatalogEntry {
  readonly params: {
    readonly [name: string]: { readonly kind: ParamKind; readonly restricted: boolean; readonly values?: readonly string[] };
  };
  readonly meta?: JsonObject;
}

/** Thrown by `make` when rule code passes params that do not match the declaration (a bug). */
export class ReasonCodeUsageError extends TypeError {
  override readonly name = "ReasonCodeUsageError";
  readonly issue: ReasonIssue;
  constructor(issue: ReasonIssue) {
    const where = [issue.reasonCode, issue.param].filter((x) => x !== undefined).join(".");
    super(`Invalid reason (${issue.kind}${where === "" ? "" : ` at ${where}`})`);
    this.issue = issue;
  }
}

export class ReasonRegistryDefinitionError extends Error {
  override readonly name = "ReasonRegistryDefinitionError";
}

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export interface ReasonRegistry<S extends ReasonSpecMap> {
  readonly specs: S;
  readonly codes: readonly ReasonCode<S>[];
  has(code: unknown): code is ReasonCode<S>;
  /** Build a reason; throws {@link ReasonCodeUsageError} on bad params. */
  make<C extends ReasonCode<S>>(code: C, ...args: MakeArgs<S, C>): Reason<S, C>;
  tryMake<C extends ReasonCode<S>>(code: C, ...args: MakeArgs<S, C>): Result<Reason<S, C>, ReasonIssue>;
  /** Validate an untrusted value (storage, wire, model-adjacent code). */
  parse(value: unknown): Result<Reason<S>, ReasonIssue>;
  /** Validate an array; returns every issue (with `index`) rather than the first. */
  parseMany(values: unknown): Result<Reason<S>[], ReasonIssue[]>;
  is(value: unknown): value is Reason<S>;
  meta<C extends ReasonCode<S>>(code: C): ReasonMetaOf<S, C>;
  /** Names of params declared restricted for `code`. */
  restrictedParams(code: ReasonCode<S>): readonly string[];
  /** Strip restricted params unless the caller says the viewer may see them. */
  project(reason: Reason<S>, options: { readonly includeRestricted: boolean }): ProjectedReason<S>;
  match<R>(
    reason: Reason<S>,
    handlers: { readonly [C in ReasonCode<S>]: (params: ReasonParamsOf<S, C>, reason: Reason<S, C>) => R },
  ): R;
  table<V>(entries: { readonly [C in ReasonCode<S>]: V }): Readonly<Record<ReasonCode<S>, V>>;
  describe(): { readonly [code: string]: ReasonCatalogEntry };
}

/** Identity helper that keeps literal types for separately declared groups. */
export function reasonSpecs<const S extends ReasonSpecMap>(specs: S): S {
  return specs;
}

/** Merge groups (engine + scenario); throws on a duplicated code. */
export function mergeReasonSpecs<const A extends ReasonSpecMap, const B extends ReasonSpecMap>(a: A, b: B): A & B {
  const dup = Object.keys(b).filter((k) => Object.hasOwn(a, k));
  if (dup.length > 0) throw new ReasonRegistryDefinitionError(`Duplicate reason codes: ${dup.join(", ")}`);
  return { ...a, ...b };
}

function validateSpecs(specs: ReasonSpecMap): void {
  for (const [code, spec] of Object.entries(specs)) {
    if (!isValidCode(code)) throw new ReasonRegistryDefinitionError(`Invalid reason code "${code}"`);
    for (const [name, p] of Object.entries(spec.params ?? {})) {
      if (!PARAM_NAME.test(name)) throw new ReasonRegistryDefinitionError(`${code}: invalid param name "${name}"`);
      const problem = paramSpecProblem(p);
      if (problem !== null) throw new ReasonRegistryDefinitionError(`${code}.${name}: ${problem}`);
    }
    if (spec.meta !== undefined && !isJsonObject(spec.meta)) {
      throw new ReasonRegistryDefinitionError(`${code}: meta must be a JSON object`);
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function defineReasonCodes<const S extends ReasonSpecMap>(specs: S): ReasonRegistry<S> {
  validateSpecs(specs);
  const frozen = Object.freeze({ ...specs });
  const codes = Object.freeze(Object.keys(frozen)) as readonly ReasonCode<S>[];
  const specOf = (code: string): ReasonSpec | undefined =>
    Object.hasOwn(frozen, code) ? (frozen[code] as ReasonSpec) : undefined;

  function check(value: unknown): Result<Reason<S>, ReasonIssue> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return err({ kind: "not_object" });
    const code = ownGet(value, "reasonCode");
    const params = ownGet(value, "params");
    const spec = typeof code === "string" ? specOf(code) : undefined;
    if (spec === undefined || typeof code !== "string") {
      return err(isValidCode(code) ? { kind: "unknown_code", reasonCode: code } : { kind: "unknown_code" });
    }
    const extraTop = Object.keys(value).filter((k) => k !== "reasonCode" && k !== "params");
    if (extraTop.length > 0) return err({ kind: "unexpected_param", reasonCode: code });
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return err({ kind: "not_object", reasonCode: code });
    }
    const declared = spec.params ?? {};
    for (const name of Object.keys(params)) {
      if (!Object.hasOwn(declared, name)) {
        return err(PARAM_NAME.test(name)
          ? { kind: "unexpected_param", reasonCode: code, param: name }
          : { kind: "unexpected_param", reasonCode: code });
      }
    }
    // Rebuild in declaration order so serialization (and hashing) is canonical.
    const out: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(declared)) {
      if (!Object.hasOwn(params, name)) return err({ kind: "missing_param", reasonCode: code, param: name });
      const v = (params as Record<string, unknown>)[name];
      if (!isValidParam(p, v)) return err({ kind: "invalid_param", reasonCode: code, param: name });
      out[name] = Array.isArray(v) ? [...(v as unknown[])] : v;
    }
    return ok(deepFreeze({ reasonCode: code, params: out }) as unknown as Reason<S>);
  }

  const tryMake = (code: string, params?: object) => check({ reasonCode: code, params: params ?? {} });

  const registry = {
    specs: frozen,
    codes,
    has: (code: unknown): boolean => typeof code === "string" && specOf(code) !== undefined,
    make: (code: string, params?: object) => {
      const r = tryMake(code, params);
      if (!r.ok) throw new ReasonCodeUsageError(r.error);
      return r.value;
    },
    tryMake,
    parse: check,
    parseMany: (values: unknown): Result<Reason<S>[], ReasonIssue[]> => {
      if (!Array.isArray(values)) return err([{ kind: "not_object" }]);
      const good: Reason<S>[] = [];
      const issues: ReasonIssue[] = [];
      values.forEach((v, index) => {
        const r = check(v);
        if (r.ok) good.push(r.value);
        else issues.push({ ...r.error, index });
      });
      return issues.length > 0 ? err(issues) : ok(good);
    },
    is: (value: unknown): boolean => check(value).ok,
    meta: (code: string) => specOf(code)?.meta,
    restrictedParams: (code: string): readonly string[] =>
      Object.entries(specOf(code)?.params ?? {}).filter(([, p]) => p.restricted).map(([n]) => n),
    project: (reason: { reasonCode: string; params: Readonly<Record<string, unknown>> }, options: { includeRestricted: boolean }) => {
      const spec = specOf(reason.reasonCode);
      if (spec === undefined) throw new ReasonCodeUsageError({ kind: "unknown_code" });
      const params: Record<string, unknown> = {};
      const withheld: string[] = [];
      for (const [name, p] of Object.entries(spec.params ?? {})) {
        if (!Object.hasOwn(reason.params, name)) continue;
        if (p.restricted && !options.includeRestricted) withheld.push(name);
        else params[name] = reason.params[name];
      }
      return deepFreeze({ reasonCode: reason.reasonCode, params, withheld: withheld.sort() });
    },
    match: (reason: { reasonCode: string; params: unknown }, handlers: Record<string, (p: unknown, r: unknown) => unknown>) => {
      const handler = Object.hasOwn(handlers, reason.reasonCode) ? handlers[reason.reasonCode] : undefined;
      if (handler === undefined) throw new ReasonCodeUsageError({ kind: "unknown_code" });
      return handler(reason.params, reason);
    },
    table: <V>(entries: Record<string, V>) => exhaustiveTable(codes as readonly string[], entries, "reason table"),
    describe: () =>
      Object.fromEntries(
        codes.map((code) => {
          const s = frozen[code] as ReasonSpec;
          const params = Object.fromEntries(
            Object.entries(s.params ?? {}).map(([n, p]) => [
              n,
              p.values === undefined
                ? { kind: p.kind, restricted: p.restricted }
                : { kind: p.kind, restricted: p.restricted, values: [...p.values] },
            ]),
          );
          return [code, s.meta === undefined ? { params } : { params, meta: s.meta }];
        }),
      ),
  };
  return Object.freeze(registry) as unknown as ReasonRegistry<S>;
}
