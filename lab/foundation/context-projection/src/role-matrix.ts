/**
 * Declarative field x role disclosure matrix and the role projector driven by it.
 *
 * A matrix lists, for EVERY field of a record type, the roles allowed to see
 * that field. The compiler forces an entry for every field (adding a field to
 * the record without a disclosure decision is a compile error), rejects fields
 * the record does not have, and rejects roles that were not declared. The
 * projected type for a role contains exactly the fields whose entry names that
 * role, so code that reads a field the role may not see does not compile.
 *
 * Fail-closed defaults:
 *  - a field lists roles explicitly; an empty list means "nobody";
 *  - a newly added role sees nothing until fields name it;
 *  - projecting for a union of roles yields only the fields visible to ALL of
 *    them (the intersection), never the union;
 *  - an unknown role at runtime throws instead of returning a partial view.
 */
import { copyListedKeys, type ProjectionTypeError, type StringKeyOf } from './pick-exact.ts';

/** For every string field of `T`, the roles (subset of `R`) allowed to see it. */
export type FieldRoles<T, R extends string> = {
  readonly [K in StringKeyOf<T>]-?: readonly R[];
};

type NoExtraFields<F, T> =
  [Exclude<keyof F, StringKeyOf<T>>] extends [never]
    ? unknown
    : ProjectionTypeError<'matrix names fields the record does not have', Exclude<keyof F, StringKeyOf<T>>>;

type NoDuplicateRoles<R extends readonly string[]> = R extends readonly [infer Head, ...infer Rest extends readonly string[]]
  ? [Head] extends [Rest[number]]
    ? ProjectionTypeError<'roles list contains a duplicate role', Head>
    : NoDuplicateRoles<Rest>
  : unknown;

/** A validated, frozen disclosure matrix for record type `T`. */
export interface DisclosureMatrix<T, R extends string, F extends FieldRoles<T, R>> {
  readonly roles: readonly R[];
  readonly fields: F;
  /** Field names visible to each role, in matrix declaration order. */
  readonly keysByRole: { readonly [Role in R]: readonly StringKeyOf<T>[] };
  /** Phantom member carrying the record type; always undefined at runtime. */
  readonly __record?: T;
}

/**
 * Field names of `T` visible to `Role`. Non-distributive on purpose: when
 * `Role` is a union, only fields visible to every member qualify.
 */
export type VisibleKeys<T, F extends FieldRoles<T, string>, Role extends string> = {
  [K in StringKeyOf<T>]-?: [Role] extends [F[K][number]] ? K : never;
}[StringKeyOf<T>];

/** The projected record type for `Role` under matrix fields `F`. */
export type ProjectedFor<T, F extends FieldRoles<T, string>, Role extends string> = Pick<T, VisibleKeys<T, F, Role>>;

/** Convenience: projected type straight from a matrix value's type. */
export type ProjectionOf<M, Role extends string> =
  M extends DisclosureMatrix<infer T, infer _R, infer F> ? ProjectedFor<T, F, Role> : never;

/**
 * `defineDisclosureMatrix<T>()({ roles, fields })`.
 *
 * ```ts
 * const matrix = defineDisclosureMatrix<Example>()({
 *   roles: ['owner', 'peer', 'auditor'],
 *   fields: {
 *     id: ['owner', 'peer', 'auditor'],
 *     title: ['owner', 'peer'],
 *     privateNote: ['owner'],
 *     internalScore: [],
 *   },
 * });
 * ```
 */
export function defineDisclosureMatrix<T extends object>() {
  return <const Roles extends readonly string[], const F extends FieldRoles<T, Roles[number]>>(spec: {
    readonly roles: Roles & NoDuplicateRoles<Roles>;
    readonly fields: F & NoExtraFields<F, T>;
  }): DisclosureMatrix<T, Roles[number], F> => {
    const roles = Object.freeze([...(spec.roles as Roles)]) as readonly Roles[number][];
    const roleSet = new Set<string>();
    for (const role of roles) {
      if (typeof role !== 'string' || role.length === 0) {
        throw new TypeError('defineDisclosureMatrix: roles must be non-empty strings');
      }
      if (roleSet.has(role)) throw new TypeError(`defineDisclosureMatrix: duplicate role "${role}"`);
      roleSet.add(role);
    }
    if (roles.length === 0) throw new TypeError('defineDisclosureMatrix: at least one role is required');

    const fieldEntries = Object.entries(spec.fields as Record<string, readonly string[]>);
    const keysByRole: Record<string, string[]> = {};
    for (const role of roles) keysByRole[role] = [];
    const frozenFields: Record<string, readonly string[]> = {};
    for (const [field, allowed] of fieldEntries) {
      if (!Array.isArray(allowed)) {
        throw new TypeError(`defineDisclosureMatrix: field "${field}" must map to an array of roles`);
      }
      const seen = new Set<string>();
      for (const role of allowed) {
        if (!roleSet.has(role)) {
          throw new TypeError(`defineDisclosureMatrix: field "${field}" names undeclared role "${String(role)}"`);
        }
        if (seen.has(role)) throw new TypeError(`defineDisclosureMatrix: field "${field}" repeats role "${role}"`);
        seen.add(role);
        keysByRole[role]?.push(field);
      }
      frozenFields[field] = Object.freeze([...allowed]);
    }
    for (const role of roles) Object.freeze(keysByRole[role]);

    return Object.freeze({
      roles,
      fields: Object.freeze(frozenFields) as unknown as F,
      keysByRole: Object.freeze(keysByRole) as unknown as DisclosureMatrix<T, Roles[number], F>['keysByRole'],
    });
  };
}

/** A role projector compiled from a matrix. */
export interface RoleProjector<T, R extends string, F extends FieldRoles<T, R>> {
  <Role extends R>(role: Role, source: T): ProjectedFor<T, F, Role>;
  /** Pre-bind a role, e.g. once per request after the caller's role is resolved. */
  forRole<Role extends R>(role: Role): (source: T) => ProjectedFor<T, F, Role>;
  readonly matrix: DisclosureMatrix<T, R, F>;
}

/**
 * Compiles a matrix into a projector. The runtime path reads only the keys the
 * matrix grants to the role, so fields outside the matrix (including extra
 * properties on a structurally wider object) never appear in the output.
 */
export function projectByRole<T extends object, R extends string, F extends FieldRoles<T, R>>(
  matrix: DisclosureMatrix<T, R, F>,
): RoleProjector<T, R, F> {
  const keysFor = (role: string): readonly string[] => {
    if (typeof role !== 'string' || !Object.hasOwn(matrix.keysByRole, role)) {
      throw new RangeError('projectByRole: unknown role');
    }
    return (matrix.keysByRole as Record<string, readonly string[]>)[role] ?? [];
  };
  const project = <Role extends R>(role: Role, source: T): ProjectedFor<T, F, Role> =>
    copyListedKeys(source, keysFor(role)) as ProjectedFor<T, F, Role>;
  const forRole = <Role extends R>(role: Role): ((source: T) => ProjectedFor<T, F, Role>) => {
    const keys = keysFor(role);
    return (source: T) => copyListedKeys(source, keys) as ProjectedFor<T, F, Role>;
  };
  return Object.assign(project, { forRole, matrix });
}
