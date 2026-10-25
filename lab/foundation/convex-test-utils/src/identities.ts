import type { GenericDataModel, UserIdentity } from "convex/server";
import type { JSONValue } from "convex/values";
import type { TestConvexForDataModel } from "convex-test";

/**
 * Issuer used when a role registry does not specify one. The `.invalid` TLD
 * guarantees it can never collide with a real identity provider, so a test
 * identity can never be mistaken for a production one in logs or fixtures.
 */
export const DEFAULT_TEST_ISSUER = "https://issuer.convex-test.invalid";

/**
 * Reserved pseudo-role used by matrix helpers for "no identity at all".
 * `defineRoles` refuses to register a role with this name.
 */
export const ANONYMOUS = "anonymous" as const;
export type Anonymous = typeof ANONYMOUS;

/**
 * Per-role identity attributes. `subject` defaults to `${subjectPrefix}${role}`
 * and `name` defaults to the role name. `tokenIdentifier` is always derived as
 * `${issuer}|${subject}` (the format Convex itself uses), so it cannot be
 * overridden and drift from `issuer`/`subject`.
 */
export interface RoleSpec {
  subject?: string;
  name?: string;
  email?: string;
  /** Any other JWT claim, as `UserIdentity` allows. */
  [claim: string]: JSONValue | undefined;
}

export interface DefineRolesOptions {
  /** JWT `iss`. Defaults to {@link DEFAULT_TEST_ISSUER}. */
  issuer?: string;
  /** Prefix for generated subjects. Defaults to `"user_"` (Clerk-like ids). */
  subjectPrefix?: string;
}

/** A frozen, deterministic set of named test identities. */
export interface RoleRegistry<R extends string> {
  readonly issuer: string;
  /** Role names in declaration order (the order matrix helpers iterate in). */
  readonly names: readonly R[];
  /** Full identity for a role (frozen; safe to share between tests). */
  identity(role: R): UserIdentity;
  /** Shorthand for `identity(role).tokenIdentifier`. */
  tokenIdentifier(role: R): string;
  /** Shorthand for `identity(role).subject`. */
  subject(role: R): string;
  /** Reverse lookup: which role (if any) owns this tokenIdentifier. */
  roleOf(tokenIdentifier: string): R | undefined;
}

/** Build `iss|sub`, the tokenIdentifier format used by Convex and convex-test. */
export function tokenIdentifierFor(issuer: string, subject: string): string {
  return `${issuer}|${subject}`;
}

/**
 * Build a single fully-specified identity. Prefer {@link defineRoles} for named
 * actors; use this for one-off identities (e.g. "a user the app has never seen").
 */
export function makeIdentity(
  subject: string,
  attributes: Omit<RoleSpec, "subject"> = {},
  issuer: string = DEFAULT_TEST_ISSUER,
): UserIdentity {
  if (subject.length === 0) throw new Error("makeIdentity: subject must be non-empty");
  if (issuer.includes("|")) throw new Error("makeIdentity: issuer must not contain '|'");
  return Object.freeze({
    ...attributes,
    subject,
    issuer,
    tokenIdentifier: tokenIdentifierFor(issuer, subject),
  });
}

/**
 * Declare the named actors of a test suite once, with deterministic identities.
 *
 * Why not `t.withIdentity({ name })`? convex-test generates a random-looking
 * subject when only `name` is given, so `tokenIdentifier` is unpredictable and
 * fixtures cannot reference it. Registries make every identity reproducible.
 *
 * @example
 * const roles = defineRoles({ owner: {}, member: {}, outsider: { email: "o@x.test" } });
 * roles.tokenIdentifier("owner"); // "https://issuer.convex-test.invalid|user_owner"
 */
export function defineRoles<const R extends string>(
  specs: Record<R, RoleSpec>,
  options: DefineRolesOptions = {},
): RoleRegistry<R> {
  const issuer = options.issuer ?? DEFAULT_TEST_ISSUER;
  const prefix = options.subjectPrefix ?? "user_";
  const names = Object.keys(specs) as R[];
  if (names.length === 0) throw new Error("defineRoles: at least one role is required");

  const byRole = new Map<R, UserIdentity>();
  const byToken = new Map<string, R>();
  for (const role of names) {
    if (role === ANONYMOUS) {
      throw new Error(`defineRoles: "${ANONYMOUS}" is reserved for the no-identity case`);
    }
    if (role.length === 0) throw new Error("defineRoles: role names must be non-empty");
    const spec = specs[role];
    const identity = makeIdentity(
      spec.subject ?? `${prefix}${role}`,
      { name: role, ...spec },
      issuer,
    );
    const clash = byToken.get(identity.tokenIdentifier);
    if (clash !== undefined) {
      throw new Error(
        `defineRoles: roles "${clash}" and "${role}" share tokenIdentifier ${identity.tokenIdentifier}`,
      );
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

/** Any convex-test accessor (root `t` or one returned by `withIdentity`). */
export type TestAccessor<DM extends GenericDataModel> = TestConvexForDataModel<DM>;

/** `withRole(t, role)` bound to a registry. `ANONYMOUS` returns `t` unchanged. */
export type WithRole<R extends string> = <DM extends GenericDataModel>(
  t: TestAccessor<DM>,
  role: R | Anonymous,
) => TestAccessor<DM>;

/**
 * Bind a registry to get a two-argument `withRole(t, role)`.
 *
 * Note: `withRole(t, ANONYMOUS)` returns the accessor it was given. Passing an
 * accessor that already carries an identity therefore keeps that identity, so
 * always start from the root `t` when you need a truly anonymous caller.
 */
export function bindRoles<R extends string>(roles: RoleRegistry<R>): WithRole<R> {
  return <DM extends GenericDataModel>(t: TestAccessor<DM>, role: R | Anonymous) =>
    role === ANONYMOUS ? t : t.withIdentity(roles.identity(role));
}

/** Unbound form: `withRole(t, roles, "owner")`. */
export function withRole<DM extends GenericDataModel, R extends string>(
  t: TestAccessor<DM>,
  roles: RoleRegistry<R>,
  role: R | Anonymous,
): TestAccessor<DM> {
  return bindRoles(roles)(t, role);
}
