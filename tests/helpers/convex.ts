/**
 * convex-test helpers for the engine suite.
 *
 * Canon roles are customer, provider, and finance (00-canon §1.1). Identities
 * are deterministic `issuer|subject` strings. This module is imported by tests
 * and stays outside the Convex deployment module graph. Pass the
 * test file's own `vi` into {@link bindFakeTimers} so scheduler helpers and the
 * test share one vitest instance (convex, convex-test, and vitest are app
 * dependencies, not a second package copy).
 */
import { getFunctionName, type FunctionReference, type UserIdentity } from "convex/server";
import type { JSONValue } from "convex/values";

export const DEFAULT_TEST_ISSUER = "https://issuer.convex-test.invalid";
export const ANONYMOUS = "anonymous" as const;
export type Anonymous = typeof ANONYMOUS;

export const CANON_ROLES = ["customer", "provider", "finance"] as const;
export type CanonRole = (typeof CANON_ROLES)[number];

export interface RoleSpec {
  subject?: string;
  name?: string;
  email?: string;
  /** Derived from issuer and subject; supplying them would drift. */
  issuer?: never;
  tokenIdentifier?: never;
  [claim: string]: JSONValue | undefined;
}

export interface DefineRolesOptions {
  issuer?: string;
  subjectPrefix?: string;
}

export interface RoleRegistry<R extends string> {
  readonly issuer: string;
  readonly names: readonly R[];
  identity(role: R): UserIdentity;
  tokenIdentifier(role: R): string;
  subject(role: R): string;
  roleOf(tokenIdentifier: string): R | undefined;
}

export function tokenIdentifierFor(issuer: string, subject: string): string {
  return `${issuer}|${subject}`;
}

const RESERVED_CLAIMS = new Set(["issuer", "tokenIdentifier"]);

export function makeIdentity(
  subject: string,
  attributes: Omit<RoleSpec, "subject"> = {},
  issuer: string = DEFAULT_TEST_ISSUER,
): UserIdentity {
  if (subject.length === 0) throw new Error("makeIdentity: subject must be non-empty");
  if (issuer.includes("|")) throw new Error("makeIdentity: issuer must not contain '|'");
  const claims: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (RESERVED_CLAIMS.has(key)) {
      throw new Error(`makeIdentity: claim "${key}" is reserved`);
    }
    if (value === undefined) throw new Error(`makeIdentity: claim "${key}" is undefined; omit it`);
    claims[key] = value;
  }
  return Object.freeze({
    ...claims,
    subject,
    issuer,
    tokenIdentifier: tokenIdentifierFor(issuer, subject),
  });
}

export function defineRoles<const R extends string>(
  specs: { readonly [K in R]: K extends Anonymous ? never : RoleSpec },
  options: DefineRolesOptions = {},
): RoleRegistry<R> {
  const issuer = options.issuer ?? DEFAULT_TEST_ISSUER;
  const prefix = options.subjectPrefix ?? "user_";
  const names = Object.keys(specs) as R[];
  if (names.length === 0) throw new Error("defineRoles: at least one role is required");

  const byRole = new Map<R, UserIdentity>();
  const byToken = new Map<string, R>();
  for (const role of names) {
    if ((role as string) === ANONYMOUS) {
      throw new Error(`defineRoles: "${ANONYMOUS}" is reserved for the no-identity case`);
    }
    if (role.length === 0) throw new Error("defineRoles: role names must be non-empty");
    const spec = specs[role] as RoleSpec;
    const identity = makeIdentity(spec.subject ?? `${prefix}${role}`, { name: role, ...spec }, issuer);
    const clash = byToken.get(identity.tokenIdentifier);
    if (clash !== undefined) {
      throw new Error(`defineRoles: roles "${clash}" and "${role}" share tokenIdentifier ${identity.tokenIdentifier}`);
    }
    byRole.set(role, identity);
    byToken.set(identity.tokenIdentifier, role);
  }

  const get = (role: R): UserIdentity => {
    const identity = byRole.get(role);
    if (identity === undefined) throw new Error(`Unknown role "${String(role)}"`);
    return identity;
  };

  return Object.freeze({
    issuer,
    names: Object.freeze([...names]),
    identity: get,
    tokenIdentifier: (role: R) => get(role).tokenIdentifier,
    subject: (role: R) => get(role).subject,
    roleOf: (tokenIdentifier: string) => byToken.get(tokenIdentifier),
  });
}

/** customer, provider, and finance with deterministic test identities. */
export function canonRoles(options?: DefineRolesOptions): RoleRegistry<CanonRole> {
  return defineRoles({ customer: {}, provider: {}, finance: {} }, options);
}

export function bindRoles<R extends string>(roles: RoleRegistry<R>) {
  return <T extends { withIdentity(identity: UserIdentity): unknown }>(t: T, role: R | Anonymous): T =>
    role === ANONYMOUS ? t : (t.withIdentity(roles.identity(role)) as T);
}

export function withRole<T extends { withIdentity(identity: UserIdentity): unknown }, R extends string>(
  t: T,
  roles: RoleRegistry<R>,
  role: NoInfer<R> | Anonymous,
): T {
  return bindRoles(roles)(t, role);
}

const CONVEX_ERROR_BRAND = Symbol.for("ConvexError");

export function isConvexError(error: unknown): error is { data: unknown } {
  if (typeof error === "object" && error !== null && (error as Record<PropertyKey, unknown>)[CONVEX_ERROR_BRAND] === true) {
    return true;
  }
  return error instanceof Error && error.name === "ConvexError";
}

export type CodeExtractor = (error: unknown) => string | undefined;

export const defaultCodeOf: CodeExtractor = (error) => {
  if (!isConvexError(error)) return undefined;
  const data: unknown = error.data;
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null && "code" in data) {
    const code = (data as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

export type Outcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; code: string | undefined; message: string; error: unknown };

export async function outcomeOf<T>(fn: () => Promise<T>, codeOf: CodeExtractor = defaultCodeOf): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: codeOf(error), message, error };
  }
}

export interface RoleMatrixOptions<R extends string> {
  only?: readonly NoInfer<R>[];
  includeAnonymous?: boolean;
  codeOf?: CodeExtractor;
}

export type OutcomeLabel = string;

function selectedRoles<R extends string>(roles: RoleRegistry<R>, options: RoleMatrixOptions<R>): (R | Anonymous)[] {
  const only = options.only ?? roles.names;
  const known = new Set<string>(roles.names);
  for (const role of only) {
    if (!known.has(role)) throw new Error(`Unknown role "${String(role)}"`);
  }
  const order: (R | Anonymous)[] = [...only];
  if (options.includeAnonymous ?? true) order.push(ANONYMOUS);
  return order;
}

export async function roleOutcomes<TAccessor extends { withIdentity(identity: UserIdentity): unknown }, R extends string, T>(
  t: TAccessor,
  roles: RoleRegistry<R>,
  call: (as: TAccessor, role: R | Anonymous) => Promise<T>,
  options: RoleMatrixOptions<R> = {},
): Promise<Record<string, Outcome<T>>> {
  const order = selectedRoles(roles, options);
  const asRole = bindRoles(roles);
  const result: Record<string, Outcome<T>> = {};
  for (const role of order) {
    result[role] = await outcomeOf(() => call(asRole(t, role), role), options.codeOf ?? defaultCodeOf);
  }
  return result;
}

export async function roleMatrix<TAccessor extends { withIdentity(identity: UserIdentity): unknown }, R extends string>(
  t: TAccessor,
  roles: RoleRegistry<R>,
  call: (as: TAccessor, role: R | Anonymous) => Promise<unknown>,
  options: RoleMatrixOptions<R> = {},
): Promise<Record<string, OutcomeLabel>> {
  const outcomes = await roleOutcomes(t, roles, call, options);
  const labels: Record<string, OutcomeLabel> = {};
  for (const [role, outcome] of Object.entries(outcomes)) {
    labels[role] = outcome.ok ? "ok" : (outcome.code ?? `error:${outcome.message}`);
  }
  return labels;
}

export type ScheduledState = "pending" | "inProgress" | "success" | "failed" | "canceled";

export interface ScheduledJob {
  id: string;
  name: string;
  state: ScheduledState;
  scheduledTime: number;
  completedTime: number | undefined;
  args: unknown[];
}

interface ScheduledRow {
  _id: string;
  name: string;
  state: { kind: ScheduledState };
  scheduledTime: number;
  completedTime?: number;
  args: unknown[];
}

/** Structural view of the convex-test scheduler API. */
export interface ScheduledTester {
  run(fn: (ctx: {
    db: { system: { query(table: "_scheduled_functions"): { collect(): Promise<ScheduledRow[]> } } };
  }) => Promise<ScheduledRow[]>): Promise<ScheduledRow[]>;
  finishInProgressScheduledFunctions(): Promise<void>;
}

export interface TimerControl {
  isFakeTimers(): boolean;
  advanceTimersByTime(ms: number): void;
  now(): number;
}

export interface VitestTimerLike {
  isFakeTimers(): boolean;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
}

let timerControl: TimerControl | undefined;

export function setTimerControl(control: TimerControl | undefined): void {
  timerControl = control;
}

export function vitestTimers(vi: VitestTimerLike): TimerControl {
  return {
    isFakeTimers: () => vi.isFakeTimers(),
    advanceTimersByTime: (ms) => vi.advanceTimersByTime(ms),
    now: () => Date.now(),
  };
}

/** Install fake timers for the current suite and point scheduler helpers at this `vi`. */
export function bindFakeTimers(
  vi: VitestTimerLike,
  hooks: { beforeEach(fn: () => void): void; afterEach(fn: () => void): void },
): void {
  hooks.beforeEach(() => {
    vi.useFakeTimers();
    setTimerControl(vitestTimers(vi));
  });
  hooks.afterEach(() => {
    setTimerControl(undefined);
    vi.useRealTimers();
  });
}

function timers(label: string): TimerControl {
  if (timerControl === undefined || !timerControl.isFakeTimers()) {
    throw new Error(`${label}: fake timers are not active. Call bindFakeTimers() or setTimerControl() first.`);
  }
  return timerControl;
}

export async function listScheduled(
  t: ScheduledTester,
  filter?: { fn?: FunctionReference<"mutation" | "action", "public" | "internal">; state?: ScheduledState },
): Promise<ScheduledJob[]> {
  const rows = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
  const wanted = filter?.fn === undefined ? undefined : getFunctionName(filter.fn);
  return rows
    .map(
      (row): ScheduledJob => ({
        id: String(row._id),
        name: row.name,
        state: row.state.kind,
        scheduledTime: row.scheduledTime,
        completedTime: row.completedTime,
        args: row.args,
      }),
    )
    .filter((job) => (wanted === undefined || job.name === wanted) && (filter?.state === undefined || job.state === filter.state));
}

export interface DrainOptions {
  maxIterations?: number;
  failOnFailedJobs?: boolean;
  requireEmptyQueue?: boolean;
}

export interface DrainReport {
  /** Jobs that reached `success` during this advance. Canceled jobs are listed separately. */
  ran: ScheduledJob[];
  failed: ScheduledJob[];
  canceled: ScheduledJob[];
  stillPending: ScheduledJob[];
}

const describeJobs = (jobs: ScheduledJob[]): string => jobs.map((job) => `${job.name}#${job.id}(${job.state})`).join(", ");

async function reportSince(
  t: ScheduledTester,
  before: Map<string, ScheduledState>,
  options: DrainOptions,
  label: string,
): Promise<DrainReport> {
  const after = await listScheduled(t);
  const wasOpen = (job: ScheduledJob): boolean => {
    const prev = before.get(job.id);
    return prev === undefined || prev === "pending" || prev === "inProgress";
  };
  const touched = after.filter(wasOpen);
  const ran = touched.filter((job) => job.state === "success");
  const failed = touched.filter((job) => job.state === "failed");
  const canceled = touched.filter((job) => job.state === "canceled");
  const stillPending = after.filter((job) => job.state === "pending" || job.state === "inProgress");
  if ((options.failOnFailedJobs ?? true) && failed.length > 0) {
    throw new Error(`${label}: scheduled function(s) failed: ${describeJobs(failed)}`);
  }
  if ((options.requireEmptyQueue ?? false) && stillPending.length > 0) {
    throw new Error(`${label}: job(s) still pending after drain: ${describeJobs(stillPending)}`);
  }
  return { ran, failed, canceled, stillPending };
}

export async function drainDue(t: ScheduledTester, options: DrainOptions = {}): Promise<DrainReport> {
  const clock = timers("drainDue");
  const before = new Map((await listScheduled(t)).map(job => [job.id, job.state]));
  for (let i = 0; i < (options.maxIterations ?? 100); i++) {
    clock.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const jobs = await listScheduled(t);
    if (!jobs.some(job => job.state === "inProgress" || (job.state === "pending" && job.scheduledTime <= clock.now()))) {
      return reportSince(t, before, options, "drainDue");
    }
  }
  throw new Error("drainDue: exceeded maximum iterations");
}

export async function advanceScheduledBy(t: ScheduledTester, ms: number, options: DrainOptions = {}): Promise<DrainReport> {
  const clock = timers("advanceScheduledBy");
  if (!Number.isFinite(ms) || ms < 0) throw new Error("advanceScheduledBy: ms must be a finite number >= 0");
  const resolved: DrainOptions = { failOnFailedJobs: true, requireEmptyQueue: false, ...options };
  const before = new Map((await listScheduled(t)).map((job) => [job.id, job.state]));
  clock.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  return reportSince(t, before, resolved, "advanceScheduledBy");
}

export async function advanceScheduledTo(t: ScheduledTester, at: number, options: DrainOptions = {}): Promise<DrainReport> {
  const clock = timers("advanceScheduledTo");
  const delta = at - clock.now();
  if (delta < 0) throw new Error(`advanceScheduledTo: ${at} is ${-delta}ms in the past`);
  return advanceScheduledBy(t, delta, options);
}

export async function expectNoPendingScheduled(t: ScheduledTester): Promise<void> {
  const open = (await listScheduled(t)).filter((job) => job.state === "pending" || job.state === "inProgress");
  if (open.length > 0) throw new Error(`expectNoPendingScheduled: open job(s): ${describeJobs(open)}`);
}

export type ForbiddenPattern = string | RegExp;

export interface ForbiddenFieldViolation {
  path: string;
  key: string;
  pattern: string;
}

export interface FindOptions {
  ignoreUndefinedValues?: boolean;
  maxDepth?: number;
}

type Segment = string | number;

function compile(pattern: ForbiddenPattern): { source: string; test: (path: readonly Segment[], key: string) => boolean } {
  if (pattern instanceof RegExp) {
    const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    return { source: String(pattern), test: (_path, key) => re.test(key) };
  }
  if (pattern.length === 0) throw new Error("forbidden pattern must be non-empty");
  const parts = pattern.split(".");
  if (parts.some((part) => part.length === 0)) throw new Error(`invalid forbidden pattern "${pattern}"`);
  if (parts.length === 1 && parts[0] !== "*" && parts[0] !== "**") {
    return { source: pattern, test: (_path, key) => key === pattern };
  }
  return { source: pattern, test: (path) => matchSegments(parts, 0, path, 0) };
}

function matchSegments(parts: readonly string[], pi: number, path: readonly Segment[], si: number): boolean {
  if (pi === parts.length) return si === path.length;
  const part = parts[pi];
  if (part === "**") {
    for (let k = si; k <= path.length; k++) {
      if (matchSegments(parts, pi + 1, path, k)) return true;
    }
    return false;
  }
  if (si === path.length) return false;
  if (part !== "*" && part !== String(path[si])) return false;
  return matchSegments(parts, pi + 1, path, si + 1);
}

function formatPath(path: readonly Segment[]): string {
  let out = "$";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) out += `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

function isWalkable(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
  return true;
}

export function findForbiddenFields(
  payload: unknown,
  forbidden: readonly ForbiddenPattern[],
  options: FindOptions = {},
): ForbiddenFieldViolation[] {
  if (forbidden.length === 0) throw new Error("findForbiddenFields: forbidden list is empty");
  const compiled = forbidden.map(compile);
  const maxDepth = options.maxDepth ?? 64;
  const violations: ForbiddenFieldViolation[] = [];
  const ancestors = new Set<object>();
  const visit = (value: unknown, path: Segment[]): void => {
    if (!isWalkable(value)) return;
    if (path.length > maxDepth) {
      throw new Error(`findForbiddenFields: nesting deeper than maxDepth=${maxDepth} at ${formatPath(path)}`);
    }
    if (ancestors.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
    } else {
      for (const [key, child] of Object.entries(value)) {
        const childPath = [...path, key];
        if (!(options.ignoreUndefinedValues === true && child === undefined)) {
          for (const pattern of compiled) {
            if (pattern.test(childPath, key)) violations.push({ path: formatPath(childPath), key, pattern: pattern.source });
          }
        }
        visit(child, childPath);
      }
    }
    ancestors.delete(value);
  };
  visit(payload, []);
  return violations;
}

export class ForbiddenFieldsError extends Error {
  readonly violations: readonly ForbiddenFieldViolation[];
  constructor(violations: readonly ForbiddenFieldViolation[], label?: string) {
    const lines = violations.map((violation) => `  ${violation.path} (matched ${violation.pattern})`).join("\n");
    super(`${label ?? "payload"} contains ${violations.length} forbidden field(s):\n${lines}`);
    this.name = "ForbiddenFieldsError";
    this.violations = violations;
  }
}

export function assertNoForbiddenFields(
  payload: unknown,
  forbidden: readonly ForbiddenPattern[],
  options: FindOptions & { label?: string } = {},
): void {
  const violations = findForbiddenFields(payload, forbidden, options);
  if (violations.length > 0) throw new ForbiddenFieldsError(violations, options.label);
}

export function assertPatternsMatch(positiveControl: unknown, forbidden: readonly ForbiddenPattern[]): void {
  const unmatched = forbidden.filter((pattern) => findForbiddenFields(positiveControl, [pattern]).length === 0);
  if (unmatched.length > 0) {
    throw new Error(`assertPatternsMatch: pattern(s) matched nothing in the positive control: ${unmatched.map(String).join(", ")}`);
  }
}

export type Canary = string | number | bigint;

export interface CanaryHit {
  path: string;
  /** Index into the canary list. The value itself is not repeated. */
  canaryIndex: number;
  where: "key" | "value";
}

function amountEquals(value: unknown, canary: number | bigint): boolean {
  if (typeof value === "number" && typeof canary === "number") return Object.is(value, canary);
  if (typeof value === "bigint" && typeof canary === "bigint") return value === canary;
  if (typeof value === "bigint" && typeof canary === "number" && Number.isSafeInteger(canary)) return value === BigInt(canary);
  if (typeof value === "number" && typeof canary === "bigint" && Number.isSafeInteger(value)) return BigInt(value) === canary;
  if (typeof value === "string") return value.includes(String(canary));
  return false;
}

/**
 * String canaries match keys and string values by substring. Number and bigint
 * canaries match by exact numeric value, and also as their decimal spelling
 * inside strings. Formatted amounts such as `$42,000` still need a string canary.
 */
export function findCanaries(payload: unknown, canaries: readonly Canary[], options: { maxDepth?: number } = {}): CanaryHit[] {
  if (canaries.length === 0) throw new Error("findCanaries: canary list is empty");
  if (canaries.some((canary) => typeof canary === "string" && canary.length === 0)) {
    throw new Error("findCanaries: canaries must be non-empty");
  }
  const maxDepth = options.maxDepth ?? 64;
  const hits: CanaryHit[] = [];
  const ancestors = new Set<object>();
  const check = (text: string, path: Segment[], where: CanaryHit["where"]) => {
    canaries.forEach((canary, canaryIndex) => {
      const matched = typeof canary === "string" ? text.includes(canary) : text.includes(String(canary));
      if (matched) hits.push({ path: formatPath(path), canaryIndex, where });
    });
  };
  const visit = (value: unknown, path: Segment[]): void => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      canaries.forEach((canary, canaryIndex) => {
        const matched = typeof canary === "string" ? typeof value === "string" && value.includes(canary) : amountEquals(value, canary);
        if (matched) hits.push({ path: formatPath(path), canaryIndex, where: "value" });
      });
      if (typeof value === "string") return;
      return;
    }
    if (!isWalkable(value)) return;
    if (path.length > maxDepth) throw new Error(`findCanaries: nesting deeper than maxDepth=${maxDepth}`);
    if (ancestors.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, index]));
    else {
      for (const [key, child] of Object.entries(value)) {
        check(key, [...path, key], "key");
        visit(child, [...path, key]);
      }
    }
    ancestors.delete(value);
  };
  visit(payload, []);
  return hits;
}

export function assertNoCanaries(payload: unknown, canaries: readonly Canary[], label = "payload"): void {
  const hits = findCanaries(payload, canaries);
  if (hits.length > 0) {
    const lines = hits.map((hit) => `  ${hit.path} (${hit.where} contains canary #${hit.canaryIndex})`).join("\n");
    throw new Error(`${label} contains ${hits.length} canary hit(s):\n${lines}`);
  }
}

export const convexTestMatchers = {
  toHaveNoForbiddenFields(received: unknown, forbidden: readonly ForbiddenPattern[], options?: FindOptions) {
    const violations = findForbiddenFields(received, forbidden, options);
    return {
      pass: violations.length === 0,
      message: () =>
        violations.length === 0
          ? `expected payload to contain a forbidden field, but it had none`
          : `expected no forbidden fields, found:\n${violations.map((violation) => `  ${violation.path} (matched ${violation.pattern})`).join("\n")}`,
    };
  },
  toContainNoCanaries(received: unknown, canaries: readonly Canary[]) {
    const hits = findCanaries(received, canaries);
    return {
      pass: hits.length === 0,
      message: () => (hits.length === 0 ? "expected payload to contain a canary, but it had none" : `expected no canaries, found ${hits.length}`),
    };
  },
};

declare module "vitest" {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>> {
    toHaveNoForbiddenFields(forbidden: readonly ForbiddenPattern[], options?: FindOptions): R;
    toContainNoCanaries(canaries: readonly Canary[]): R;
  }
}

export interface DedupRecipe<R> {
  callSameKey: () => Promise<R>;
  countRows: () => Promise<number>;
  idOf: (result: R) => string;
  /** `returnExisting` hands back the first id. `rejectDuplicate` throws a coded error. */
  mode?: "returnExisting" | "rejectDuplicate";
  expectDuplicateError?: (error: unknown) => boolean;
  callOtherKey?: () => Promise<R>;
  bypassInsert?: () => Promise<void>;
  /** Required with `bypassInsert`, so an unrelated throw is not treated as success. */
  expectBypassError?: (error: unknown) => boolean;
  /** Concurrent calls against an empty key before the serial phase. Default true. */
  burstFirst?: boolean;
  repeats?: number;
}

export interface DedupReport {
  firstId: string;
  serialIds: string[];
  burstIds: string[];
  otherKeyId: string | undefined;
  bypassError: unknown;
}

export class DedupRecipeError extends Error {
  readonly step: string;
  constructor(step: string, detail: string) {
    super(`dedup recipe failed at step "${step}": ${detail}`);
    this.name = "DedupRecipeError";
    this.step = step;
  }
}

async function expectRows(step: string, countRows: () => Promise<number>, expected: number): Promise<void> {
  const n = await countRows();
  if (n !== expected) throw new DedupRecipeError(step, `expected ${expected} row(s) for the key, found ${n}`);
}

function expectSameIds(step: string, firstId: string, ids: string[]): void {
  const different = ids.filter((id) => id !== firstId);
  if (different.length > 0) throw new DedupRecipeError(step, `expected every call to return ${firstId}, got ${different.join(", ")}`);
}

export async function verifyQueryThenInsertDedup<R>(recipe: DedupRecipe<R>): Promise<DedupReport> {
  const repeats = recipe.repeats ?? 3;
  const mode = recipe.mode ?? "returnExisting";
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("repeats must be a positive integer");
  if (mode === "rejectDuplicate" && recipe.expectDuplicateError === undefined) {
    throw new Error("rejectDuplicate mode requires expectDuplicateError");
  }
  if (recipe.bypassInsert !== undefined && recipe.expectBypassError === undefined) {
    throw new Error("bypassInsert requires expectBypassError");
  }

  await expectRows("clean", recipe.countRows, 0);

  let firstId: string;
  if (recipe.burstFirst ?? true) {
    const settled = await Promise.allSettled(Array.from({ length: repeats }, () => recipe.callSameKey()));
    if (mode === "returnExisting") {
      const ids = settled.map((result) => {
        if (result.status === "rejected") throw new DedupRecipeError("burstFirst", `call rejected: ${String(result.reason)}`);
        return recipe.idOf(result.value);
      });
      firstId = ids[0] ?? "";
      expectSameIds("burstFirst", firstId, ids);
    } else {
      const fulfilled = settled.filter((result) => result.status === "fulfilled");
      const rejected = settled.filter((result) => result.status === "rejected");
      if (fulfilled.length !== 1) throw new DedupRecipeError("burstFirst", `expected exactly one success, got ${fulfilled.length}`);
      const winner = fulfilled[0];
      if (winner === undefined || winner.status !== "fulfilled") throw new DedupRecipeError("burstFirst", "missing success");
      firstId = recipe.idOf(winner.value);
      for (const result of rejected) {
        if (result.status === "rejected" && !recipe.expectDuplicateError?.(result.reason)) {
          throw new DedupRecipeError("burstFirst", "a rejected call was not the expected duplicate error");
        }
      }
    }
    await expectRows("burstFirst", recipe.countRows, 1);
  } else {
    firstId = recipe.idOf(await recipe.callSameKey());
    await expectRows("first", recipe.countRows, 1);
  }

  const serialIds: string[] = [];
  for (let i = 0; i < repeats; i++) {
    if (mode === "returnExisting") serialIds.push(recipe.idOf(await recipe.callSameKey()));
    else {
      try {
        await recipe.callSameKey();
        throw new DedupRecipeError("serial", "duplicate call resolved; expected a coded rejection");
      } catch (error) {
        if (error instanceof DedupRecipeError) throw error;
        if (!recipe.expectDuplicateError?.(error)) throw new DedupRecipeError("serial", "rejection was not the expected duplicate error");
      }
    }
  }
  if (mode === "returnExisting") expectSameIds("serial", firstId, serialIds);
  await expectRows("serial", recipe.countRows, 1);

  const burstSettled = await Promise.allSettled(Array.from({ length: repeats }, () => recipe.callSameKey()));
  const burstIds: string[] = [];
  if (mode === "returnExisting") {
    for (const result of burstSettled) {
      if (result.status === "rejected") throw new DedupRecipeError("burst", `call rejected: ${String(result.reason)}`);
      burstIds.push(recipe.idOf(result.value));
    }
    expectSameIds("burst", firstId, burstIds);
  } else {
    for (const result of burstSettled) {
      if (result.status === "fulfilled") throw new DedupRecipeError("burst", "duplicate call resolved");
      if (!recipe.expectDuplicateError?.(result.reason)) throw new DedupRecipeError("burst", "rejection was not the expected duplicate error");
    }
  }
  await expectRows("burst", recipe.countRows, 1);

  let otherKeyId: string | undefined;
  if (recipe.callOtherKey !== undefined) {
    otherKeyId = recipe.idOf(await recipe.callOtherKey());
    if (otherKeyId === firstId) throw new DedupRecipeError("scoping", "a different key returned the same id");
    await expectRows("scoping", recipe.countRows, 1);
  }

  let bypassError: unknown;
  if (recipe.bypassInsert !== undefined) {
    await recipe.bypassInsert();
    await expectRows("bypass", recipe.countRows, 2);
    try {
      await recipe.callSameKey();
      throw new DedupRecipeError("bypass", "entry point tolerated a duplicate row");
    } catch (error) {
      if (error instanceof DedupRecipeError) throw error;
      if (!recipe.expectBypassError?.(error)) throw new DedupRecipeError("bypass", "error did not match expectBypassError");
      bypassError = error;
    }
    await expectRows("bypass", recipe.countRows, 2);
  }

  return { firstId, serialIds, burstIds, otherKeyId, bypassError };
}
