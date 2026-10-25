import type { GenericDataModel } from "convex/server";
import { defaultCodeOf, outcomeOf, type CodeExtractor, type Outcome } from "./errors";
import {
  ANONYMOUS,
  bindRoles,
  type Anonymous,
  type RoleRegistry,
  type TestAccessor,
} from "./identities";

export interface RoleMatrixOptions<R extends string> {
  /** Which roles to run, in order. Defaults to all registry roles. */
  only?: readonly R[];
  /** Also run once with no identity (key `"anonymous"`). Default true. */
  includeAnonymous?: boolean;
  codeOf?: CodeExtractor;
}

/** Compact form of an outcome: `"ok"` or the error code (or `"error:<message>"`). */
export type OutcomeLabel = string;

/**
 * Call the same function as every role and collect outcomes, so an
 * action x role permission matrix becomes one `toEqual` assertion.
 *
 * Calls run sequentially in role order against the SAME backend state. If the
 * call succeeds for one role and changes state, later roles see that change;
 * for such mutations build a fresh `t` per role, or make the call idempotent.
 */
export async function roleOutcomes<DM extends GenericDataModel, R extends string, T>(
  t: TestAccessor<DM>,
  roles: RoleRegistry<R>,
  call: (as: TestAccessor<DM>, role: R | Anonymous) => Promise<T>,
  options: RoleMatrixOptions<R> = {},
): Promise<Record<R | Anonymous, Outcome<T>>> {
  const withRole = bindRoles(roles);
  const order: (R | Anonymous)[] = [...(options.only ?? roles.names)];
  if (options.includeAnonymous ?? true) order.push(ANONYMOUS);
  const result = {} as Record<R | Anonymous, Outcome<T>>;
  for (const role of order) {
    result[role] = await outcomeOf(
      () => call(withRole(t, role), role),
      options.codeOf ?? defaultCodeOf,
    );
  }
  return result;
}

/**
 * Like {@link roleOutcomes} but reduces each outcome to a label:
 * `"ok"`, the ConvexError code, or `"error:<message>"` for uncoded errors.
 *
 * @example
 * expect(await roleMatrix(t, roles, (as) => as.mutation(api.items.rename, args)))
 *   .toEqual({ owner: "ok", member: "FORBIDDEN", outsider: "FORBIDDEN", anonymous: "UNAUTHENTICATED" });
 */
export async function roleMatrix<DM extends GenericDataModel, R extends string>(
  t: TestAccessor<DM>,
  roles: RoleRegistry<R>,
  call: (as: TestAccessor<DM>, role: R | Anonymous) => Promise<unknown>,
  options: RoleMatrixOptions<R> = {},
): Promise<Record<R | Anonymous, OutcomeLabel>> {
  const outcomes = await roleOutcomes(t, roles, call, options);
  const labels = {} as Record<R | Anonymous, OutcomeLabel>;
  for (const [role, outcome] of Object.entries(outcomes) as [R | Anonymous, Outcome][]) {
    labels[role] = outcome.ok ? "ok" : (outcome.code ?? `error:${outcome.message}`);
  }
  return labels;
}
