/**
 * Single source of truth for engine & protocol reason codes (canon §1.5, 06 §6.1–6.3).
 *
 * Pure TypeScript: no external dependencies. Convex validators and Zod enums
 * at the backend boundary derive from `REASON_CODES`.
 */

export const REASON_CODES_BY_DOMAIN = {
  output: [
    "output.not_json",
    "output.schema_violation",
    "output.truncated",
    "output.refusal",
    "output.unknown_reference",
  ],
  action: [
    "action.not_allowed_for_role",
    "action.option_not_in_snapshot",
    "action.repeats_blocked",
  ],
  item: [
    "item.unknown",
    "item.unconfirmed",
    "item.retired",
    "item.required_missing",
    "item.duplicate",
    "item.limit_exceeded",
  ],
  date: [
    "date.invalid",
    "date.in_past",
    "date.after_deadline",
    "date.before_lead_time",
    "date.out_of_range",
  ],
  budget: [
    "budget.over",
    "budget.below_committed",
  ],
  amount: [
    "amount.claim_mismatch",
    "amount.out_of_range",
  ],
  version: [
    "version.stale_constraints",
    "version.stale_source",
  ],
  approval: [
    "approval.stale",
    "approval.missing_role",
    "approval.self_conflict",
    "approval.not_current",
    "approval.already_executed",
    "approval.not_executable",
  ],
  disclosure: [
    "disclosure.blocked",
    "disclosure.needs_own_confirmation",
  ],
  run: [
    "run.call_limit",
    "run.draining",
    "run.invalid_state",
    "run.rate_limited",
  ],
  private: [
    "private.constraint_unmet",
  ],
} as const;

export type ReasonDomain = keyof typeof REASON_CODES_BY_DOMAIN;

export const REASON_DOMAINS = [
  "output",
  "action",
  "item",
  "date",
  "budget",
  "amount",
  "version",
  "approval",
  "disclosure",
  "run",
  "private",
] as const satisfies readonly ReasonDomain[];

/** Flat tuple of all canonical reason codes grouped by domain in canon §1.5 order. */
export const REASON_CODES = [
  ...REASON_CODES_BY_DOMAIN.output,
  ...REASON_CODES_BY_DOMAIN.action,
  ...REASON_CODES_BY_DOMAIN.item,
  ...REASON_CODES_BY_DOMAIN.date,
  ...REASON_CODES_BY_DOMAIN.budget,
  ...REASON_CODES_BY_DOMAIN.amount,
  ...REASON_CODES_BY_DOMAIN.version,
  ...REASON_CODES_BY_DOMAIN.approval,
  ...REASON_CODES_BY_DOMAIN.disclosure,
  ...REASON_CODES_BY_DOMAIN.run,
  ...REASON_CODES_BY_DOMAIN.private,
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonParamScalar = string | number | boolean;
export type ReasonParamValue = ReasonParamScalar | string[];
export type ReasonParams = Record<string, ReasonParamValue>;

export type DisclosableFieldKey = "headroomCents" | "capCents" | "deadline" | "requiredItemKeys";

/**
 * Audience rule for a single parameter (06 §6.3):
 * - `'room'`: public within the room to non-fitOnly members (catalog keys, room localDate, cv).
 * - `'owner'`: only the constraint owner / actor who triggered the check or write.
 * - `{ ifDisclosed: field }`: owner, or another buyer role if `field` has been disclosed to them.
 *
 * Provider receives caller parameters for its own writes, never rule-check parameters.
 */
export type ParamAudience = "room" | "owner" | "caller" | "projectedCodes" | { readonly ifDisclosed: DisclosableFieldKey };

export type ReasonAudience = "owner" | "buyer" | "room" | "provider" | "customer" | "finance";

export interface ReasonCodeMeta {
  readonly code: ReasonCode;
  readonly domain: ReasonDomain;
  readonly ownerRole: "customer" | "provider" | "finance" | null;
  readonly paramAudiences: Readonly<Record<string, ParamAudience>>;
  readonly audienceParams: Readonly<Record<ReasonAudience, readonly string[]>>;
}

const REASON_CODE_SET: ReadonlySet<string> = new Set<string>(REASON_CODES);

/** Runtime type guard for canonical reason codes. */
export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && REASON_CODE_SET.has(value);
}

/**
 * Per-parameter audience declarations from 06 §6.1–6.3.
 * Any parameter not declared here is dropped during projection (fail-closed).
 */
export const PARAM_AUDIENCE = {
  "output.not_json": {},
  "output.schema_violation": {},
  "output.truncated": {},
  "output.refusal": {},
  "output.unknown_reference": { field: "owner" },
  "action.not_allowed_for_role": { action: "owner" },
  "action.option_not_in_snapshot": {},
  "action.repeats_blocked": {},
  "item.unknown": { itemKeys: "room", field: "caller" },
  "item.unconfirmed": { itemKeys: "caller", field: "caller" },
  "item.retired": { itemKeys: "room", field: "caller" },
  "item.required_missing": {
    field: "caller",
    itemKeys: { ifDisclosed: "requiredItemKeys" },
    missingItemKeys: { ifDisclosed: "requiredItemKeys" },
    reason: { ifDisclosed: "requiredItemKeys" },
  },
  "item.duplicate": { itemKeys: "owner", field: "caller" },
  "item.limit_exceeded": { limit: "caller", field: "caller" },
  "date.invalid": { field: "caller" },
  "date.in_past": { localDate: "room", field: "caller" },
  "date.after_deadline": {
    deadline: { ifDisclosed: "deadline" },
    daysLate: { ifDisclosed: "deadline" },
  },
  "date.before_lead_time": { earliestDate: "caller" },
  "date.out_of_range": { field: "caller", min: "owner", max: "owner" },
  "budget.over": {
    overByCents: { ifDisclosed: "headroomCents" },
    headroomCents: { ifDisclosed: "headroomCents" },
  },
  "budget.below_committed": {
    belowByCents: "owner",
    minAllowedCapCents: "owner",
  },
  "amount.claim_mismatch": {},
  "amount.out_of_range": { field: "caller" },
  "version.stale_constraints": { checkedAgainst: "room", currentConstraintsVersion: "caller" },
  "version.stale_source": { itemKeys: "room" },
  "approval.stale": { currentConstraintsVersion: "room" },
  "approval.missing_role": { roles: "room" },
  "approval.self_conflict": {},
  "approval.not_current": {},
  "approval.already_executed": {},
  "approval.not_executable": { reasonCodes: "projectedCodes" },
  "disclosure.blocked": { field: "caller" },
  "disclosure.needs_own_confirmation": { field: "caller" },
  "run.call_limit": {},
  "run.draining": {},
  "run.invalid_state": { guard: "caller" },
  "run.rate_limited": { retryAfterMs: "caller" },
  "private.constraint_unmet": {},
  'auth.unauthenticated': {}, 'auth.user_not_provisioned': {}, 'auth.not_member': {},
  'auth.role_forbidden': {}, 'auth.not_creator': {}, 'invite.invalid': {},
  'invite.email_unverified': {}, 'invite.seat_taken': { role: 'caller' },
  'invite.already_member': { role: 'caller' }, 'request.not_open': {},
  'request.option_unknown': {}, 'input.invalid': { field: 'caller' }, 'internal': {},
} as const satisfies Record<ErrorCode, Readonly<Record<string, ParamAudience>>>;

const OWNER_ROLE_BY_CODE: Readonly<Partial<Record<ReasonCode, "customer" | "provider" | "finance">>> = {
  "item.required_missing": "customer",
  "date.after_deadline": "customer",
  "budget.over": "finance",
  "budget.below_committed": "finance",
};

function computeAudienceLists(
  code: ReasonCode,
  paramAudiences: Readonly<Record<string, ParamAudience>>,
): Readonly<Record<ReasonAudience, readonly string[]>> {
  const ownerRole = OWNER_ROLE_BY_CODE[code] ?? null;
  const entries = Object.entries(paramAudiences);

  const owner = Object.freeze(entries.filter(([, rule]) => rule !== "projectedCodes").map(([k]) => k));
  const room = Object.freeze(entries.filter(([, rule]) => rule === "room").map(([k]) => k));
  const buyer = room;
  // Canon §1.5 & D12 ①: only caller parameters survive for provider.
  const provider: readonly string[] = Object.freeze(entries.filter(([, rule]) => rule === "caller").map(([k]) => k));

  const customer = Object.freeze(
    entries
      .filter(([, rule]) => {
        if (rule === "room" || rule === "caller") return true;
        return rule !== "projectedCodes" && ownerRole === "customer";
      })
      .map(([k]) => k),
  );

  const finance = Object.freeze(
    entries
      .filter(([, rule]) => {
        if (rule === "room" || rule === "caller") return true;
        return rule !== "projectedCodes" && ownerRole === "finance";
      })
      .map(([k]) => k),
  );

  return Object.freeze({ owner, buyer, room, provider, customer, finance });
}

function buildReasonCodeMeta(): Readonly<Record<ReasonCode, ReasonCodeMeta>> {
  const out = {} as Record<ReasonCode, ReasonCodeMeta>;
  for (const code of REASON_CODES) {
    const domain = code.slice(0, code.indexOf(".")) as ReasonDomain;
    const paramAudiences = PARAM_AUDIENCE[code];
    const ownerRole = OWNER_ROLE_BY_CODE[code] ?? null;
    const lists = computeAudienceLists(code, paramAudiences);
    out[code] = Object.freeze({
      code,
      domain,
      ownerRole,
      paramAudiences,
      audienceParams: lists,
    });
  }
  return Object.freeze(out);
}

/** Complete metadata table indexed by `ReasonCode`. */
export const REASON_CODE_META: Readonly<Record<ReasonCode, ReasonCodeMeta>> = buildReasonCodeMeta();

/** Per-code map of allowed parameter names by audience. */
export const AUDIENCE_PARAMS: Readonly<
  Record<ReasonCode, Readonly<Record<ReasonAudience, readonly string[]>>>
> = Object.freeze(
  Object.fromEntries(REASON_CODES.map((code) => [code, REASON_CODE_META[code].audienceParams])) as Record<
    ReasonCode,
    Readonly<Record<ReasonAudience, readonly string[]>>
  >,
);

export interface FilterReasonParamsOptions {
  /** Fields disclosed to the viewer (when evaluating `{ ifDisclosed }` for a non-owner buyer). */
  readonly disclosedFields?: Iterable<string>;
  /** Whether the viewer is the owner/actor of this check or error. */
  readonly isOwner?: boolean;
  /** Explicitly projected by check ownership before crossing the boundary. */
  readonly projectedCodes?: readonly ReasonCode[];
}

function resolveAllowedParamSet(
  code: string,
  audience: ReasonAudience,
  options?: FilterReasonParamsOptions,
): ReadonlySet<string> {
  if (!isReasonCode(code)) {
    if (!Object.hasOwn(PARAM_AUDIENCE, code)) return new Set();
    return new Set(Object.entries(PARAM_AUDIENCE[code as ErrorCode]).filter(([, rule]) => rule === 'caller').map(([name]) => name));
  }
  if (audience === "provider") return new Set(REASON_CODE_META[code].audienceParams.provider);

  const meta = REASON_CODE_META[code];
  const isOwner =
    options?.isOwner ??
    (audience === "owner" || (meta.ownerRole !== null && audience === meta.ownerRole));

  if (isOwner) {
    return new Set(meta.audienceParams.owner);
  }

  if (audience === "room") {
    return new Set(meta.audienceParams.room);
  }

  // Buyer / customer / finance viewing a non-owned reason:
  // Missing disclosure information defaults to an empty set (fail-closed);
  // `{ ifDisclosed }` parameters require explicit disclosure for non-owner recipients.
  const disclosedSet = new Set(options?.disclosedFields ?? []);
  const allowed: string[] = [];
  for (const [paramName, rule] of Object.entries(meta.paramAudiences)) {
    if (rule === "room" || rule === "caller") {
      allowed.push(paramName);
    } else if (typeof rule === "object" && "ifDisclosed" in rule) {
      if (disclosedSet.has(rule.ifDisclosed)) {
        allowed.push(paramName);
      }
    }
  }
  return new Set(allowed);
}

/**
 * Filter a reason's parameter record for a target audience (fail-closed:
 * unknown reason codes or undeclared parameter names are always dropped).
 */
export function filterReasonParams<P extends Readonly<Record<string, unknown>>>(
  code: string,
  params: P,
  audience: ReasonAudience,
  options?: FilterReasonParamsOptions,
): Partial<P> {
  const allowed = resolveAllowedParamSet(code, audience, options);
  const out: Partial<P> = {};
  if (code === "approval.not_executable" && audience !== "provider" && options?.projectedCodes) {
    (out as Record<string, unknown>).reasonCodes = [...options.projectedCodes];
  }
  if (allowed.size === 0 || typeof params !== "object" || params === null) {
    return out;
  }
  for (const [key, value] of Object.entries(params)) {
    if (allowed.has(key) && value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Query or filter allowed parameters for a `(code, audience)` pair.
 * - `audienceParams(code, audience, options?)` -> `readonly string[]` of allowed param names (unknown code -> `[]`).
 * - `audienceParams(code, audience, params, options?)` -> filtered copy of `params` with unknown/disallowed keys dropped.
 */
export function audienceParams(
  code: string,
  audience: ReasonAudience,
  options?: FilterReasonParamsOptions,
): readonly string[];
export function audienceParams<P extends Readonly<Record<string, unknown>>>(
  code: string,
  audience: ReasonAudience,
  params: P,
  options?: FilterReasonParamsOptions,
): Partial<P>;
export function audienceParams<P extends Readonly<Record<string, unknown>>>(
  code: string,
  audience: ReasonAudience,
  paramsOrOptions?: P | FilterReasonParamsOptions,
  maybeOptions?: FilterReasonParamsOptions,
): readonly string[] | Partial<P> {
  if (
    paramsOrOptions !== undefined &&
    maybeOptions === undefined &&
    isFilterOptionsOnly(paramsOrOptions)
  ) {
    return Object.freeze([...resolveAllowedParamSet(code, audience, paramsOrOptions)]);
  }
  if (paramsOrOptions === undefined) {
    return Object.freeze([...resolveAllowedParamSet(code, audience)]);
  }
  return filterReasonParams(code, paramsOrOptions as P, audience, maybeOptions);
}

function isFilterOptionsOnly(value: unknown): value is FilterReasonParamsOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => k === "disclosedFields" || k === "isOwner" || k === "projectedCodes");
}

// 12 §12.4: API-only errors are disjoint from rule reasons.
export const API_ERROR_CODES = [
  'auth.unauthenticated', 'auth.user_not_provisioned', 'auth.not_member', 'auth.role_forbidden', 'auth.not_creator',
  'invite.invalid', 'invite.email_unverified', 'invite.seat_taken', 'invite.already_member',
  'request.not_open', 'request.option_unknown', 'input.invalid', 'internal',
] as const;
export type ApiErrorCode = typeof API_ERROR_CODES[number];
export const ERROR_CODES = [...REASON_CODES, ...API_ERROR_CODES] as const;
export type ErrorCode = typeof ERROR_CODES[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);

/** Runtime type guard for canonical reason + API error codes (`ERROR_CODES`). */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}
